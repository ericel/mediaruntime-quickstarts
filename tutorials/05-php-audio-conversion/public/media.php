<?php

require dirname(__DIR__).'/app.php';
beginSession();
try {
    $job = ownedJob((string) ($_GET['id'] ?? ''));
    session_write_close();
    if (! in_array($_SERVER['REQUEST_METHOD'], ['GET', 'HEAD'], true)) {
        http_response_code(405);
        header('Allow: GET, HEAD');
        exit;
    }
    $path = jobDirectory($job['id']).'/audio.m4a';
    if ($job['status'] !== 'ready' || ! is_file($path)) {
        throw new RuntimeException;
    }
    $size = filesize($path);
    try {
        [$start,$end,$partial] = byteRange($_SERVER['REQUEST_METHOD'] === 'HEAD' ? '' : ($_SERVER['HTTP_RANGE'] ?? ''), $size);
    } catch (RangeException) {
        http_response_code(416);
        header('Content-Range: bytes */'.$size);
        exit;
    }
    header('Content-Type: audio/mp4');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    header('Accept-Ranges: bytes');
    header('Content-Disposition: '.(isset($_GET['download']) ? 'attachment' : 'inline').'; filename="converted-audio.m4a"');
    header('Content-Length: '.($end - $start + 1));
    if ($partial) {
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    if ($_SERVER['REQUEST_METHOD'] === 'HEAD') {
        exit;
    }
    $stream = fopen($path, 'rb');
    fseek($stream, $start);
    $remaining = $end - $start + 1;
    while ($remaining > 0 && ! feof($stream)) {
        $chunk = fread($stream, min(65536, $remaining));
        if ($chunk === false || $chunk === '') {
            break;
        } echo $chunk;
        $remaining -= strlen($chunk);
    }
    fclose($stream);
} catch (Throwable) {
    http_response_code(404);
    echo 'Not found.';
}
