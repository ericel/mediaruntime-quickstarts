import express from 'express';
import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {mkdir,rename,rm} from 'node:fs/promises';
import { inspectVideo } from './video.mjs';
import { validateDraft, youtubeIssues, youtubeText } from './chapters.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebhookVerificationError } from '@mediaruntime/node';
import { config } from './config.mjs';
import { acceptEvent } from './inbox.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export function createReceiver({pool,media,accountId}) {
  const receiver=express(); receiver.disable('x-powered-by');
  // This listener exposes ONLY the signed endpoint. Tunnel this port, never the dashboard.
  receiver.post('/webhooks/mediaruntime', express.raw({type:'application/json',limit:'256kb'}), async (req,res) => {
    if (!Buffer.isBuffer(req.body)) return res.sendStatus(415);
    let event;
    try { event=media.webhooks.verify(req.body,req.headers,{toleranceSeconds:300}); }
    catch (error) {
      if (!(error instanceof WebhookVerificationError)) return res.sendStatus(503);
      // Best-effort diagnostic; no bodies, signatures, or customer URLs in logs.
      await pool.query("INSERT INTO pipeline_log(kind,detail) VALUES('rejected','Invalid or stale signature — HTTP 401')").catch(()=>{});
      return res.sendStatus(401);
    }
    try { res.sendStatus(await acceptEvent(pool,event,accountId)); }
    catch { res.sendStatus(503); } // No durable commit => no acknowledgement.
  });
  receiver.use((error,_req,res,_next)=>res.sendStatus(error.type==='entity.too.large'?413:400));
  return receiver;
}
export function createDashboard({pool,root,port}) {
 const app=express();app.disable('x-powered-by');
 app.use((req,res,next)=>{
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return res.sendStatus(403);
  if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==`http://${req.headers.host}`)return res.sendStatus(403);
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});next();
 });
 const upload=multer({dest:path.join(root,'incoming'),limits:{fileSize:100*1024*1024,files:1,fields:0},
  fileFilter:(_req,file,cb)=>cb(null,/\.mp4$/i.test(file.originalname))});
 app.post('/api/recordings',upload.single('video'),async(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Choose one MP4, up to 100 MB.'});
  try{
   let duration;
   try { duration=await inspectVideo(req.file.path); } catch { return res.status(400).json({error:'Use an H.264/AAC MP4 with speech, up to 15 minutes.'}); }
   const active=await pool.query("SELECT count(*) FROM recordings WHERE state IN ('queued','submitting','processing')");
   if(Number(active.rows[0].count)>=3)return res.status(429).json({error:'Wait for current jobs to finish.'});
   const id=randomUUID();await mkdir(path.join(root,id),{recursive:true,mode:0o700});
   await rename(req.file.path,path.join(root,id,'input.mp4'));
   await pool.query("INSERT INTO recordings(id,name,state,duration) VALUES($1,$2,'queued',$3)",[id,path.basename(req.file.originalname).slice(0,120),duration]);
   res.status(202).json({id,state:'queued'});
  }finally{await rm(req.file.path,{force:true});}
 });
 app.get('/api/state',async(_req,res)=>{
  const recordings=await pool.query('SELECT id,name,remote_job_id,state,cues,output_bytes,completion_count,submit_error,created_at,duration,chapter_state,chapter_error,draft,provenance,revision,approved_at FROM recordings ORDER BY created_at DESC LIMIT 10');
  const inbox=await pool.query('SELECT event_id,state,deliveries,attempts,last_error FROM webhook_inbox ORDER BY received_at DESC LIMIT 10');
  res.json({recordings:recordings.rows,inbox:inbox.rows});
 });
 app.get('/files/:id/:kind',async(req,res)=>{
  if(!/^[0-9a-f-]{36}$/.test(req.params.id))return res.sendStatus(404);
  const files={video:['input.mp4','video/mp4'],audio:['result.m4a','audio/mp4'],srt:['transcript.srt','application/x-subrip'],vtt:['transcript.vtt','text/vtt'],text:['transcript.txt','text/plain']};
  const item=files[req.params.kind];if(!item)return res.sendStatus(404);
  const row=await pool.query("SELECT id FROM recordings WHERE id=$1 AND state='ready'",[req.params.id]);if(!row.rowCount)return res.sendStatus(404);
  if(req.query.download==='1')res.attachment(item[0]);res.type(item[1]).sendFile(path.join(root,req.params.id,item[0]));
 });

 app.use(express.json({limit:'32kb'}));
 app.param('id',(req,res,next)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(req.params.id)?next():res.sendStatus(404));
 app.post('/api/recordings/:id/retry',async(req,res)=>{
  const result=await pool.query("UPDATE recordings SET chapter_state='queued',chapter_attempts=0,chapter_retry_at=now(),chapter_error=NULL WHERE id=$1 AND state='ready' AND chapter_state='failed' RETURNING id",[req.params.id]);
  res.sendStatus(result.rowCount?202:409);
 });
 app.put('/api/recordings/:id/review',async(req,res)=>{
  const row=(await pool.query('SELECT * FROM recordings WHERE id=$1',[req.params.id])).rows[0];
  if(!row)return res.sendStatus(404);
  if(!['review','approved'].includes(row.chapter_state)||!Number.isInteger(req.body?.revision))return res.sendStatus(409);
  let draft;
  try { draft=validateDraft(req.body.draft,row.cues,row.duration); }
  catch(error){return res.status(400).json({error:error.message});}
  const issues=youtubeIssues(draft.chapters,row.duration);
  if(issues.length)return res.status(400).json({error:issues.join(' ')});
  const result=await pool.query(`UPDATE recordings SET draft=$2,chapter_state='approved',approved_at=now(),revision=revision+1
   WHERE id=$1 AND revision=$3 AND chapter_state IN ('review','approved') RETURNING revision`,[row.id,JSON.stringify(draft),req.body.revision]);
  if(!result.rowCount)return res.status(409).json({error:'This draft changed. Reload before reviewing again.'});
  res.json({revision:result.rows[0].revision});
 });
 app.get('/api/recordings/:id/export/:format',async(req,res)=>{
  const row=(await pool.query("SELECT * FROM recordings WHERE id=$1 AND chapter_state='approved'",[req.params.id])).rows[0];
  if(!row)return res.sendStatus(409);
  if(req.params.format==='txt')return res.attachment('youtube-chapters.txt').type('text/plain').send(youtubeText(row.draft));
  if(req.params.format==='json')return res.attachment('summary-chapters.json').json({summary:row.draft.summary,evidenceCueIds:row.draft.evidenceCueIds,chapters:row.draft.chapters,provenance:row.provenance,reviewedAt:row.approved_at});
  res.sendStatus(404);
 });
 app.use(express.static(path.join(here,'../public')));
 app.use((error,_req,res,next)=>{
  if(res.headersSent)return next(error);
  if(error.status===416){if(error.headers)res.set(error.headers);return res.sendStatus(416);}
  res.status(error instanceof multer.MulterError?400:503).json({error:error instanceof multer.MulterError?'Choose one MP4, up to 100 MB.':'Local database or storage unavailable.'});
 });
 return app;
}
if (process.argv[1]===fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const c=config();
  await mkdir(path.join(c.root,'incoming'),{recursive:true,mode:0o700});
  const ui=createDashboard(c).listen(c.port,'127.0.0.1',()=>console.log(`Dashboard: http://127.0.0.1:${c.port}`));
  const receiver=createReceiver(c).listen(c.webhookPort,'127.0.0.1',()=>console.log(`Webhook listener on port ${c.webhookPort}`));
  const close=()=>{ui.close();receiver.close();void c.pool.end();};
  process.once('SIGINT',close);process.once('SIGTERM',close);
}
