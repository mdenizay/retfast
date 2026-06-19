<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('location_points', function (Blueprint $table) {
            $table->id();
            $table->string('flight_id');
            $table->foreign('flight_id')->references('id')->on('flights')->cascadeOnDelete();
            $table->decimal('lat', 10, 7);
            $table->decimal('lng', 10, 7);
            $table->decimal('altitude', 8, 2)->nullable();
            $table->decimal('speed', 6, 2)->nullable();
            $table->decimal('heading', 5, 2)->nullable();
            $table->decimal('accuracy', 6, 2)->nullable();
            $table->timestamp('recorded_at');
            $table->timestamps();

            $table->index(['flight_id', 'recorded_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('location_points');
    }
};
