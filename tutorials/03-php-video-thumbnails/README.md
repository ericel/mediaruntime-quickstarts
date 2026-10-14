# Generate Video Thumbnails Using PHP

Upload an MP4, request one poster frame from MediaRuntime, and display the saved JPEG in an HTML page. Core PHP 8.2+, cURL, ZIP, and fileinfo; no Composer or local FFmpeg required.

**MediaRuntime outputs are temporary.** This example downloads the completed bundle promptly and copies the JPEG to your application's storage before displaying it. Never use a temporary MediaRuntime download link as the permanent `src` of an image on your website.

## Run it

```bash
git clone https://github.com/ericel/mediaruntime-quickstarts.git
cd mediaruntime-quickstarts/tutorials/03-php-video-thumbnails
cp .env.example .env
```

Set `MEDIARUNTIME_API_KEY` in the private `.env` file. Use a test key with sufficient processing credits. Set `MEDIA_ROOT` to an absolute path outside `public/` if you want media on another drive. Environment variables take precedence over `.env`. Keep secrets out of command arguments, browser code, screenshots and Git.

Terminal 1:

```bash
php -d upload_max_filesize=21M -d post_max_size=22M -S 127.0.0.1:8000 -t public
```

Terminal 2:

```bash
php worker.php
```

Open **http://127.0.0.1:8000**, select an MP4 you have permission to process (up to 20 MB), and choose a timestamp inside its duration. Click **Generate thumbnail**. When ready, the page displays the saved JPEG, its dimensions, and a download link. Refreshing the page reads that same saved copy.

Only serve the `public/` directory. This is a local, single-server demonstration: the PHP development server must not be exposed as a public production service. Browser-session ownership scopes access; losing the session loses access to its records in the UI.

## The exact request

After requesting `POST /v1/upload-url` and uploading the local file with the returned headers, submit the returned `file_uri`:

```json
{
  "source": "gs://your-upload-location/input.mp4",
  "outputs": [{
    "type": "mp4",
    "preset": "poster_frame_v1",
    "poster_time_sec": 4,
    "poster_format": "jpg"
  }]
}
```

`poster_frame_v1` produces one 720p JPEG poster. The request's `type` remains `mp4` even though this preset produces an image. `poster_time_sec` is in seconds, relative to the start of the source. Choose a point within the video; this example does not probe duration locally. Do not use `type: image` for this video-poster recipe.

The worker saves `source_uri` and `job_id` in private JSON state and uses an idempotency key derived from the local record ID. Subsequent passes poll the existing job, rather than submitting another transcode. It checks pending work every three seconds, stops after three processing exceptions or a thirty-minute deadline, and treats failed/rejected/partial/cancelled results as terminal. File locks prevent simultaneous workers from processing the same record.

On `COMPLETED`, it downloads `bundle.download_url`, follows at most three HTTPS redirects without the account API key, then inspects the ZIP. It finds exactly one JPEG by archive contents, validates its format, and saves it under its own application-controlled filename. It does not guess the remote filename or expand arbitrary archive paths.

The browser receives `image.php?id=...`, **your application's URL**, not a signed remote storage URL. That endpoint verifies session ownership and serves the saved JPEG with the correct content type.

## Media retention: storage and access have different deadlines

Policy checked on **October 14, 2026** against the published policy copy and cleanup implementation. Always consult the [current media retention policy](https://mediaruntime.com/en/legal#retention).

- **Uploaded source files are temporary.** Eligible uploads become cleanup candidates five days after object creation. Your own external source storage is not deleted by this cleanup.
- **Outputs, bundles, and job-local reports are temporary too.** Cleanup eligibility requires all applicable deadlines to have passed: seven days after job completion, seven days after output-object creation, and any later delivery expiry recorded for that job.
- Eligible objects are staged and must pass another safety check at least **24 hours later**. Safety checks and operational conditions can delay deletion. These are eligibility thresholds, not exact deletion times or maximum retention periods.
- **Download links and access tokens expire separately.** Follow the expiry returned for the job and copy required results before access expires. Output storage does not extend its link or guarantee seven days of download access.
- Keep your own copy of both source media and outputs you need. Protected sandbox source assets are excluded from cleanup; generated sandbox outputs can expire under the output rules.

The app therefore saves the JPEG immediately after completion. On success it deletes its local uploaded input and downloaded ZIP, while preserving the saved JPEG and job state. **Local JPEGs do not auto-expire in this tutorial.** Set your own retention/backup/deletion policy for these copies. Failed-run inputs also remain for inspection. MediaRuntime cleanup does not manage this application's disk.

## Files

| File | Purpose |
| --- | --- |
| `app.php` | API requests, uploads, bounded downloads, JPEG validation and private state |
| `worker.php` | Poll/process pending records with file locks |
| `public/index.php` | Upload form, thumbnail gallery and retention notice |
| `public/upload.php` | Validated multipart uploads and CSRF checks |
| `public/status.php` | Session-owned public status |
| `public/image.php` | Serve your saved JPEG privately |
| `public/app.js` | Upload interaction, status polling and image display |

## Tests

```bash
python3 test_example.py
```

Tests use real PHP/cURL with a local controlled API and tiny original JPEG fixture. They exercise upload headers, idempotent resume, redirects, credential isolation, unsafe ZIPs, terminal failures, deadlines, CSRF, and cross-session access. They do not spend API credits. The video separately shows an actual MediaRuntime thumbnail job and the saved JPEG rendered in Chrome.

## Before production

Add authenticated users, per-account quotas, durable storage, a supervised queue or verified completion webhooks, observability, and a defined cleanup policy. This worker is intentionally simple and processes records sequentially; it is not a distributed queue. Limits are 20 MB uploads, 50 MB downloaded/expanded bundles, 1,000 archive entries, and a 20-megapixel JPEG header limit.

Interrupted work preserves state. Before manually retrying a failed record, inspect its remote job to avoid duplicate processing or charging. A lost submit response reuses the same idempotency key, subject to the API's deduplication window. Never print signed URLs or raw HTTP errors to public pages.

References: [API docs](https://mediaruntime.com/en/docs), [OpenAPI](https://mediaruntime.com/openapi.json), [PHP cURL](https://www.php.net/manual/en/book.curl.php), [PHP ZIP](https://www.php.net/manual/en/book.zip.php).
