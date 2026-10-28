import path from 'node:path';
export async function submitOne({pool,media,root}) {
  const db=await pool.connect(); let id;
  try {
    const pending=await db.query("SELECT id FROM recordings WHERE remote_job_id IS NULL AND state IN ('queued','submitting') AND submit_retry_at<=now() ORDER BY created_at LIMIT 10");
    for (const row of pending.rows) {
      if (!(await db.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[row.id])).rows[0].locked) continue;
      id=row.id; break;
    }
    if (!id) return false;
    const row=(await db.query('SELECT * FROM recordings WHERE id=$1',[id])).rows[0];
    if(row.remote_job_id || !['queued','submitting'].includes(row.state)) return false;
    await db.query("UPDATE recordings SET state='submitting' WHERE id=$1",[id]);
    try {
      let source=row.source_uri;
      if(!source){source=(await media.uploads.uploadFile(path.join(root,id,'input.mp4'),{contentType:'video/mp4'})).fileUri;
        await db.query('UPDATE recordings SET source_uri=$2 WHERE id=$1',[id,source]);}
      const job=await media.jobs.create({source,outputs:['audio.transcription'],deliverWebhook:true,
        metadata:{tutorial:'node-chapters',local_id:id},idempotencyKey:`node-chapters:${id}`});
      await db.query("UPDATE recordings SET remote_job_id=$2,state='processing',submit_error=NULL WHERE id=$1",[id,job.id]);
      return true;
    } catch(error) {
      const attempts=row.submit_attempts+1;
      await db.query(`UPDATE recordings SET submit_attempts=$2,state=$3,submit_error=$4,
        submit_retry_at=now()+($5::double precision*interval '1 second') WHERE id=$1`,
        [id,attempts,attempts>=5?'submission_failed':'queued','Submission unavailable; inspect credentials, account balance and connectivity.',Math.min(300,15*2**(attempts-1))]);
      return false;
    }
  } finally {if(id)await db.query('SELECT pg_advisory_unlock(hashtext($1))',[id]).catch(()=>{});db.release();}
}
