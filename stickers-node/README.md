# Hosted Sticker Runtime quickstart

This dependency-free Node.js example uses a server-side workspace API key to search one
active sticker collection, resolve the first result's `small_160` WebP, verify the
approved bytes, and save it locally. This is the recommended flow for backend services
and matches the normal MediaRuntime `X-API-Key` authentication model.

```bash
cp .env.example .env

# Set MEDIARUNTIME_API_KEY and MEDIARUNTIME_STICKER_COLLECTION_ID in .env.
# For the local gateway, also set MEDIARUNTIME_BASE_URL=http://localhost:8001.
cd stickers-node
npm start
```

Create and configure the collection in the account UI, or use the CLI after activating
the Hosted Pack in the marketplace:

```bash
mediaruntime stickers collections create --name "Support chat"
mediaruntime stickers collections packs enable <collection_id> --pack <pack_id>
```

The API key belongs only on your server. The collection ID sent with each search and
resolution request selects the collection used by that operation; it does not reduce the
API key's workspace permissions. The example also prints current pooled operations,
authorized delivery, usage status, and settled overage after downloading the sticker.

The included allowance is pooled across the workspace. MediaRuntime settles the next
overage block from wallet credit when usage crosses the included amount. If the wallet
cannot fund that block, the runtime returns HTTP `402` with code
`sticker_runtime_quota_exceeded`; add wallet credit before retrying the request.

## Optional direct browser or mobile access

Do not embed `MEDIARUNTIME_API_KEY` in frontend or mobile code. If a client must call the
Sticker Runtime directly, your backend can exchange its API key through
`POST /v1/sticker-runtime/client-tokens` for a short-lived token restricted to one
collection and the required read scopes. Return only that token and its expiration from
an authenticated application endpoint. This advanced flow is unnecessary when your
backend performs search and resolution.
