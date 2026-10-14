<?php

namespace App\Services;

use Illuminate\Http\Request;

class WebhookVerifier
{
    public function verify(Request $request): array
    {
        $secret = (string) config('media.webhook_secret');
        abort_if($secret === '', 503);
        $body = $request->getContent();
        abort_if(strlen($body) > 65536, 413);
        $id = (string) $request->header('X-Transcoder-Id');
        $timestamp = (string) $request->header('X-Transcoder-Timestamp');
        $signature = (string) $request->header('X-Transcoder-Signature');
        abort_unless(preg_match('/^[A-Za-z0-9_-]{1,200}$/D', $id) && preg_match('/^[0-9]{10,12}$/D', $timestamp), 401);
        abort_if(abs(time() - (int) $timestamp) > 300, 401);
        abort_unless(preg_match('/^t=([0-9]{10,12}),v1=([a-f0-9]{64})$/D', $signature, $parts) && $parts[1] === $timestamp, 401);
        $expected = hash_hmac('sha256', $timestamp.'.'.$id.'.'.$body, $secret);
        abort_unless(hash_equals($expected, $parts[2]), 401);
        $event = json_decode($body, true);
        abort_unless(is_array($event) && ($event['event_id'] ?? null) === $id && is_string($event['job_id'] ?? null) && preg_match('/^[A-Za-z0-9_-]{1,200}$/D', $event['job_id']) && in_array($event['status'] ?? null, ['COMPLETED', 'FAILED', 'REJECTED', 'PARTIAL'], true), 422);

        return $event;
    }
}
