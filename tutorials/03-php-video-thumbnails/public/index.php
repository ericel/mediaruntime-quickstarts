<?php
if (!in_array(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), ['/', '/index.php'], true)) {
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
?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Video thumbnails · MediaRuntime + PHP</title><link rel="stylesheet" href="style.css"></head><body><main>
<header><b>▷ MediaRuntime</b><span>PHP TUTORIALS / 03</span></header>
<section class="hero"><div class="eyebrow">UPLOAD → EXTRACT → KEEP</div><h1>One frame.<br><em>A better first impression.</em></h1><p>Generate a video thumbnail with PHP and save it to your own storage.</p></section>
<section class="workspace"><div class="upload"><div class="eyebrow">01 / YOUR VIDEO</div><h2>Choose the moment.</h2><p>Upload an MP4, then choose a timestamp inside its duration.</p>
<form id="upload" enctype="multipart/form-data"><input type="hidden" name="csrf" value="<?=esc($csrf)?>"><label>MP4 video · up to 20 MB<input type="file" name="video" accept="video/mp4,.mp4" required></label><label>Frame time in seconds<input type="number" name="time_sec" value="4" min="0" max="604800" step="0.1" required></label><button>Generate thumbnail ↗</button></form><p id="feedback" aria-live="polite"></p><p class="small">The API key stays on the server. This example uses a separate PHP worker.</p></div>
<div class="results"><div class="eyebrow">02 / SAVED THUMBNAILS</div><h2>Ready for your website.</h2>
<?php if (!$jobs):?><div class="empty">Your saved thumbnail will appear here.</div><?php endif;?>
<?php foreach ($jobs as $job):?><article data-id="<?=esc($job['id'])?>"><div class="row"><h3><?=esc($job['name'])?></h3><span class="status"><?=esc($job['status'])?></span></div><p class="message">Checking status…</p><img hidden alt="Generated video thumbnail"><div class="details" hidden><span class="dimensions"></span><a download="thumbnail.jpg">Download saved JPEG ↗</a></div></article><?php endforeach;?>
</div></section>
<aside><strong>Outputs are temporary on MediaRuntime.</strong><p>Download results promptly and keep your own copy. Download links expire separately; cleanup eligibility is not a guarantee of download access. This demo saves the JPEG into your application's storage before displaying it.</p><a href="https://mediaruntime.com/en/legal#retention" target="_blank" rel="noopener">Read the media retention policy ↗</a></aside>
<footer>Core PHP + cURL · No local FFmpeg · Original media stays yours</footer></main><script src="app.js"></script></body></html>
