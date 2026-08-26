# Node.js quickstart

This example uses the official [`@mediaruntime/node`](https://www.npmjs.com/package/@mediaruntime/node) SDK. Node.js 22 or newer is required.

```bash
cd node
npm install
cp ../.env.example ../.env
# Edit ../.env, then:
npm start
```

`MEDIARUNTIME_SOURCE` may be an HTTP(S) URL, a `gs://` URI, or a local file path. Local files are uploaded automatically by the SDK. The example submits `video.web`, waits for a terminal status, and saves the complete ZIP bundle to `MEDIARUNTIME_DOWNLOAD_PATH`.

For a real service, persist `job.id` and consume signed terminal webhooks instead of keeping one process open to poll.
