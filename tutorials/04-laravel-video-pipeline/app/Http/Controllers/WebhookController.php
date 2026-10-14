<?php

namespace App\Http\Controllers;

use App\Jobs\HandleWebhook;
use App\Models\WebhookEvent;
use App\Services\WebhookVerifier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class WebhookController extends Controller
{
    public function __invoke(Request $request, WebhookVerifier $verifier)
    {
        $event = $verifier->verify($request);
        // Same database connection for inbox and queue: commit both before ACK.
        DB::transaction(function () use ($event) {
            $new = DB::table('webhook_events')->insertOrIgnore(['event_id' => $event['event_id'], 'job_id' => $event['job_id'], 'remote_status' => $event['status'], 'state' => 'received', 'created_at' => now(), 'updated_at' => now()]);
            if ($new) {
                HandleWebhook::dispatch(WebhookEvent::where('event_id', $event['event_id'])->value('id'))->onConnection('database');
            }
        });

        return response('', 204);
    }
}
