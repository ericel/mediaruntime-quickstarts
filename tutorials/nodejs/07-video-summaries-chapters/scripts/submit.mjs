import {randomUUID} from 'node:crypto';
import {mkdir,copyFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {config} from '../src/config.mjs';
import {inspectVideo} from '../src/video.mjs';
const c=config();
try {
 if(process.argv[2]==='--resume') {
  const id=process.argv[3];if(!/^[0-9a-f-]{36}$/.test(id||''))throw Error('Pass a saved local UUID.');
  const row=await c.pool.query("UPDATE recordings SET state='queued',submit_attempts=0,submit_retry_at=now() WHERE id=$1 AND remote_job_id IS NULL RETURNING id",[id]);
  console.log(row.rowCount?'Queued the same submission identity.':'No unsubmitted record found; do not resubmit a completed job.');
 }else{
  const file=path.resolve(process.argv[2]||'');const info=await stat(file);
  if(!info.isFile()||info.size>100*1024*1024)throw Error('Choose one MP4 up to 100 MB.');
  const duration=await inspectVideo(file);
  const id=randomUUID();await mkdir(path.join(c.root,id),{recursive:true,mode:0o700});await copyFile(file,path.join(c.root,id,'input.mp4'));
  await c.pool.query("INSERT INTO recordings(id,name,state,duration) VALUES($1,$2,'queued',$3)",[id,path.basename(file).slice(0,120),duration]);
  console.log('Queued local recording:',id,'Start the worker to upload and submit it.');
 }
}catch(e){console.error(e.message);process.exitCode=1;}finally{await c.pool.end();}
