<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('videos', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('owner', 64)->index();
            $table->string('name');
            $table->string('status')->default('queued');
            $table->text('source_uri')->nullable();
            $table->string('job_id')->nullable()->unique();
            $table->string('object_key')->nullable();
            $table->string('disk');
            $table->string('completion_via')->nullable();
            $table->timestamp('callback_at')->nullable();
            $table->timestamp('last_checked_at')->nullable();
            $table->text('error')->nullable();
            $table->timestamps();
        });
        Schema::create('webhook_events', function (Blueprint $table) {
            $table->id();
            $table->string('event_id', 200)->unique();
            $table->string('job_id', 200)->index();
            $table->string('remote_status', 30);
            $table->string('state')->default('received');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webhook_events');
        Schema::dropIfExists('videos');
    }
};
