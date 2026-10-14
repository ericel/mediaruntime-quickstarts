<?php
if (! in_array(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), ['/', '/index.php'], true)) {
    http_response_code(404);
    exit('Not found.');
}
require dirname(__DIR__).'/app.php';
beginSession();
$csrf = $_SESSION['csrf'];
$owner = hash('sha256', $_SESSION['owner']);
session_write_close();
$jobs = [];
foreach (glob(mediaRoot().'/*/job.json') as $path) {
    $job = json_decode(file_get_contents($path), true);
    if (($job['owner'] ?? '') === $owner) {
        $jobs[] = $job;
    }
}
usort($jobs, fn ($a, $b) => $b['created_at'] <=> $a['created_at']);
$jobs = array_slice($jobs, 0, 6);
function esc(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}
?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Audio conversion · MediaRuntime + PHP</title><link rel="stylesheet" href="style.css"></head><body><main>
<header><b>▷ MediaRuntime</b><span>PHP TUTORIALS / 05</span></header>
<section class="hero"><div class="eyebrow">UPLOAD → CONVERT → LISTEN</div><h1>Your audio.<br><em>Ready for the web.</em></h1><p>Convert WAV to AAC/M4A with PHP. Keep a copy. Press play.</p><div class="tags"><b>WAV INPUT</b><b>AAC / M4A</b><b>CORE PHP</b></div></section>
<section class="workspace"><div class="upload"><div class="eyebrow">01 / YOUR SOURCE</div><h2>Start with a sound.</h2><p>Choose a WAV recording you have permission to process.</p>
<form id="upload" enctype="multipart/form-data"><input type="hidden" name="csrf" value="<?= esc($csrf)?>"><label>WAV audio · up to 20 MB<input type="file" name="audio" accept="audio/wav,audio/x-wav,.wav" required></label><button>Convert audio ↗</button></form><p id="feedback" aria-live="polite"></p><p class="small">A separate PHP worker handles the conversion. Your API key stays on the server.</p><ol><li>Upload your source</li><li>Process with MediaRuntime</li><li>Save the converted output</li><li>Listen from your storage</li></ol></div>
<div class="results"><div class="eyebrow">02 / YOUR SAVED OUTPUT</div><h2>Small file. Same melody.</h2>
<?php if (! $jobs) { ?><div class="empty">Your converted audio player will appear here.<br>WAV → AAC audio in an M4A container.</div><?php }?>
<?php foreach ($jobs as $job) { ?><article data-id="<?= esc($job['id'])?>"><div class="row"><h3><?= esc($job['name'])?></h3><span class="status"><?= esc($job['status'])?></span></div><p class="message">Checking status…</p><div class="player" hidden><div class="sound-label"><span>SAVED AUDIO / AAC</span><span class="clock">0:00</span></div><canvas width="800" height="140" aria-label="Audio waveform visualization"></canvas><audio controls preload="metadata"></audio><p class="playback" aria-live="polite">Ready to listen.</p></div><div class="details" hidden><span class="sizes"></span><a>Download saved M4A ↗</a></div></article><?php }?>
</div></section>
<aside><strong>MediaRuntime outputs are temporary. Keep your copy.</strong><p>This app saves the M4A in your own storage before playback. Download links expire separately from cleanup eligibility. Save needed originals and results promptly; set your own retention policy for saved copies.</p><a href="https://mediaruntime.com/en/legal#retention" target="_blank" rel="noopener">Read the media retention policy ↗</a></aside>
<footer>Core PHP + cURL · No local FFmpeg · Asynchronous processing</footer></main><script src="app.js"></script></body></html>
