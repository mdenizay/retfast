<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class RetrievalStatusUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public \App\Models\RetrievalRequest $retrievalRequest) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("event.{$this->retrievalRequest->event_id}")];
    }

    public function broadcastAs(): string
    {
        return 'retrieval.status';
    }

    public function broadcastWith(): array
    {
        return $this->retrievalRequest->toArray();
    }
}
