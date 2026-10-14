# Build a Video Upload and Processing Pipeline in Laravel

Upload an MP4, process it asynchronously with MediaRuntime, verify a completion webhook, copy the finished MP4 into your own storage, and play it in a browser. This is a runnable Laravel 13 teaching app, with core integration code instead of a MediaRuntime SDK dependency.

## Requirements and setup

PHP 8.3+ with cURL, ZIP, PDO SQLite, mbstring and XML; Composer 2; a MediaRuntime test API key and credits; an MP4 you have permission to process (up to 20 MB). No local FFmpeg is needed by this application.

```bash
git clone https://github.com/ericel/mediaruntime-quickstarts.git
cd mediaruntime-quickstarts/tutorials/04-laravel-video-pipeline
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate
```

Set `MEDIARUNTIME_API_KEY` privately in `.env`. Keep `.env` outside the served `public/` directory and out of Git, recordings and browser code. Set `MEDIA_ROOT` to an absolute private working directory if temporary uploads and bundles should live on another drive.

Run these in three terminals:

```bash
php -d upload_max_filesize=21M -d post_max_size=22M artisan serve
php artisan queue:work --timeout=300 --sleep=1
php artisan schedule:work
```

Open **http://127.0.0.1:8000**, upload a video, then watch its status and play the saved output. The scheduler checks unfinished records once a minute; it also enables a working local run without a public callback. For a deliberately polling-only run, set `MEDIARUNTIME_DELIVER_WEBHOOK=false` before submission. This suppresses callbacks for those jobs; retry-webhook cannot override that opt-out.

The example deliberately uses the **database queue on the same database connection as the models**, with `after_commit=false` and `retry_after=360`. Leave `DB_QUEUE_CONNECTION` unset. This allows the inbox and queue row to commit in one database transaction. Switching to Redis or a separate queue database requires a transactional outbox and dispatcher, not just an environment-variable change. The worker timeout must remain shorter than `retry_after`.

## Configure real completion callbacks

1. Deploy the signed receiver at `POST https://YOUR_HOST/webhooks/mediaruntime`, or expose only that route through a temporary development tunnel.
2. In the **same MediaRuntime account as your API key**, open Account → Developer settings → Webhooks, register the HTTPS endpoint, and save its view-once signing secret as `MEDIARUNTIME_WEBHOOK_SECRET`.
3. Restart long-running workers after changing configuration. Submit a fresh job with `MEDIARUNTIME_DELIVER_WEBHOOK=true`.
4. The result card should show **Webhook verified** and **Completed via webhook**. The browser still polls your local application for display updates; it never receives the API key or signing secret.

Use a dedicated test account when changing webhook destinations; registering an active endpoint can change where that account's other job callbacks go. A temporary tunnel is a development tool, and its URL stops working when the tunnel ends. Remove the temporary endpoint afterward. Do not expose the tutorial's unauthenticated upload page publicly.

The callback lives in Laravel's stateless API route group. Normal browser upload routes retain CSRF protection.

## Verify, persist, acknowledge

The provider signature covers the exact raw body:

```text
HMAC-SHA256(secret, timestamp + "." + event_id + "." + raw_body)
```

Headers are `X-Transcoder-Id`, `X-Transcoder-Timestamp`, and `X-Transcoder-Signature: t=TIMESTAMP,v1=HEX_DIGEST`. `WebhookVerifier` rejects missing configuration, bodies above 64 KB, invalid signatures, timestamps more than five minutes away, and mismatched event IDs. It verifies bytes before trusting parsed JSON.

`WebhookController` inserts a uniquely keyed inbox record and queues `HandleWebhook` in one database transaction, then returns HTTP 204. A duplicate event receives 204 without another queue entry. A queue failure rolls back the insert and does not acknowledge success. The inbox deliberately keeps only event ID, job ID and status, not raw payloads or signed delivery URLs.

An event can arrive before submission has saved its remote job ID. `HandleWebhook` retries matching for up to two minutes. Events for unrelated jobs then become `unmatched`. Once matched, it records the verified callback and queues `AdvanceVideo`. **The event wakes the worker; the authenticated status API decides whether an output is ready.** A failed/rejected/partial result is never published as a completed video.

`state=queued` means completion work was queued, not that playback is ready. The video record becomes `ready` only after the object-storage write succeeds.

## Own the finished output

Default `MEDIA_DISK=local` uses Laravel's private local disk. Set `MEDIA_LOCAL_ROOT` to move saved files to another private path.

For an S3-compatible bucket:

```dotenv
MEDIA_DISK=s3
AWS_ACCESS_KEY_ID=YOUR_STORAGE_KEY
AWS_SECRET_ACCESS_KEY=YOUR_STORAGE_SECRET
AWS_DEFAULT_REGION=us-east-1
AWS_BUCKET=YOUR_PRIVATE_BUCKET
# For an alternative S3 provider:
# AWS_ENDPOINT=https://your-storage-endpoint
# AWS_USE_PATH_STYLE_ENDPOINT=true
```

Create the private bucket and grant only the needed object read/write permissions. The included Flysystem S3 adapter streams the MP4 to a stable `videos/LOCAL_UUID/video.mp4` key. Repeating completion replaces that same key instead of creating another rendition. A storage failure leaves the record unfinished for retry.

The source first goes to the object-storage upload target returned by MediaRuntime. After completion, the worker downloads the temporary ZIP, validates its archive entries, requires exactly one MP4 rendition and an ISO MP4 header, then streams that file to **your configured Laravel disk**. It does not execute FFmpeg, guess a remote filename, or unpack arbitrary paths.

For local playback, the ownership-checked route returns the saved file with range support. For S3, that route returns a five-minute signed URL to your private saved object. The browser endpoint in `AWS_ENDPOINT` must be reachable by the browser as well as the worker. This new storage URL has its own expiry; it is not a MediaRuntime delivery URL. Refreshing the application obtains a new playback URL. A larger streaming product should add token renewal/CDN delivery and suitable CORS settings.

The recorded local demo uses an S3-compatible **test server**, not a production cloud bucket. The same Laravel disk integration supports a real configured bucket. Automated tests use fixture responses and fake storage; no credits are spent by the test suite.

## Recovery and retention

`media:reconcile` queues checks for unfinished records older than one minute. Existing `source_uri` and `job_id` prevent normal recovery from uploading/submitting again. Submission also uses a stable idempotency key. Workers share a per-video lock; transient failures retry with bounded backoff. After 30 minutes, the application stops that record and tells you to inspect it. Keep the scheduler running even when webhooks work.

**MediaRuntime inputs and outputs are temporary. Download needed results promptly and keep your own copies.** As checked October 14, 2026:

- Eligible uploaded inputs become cleanup candidates five days after creation.
- Output cleanup requires all applicable deadlines to pass: seven days after job completion, seven days after output creation, and any later recorded delivery expiry.
- Candidates then have at least 24 hours of grace and another safety check. Deletion can happen later.
- Download links and tokens expire separately. These cleanup thresholds do **not** guarantee seven days of download access. Follow the job's returned expiry.

See the [current retention policy](https://mediaruntime.com/en/legal#retention). MediaRuntime cleanup does not delete your independent local/S3 copy. This app removes its temporary input, ZIP and working MP4 after publication; it does not expire saved objects, failed-run inputs, inbox records or video records. Add your own cleanup, backups and lifecycle rules. Keep original media you need before processing.

## Code map and tests

| File | Responsibility |
| --- | --- |
| `VideoController` | Upload, session ownership, status and playback |
| `AdvanceVideo` | Upload/submit, authoritative completion check, output download/storage |
| `WebhookVerifier` | Raw-body HMAC and timestamp validation |
| `WebhookController` | Atomic inbox + queue before acknowledgment |
| `HandleWebhook` | Match callback to saved job, enqueue completion work |
| `Mp4Archive` | Bounded archive handling and MP4 header check |
| `routes/console.php` | Recovery command and one-minute schedule |

```bash
composer test
php artisan media:reconcile
```

Tests cover duplicate callbacks, stale/tampered signatures, queue rollback, early callbacks, unrelated jobs, authoritative status, terminal failures, recovery, storage failure, archive rejection, ownership and queued uploads.

## Before production

Add authenticated users, quotas, supervised workers and scheduler, durable multi-worker storage, metrics, error handling, and cleanup. This sample uses session ownership and a single-server temporary working directory; distributed workers must share or replace that input storage. The MP4 check validates the container header, not every codec packet. Limits are 20 MB uploads, 100 MB bundle/expanded data, and 1,000 ZIP entries. Use HTTPS, an appropriately restricted storage identity, and avoid logging secrets, callback bodies or signed URLs. Inspect failed remote jobs before manually retrying to avoid unnecessary processing.

References: [MediaRuntime docs](https://mediaruntime.com/en/docs), [OpenAPI](https://mediaruntime.com/openapi.json), [Laravel queues](https://laravel.com/docs/13.x/queues), [Laravel storage](https://laravel.com/docs/13.x/filesystem).
