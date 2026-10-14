<?php

namespace App\Jobs;

use App\Models\Video;
use App\Services\MediaRuntime;
use App\Services\Mp4Archive;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Throwable;

class AdvanceVideo implements ShouldQueue
{
    use Queueable;

    public int $timeout = 300;

    public int $tries = 20;

    public int $maxExceptions = 3;

    public function __construct(public string $videoId, public string $via = 'submission') {}

    public function middleware(): array
    {
        return [(new WithoutOverlapping('video:'.$this->videoId))->shared()->expireAfter(330)->releaseAfter(10)];
    }

    public function backoff(): array
    {
        return [10, 30, 60];
    }

    public function handle(MediaRuntime $api, Mp4Archive $archive): void
    {
        $v = Video::findOrFail($this->videoId);
        if (in_array($v->status, ['ready', 'failed'], true)) {
            return;
        }
        if ($v->created_at->lt(now()->subMinutes(30))) {
            $v->update(['status' => 'failed', 'error' => 'Processing deadline passed. Inspect the remote job before retrying.']);

            return;
        }
        try {
            if (! $v->source_uri) {
                $v->update(['status' => 'uploading']);
                $v->update(['source_uri' => $api->upload($v)]);
            }
            if (! $v->job_id) {
                $v->update(['job_id' => $api->submit($v), 'status' => 'processing']);

                return;
            }
            // Webhooks wake the worker; the authenticated status API is authoritative.
            $result = $api->status($v->job_id);
            $v->update(['last_checked_at' => now()]);
            $status = strtoupper($result['status'] ?? '');
            if (in_array($status, ['FAILED', 'REJECTED', 'PARTIAL', 'CANCELLED', 'CANCELED'], true)) {
                $v->update(['status' => 'failed', 'error' => 'Remote processing did not finish successfully.']);

                return;
            }
            if ($status !== 'COMPLETED') {
                return;
            }
            $url = $result['bundle']['download_url'] ?? null;
            if (! $url) {
                throw new RuntimeException('No completed bundle.');
            }
            $v->update(['status' => 'saving']);
            $zip = $v->directory().'/bundle.zip';
            $mp4 = $v->directory().'/result.mp4';
            $api->download($url, $zip);
            $archive->extract($zip, $mp4);
            $key = 'videos/'.$v->id.'/video.mp4';
            $stream = fopen($mp4, 'rb');
            try {
                if (! Storage::disk($v->disk)->put($key, $stream, ['visibility' => 'private', 'ContentType' => 'video/mp4'])) {
                    throw new RuntimeException('Storage write failed.');
                }
            } finally {
                fclose($stream);
            }
            // Stable object key makes a retry replace the same object, not create duplicates.
            $v->update(['object_key' => $key, 'status' => 'ready', 'completion_via' => $this->via, 'error' => null]);
            foreach (['input.mp4', 'bundle.zip', 'result.mp4'] as $name) {
                @unlink($v->directory().'/'.$name);
            }
        } catch (Throwable) {
            throw new RuntimeException('Pipeline attempt failed. Inspect configuration and the MediaRuntime console; credentials and URLs are omitted.');
        }
    }

    public function failed(?Throwable $error): void
    {
        Video::whereKey($this->videoId)->where('status', '!=', 'ready')->update(['status' => 'failed', 'error' => 'Pipeline stopped after retries. Inspect the remote job before retrying.']);
    }
}
