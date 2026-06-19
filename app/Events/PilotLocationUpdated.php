<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PilotLocationUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public \App\Models\Flight $flight,
        public array $location,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("event.{$this->flight->event_id}")];
    }

    public function broadcastAs(): string
    {
        return 'pilot.location';
    }

    public function broadcastWith(): array
    {
        return [
            'flight_id' => $this->flight->id,
            'pilot_id' => $this->flight->pilot_id,
            'status' => $this->flight->status,
            'location' => $this->location,
        ];
    }
}
