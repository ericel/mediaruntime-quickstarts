import {randomUUID} from 'node:crypto';
import {mkdir,copyFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {config} from '../src/config.mjs';
import {isWav} from '../src/bundle.mjs';
const c=config();
try {
 if(process.argv[2]==='--resume') {
  const id=process.argv[3];if(!/^[0-9a-f-]{36}$/.test(id||''))throw Error('Pass a saved local UUID.');
  const row=await c.pool.query("UPDATE recordings SET state='queued',submit_attempts=0,submit_retry_at=now() WHERE id=$1 AND remote_job_id IS NULL RETURNING id",[id]);
  console.log(row.rowCount?'Queued the same submission identity.':'No unsubmitted record found; do not resubmit a completed job.');
 }else{
  const file=path.resolve(process.argv[2]||'');const info=await stat(file);
  if(!info.isFile()||info.size>20*1024*1024||!await isWav(file))throw Error('Choose one WAV up to 20 MB.');
  const id=randomUUID();await mkdir(path.join(c.root,id),{recursive:true,mode:0o700});await copyFile(file,path.join(c.root,id,'input.wav'));
  await c.pool.query("INSERT INTO recordings(id,name,state) VALUES($1,$2,'queued')",[id,path.basename(file).slice(0,120)]);
  console.log('Queued local recording:',id,'Start the worker to upload and submit it.');
 }
}catch(e){console.error(e.message);process.exitCode=1;}finally{await c.pool.end();}
