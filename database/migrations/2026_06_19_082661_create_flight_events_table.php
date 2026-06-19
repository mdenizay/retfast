<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('flight_events', function (Blueprint $table) {
            $table->id();
            $table->string('flight_id');
            $table->foreign('flight_id')->references('id')->on('flights')->cascadeOnDelete();
            $table->string('event_id');
            $table->foreign('event_id')->references('id')->on('events')->cascadeOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->enum('type', [
                'started', 'landed', 'sos', 'sos_resolved',
                'retrieval_requested', 'retrieval_assigned', 'retrieval_cancelled',
                'en_route', 'picked_up', 'delivered', 'completed', 'admin_completed',
            ]);
            $table->string('message')->nullable();
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['flight_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('flight_events');
    }
};
