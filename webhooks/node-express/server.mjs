import express from "express";
import { MediaRuntime } from "@mediaruntime/node";

// Store the account webhook secret in a secret manager, not in source control.
const secret = process.env.MEDIARUNTIME_WEBHOOK_SECRET?.trim();
if (!secret) throw new Error("Set MEDIARUNTIME_WEBHOOK_SECRET in ../../.env");

const media = new MediaRuntime({ webhookSecret: secret });
const app = express();

// Signature verification must receive the exact raw request bytes. Register
// this route before express.json(), which would parse and replace those bytes.
app.post(
  "/webhooks/mediaruntime",
  express.raw({ type: "application/json", limit: "1mb" }),
  // The SDK middleware verifies the signature before invoking this callback.
  media.webhooks.express(async (event, _request, response) => {
    // In production, atomically persist and deduplicate event.id before sending
    // 204. MediaRuntime may retry until it receives a successful response.
    console.log({ id: event.id, type: event.type, jobId: event.jobId, status: event.status });
    response.sendStatus(204);
  }),
);

// JSON parsing is safe for routes registered after the signed webhook handler.
app.use(express.json());
app.get("/health", (_request, response) => response.json({ ok: true }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Webhook receiver listening on http://localhost:${port}`));
