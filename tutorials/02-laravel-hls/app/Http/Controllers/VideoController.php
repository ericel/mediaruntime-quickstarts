<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessVideo;
use App\Models\Video;
use App\Services\HlsArchive;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
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
        return view('videos', ['videos' => Video::where('owner', $this->owner($request))->latest()->limit(10)->get()]);
    }

    public function store(Request $request)
    {
        $request->validate(['video' => ['required', 'file', 'mimes:mp4', 'max:20480']]);
        $video = Video::create(['owner' => $this->owner($request), 'name' => $request->file('video')->getClientOriginalName()]);
        File::ensureDirectoryExists($video->directory());
        $request->file('video')->move($video->directory(), 'input.mp4');
        ProcessVideo::dispatch($video->id);

        return redirect()->route('videos.index')->with('notice', 'Upload accepted. The queue worker will start processing.');
    }

    public function status(Request $request, Video $video)
    {
        abort_unless(hash_equals($video->owner, $this->owner($request)), 404);

        return response()->json(['id' => $video->id, 'status' => $video->status, 'error' => $video->error,
            'playlist' => $video->status === 'ready' ? route('videos.media', [$video, $video->playlist]) : null,
        ])->header('Cache-Control', 'no-store');
    }

    public function media(Request $request, Video $video, string $path)
    {
        abort_unless(hash_equals($video->owner, $this->owner($request)) && $video->status === 'ready', 404);
        $root = realpath($video->directory().'/hls');
        $file = realpath($video->directory().'/hls/'.$path);
        $mime = HlsArchive::MIME[strtolower(pathinfo($path, PATHINFO_EXTENSION))] ?? null;
        abort_unless($root && $file && is_file($file) && str_starts_with($file, $root.DIRECTORY_SEPARATOR) && $mime, 404);

        return response()->file($file, ['Content-Type' => $mime, 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']);
    }
}
