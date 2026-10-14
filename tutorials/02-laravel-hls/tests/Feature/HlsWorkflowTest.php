<?php

namespace Tests\Feature;

use App\Jobs\ProcessVideo;
use App\Models\Video;
use App\Services\HlsArchive;
use App\Services\MediaRuntime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Tests\TestCase;
use ZipArchive;

class HlsWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = sys_get_temp_dir().'/laravel-hls-'.bin2hex(random_bytes(6));
        config(['media.root' => $this->root, 'media.api_key' => 'test-only-key', 'media.base_url' => 'https://api.example']);
        File::ensureDirectoryExists($this->root);
        Http::preventStrayRequests();
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->root);
        parent::tearDown();
    }

    private function video(array $attributes = []): Video
    {
        return Video::create(array_merge(['owner' => hash('sha256', 'owner'), 'name' => 'demo.mp4'], $attributes));
    }

    private function zip(array $entries): string
    {
        $path = $this->root.'/bundle.zip';
        $zip = new ZipArchive;
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        foreach ($entries as $name => $body) {
            $zip->addFromString($name, $body);
        }
        $zip->close();

        return $path;
    }

    private function hls(): array
    {
        return ['output/master.m3u8' => "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\n720/index.m3u8\n",
            'output/720/index.m3u8' => "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n",
            'output/720/segment.ts' => 'test-segment'];
    }

    public function test_upload_dispatches_processing_and_hides_credentials(): void
    {
        Queue::fake();
        $this->withSession(['video_owner' => 'owner'])->post('/videos', [
            'video' => UploadedFile::fake()->create('demo.mp4', 100, 'video/mp4'),
        ])->assertRedirect('/');
        $video = Video::firstOrFail();
        $this->assertFileExists($video->directory().'/input.mp4');
        Queue::assertPushed(ProcessVideo::class, fn ($job) => $job->videoId === $video->id);
        $this->getJson('/videos/'.$video->id.'/status')->assertOk()->assertJson(['status' => 'queued'])
            ->assertJsonMissingPath('source_uri')->assertJsonMissingPath('job_id')->assertDontSee('test-only-key');
    }

    public function test_upload_rejects_non_video_and_oversize_files(): void
    {
        Queue::fake();
        foreach ([UploadedFile::fake()->create('bad.txt', 1, 'text/plain'), UploadedFile::fake()->create('large.mp4', 20481, 'video/mp4')] as $file) {
            $this->post('/videos', ['video' => $file])->assertSessionHasErrors('video');
        }
        Queue::assertNothingPushed();
    }

    public function test_status_and_hls_are_scoped_to_the_uploading_session(): void
    {
        $v = $this->video(['status' => 'ready', 'playlist' => 'master.m3u8']);
        File::ensureDirectoryExists($v->directory().'/hls');
        File::put($v->directory().'/hls/master.m3u8', "#EXTM3U\n");
        $this->withSession(['video_owner' => 'other'])->getJson('/videos/'.$v->id.'/status')->assertNotFound();
        $this->get('/videos/'.$v->id.'/media/master.m3u8')->assertNotFound();
        $this->withSession(['video_owner' => 'owner'])->get('/videos/'.$v->id.'/media/master.m3u8')
            ->assertOk()->assertHeader('content-type', 'application/vnd.apple.mpegurl');
        File::put($v->directory().'/secret.ts', 'secret');
        $this->get('/videos/'.$v->id.'/media/../secret.ts')->assertNotFound();
    }

    public function test_preserves_hls_hierarchy_and_discovers_master_by_content(): void
    {
        $playlist = (new HlsArchive)->extract($this->zip($this->hls()), $this->root.'/hls');
        $this->assertSame('output/master.m3u8', $playlist);
        $this->assertFileExists($this->root.'/hls/output/720/segment.ts');
    }

    public function test_unsafe_or_incomplete_archives_are_not_published(): void
    {
        $cases = [['../escape.ts' => 'bad'], ['/absolute.ts' => 'bad'], ['output/a.ts' => 'x'],
            array_merge($this->hls(), ['output/master.m3u8' => "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://external.test/a.m3u8\n"]),
            array_merge($this->hls(), ['output/720/index.m3u8' => "#EXTM3U\nmissing.ts\n"]),
            array_merge($this->hls(), ['output/720/index.m3u8' => "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"../../../../secret.key\"\n"]),
        ];
        foreach ($cases as $entries) {
            try {
                (new HlsArchive)->extract($this->zip($entries), $this->root.'/hls');
                $this->fail('Invalid archive accepted');
            } catch (RuntimeException) {
                $this->assertDirectoryDoesNotExist($this->root.'/hls');
            }
        }
        config(['media.max_archive_bytes' => 5]);
        $this->expectException(RuntimeException::class);
        (new HlsArchive)->extract($this->zip($this->hls()), $this->root.'/hls');
    }

    public function test_upload_and_submit_use_the_contract_and_isolate_api_key(): void
    {
        $v = $this->video();
        File::ensureDirectoryExists($v->directory());
        File::put($v->directory().'/input.mp4', 'test-video');
        Http::fake([
            'https://api.example/v1/upload-url' => Http::response(['upload_url' => 'https://storage.example/upload', 'file_uri' => 'gs://bucket/demo.mp4', 'upload_headers' => ['x-goog-test' => 'required']]),
            'https://storage.example/upload' => function ($request) {
                // Match the real transport, which may close the uploaded resource.
                $request->toPsrRequest()->getBody()->close();

                return Http::response('', 200);
            },
            'https://api.example/v1/jobs' => Http::response(['job_id' => 'job_123'], 202),
        ]);
        $api = new MediaRuntime;
        $v->update(['source_uri' => $api->upload($v)]);
        $this->assertSame('job_123', $api->submit($v));
        Http::assertSent(fn ($r) => $r->url() === 'https://storage.example/upload' && $r->method() === 'PUT' && ! $r->hasHeader('X-API-Key') && $r->hasHeader('x-goog-test', 'required'));
        Http::assertSent(fn ($r) => $r->url() === 'https://api.example/v1/jobs' && $r['outputs'] === ['video.streaming'] && $r['source'] === 'gs://bucket/demo.mp4' && $r->hasHeader('Idempotency-Key', 'laravel-hls-'.$v->id));
    }

    public function test_existing_job_is_polled_without_resubmission(): void
    {
        $v = $this->video(['job_id' => 'existing', 'source_uri' => 'gs://bucket/demo.mp4']);
        $api = $this->mock(MediaRuntime::class);
        $api->shouldNotReceive('upload');
        $api->shouldNotReceive('submit');
        $api->shouldReceive('status')->once()->with('existing')->andReturn(['status' => 'RUNNING']);
        (new ProcessVideo($v->id))->handle($api, new HlsArchive);
        $this->assertSame('processing', $v->fresh()->status);
    }

    public function test_completed_job_publishes_playlist_and_removes_temporary_files(): void
    {
        $v = $this->video(['job_id' => 'existing', 'source_uri' => 'gs://bucket/demo.mp4']);
        File::ensureDirectoryExists($v->directory());
        File::put($v->directory().'/input.mp4', 'test');
        $fixture = $this->zip($this->hls());
        $api = $this->mock(MediaRuntime::class);
        $api->shouldReceive('status')->once()->andReturn(['status' => 'COMPLETED', 'bundle' => ['download_url' => 'https://storage.example/result']]);
        $api->shouldReceive('download')->once()->andReturnUsing(fn ($url, $path) => copy($fixture, $path));
        (new ProcessVideo($v->id))->handle($api, new HlsArchive);
        $this->assertSame('ready', $v->fresh()->status);
        $this->assertSame('output/master.m3u8', $v->fresh()->playlist);
        $this->assertFileDoesNotExist($v->directory().'/input.mp4');
        $this->assertFileDoesNotExist($v->directory().'/bundle.zip');
    }

    public function test_failed_remote_job_and_deadline_stop_processing(): void
    {
        $v = $this->video(['job_id' => 'existing', 'source_uri' => 'gs://bucket/demo.mp4']);
        $api = $this->mock(MediaRuntime::class);
        $api->shouldReceive('status')->once()->andReturn(['status' => 'REJECTED']);
        (new ProcessVideo($v->id))->handle($api, new HlsArchive);
        $this->assertSame('failed', $v->fresh()->status);
        $old = $this->video(['created_at' => now()->subMinutes(31)]);
        (new ProcessVideo($old->id))->handle($api, new HlsArchive);
        $this->assertSame('failed', $old->fresh()->status);
    }

    public function test_exception_does_not_leak_signed_urls_or_credentials(): void
    {
        $v = $this->video();
        $api = $this->mock(MediaRuntime::class);
        $api->shouldReceive('upload')->andThrow(new RuntimeException('secret-token'));
        try {
            (new ProcessVideo($v->id))->handle($api, new HlsArchive);
            $this->fail('Expected exception');
        } catch (RuntimeException $error) {
            $this->assertStringNotContainsString('secret-token', $error->getMessage());
            $this->assertNull($error->getPrevious());
        }
    }

    public function test_bundle_download_is_bounded_and_has_no_account_credentials(): void
    {
        $path = $this->root.'/download.zip';
        Http::fake(function ($request, $options) use ($path) {
            $this->assertSame(3, $options['allow_redirects']['max']);
            $this->assertSame(['https'], $options['allow_redirects']['protocols']);
            $this->assertFalse($request->hasHeader('X-API-Key'));
            $this->assertFalse($request->hasHeader('Authorization'));
            file_put_contents($path, 'fixture');

            return Http::response('fixture', 200);
        });
        (new MediaRuntime)->download('https://storage.example/bundle', $path);
        $this->assertSame('fixture', file_get_contents($path));
    }

    public function test_plain_http_storage_url_is_rejected_before_sending(): void
    {
        $this->expectException(RuntimeException::class);
        (new MediaRuntime)->download('http://storage.example/bundle', $this->root.'/download.zip');
    }
}
