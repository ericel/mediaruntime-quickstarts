from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException, Request, Response
from mediaruntime import MediaRuntime, WebhookVerificationError

# Keep this account secret in a secret manager and rotate it if it is exposed.
secret = os.getenv("MEDIARUNTIME_WEBHOOK_SECRET", "").strip()
if not secret:
    raise RuntimeError("Set MEDIARUNTIME_WEBHOOK_SECRET before starting the receiver")

media = MediaRuntime(webhook_secret=secret)
app = FastAPI(title="MediaRuntime webhook quickstart")


@app.post("/webhooks/mediaruntime", status_code=204)
async def mediaruntime_webhook(request: Request) -> Response:
    # Verify the signature against the exact raw body before trusting any field.
    try:
        event = media.webhooks.verify(await request.body(), request.headers)
    except WebhookVerificationError as error:
        raise HTTPException(status_code=401, detail="Invalid MediaRuntime webhook") from error

    # In production, atomically persist and deduplicate event.id before returning
    # 204. MediaRuntime may retry until it receives a successful response.
    print({"id": event.id, "type": event.type, "job_id": event.job_id, "status": event.status})
    return Response(status_code=204)


@app.get("/health")
async def health() -> dict[str, bool]:
    # Health checks are intentionally separate from the signed webhook route.
    return {"ok": True}
