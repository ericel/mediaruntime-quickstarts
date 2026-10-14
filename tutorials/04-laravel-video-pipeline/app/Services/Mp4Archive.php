<?php

namespace App\Services;

use RuntimeException;
use ZipArchive;

class Mp4Archive
{
    public function extract(string $path, string $target): void
    {
        $zip = new ZipArchive;
        if ($zip->open($path) !== true) {
            throw new RuntimeException('Invalid archive.');
        }
        try {
            if ($zip->numFiles > 1000) {
                throw new RuntimeException('Too many entries.');
            }
            $candidates = [];
            $total = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $e = $zip->statIndex($i);
                $name = $e['name'];
                $total += $e['size'];
                if ($total > config('media.max_archive_bytes') || str_starts_with($name, '/') || preg_match('/[\x00-\x1f:\\\\]/', $name) || in_array('..', explode('/', $name), true)) {
                    throw new RuntimeException('Unsafe archive.');
                }
                $zip->getExternalAttributesIndex($i, $system, $attr);
                if ((($attr >> 16) & 0170000) === 0120000) {
                    throw new RuntimeException('Unsafe symlink.');
                }
                if (str_ends_with(strtolower($name), '.mp4')) {
                    $candidates[] = $name;
                }
            }
            if (count($candidates) !== 1) {
                throw new RuntimeException('Expected one MP4 rendition.');
            }
            $in = $zip->getStream($candidates[0]);
            $out = fopen($target, 'wb');
            try {
                $count = stream_copy_to_stream($in, $out, config('media.max_archive_bytes') + 1);
                if (! $count || $count > config('media.max_archive_bytes')) {
                    throw new RuntimeException('Invalid output size.');
                }
            } finally {
                fclose($in);
                fclose($out);
            }
            $probe = fopen($target, 'rb');
            $header = fread($probe, 32);
            fclose($probe);
            if (substr($header, 4, 4) !== 'ftyp') {
                throw new RuntimeException('Expected ISO MP4 header.');
            }
        } finally {
            $zip->close();
        }
    }
}
