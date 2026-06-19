<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Event;
use App\Models\Flight;
use App\Models\RetrieverSession;
use Illuminate\Http\JsonResponse;

class LiveController extends Controller
{
    public function snapshot(Event $event): JsonResponse
    {
        $pilots = Flight::where('event_id', $event->id)
            ->whereIn('status', ['flying', 'landed', 'sos'])
            ->with('pilot:id,name,avatar_url')
            ->get()
            ->map(function ($flight) {
                $lastPoint = $flight->locationPoints()->latest('recorded_at')->first();
                return array_merge($flight->toArray(), [
                    'current_location' => $lastPoint ? [
                        'lat' => $lastPoint->lat,
                        'lng' => $lastPoint->lng,
                        'altitude' => $lastPoint->altitude,
                        'speed' => $lastPoint->speed,
                        'heading' => $lastPoint->heading,
                        'recorded_at' => $lastPoint->recorded_at,
                    ] : null,
                ]);
            });

        $retrievers = RetrieverSession::active()
            ->where('event_id', $event->id)
            ->with('user:id,name,avatar_url')
            ->get()
            ->map(fn ($s) => [
                'retriever_id' => $s->user_id,
                'retriever' => $s->user,
                'is_available' => $s->is_available,
                'lat' => $s->lat,
                'lng' => $s->lng,
                'location_updated_at' => $s->location_updated_at,
                'current_location' => $s->lat ? ['lat' => $s->lat, 'lng' => $s->lng, 'recorded_at' => $s->location_updated_at] : null,
            ]);

        return response()->json(['pilots' => $pilots, 'retrievers' => $retrievers]);
    }
}
