<?php

return [
    'base_url' => env('MEDIARUNTIME_BASE_URL', 'https://mediaruntime.com'),
    'api_key' => env('MEDIARUNTIME_API_KEY'),
    'root' => env('MEDIA_ROOT', storage_path('app/private/media')),
    'max_archive_bytes' => 200 * 1024 * 1024,
];
