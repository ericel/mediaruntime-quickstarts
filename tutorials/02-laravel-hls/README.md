# Convert MP4 to HLS (M3U8) in Laravel

A runnable Laravel 13 application: upload an MP4, queue MediaRuntime processing, download the completed output bundle, and play the HLS result in your browser. No local FFmpeg installation is required by the application.

## Requirements

- PHP 8.3+ with cURL, ZIP, PDO SQLite, mbstring, XML, and the standard Laravel extensions.
- Composer 2; a MediaRuntime API key and sufficient processing credits.
- A modern browser. The player uses pinned hls.js 1.7.3 with native HLS fallback.
- An MP4 you have permission to process (20 MB maximum for this example).

## Run it

```bash
git clone https://github.com/ericel/mediaruntime-quickstarts.git
cd mediaruntime-quickstarts/tutorials/02-laravel-hls
composer install
cp .env.example .env
php artisan key:generate
php scripts/install-player.php
touch database/database.sqlite
php artisan migrate
```

Edit `.env` and set `MEDIARUNTIME_API_KEY`. Never put this key in JavaScript or commit `.env`. Optionally set `MEDIA_ROOT` to an absolute directory on another drive. The default API base is `https://mediaruntime.com`.

Start the web server:

```bash
php -d upload_max_filesize=21M -d post_max_size=22M artisan serve
```

In a second terminal, from the same directory:

```bash
php artisan queue:work --timeout=300 --sleep=2
```

Open **http://127.0.0.1:8000**, choose your MP4, and click **Create HLS stream**. The page checks status every three seconds. When ready, press play. The player displays available renditions (height when provided by the master, otherwise bitrate) and provides a link to the master M3U8 playlist. Safari can use its native HLS support.

The queue is mandatory: `QUEUE_CONNECTION=database`, not `sync`. The example sets the database queue's `retry_after` to 360 seconds, longer than the 300-second worker timeout. Restart the worker after changing code or configuration.

## The processing flow

1. `VideoController::store` validates the upload, saves it privately, creates a session-owned video record, and dispatches `ProcessVideo`.
2. `MediaRuntime::upload` requests `POST /v1/upload-url`, uploads the file with `PUT` and the returned `upload_headers`, then saves `file_uri`.
3. `MediaRuntime::submit` calls `POST /v1/jobs` with that source and `outputs: ["video.streaming"]`. A stable idempotency key derives from the local video UUID.
4. The queue job saves the remote job ID. Each later attempt polls `GET /v1/jobs/{job_id}` instead of submitting another processing job. Pending work is released for ten seconds; remote failures and the thirty-minute application deadline stop processing.
5. On `COMPLETED`, the job downloads `bundle.download_url` without sending the API key to storage. `HlsArchive` validates and extracts the HLS files, preserving their hierarchy. It discovers the master playlist by `#EXT-X-STREAM-INF` instead of guessing a filename.
6. Laravel serves the master, variant playlists, and segments through the session-scoped media route. hls.js loads the master and requests the needed segments.

MediaRuntime returns an output bundle; it is not the hosting origin for this application's player. The example publishes extracted HLS files on **your Laravel server**. A master playlist alone is insufficient: its referenced playlists and segments must remain reachable at the correct relative paths.

## Code map

| File | Responsibility |
| --- | --- |
| `app/Http/Controllers/VideoController.php` | Upload validation, ownership, status, media responses |
| `app/Jobs/ProcessVideo.php` | Queued upload, submission, polling, completion |
| `app/Services/MediaRuntime.php` | Server-side HTTP integration |
| `app/Services/HlsArchive.php` | Bounded ZIP extraction and playlist validation |
| `resources/views/videos.blade.php` | Upload form and result player |
| `public/app.js` | Status polling and HLS playback |
| `tests/Feature/HlsWorkflowTest.php` | Offline workflow and boundary tests |

## Verify the browser result

Open browser developer tools → Network and filter for `m3u8` or `ts`. After pressing play, you should see a master playlist, a variant playlist, and segment responses. Seek in the video and confirm playback continues. These responses come from `/videos/{id}/media/...` and should not contain your MediaRuntime API key.

```bash
composer test
```

The automated tests fake API responses; they do not spend processing credits. They cover upload validation, queue dispatch/resume, terminal failures, deadlines, credential isolation, session ownership, and unsafe/incomplete archives. The recorded tutorial additionally demonstrates an actual MediaRuntime processing run and browser playback.

## Boundaries before production

This is a single-server teaching app, not a complete video platform. Use authenticated users, quotas, durable object storage, supervised workers, observability, and signed CDN access for production. The session token only scopes this local demonstration; losing the browser session loses access to its results. Never expose an unauthenticated tutorial upload form to the public internet.

The tutorial limits downloads and expanded archives to 200 MB and 5,000 entries, rejects symlinks and traversal, and rejects external playlist references. It accepts a single HLS master with local assets. The API key is used only for API requests, never storage downloads or the browser. Redirects are disabled on authenticated API calls and uploads. Bundle downloads follow at most three HTTPS redirects without account authentication; MediaRuntime currently redirects its bundle endpoint to signed object storage.

A successful run deletes the local input and downloaded ZIP after publishing HLS. Extracted HLS files, failed-run inputs, and database records remain until you remove them. Configure your own cleanup policy; remote MediaRuntime retention does not clean up your Laravel storage. Download completed bundles before their remote availability expires.

An interrupted upload may leave a remote temporary object; a lost submit response is retried with the same idempotency key, subject to the API's deduplication window. Before manually rerunning a failed record, inspect its remote job to avoid unnecessary repeat processing.

## References

- [MediaRuntime API documentation](https://mediaruntime.com/en/docs)
- [MediaRuntime OpenAPI contract](https://mediaruntime.com/openapi.json)
- [Laravel queues](https://laravel.com/docs/13.x/queues)
- [Laravel HTTP client](https://laravel.com/docs/13.x/http-client)
- [hls.js](https://github.com/video-dev/hls.js)

Laravel is MIT licensed; see `LICENSE`. hls.js is Apache-2.0 licensed; its license is included in `scripts/hls.LICENSE`. The player installer verifies the pinned script's SHA-256 hash.
