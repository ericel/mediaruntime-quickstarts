import express from 'express';
import multer from 'multer';
import { MediaRuntime } from '@mediaruntime/node';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VideoPipeline } from './pipeline.mjs';
import { isMp4 } from './bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export async function createApp({ media, root, origin, allowLoopback = false }) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const incoming = path.join(root, 'incoming'); await mkdir(incoming, { recursive: true, mode: 0o700 });
  const worker = new VideoPipeline(media, root, { allowLoopback });
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    // Local single-user demo: reject foreign Host/Origin values, including DNS rebinding.
    if (req.headers.host !== new URL(origin).host) return res.status(403).json({ error: 'Use the local application URL.' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin !== origin)
      return res.status(403).json({ error: 'Open the upload form in this application.' });
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    next();
  });
  // This is an explicit account-wide mutation. No video upload changes the logo.
  let configuringLogo = false;
  const logoUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1,fields:4}});
  app.get('/api/watermark', async (_req,res) => {
    try { res.json(JSON.parse(await readFile(path.join(root,'watermark-settings.json'),'utf8'))); }
    catch { res.json({configured:false}); }
  });
  app.get('/api/watermark/image', (_req,res) => res.type('png').sendFile(path.join(root,'watermark.png')));
  app.post('/api/watermark', logoUpload.single('logo'), async (req,res,next) => {
    const b=req.file?.buffer; const {position,opacity,scale,confirm}=req.body||{};
    if(confirm!=='replace' || !['bottom_right','bottom_left','top_right','top_left','center'].includes(position) ||
       !/^\d{1,3}$/.test(opacity||'') || !/^\d{1,3}$/.test(scale||'') || Number(opacity)<1 || Number(opacity)>100 || Number(scale)<1 || Number(scale)>100 ||
       !b || b.length<33 || !b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) || b.toString('ascii',12,16)!=='IHDR' ||
       !b.readUInt32BE(16) || !b.readUInt32BE(20) || b.readUInt32BE(16)>4096 || b.readUInt32BE(20)>4096)
      return res.status(400).json({error:'Choose a PNG up to 2 MB / 4096 pixels, valid settings, and confirm the account-wide replacement.'});
    if(configuringLogo) return res.status(409).json({error:'A logo update is already running.'});
    if((await worker.list()).some(r=>!['ready','failed'].includes(r.status)))
      return res.status(409).json({error:'Wait for this demo’s active video jobs before changing its account logo.'});
    configuringLogo=true;
    const temp=path.join(root,'watermark-upload.png');
    try {
      await writeFile(temp,b,{mode:0o600});
      const logo=await media.watermarkLogo.upload(temp,{position,opacityPct:Number(opacity),scalePct:Number(scale)});
      await rename(temp,path.join(root,'watermark.png'));
      const settings={configured:true,position:logo.position,opacityPct:logo.opacityPct,scalePct:logo.scalePct,savedAt:new Date().toISOString()};
      await writeFile(path.join(root,'watermark-settings.tmp'),JSON.stringify(settings),{mode:0o600});
      await rename(path.join(root,'watermark-settings.tmp'),path.join(root,'watermark-settings.json'));
      res.json(settings);
    } catch { res.status(502).json({error:'Could not finish saving the account logo. Check your account settings before retrying.'}); }
    finally { configuringLogo=false;await rm(temp,{force:true}); }
  });
  const upload = multer({ dest: incoming, limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 },
    fileFilter(_req, file, callback) {
      callback(null, file.mimetype === 'video/mp4' && /\.mp4$/i.test(file.originalname));
    }});
  app.post('/api/videos', upload.single('video'), async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'Choose one MP4 video, up to 20 MB.' });
    try {
      if (configuringLogo) return res.status(409).json({error:'Wait for the logo update to finish.'});
      if (!await isMp4(req.file.path)) return res.status(400).json({ error: 'This file is not an MP4 container.' });
      if ((await worker.list()).filter(r => !['ready', 'failed'].includes(r.status)).length >= 3)
        return res.status(429).json({ error: 'Please wait for the current uploads to finish.' });
      const id = randomUUID(); const directory = worker.directory(id);
      await mkdir(directory, { mode: 0o700 });
      await rename(req.file.path, path.join(directory, 'input.mp4'));
      const record = { id, name: path.basename(req.file.originalname).slice(0, 120), status: 'queued',
        sourceBytes: req.file.size, createdAt: new Date().toISOString() };
      await worker.save(record);
      res.status(202).json(worker.publicRecord(record));
      worker.enqueue(id);
    } catch (error) { next(error); }
    finally { await rm(req.file.path, { force: true }); }
  });
  app.get('/api/videos', async (_req, res) => res.json((await worker.list()).map(r => worker.publicRecord(r))));
  app.get('/api/videos/:id', async (req, res) => {
    try { res.json(worker.publicRecord(await worker.load(req.params.id))); }
    catch { res.status(404).json({ error: 'Video not found.' }); }
  });
  app.get('/api/videos/:id/source', async (req, res) => {
    try { const record = await worker.load(req.params.id); res.type('video/mp4').sendFile(path.join(worker.directory(record.id), 'input.mp4')); }
    catch { res.status(404).json({ error: 'Video not found.' }); }
  });
  app.get('/api/videos/:id/media', async (req, res) => {
    try {
      const record = await worker.load(req.params.id);
      if (record.status !== 'ready') return res.status(409).json({ error: 'The saved video is not ready yet.' });
      // Express supports Range requests for browser playback and seeking.
      res.type('video/mp4').sendFile(path.join(worker.directory(record.id), 'result.mp4'));
    } catch { res.status(404).json({ error: 'Video not found.' }); }
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
    console.log(`Node.js watermark tutorial: ${origin}`);
    worker.recover().catch(() => console.error('Could not recover saved records. Check local storage.'));
  });
}
