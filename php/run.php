<?php

declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

use GuzzleHttp\Client;
use RuntimeException;

// Fail before making an API request when a required server-side setting is absent.
function requiredEnv(string $name): string
{
    $value = trim((string) getenv($name));
    if ($value === '') {
        throw new RuntimeException("Set {$name} before running this quickstart");
    }
    return $value;
}

// Keep the API key in a server-side secret store; never expose it in browser code.
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

// A source may be public or a time-limited signed read URL. The output alias
// expands to a maintained artifact set before MediaRuntime executes the job.
$response = $client->post('/v1/jobs', [
    // This quickstart intentionally creates a new logical job on every run.
    // Production code should derive this key from a stable asset or operation ID.
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

// Polling keeps this standalone example simple. Production services should
// persist $jobId and normally consume signed terminal webhooks instead.
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

// The signed, time-limited URL returns one ZIP containing every requested
// rendition, report, subtitle and metadata file. Guzzle streams it to disk.
$downloadClient = new Client(['timeout' => 600, 'allow_redirects' => true]);
$downloadClient->get($bundleUrl, ['sink' => $downloadPath]);
printf("Downloaded %s bundle to %s\n", $jobId, $downloadPath);
