import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { MediaRuntime } from '@mediaruntime/node';
import { createApp } from '../src/server.mjs';
import { AudioPipeline } from '../src/pipeline.mjs';
import { saveM4a } from '../src/bundle.mjs';

// Deliberately tiny container fixture, not playable footage. Live browser validation is separate.
const isoMedia = Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex');
const wav = Buffer.from('524946462400000057415645666d7420100000000100010080bb000000770100020010006461746100000000','hex');
function zipFile(name, data = isoMedia) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const filename = Buffer.from(name); const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}
async function fixture(t, { status = 'COMPLETED', badHash = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'node-audio-test-')); const calls = [];
  const archive = zipFile('audio/output.m4a'); let polls = 0;
  const provider = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks); calls.push({ method: req.method, url: req.url, headers: req.headers, bytes });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/upload-url') return res.end(JSON.stringify({ upload_url: `${base}/storage`, file_uri: 'gs://test-bucket/source.wav', upload_headers: { 'Content-Type': 'audio/wav' } }));
    if (req.url === '/storage') return res.end();
    if (req.url === '/v1/jobs' && req.method === 'POST') return res.end(JSON.stringify({ job_id: 'job_fixture', status: 'QUEUED' }));
    if (req.url === '/v1/jobs/job_fixture') return res.end(JSON.stringify({ job_id: 'job_fixture', status: polls++ === 0 ? 'PROCESSING' : status,
      bundle: { available: true, download_url: `${base}/bundle`, sha256: badHash ? '0'.repeat(64) : createHash('sha256').update(archive).digest('hex') } }));
    if (req.url === '/bundle') { res.statusCode = 307; res.setHeader('location', `${base}/storage-bundle`); return res.end(); }
    if (req.url === '/storage-bundle') { res.setHeader('content-type', 'application/zip'); return res.end(archive); }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${provider.address().port}`;
  const media = new MediaRuntime({ apiKey: 'test-only-key', baseUrl: base, maxRetries: 0 });
  let handler; const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { app, worker } = await createApp({ media, root, origin, allowLoopback: true }); handler = app;
  t.after(async () => { worker.closed = true; server.closeAllConnections(); provider.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => provider.close(resolve))]);
    await rm(root, { recursive: true, force: true }); });
  const upload = async (data = wav, header = origin) => {
    const form = new FormData(); form.append('audio', new Blob([data], { type: 'audio/wav' }), 'bunny.wav');
    return fetch(`${origin}/api/audio`, { method: 'POST', headers: { origin: header }, body: form });
  };
  const settled = async id => {
    for (let i = 0; i < 100; i++) {
      const record = await worker.load(id);
      if (['ready', 'failed'].includes(record.status) && !worker.running) return record;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Fixture did not finish.');
  };
  return { root, worker, media, calls, origin, upload, settled };
}

test('real SDK: multipart upload → async job → canonical ZIP → saved M4A and Range playback', async t => {
  const f = await fixture(t); const response = await f.upload(); assert.equal(response.status, 202);
  const initial = await response.json(); const record = await f.settled(initial.id); assert.equal(record.status, 'ready');
  const submission = f.calls.find(c => c.url === '/v1/jobs'); const payload = JSON.parse(submission.bytes);
  assert.equal(payload.source, 'gs://test-bucket/source.wav'); assert.deepEqual(payload.outputs, ['audio.web']);
  assert.equal(payload.deliver_webhook, false); assert.equal(submission.headers['idempotency-key'], `node-audio:${initial.id}`);
  assert.deepEqual(f.calls.find(c => c.url === '/storage').bytes, wav);
  assert.equal(f.calls.find(c => c.url === '/storage').headers['x-api-key'], undefined);
  assert.equal(f.calls.find(c => c.url === '/bundle').headers['x-api-key'], undefined);
  assert.equal(f.calls.find(c => c.url === '/storage-bundle').headers['x-api-key'], undefined);
  const result = await fetch(`${f.origin}/api/audio/${initial.id}`); const publicData = await result.json();
  assert.equal(publicData.source, undefined); assert.equal(JSON.stringify(publicData).includes('test-only-key'), false);
  const range = await fetch(`${f.origin}${publicData.mediaUrl}`, { headers: { range: 'bytes=0-11' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-type'), 'audio/mp4');
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), isoMedia.subarray(0, 12));
});
test('rejects forged cross-origin upload before processing', async t => {
  const f = await fixture(t); assert.equal((await f.upload(wav, 'https://untrusted.example')).status, 403); assert.equal(f.calls.length, 0);
});
test('rejects renamed text masquerading as WAV', async t => {
  const f = await fixture(t); assert.equal((await f.upload(Buffer.from('not audio at all'))).status, 400); assert.equal(f.calls.length, 0);
});
test('failed remote job never becomes playable', async t => {
  const f = await fixture(t, { status: 'FAILED' }); const { id } = await (await f.upload()).json();
  assert.equal((await f.settled(id)).status, 'failed'); assert.equal((await fetch(`${f.origin}/api/audio/${id}/media`)).status, 409);
  assert.equal(f.calls.some(c => c.url === '/bundle'), false);
});
test('checks advertised SHA-256 before publishing the output', async t => {
  const f = await fixture(t, { badHash: true }); const { id } = await (await f.upload()).json();
  assert.equal((await f.settled(id)).status, 'failed');
  await assert.rejects(readFile(path.join(f.root, id, 'result.m4a')), { code: 'ENOENT' });
});
test('restart resumes a stored remote job without another upload or submission', async t => {
  const f = await fixture(t); const id = randomUUID();
  await f.worker.save({ id, name: 'bunny.wav', source: 'gs://test-bucket/source.wav', jobId: 'job_fixture', status: 'processing', sourceBytes: 24, createdAt: new Date().toISOString() });
  const resumed = new AudioPipeline(f.media, f.root, { allowLoopback: true }); await resumed.process(id);
  assert.equal((await resumed.load(id)).status, 'ready'); assert.equal(f.calls.some(c => c.method === 'POST' || c.method === 'PUT'), false);
});
test('restart after source persistence uses the original source and stable idempotency key', async t => {
  const f = await fixture(t); const id = randomUUID();
  await f.worker.save({ id, name: 'bunny.wav', source: 'gs://test-bucket/source.wav', status: 'submitting', sourceBytes: 24, createdAt: new Date().toISOString() });
  await f.worker.process(id); assert.equal((await f.worker.load(id)).status, 'ready');
  assert.equal(f.calls.some(c => c.url === '/v1/upload-url'), false);
  assert.equal(f.calls.find(c => c.url === '/v1/jobs').headers['idempotency-key'], `node-audio:${id}`);
});
test('unsafe ZIP paths and missing M4A are rejected without output publication', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zip-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['../escape.m4a', 'report.json']) {
    const archive = path.join(root, 'bundle.zip'); await writeFile(archive, zipFile(name));
    await assert.rejects(saveM4a(archive, path.join(root, 'result.m4a')));
  }
  await assert.rejects(readFile(path.join(root, 'result.m4a')), { code: 'ENOENT' });
});

test('HEAD and unsatisfiable ranges support reliable native playback', async t => {
 const f=await fixture(t); const {id}=await (await f.upload()).json();await f.settled(id);
 const url=`${f.origin}/api/audio/${id}/media`;
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),isoMedia.length);assert.equal((await head.arrayBuffer()).byteLength,0);
 const invalid=await fetch(url,{headers:{range:'bytes=999999-'}});assert.equal(invalid.status,416);
 const download=await fetch(url+'?download=1');assert.match(download.headers.get('content-disposition'),/attachment.*result.m4a/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),isoMedia);
});
test('invalid M4A container never gets published', async t => {
 const root=await mkdtemp(path.join(os.tmpdir(),'m4a-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'bundle.zip'),zipFile('audio.m4a',Buffer.from('not audio')));
 await assert.rejects(saveM4a(path.join(root,'bundle.zip'),path.join(root,'result.m4a')));
 await assert.rejects(readFile(path.join(root,'result.m4a')),{code:'ENOENT'});
});
