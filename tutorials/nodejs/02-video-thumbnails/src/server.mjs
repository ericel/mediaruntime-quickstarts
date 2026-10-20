import express from 'express';
import multer from 'multer';
import { MediaRuntime } from '@mediaruntime/node';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ThumbnailPipeline } from './pipeline.mjs';
import { isMp4 } from './bundle.mjs';

export function parseTimestamp(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.\d{1,3})?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 600 ? number : null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export async function createApp({ media, root, origin, allowLoopback = false }) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const incoming = path.join(root, 'incoming'); await mkdir(incoming, { recursive: true, mode: 0o700 });
  const worker = new ThumbnailPipeline(media, root, { allowLoopback });
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
  const upload = multer({ dest: incoming, limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 1, fieldSize: 32 },
    fileFilter(_req, file, callback) {
      callback(null, file.mimetype === 'video/mp4' && /\.mp4$/i.test(file.originalname));
    }});
  app.post('/api/thumbnails', upload.single('video'), async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'Choose one MP4 video, up to 20 MB.' });
    try {
      const timestamp = parseTimestamp(req.body?.timestamp);
      if (timestamp === null) return res.status(400).json({ error: 'Choose a timestamp from 0 to 600 seconds, with up to three decimal places.' });
      if (!await isMp4(req.file.path)) return res.status(400).json({ error: 'This file is not an MP4 container.' });
      if ((await worker.list()).filter(r => !['ready', 'failed'].includes(r.status)).length >= 3)
        return res.status(429).json({ error: 'Please wait for the current uploads to finish.' });
      const id = randomUUID(); const directory = worker.directory(id);
      await mkdir(directory, { mode: 0o700 });
      await rename(req.file.path, path.join(directory, 'input.mp4'));
      const record = { id, name: path.basename(req.file.originalname).slice(0, 120), status: 'queued',
        sourceBytes: req.file.size, timestamp, createdAt: new Date().toISOString() };
      await worker.save(record);
      res.status(202).json(worker.publicRecord(record));
      worker.enqueue(id);
    } catch (error) { next(error); }
    finally { await rm(req.file.path, { force: true }); }
  });
  app.get('/api/thumbnails', async (_req, res) => res.json((await worker.list()).map(r => worker.publicRecord(r))));
  app.get('/api/thumbnails/:id', async (req, res) => {
    try { res.json(worker.publicRecord(await worker.load(req.params.id))); }
    catch { res.status(404).json({ error: 'Thumbnail not found.' }); }
  });
  app.get('/api/thumbnails/:id/image', async (req, res) => {
    try {
      const record = await worker.load(req.params.id);
      if (record.status !== 'ready') return res.status(409).json({ error: 'The saved thumbnail is not ready yet.' });
      if (req.query.download === '1') res.attachment('thumbnail.jpg');
      res.type('image/jpeg').sendFile(path.join(worker.directory(record.id), 'thumbnail.jpg'));
    } catch { res.status(404).json({ error: 'Thumbnail not found.' }); }
  });
  app.use(express.static(path.join(here, '../public')));
  app.use((error, _req, res, _next) => {
    res.status(error instanceof multer.MulterError ? 400 : 500).json({ error:
      error instanceof multer.MulterError ? 'Upload rejected. Choose one MP4, up to 20 MB.' : 'The local server could not complete this request.' });
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
    console.log(`Node.js thumbnail tutorial: ${origin}`);
    worker.recover().catch(() => console.error('Could not recover saved records. Check local storage.'));
  });
}
