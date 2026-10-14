<?php

declare(strict_types=1);
// Core PHP 8.2+, cURL, ZIP and fileinfo. No Composer or local FFmpeg required.
function configValue(string $name, string $fallback = ''): string
{
    return trim((string)(getenv($name) ?: $fallback));
}
function loadEnvironment(): void
{
    $file = __DIR__.'/.env';
    if (!is_file($file)) {
        return;
    }
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        if (preg_match('/^[A-Z_]+$/', $key) && getenv($key) === false) {
            putenv($key.'='.trim($value, " \t\"'"));
        }
    }
}
loadEnvironment();
function mediaRoot(): string
{
    $root = configValue('MEDIA_ROOT', __DIR__.'/storage');
    if (!is_dir($root) && !mkdir($root, 0700, true)) {
        throw new RuntimeException('Cannot create media storage.');
    }
    $resolved = realpath($root);
    $public = realpath(__DIR__.'/public');
    if (!$resolved || ($public && ($resolved === $public || str_starts_with($resolved, $public.DIRECTORY_SEPARATOR)))) {
        throw new RuntimeException('MEDIA_ROOT must be outside the public directory.');
    }
    return $resolved;
}
function jobDirectory(string $id): string
{
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
        throw new RuntimeException('Invalid local job ID.');
    }
    return mediaRoot().'/'.$id;
}
function saveJob(array $job): void
{
    $path = jobDirectory($job['id']).'/job.json';
    $temporary = tempnam(dirname($path), '.state-');
    try {
        file_put_contents($temporary, json_encode($job, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT));
        chmod($temporary, 0600);
        if (!rename($temporary, $path)) {
            throw new RuntimeException('Cannot save job state.');
        }
    } finally {
        if (is_file($temporary)) {
            unlink($temporary);
        }
    }
}
function readJob(string $id): array
{
    $path = jobDirectory($id).'/job.json';
    if (!is_file($path)) {
        throw new RuntimeException('Job not found.');
    }
    return json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
}
function beginSession(): void
{
    session_set_cookie_params(['httponly' => true,'samesite' => 'Lax','secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off']);
    session_start();
    $_SESSION['owner'] ??= bin2hex(random_bytes(24));
    $_SESSION['csrf'] ??= bin2hex(random_bytes(24));
}
function ownedJob(string $id): array
{
    $job = readJob($id);
    if (!hash_equals($job['owner'], hash('sha256', $_SESSION['owner']))) {
        throw new RuntimeException('Job not found.');
    }
    return $job;
}
function safeUrl(string $url): void
{
    $parts = parse_url($url);
    $local = configValue('MEDIARUNTIME_LOCAL_TEST') === '1' && ($parts['scheme'] ?? '') === 'http'
        && in_array($parts['host'] ?? '', ['127.0.0.1','localhost'], true);
    if (!filter_var($url, FILTER_VALIDATE_URL) || (!$local && ($parts['scheme'] ?? '') !== 'https') || isset($parts['user']) || isset($parts['pass'])) {
        throw new RuntimeException('Expected an HTTPS URL.');
    }
}
function api(string $method, string $path, ?array $body = null, string $idempotency = ''): array
{
    $base = rtrim(configValue('MEDIARUNTIME_BASE_URL', 'https://mediaruntime.com'), '/');
    safeUrl($base);
    $key = configValue('MEDIARUNTIME_API_KEY');
    if ($key === '' || preg_match('/[\r\n]/', $key)) {
        throw new RuntimeException('Configure MEDIARUNTIME_API_KEY on the server.');
    }
    $headers = ['Accept: application/json','X-API-Key: '.$key];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    if ($idempotency !== '') {
        $headers[] = 'Idempotency-Key: '.$idempotency;
    }
    $curl = curl_init($base.$path);
    curl_setopt_array($curl, [CURLOPT_CUSTOMREQUEST => $method,CURLOPT_RETURNTRANSFER => true,CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 10,CURLOPT_TIMEOUT => 30,CURLOPT_FOLLOWLOCATION => false]);
    if ($body !== null) {
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($body, JSON_THROW_ON_ERROR));
    }
    $response = curl_exec($curl);
    $http = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    if ($response === false || $http < 200 || $http >= 300) {
        throw new RuntimeException('API request failed (HTTP '.$http.').');
    }
    $data = json_decode($response, true, flags:JSON_THROW_ON_ERROR);
    if (!is_array($data)) {
        throw new RuntimeException('Invalid API response.');
    }
    return $data;
}
function uploadSource(string $input, string $id): string
{
    $target = api('POST', '/v1/upload-url', ['filename' => $id.'.mp4','content_type' => 'video/mp4']);
    safeUrl($target['upload_url']);
    $headers = [];
    foreach ($target['upload_headers'] ?? ['Content-Type' => 'video/mp4'] as $name => $value) {
        if (!preg_match('/^[A-Za-z0-9-]+$/', $name) || preg_match('/[\r\n]/', $value)) {
            throw new RuntimeException('Invalid upload header.');
        }
        $headers[] = $name.': '.$value;
    }
    $stream = fopen($input, 'rb');
    $curl = curl_init($target['upload_url']);
    try {
        curl_setopt_array($curl, [CURLOPT_UPLOAD => true,CURLOPT_INFILE => $stream,CURLOPT_INFILESIZE => filesize($input),
            CURLOPT_HTTPHEADER => $headers,CURLOPT_RETURNTRANSFER => true,CURLOPT_FOLLOWLOCATION => false,CURLOPT_CONNECTTIMEOUT => 10,CURLOPT_TIMEOUT => 120]);
        $ok = curl_exec($curl);
        $http = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        if ($ok === false || $http < 200 || $http >= 300) {
            throw new RuntimeException('Source upload failed.');
        }
    } finally {
        if (is_resource($stream)) {
            fclose($stream);
        }
    }
    return $target['file_uri'];
}
function downloadZip(string $url, string $path): void
{
    safeUrl($url);
    $stream = fopen($path, 'wb');
    $curl = curl_init($url);
    $count = 0;
    $limit = 50 * 1024 * 1024;
    $protocols = configValue('MEDIARUNTIME_LOCAL_TEST') === '1' ? CURLPROTO_HTTP | CURLPROTO_HTTPS : CURLPROTO_HTTPS;
    try {
        // This separate request has NO account API key, including on redirects.
        curl_setopt_array($curl, [CURLOPT_FOLLOWLOCATION => true,CURLOPT_MAXREDIRS => 3,CURLOPT_PROTOCOLS => $protocols,
            CURLOPT_REDIR_PROTOCOLS => $protocols,CURLOPT_CONNECTTIMEOUT => 10,CURLOPT_TIMEOUT => 120,
            CURLOPT_WRITEFUNCTION => function ($curl, string $chunk) use ($stream, &$count, $limit): int {
                $count += strlen($chunk);
                if ($count > $limit) {
                    return 0;
                }
                return fwrite($stream, $chunk);
            }]);
        $ok = curl_exec($curl);
        $http = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        if (!$ok || $http !== 200 || !$count) {
            throw new RuntimeException('Bundle download failed.');
        }
    } finally {
        fclose($stream);
    }
}
function saveThumbnail(string $archive, string $destination): array
{
    $zip = new ZipArchive();
    if ($zip->open($archive) !== true) {
        throw new RuntimeException('Invalid ZIP bundle.');
    }
    try {
        if ($zip->numFiles > 1000) {
            throw new RuntimeException('Too many archive entries.');
        }
        $candidates = [];
        $total = 0;
        for ($i = 0;$i < $zip->numFiles;$i++) {
            $entry = $zip->statIndex($i);
            $name = $entry['name'];
            $total += $entry['size'];
            if ($total > 50 * 1024 * 1024 || str_starts_with($name, '/') || preg_match('/[\x00-\x1f:\\\\]/', $name) || in_array('..', explode('/', $name), true)) {
                throw new RuntimeException('Unsafe archive.');
            }
            $zip->getExternalAttributesIndex($i, $system, $attributes);
            if ((($attributes >> 16) & 0170000) === 0120000) {
                throw new RuntimeException('Archive symlink rejected.');
            }
            if (preg_match('/\.jpe?g$/i', $name)) {
                $candidates[] = $i;
            }
        }
        if (count($candidates) !== 1) {
            throw new RuntimeException('Expected exactly one JPEG poster.');
        }
        $bytes = $zip->getFromIndex($candidates[0]);
        $size = getimagesizefromstring($bytes);
        if (!$size || $size[2] !== IMAGETYPE_JPEG || $size[0] * $size[1] > 20000000) {
            throw new RuntimeException('Invalid JPEG poster.');
        }
        if (file_exists($destination)) {
            throw new RuntimeException('Thumbnail already exists.');
        }
        $temporary = tempnam(dirname($destination), '.poster-');
        try {
            file_put_contents($temporary, $bytes);
            chmod($temporary, 0600);
            if (!link($temporary, $destination)) {
                throw new RuntimeException('Cannot publish thumbnail safely.');
            }
        } finally {
            unlink($temporary);
        }
        return ['width' => $size[0],'height' => $size[1],'bytes' => strlen($bytes)];
    } finally {
        $zip->close();
    }
}
function processJob(array $job): void
{
    $directory = jobDirectory($job['id']);
    if (in_array($job['status'], ['ready','failed'], true)) {
        return;
    }
    try {
        if (time() - $job['created_at'] > 1800) {
            throw new RuntimeException('Processing deadline exceeded.');
        }
        $job['status'] = 'processing';
        saveJob($job);
        if (empty($job['source_uri'])) {
            $job['source_uri'] = uploadSource($directory.'/input.mp4', $job['id']);
            saveJob($job);
        }
        if (empty($job['job_id'])) {
            $response = api('POST', '/v1/jobs', ['source' => $job['source_uri'],'outputs' => [[
                'type' => 'mp4','preset' => 'poster_frame_v1','poster_time_sec' => $job['time_sec'],'poster_format' => 'jpg',
            ]]], 'php-poster-'.$job['id']);
            if (empty($response['job_id'])) {
                throw new RuntimeException('Missing job ID.');
            }
            $job['job_id'] = $response['job_id'];
            saveJob($job);
        }
        $response = api('GET', '/v1/jobs/'.rawurlencode($job['job_id']));
        $status = strtoupper($response['status'] ?? '');
        if (in_array($status, ['FAILED','REJECTED','PARTIAL','CANCELLED','CANCELED'], true)) {
            throw new RuntimeException('Remote processing did not complete successfully.');
        }
        if ($status !== 'COMPLETED') {
            return;
        }
        $url = $response['bundle']['download_url'] ?? '';
        if (!$url) {
            throw new RuntimeException('Completed response has no bundle.');
        }
        downloadZip($url, $directory.'/bundle.zip');
        if (!is_file($directory.'/thumbnail.jpg')) {
            $job['image'] = saveThumbnail($directory.'/bundle.zip', $directory.'/thumbnail.jpg');
        } else {
            $size = getimagesize($directory.'/thumbnail.jpg');
            $job['image'] = ['width' => $size[0],'height' => $size[1],'bytes' => filesize($directory.'/thumbnail.jpg')];
        }
        $job['status'] = 'ready';
        $job['saved_at'] = gmdate(DATE_ATOM);
        saveJob($job);
        @unlink($directory.'/input.mp4');
        @unlink($directory.'/bundle.zip');
    } catch (Throwable $e) {
        $job['attempt_errors'] = ($job['attempt_errors'] ?? 0) + 1;
        if ($job['attempt_errors'] >= 3 || time() - $job['created_at'] > 1800 || isset($status) && in_array($status, ['FAILED','REJECTED','PARTIAL','CANCELLED','CANCELED'], true)) {
            $job['status'] = 'failed';
        }
        $job['error'] = 'Processing could not finish. Check the server configuration and MediaRuntime job before retrying.';
        saveJob($job);
        @unlink($directory.'/bundle.zip');
        // Do not print raw HTTP responses, signed URLs, credentials, or exception details.
        fwrite(STDERR,"Processing attempt failed; private job state preserved.\n");
    }
}
