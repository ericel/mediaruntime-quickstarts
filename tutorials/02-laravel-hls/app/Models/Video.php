<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Video extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected $hidden = ['owner', 'source_uri', 'job_id'];

    public function directory(): string
    {
        return config('media.root').'/'.$this->id;
    }
}
