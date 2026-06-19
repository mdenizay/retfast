<?php

namespace App\Http\Controllers\Api;

use App\Events\RetrievalStatusUpdated;
use App\Http\Controllers\Controller;
use App\Models\FlightEvent;
use App\Models\RetrievalRequest;
use App\Models\RetrieverSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RetrievalController extends Controller
{
    public function nearby(Request $request): JsonResponse
    {
        $data = $request->validate([
            'lat' => 'required|numeric',
            'lng' => 'required|numeric',
            'event_id' => 'required|exists:events,id',
        ]);

        $sessions = RetrieverSession::active()
            ->where('event_id', $data['event_id'])
            ->whereNotNull('lat')
            ->with('user:id,name,phone,avatar_url')
            ->get();

        $result = $sessions->map(function ($session) use ($data) {
            $dist = $this->haversine($data['lat'], $data['lng'], $session->lat, $session->lng);
            return [
                'retriever_id' => $session->user_id,
                'name' => $session->user->name,
                'phone' => $session->user->phone,
                'distance_km' => round($dist, 2),
                'lat' => $session->lat,
                'lng' => $session->lng,
                'is_available' => $session->is_available,
            ];
        })->sortBy('distance_km')->values();

        return response()->json($result);
    }

    public function request(Request $request): JsonResponse
    {
        $data = $request->validate([
            'flight_id' => 'required|exists:flights,id',
            'lat' => 'required|numeric',
            'lng' => 'required|numeric',
            'retriever_id' => 'nullable|exists:users,id',
            'drop_off_point_id' => 'nullable|exists:drop_off_points,id',
        ]);

        $existing = RetrievalRequest::where('flight_id', $data['flight_id'])
            ->whereIn('status', ['pending', 'assigned', 'en_route'])
            ->first();

        if ($existing) {
            return response()->json(['error' => 'Aktif bir retrieval talebi zaten var.'], 409);
        }

        $flight = \App\Models\Flight::findOrFail($data['flight_id']);

        $retrieval = RetrievalRequest::create([
            'flight_id' => $data['flight_id'],
            'pilot_id' => $request->user()->id,
            'event_id' => $flight->event_id,
            'status' => $data['retriever_id'] ? 'assigned' : 'pending',
            'retriever_id' => $data['retriever_id'],
            'landing_lat' => $data['lat'],
            'landing_lng' => $data['lng'],
            'drop_off_point_id' => $data['drop_off_point_id'] ?? null,
            'assigned_at' => $data['retriever_id'] ? now() : null,
        ]);

        FlightEvent::create([
            'flight_id' => $data['flight_id'],
            'event_id' => $flight->event_id,
            'actor_id' => $request->user()->id,
            'type' => 'retrieval_requested',
            'message' => "{$request->user()->name} retrieval talep etti",
            'lat' => $data['lat'],
            'lng' => $data['lng'],
        ]);

        broadcast(new RetrievalStatusUpdated($retrieval->load(['pilot:id,name', 'retriever:id,name'])));

        return response()->json($retrieval, 201);
    }

    public function cancel(Request $request, RetrievalRequest $retrievalRequest): JsonResponse
    {
        $user = $request->user();
        if ($retrievalRequest->pilot_id !== $user->id && ! $user->canManageEvent($retrievalRequest->event)) {
            abort(403);
        }

        $retrievalRequest->update(['status' => 'cancelled']);

        FlightEvent::create([
            'flight_id' => $retrievalRequest->flight_id,
            'event_id' => $retrievalRequest->event_id,
            'actor_id' => $user->id,
            'type' => 'retrieval_cancelled',
            'message' => "{$user->name} retrieval talebini iptal etti",
        ]);

        broadcast(new RetrievalStatusUpdated($retrievalRequest));

        return response()->json(['ok' => true]);
    }

    public function updateStatus(Request $request, RetrievalRequest $retrievalRequest): JsonResponse
    {
        $data = $request->validate(['status' => 'required|in:en_route,picked_up,delivered']);

        $timestamps = [
            'en_route' => [],
            'picked_up' => ['picked_up_at' => now()],
            'delivered' => ['delivered_at' => now()],
        ];

        $retrievalRequest->update(['status' => $data['status'], ...$timestamps[$data['status']]]);

        $eventTypeMap = [
            'en_route' => 'en_route',
            'picked_up' => 'picked_up',
            'delivered' => 'delivered',
        ];

        FlightEvent::create([
            'flight_id' => $retrievalRequest->flight_id,
            'event_id' => $retrievalRequest->event_id,
            'actor_id' => $request->user()->id,
            'type' => $eventTypeMap[$data['status']],
            'message' => $request->user()->name . ' ' . match($data['status']) {
                'en_route' => 'yola çıktı',
                'picked_up' => 'pilotu aldı',
                'delivered' => 'teslim etti',
            },
        ]);

        if ($data['status'] === 'delivered') {
            $retrievalRequest->flight->update(['status' => 'completed', 'completed_at' => now()]);
            FlightEvent::create([
                'flight_id' => $retrievalRequest->flight_id,
                'event_id' => $retrievalRequest->event_id,
                'actor_id' => $request->user()->id,
                'type' => 'completed',
                'message' => 'Uçuş tamamlandı',
            ]);
            broadcast(new \App\Events\FlightStatusUpdated($retrievalRequest->flight->fresh()->load('pilot:id,name,avatar_url')));
        }

        broadcast(new RetrievalStatusUpdated($retrievalRequest->fresh()->load(['pilot:id,name', 'retriever:id,name'])));

        return response()->json($retrievalRequest);
    }

    public function myActive(Request $request): JsonResponse
    {
        $session = RetrieverSession::active()
            ->where('user_id', $request->user()->id)
            ->with('event:id,name,location')
            ->first();

        if (! $session) {
            return response()->json(['session_active' => false, 'event_id' => null, 'active_request' => null]);
        }

        $activeRequest = RetrievalRequest::where('retriever_id', $request->user()->id)
            ->whereIn('status', ['assigned', 'en_route'])
            ->with(['flight.pilot:id,name,phone', 'dropOffPoint'])
            ->first();

        return response()->json([
            'session_active' => true,
            'event_id' => $session->event_id,
            'active_request' => $activeRequest,
        ]);
    }

    private function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $R = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return $R * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
