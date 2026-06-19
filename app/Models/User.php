<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'password',
        'role',
        'phone',
        'avatar_url',
        'is_active',
        'device_token',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
        ];
    }

    public function managedEvents(): BelongsToMany
    {
        return $this->belongsToMany(Event::class, 'event_managers');
    }

    public function applications(): HasMany
    {
        return $this->hasMany(EventApplication::class);
    }

    public function flights(): HasMany
    {
        return $this->hasMany(Flight::class, 'pilot_id');
    }

    public function retrieverSessions(): HasMany
    {
        return $this->hasMany(RetrieverSession::class);
    }

    public function isAdmin(): bool
    {
        return $this->role === 'admin';
    }

    public function isEventManager(): bool
    {
        return $this->role === 'event_manager';
    }

    public function isPilot(): bool
    {
        return $this->role === 'pilot';
    }

    public function isRetriever(): bool
    {
        return $this->role === 'retriever';
    }

    public function canManageEvent(Event $event): bool
    {
        if ($this->isAdmin()) {
            return true;
        }

        if ($this->isEventManager()) {
            return $this->managedEvents()->where('events.id', $event->id)->exists();
        }

        return false;
    }
}
