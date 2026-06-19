<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RetrievalRequest extends Model
{
    use HasUlids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'flight_id',
        'pilot_id',
        'retriever_id',
        'event_id',
        'status',
        'landing_lat',
        'landing_lng',
        'drop_off_point_id',
        'assigned_at',
        'picked_up_at',
        'delivered_at',
    ];

    protected function casts(): array
    {
        return [
            'landing_lat' => 'decimal:8',
            'landing_lng' => 'decimal:8',
            'assigned_at' => 'datetime',
            'picked_up_at' => 'datetime',
            'delivered_at' => 'datetime',
        ];
    }

    public function flight(): BelongsTo
    {
        return $this->belongsTo(Flight::class);
    }

    public function pilot(): BelongsTo
    {
        return $this->belongsTo(User::class, 'pilot_id');
    }

    public function retriever(): BelongsTo
    {
        return $this->belongsTo(User::class, 'retriever_id');
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    public function dropOffPoint(): BelongsTo
    {
        return $this->belongsTo(DropOffPoint::class);
    }
}
