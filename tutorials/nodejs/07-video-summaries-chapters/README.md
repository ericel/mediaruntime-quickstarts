# Generate video summaries and AI chapters with Node.js

Episode 7 builds on the transcription tutorial. A real MP4 upload goes through MediaRuntime's `audio.transcription` job. After a verified callback, the worker saves the transcript and asks a **separate local Ollama model** for a summary and chapter suggestions. Review the draft, seek the original video, edit boundaries and titles, then export YouTube chapter text and JSON.

MediaRuntime performs transcription; this application adds summarization and chapter generation. The browser plays the saved original MP4. A chapter references an existing transcript cue; the application calculates its timestamp. References constrain timing, not factual accuracy.

## Requirements and installation

- Node.js 22+, PostgreSQL 16+, and FFmpeg/ffprobe on PATH.
- Ollama with a local instruction model. The recording uses `qwen2.5:7b` (roughly 4.7 GB of model weights; inference needs additional memory).
- A MediaRuntime test account, API key, credits and a registered HTTPS account webhook.
- An H.264/AAC MP4 with speech, at most 100 MB and 15 minutes.

```bash
git clone https://github.com/ericel/mediaruntime-quickstarts.git
cd mediaruntime-quickstarts/tutorials/nodejs/07-video-summaries-chapters
npm ci
cp .env.example .env
ollama pull qwen2.5:7b
```

For an existing project, install the official SDK with:

```bash
npm install @mediaruntime/node@1.5.0
```

Use the included lockfile for this complete example. Media and credentials are excluded from the repository. Keep the API key and signing secret on the server.

## Database, model, and storage

Set these values in your private `.env`:

```dotenv
MEDIARUNTIME_API_KEY=your-key
MEDIARUNTIME_ACCOUNT_ID=your-account
MEDIARUNTIME_WEBHOOK_SECRET=your-account-webhook-secret
DATABASE_URL=postgresql://tutorial:your-password@127.0.0.1:5432/mediaruntime_chapters
MEDIA_ROOT=/your/disk/video-chapters-media
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
FFPROBE=ffprobe
```

URL-encode special characters in database credentials. Use an existing local database or the optional Compose service:

```bash
# Set POSTGRES_PASSWORD in .env first, matching DATABASE_URL.
# Set PG_DATA_DIR to use an external disk for PostgreSQL data.
docker compose up -d --wait postgres
npm run migrate
```

The migration creates a dedicated tutorial schema, not a migration for your existing product database. Docker image storage is separate from PG_DATA_DIR.

For an isolated Ollama server with models on an external disk:

```bash
# Terminal A: choose your disk path; keep this process running.
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=/your/disk/ollama ollama serve
# Terminal B:
OLLAMA_HOST=127.0.0.1:11435 ollama pull qwen2.5:7b
```

Set `OLLAMA_URL=http://127.0.0.1:11435` in `.env` when using that isolated instance. The example accepts only a loopback HTTP model endpoint. Model quality and resource needs vary: test your choice and review its license. A schema-valid response can still be wrong or poorly grouped.

## Connect the webhook and run

1. Register `https://your-endpoint/webhooks/mediaruntime` under **Account → Webhooks** in the same test account as the API key.
2. Put its signing secret in `.env` and restart the server whenever it changes.
3. Run `npm start`. Default UI: `http://127.0.0.1:3000`. Separate webhook listener: `127.0.0.1:3001`.
4. Forward only the webhook listener through HTTPS. A local tunnel is suitable for a demo; use a stable endpoint for deployment. Do not expose the unauthenticated UI.
5. In another terminal, run `npm run worker`.
6. Open the UI, choose the MP4, and click **Upload & build draft**. Each new upload uses MediaRuntime processing credits.

The recording uses custom local ports; the shipped defaults remain 3000/3001. A tunnel alone does not register the destination with MediaRuntime. Avoid changing an active production account's endpoint for this tutorial.

## Two independent stages

`src/submit.mjs` uploads the saved source and submits:

```js
const uploaded = await media.uploads.uploadFile(inputPath, {
  contentType: 'video/mp4'
});
const job = await media.jobs.create({
  source: uploaded.fileUri,
  outputs: ['audio.transcription'],
  deliverWebhook: true,
  idempotencyKey: `node-chapters:${id}`
});
```

The upload URI and remote ID are persisted. Submission retries reuse the same identity; a new upload creates another job. The receiver verifies raw bytes with the official SDK, checks account/event identity, commits a durable PostgreSQL inbox record, then returns 204. The completion worker retrieves job details through the SDK, saves M4A/SRT/VTT, parses cues and marks transcription ready. Duplicate events do not create a second committed completion.

`src/process-chapters.mjs` then claims the independent chapter stage. It sends saved cue IDs, text and timing to Ollama through its local `/api/chat` endpoint. It uses a JSON response schema, bounded response size, a timeout, and explicit transcript-as-data instructions. There are no tools or code execution actions available to the model.

The application rejects unknown fields, invalid cue references and unordered chapters. It sets the opening chapter to 00:00 and calculates later starts by flooring saved cue times to whole seconds. It never accepts invented model timestamps. Input is limited to 250 cues and 24 KB serialized JSON, without silent truncation. Longer transcripts need a separate chunking/aggregation design.

## Review and export

Read the summary, listen to supporting cues and click chapter timestamps to seek the video. Edit the summary or title, select another source segment, remove a boundary, or add a chapter. Unsaved edits hide export controls until approval. Existing stored approvals remain a separate saved version; local typing does not mutate the database.

The server checks the revision on approval to reject stale edits. Approval requires at least three chapters, a 00:00 start, ascending times and at least ten seconds for each chapter, including the last. Inadequate drafts stay reviewable rather than being silently repaired. Matching YouTube's timestamp format does not guarantee channel feature eligibility.

After **Approve & save**, copy or download the chapter list. JSON includes the summary, evidence cue IDs, chapter IDs/times/titles, model name, prompt version, transcript hash and review time. The UI inserts model text safely; no generated HTML is executed.

Model-selected evidence is a review aid, not proof that every statement is true. The recording uses original synthetic speech and is not an accuracy benchmark.

## Failure recovery

Model attempts are persisted before inference. A crash or invalid response retries only the model stage, with bounded backoff and a three-attempt limit. After failure, **Retry summary from saved transcript** resets that stage. No new transcription job is created. A crash after inference but before saving can repeat local inference; it cannot approve an unreviewed draft.

Submission and completion have their own bounded retries from episode 6. To enqueue via CLI or recover an unsubmitted record:

```bash
npm run submit -- /path/to/video.mp4
npm run submit -- --resume <local-UUID>
```

Inspect dead inbox events and fix the cause before deliberately resetting them. For a missing provider callback, inspect the configured endpoint and consider an intentional `media.jobs.retryWebhook(jobId)` request. Do not create another paid job just to replay a notification.

## Verification

Create a separate test database and set `TEST_DATABASE_URL`:

```bash
docker compose exec postgres createdb -U tutorial mediaruntime_chapters_test
npm test
```

Tests refuse non-loopback hosts and database names without a `_test` suffix. They truncate their tutorial tables. The 31 automated checks use fixtures and cover signature validation, deduplication, early callbacks, retry behavior, competing workers, transcript parsing, invented references, chapter spacing, stale approval, and export gating. They make no paid processing requests.

The recorded workflow separately uses real MediaRuntime transcription, a signed callback, saved output files, local model inference, browser playback and seeking, editing/approval, clipboard export, downloads and reload. See the video delivery's verification files for the recorded result.

## Retention and production boundaries

**MediaRuntime retains output files for a short period; signed download links also expire.** Save required artifacts promptly. A fresh link cannot recover files already deleted by retention. See the [MediaRuntime retention policy](https://mediaruntime.com/en/legal#retention).

This demo retains its original MP4, bundle, audio, captions, derived text, drafts and database rows until you delete them. Apply a lifecycle policy and access controls to your own copies. Inbox payloads can contain signed links; keep them private and retain deduplication identities long enough for replay handling.

This is a single-user local teaching app. Host/Origin checks are not authentication. Production needs authenticated users, per-record authorization, shared durable storage, resource isolation, rate limits, quotas, worker supervision, monitoring and reconciliation for missing callbacks. Header checks and restricted ffprobe protocols do not make arbitrary media safe. The simple active-job limit is not a distributed quota. The completion worker holds a database connection during bounded downloads; use leases/fencing for larger workloads. Use TLS and least-privilege roles with remote PostgreSQL. Only process recordings you have permission to use.

References: [MediaRuntime docs](https://mediaruntime.com/en/docs), [official SDK](https://github.com/ericel/mediaruntime-node-sdk), [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [YouTube chapter requirements](https://support.google.com/youtube/answer/9884579), [recorded model](https://ollama.com/library/qwen2.5:7b).
