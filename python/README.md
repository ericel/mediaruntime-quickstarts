# Python quickstart

This example uses the official [`mediaruntime`](https://pypi.org/project/mediaruntime/) SDK. Python 3.10 or newer is required.

```bash
cd python
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp ../.env.example ../.env
# Edit ../.env, then load it into your shell:
set -a
source ../.env
set +a
python run.py
```

`MEDIARUNTIME_SOURCE` may be an HTTP(S) URL, a `gs://` URI, or a local file path. Local files are uploaded automatically by the SDK. The example submits `video.web`, waits for a terminal status, and saves the complete ZIP bundle to `MEDIARUNTIME_DOWNLOAD_PATH`.
