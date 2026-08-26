from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException, Request, Response
from mediaruntime import MediaRuntime, WebhookVerificationError

secret = os.getenv("MEDIARUNTIME_WEBHOOK_SECRET", "").strip()
if not secret:
    raise RuntimeError("Set MEDIARUNTIME_WEBHOOK_SECRET before starting the receiver")

media = MediaRuntime(webhook_secret=secret)
app = FastAPI(title="MediaRuntime webhook quickstart")


@app.post("/webhooks/mediaruntime", status_code=204)
async def mediaruntime_webhook(request: Request) -> Response:
    try:
        event = media.webhooks.verify(await request.body(), request.headers)
    except WebhookVerificationError as error:
        raise HTTPException(status_code=401, detail="Invalid MediaRuntime webhook") from error

    # In production, atomically persist and deduplicate event.id before acknowledging.
    print({"id": event.id, "type": event.type, "job_id": event.job_id, "status": event.status})
    return Response(status_code=204)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}
