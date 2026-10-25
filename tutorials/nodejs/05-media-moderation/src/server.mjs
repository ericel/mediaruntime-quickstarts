import express from 'express';
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
  const app=express(); app.disable('x-powered-by');
  app.use((req,res,next)=>{
    if (![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)) return res.sendStatus(403);
    res.set('Cache-Control','no-store'); next();
  });
  app.get('/api/state',async (_req,res)=>{
    const videos=await pool.query('SELECT id,name,remote_job_id,state,output_bytes,completion_count,created_at,saved_at,moderation,policy_state,policy_reason,publication FROM videos ORDER BY created_at DESC LIMIT 10');
    const inbox=await pool.query('SELECT event_id,job_id,status,state,deliveries,attempts,last_error,next_attempt_at,processed_at FROM webhook_inbox ORDER BY received_at DESC LIMIT 20');
    const log=await pool.query('SELECT kind,detail,at FROM pipeline_log ORDER BY id DESC LIMIT 12');
    const reviews=await pool.query('SELECT video_id,action,reason,at FROM review_actions ORDER BY id DESC LIMIT 20');
    res.json({videos:videos.rows,inbox:inbox.rows,log:log.rows,reviews:reviews.rows});
  });
  app.get('/media/:id',async (req,res)=>{
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.sendStatus(404);
    const row=await pool.query("SELECT id FROM videos WHERE id=$1 AND state='ready'",[req.params.id]);
    if (!row.rowCount) return res.sendStatus(404);
    if (req.query.download==='1') res.attachment('result.mp4');
    res.type('video/mp4').sendFile(path.join(root,req.params.id,'result.mp4'));
  });
  // Reviewer UI is loopback-only. Add real auth/roles before production deployment.
  app.post('/api/review/:id', express.json({limit:'4kb'}), async(req,res)=>{
    const origin=req.headers.origin;
    if (origin !== `http://${req.headers.host}`) return res.sendStatus(403);
    const {action,reason}=req.body || {};
    if (!/^[0-9a-f-]{36}$/.test(req.params.id) || !['approve','reject','hold'].includes(action)
        || typeof reason !== 'string' || reason.trim().length<8 || reason.length>1000) return res.sendStatus(400);
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      const found=await db.query('SELECT * FROM videos WHERE id=$1 FOR UPDATE',[req.params.id]);
      const row=found.rows[0];
      if (!row || row.state!=='ready') {await db.query('ROLLBACK');return res.sendStatus(409);}
      // This demo intentionally forbids overriding model review/block in one click.
      if (action==='approve' && row.policy_state!=='eligible') {await db.query('ROLLBACK');return res.status(409).json({error:'Resolve the moderation hold through a separate review/appeal workflow.'});}
      const publication={approve:'published',reject:'rejected',hold:'private'}[action];
      await db.query('UPDATE videos SET publication=$2 WHERE id=$1',[row.id,publication]);
      await db.query('INSERT INTO review_actions(video_id,action,reason) VALUES($1,$2,$3)',[row.id,action,reason.trim()]);
      await db.query('COMMIT');res.json({publication});
    } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
  });
  app.get('/published/:id',async(req,res)=>{
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.sendStatus(404);
    const row=await pool.query("SELECT id FROM videos WHERE id=$1 AND state='ready' AND policy_state='eligible' AND publication='published'",[req.params.id]);
    if(!row.rowCount)return res.sendStatus(404);
    res.type('video/mp4').sendFile(path.join(root,req.params.id,'result.mp4'));
  });
  app.get('/report/:id',async(req,res)=>{
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.sendStatus(404);
    const row=await pool.query("SELECT moderation FROM videos WHERE id=$1 AND moderation IS NOT NULL",[req.params.id]);
    if(!row.rowCount)return res.sendStatus(404);
    res.attachment('moderation-summary.json').json(row.rows[0].moderation);
  });
  app.use(express.static(path.join(here,'../public')));
  app.use((_error,_req,res,_next)=>res.status(503).json({error:'Local database or storage unavailable.'}));
  return app;
}
if (process.argv[1]===fileURLToPath(import.meta.url)) {
  const c=config();
  const ui=createDashboard(c).listen(c.port,'127.0.0.1',()=>console.log(`Dashboard: http://127.0.0.1:${c.port}`));
  const receiver=createReceiver(c).listen(c.webhookPort,'127.0.0.1',()=>console.log(`Webhook listener on port ${c.webhookPort}`));
  const close=()=>{ui.close();receiver.close();void c.pool.end();};
  process.once('SIGINT',close);process.once('SIGTERM',close);
}
