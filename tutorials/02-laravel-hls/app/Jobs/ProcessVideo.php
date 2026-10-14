<?php

namespace App\Jobs;

use App\Models\Video;
use App\Services\HlsArchive;
use App\Services\MediaRuntime;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use RuntimeException;
use Throwable;

class ProcessVideo implements ShouldQueue
{
    use Queueable;

    public int $timeout = 300;

    public int $tries = 180;

    public int $maxExceptions = 3;

    public function __construct(public string $videoId) {}

    public function middleware(): array
    {
        return [(new WithoutOverlapping($this->videoId))->expireAfter(330)->releaseAfter(10)];
    }

    public function backoff(): array
    {
        return [10, 30, 60];
    }

    public function handle(MediaRuntime $api, HlsArchive $archive): void
    {
        $video = Video::findOrFail($this->videoId);
        if (in_array($video->status, ['ready', 'failed'], true)) {
            return;
        }
        if ($video->created_at->lt(now()->subMinutes(30))) {
            $video->update(['status' => 'failed', 'error' => 'Processing timed out. Check the job in your MediaRuntime console.']);

            return;
        }
        try {
            $video->update(['status' => 'processing']);
            if (! $video->source_uri) {
                $video->update(['source_uri' => $api->upload($video)]);
            }
            if (! $video->job_id) {
                $video->update(['job_id' => $api->submit($video)]);
            }
            $result = $api->status($video->job_id);
            $status = strtoupper($result['status'] ?? '');
            if (in_array($status, ['FAILED', 'REJECTED', 'PARTIAL'], true)) {
                $video->update(['status' => 'failed', 'error' => 'The remote job did not complete successfully. Check your MediaRuntime console.']);

                return;
            }
            if ($status !== 'COMPLETED') {
                $this->release(10);

                return;
            }
            $url = $result['bundle']['download_url'] ?? null;
            if (! $url) {
                throw new RuntimeException('Completed job has no bundle.');
            }
            $zip = $video->directory().'/bundle.zip';
            $api->download($url, $zip);
            $playlist = $archive->extract($zip, $video->directory().'/hls');
            $video->update(['playlist' => $playlist, 'status' => 'ready', 'error' => null]);
            @unlink($zip);
            @unlink($video->directory().'/input.mp4');
        } catch (Throwable) {
            // HTTP exceptions can contain signed URLs or response bodies; don't log them.
            throw new RuntimeException('Media processing attempt failed. Check configuration, credits, and the MediaRuntime console.');
        }
    }

    public function failed(?Throwable $exception): void
    {
        Video::whereKey($this->videoId)->where('status', '!=', 'ready')->update([
            'status' => 'failed', 'error' => 'Processing failed after retries. Check your configuration and MediaRuntime console.',
        ]);
    }
}
