<?php

namespace App\Services;

use Illuminate\Support\Facades\File;
use RuntimeException;
use ZipArchive;

class HlsArchive
{
    public const MIME = ['m3u8' => 'application/vnd.apple.mpegurl', 'ts' => 'video/mp2t', 'm4s' => 'video/iso.segment', 'mp4' => 'video/mp4', 'aac' => 'audio/aac', 'key' => 'application/octet-stream'];

    public function extract(string $archive, string $destination): string
    {
        $zip = new ZipArchive;
        if ($zip->open($archive) !== true) {
            throw new RuntimeException('Invalid ZIP.');
        }
        $stage = $destination.'.staging';
        File::deleteDirectory($stage);
        File::ensureDirectoryExists($stage);
        try {
            if ($zip->numFiles > 5000) {
                throw new RuntimeException('Too many archive entries.');
            }
            $total = 0;
            $playlists = [];
            $seen = [];
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $stat = $zip->statIndex($i);
                $name = $stat['name'];
                if (! $this->safePath(rtrim($name, '/'))) {
                    throw new RuntimeException('Unsafe archive path.');
                }
                $zip->getExternalAttributesIndex($i, $system, $attributes);
                if ((($attributes >> 16) & 0170000) === 0120000) {
                    throw new RuntimeException('Archive symlink rejected.');
                }
                $total += $stat['size'];
                if ($total > config('media.max_archive_bytes')) {
                    throw new RuntimeException('Expanded archive too large.');
                }
                if (str_ends_with($name, '/')) {
                    continue;
                }
                if (isset($seen[$name])) {
                    throw new RuntimeException('Duplicate archive path.');
                }
                $seen[$name] = true;
                $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
                if (! isset(self::MIME[$extension])) {
                    continue;
                }
                File::ensureDirectoryExists(dirname($stage.'/'.$name));
                $source = $zip->getStream($name);
                $target = fopen($stage.'/'.$name, 'wb');
                if (! $source || ! $target) {
                    throw new RuntimeException('Cannot read archive entry.');
                }
                try {
                    $copied = stream_copy_to_stream($source, $target, $stat['size'] + 1);
                } finally {
                    fclose($source);
                    fclose($target);
                }
                if ($copied !== $stat['size']) {
                    throw new RuntimeException('Invalid archive entry size.');
                }
                if ($extension === 'm3u8') {
                    $playlists[] = $name;
                }
            }
            $masters = [];
            foreach ($playlists as $name) {
                $body = File::get($stage.'/'.$name);
                if (! str_starts_with(trim($body), '#EXTM3U')) {
                    throw new RuntimeException('Invalid HLS playlist.');
                }
                foreach (preg_split('/\R/', $body) as $line) {
                    $line = trim($line);
                    $references = [];
                    if ($line !== '' && $line[0] !== '#') {
                        $references[] = $line;
                    }
                    preg_match_all('/URI="([^"]+)"/', $line, $matches);
                    $references = array_merge($references, $matches[1]);
                    foreach ($references as $reference) {
                        // Local relative paths only; external playlists and key URLs are not published.
                        if (preg_match('/[?#:%\\\\]/', $reference) || str_starts_with($reference, '/')) {
                            throw new RuntimeException('Unsafe playlist reference.');
                        }
                        $resolved = realpath(dirname($stage.'/'.$name).'/'.$reference);
                        if (! $resolved || ! is_file($resolved) || ! str_starts_with($resolved, realpath($stage).DIRECTORY_SEPARATOR)) {
                            throw new RuntimeException('Missing or unsafe HLS asset.');
                        }
                    }
                }
                if (str_contains($body, '#EXT-X-STREAM-INF:')) {
                    $masters[] = $name;
                }
            }
            if (count($masters) !== 1) {
                throw new RuntimeException('Expected one HLS master playlist.');
            }
            File::deleteDirectory($destination);
            if (! rename($stage, $destination)) {
                throw new RuntimeException('Cannot publish HLS files.');
            }

            return $masters[0];
        } finally {
            $zip->close();
            File::deleteDirectory($stage);
        }
    }

    private function safePath(string $path): bool
    {
        return $path !== '' && ! str_starts_with($path, '/') && ! preg_match('/[\x00-\x1f:\\\\]/', $path)
            && ! in_array('..', explode('/', $path), true) && ! in_array('.', explode('/', $path), true);
    }
}
