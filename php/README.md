# PHP quickstart

MediaRuntime does not yet publish an official PHP SDK. This example uses Guzzle and the public HTTP API. PHP 8.2 or newer and Composer are required.

```bash
cd php
composer install
cp ../.env.example ../.env
# Export MEDIARUNTIME_API_KEY and MEDIARUNTIME_SOURCE in your shell.
php run.php
```

Unlike the official Node and Python SDKs, this raw HTTP example requires an HTTP(S) or `gs://` source. It does not upload a local file automatically.

The production API URL is built in. Set `MEDIARUNTIME_BASE_URL` only when testing against a local gateway or staging environment.

## PHP tutorial series

Start with [How to Compress Videos in PHP Without Installing FFmpeg](../tutorials/01-php-video-compression/README.md) for a dependency-free cURL example with polling, safe resume, ZIP download, and offline integration tests.

Continue with [Convert MP4 to HLS (M3U8) in Laravel](../tutorials/02-laravel-hls/README.md) for a queued upload-to-browser-playback application.

Then try [Generate Video Thumbnails Using PHP](../tutorials/03-php-video-thumbnails/README.md): upload a video, save a poster frame, and display it with explicit temporary-output retention guidance.

Then build [a Video Upload and Processing Pipeline in Laravel](../tutorials/04-laravel-video-pipeline/README.md), with signed callbacks, durable inbox/queue writes, recovery checks and private output storage.

Next, [Convert Audio Files in PHP Without Running FFmpeg](../tutorials/05-php-audio-conversion/README.md): WAV to AAC/M4A, with private saved-output playback and seeking in the browser.
