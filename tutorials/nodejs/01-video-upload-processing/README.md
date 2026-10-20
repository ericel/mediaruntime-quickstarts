# Build a Video Processing API with Node.js, Express & MediaRuntime

Upload an MP4 in a browser, submit a real asynchronous job with the official Node SDK, save the canonical ZIP and its MP4, then play the **saved result** in the browser. This is episode 1 of the Node.js tutorial series.

## Requirements

- Node.js **22 or newer** and npm.
- A MediaRuntime API key and processing credits. Creating a job is a real paid API operation, even with webhook delivery disabled.
- A writable disk for uploads, job records, ZIP bundles and results. The app does not require FFmpeg.

## Install the SDK and run

```bash
git clone https://github.com/ericel/mediaruntime-quickstarts.git
cd mediaruntime-quickstarts/tutorials/nodejs/01-video-upload-processing
npm ci
cp .env.example .env
```

`npm ci` installs the versions recorded in `package-lock.json`, including the official SDK. To add that SDK to a new Node project directly:

```bash
npm install @mediaruntime/node@1.5.0
```

Edit `.env` privately:

```dotenv
MEDIARUNTIME_API_KEY=your-api-key
PORT=3000
MEDIA_ROOT=/absolute/path/to/your/media-storage
```

Keep the key on the server. Never put it in browser code, screenshots, logs, or Git. `MEDIA_ROOT` can point to an external drive; use an absolute path so restarting from another directory does not change it. If the path contains spaces, quote it in `.env`.

```bash
npm start
```

Open **http://127.0.0.1:3000** (use the port from `.env`). The server intentionally binds only to `127.0.0.1`; use that address rather than `localhost`. Choose one MP4 up to 20 MB, then click **Upload & process**. Once it is saved, click **Play saved MP4**. Seeking, downloading and refreshing the page all use the local saved result.

For an SSD-only playground, copy this tutorial folder to your external disk **before** running `npm ci`, then point npm's cache and temporary directory at that disk too. No dependencies or recordings belong in this repository.

### The tutorial's sample

The recording uses MediaRuntime's short, silent Bunny excerpt. You can download the same public sample to your chosen media disk:

```bash
curl --fail --location https://mediaruntime.com/media/showcase/bunny-source.mp4 \
  --output /path/to/your/media-storage/bunny-source.mp4
```

It is approximately two seconds and the player loops it. The video demonstrates processing and playback, not a promised compression ratio. Output size depends on source and encoding settings.

## Follow the code

| File | Responsibility |
| --- | --- |
| `src/server.mjs` | Bound multipart uploads, local API routes, HTTP 202, private file storage and range-enabled MP4 delivery |
| `src/pipeline.mjs` | SDK upload, persisted source/job ID, stable idempotency key, polling, recovery and saved-output status |
| `src/bundle.mjs` | Bounded HTTPS downloads/redirects, advertised SHA-256 verification and controlled MP4 extraction |
| `public/app.js` | File selection, status polling and playback from your server |
| `test/pipeline.test.mjs` | Integration tests using the real SDK and a controlled local API |

### Upload and submit with the SDK

```js
import { MediaRuntime } from '@mediaruntime/node';

const media = new MediaRuntime({ apiKey: process.env.MEDIARUNTIME_API_KEY });
const upload = await media.uploads.uploadFile(inputPath, { contentType: 'video/mp4' });
// Persist upload.fileUri before creating a job.
const job = await media.jobs.create({
  source: upload.fileUri,
  outputs: ['video.web'],
  deliverWebhook: false,
  metadata: { video_id: videoId },
  idempotencyKey: `node-video:${videoId}`,
});
// Persist job.id immediately.
const result = await media.jobs.wait(job.id, { timeoutMs: 300_000 });
```

`video.web` requests a browser-oriented MP4. The SDK also accepts a local path directly as `source`; this example uploads explicitly so it can persist the uploaded source before submission. On retry, reuse the same source, request and idempotency key. Provider idempotency retention is finite; this is not a permanent exactly-once guarantee.

A `wait()` timeout is not a remote job failure. The worker retries the saved job ID. Terminal failed/rejected jobs and invalid downloads never become playable. Nonretryable errors need investigation in your MediaRuntime workspace; do not blindly submit a replacement that spends more credits.

### Save the bundle before playback

`result.bundle.downloadUrl` is an expiring **ZIP bundle link**, not an MP4 URL. The endpoint can redirect to signed storage. The downloader follows at most three redirects, requires HTTPS in normal use, sends **no API key** to the bundle or storage URL, and verifies SHA-256 when advertised.

The archive helper limits total expansion and entry count, rejects unsafe paths/special entries, and copies a selected MP4 to `result.mp4`. It never extracts arbitrary archive filenames into your filesystem. If there are multiple MP4s, it selects the first filename alphabetically; adapt this policy when requesting several renditions. A simple `ftyp` header check is a container sanity check, not exhaustive media validation.

Files are organized under `MEDIA_ROOT/<local-video-id>/`:

```text
input.mp4       original browser upload
record.json     private durable state, source URI and remote job ID
outputs.zip     canonical downloaded result bundle
result.mp4      selected saved video served by Express
```

The browser receives only a public status projection. Private source URIs, signed download links and credentials are not included. `GET /api/videos/:id/media` uses Express's byte-range support for playback and seeking.

## Retention is part of the integration

**MediaRuntime outputs are temporary. Signed download links expire separately from storage cleanup.** Download promptly after completion and keep required originals and results in your own storage. See the current [MediaRuntime retention policy](https://mediaruntime.com/en/legal#retention).

This example leaves original uploads, downloaded ZIPs, results and records on your disk until you delete them. It does not promise permanent retention or perform local cleanup. Stop the server before removing a completed job's directory. Back up what you need; do not delete unfinished jobs or media being played. A production system needs explicit retention, access and backup policies for your copies.

## Verification

```bash
npm run check
npm test
```

The eight automated tests do not need a real API key and do not spend credits. They exercise the published SDK against local controlled HTTP responses, including storage redirects. The tiny MP4-shaped test fixture is deliberately not playable footage. The tutorial recording separately verifies a real upload and API job with Chrome playback, seeking, reload and HTTP 206 range delivery.

## Scope before production

This is a **single-user, single-process localhost teaching app**, not a hosted service. Local Host/Origin checks reduce drive-by requests; they are not user authentication. Any trusted local process can access the demo. Do not expose its port publicly.

Before serving customers, add authenticated users, per-user ownership enforcement, CSRF protection appropriate to your authentication scheme, quotas/rate limits, durable object storage, database records, a durable queue, supervised workers, monitoring and cleanup. Replace polling with verified, idempotently handled terminal webhooks where appropriate. The later webhook tutorial covers that integration. This example has no distributed worker lock and must not run multiple workers against one media directory.

## Sample attribution

Big Buck Bunny excerpt: © copyright 2008, Blender Foundation / [www.bigbuckbunny.org](https://www.bigbuckbunny.org/), licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).

Original: [720p trailer](https://download.blender.org/peach/trailer/trailer_720p.mov). The MediaRuntime sample excerpts approximately 2.1 seconds starting at 8.5 seconds, removes sound and transcodes to MP4. This tutorial processes that excerpt again and loops it for playback. No endorsement is implied. Media files and narration are intentionally not committed.
