// One autocommitted INSERT before the response. PostgreSQL enforces uniqueness
// across all receiver processes; an in-memory Set cannot provide this guarantee.
export async function acceptEvent(pool, event, expectedAccount) {
  if (event.accountId !== expectedAccount) return 403;
  const bounded = value => typeof value === 'string' && /^[\w.-]{1,180}$/.test(value);
  if (!bounded(event.id) || !bounded(event.jobId) || !['COMPLETED','FAILED','REJECTED'].includes(event.status)
      || (event.data.event_id && event.data.event_id !== event.id)) return 400;
  const result = await pool.query(`
    INSERT INTO webhook_inbox(account_id,event_id,job_id,status,payload)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(account_id,event_id) DO UPDATE
      SET deliveries=webhook_inbox.deliveries+1
      WHERE webhook_inbox.job_id=EXCLUDED.job_id AND webhook_inbox.status=EXCLUDED.status
    RETURNING event_id`, [event.accountId,event.id,event.jobId,event.status,event.data]);
  // Different signed event content cannot redirect an existing event to a new job.
  return result.rowCount ? 204 : 409;
}
