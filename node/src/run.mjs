import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { MediaRuntime } from "@mediaruntime/node";

const apiKey = process.env.MEDIARUNTIME_API_KEY?.trim();
const source = process.env.MEDIARUNTIME_SOURCE?.trim();
const outputAlias = process.env.MEDIARUNTIME_OUTPUT_ALIAS?.trim() || "video.web";
const downloadPath = process.env.MEDIARUNTIME_DOWNLOAD_PATH?.trim() || "outputs.zip";

if (!apiKey) throw new Error("Set MEDIARUNTIME_API_KEY in ../.env");
if (!source) throw new Error("Set MEDIARUNTIME_SOURCE in ../.env");

const media = new MediaRuntime({ apiKey });
const job = await media.jobs.create({
  source,
  outputs: [outputAlias],
  metadata: { quickstart: "node" },
  idempotencyKey: `quickstart:node:${randomUUID()}`,
});

console.log(`Created ${job.id}`);
console.log("Waiting for MediaRuntime to finish…");

const result = await job.wait({ timeoutMs: 15 * 60 * 1000 });
if (result.status !== "COMPLETED" || !result.bundle.downloadUrl) {
  throw new Error(`Job ${job.id} ended with ${result.status}`);
}

const response = await fetch(result.bundle.downloadUrl, { redirect: "follow" });
if (!response.ok) {
  throw new Error(`Bundle download failed with HTTP ${response.status}`);
}

await writeFile(downloadPath, Buffer.from(await response.arrayBuffer()));
console.log(`Downloaded ${job.id} bundle to ${downloadPath}`);
