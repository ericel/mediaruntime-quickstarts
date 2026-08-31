const url = process.env.MEDIARUNTIME_OPENAPI_URL ?? "https://mediaruntime.com/openapi.json";

const response = await fetch(url, { headers: { accept: "application/json" } });
if (!response.ok) {
  throw new Error(`OpenAPI request failed with HTTP ${response.status}`);
}

const document = await response.json();
const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};

requireValue(String(document.openapi).startsWith("3.1"), "Expected OpenAPI 3.1");
requireValue(document.servers?.[0]?.url === "https://mediaruntime.com", "Unexpected API server");
requireValue(document.paths?.["/v1/jobs"]?.post?.operationId === "createJob", "Missing createJob operation");
requireValue(document.paths?.["/v1/jobs/{job_id}"]?.get?.operationId === "getJob", "Missing getJob operation");
requireValue(document.paths?.["/v1/jobs/{job_id}/bundle"]?.get?.responses?.["307"], "Bundle redirect contract is missing");
requireValue(document.paths?.["/v1/sandbox/session"]?.post?.security?.length === 0, "Sandbox session must be public");
requireValue(document.components?.securitySchemes?.ProductionApiKey?.name === "X-API-Key", "Production API-key scheme is missing");
requireValue(document.components?.schemas?.CreateJobRequest?.properties?.source, "Canonical source field is missing");
requireValue(!document.components?.schemas?.CreateJobRequest?.properties?.webhook_url, "Legacy per-job webhook URL became public");
requireValue(Object.keys(document.webhooks ?? {}).length === 4, "Expected four terminal webhook contracts");

// Keep the quickstarts pinned to the complete Sticker Runtime boundary: trusted
// collection management, dual-auth reads, private resolution, usage, and token exchange.
requireValue(
  document.paths?.["/v1/sticker-collections"]?.post?.operationId === "createStickerCollection",
  "Sticker collection creation contract is missing",
);
requireValue(
  document.paths?.["/v1/stickers/search"]?.get?.operationId === "searchRuntimeStickers",
  "Sticker search contract is missing",
);
requireValue(
  document.paths?.["/v1/stickers/{sticker_id}/assets/{variant}"]?.get?.operationId === "resolveRuntimeStickerVariant",
  "Sticker asset-resolution contract is missing",
);
requireValue(
  document.components?.securitySchemes?.StickerClientToken?.scheme === "bearer",
  "Scoped Sticker Runtime bearer scheme is missing",
);
requireValue(
  document.paths?.["/v1/sticker-runtime/usage/current"]?.get?.security?.length === 1,
  "Sticker Runtime usage must remain server-authenticated",
);

console.log(`OpenAPI contract looks current: ${url}`);
