<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class RetrieverLocationUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public \App\Models\RetrieverSession $session) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("event.{$this->session->event_id}")];
    }

    public function broadcastAs(): string
    {
        return 'retriever.location';
    }

    public function broadcastWith(): array
    {
        return [
            'user_id' => $this->session->user_id,
            'event_id' => $this->session->event_id,
            'lat' => $this->session->lat,
            'lng' => $this->session->lng,
            'is_available' => $this->session->is_available,
            'location_updated_at' => $this->session->location_updated_at,
        ];
    }
}
