<?php

require dirname(__DIR__).'/app.php';
beginSession();
header('Content-Type: application/json');
try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        exit;
    }
    if (!hash_equals($_SESSION['csrf'], (string)($_POST['csrf'] ?? ''))) {
        http_response_code(403);
        echo json_encode(['error' => 'Reload the form and try again.']);
        exit;
    }
    $owner = hash('sha256', $_SESSION['owner']);
    session_write_close();
    $file = $_FILES['video'] ?? null;
    $time = filter_var($_POST['time_sec'] ?? null, FILTER_VALIDATE_FLOAT);
    if (!$file || $file['error'] !== UPLOAD_ERR_OK || $file['size'] > 20 * 1024 * 1024 || !is_uploaded_file($file['tmp_name']) || (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']) !== 'video/mp4') {
        throw new RuntimeException('Choose an MP4 up to 20 MB.');
    }
    if ($time === false || $time < 0 || $time > 604800) {
        throw new RuntimeException('Choose a valid timestamp within the source video.');
    }
    $id = bin2hex(random_bytes(16));
    $directory = jobDirectory($id);
    mkdir($directory, 0700, true);
    if (!move_uploaded_file($file['tmp_name'], $directory.'/input.mp4')) {
        throw new RuntimeException('Cannot save upload.');
    }
    chmod($directory.'/input.mp4', 0600);
    saveJob(['id' => $id,'owner' => $owner,'name' => basename($file['name']),'time_sec' => $time,'status' => 'queued','created_at' => time()]);
    http_response_code(202);
    echo json_encode(['id' => $id]);
} catch (Throwable) {
    http_response_code(422);
    echo json_encode(['error' => 'Upload rejected. Use an MP4 up to 20 MB and a valid frame time.']);
}
