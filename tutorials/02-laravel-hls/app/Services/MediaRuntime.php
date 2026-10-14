<?php

namespace App\Services;

use App\Models\Video;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class MediaRuntime
{
    private function api(): PendingRequest
    {
        $base = rtrim(config('media.base_url'), '/');
        if (! str_starts_with($base, 'https://') || ! config('media.api_key')) {
            throw new RuntimeException('Set a HTTPS API URL and API key in .env.');
        }

        return Http::baseUrl($base)->acceptJson()->withHeaders([
            'X-API-Key' => config('media.api_key'),
        ])->connectTimeout(10)->timeout(30)->withoutRedirecting();
    }

    private function signedRequest(string $url): PendingRequest
    {
        if (parse_url($url, PHP_URL_SCHEME) !== 'https' || ! parse_url($url, PHP_URL_HOST)) {
            throw new RuntimeException('Expected a HTTPS storage URL.');
        }

        // Storage requests deliberately do not inherit account authentication.
        return Http::connectTimeout(10)->timeout(100)->withoutRedirecting();
    }

    public function upload(Video $video): string
    {
        $target = $this->api()->post('/v1/upload-url', [
            'filename' => $video->id.'.mp4', 'content_type' => 'video/mp4',
        ])->throw()->json();
        $stream = fopen($video->directory().'/input.mp4', 'rb');
        try {
            $this->signedRequest($target['upload_url'])
                ->withHeaders($target['upload_headers'] ?? [])
                ->withBody($stream, 'video/mp4')->put($target['upload_url'])->throw();
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }

        return $target['file_uri'];
    }

    public function submit(Video $video): string
    {
        $data = $this->api()->withHeaders(['Idempotency-Key' => 'laravel-hls-'.$video->id])
            ->post('/v1/jobs', ['source' => $video->source_uri, 'outputs' => ['video.streaming']])
            ->throw()->json();
        if (empty($data['job_id'])) {
            throw new RuntimeException('Job ID missing.');
        }

        return $data['job_id'];
    }

    public function status(string $jobId): array
    {
        return $this->api()->get('/v1/jobs/'.rawurlencode($jobId))->throw()->json();
    }

    public function download(string $url, string $path): void
    {
        $limit = config('media.max_archive_bytes');
        $response = $this->signedRequest($url)->withOptions([
            'sink' => $path,
            'allow_redirects' => ['max' => 3, 'protocols' => ['https'], 'referer' => false],
            'progress' => function ($total, $received) use ($limit): void {
                if ($total > $limit || $received > $limit) {
                    throw new RuntimeException('Bundle exceeds tutorial download limit.');
                }
            },
        ])->get($url)->throw();
        if (! $response->successful() || ! is_file($path) || filesize($path) > $limit) {
            throw new RuntimeException('Bundle download failed.');
        }
    }
}
