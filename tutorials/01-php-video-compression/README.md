# How to Compress Videos in PHP Without Installing FFmpeg

Tutorial 01 · Core PHP · PHP 8.2+ and ext-curl · No Composer dependencies

Submit a video URL, wait for asynchronous processing, and download the resulting ZIP.
**No FFmpeg installation is needed on your PHP server.** MediaRuntime performs the
encoding remotely. This is a paid processing service; check your account balance
and [current pricing](https://mediaruntime.com/en/pricing) before submitting jobs.

## What this example produces

`video.web` requests MediaRuntime's maintained 720p H.264/AAC MP4 preset plus a JPG
poster. Lower resolution and re-encoding can reduce a large source video, but
**a smaller file is not guaranteed**: an already optimized source can become larger.
Compare the extracted MP4's byte size and visual quality with your original. The
ZIP also contains other artifacts, so its size is not the video compression ratio.

## 1. Prerequisites

- PHP 8.2 or newer with cURL enabled (`php --ri curl`).
- A MediaRuntime account, API key, and sufficient processing credits.
- A video you own or have permission to process, reachable through HTTPS.
- Enough disk space for the downloaded ZIP and extracted files.

A signed source URL must stay accessible through queueing and source download.
This example accepts a URL; it does not upload local files. See the optional
upload endpoint in the [API docs](https://mediaruntime.com/en/docs) for local bytes.

## 2. Configure the example

```sh
git clone https://github.com/ericel/mediaruntime-quickstarts.git
cd mediaruntime-quickstarts/tutorials/01-php-video-compression
php --version
php --ri curl
```

Provide `MEDIARUNTIME_API_KEY` through your server's secret manager or local secret
injection. Never put the key in browser JavaScript, a Git commit, a recording, or
a command you will share. For an interactive Bash session, hide it while typing:

```bash
read -r -s -p 'MediaRuntime API key: ' MEDIARUNTIME_API_KEY
printf '\n'
export MEDIARUNTIME_API_KEY
```

Set the remaining environment variables (substitute your own HTTPS source):

```sh
export MEDIARUNTIME_SOURCE='https://your-storage.example/video.mp4'
export MEDIARUNTIME_IDEMPOTENCY_KEY='php-compression-asset-001-v1'
export MEDIARUNTIME_DOWNLOAD_PATH="$PWD/outputs.zip"
php compress.php
```

`.env.example` documents the variables; the script does **not** automatically load
`.env`. Reuse the idempotency key only for the same logical request and payload.
Use a new key for another video or changed processing request.

For this tutorial production workspace, direct downloads to the external SSD:

```sh
export MEDIARUNTIME_DOWNLOAD_PATH='/Volumes/External_SSD/mediaruntime/tutorial-01-php-compression/output/my-job.zip'
```

The destination directory must already exist and the filename must be unused.
No source or output videos should be committed to this repository.

## 3. Understand the request

The script sends an authenticated `POST /v1/jobs` with this payload:

```json
{
  "source": "https://your-storage.example/video.mp4",
  "outputs": ["video.web"],
  "metadata": {"tutorial": "php-video-compression"}
}
```

It prints the returned `job_id` immediately, then polls `GET /v1/jobs/{job_id}`
every two seconds, for up to 15 minutes. Submission is not completion. Only
`COMPLETED` permits downloading; `FAILED`, `REJECTED`, and `PARTIAL` fail explicitly.
Authentication failures, invalid JSON, and unexpected statuses stop the script.

For longer processing, set `MEDIARUNTIME_TIMEOUT_SECONDS`. This is a CLI tutorial;
do not run its polling loop inside a web request. In production, persist the job
ID in your database and handle signed completion webhooks in a background workflow.

## 4. Download and inspect

The script reads `bundle.download_url` from the single-job response. It downloads
with a separate cURL request **without your API key**, follows HTTPS redirects,
streams to disk, checks HTTP success and the ZIP signature, and publishes the file
without replacing an existing output. The signature check is not a full integrity
or malware check. Interrupted downloads are removed.

```sh
unzip -l "$MEDIARUNTIME_DOWNLOAD_PATH"
# Choose a fresh directory on the same drive as the ZIP:
unzip "$MEDIARUNTIME_DOWNLOAD_PATH" -d '/path/to/new/extracted-output'
```

Inspect the bundle instead of assuming MP4 or poster filenames. Play the MP4 locally
and compare quality and file size. Copy retained outputs to storage you control;
signed URLs expire and MediaRuntime output storage is temporary. Consult the
[current retention policy](https://mediaruntime.com/en/legal) before relying on it.
Do not publish signed source or bundle URLs in screenshots, logs, or recordings.

## 5. Resume safely

If polling times out or a download fails, use the job ID printed earlier:

```sh
export MEDIARUNTIME_JOB_ID='job_your_existing_job'
php compress.php
```

This skips submission and queries the existing job for its current bundle URL.
It does not recover artifacts already deleted by retention. For a new job, unset
`MEDIARUNTIME_JOB_ID` and supply a new source/idempotency key. For a 429 or transient
server error, back off before manually resuming. The example does not automatically
retry HTTP failures or hide authentication/billing errors.

## Offline verification

```sh
python3 test_example.py
```

These tests use PHP and a local HTTP fixture. They exercise submission, polling,
resume, API-key isolation on redirects, failed jobs, invalid responses, timeouts,
invalid archives, and preservation of existing files. They use no production key
and process no media. The test ZIP contains only `FIXTURE.txt`.

The accompanying video labels fixture responses and abbreviated code explicitly.
A live account-based end-to-end run is not claimed by these tests.

References: [API documentation](https://mediaruntime.com/en/docs),
[video encoding](https://mediaruntime.com/en/products/video-encoding),
[PHP cURL](https://www.php.net/manual/en/book.curl.php).
