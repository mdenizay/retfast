<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (int) $user->id === (int) $id;
});

Broadcast::channel('event.{eventId}', function ($user, string $eventId) {
    $event = \App\Models\Event::find($eventId);
    return $event && $user->canManageEvent($event);
});
