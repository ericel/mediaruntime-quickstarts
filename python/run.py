from __future__ import annotations

import os
import secrets
from pathlib import Path

import httpx
from mediaruntime import MediaRuntime


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Set {name} before running this quickstart")
    return value


def main() -> None:
    api_key = required_env("MEDIARUNTIME_API_KEY")
    source = required_env("MEDIARUNTIME_SOURCE")
    output_alias = os.getenv("MEDIARUNTIME_OUTPUT_ALIAS", "video.web").strip() or "video.web"
    download_path = Path(os.getenv("MEDIARUNTIME_DOWNLOAD_PATH", "outputs.zip"))

    media = MediaRuntime(api_key=api_key)
    job = media.jobs.create(
        source=source,
        outputs=[output_alias],
        metadata={"quickstart": "python"},
        idempotency_key=f"quickstart:python:{secrets.token_hex(12)}",
    )

    print(f"Created {job.id}")
    print("Waiting for MediaRuntime to finish…")

    result = job.wait(timeout=15 * 60)
    bundle_url = result.bundle.get("download_url")
    if result.status != "COMPLETED" or not bundle_url:
        raise RuntimeError(f"Job {job.id} ended with {result.status}")

    with httpx.stream("GET", bundle_url, follow_redirects=True, timeout=600) as response:
        response.raise_for_status()
        with download_path.open("wb") as bundle_file:
            for chunk in response.iter_bytes():
                bundle_file.write(chunk)

    print(f"Downloaded {job.id} bundle to {download_path}")


if __name__ == "__main__":
    main()
