<?php

require dirname(__DIR__).'/app.php';
beginSession();
header('Content-Type: application/json');
header('Cache-Control: no-store');
try {
    $job = ownedJob((string)($_GET['id'] ?? ''));
    session_write_close();
    echo json_encode(['status' => $job['status'],'time_sec' => $job['time_sec'],'image' => $job['image'] ?? null,
        'image_url' => $job['status'] === 'ready' ? 'image.php?id='.$job['id'] : null,'error' => $job['status'] === 'failed' ? $job['error'] : null]);
} catch (Throwable) {
    http_response_code(404);
    echo json_encode(['error' => 'Not found.']);
}
