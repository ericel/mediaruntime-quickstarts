# FastAPI webhook receiver

```bash
cd webhooks/python-fastapi
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp ../../.env.example ../../.env
# Export MEDIARUNTIME_WEBHOOK_SECRET, then:
uvicorn app:app --host 0.0.0.0 --port 3000
```

Expose `POST /webhooks/mediaruntime` over HTTPS and save that destination under **Account → Webhooks**. The endpoint reads and verifies the raw bytes before using the parsed event.
