import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { MediaRuntime } from "@mediaruntime/node";

// Keep the API key in a server-side secret store. Never expose it in browser code.
const apiKey = process.env.MEDIARUNTIME_API_KEY?.trim();
const source = process.env.MEDIARUNTIME_SOURCE?.trim();
const outputAlias = process.env.MEDIARUNTIME_OUTPUT_ALIAS?.trim() || "video.web";
const downloadPath = process.env.MEDIARUNTIME_DOWNLOAD_PATH?.trim() || "outputs.zip";

if (!apiKey) throw new Error("Set MEDIARUNTIME_API_KEY in ../.env");
if (!source) throw new Error("Set MEDIARUNTIME_SOURCE in ../.env");

const media = new MediaRuntime({ apiKey });

// `source` may be a public URL or a time-limited signed read URL. The selected
// output alias expands to a maintained set of artifacts before execution.
const job = await media.jobs.create({
  source,
  outputs: [outputAlias],
  metadata: { quickstart: "node" },
  // This quickstart creates a fresh logical job on every run. In production,
  // derive this key from your own stable asset or operation identifier instead.
  idempotencyKey: `quickstart:node:${randomUUID()}`,
});

console.log(`Created ${job.id}`);
console.log("Waiting for MediaRuntime to finish…");

// Waiting is convenient for a local quickstart. Production services should
// persist job.id and normally consume signed terminal webhooks instead.
const result = await job.wait({ timeoutMs: 15 * 60 * 1000 });
if (result.status !== "COMPLETED" || !result.bundle.downloadUrl) {
  throw new Error(`Job ${job.id} ended with ${result.status}`);
}

// The terminal download URL is signed and time-limited. It returns one ZIP
// containing every requested rendition, report, subtitle, and metadata file.
const response = await fetch(result.bundle.downloadUrl, { redirect: "follow" });
if (!response.ok) {
  throw new Error(`Bundle download failed with HTTP ${response.status}`);
}

await writeFile(downloadPath, Buffer.from(await response.arrayBuffer()));
console.log(`Downloaded ${job.id} bundle to ${downloadPath}`);
