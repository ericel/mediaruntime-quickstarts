import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { MediaRuntime } from '@mediaruntime/node';
import { createApp, parseTimestamp } from '../src/server.mjs';
import { ThumbnailPipeline } from '../src/pipeline.mjs';
import { savePoster } from '../src/bundle.mjs';

// Deliberately tiny container fixture, not playable footage. Live browser validation is separate.
const mp4 = Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwClRRRX1555/9k=', 'base64');
function zipFile(name, data = jpeg) {
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
  const archive = zipFile('poster/frame.jpg'); let polls = 0;
  const provider = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks); calls.push({ method: req.method, url: req.url, headers: req.headers, bytes });
    res.setHeader('content-type', 'application/json');
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
    const form = new FormData(); form.append('timestamp', '1.5'); form.append('video', new Blob([data], { type: 'video/mp4' }), 'bunny.mp4');
    return fetch(`${origin}/api/thumbnails`, { method: 'POST', headers: { origin: header }, body: form });
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

test('real SDK: multipart upload → async job → canonical ZIP → saved JPEG and download', async t => {
  const f = await fixture(t); const response = await f.upload(); assert.equal(response.status, 202);
  const initial = await response.json(); const record = await f.settled(initial.id); assert.equal(record.status, 'ready');
  const submission = f.calls.find(c => c.url === '/v1/jobs'); const payload = JSON.parse(submission.bytes);
  assert.equal(payload.source, 'gs://test-bucket/source.mp4'); assert.deepEqual(payload.outputs, [{type: 'mp4', preset: 'poster_frame_v1', poster_time_sec: 1.5, poster_format: 'jpg'}]);
  assert.equal(payload.deliver_webhook, false); assert.equal(submission.headers['idempotency-key'], `node-poster:${initial.id}`);
  assert.deepEqual(f.calls.find(c => c.url === '/storage').bytes, mp4);
  assert.equal(f.calls.find(c => c.url === '/storage').headers['x-api-key'], undefined);
  assert.equal(f.calls.find(c => c.url === '/bundle').headers['x-api-key'], undefined);
  assert.equal(f.calls.find(c => c.url === '/storage-bundle').headers['x-api-key'], undefined);
  const result = await fetch(`${f.origin}/api/thumbnails/${initial.id}`); const publicData = await result.json();
  assert.equal(publicData.source, undefined); assert.equal(JSON.stringify(publicData).includes('test-only-key'), false);
  const image = await fetch(`${f.origin}${publicData.imageUrl}?download=1`);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.match(image.headers.get('content-disposition'), /attachment.*thumbnail.jpg/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);
  assert.equal(publicData.width, 8); assert.equal(publicData.height, 8);
});
test('rejects forged cross-origin upload before processing', async t => {
  const f = await fixture(t); assert.equal((await f.upload(mp4, 'https://untrusted.example')).status, 403); assert.equal(f.calls.length, 0);
});
test('rejects renamed text masquerading as MP4', async t => {
  const f = await fixture(t); assert.equal((await f.upload(Buffer.from('not a video at all'))).status, 400); assert.equal(f.calls.length, 0);
});
test('failed remote job never becomes playable', async t => {
  const f = await fixture(t, { status: 'FAILED' }); const { id } = await (await f.upload()).json();
  assert.equal((await f.settled(id)).status, 'failed'); assert.equal((await fetch(`${f.origin}/api/thumbnails/${id}/image`)).status, 409);
  assert.equal(f.calls.some(c => c.url === '/bundle'), false);
});
test('checks advertised SHA-256 before publishing the output', async t => {
  const f = await fixture(t, { badHash: true }); const { id } = await (await f.upload()).json();
  assert.equal((await f.settled(id)).status, 'failed');
  await assert.rejects(readFile(path.join(f.root, id, 'thumbnail.jpg')), { code: 'ENOENT' });
});
test('restart resumes a stored remote job without another upload or submission', async t => {
  const f = await fixture(t); const id = randomUUID();
  await f.worker.save({ id, name: 'bunny.mp4', source: 'gs://test-bucket/source.mp4', jobId: 'job_fixture', status: 'processing', sourceBytes: 24, timestamp: 1.5, createdAt: new Date().toISOString() });
  const resumed = new ThumbnailPipeline(f.media, f.root, { allowLoopback: true }); await resumed.process(id);
  assert.equal((await resumed.load(id)).status, 'ready'); assert.equal(f.calls.some(c => c.method === 'POST' || c.method === 'PUT'), false);
});
test('restart after source persistence uses the original source and stable idempotency key', async t => {
  const f = await fixture(t); const id = randomUUID();
  await f.worker.save({ id, name: 'bunny.mp4', source: 'gs://test-bucket/source.mp4', status: 'submitting', sourceBytes: 24, timestamp: 1.5, createdAt: new Date().toISOString() });
  await f.worker.process(id); assert.equal((await f.worker.load(id)).status, 'ready');
  assert.equal(f.calls.some(c => c.url === '/v1/upload-url'), false);
  assert.equal(f.calls.find(c => c.url === '/v1/jobs').headers['idempotency-key'], `node-poster:${id}`);
});
test('unsafe ZIP paths and missing JPEG are rejected without output publication', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zip-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['../escape.jpg', 'report.json']) {
    const archive = path.join(root, 'bundle.zip'); await writeFile(archive, zipFile(name));
    await assert.rejects(savePoster(archive, path.join(root, 'thumbnail.jpg')));
  }
  await assert.rejects(readFile(path.join(root, 'thumbnail.jpg')), { code: 'ENOENT' });
});

test('timestamp parsing rejects ambiguous, missing and out-of-range input', () => {
  for (const value of [undefined, null, '', '-1', '601', '1e2', 'NaN', ' 1', '1.0001', ['1','2']]) assert.equal(parseTimestamp(value), null);
  for (const value of ['0', '1.5', '600']) assert.equal(parseTimestamp(value), Number(value));
});
test('invalid JPEG is rejected before publication', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jpeg-test-')); t.after(() => rm(root, {recursive:true,force:true}));
  await writeFile(path.join(root,'bundle.zip'), zipFile('frame.jpg', Buffer.from('not a JPEG')));
  await assert.rejects(savePoster(path.join(root,'bundle.zip'), path.join(root,'thumbnail.jpg')));
  await assert.rejects(readFile(path.join(root,'thumbnail.jpg')), {code:'ENOENT'});
});
