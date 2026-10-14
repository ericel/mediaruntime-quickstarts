<?php

declare(strict_types=1);
require __DIR__.'/app.php';
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
if (! extension_loaded('curl') || ! extension_loaded('zip')) {
    throw new RuntimeException('Enable PHP cURL and ZIP.');
}
$once = in_array('--once', $argv, true);
do {
    foreach (glob(mediaRoot().'/*/job.json') as $path) {
        $lock = fopen(dirname($path).'/worker.lock', 'c');
        if (! $lock || ! flock($lock, LOCK_EX | LOCK_NB)) {
            if ($lock) {
                fclose($lock);
            }

continue;
        }
        try {
            $job = readJob(basename(dirname($path)));
            if (! in_array($job['status'], ['ready', 'failed'], true)) {
                processJob($job);
            }
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
    if (! $once) {
        sleep(3);
    }
} while (! $once);
