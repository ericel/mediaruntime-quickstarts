<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MP4 to HLS • MediaRuntime + Laravel</title><link rel="stylesheet" href="/app.css"></head>
<body><main><header><a class="brand" href="/">▷ MediaRuntime</a><span>LARAVEL TUTORIAL / 02</span></header>
<section class="hero"><div class="eyebrow">UPLOAD → PROCESS → PLAY</div><h1>Your MP4.<br><span>Ready to stream.</span></h1><p>A queued Laravel workflow powered by MediaRuntime.</p><div class="tags"><b>MP4 input</b><b>HLS output</b><b>Asynchronous jobs</b></div></section>
<section class="workspace"><div class="upload"><div class="eyebrow">01 / UPLOAD</div><h2>Start with a video.</h2><p>Select an MP4, up to 20 MB. Keep this browser session open to access your results.</p>
<form method="POST" action="{{ route('videos.store') }}" enctype="multipart/form-data">@csrf<input id="video" name="video" type="file" accept="video/mp4,.mp4" required><button type="submit">Create HLS stream <span>↗</span></button></form>
@if(session('notice'))<p class="notice">{{ session('notice') }}</p>@endif
@foreach($errors->all() as $error)<p role="alert">{{ $error }}</p>@endforeach
<p class="small">Processing uses your configured MediaRuntime account and credits. Your API key stays on the server.</p></div>
<div class="results"><div class="eyebrow">02 / YOUR STREAMS</div><h2>From upload to playback.</h2>
@forelse($videos as $video)<article data-status-url="{{ route('videos.status', $video) }}"><div class="row"><h3>{{ $video->name }}</h3><span class="status">{{ $video->status }}</span></div><p class="message" aria-live="polite">Checking processing status…</p><video controls playsinline preload="metadata" hidden></video><div class="player-info" hidden><span class="badge">HLS • LIVE PLAYBACK</span><a class="playlist" target="_blank" rel="noopener">Open M3U8 playlist ↗</a></div><div class="renditions"></div></article>
@empty<div class="empty">Your finished HLS player will appear here.<br>Start by uploading an MP4.</div>@endforelse
</div></section><footer>MediaRuntime tutorials · Runnable Laravel example · No local FFmpeg required</footer></main>
<script src="/vendor/hls.min.js"></script><script src="/app.js"></script></body></html>
