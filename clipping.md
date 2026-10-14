# Clipping: analyze, review, render

Clipping uses the normal asynchronous jobs API. The Node/Python SDK and CLI surface
requires the matching **1.4.0** packages after publication. This release is prepared
locally; it is not yet available as a published-package quickstart. Existing examples
remain on their published dependencies until that release is available.

1. For a precise manual range, submit `type: "mp4"`, `preset: "video_clip_v1"`, and
   `clip: {start_time_sec: 0, duration_sec: 10, layout: "original", burn_captions: false}`.
   The whole range must fit the source. This Standard preset does not invoke Whisper.
2. For suggestions, submit one `type: "frames"`, `preset: "clip_candidates_v1"` output
   with `clip_analysis`. This is Premium, including when text is supplied. The existing
   Whisper engine runs only when the transcript is absent or empty. A nonempty source-
   timed transcript skips it. Public Sandbox does not permit Premium analysis.
3. Wait for completion, then fetch `GET /v1/jobs/{job_id}/clip-candidates`. Node exposes
   `jobs.getClipCandidates()` / `emptyReason`; Python exposes `jobs.get_clip_candidates()`
   / `empty_reason`. Empty candidates are valid; read the reason and reuse any nonempty
   transcript for manual clips. Scores reflect transcript heuristics, not virality.
4. Review the range and submit a new `video_clip_v1` job with the same source. Supply
   only relevant original-source transcript segments and opt into `burn_captions` if
   desired. Never subtract the clip start from submitted cue times: the engine rebases
   them. Rendering never repeats transcription.
5. Wait for completion and download the canonical ZIP through its returned delivery
   URL. It contains MP4, poster and any overlapping SRT/VTT captions. Analysis produces
   `clip_candidates.json`; it is a report rather than rendered video or JavaScript.

Full JSON, Node, Python and CLI examples, limits, empty-result handling, and Studio
transcript attachment instructions are maintained in the
[public clipping guide](https://mediaruntime.com/docs#clipping).

CLI 1.4.0 accepts local SRT, VTT or JSON (array or report containing `transcript`) via
`--clip-transcript`, limited to 1 MiB. SDKs accept parsed segment arrays rather than
loading subtitle files or cloud paths automatically. Preserve the original source
reference with the saved plan, and ensure it remains readable for subsequent jobs.
