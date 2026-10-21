import express from 'express';
import multer from 'multer';
import { MediaRuntime } from '@mediaruntime/node';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioPipeline } from './pipeline.mjs';
import { isWav } from './bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export async function createApp({ media, root, origin, allowLoopback = false }) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const incoming = path.join(root, 'incoming'); await mkdir(incoming, { recursive: true, mode: 0o700 });
  const worker = new AudioPipeline(media, root, { allowLoopback });
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    // Local single-user demo: reject foreign Host/Origin values, including DNS rebinding.
    if (req.headers.host !== new URL(origin).host) return res.status(403).json({ error: 'Use the local application URL.' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin !== origin)
      return res.status(403).json({ error: 'Open the upload form in this application.' });
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    next();
  });
  const upload = multer({ dest: incoming, limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 },
    fileFilter(_req, file, callback) {
      callback(null, ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'application/octet-stream'].includes(file.mimetype) && /\.wav$/i.test(file.originalname));
    }});
  app.post('/api/audio', upload.single('audio'), async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'Choose one WAV audio, up to 20 MB.' });
    try {
      if (!await isWav(req.file.path)) return res.status(400).json({ error: 'This file is not an RIFF/WAVE container.' });
      if ((await worker.list()).filter(r => !['ready', 'failed'].includes(r.status)).length >= 3)
        return res.status(429).json({ error: 'Please wait for the current uploads to finish.' });
      const id = randomUUID(); const directory = worker.directory(id);
      await mkdir(directory, { mode: 0o700 });
      await rename(req.file.path, path.join(directory, 'input.wav'));
      const record = { id, name: path.basename(req.file.originalname).slice(0, 120), status: 'queued',
        sourceBytes: req.file.size, createdAt: new Date().toISOString() };
      await worker.save(record);
      res.status(202).json(worker.publicRecord(record));
      worker.enqueue(id);
    } catch (error) { next(error); }
    finally { await rm(req.file.path, { force: true }); }
  });
  app.get('/api/audio', async (_req, res) => res.json((await worker.list()).map(r => worker.publicRecord(r))));
  app.get('/api/audio/:id', async (req, res) => {
    try { res.json(worker.publicRecord(await worker.load(req.params.id))); }
    catch { res.status(404).json({ error: 'Audio not found.' }); }
  });
  app.get('/api/audio/:id/media', async (req, res) => {
    try {
      const record = await worker.load(req.params.id);
      if (record.status !== 'ready') return res.status(409).json({ error: 'The saved audio is not ready yet.' });
      if (req.query.download === '1') res.attachment('result.m4a');
      res.type('audio/mp4').sendFile(path.join(worker.directory(record.id), 'result.m4a'));
    } catch { res.status(404).json({ error: 'Audio not found.' }); }
  });
  app.use(express.static(path.join(here, '../public')));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return _next(error);
    if (error.status === 416) {
      if (error.headers) res.set(error.headers);
      return res.status(416).end();
    }
    res.status(error instanceof multer.MulterError ? 400 : 500).json({ error:
      error instanceof multer.MulterError ? 'Upload rejected. Choose one WAV, up to 20 MB.' : 'The local server could not complete this request.' });
  });
  return { app, worker };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.MEDIARUNTIME_API_KEY) throw new Error('Set MEDIARUNTIME_API_KEY in .env.');
  process.umask(0o077);
  const port = Number(process.env.PORT || 3000);
  const origin = `http://127.0.0.1:${port}`;
  const root = path.resolve(process.env.MEDIA_ROOT || './var/media');
  const media = new MediaRuntime({ apiKey: process.env.MEDIARUNTIME_API_KEY });
  const { app, worker } = await createApp({ media, root, origin });
  app.listen(port, '127.0.0.1', () => {
    console.log(`Node.js audio tutorial: ${origin}`);
    worker.recover().catch(() => console.error('Could not recover saved records. Check local storage.'));
  });
}
