<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('flights', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('event_id');
            $table->foreign('event_id')->references('id')->on('events')->cascadeOnDelete();
            $table->foreignId('pilot_id')->constrained('users')->cascadeOnDelete();
            $table->unsignedSmallInteger('flight_number')->default(1);
            $table->enum('status', ['flying', 'landed', 'sos', 'completed'])->default('flying');
            $table->timestamp('started_at')->useCurrent();
            $table->timestamp('landed_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('sos_triggered_at')->nullable();
            $table->decimal('landing_lat', 10, 7)->nullable();
            $table->decimal('landing_lng', 10, 7)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('flights');
    }
};
