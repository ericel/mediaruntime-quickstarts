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
