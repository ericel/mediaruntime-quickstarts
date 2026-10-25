# Build a reliable webhook pipeline with Node.js

Episode 4 of the MediaRuntime Node.js series. Express verifies the original callback bytes with the official SDK, commits them to a PostgreSQL inbox, and acknowledges receipt. An independent worker saves the real processed MP4 for browser playback. Duplicate deliveries, worker failure, backoff and dead letters are visible in the local dashboard.

## Requirements and installation

- Node.js 22 or newer.
- PostgreSQL 16 or newer (recording/tests used PostgreSQL 18.4).
- A MediaRuntime test account, API key, credits and an active account webhook.
- An HTTPS URL forwarding **only** the webhook listener.
- Disk space for PostgreSQL, input MP4s, ZIP bundles and saved results.

```bash
cd tutorials/nodejs/04-reliable-webhooks
npm ci
cp .env.example .env
```

For your own application, SDK installation is:

```bash
npm install @mediaruntime/node@1.5.0
npm install express pg yauzl
```

Use the included lockfile for the tested complete example. Never commit `.env`, database files, callback payloads, signed links or downloaded media.

## Configure PostgreSQL

Use an existing local PostgreSQL server, or the optional Compose service:

```bash
# Add POSTGRES_PASSWORD=<local password> to your private .env first.
# Optionally set PG_DATA_DIR=/your/external/disk/postgres in .env.
docker compose up -d --wait postgres
```

Set `DATABASE_URL` in `.env` to the matching credentials and database. URL-encode special characters in the password. Use `MEDIA_ROOT` for the desired output disk. Docker also uses its own image storage location; configure that separately if internal disk space is limited.

```bash
npm run migrate
```

The migration creates `videos`, `webhook_inbox` and a small diagnostic log. It is safe to rerun. This is a dedicated tutorial database, not a schema migration for an existing product.

## Register the account webhook

1. In MediaRuntime **Account → Webhooks**, register `https://your-endpoint/webhooks/mediaruntime` in the same account as the API key.
2. Copy its signing secret to `MEDIARUNTIME_WEBHOOK_SECRET`. Also set `MEDIARUNTIME_API_KEY` and `MEDIARUNTIME_ACCOUNT_ID` in `.env`.
3. Start the receiver and dashboard:

   ```bash
   npm start
   ```

4. Forward the public HTTPS endpoint to `127.0.0.1:3001` (or `WEBHOOK_PORT`). A temporary tunnel is suitable for a local demonstration. **Do not expose port 3000**, which is the unauthenticated local dashboard. The receiver exposes only the signed POST route.
5. Restart after changing the signing secret. Use a stable endpoint and managed secret storage in production.

A tunnel URL alone does not register the endpoint. The account's configured webhook destination/secret must match; setting a per-job URL is not used as a substitute here. Avoid changing an active production account's destination for a tutorial.

## Run the complete flow

In another terminal:

```bash
npm run worker
```

Submit a local MP4 up to 50 MB:

```bash
npm run submit -- /path/to/bunny.mp4
```

Open `http://127.0.0.1:3000` (or `PORT`). The CLI uploads through the SDK, stores the source URI and submits `video.web` with webhook delivery enabled. The dashboard refreshes **local database state**, not remote completion polling. Once the callback is committed, the worker fetches the authenticated job details, downloads its ZIP and saves `result.mp4`. Play and download the saved result in the browser.

The script prints a local UUID immediately after creating its durable record. If it is interrupted, reuse that identifier:

```bash
npm run submit -- --resume <local-UUID>
```

This reuses the persisted source, remote job and stable submission idempotency key. Do not submit the input as a new record just to recover a lost callback. A real processing run consumes account credits.

## How reliability works

- **Authenticate raw bytes:** `express.raw()` runs before JSON parsing. `media.webhooks.verify()` checks the signed timestamp, event ID and exact body. Requests outside the five-minute timestamp tolerance or with invalid signatures receive 401. Unknown accounts and invalid terminal-event identities are rejected.
- **Commit before 204:** a parameterized PostgreSQL INSERT persists a verified event. Its primary key is `(account_id, event_id)`. Matching repeats increment `deliveries`; conflicting job/status identities return 409. Database failure returns 503, never a false success.
- **Separate receipt from processing:** after 204, the event survives a receiver restart. The worker owns downloads and retries. It fetches fresh bundle information through the SDK, not from arbitrary callback URLs.
- **Coordinate workers:** `FOR UPDATE SKIP LOCKED` claims one event. A lock on the video row also protects against different events for the same job. Inbox completion and video completion commit together.
- **Recover files:** a bounded download and extraction write `.part` files, then rename. If a process dies after the file save but before the database commit, the worker may write the same file again; the deterministic destination and database transaction prevent a second committed completion. This is not a universal exactly-once guarantee for external side effects such as emails or payments.
- **Bound retries:** worker attempts use 15, 30, 60 and 120 second delays; the fifth failure moves the event to `dead`. Inspect the private row and safe diagnostic log before deliberately resetting a repaired event to `pending` with a new retry time. Do not automatically replay permanent failures.
- **Handle races:** a callback that arrives before the job ID is saved remains in the inbox and retries. Unknown jobs eventually dead-letter rather than being processed for the wrong local record.

For a controlled local demonstration, start the worker once with:

```bash
npm run worker -- --demo-fail-once
```

It deliberately fails its first eligible uncompleted job and records that fact. Restart normally to show that recovery comes from PostgreSQL, not a surviving in-memory queue. This flag is a test aid; it is never enabled by default.

Provider delivery retries are distinct from worker retries. If provider delivery was exhausted, inspect the job and registered endpoint, then request a deliberate delivery retry with the SDK:

```js
await media.jobs.retryWebhook(jobId);
```

Do not create another conversion merely to replay its completion event. Replayed events still pass signature validation and durable deduplication.

## Tests without billable jobs

Create an isolated local test database, for example:

```bash
docker compose exec postgres createdb -U tutorial mediaruntime_webhooks_test
```

Set `TEST_DATABASE_URL` to that database in `.env`, then:

```bash
npm test
```

Tests truncate their three tutorial tables. They **refuse** non-loopback hosts and database names without a `_test` suffix. They exercise the actual SDK verifier and PostgreSQL locks with controlled media responses: no real API requests, customer emails or processing charges. Tests cover tampering, stale timestamps, wrong accounts, concurrent duplicate requests, conflicting IDs, database outage, competing workers, multiple events per job, lost file/transaction progress, backoff, dead letters and early callbacks.

## Retention and production boundaries

MediaRuntime output files and signed URLs are temporary. Download promptly and retain required copies in storage you control. A retry cannot recover an output already deleted by retention; link expiry and object retention are separate. See the [MediaRuntime retention policy](https://mediaruntime.com/en/legal#retention).

This example retains local inputs, bundles and results until you delete them. PostgreSQL also retains inbox payloads, which can contain signed URLs. Apply your own lifecycle, backups, encryption and access controls to both. Purging deduplication records too early can permit delayed events to be processed again; retain suitable deduplication tombstones for your replay policy.

The dashboard is a single-user local teaching tool. Host validation reduces accidental exposure; it is not authentication. Before production, add authenticated users, ownership authorization, quotas, rate limits, health checks, alerting on dead events, shared durable storage and a supervised worker. Use TLS for remote PostgreSQL connections and least-privilege database roles. This example holds row locks during a bounded download, which is simple but uses a connection for longer; larger systems should use leases, fencing and storage-specific idempotency.

## Sample media

The recording uses Big Buck Bunny footage previously used in the series. © 2008 Blender Foundation / www.bigbuckbunny.org, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The video is converted for demonstration; no endorsement is implied. Media files and credentials are not included in the repository.

References: [SDK source](https://github.com/ericel/mediaruntime-node-sdk), [PostgreSQL SELECT locking](https://www.postgresql.org/docs/current/sql-select.html), [node-postgres transactions](https://node-postgres.com/features/transactions).

## Recording verification

The episode uses one actual `video.web` job and a real provider-to-tunnel callback verified by the SDK. After receipt, the worker is deliberately stopped following an injected failure, then restarted. The same inbox event succeeds on its second worker attempt. Two later locally signed replays return 204 without another completion; a one-byte tamper returns 401. Browser checks cover decoded MP4 playback, reload, identical downloaded bytes and HTTP 206 range requests. The recorded source is a silent 2.08-second Bunny trailer excerpt, starting at approximately 8.5 seconds, converted and looped for demonstration.
