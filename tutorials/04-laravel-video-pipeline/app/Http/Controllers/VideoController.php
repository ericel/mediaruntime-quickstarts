<?php

namespace App\Http\Controllers;

use App\Jobs\AdvanceVideo;
use App\Models\Video;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class VideoController extends Controller
{
    private function owner(Request $request): string
    {
        if (! $request->session()->has('video_owner')) {
            $request->session()->put('video_owner', Str::random(40));
        }

        return hash('sha256', $request->session()->get('video_owner'));
    }

    public function index(Request $request)
    {
        return view('videos', ['videos' => Video::where('owner', $this->owner($request))->latest()->limit(6)->get()]);
    }

    public function store(Request $request)
    {
        $request->validate(['video' => ['required', 'file', 'mimes:mp4', 'max:20480']]);
        $id = (string) Str::uuid();
        $directory = config('media.root').'/'.$id;
        File::ensureDirectoryExists($directory, 0700);
        $request->file('video')->move($directory, 'input.mp4');
        DB::transaction(function () use ($request, $id) {
            $v = Video::create(['id' => $id, 'owner' => $this->owner($request), 'name' => $request->file('video')->getClientOriginalName(), 'disk' => config('media.disk')]);
            AdvanceVideo::dispatch($v->id)->onConnection('database');
        });

        return redirect()->route('videos.index');
    }

    public function status(Request $request, Video $video)
    {
        abort_unless(hash_equals($video->owner, $this->owner($request)), 404);

        return response()->json(['status' => $video->status, 'error' => $video->error, 'callback_received' => (bool) $video->callback_at, 'completion_via' => $video->completion_via, 'disk' => $video->disk, 'playback' => $video->status === 'ready' ? route('videos.media', $video) : null])->header('Cache-Control', 'no-store');
    }

    public function media(Request $request, Video $video)
    {
        abort_unless(hash_equals($video->owner, $this->owner($request)) && $video->status === 'ready', 404);
        $disk = Storage::disk($video->disk);
        // S3 signed playback URL lasts 5 minutes; request another through this owned route.
        if (config('filesystems.disks.'.$video->disk.'.driver') === 's3') {
            return redirect()->away($disk->temporaryUrl($video->object_key, now()->addMinutes(5), ['ResponseContentType' => 'video/mp4']));
        }

        return response()->file($disk->path($video->object_key), ['Content-Type' => 'video/mp4', 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']);
    }
}
