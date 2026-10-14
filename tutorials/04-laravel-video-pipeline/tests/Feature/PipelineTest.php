<?php

namespace Tests\Feature;

use App\Jobs\AdvanceVideo;
use App\Jobs\HandleWebhook;
use App\Models\Video;
use App\Models\WebhookEvent;
use App\Services\MediaRuntime;
use App\Services\Mp4Archive;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\TestCase;
use ZipArchive;

class PipelineTest extends TestCase
{
    use RefreshDatabase;

    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = sys_get_temp_dir().'/pipeline-'.bin2hex(random_bytes(5));
        File::ensureDirectoryExists($this->root);
        config(['media.root' => $this->root, 'media.disk' => 'local', 'media.api_key' => 'fixture-api-key', 'media.deliver_webhook' => true, 'media.simulate_callbacks' => false, 'media.webhook_secret' => 'fixture-signing-secret', 'media.base_url' => 'https://api.example.test', 'queue.connections.database.connection' => null, 'queue.connections.database.after_commit' => false]);
        Storage::fake('local');
        Http::preventStrayRequests();
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->root);
        parent::tearDown();
    }

    private function video(array $attrs = []): Video
    {
        $v = Video::create(array_merge(['owner' => hash('sha256', 'owner-token'), 'name' => 'original.mp4', 'status' => 'processing', 'disk' => 'local', 'source_uri' => 'gs://fixture/input.mp4', 'job_id' => 'remote-1'], $attrs));
        File::ensureDirectoryExists($v->directory());
        file_put_contents($v->directory().'/input.mp4', 'source');

        return $v;
    }

    private function webhook(array $changes = [], int $age = 0, ?string $bodyOverride = null, ?string $signatureOverride = null)
    {
        $event = array_merge(['event_id' => 'evt-1', 'job_id' => 'remote-1', 'status' => 'COMPLETED'], $changes);
        $body = json_encode($event);
        $ts = (string) (time() - $age);
        $sig = hash_hmac('sha256', $ts.'.'.$event['event_id'].'.'.$body, 'fixture-signing-secret');

        return $this->call('POST', '/webhooks/mediaruntime', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_TRANSCODER_ID' => $event['event_id'], 'HTTP_X_TRANSCODER_TIMESTAMP' => $ts, 'HTTP_X_TRANSCODER_SIGNATURE' => $signatureOverride ?? "t=$ts,v1=$sig"], $bodyOverride ?? $body);
    }

    private function bundle(string $path, array $entries = ['result/video.mp4' => null]): void
    {
        $zip = new ZipArchive;
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        foreach ($entries as $name => $bytes) {
            $zip->addFromString($name, $bytes ?? ("\0\0\0\x18ftypisom".str_repeat("\0", 32)));
        }$zip->close();
    }

    private function completedApi(): MediaRuntime
    {
        $api = Mockery::mock(MediaRuntime::class);
        $api->shouldReceive('status')->once()->with('remote-1')->andReturn(['status' => 'COMPLETED', 'bundle' => ['download_url' => 'https://storage.example.test/bundle']]);
        $api->shouldReceive('download')->once()->andReturnUsing(function ($url, $path) {
            $this->bundle($path);
        });

        return $api;
    }

    public function test_signed_callback_is_durable_and_duplicate_is_not_enqueued_twice(): void
    {
        $this->webhook()->assertNoContent();
        $this->assertDatabaseCount('webhook_events', 1);
        $this->assertDatabaseCount('jobs', 1);
        $this->webhook()->assertNoContent();
        $this->assertDatabaseCount('jobs', 1);
        $this->assertDatabaseMissing('webhook_events', ['state' => 'queued']);
    }

    public function test_tampered_stale_and_forged_events_are_rejected(): void
    {
        $this->webhook(bodyOverride: '{}')->assertUnauthorized();
        $this->webhook(age: 301)->assertUnauthorized();
        $this->webhook(signatureOverride: 't=123,v1=bad')->assertUnauthorized();
        $this->assertDatabaseCount('webhook_events', 0);
        $this->assertDatabaseCount('jobs', 0);
    }

    public function test_unconfigured_receiver_fails_closed_and_invalid_payload_is_rejected(): void
    {
        $this->webhook(['status' => 'PROCESSING'])->assertStatus(422);
        config(['media.webhook_secret' => '']);
        $this->webhook()->assertStatus(503);
        $this->assertDatabaseCount('jobs', 0);
    }

    public function test_queue_failure_rolls_back_inbox_before_acknowledgement(): void
    {
        Bus::shouldReceive('dispatch')->once()->andThrow(new \RuntimeException('queue unavailable'));
        $this->webhook()->assertStatus(500);
        $this->assertDatabaseCount('webhook_events', 0);
    }

    public function test_verified_callback_wakes_existing_job_then_publishes_private_copy(): void
    {
        $v = $this->video();
        $this->webhook()->assertNoContent();
        $event = WebhookEvent::first();
        (new HandleWebhook($event->id))->handle();
        $this->assertNotNull($v->fresh()->callback_at);
        $this->assertSame('queued', $event->fresh()->state);
        $this->assertDatabaseCount('jobs', 2);
        (new AdvanceVideo($v->id, 'webhook'))->handle($this->completedApi(), new Mp4Archive);
        $v->refresh();
        $this->assertSame('ready', $v->status);
        $this->assertSame('webhook', $v->completion_via);
        Storage::disk('local')->assertExists($v->object_key);
        $this->assertSame('private', Storage::disk('local')->getVisibility($v->object_key));
        $this->assertFileDoesNotExist($v->directory().'/input.mp4');
    }

    public function test_early_callback_waits_for_saved_remote_id_then_matches(): void
    {
        $v = $this->video(['job_id' => null]);
        $this->webhook();
        $e = WebhookEvent::first();
        $job = (new HandleWebhook($e->id))->withFakeQueueInteractions();
        $job->handle();
        $job->assertReleased(5);
        $v->update(['job_id' => 'remote-1']);
        (new HandleWebhook($e->id))->handle();
        $this->assertSame('queued', $e->fresh()->state);
    }

    public function test_unrelated_old_callback_is_ignored_without_processing_an_unknown_job(): void
    {
        $this->webhook();
        $e = WebhookEvent::first();
        $e->update(['created_at' => now()->subMinutes(3)]);
        (new HandleWebhook($e->id))->handle();
        $this->assertSame('unmatched', $e->fresh()->state);
    }

    public function test_event_status_is_not_used_as_authoritative_processing_result(): void
    {
        $v = $this->video();
        $api = Mockery::mock(MediaRuntime::class);
        $api->shouldReceive('status')->once()->andReturn(['status' => 'PROCESSING']);
        (new AdvanceVideo($v->id, 'webhook'))->handle($api, new Mp4Archive);
        $this->assertSame('processing', $v->fresh()->status);
        $this->assertNull($v->fresh()->object_key);
    }

    public function test_terminal_failure_does_not_download_or_publish(): void
    {
        $v = $this->video();
        $api = Mockery::mock(MediaRuntime::class);
        $api->shouldReceive('status')->once()->andReturn(['status' => 'REJECTED']);
        (new AdvanceVideo($v->id, 'webhook'))->handle($api, new Mp4Archive);
        $this->assertSame('failed', $v->fresh()->status);
    }

    public function test_ready_and_expired_jobs_make_no_remote_calls(): void
    {
        $api = Mockery::mock(MediaRuntime::class);
        $v = $this->video(['status' => 'ready']);
        (new AdvanceVideo($v->id))->handle($api, new Mp4Archive);
        $v->update(['status' => 'processing', 'created_at' => now()->subMinutes(31)]);
        (new AdvanceVideo($v->id))->handle($api, new Mp4Archive);
        $this->assertSame('failed', $v->fresh()->status);
    }

    public function test_reconciliation_recovers_a_missing_callback_without_resubmission(): void
    {
        $v = $this->video(['created_at' => now()->subMinutes(2)]);
        $this->artisan('media:reconcile')->assertSuccessful();
        $this->assertDatabaseCount('jobs', 1);
        (new AdvanceVideo($v->id, 'recovery'))->handle($this->completedApi(), new Mp4Archive);
        $this->assertSame('recovery', $v->fresh()->completion_via);
    }

    public function test_unsafe_ambiguous_and_non_mp4_archives_are_rejected(): void
    {
        foreach ([['../outside.mp4' => null], ['a.mp4' => null, 'b.mp4' => null], ['a.mp4' => 'not video']] as $entries) {
            $path = $this->root.'/test.zip';
            $this->bundle($path, $entries);
            $failed = false;
            try {
                (new Mp4Archive)->extract($path, $this->root.'/output.mp4');
            } catch (\RuntimeException) {
                $failed = true;
            }$this->assertTrue($failed);
        }
    }

    public function test_session_ownership_protects_status_and_saved_video(): void
    {
        $v = $this->video(['status' => 'ready', 'object_key' => 'videos/result.mp4']);
        Storage::disk('local')->put($v->object_key, 'fixture');
        $this->get('/videos/'.$v->id.'/status')->assertNotFound();
        $this->get('/videos/'.$v->id.'/media')->assertNotFound();
        $this->withSession(['video_owner' => 'owner-token'])->get('/videos/'.$v->id.'/status')->assertOk()->assertJsonPath('status', 'ready')->assertJsonMissingPath('job_id');
        $this->withSession(['video_owner' => 'owner-token'])->get('/videos/'.$v->id.'/media')->assertOk()->assertHeader('Content-Type', 'video/mp4');
    }

    public function test_upload_is_queued_without_calling_api_in_browser_request(): void
    {
        $this->post('/videos', ['video' => UploadedFile::fake()->create('demo.mp4', 10, 'video/mp4')])->assertRedirect('/');
        $this->assertDatabaseCount('videos', 1);
        $this->assertDatabaseCount('jobs', 1);
        Http::assertNothingSent();
    }

    public function test_submit_uses_stable_idempotency_metadata_and_webhook_flag(): void
    {
        $v = $this->video();
        Http::fake(['https://api.example.test/v1/jobs' => Http::response(['job_id' => 'new-job'])]);
        $this->assertSame('new-job', (new MediaRuntime)->submit($v));
        Http::assertSent(fn ($r) => $r->hasHeader('Idempotency-Key', 'laravel-pipeline-'.$v->id) && $r['outputs'] === ['video.web'] && $r['deliver_webhook'] === true && $r['metadata']['tutorial_video_id'] === $v->id);
    }

    public function test_storage_put_failure_never_marks_video_ready(): void
    {
        $v = $this->video();
        Storage::shouldReceive('disk')->once()->with('local')->andReturn(Mockery::mock()->shouldReceive('put')->once()->andReturn(false)->getMock());
        try {
            (new AdvanceVideo($v->id, 'webhook'))->handle($this->completedApi(), new Mp4Archive);
            $this->fail('Expected failure');
        } catch (\RuntimeException) {
        }
        $this->assertSame('saving', $v->fresh()->status);
        $this->assertNull($v->fresh()->object_key);
    }
}
