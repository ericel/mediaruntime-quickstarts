# Generate Video Thumbnails in Node.js

Choose a timestamp in an MP4, generate one JPEG with the official `@mediaruntime/node` SDK, save it, and display/download the real result in a browser. This is episode 2 of the Node.js series; it runs independently of episode 1.

## Run

Requirements: Node.js **22+**, a MediaRuntime API key, account credits for real processing, and a browser-playable MP4 up to **20 MB**. The preview must decode in your browser. The demo allows timestamps within the first **600 seconds** (a tutorial limit, not an API limit).

```sh
cd tutorials/nodejs/02-video-thumbnails
npm ci
cp .env.example .env
# Set MEDIARUNTIME_API_KEY privately; optionally set MEDIA_ROOT to another disk.
npm start
```

Open **http://127.0.0.1:3000**. Select your MP4, enter a time in seconds or pause the preview and click **Use current frame**, then **Generate thumbnail**. The page shows the real saved JPEG, dimensions and byte size. **Download JPEG** saves a copy; refreshing restores the latest saved result.

To add the tested SDK version to your own project:

```sh
npm install @mediaruntime/node@1.5.0
```

The complete example also uses Express, Multer and yauzl; `npm ci` installs all locked dependencies. Keys remain server-side. Do not commit `.env`, `node_modules`, or media files.

## The SDK request

```js
import { MediaRuntime } from '@mediaruntime/node';
const media = new MediaRuntime({ apiKey: process.env.MEDIARUNTIME_API_KEY });
const upload = await media.uploads.uploadFile(inputPath, { contentType: 'video/mp4' });
// Persist upload.fileUri and reuse it when retrying this logical request.
const job = await media.jobs.create({
  source: upload.fileUri,
  outputs: [{
    type: 'mp4',
    preset: 'poster_frame_v1',
    posterTimeSec: 1.5,
    posterFormat: 'jpg',
  }],
  deliverWebhook: false,
  idempotencyKey: `node-poster:${record.id}`,
});
// Persist job.id before waiting; restart recovery resumes this same job.
const result = await media.jobs.wait(job.id, { timeoutMs: 300_000 });
```

`type: 'mp4'` is the documented video-processing type for `poster_frame_v1`, **even though this preset produces a JPEG**. SDK camelCase fields map to the API's `poster_time_sec` and `poster_format`. A timestamp beyond the video's duration may fail remotely; the browser checks duration, while the server checks numeric input. MP4 header checks are only a container sanity check, not full media validation.

Completed `result.bundle.downloadUrl` points to the **canonical ZIP**, not directly to a JPEG. `src/bundle.mjs` follows at most three HTTPS redirects without forwarding API credentials, bounds download and archive sizes, verifies an advertised SHA-256, requires exactly one JPEG, and saves it to a controlled filename. It reads bounded JPEG frame metadata before publication; it is **not a complete image decoder or malware scanner**. The browser separately decodes the image.

## Files and routes

- `src/server.mjs`: localhost Express server, multipart validation, public status and JPEG routes.
- `src/pipeline.mjs`: SDK upload, stable submission key, polling, disk records and restart recovery.
- `src/bundle.mjs`: bounded ZIP download and safe selection of one JPEG.
- `public/`: local video preview, timestamp selection, progress, saved image and download.
- `test/pipeline.test.mjs`: offline integration tests using the real SDK with controlled HTTP responses.

`POST /api/thumbnails` accepts multipart `video` and `timestamp`, returning HTTP 202. `GET /api/thumbnails/:id` exposes progress. Ready records contain `imageUrl`; append `?download=1` for a JPEG attachment. `GET /api/thumbnails` returns saved public records. Source storage URIs, keys and signed bundle URLs are not returned to the browser.

## Retention and local storage

**MediaRuntime outputs have short product-specific retention periods, and signed links expire.** Download promptly and store what you need in your own storage. See the [current retention policy](https://mediaruntime.com/en/legal#retention).

This example keeps `input.mp4`, `outputs.zip`, `thumbnail.jpg` and `record.json` under `MEDIA_ROOT/<id>/` **until you delete them**. It has no automatic local cleanup. Stop the server before removing an individual record directory, and never remove a directory for a running job. Your own copies need an access, backup and retention policy. A local copy is independent of MediaRuntime's output expiry; it is not permanent hosted storage.

## Verify

```sh
npm test
# From repository root:
node scripts/check-openapi.mjs
```

Tests require no key or credits. They cover the SDK request contract, upload, exact JPEG bytes/dimensions/attachment, signed-download credential isolation, failed jobs, checksum mismatch, invalid input, unsafe ZIP paths and restart recovery. The tiny test MP4 only represents a container header; it is not playable footage. The test JPEG is an original 8×8 fixture. Real media processing and browser decoding are separate live checks.

For a live check, submit an authorized MP4, wait for the displayed JPEG, download it, and refresh the page. The tutorial recording uses a short Bunny excerpt and an actual MediaRuntime job. No fixture is substituted for the displayed result. Real jobs use credits.

## Scope before production

This is a **single-process, single-user localhost example**. It checks Host and Origin and limits unfinished requests; those controls are not authentication or a production quota system. Add user authentication, per-record ownership, durable queue/storage, quotas, bounded retry policy, observability and cleanup before exposing it publicly. Restrict network downloads as appropriate to your deployment. The in-process queue and local JSON records are not suitable for multiple server instances. A crash between a remote upload and persisting its URI can leave an unused upload. A non-retryable storage error leaves a failed record for inspection rather than submitting another job automatically.

Polling is intentional here; a later tutorial covers verified completion webhooks and durable processing.

## Sample credit

The video tutorial uses a silent ~2.08-second excerpt of Big Buck Bunny. © copyright 2008, Blender Foundation / www.bigbuckbunny.org. [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). [Original trailer](https://download.blender.org/peach/trailer/trailer_720p.mov). The excerpt starts around 8.5 seconds and is transcoded with audio removed; the tutorial extracts a JPEG at 1.5 seconds. No endorsement implied. No media or credentials are committed with this example.
