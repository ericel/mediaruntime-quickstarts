import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";


// Keep this API key on the server. The quickstart uses the same server-side
// authentication as other MediaRuntime APIs and never exposes the key to clients.
const apiKey = process.env.MEDIARUNTIME_API_KEY?.trim();
const collectionId = process.env.MEDIARUNTIME_STICKER_COLLECTION_ID?.trim();
const query = process.env.MEDIARUNTIME_STICKER_QUERY?.trim() || "beach";
const outputPath = process.env.MEDIARUNTIME_STICKER_OUTPUT_PATH?.trim() || "sticker.webp";
const baseUrl = (process.env.MEDIARUNTIME_BASE_URL?.trim() || "https://mediaruntime.com").replace(/\/+$/, "");

if (!apiKey) throw new Error("Set MEDIARUNTIME_API_KEY in ../.env");
if (!/^stc_[0-9a-f]{32}$/.test(collectionId || "")) {
  throw new Error("Set MEDIARUNTIME_STICKER_COLLECTION_ID to an active collection in ../.env");
}


async function jsonRequest(path) {
  // Runtime reads use the normal workspace credential. The collection_id on
  // each request binds the lookup to the collection selected by this service.
  const headers = {
    Accept: "application/json",
    "X-API-Key": apiKey,
  };
  const response = await fetch(`${baseUrl}/v1${path}`, {
    headers,
    redirect: "error",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Structured quota failures place their actionable message inside FastAPI's
    // detail object; legacy string and canonical error envelopes remain supported.
    const message = payload?.error?.message
      || payload?.detail?.message
      || (typeof payload?.detail === "string" ? payload.detail : "")
      || `HTTP ${response.status}`;
    throw new Error(`MediaRuntime request failed: ${message}`);
  }
  return payload;
}


// Search is collection-bound even though the API key can access other resources
// owned by the same workspace.
const searchParams = new URLSearchParams({ q: query, collection_id: collectionId, limit: "12" });
const search = await jsonRequest(`/stickers/search?${searchParams}`);
if (!Array.isArray(search.items) || search.items.length === 0) {
  throw new Error(`No stickers matched ${JSON.stringify(query)}`);
}

const selected = search.items[0];
const resolutionParams = new URLSearchParams({ collection_id: collectionId });
const resolution = await jsonRequest(
  `/stickers/${encodeURIComponent(selected.sticker_id)}/assets/small_160?${resolutionParams}`,
);

// Asset bytes travel directly from private storage through a five-minute signed
// URL, so the API key is not sent to the storage origin serving the asset.
const asset = await fetch(resolution.url, { redirect: "follow" });
if (!asset.ok) throw new Error(`Sticker download failed with HTTP ${asset.status}`);
const mediaType = asset.headers.get("content-type")?.split(";", 1)[0]?.trim();
if (mediaType !== resolution.media_type) {
  throw new Error("Sticker download media type did not match the signed resolution");
}
const bytes = Buffer.from(await asset.arrayBuffer());
if (bytes.length !== Number(resolution.bytes)) {
  throw new Error("Sticker download byte count did not match the signed resolution");
}
// The gateway pins the approved asset digest. Checking it catches truncated,
// stale, or unexpectedly replaced bytes before an application persists them.
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== resolution.sha256) {
  throw new Error("Sticker download SHA-256 did not match the signed resolution");
}
await writeFile(outputPath, bytes);
console.log(`Saved ${selected.sticker_id} to ${outputPath}`);

// Workspace usage is pooled across collections and packs, so inspect it through
// the trusted API-key endpoint after completing the sample runtime operations.
const usage = await jsonRequest("/sticker-runtime/usage/current");
console.log(JSON.stringify({
  month: usage.month,
  operations: `${usage.operations}/${usage.included_operations}`,
  authorizedDeliveryBytes: `${usage.authorized_delivery_bytes}/${usage.included_delivery_bytes}`,
  status: usage.status,
  overageChargedCents: usage.overage_charged_cents,
}, null, 2));
