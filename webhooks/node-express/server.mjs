import express from "express";
import { MediaRuntime } from "@mediaruntime/node";

const secret = process.env.MEDIARUNTIME_WEBHOOK_SECRET?.trim();
if (!secret) throw new Error("Set MEDIARUNTIME_WEBHOOK_SECRET in ../../.env");

const media = new MediaRuntime({ webhookSecret: secret });
const app = express();

app.post(
  "/webhooks/mediaruntime",
  express.raw({ type: "application/json", limit: "1mb" }),
  media.webhooks.express(async (event, _request, response) => {
    // In production, atomically persist and deduplicate event.id before acknowledging.
    console.log({ id: event.id, type: event.type, jobId: event.jobId, status: event.status });
    response.sendStatus(204);
  }),
);

app.use(express.json());
app.get("/health", (_request, response) => response.json({ ok: true }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Webhook receiver listening on http://localhost:${port}`));
