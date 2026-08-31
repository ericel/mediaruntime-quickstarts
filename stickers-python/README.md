# Hosted Sticker Runtime quickstart

This dependency-free Python example uses a server-side workspace API key to search one
active sticker collection, resolve the first result's `small_160` WebP, verify the
approved bytes, and save it locally.

```bash
cp .env.example .env

# Export MEDIARUNTIME_API_KEY and MEDIARUNTIME_STICKER_COLLECTION_ID from .env.
# For the local gateway, also export MEDIARUNTIME_BASE_URL=http://localhost:8001.
cd stickers-python
python run.py
```

The API key belongs only on your server. The collection ID selects the application
catalog used by each operation; it does not narrow the API key's workspace permissions.
Use the account UI or MediaRuntime CLI to create a collection and enable already
activated Hosted Packs before running this example.

```bash
mediaruntime stickers collections create --name "Support chat"
mediaruntime stickers collections packs enable <collection_id> --pack <pack_id>
```

The included allowance is pooled across the workspace. MediaRuntime returns HTTP `402`
with code `sticker_runtime_quota_exceeded` when the next overage block cannot be funded.
Add workspace wallet credit before retrying that operation.

## Optional browser or mobile access

Never embed `MEDIARUNTIME_API_KEY` in frontend or mobile code. A trusted backend may
exchange it through `POST /v1/sticker-runtime/client-tokens` for a short-lived token
restricted to one collection and selected read scopes. Backend integrations should keep
using the normal API key.
