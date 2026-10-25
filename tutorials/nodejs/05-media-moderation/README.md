# Media Moderation with Node.js

A private reviewer console using the official `@mediaruntime/node` SDK. Upload a video, request visual moderation and `video.web`, receive a signed completion callback, save the report/MP4, and make an explicit publishing decision.

This builds on tutorial 04's PostgreSQL inbox and worker. Processing success and publication are separate states. It is a local teaching application, not a deployable public review system.

## Run

Requirements: Node.js 22+, PostgreSQL 16+ (recorded with 18.4), a funded MediaRuntime account eligible for Premium processing, and an HTTPS account-webhook endpoint. Moderation is charged separately and is unavailable in the public Sandbox. Use a short MP4 you are authorized to process.

```sh
# Install the SDK in your own project:
npm install @mediaruntime/node@1.5.0
npm install express pg yauzl

# For this complete example:
cd tutorials/nodejs/05-media-moderation
npm ci
cp .env.example .env
# Set private API key, account ID, webhook secret, and database URLs.
# Option A: existing PostgreSQL. Option B: docker compose up -d postgres
npm run migrate
npm start
# Second terminal:
npm run worker
# Third terminal:
npm run submit -- /absolute/path/to/bunny.mp4
```

Open http://127.0.0.1:3000. Register a public HTTPS endpoint ending in `/webhooks/mediaruntime` in **Account → Webhooks**, in the same account as the API key. Route it to the separate webhook listener on port 3001. Do not expose the reviewer dashboard through the tunnel. A temporary tunnel alone does not subscribe to callbacks. Restart after updating the signing secret.

The submission script prints a local UUID and persists the uploaded source reference. If interrupted, run `npm run submit -- --resume <local-UUID>` with the same parameters. Do not create another job simply to recover a callback. After diagnosing delivery failures, the SDK supports `media.jobs.retryWebhook(jobId)`.

The sample accepts a local MP4 up to 50 MB, uploads it using `media.uploads.uploadFile`, and submits:

```js
const job = await media.jobs.create({
  source: uploaded.fileUri,
  outputs: ['video.web'],
  moderation: {
    enabled: true,
    mode: 'report',
    checks: ['sexual', 'violence', 'dangerous'],
  },
  deliverWebhook: true,
  idempotencyKey: `node-moderation:${localId}`,
});
const report = await media.jobs.getModeration(job.id);
```

Call `getModeration` from the worker after verified terminal completion, not immediately after submission. `report` mode can complete processing for allow, review **and block** verdicts. This app separately controls publication. `block` mode rejects review/block verdicts before transcoding and produces no media bundle. The worker handles REJECTED jobs by saving the verdict without attempting a bundle download. Analysis-only API jobs may use `outputs: []` with moderation enabled; this particular tutorial worker expects `video.web` for a completed job.

## What moderation adds

User uploads can be valid media yet unsuitable for your audience. Automated checks help triage visual risk and provide evidence for your policy and review team. This example checks sexual, violence and dangerous content; it does not establish copyright ownership, inspect spoken audio, or cover every community rule. Video frames are sampled, so brief content can be missed. Confidence values are model signals, not probabilities that a whole video is safe. A `reviewOnly` flag describes an advisory check; it does not by itself mean a violation was detected. The app reads the actual check decisions, and every publication still requires human approval.

TikTok, Facebook and YouTube publicly describe combinations of automation and human review. They illustrate why moderation is a pipeline, not just a boolean. No claim is made that they use MediaRuntime or endorse this tutorial.

- [TikTok content violations and bans](https://support.tiktok.com/en/safety-hc/account-and-user-safety/content-violations-and-bans)
- [Meta enforcement report methodology](https://about.fb.com/understanding-community-standards-enforcement-report/)
- [How YouTube reviews content](https://support.google.com/youtube/answer/13304829)

## Policy and publishing

`src/policy.mjs` is a deliberately conservative **example** policy:

| Findings | App outcome |
| --- | --- |
| Missing/failed report, unknown verdict, incomplete/conflicting checks | Held, private |
| Review | Held, private |
| Block | Rejected, non-public |
| Allow and all required checks allow | Eligible, still private |

The local reviewer must enter a reason and approve an eligible upload. `/published/:id` checks both policy eligibility and the stored publication decision on the server. Rejecting or holding removes access through that route. `/media/:id` is the **private local reviewer preview** and intentionally remains available to the reviewer. Do not deploy that route publicly without reviewer authentication and ownership checks.

Review/block verdicts cannot be bypassed using the approve button or a direct API request. A real appeal workflow needs authorized reviewers, evidence, identity, timestamps and an audit trail. The demo stores decision/reason/time but has no user identities. The Host and Origin checks protect the loopback demo from cross-site requests; they are not production authentication.

## Reliability and storage

The receiver verifies HMAC against raw bytes using the SDK, enforces a five-minute timestamp tolerance, checks the account and terminal status, and commits the event before HTTP 204. PostgreSQL deduplicates account/event IDs. The separate worker uses row locks, bounded retries and a dead-letter state. Inspect dead events deliberately; do not resubmit billable processing to fix local delivery failures.

The worker fetches authenticated job details rather than following arbitrary webhook URLs. It downloads a bounded canonical ZIP, extracts only known deliverables to controlled paths, and saves `result.mp4` plus `moderation-evidence.json`. The normalized SDK summary is saved in PostgreSQL and can be downloaded from the console.

Transactions remain open during bounded downloads for teaching clarity. Higher throughput needs leases, fencing and shared durable storage. Retried file writes are not a general exactly-once guarantee for external side effects.

**MediaRuntime outputs are retained temporarily; signed links expire separately.** Save what you need promptly. This example retains private inputs, ZIPs, outputs, reports and database/inbox records until you delete them. They need your own access, backup and cleanup policy. Never use an expiring provider link as permanent published storage. See [retention policy](https://mediaruntime.com/en/legal#retention).

## Tests

Create a separate PostgreSQL database whose name ends in `_test`, set `TEST_DATABASE_URL`, then run `npm test`. Tests refuse non-loopback databases or unsafe database names. They truncate only tables in that isolated test database. Set `TEST_MEDIA_ROOT` to a disposable directory; tests remove it after completion.

```sh
docker compose exec postgres createdb -U tutorial mediaruntime_moderation_test
npm test
```

Tests use the real SDK signature verifier and PostgreSQL, with **synthetic reports/media responses** to check policy, replay handling, concurrency, retries, missing analysis and server publishing controls. They do not submit billable jobs or measure model accuracy. The recorded demonstration separately uses a real provider job and callback.

Before production: add authentication, per-account authorization, reviewer roles, quotas, upload validation, monitoring, durable storage, backups, reporting and appeals. API keys, signing secrets, inbox payloads and signed URLs must stay private.
