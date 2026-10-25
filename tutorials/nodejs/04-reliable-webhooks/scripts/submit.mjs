import {randomUUID} from 'node:crypto';
import {copyFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {config} from '../src/config.mjs';
const c=config(),db=await c.pool.connect();
let id=process.argv[2]==='--resume'?process.argv[3]:randomUUID();
try {
 if(!/^[0-9a-f-]{36}$/.test(id||''))throw Error('Pass an MP4 path or --resume <local UUID>.');
 await db.query('SELECT pg_advisory_lock(hashtext($1))',[id]);
 if(process.argv[2]!=='--resume') {
  const input=path.resolve(process.argv[2]||'');const info=await stat(input);
  if(!info.isFile()||!input.toLowerCase().endsWith('.mp4')||info.size>50*1024*1024)throw Error('Choose one MP4 up to 50 MB.');
  await mkdir(path.join(c.root,id),{recursive:true,mode:0o700});
  await copyFile(input,path.join(c.root,id,'input.mp4'));
  await db.query('INSERT INTO videos(id,name) VALUES($1,$2)',[id,path.basename(input)]);
 }
 const row=(await db.query('SELECT * FROM videos WHERE id=$1',[id])).rows[0];
 if(!row)throw Error('No local job record.');
 if(row.remote_job_id){console.log('Already submitted. Local ID:',id);}
 else {
  console.log('Local ID:',id,'— save this ID to resume after an interruption.');
  if(!row.source_uri){const up=await c.media.uploads.uploadFile(path.join(c.root,id,'input.mp4'),{contentType:'video/mp4'});row.source_uri=up.fileUri;await db.query('UPDATE videos SET source_uri=$2 WHERE id=$1',[id,row.source_uri]);}
  const job=await c.media.jobs.create({source:row.source_uri,outputs:['video.web'],deliverWebhook:true,
    metadata:{tutorial:'node-webhooks',local_id:id},idempotencyKey:`node-webhook:${id}`});
  await db.query("UPDATE videos SET remote_job_id=$2,state='processing' WHERE id=$1",[id,job.id]);
  console.log('Submitted:',job.id,'— waiting for a signed account webhook.');
 }
} catch(error){console.error('Submission failed:',error.name,'Resume ID:',id);process.exitCode=1;}
finally {await db.query('SELECT pg_advisory_unlock(hashtext($1))',[id]).catch(()=>{});db.release();await c.pool.end();}
