<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Event extends Model
{
    use HasUlids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'name',
        'description',
        'location',
        'status',
        'start_date',
        'end_date',
        'map_center_lat',
        'map_center_lng',
        'map_zoom',
        'location_update_interval_seconds',
        'max_pilots',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'start_date' => 'datetime',
            'end_date' => 'datetime',
            'map_center_lat' => 'decimal:8',
            'map_center_lng' => 'decimal:8',
        ];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function managers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'event_managers');
    }

    public function dropOffPoints(): HasMany
    {
        return $this->hasMany(DropOffPoint::class);
    }

    public function applications(): HasMany
    {
        return $this->hasMany(EventApplication::class);
    }

    public function flights(): HasMany
    {
        return $this->hasMany(Flight::class);
    }

    public function retrieverSessions(): HasMany
    {
        return $this->hasMany(RetrieverSession::class);
    }

    public function scopeForUser(Builder $query, User $user): Builder
    {
        if ($user->isAdmin()) {
            return $query;
        }

        return $query->whereHas('managers', function (Builder $q) use ($user) {
            $q->where('users.id', $user->id);
        });
    }
}
