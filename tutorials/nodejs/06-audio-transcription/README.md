# Build an automated audio transcription pipeline with Node.js

Episode 6 of the MediaRuntime Node.js tutorials: upload a speech recording in a browser, submit `audio.transcription` through the official SDK, receive a signed callback, and save the returned **M4A audio, SRT and WebVTT subtitles**. Search the transcript, click a segment to seek, and download your saved files. Plain text is derived locally from the VTT cues.

## Install

You need Node.js 22+, PostgreSQL 16+, a MediaRuntime test account with an API key and credits, and an HTTPS endpoint for its account webhook. The example accepts one RIFF/WAVE file up to 20 MB. Use speech you have permission to process.

```bash
git clone https://github.com/ericel/mediaruntime-quickstarts.git
cd mediaruntime-quickstarts/tutorials/nodejs/06-audio-transcription
npm ci
cp .env.example .env
```

To add the official SDK to an existing Node project:

```bash
npm install @mediaruntime/node@1.5.0
```

The complete example also uses Express, Multer, node-postgres and Yauzl. Use its lockfile for the tested dependency set. Media, credentials and database contents are not included in the repository.

## Configure and start

Fill in `.env`: `MEDIARUNTIME_API_KEY`, `MEDIARUNTIME_ACCOUNT_ID`, `MEDIARUNTIME_WEBHOOK_SECRET`, `DATABASE_URL`, and `MEDIA_ROOT`. `MEDIA_ROOT` is where inputs, ZIP bundles and extracted files are retained. Never expose credentials to browser code or commit `.env`.

Use your own local PostgreSQL server or the optional Compose service:

```bash
# Set POSTGRES_PASSWORD in .env first; use the matching DATABASE_URL.
# PG_DATA_DIR can put database files on another disk.
docker compose up -d --wait postgres
npm run migrate
npm start
```

The schema creates `recordings`, `webhook_inbox`, and `pipeline_log` in a dedicated tutorial database. The migration can be rerun. Docker's image storage is separate from `PG_DATA_DIR`; configure it separately if space is limited.

1. Register `https://your-endpoint/webhooks/mediaruntime` under **Account → Webhooks** in the same test account as the API key.
2. Put that endpoint's signing secret in `.env` and restart the server.
3. Forward HTTPS to the **webhook listener**, default `127.0.0.1:3001` (`WEBHOOK_PORT`). A temporary tunnel works for local demonstrations; use a stable endpoint in production.
4. Keep the unauthenticated browser UI, default `127.0.0.1:3000` (`PORT`), local. Do not tunnel the UI port.
5. In a second terminal, run `npm run worker`.
6. Open `http://127.0.0.1:3000`, choose a short WAV containing speech, and click **Upload & transcribe**.

The recording uses custom local ports; the shipped defaults are 3000/3001. Merely starting a tunnel does not register it with MediaRuntime. Avoid changing an active production account's callback for this tutorial.

## What runs

The upload route bounds the multipart request, checks the RIFF/WAVE header, saves a private local input, queues a PostgreSQL row and returns HTTP 202. It does not perform the entire cloud job inside the browser request.

The background worker uses the official SDK:

```js
const uploaded = await media.uploads.uploadFile(inputPath, {
  contentType: 'audio/wav'
});
const job = await media.jobs.create({
  source: uploaded.fileUri,
  outputs: ['audio.transcription'],
  deliverWebhook: true,
  idempotencyKey: `node-transcription:${id}`
});
```

`src/submit.mjs` persists the source URI and remote job ID, coordinates submitters with advisory locks, and retries the same recording with a stable submission key. A new upload means a new billable job. The alias requests single-language transcription without translation; this example does not request diarization, word-level alignment or advanced subtitle options.

The receiver verifies the exact raw bytes using `media.webhooks.verify()`, checks the account and terminal event identity, and persists an inbox row **before** HTTP 204. Matching duplicates are deduplicated by `(account_id, event_id)`; conflicting identities are rejected. Database failure returns an error so delivery can be retried.

A separate completion worker locks the event and recording, calls `media.jobs.get()` with server credentials, downloads the returned bundle, and extracts the three expected artifacts. Downloads and archive entries have size limits; extraction rejects path traversal, symlinks and encrypted files. Controlled output names and `.part` renames make repeat writes recoverable. Files are served only after the database marks the recording `ready`.

The VTT parser validates a bounded subset of service-generated WebVTT, stores timestamped cues, and writes `transcript.txt`. The browser polls **local database state**, not the provider. It renders text with `textContent`, highlights timed segments, filters search results, seeks audio, and downloads saved files. These are segment timestamps, not word-level alignment. Empty transcripts are valid; machine-generated text needs review.

## Recovery

Submission failures back off and stop after five failures in `submission_failed`. After repairing credentials, balance or connectivity, resume the **same local UUID**:

```bash
npm run submit -- --resume <local-UUID>
```

You can also enqueue a WAV without the browser:

```bash
npm run submit -- /path/to/speech.wav
```

Completion failures use 15, 30, 60 and 120 second delays; the fifth failure dead-letters the event. Inspect the private inbox row and diagnostic log, fix the cause, then deliberately reset the event to `pending` with a due `next_attempt_at`. Do not create a new transcription job to recover a lost callback. If provider delivery needs replay, inspect the registered endpoint and use the SDK's `media.jobs.retryWebhook(jobId)` deliberately.

Row locks prevent competing completion workers from committing twice, including different event IDs for the same job. A callback arriving before the remote ID is saved retries. A crash after writing files but before committing can rewrite those files on recovery; this is not a general exactly-once guarantee for unrelated external effects. Submission identity guarantees depend on the provider's idempotency policy, so avoid blind retries after long outages.

## Tests

Tests require a separate loopback database whose name ends in `_test`:

```bash
docker compose exec postgres createdb -U tutorial mediaruntime_transcription_test
# Set TEST_DATABASE_URL in .env to that database.
npm test
```

Tests truncate their tutorial tables and use controlled media responses, not paid processing. The 20 checks cover real SDK signature verification, tampering, stale timestamps, wrong accounts, concurrent duplicates, conflicting IDs, database failures, worker races, retries, dead letters, early callbacks, submission identity reuse, timestamp parsing and safe handling of transcript text.

The recorded live run separately verified one actual transcription job and signed account callback, a 14.72-second returned audio file, four cues, browser playback, search and seeking, reload, HTTP 206, identical downloaded bytes for all four files, and rejection of unsigned callbacks and cross-origin uploads. The speech sample is original synthetic narration using the supplied voice profile; it is not a transcription accuracy benchmark.

## Retention and production boundaries

**MediaRuntime outputs are retained temporarily, and signed download links also expire.** Save required artifacts promptly in storage you control. Link expiry and object deletion are different; retrying cannot recover an output already removed by retention. See the [retention policy](https://mediaruntime.com/en/legal#retention).

This demo keeps local inputs, bundles, audio, subtitles, transcripts and database rows until you delete them. Inbox payloads may contain signed links. Add a lifecycle policy, restricted access, backups and appropriate encryption to your own storage. Preserve deduplication records long enough for your replay policy.

The UI is a single-user local teaching tool. Host and Origin checks are not user authentication. Production needs authenticated users, per-record ownership checks, durable shared storage, robust quotas, rate limits, worker supervision, monitoring, reconciliation for missing callbacks, and intentional cleanup. The simple three-active-job check is not a distributed quota. RIFF header checking is not a full media safety inspection. Bound processing resources and review file handling for your deployment.

The worker holds PostgreSQL row locks during bounded downloads for simplicity; larger systems should use durable leases, fencing and storage-specific idempotency. Use TLS and least-privilege roles for remote PostgreSQL. Review names, numbers and important claims in generated transcripts before publication, and obtain permission for private recordings.

References: [MediaRuntime docs](https://mediaruntime.com/en/docs), [official Node SDK](https://github.com/ericel/mediaruntime-node-sdk).
