# Convert Audio with Node.js

Upload a WAV, convert it to AAC/M4A with the official `@mediaruntime/node` SDK, save the real output, and play, seek and download it in a browser. Episode 3 runs independently of the earlier Node.js tutorials.

## Run

Requirements: **Node.js 22+**, a MediaRuntime API key with processing credits, and an authorized WAV file up to **20 MB**. The application needs **no local FFmpeg**.

```sh
cd tutorials/nodejs/03-audio-conversion
npm ci
cp .env.example .env
# Privately configure MEDIARUNTIME_API_KEY and optional MEDIA_ROOT.
npm start
```

Open **http://127.0.0.1:3000**, choose a WAV and press **Convert to M4A**. Once ready, use **Play saved audio**, the native seek bar, and **Download M4A**. Refresh to verify the saved result. Looping is on by default for the short demo; uncheck **Loop** to play once.

To add the tested SDK to your own project:

```sh
npm install @mediaruntime/node@1.5.0
```

The complete quickstart also uses Express, Multer and yauzl; `npm ci` installs the locked dependencies. Keep `.env`, dependencies and generated media out of Git. Configure `MEDIA_ROOT` to put media on another disk. Keys are server-side only.

## SDK workflow

```js
import { MediaRuntime } from '@mediaruntime/node';
const media = new MediaRuntime({ apiKey: process.env.MEDIARUNTIME_API_KEY });
const upload = await media.uploads.uploadFile(inputPath, { contentType: 'audio/wav' });
// Persist upload.fileUri before submission and reuse it on retries.
const job = await media.jobs.create({
  source: upload.fileUri,
  outputs: ['audio.web'],
  deliverWebhook: false,
  idempotencyKey: `node-audio:${record.id}`,
});
// Persist job.id before waiting; recovery resumes the same remote job.
const result = await media.jobs.wait(job.id, { timeoutMs: 300_000 });
```

[`audio.web`](https://mediaruntime.com/en/docs) maps to `audio_aac_128k`: AAC audio at 128 kbps in an M4A container. AAC is lossy; smaller files are not a promise of identical quality. Size savings depend on the source. This demo intentionally accepts only RIFF/WAVE input. Header screening is not full decoding, and unsupported WAV encodings may fail remote processing. Native preview support varies by browser; remote conversion can still work when the local input preview cannot decode.

The job returns a **canonical ZIP**, not a directly playable M4A URL. `downloadBundle` follows at most three HTTPS redirects without forwarding the API key, bounds bytes, and checks an advertised SHA-256. `saveM4a` rejects unsafe archive paths and special entries, requires exactly one M4A, checks its ISO media container header, and saves it atomically under a controlled filename. This does **not** validate every AAC packet or provide a complete media security sandbox. Browser decoding is verified separately.

## Browser and routes

- `POST /api/audio`: multipart `audio` file; persists the input and queued record, responds **202** and enqueues processing.
- `GET /api/audio`: saved public records, newest first.
- `GET /api/audio/:id`: public status, sizes and local media URL; no private source, API key or signed bundle URL.
- `GET /api/audio/:id/media`: ready local M4A, served as `audio/mp4`. Express file delivery supports **HEAD**, **206 byte ranges**, and **416** for unsatisfiable ranges.
- Add `?download=1` for an attachment response.

The spectrum uses a Web Audio analyser connected to the **actual decoded player audio**. It does not simulate activity. A user gesture enables audio; the native controls remain available. A playback error is surfaced in the page.

## Files

- `src/server.mjs`: upload screening, localhost routes and media delivery.
- `src/pipeline.mjs`: SDK upload/submission, polling, retry and restart recovery.
- `src/bundle.mjs`: bounded downloads and M4A selection from the ZIP.
- `public/`: WAV preview, progress, native M4A player, analyser and download.
- `test/pipeline.test.mjs`: offline SDK integration checks.

## Temporary outputs and your own copies

**MediaRuntime outputs have short product-specific retention periods, and signed links expire separately.** Download completed bundles promptly and save what you need. Consult the [current retention policy](https://mediaruntime.com/en/legal#retention); do not assume stored output implies an unexpired download link.

Under `MEDIA_ROOT/<id>/`, this example keeps `input.wav`, `outputs.zip`, `result.m4a`, and `record.json` until you delete them. It has **no automatic local expiry**. Stop the server before removing a record directory, and never remove a directory for a running job. MediaRuntime cleanup does not delete independent copies you saved yourself. Your storage needs access controls, backups and its own retention/cleanup policy.

## Verify

```sh
npm test
npm run check
# From repository root:
node scripts/check-openapi.mjs
```

Ten offline tests use the actual SDK against controlled local HTTP responses. They cover submission, storage credential separation, redirects, saved bytes, partial responses, HEAD, unsatisfiable ranges, attachment downloads, invalid WAV/M4A headers, failed jobs, checksum mismatches, archive rejection and restart recovery. They need no API key or credits. Tiny transport fixtures are **not playable audio**.

The tutorial separately runs a real MediaRuntime conversion and checks Chrome playback, decoded analyser signal, seeking, identical downloaded bytes, and reload persistence. An independent media probe checks AAC, container and duration. The audible demonstration is taken from the **converted M4A**, not substituted source audio. Real jobs use credits.

## Before production

This is a single-user, single-process **localhost** example. Host/Origin checks and its unfinished-job limit are not authentication or production quotas. Add authenticated users, per-record ownership, durable queues/storage, bounded retry/deadline policies, network download restrictions, monitoring and cleanup before public use. The in-process queue and local JSON records do not support multiple server instances. A crash between remote upload and persisting its URI can leave an unused upload. Non-retryable save failures remain visible for inspection rather than automatically submitting another job.

Polling is intentional; the next tutorial covers HMAC-verified webhooks, PostgreSQL, idempotency and retries.

## Tutorial sample credit

The recording uses **14 seconds of audio from the Big Buck Bunny trailer, starting at 8.5 seconds**, extracted as stereo 48 kHz PCM WAV and converted to AAC/M4A. © copyright 2008, Blender Foundation / www.bigbuckbunny.org. [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). [Original trailer](https://download.blender.org/peach/trailer/trailer_720p.mov). The video plays a shortened excerpt of the converted audio with volume adjustment. No endorsement implied. No media or credentials are committed with this example.
