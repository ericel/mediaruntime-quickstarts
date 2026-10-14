<?php

require dirname(__DIR__).'/app.php';
beginSession();
try {
    $job = ownedJob((string)($_GET['id'] ?? ''));
    session_write_close();
    if ($job['status'] !== 'ready') {
        throw new RuntimeException('Not ready.');
    }
    $file = jobDirectory($job['id']).'/thumbnail.jpg';
    if (!is_file($file)) {
        throw new RuntimeException('Not found.');
    }
    header('Content-Type: image/jpeg');
    header('Content-Length: '.filesize($file));
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    readfile($file);
} catch (Throwable) {
    http_response_code(404);
    echo 'Not found.';
}
