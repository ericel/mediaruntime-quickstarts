<?php

// Pinned hls.js distribution, verified before being installed locally.
$url = 'https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js';
$expected = 'a12e7ee1cd64a69dcdb314157e45dafcba705bfb0b1440b7935cb265d374423e';
$context = stream_context_create(['http' => ['timeout' => 30]]);
$script = file_get_contents($url, false, $context);
if ($script === false || ! hash_equals($expected, hash('sha256', $script))) {
    fwrite(STDERR, "hls.js download or checksum verification failed.\n");
    exit(1);
}
$dir = __DIR__.'/../public/vendor';
if (! is_dir($dir)) {
    mkdir($dir, 0755, true);
}
file_put_contents($dir.'/hls.min.js', $script);
copy(__DIR__.'/hls.LICENSE', $dir.'/hls.LICENSE');
echo "Installed hls.js 1.7.3.\n";
