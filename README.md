# MediaRuntime quickstarts

Small, runnable examples for submitting MediaRuntime jobs, waiting for completion, downloading the canonical ZIP bundle, and verifying signed terminal webhooks.

## Choose a quickstart

| Directory | Client | Status |
| --- | --- | --- |
| [`node/`](node/) | Official `@mediaruntime/node` SDK | Supported |
| [`stickers-node/`](stickers-node/) | Hosted Sticker Runtime, Node.js API-key example | Supported |
| [`stickers-python/`](stickers-python/) | Hosted Sticker Runtime, Python API-key example | Supported |
| [`python/`](python/) | Official `mediaruntime` SDK | Supported |
| [`go/`](go/) | Standard-library HTTP client | API example; no official Go SDK yet |
| [`php/`](php/) | Guzzle HTTP client | API example; no official PHP SDK yet |
| [`webhooks/node-express/`](webhooks/node-express/) | Express webhook receiver | Supported SDK verifier |
| [`webhooks/python-fastapi/`](webhooks/python-fastapi/) | FastAPI webhook receiver | Supported SDK verifier |
| [`postman/`](postman/) | Import the live OpenAPI contract | No code required |

## Prerequisites

1. Create an API key in your MediaRuntime account.
2. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

3. Set `MEDIARUNTIME_API_KEY` and a source that MediaRuntime can read. Node and Python also accept a local file path and upload it automatically.

Never put a production API key in frontend, mobile, or public repository code. The examples read credentials only from environment variables.

## Output model

Each completed job exposes one expiring download URL for its canonical ZIP bundle. The bundle may contain a video, poster, subtitles, renditions, reports, or a complete streaming directory tree. Examples save that bundle as `outputs.zip`; they do not assume one job produces one media file.

For production applications, persist the returned job ID and finish the workflow from the signed terminal webhook configured under **Account → Webhooks**. Polling is used here because it makes a first run easy to understand.

## API contract

The public OpenAPI 3.1 contract is available at:

```text
https://mediaruntime.com/openapi.json
```

Run the lightweight contract check with Node.js 22 or newer:

```bash
node scripts/check-openapi.mjs
```

The production API URL is built into the official SDKs. `MEDIARUNTIME_BASE_URL` is only an optional override for local gateways, staging, and test doubles used by the raw HTTP examples.

## Security

- Keep API keys and webhook secrets in a secret manager in production.
- Verify webhook signatures against the exact raw request bytes before parsing JSON.
- Deduplicate webhook deliveries by `X-Transcoder-Id`.
- Treat QR/barcode values, metadata, filenames, and webhook metadata as untrusted input.
- Never commit `.env`, downloaded bundles, or source media.

## License

MIT
