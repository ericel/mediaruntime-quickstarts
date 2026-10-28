import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { MediaRuntime } from '@mediaruntime/node';
import { createApp } from '../src/server.mjs';
import { VideoPipeline } from '../src/pipeline.mjs';
import { saveMp4 } from '../src/bundle.mjs';

// Deliberately tiny container fixture, not playable footage. Live browser validation is separate.
const mp4 = Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex');
function zipFile(name, data = mp4) {
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'node-video-test-')); const calls = [];
  const archive = zipFile('video/output.mp4'); let polls = 0;
  const provider = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks); calls.push({ method: req.method, url: req.url, headers: req.headers, bytes });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/account/watermark-logo/upload-url') return res.end(JSON.stringify({upload_url:base+'/logo-storage',file_uri:'gs://test-bucket/account-assets/logo.png',upload_headers:{'Content-Type':'image/png'}}));
    if (req.url === '/logo-storage') return res.end();
    if (req.url === '/v1/account/watermark-logo/confirm') { const p=JSON.parse(bytes); return res.end(JSON.stringify({logo_url:p.file_uri,position:p.position,opacity_pct:p.opacity_pct,scale_pct:p.scale_pct})); }
    if (req.url === '/v1/upload-url') return res.end(JSON.stringify({ upload_url: `${base}/storage`, file_uri: 'gs://test-bucket/source.mp4', upload_headers: { 'Content-Type': 'video/mp4' } }));
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
  const upload = async (data = mp4, header = origin) => {
    const form = new FormData(); form.append('video', new Blob([data], { type: 'video/mp4' }), 'bunny.mp4');
    return fetch(`${origin}/api/videos`, { method: 'POST', headers: { origin: header }, body: form });
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

test('real SDK: multipart upload → async job → canonical ZIP → saved MP4 and Range playback', async t => {
  const f = await fixture(t); const response = await f.upload(); assert.equal(response.status, 202);
  const initial = await response.json(); const record = await f.settled(initial.id); assert.equal(record.status, 'ready');
  const submission = f.calls.find(c => c.url === '/v1/jobs'); const payload = JSON.parse(submission.bytes);
  assert.equal(payload.source, 'gs://test-bucket/source.mp4'); assert.deepEqual(payload.outputs, ['video.web']);
  assert.deepEqual(payload.watermark,{enabled:true}); assert.equal(payload.deliver_webhook, false); assert.equal(submission.headers['idempotency-key'], `node-watermark:${initial.id}`);
  assert.deepEqual(f.calls.find(c => c.url === '/storage').bytes, mp4);
  assert.equal(f.calls.find(c => c.url === '/storage').headers['x-api-key'], undefined);
  assert.equal(f.calls.find(c => c.url === '/bundle').headers['x-api-key'], undefined);
  assert.equal(f.calls.find(c => c.url === '/storage-bundle').headers['x-api-key'], undefined);
  const result = await fetch(`${f.origin}/api/videos/${initial.id}`); const publicData = await result.json();
  assert.equal(publicData.source, undefined); assert.equal(JSON.stringify(publicData).includes('test-only-key'), false);
  const range = await fetch(`${f.origin}${publicData.mediaUrl}`, { headers: { range: 'bytes=0-11' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), mp4.subarray(0, 12));
});
test('rejects forged cross-origin upload before processing', async t => {
  const f = await fixture(t); assert.equal((await f.upload(mp4, 'https://untrusted.example')).status, 403); assert.equal(f.calls.length, 0);
});
test('rejects renamed text masquerading as MP4', async t => {
  const f = await fixture(t); assert.equal((await f.upload(Buffer.from('not a video at all'))).status, 400); assert.equal(f.calls.length, 0);
});
test('failed remote job never becomes playable', async t => {
  const f = await fixture(t, { status: 'FAILED' }); const { id } = await (await f.upload()).json();
  assert.equal((await f.settled(id)).status, 'failed'); assert.equal((await fetch(`${f.origin}/api/videos/${id}/media`)).status, 409);
  assert.equal(f.calls.some(c => c.url === '/bundle'), false);
});
test('checks advertised SHA-256 before publishing the output', async t => {
  const f = await fixture(t, { badHash: true }); const { id } = await (await f.upload()).json();
  assert.equal((await f.settled(id)).status, 'failed');
  await assert.rejects(readFile(path.join(f.root, id, 'result.mp4')), { code: 'ENOENT' });
});
test('restart resumes a stored remote job without another upload or submission', async t => {
  const f = await fixture(t); const id = randomUUID();
  await f.worker.save({ id, name: 'bunny.mp4', source: 'gs://test-bucket/source.mp4', jobId: 'job_fixture', status: 'processing', sourceBytes: 24, createdAt: new Date().toISOString() });
  const resumed = new VideoPipeline(f.media, f.root, { allowLoopback: true }); await resumed.process(id);
  assert.equal((await resumed.load(id)).status, 'ready'); assert.equal(f.calls.some(c => c.method === 'POST' || c.method === 'PUT'), false);
});
test('restart after source persistence uses the original source and stable idempotency key', async t => {
  const f = await fixture(t); const id = randomUUID();
  await f.worker.save({ id, name: 'bunny.mp4', source: 'gs://test-bucket/source.mp4', status: 'submitting', sourceBytes: 24, createdAt: new Date().toISOString() });
  await f.worker.process(id); assert.equal((await f.worker.load(id)).status, 'ready');
  assert.equal(f.calls.some(c => c.url === '/v1/upload-url'), false);
  assert.equal(f.calls.find(c => c.url === '/v1/jobs').headers['idempotency-key'], `node-watermark:${id}`);
});
test('unsafe ZIP paths and missing MP4 are rejected without output publication', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zip-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['../escape.mp4', 'report.json']) {
    const archive = path.join(root, 'bundle.zip'); await writeFile(archive, zipFile(name));
    await assert.rejects(saveMp4(archive, path.join(root, 'result.mp4')));
  }
  await assert.rejects(readFile(path.join(root, 'result.mp4')), { code: 'ENOENT' });
});

test('logo form uses SDK upload and confirmation, saves settings without leaking asset URI',async t=>{
 const f=await fixture(t);const png=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.write('IHDR',12);png.writeUInt32BE(640,16);png.writeUInt32BE(136,20);
 const form=new FormData();form.append('logo',new Blob([png],{type:'image/png'}),'logo.png');for(const [k,v] of Object.entries({position:'bottom_right',opacity:'90',scale:'24',confirm:'replace'}))form.append(k,v);
 const response=await fetch(f.origin+'/api/watermark',{method:'POST',headers:{origin:f.origin},body:form});assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.scalePct,24);assert.equal(saved.logoUrl,undefined);
 const confirmation=f.calls.find(c=>c.url==='/v1/account/watermark-logo/confirm');assert.deepEqual(JSON.parse(confirmation.bytes),{file_uri:'gs://test-bucket/account-assets/logo.png',position:'bottom_right',opacity_pct:90,scale_pct:24});
 assert.equal(f.calls.find(c=>c.url==='/logo-storage').headers['x-api-key'],undefined);
 assert.equal((await (await fetch(f.origin+'/api/watermark')).json()).configured,true);
});
test('invalid PNG/settings or missing replacement confirmation never call the provider',async t=>{
 const f=await fixture(t);const form=new FormData();form.append('logo',new Blob(['not png']),'logo.png');form.append('position','bottom_right');form.append('opacity','101');form.append('scale','24');
 assert.equal((await fetch(f.origin+'/api/watermark',{method:'POST',headers:{origin:f.origin},body:form})).status,400);assert.equal(f.calls.length,0);
});
