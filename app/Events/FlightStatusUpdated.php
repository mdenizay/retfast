<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class FlightStatusUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public \App\Models\Flight $flight) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("event.{$this->flight->event_id}")];
    }

    public function broadcastAs(): string
    {
        return 'flight.status';
    }

    public function broadcastWith(): array
    {
        return $this->flight->toArray();
    }
}
