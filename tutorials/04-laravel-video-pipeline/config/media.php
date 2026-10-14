<?php

return [
    'simulate_callbacks' => env('DEMO_CALLBACK_SIMULATION', false),
    'base_url' => env('MEDIARUNTIME_BASE_URL', 'https://mediaruntime.com'),
    'api_key' => env('MEDIARUNTIME_API_KEY'),
    'webhook_secret' => env('MEDIARUNTIME_WEBHOOK_SECRET'),
    'deliver_webhook' => env('MEDIARUNTIME_DELIVER_WEBHOOK', true),
    'root' => env('MEDIA_ROOT', storage_path('app/pipeline-work')),
    'disk' => env('MEDIA_DISK', 'local'),
    'max_archive_bytes' => 100 * 1024 * 1024,
];
