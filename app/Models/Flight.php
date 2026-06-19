<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Flight extends Model
{
    use HasUlids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'event_id',
        'pilot_id',
        'flight_number',
        'status',
        'started_at',
        'landed_at',
        'completed_at',
        'sos_triggered_at',
        'landing_lat',
        'landing_lng',
    ];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'landed_at' => 'datetime',
            'completed_at' => 'datetime',
            'sos_triggered_at' => 'datetime',
            'landing_lat' => 'decimal:8',
            'landing_lng' => 'decimal:8',
        ];
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    public function pilot(): BelongsTo
    {
        return $this->belongsTo(User::class, 'pilot_id');
    }

    public function locationPoints(): HasMany
    {
        return $this->hasMany(LocationPoint::class)->orderBy('recorded_at');
    }

    public function retrievalRequest(): HasOne
    {
        return $this->hasOne(RetrievalRequest::class)->latestOfMany();
    }

    public function flightEvents(): HasMany
    {
        return $this->hasMany(FlightEvent::class)->orderBy('created_at');
    }

    public function isActive(): bool
    {
        return in_array($this->status, ['flying', 'sos', 'landed']);
    }
}
