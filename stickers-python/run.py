from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any
from urllib import error as url_error
from urllib import parse as url_parse
from urllib import request as url_request


def required_env(name: str) -> str:
    """Read one required server setting without introducing an unsafe default."""

    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Set {name} before running this quickstart")
    return value


def gateway_json(base_url: str, api_key: str, path: str) -> dict[str, Any]:
    """Read JSON with the workspace API key while retaining a useful API error."""

    request = url_request.Request(
        f"{base_url}/v1{path}",
        headers={
            "Accept": "application/json",
            "X-API-Key": api_key,
        },
    )
    try:
        with url_request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except url_error.HTTPError as exc:
        # FastAPI quota errors carry their remediation under `detail`, while the
        # canonical API error envelope uses `error`; support both forms here.
        raw_body = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw_body)
        except json.JSONDecodeError:
            payload = {}
        detail = payload.get("error") or payload.get("detail") or raw_body
        message = detail.get("message") if isinstance(detail, dict) else str(detail)
        raise RuntimeError(f"MediaRuntime request failed with HTTP {exc.code}: {message}") from exc


def main() -> None:
    """Search, resolve, verify, and save one approved private sticker variant."""

    # Keep this API key in a server-side secret store; never expose it to a client.
    api_key = required_env("MEDIARUNTIME_API_KEY")
    collection_id = required_env("MEDIARUNTIME_STICKER_COLLECTION_ID")
    if not collection_id.startswith("stc_") or len(collection_id) != 36:
        raise RuntimeError("MEDIARUNTIME_STICKER_COLLECTION_ID must be a server-issued stc_ ID")

    query = os.getenv("MEDIARUNTIME_STICKER_QUERY", "beach").strip() or "beach"
    output_path = Path(os.getenv("MEDIARUNTIME_STICKER_OUTPUT_PATH", "sticker.webp"))
    base_url = os.getenv("MEDIARUNTIME_BASE_URL", "https://mediaruntime.com").rstrip("/")

    # Search is metadata-only and is limited to packs enabled in this collection.
    search_query = url_parse.urlencode(
        {"q": query, "collection_id": collection_id, "limit": 12}
    )
    search = gateway_json(base_url, api_key, f"/stickers/search?{search_query}")
    items = search.get("items")
    if not isinstance(items, list) or not items:
        raise RuntimeError(f"No stickers matched {query!r}")

    selected = items[0]
    sticker_id = str(selected["sticker_id"])
    resolution_query = url_parse.urlencode({"collection_id": collection_id})
    resolution = gateway_json(
        base_url,
        api_key,
        f"/stickers/{url_parse.quote(sticker_id, safe='')}/assets/small_160?{resolution_query}",
    )

    # The signed URL serves approved bytes directly from private storage. Do not
    # forward the MediaRuntime API key to that separate storage origin.
    asset_request = url_request.Request(
        str(resolution["url"]),
        headers={"Accept": "image/webp"},
    )
    with url_request.urlopen(asset_request, timeout=30) as response:
        asset_bytes = response.read()
        asset_media_type = response.headers.get_content_type()

    if asset_media_type != resolution["media_type"]:
        raise RuntimeError("Sticker download media type did not match the signed resolution")
    if len(asset_bytes) != int(resolution["bytes"]):
        raise RuntimeError("Sticker download byte count did not match the signed resolution")
    if hashlib.sha256(asset_bytes).hexdigest() != resolution["sha256"]:
        raise RuntimeError("Sticker download SHA-256 did not match the signed resolution")

    output_path.write_bytes(asset_bytes)
    print(f"Saved {sticker_id} to {output_path}")

    # Usage is pooled across all collections and activated packs in the workspace.
    usage = gateway_json(base_url, api_key, "/sticker-runtime/usage/current")
    print(
        json.dumps(
            {
                "month": usage["month"],
                "operations": f'{usage["operations"]}/{usage["included_operations"]}',
                "authorized_delivery_bytes": (
                    f'{usage["authorized_delivery_bytes"]}/{usage["included_delivery_bytes"]}'
                ),
                "status": usage["status"],
                "overage_charged_cents": usage["overage_charged_cents"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
