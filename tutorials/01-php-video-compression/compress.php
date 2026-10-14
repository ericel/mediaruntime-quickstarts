<?php
// PHP 8.2+ with ext-curl. No Composer or local FFmpeg installation required.
declare(strict_types=1);

function setting(string $name, string $default = ''): string
{
    return trim((string) (getenv($name) ?: $default));
}

function required(string $name): string
{
    $value = setting($name);
    if ($value === '') {
        throw new RuntimeException("Set {$name} before running this example.");
    }
    return $value;
}

function positiveInteger(string $name, int $default): int
{
    $value = filter_var(setting($name, (string) $default), FILTER_VALIDATE_INT);
    if ($value === false || $value < 1) {
        throw new RuntimeException("{$name} must be a positive integer.");
    }
    return $value;
}

function validateUrl(string $url, bool $localTest): void
{
    $parts = parse_url($url);
    $https = ($parts['scheme'] ?? '') === 'https';
    $loopback = $localTest && ($parts['scheme'] ?? '') === 'http'
        && in_array($parts['host'] ?? '', ['127.0.0.1', 'localhost'], true);
    if (!filter_var($url, FILTER_VALIDATE_URL) || (!$https && !$loopback)
        || isset($parts['user']) || isset($parts['pass'])) {
        throw new RuntimeException('Expected an HTTPS URL (HTTP loopback is allowed only in local tests).');
    }
}

function apiRequest(string $base, string $key, string $method, string $path,
    ?array $body = null, string $idempotencyKey = '', int $timeout = 30): array
{
    $headers = ['Accept: application/json', 'X-API-Key: ' . $key];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    if ($idempotencyKey !== '') $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
    $curl = curl_init($base . $path);
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => min(10, $timeout),
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_FOLLOWLOCATION => false, // Never forward an API key to a redirect.
    ];
    if ($body !== null) $options[CURLOPT_POSTFIELDS] = json_encode($body, JSON_THROW_ON_ERROR);
    curl_setopt_array($curl, $options);
    $raw = curl_exec($curl);
    $http = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    if ($raw === false) {
        // Do not print cURL errors that could contain private URLs or credentials.
        throw new RuntimeException('API network request failed. Check connectivity and retry safely.');
    }
    if ($http < 200 || $http >= 300) {
        throw new RuntimeException("API returned HTTP {$http}; no response body or credentials were logged.");
    }
    $data = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
    if (!is_array($data)) throw new RuntimeException('API returned an unexpected JSON value.');
    return $data;
}

function downloadBundle(string $url, string $destination, bool $localTest): void
{
    validateUrl($url, $localTest);
    $directory = dirname($destination);
    if (!is_dir($directory)) throw new RuntimeException('Create the destination directory first.');
    if (file_exists($destination) || is_link($destination)) {
        throw new RuntimeException('Destination already exists; choose a new ZIP filename.');
    }
    $temporary = tempnam($directory, '.mr-download-');
    if ($temporary === false) throw new RuntimeException('Cannot create a temporary download.');
    try {
        $file = fopen($temporary, 'wb');
        if ($file === false) throw new RuntimeException('Cannot open temporary download.');
        try {
            // A separate request: the signed bundle URL needs no account API key.
            $curl = curl_init($url);
            curl_setopt_array($curl, [
                CURLOPT_FILE => $file,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS => 5,
                CURLOPT_PROTOCOLS => $localTest ? CURLPROTO_HTTP | CURLPROTO_HTTPS : CURLPROTO_HTTPS,
                CURLOPT_REDIR_PROTOCOLS => $localTest ? CURLPROTO_HTTP | CURLPROTO_HTTPS : CURLPROTO_HTTPS,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_TIMEOUT => 600,
            ]);
            $ok = curl_exec($curl);
            $http = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        } finally {
            fclose($file);
        }
        if (!$ok || $http !== 200 || filesize($temporary) === 0) {
            throw new RuntimeException('Bundle download failed; partial file discarded. Resume the job to retry.');
        }
        $check = fopen($temporary, 'rb');
        $signature = fread($check, 4);
        fclose($check);
        if ($signature !== "PK\x03\x04") throw new RuntimeException('Download was not a nonempty ZIP bundle.');
        // Publish without overwriting an existing file, including one created mid-download.
        if (!link($temporary, $destination)) throw new RuntimeException('Could not publish ZIP without overwriting.');
    } finally {
        unlink($temporary);
    }
}

function main(): void
{
    if (PHP_VERSION_ID < 80200 || !extension_loaded('curl')) {
        throw new RuntimeException('Use PHP 8.2+ with the cURL extension enabled.');
    }
    $key = required('MEDIARUNTIME_API_KEY');
    if (preg_match('/[\r\n]/', $key)) throw new RuntimeException('Invalid API key.');
    $base = rtrim(setting('MEDIARUNTIME_BASE_URL', 'https://mediaruntime.com'), '/');
    $localTest = setting('MEDIARUNTIME_LOCAL_TEST') === '1';
    validateUrl($base, $localTest);
    $destination = setting('MEDIARUNTIME_DOWNLOAD_PATH', __DIR__ . '/outputs.zip');
    if (!is_dir(dirname($destination)) || file_exists($destination) || is_link($destination)) {
        throw new RuntimeException('Choose a new ZIP path in an existing directory before creating a job.');
    }
    $waitSeconds = positiveInteger('MEDIARUNTIME_TIMEOUT_SECONDS', 900);
    $pollSeconds = positiveInteger('MEDIARUNTIME_POLL_SECONDS', 2);
    $jobId = setting('MEDIARUNTIME_JOB_ID');

    if ($jobId === '') {
        $source = required('MEDIARUNTIME_SOURCE');
        validateUrl($source, false);
        // Reuse this key for retries of the SAME request; choose a new one for a new video.
        $idempotencyKey = required('MEDIARUNTIME_IDEMPOTENCY_KEY');
        if (strlen($idempotencyKey) > 128 || preg_match('/[\r\n]/', $idempotencyKey)) {
            throw new RuntimeException('Use an idempotency key up to 128 characters without line breaks.');
        }
        $created = apiRequest($base, $key, 'POST', '/v1/jobs', [
            'source' => $source,
            'outputs' => ['video.web'],
            'metadata' => ['tutorial' => 'php-video-compression'],
        ], $idempotencyKey);
        $jobId = (string) ($created['job_id'] ?? '');
    }
    if (!preg_match('/^[a-zA-Z0-9_-]+$/', $jobId)) throw new RuntimeException('Missing or invalid job ID.');
    printf("Job: %s\nResume with MEDIARUNTIME_JOB_ID=%s\n", $jobId, $jobId);
    $deadline = microtime(true) + $waitSeconds;
    while (true) {
        $remaining = (int) ceil($deadline - microtime(true));
        if ($remaining <= 0) throw new RuntimeException('Polling timed out. Resume this job; do not submit it again.');
        $job = apiRequest($base, $key, 'GET', '/v1/jobs/' . rawurlencode($jobId), timeout: min(30, $remaining));
        $status = strtoupper((string) ($job['status'] ?? ''));
        printf("Status: %s\n", preg_replace('/[^A-Z_]/', '', $status));
        if ($status === 'COMPLETED') break;
        if (in_array($status, ['FAILED', 'REJECTED', 'PARTIAL'], true)) {
            throw new RuntimeException("Job ended with {$status}; no successful bundle will be downloaded.");
        }
        if (!in_array($status, ['QUEUED', 'PROCESSING', 'RUNNING', 'PENDING'], true)) {
            throw new RuntimeException('Unexpected job status; inspect the job before retrying.');
        }
        sleep(min($pollSeconds, max(1, (int) ceil($deadline - microtime(true)))));
    }
    $url = (string) ($job['bundle']['download_url'] ?? '');
    if ($url === '') throw new RuntimeException('Completed job has no bundle URL.');
    downloadBundle($url, $destination, $localTest);
    printf("Saved ZIP: %s\nExtract it, then inspect the MP4 and poster.\n", $destination);
}

try {
    main();
} catch (Throwable $error) {
    fwrite(STDERR, 'Error: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
