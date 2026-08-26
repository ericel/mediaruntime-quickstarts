# Express webhook receiver

```bash
cd webhooks/node-express
npm install
cp ../../.env.example ../../.env
# Set MEDIARUNTIME_WEBHOOK_SECRET, then:
npm start
```

Expose `POST /webhooks/mediaruntime` over HTTPS and save that destination under **Account → Webhooks**. The raw-body route is deliberately registered before `express.json()`.
