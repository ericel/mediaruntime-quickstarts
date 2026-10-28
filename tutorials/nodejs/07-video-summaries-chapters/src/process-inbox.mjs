import path from 'node:path';
import { mkdir, stat, readFile, writeFile, rename } from 'node:fs/promises';
import { downloadBundle, saveArtifact } from './bundle.mjs';
import { parseVtt } from './transcript.mjs';

export async function processOne({pool,media,root,failOnce,baseDelay=15,maxAttempts=5,saveResult}) {
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const selected=await db.query(`SELECT * FROM webhook_inbox WHERE state='pending'
      AND next_attempt_at<=now() ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1`);
    if (!selected.rowCount) { await db.query('COMMIT'); return false; }
    const event=selected.rows[0];
    await db.query('SAVEPOINT processing');
    try {
      // The per-job row lock also protects against two DIFFERENT event IDs for one job.
      const found=await db.query('SELECT * FROM recordings WHERE remote_job_id=$1 FOR UPDATE',[event.job_id]);
      if (!found.rowCount) throw new Error('Job mapping not available yet');
      const recording=found.rows[0];
      if (!['ready','failed'].includes(recording.state)) {
        if (failOnce?.()) throw new Error('Demo: simulated storage interruption');
        // Retrieve from the authenticated SDK; never fetch an arbitrary URL in the callback.
        const job=await media.jobs.get(event.job_id);
        if (!['COMPLETED','FAILED','REJECTED'].includes(job.status)) throw new Error('Job not terminal yet');
        if (job.status==='COMPLETED') {
          const directory=path.join(root,recording.id); await mkdir(directory,{recursive:true,mode:0o700});
          if (saveResult) await saveResult(job,directory); // Test seam; omitted by the application.
          else {
            if (!job.bundle.downloadUrl) throw new Error('Output bundle is not available');
            await downloadBundle(job.bundle,path.join(directory,'outputs.zip'));
            for (const [extension,name] of [['m4a','result.m4a'],['srt','transcript.srt'],['vtt','transcript.vtt']])
              await saveArtifact(path.join(directory,'outputs.zip'),path.join(directory,name),extension);
          }
          const cues=parseVtt(await readFile(path.join(directory,'transcript.vtt'),'utf8'));
          await writeFile(path.join(directory,'transcript.txt.part'),cues.map(c=>c.text).join('\n')+'\n',{mode:0o600});
          await rename(path.join(directory,'transcript.txt.part'),path.join(directory,'transcript.txt'));
          await db.query('UPDATE recordings SET cues=$2 WHERE id=$1',[recording.id,JSON.stringify(cues)]);
          const bytes=(await stat(path.join(directory,'result.m4a'))).size;
          await db.query("UPDATE recordings SET state='ready',chapter_state='queued',output_bytes=$2,saved_at=now(),completion_count=completion_count+1 WHERE id=$1",[recording.id,bytes]);
        } else await db.query("UPDATE recordings SET state='failed' WHERE id=$1",[recording.id]);
      }
      await db.query("UPDATE webhook_inbox SET state='done',attempts=attempts+1,last_error=NULL,processed_at=now() WHERE account_id=$1 AND event_id=$2",[event.account_id,event.event_id]);
      await db.query("INSERT INTO pipeline_log(kind,detail) VALUES('processed','Verified event processed; result persisted')");
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT processing');
      const attempts=event.attempts+1;
      const delay=Math.min(300,baseDelay*2**(attempts-1));
      const safeError=error.message==='Demo: simulated storage interruption' ? error.message : 'Processing failed; inspect SDK credentials, job mapping, retention and local storage.';
      await db.query(`UPDATE webhook_inbox SET attempts=$3,state=$4,last_error=$5,
        next_attempt_at=now()+($6::double precision * interval '1 second')
        WHERE account_id=$1 AND event_id=$2`,[event.account_id,event.event_id,attempts,attempts>=maxAttempts?'dead':'pending',safeError,delay]);
      await db.query('INSERT INTO pipeline_log(kind,detail) VALUES($1,$2)',[attempts>=maxAttempts?'dead':'retry',`${safeError} Attempt ${attempts}/${maxAttempts}; ${attempts>=maxAttempts?'manual review required':`retry in ${delay}s`}`]);
    }
    await db.query('COMMIT'); return true;
  } catch (error) { await db.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { db.release(); }
}
