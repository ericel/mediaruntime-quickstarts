# Convert Audio Files in PHP Without Running FFmpeg

Convert a WAV recording to AAC audio in an M4A container using MediaRuntime, save the output, and play it in a browser. Core PHP 8.2+, cURL, ZIP and fileinfo; no Composer or local FFmpeg required by the application.

This focused example accepts **WAV input up to 20 MB** and requests `audio.web` (128 kbps AAC/M4A). AAC is lossy: a smaller file is not a promise of identical audio quality. The sample accepts WAV deliberately; adding other input/output formats requires corresponding validation and playback handling.

## Run locally

```bash
git clone https://github.com/ericel/mediaruntime-quickstarts.git
cd mediaruntime-quickstarts/tutorials/05-php-audio-conversion
cp .env.example .env
```

Set `MEDIARUNTIME_API_KEY` privately in `.env`, using a test key with processing credits. Set `MEDIA_ROOT` to a private absolute directory outside `public/` to store files on another drive. Exported environment variables take precedence. Never put the key in browser code, screenshots or Git.

Terminal 1:

```bash
php -d upload_max_filesize=21M -d post_max_size=22M -S 127.0.0.1:8000 -t public
```

Terminal 2:

```bash
php worker.php
```

Open **http://127.0.0.1:8000**, upload a WAV you have permission to process, and choose **Convert audio**. Once ready, press play: the waveform responds to the decoded audio, and the timer advances. Refresh and seek to verify the saved copy. Use **Download saved M4A** to keep another copy.

Only serve `public/`. This is a local single-server teaching app; do not expose the PHP development server publicly. Browser session ownership protects each result. Losing that session loses access through this UI; it does not delete saved files.

## The asynchronous workflow

1. `public/upload.php` checks CSRF, upload size, WAV MIME type and RIFF/WAVE header. It stores a private input and a queued JSON record, then returns HTTP 202 without waiting for conversion.
2. A separate `worker.php` pass locks the record and calls `POST /v1/upload-url` with `content_type: audio/wav`.
3. It uploads the source to the returned target using the returned headers, keeping the account API key off storage requests, and saves `file_uri`.
4. It submits a conversion and immediately saves the returned `job_id`:

```json
{
  "source": "gs://your-upload-location/input.wav",
  "outputs": ["audio.web"],
  "deliver_webhook": false
}
```

`audio.web` maps to `{ "type": "audio", "preset": "audio_aac_128k" }`. The example intentionally uses polling, so provider webhook delivery is disabled for this job. No webhook configuration or simulation is needed.

5. Later passes call `GET /v1/jobs/{job_id}`. Pending work stays pending. Failed, rejected, partial and cancelled results are terminal.
6. On `COMPLETED`, download `bundle.download_url` promptly, inspect the ZIP, stream exactly one M4A to an application-controlled filename, and publish it atomically. Only then mark the record ready.
7. The browser uses `media.php?id=LOCAL_ID`, your application's session-owned URL, rather than the remote temporary delivery URL.

The account key is sent only to the configured API base. Bundle downloads follow at most three HTTPS redirects with a separate cURL request and no account key. Never accept an arbitrary client-supplied API base or download target.

## Resume, storage and playback

Private state retains `source_uri` and `job_id`, so normal worker restarts reuse the existing job. Submission uses a stable `php-audio-LOCAL_ID` idempotency key, subject to the provider's deduplication window. Polling runs every three seconds. After three exceptions or a thirty-minute deadline the example stops the record. Inspect the remote job before manually retrying to avoid unnecessary processing.

Archive checks reject unsafe paths, symlinks, ambiguous outputs, over 1,000 entries and over 50 MB downloaded/expanded data. Only the chosen entry is streamed; arbitrary ZIP paths are never extracted. The M4A check validates its ISO media container header, **not every AAC packet**. Playback errors are surfaced in the player. Browser decoding and a separate media probe verify the actual tutorial result.

`public/media.php` checks ownership and serves `audio/mp4` with private/no-store caching. It implements a single HTTP byte range (206), unsatisfiable ranges (416), suffix ranges and HEAD requests. This supports native audio seeking without loading the whole file into PHP memory. Multiple ranges are intentionally unsupported. A production service should normally delegate private media delivery to suitable storage/CDN infrastructure.

The waveform uses the browser's Web Audio analyser on the actual decoded player audio. It is not an invented activity indicator or evidence of processing quality.

## Outputs are temporary: save your own copy

As checked October 14, 2026 against the published policy and cleanup implementation:

- Eligible uploaded inputs become cleanup candidates five days after object creation.
- Outputs, bundles and job-local reports require all applicable thresholds to pass: seven days after job completion, seven days after output creation, and any later recorded delivery expiry.
- Cleanup candidates then wait at least 24 hours and pass another safety check. These are eligibility thresholds, not exact deletion deadlines or maximum storage durations.
- **Download links/tokens expire separately.** Stored output does not guarantee seven days of download access. Follow the job's returned expiry and download promptly.

See the [current retention policy](https://mediaruntime.com/en/legal#retention). Save needed originals and converted outputs in storage you control. MediaRuntime cleanup does not delete your independent copies.

After successful publication, this app removes its local uploaded input and ZIP. It keeps the saved M4A and private job record; failed-run inputs also remain. It does not automatically expire those local files. Set your own cleanup, backups and lifecycle policy.

## Tests

```bash
python3 test_example.py
```

Eight offline integration tests exercise real PHP/cURL with a controlled HTTP server: conversion payloads, saved-ID resume, credential separation, download redirects, unsafe bundles, terminal failures, deadlines, invalid WAV uploads, CSRF, session isolation, downloads, HEAD and byte ranges. Tiny container-header fixtures test transport and file handling, not audio decoding. Tests use no API credits.

The tutorial separately demonstrates a real MediaRuntime conversion of an original 14-second synthesized melody, plus playback and seeking in Chrome. The audible demonstration excerpt comes from that converted output. No third-party recording is used.

## Files and production considerations

| File | Responsibility |
| --- | --- |
| `app.php` | API client, source upload, bounded download, archive handling, state and ranges |
| `worker.php` | Sequential polling with per-record file locks |
| `public/upload.php` | WAV upload validation and CSRF |
| `public/status.php` | Session-owned status without remote credentials or IDs |
| `public/media.php` | Private saved audio playback/download |
| `public/index.php`, `public/app.js` | Upload form, native audio player and real waveform |

Before production, add authenticated users, quotas, shared durable storage, supervised workers, observability and cleanup. This sequential JSON/file-lock worker is not a distributed queue. Source header checks are format screening rather than full validation; malformed or unsupported WAV encodings can still fail remote processing.

References: [MediaRuntime docs](https://mediaruntime.com/en/docs), [API contract](https://mediaruntime.com/openapi.json), [PHP cURL](https://www.php.net/manual/en/function.curl-setopt.php), [PHP binary output](https://www.php.net/manual/en/function.fpassthru.php).
