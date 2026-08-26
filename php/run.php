<?php

declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

use GuzzleHttp\Client;
use RuntimeException;

function requiredEnv(string $name): string
{
    $value = trim((string) getenv($name));
    if ($value === '') {
        throw new RuntimeException("Set {$name} before running this quickstart");
    }
    return $value;
}

$apiKey = requiredEnv('MEDIARUNTIME_API_KEY');
$source = requiredEnv('MEDIARUNTIME_SOURCE');
$baseUrl = rtrim((string) (getenv('MEDIARUNTIME_BASE_URL') ?: 'https://mediaruntime.com'), '/');
$downloadPath = (string) (getenv('MEDIARUNTIME_DOWNLOAD_PATH') ?: 'outputs.zip');
$outputAlias = trim((string) (getenv('MEDIARUNTIME_OUTPUT_ALIAS') ?: 'video.web'));

$client = new Client([
    'base_uri' => $baseUrl,
    'timeout' => 120,
    'headers' => [
        'X-API-Key' => $apiKey,
        'Accept' => 'application/json',
    ],
]);

$response = $client->post('/v1/jobs', [
    'headers' => ['Idempotency-Key' => 'quickstart:php:' . bin2hex(random_bytes(12))],
    'json' => [
        'source' => $source,
        'outputs' => [$outputAlias],
        'metadata' => ['quickstart' => 'php'],
    ],
]);
$created = json_decode((string) $response->getBody(), true, flags: JSON_THROW_ON_ERROR);
$jobId = (string) $created['job_id'];
printf("Created %s\n", $jobId);

$deadline = time() + (15 * 60);
do {
    if (time() >= $deadline) {
        throw new RuntimeException("Timed out waiting for {$jobId}");
    }
    sleep(2);
    $response = $client->get('/v1/jobs/' . rawurlencode($jobId));
    $job = json_decode((string) $response->getBody(), true, flags: JSON_THROW_ON_ERROR);
    $status = strtoupper((string) $job['status']);
    printf("Status: %s\n", $status);
} while (!in_array($status, ['COMPLETED', 'FAILED', 'REJECTED', 'PARTIAL'], true));

$bundleUrl = (string) ($job['bundle']['download_url'] ?? '');
if ($status !== 'COMPLETED' || $bundleUrl === '') {
    throw new RuntimeException("Job {$jobId} ended with {$status}");
}

$downloadClient = new Client(['timeout' => 600, 'allow_redirects' => true]);
$downloadClient->get($bundleUrl, ['sink' => $downloadPath]);
printf("Downloaded %s bundle to %s\n", $jobId, $downloadPath);
