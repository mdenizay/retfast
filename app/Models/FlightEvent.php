<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FlightEvent extends Model
{
    protected $fillable = [
        'flight_id',
        'event_id',
        'actor_id',
        'type',
        'message',
        'lat',
        'lng',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'lat' => 'decimal:8',
            'lng' => 'decimal:8',
        ];
    }

    public function flight(): BelongsTo
    {
        return $this->belongsTo(Flight::class);
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
