# Signed webhook receivers

MediaRuntime sends terminal events to the destination configured under **Account → Webhooks**. The examples verify:

- `X-Transcoder-Id`
- `X-Transcoder-Timestamp`
- `X-Transcoder-Signature`
- the exact raw request bytes

Verification must happen before JSON parsing. Store and deduplicate the verified event ID before returning a success response. A successful acknowledgement does not need a response body.

Choose [`node-express/`](node-express/) or [`python-fastapi/`](python-fastapi/).
