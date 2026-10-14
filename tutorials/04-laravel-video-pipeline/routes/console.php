<?php

use App\Jobs\AdvanceVideo;
use App\Models\Video;
use App\Services\MediaRuntime;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schedule;

Artisan::command('media:reconcile', function () {
    $count = 0;
    Video::whereNotIn('status', ['ready', 'failed'])->where('created_at', '<', now()->subMinute())->where(function ($q) {
        $q->whereNull('last_checked_at')->orWhere('last_checked_at', '<', now()->subMinute());
    })->chunkById(100, function ($videos) use (&$count) {
        foreach ($videos as $v) {
            AdvanceVideo::dispatch($v->id, 'recovery')->onConnection('database');
            $count++;
        }
    });
    $this->info("Queued {$count} recovery checks.");
})->purpose('Recover missed callbacks and interrupted submissions; no new remote job if job_id exists.');
Schedule::command('media:reconcile')->everyMinute()->withoutOverlapping();

// Explicit local simulation, never presented as provider delivery.
Artisan::command('media:simulate-callback {video?}', function () {
    if (! app()->environment('local') || ! config('media.simulate_callbacks')) {
        $this->error('Enable DEMO_CALLBACK_SIMULATION only for a local demonstration.');

        return 1;
    }
    $base = rtrim(config('app.url'), '/');
    if (! in_array(parse_url($base, PHP_URL_HOST), ['127.0.0.1', 'localhost'], true)) {
        $this->error('Simulation only targets a localhost receiver.');

        return 1;
    }
    $v = $this->argument('video') ? Video::findOrFail($this->argument('video')) : Video::latest()->firstOrFail();
    if (! $v->job_id) {
        $this->info('Waiting for submission.');

        return 2;
    }
    $result = app(MediaRuntime::class)->status($v->job_id);
    if (($result['status'] ?? '') !== 'COMPLETED') {
        $this->info('Remote processing is not completed yet.');

        return 2;
    }
    $id = 'local_demo_'.$v->id;
    $ts = (string) time();
    $body = json_encode(['event_id' => $id, 'job_id' => $v->job_id, 'status' => 'COMPLETED'], JSON_THROW_ON_ERROR);
    $secret = config('media.webhook_secret');
    if (! $secret) {
        $this->error('Configure a local signing secret.');

        return 1;
    }
    $signature = hash_hmac('sha256', $ts.'.'.$id.'.'.$body, $secret);
    $response = Http::withoutRedirecting()->timeout(10)->withHeaders(['X-Transcoder-Id' => $id, 'X-Transcoder-Timestamp' => $ts, 'X-Transcoder-Signature' => "t=$ts,v1=$signature"])->withBody($body, 'application/json')->post($base.'/webhooks/mediaruntime');
    if ($response->status() !== 204) {
        $this->error('Local receiver rejected callback (HTTP '.$response->status().').');

        return 1;
    }
    $this->info('Local signed simulation accepted (HTTP 204). This was NOT a provider-delivered callback.');

    return 0;
})->purpose('Clearly labeled local signed callback simulation after real remote completion.');
