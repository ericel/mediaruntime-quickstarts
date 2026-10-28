import { generateDraft } from './chapters.mjs';

// Separate durable stage: retrying the model never re-submits a transcription job.
export async function processChapters({ pool, model, ollamaUrl, generate = generateDraft, baseDelay = 15 }) {
  const db = await pool.connect(); let id;
  try {
    const pending = await db.query(`SELECT id FROM recordings WHERE state='ready'
      AND chapter_state IN ('queued','generating') AND chapter_retry_at<=now() ORDER BY created_at LIMIT 10`);
    for (const row of pending.rows) {
      if ((await db.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', ['chapters:' + row.id])).rows[0].locked) { id = row.id; break; }
    }
    if (!id) return false;
    const row = (await db.query('SELECT * FROM recordings WHERE id=$1', [id])).rows[0];
    if (!['queued', 'generating'].includes(row.chapter_state)) return false;
    // Persist the attempt before contacting the model, so a worker crash is bounded too.
    if (row.chapter_attempts >= 3) {
      await db.query("UPDATE recordings SET chapter_state='failed',chapter_error='Model retries exhausted; review configuration and retry.' WHERE id=$1", [id]);
      return true;
    }
    const attempts = row.chapter_attempts + 1;
    await db.query("UPDATE recordings SET chapter_state='generating',chapter_attempts=$2 WHERE id=$1", [id, attempts]);
    try {
      const { draft, provenance } = await generate({ cues: row.cues, duration: row.duration, model, baseUrl: ollamaUrl });
      await db.query(`UPDATE recordings SET chapter_state='review',draft=$2,provenance=$3,
        chapter_error=NULL,revision=revision+1 WHERE id=$1`, [id, JSON.stringify(draft), JSON.stringify(provenance)]);
    } catch {
      await db.query(`UPDATE recordings SET chapter_state=$2,chapter_error=$3,
        chapter_retry_at=now()+($4::double precision*interval '1 second') WHERE id=$1`,
      [id, attempts >= 3 ? 'failed' : 'queued', 'Summary unavailable or invalid; check Ollama, the model and transcript limits.', baseDelay * 2 ** (attempts - 1)]);
    }
    return true;
  } finally {
    if (id) await db.query('SELECT pg_advisory_unlock(hashtext($1))', ['chapters:' + id]).catch(() => {});
    db.release();
  }
}
