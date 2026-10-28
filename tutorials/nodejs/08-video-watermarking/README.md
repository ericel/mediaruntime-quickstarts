# Build an automated video watermarking pipeline with Node.js

Episode 08 uses the official MediaRuntime SDK to configure an account PNG watermark, upload an MP4, submit a watermarked job, save its canonical ZIP and processed MP4, then compare the original and output in a browser.

The logo is rendered into the processed file by MediaRuntime. The local app does not apply an FFmpeg or CSS overlay. A visible logo is branding, not DRM or a guarantee against removal.

## Install and run

Requirements: Node.js 22+, a MediaRuntime account/API key permitted to use Premium watermarking, available credits, your PNG logo and an MP4. Watermarking is unavailable in the public sandbox. The demo accepts MP4 uploads up to 20 MB; the recording uses a short silent H.264 Bunny excerpt.

```bash
git clone https://github.com/ericel/mediaruntime-quickstarts.git
cd mediaruntime-quickstarts/tutorials/nodejs/08-video-watermarking
npm ci
cp .env.example .env
# Privately set MEDIARUNTIME_API_KEY and MEDIA_ROOT.
npm start
# Open http://127.0.0.1:3000
```

To add the SDK to another project:

```bash
npm install @mediaruntime/node@1.5.0
```

Keep credentials server-side. Set `MEDIA_ROOT` to a folder with sufficient capacity, such as an external disk. It contains original uploads, private job records, output bundles, saved MP4s, and this demo's logo/settings cache. The server binds to loopback. The recording uses port 3092; the default is 3000.

For an SSD-only playground, copy this example to that disk before running `npm ci`, and put npm’s cache and temporary directory there too. Dependencies and recordings do not belong in the quickstarts repository.

The same public sample used in this recording is available from:

```bash
curl --fail --location https://mediaruntime.com/media/showcase/bunny-source.mp4 \
  --output /your/disk/bunny-source.mp4
```

## Configure the watermark visibly

1. Open **Configure the account watermark**.
2. Select a PNG up to 2 MB and 4096 pixels per dimension; inspect its preview.
3. Select a position, opacity from 1–100%, and width from 1–100% of the output width. The demonstration uses bottom right, 90% opacity and 24% width.
4. Confirm replacement of the account-wide logo/defaults, then click **Save account watermark**.
5. Upload the MP4. Wait until **Saved · ready to play**, then play both videos, seek, and download the output.

**This changes the real account configuration.** Use a dedicated test account and finish active jobs first. One account has one logo/default configuration shared by its clients. The demo blocks its own active jobs during setup, but cannot coordinate jobs submitted by other clients. Its “Last saved here” label is a local cache, not a live account-settings lookup. Configure the logo once; uploading a video never replaces it automatically.

The real SDK-backed setup call is:

```js
await media.watermarkLogo.upload(pngPath, {
  position: 'bottom_right',
  opacityPct: 90,
  scalePct: 24
});
```

Supported positions: `bottom_right`, `bottom_left`, `top_right`, `top_left`, `center`. `scalePct` is the logo width relative to each output width. Transparent PNGs work well for logos. The SDK obtains an upload target, transfers the PNG and confirms account settings. Logo upload and confirmation are separate network operations; a failed confirmation can leave uploaded account bytes changed. Inspect account settings before retrying a failed setup.

Optional command-line equivalent (explicitly replaces the account logo):

```bash
npm run logo -- /path/to/logo.png --replace-account-logo
```

## Submit the watermarked job

```js
const uploaded = await media.uploads.uploadFile(inputPath, {
  contentType: 'video/mp4'
});
const job = await media.jobs.create({
  source: uploaded.fileUri,
  outputs: ['video.web'],
  watermark: { enabled: true },
  deliverWebhook: false,
  idempotencyKey: `node-watermark:${id}`
});
```

The source URI is saved before job submission; the returned job ID is persisted before waiting. The job only enables the watermark; position, size, opacity and logo belong to account setup. There is no `requestedTier` option in this SDK call. Premium authorization comes from the account/key configuration. `deliverWebhook: false` disables this job's callback only; it is real, billable processing.

`VideoPipeline` waits for the existing job. A timeout or retryable network error retries the same stored identity. A process restart reloads unfinished records. Stable submission keys prevent duplicate logical submissions within the provider's idempotency contract. Uploads can repeat if a crash occurs before the uploaded URI is persisted. Do not run multiple instances against the same directory.

After `COMPLETED`, the worker downloads the ZIP, verifies SHA-256 when advertised, rejects unsafe archive entries, extracts the MP4 and marks it ready. Failed jobs never become playable. Express serves saved original and result files with Range support. Refreshing the UI reloads saved state, rather than submitting a new job. The two browser players start together but are not a frame-accurate comparison tool.

## Verification

```bash
npm test
npm run check
```

Ten automated checks use the real SDK against local HTTP fixtures. They cover the watermark payload, logo upload/confirmation, invalid logo settings, cross-origin rejection, invalid MP4 headers, failed jobs, checksum mismatch, unsafe/missing ZIP output, and recovery using saved job/source identity. Fixture media is not playable footage. Live playback and the visible watermark were checked separately using the real service.

No test uses live credentials or credits. To keep test temporary files on an external drive:

```bash
mkdir -p /your/disk/test-tmp
TMPDIR=/your/disk/test-tmp npm test
```

## Retention and production boundaries

**MediaRuntime retains outputs for a short period; signed links also expire.** Save required artifacts promptly. A new signed link cannot recover an output already deleted by retention. See the [retention policy](https://mediaruntime.com/en/legal#retention). The account logo is a separate reusable asset; the job's output bundle is temporary.

This demo retains local originals, ZIPs, outputs, configuration and records until you remove them. Apply your own lifecycle policy and access controls. Private records contain provider source URIs; do not publish the media directory or commit `.env`.

This is a single-user loopback teaching app. Host/Origin checks are not authentication. Header/dimension checks do not prove arbitrary media is safe. Production needs authenticated users, per-record authorization, upload scanning and isolation, quotas, durable shared storage, a durable queue, bounded retries/dead letters, and monitoring. Use verified terminal webhooks from [episode 04](../04-reliable-webhooks/) rather than long polling at scale. Account-wide logo changes need coordination across clients. The in-process worker is not a distributed job system; its pending list and connection retries need production limits.

## Demo media attribution

The recording uses the same 2.08-second silent Bunny excerpt from earlier episodes; both players loop. Big Buck Bunny: © 2008 Blender Foundation / [www.bigbuckbunny.org](https://www.bigbuckbunny.org/), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). A MediaRuntime demo logo is added to the output. This does not imply endorsement or ownership of the underlying film. Use media and logos you have permission to process.

References: [MediaRuntime API documentation](https://mediaruntime.com/en/docs), [Node SDK](https://github.com/ericel/mediaruntime-node-sdk).
