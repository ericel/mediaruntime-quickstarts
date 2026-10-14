<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Video extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected $hidden = ['owner', 'source_uri', 'job_id'];

    protected function casts(): array
    {
        return ['callback_at' => 'datetime', 'last_checked_at' => 'datetime'];
    }

    public function directory(): string
    {
        return config('media.root').'/'.$this->id;
    }
}
