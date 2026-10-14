<?php

namespace App\Jobs;

use App\Models\Video;
use App\Models\WebhookEvent;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;

class HandleWebhook implements ShouldQueue
{
    use Queueable;

    public int $tries = 30;

    public int $timeout = 30;

    public function __construct(public int $eventId) {}

    public function handle(): void
    {
        $event = WebhookEvent::findOrFail($this->eventId);
        if ($event->state !== 'received') {
            return;
        }
        $video = Video::where('job_id', $event->job_id)->first();
        if (! $video) {
            // Callback can beat the transaction that saves the submission's job ID.
            if ($event->created_at->gt(now()->subMinutes(2))) {
                $this->release(5);

                return;
            }
            $event->update(['state' => 'unmatched']);

            return;
        }
        DB::transaction(function () use ($event, $video) {
            $locked = WebhookEvent::whereKey($event->id)->lockForUpdate()->firstOrFail();
            if ($locked->state !== 'received') {
                return;
            }
            $video->update(['callback_at' => now()]);
            AdvanceVideo::dispatch($video->id, 'webhook')->onConnection('database');
            $locked->update(['state' => 'queued']);
        });
    }
}
