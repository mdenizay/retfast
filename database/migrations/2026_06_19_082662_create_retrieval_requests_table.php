<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('retrieval_requests', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('flight_id');
            $table->foreign('flight_id')->references('id')->on('flights')->cascadeOnDelete();
            $table->foreignId('pilot_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('retriever_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('event_id');
            $table->foreign('event_id')->references('id')->on('events')->cascadeOnDelete();
            $table->enum('status', ['pending', 'assigned', 'en_route', 'picked_up', 'delivered', 'cancelled'])->default('pending');
            $table->decimal('landing_lat', 10, 7);
            $table->decimal('landing_lng', 10, 7);
            $table->string('drop_off_point_id')->nullable();
            $table->foreign('drop_off_point_id')->references('id')->on('drop_off_points')->nullOnDelete();
            $table->timestamp('assigned_at')->nullable();
            $table->timestamp('picked_up_at')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('retrieval_requests');
    }
};
