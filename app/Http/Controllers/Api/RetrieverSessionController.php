<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RetrieverSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RetrieverSessionController extends Controller
{
    public function current(Request $request): JsonResponse
    {
        $session = RetrieverSession::active()
            ->where('user_id', $request->user()->id)
            ->with('event:id,name,location,map_center_lat,map_center_lng,drop_off_points')
            ->first();

        return response()->json($session);
    }

    public function start(Request $request): JsonResponse
    {
        $data = $request->validate(['event_id' => 'required|exists:events,id']);

        $existing = RetrieverSession::active()
            ->where('user_id', $request->user()->id)
            ->first();

        if ($existing) {
            return response()->json($existing);
        }

        $session = RetrieverSession::create([
            'user_id' => $request->user()->id,
            'event_id' => $data['event_id'],
            'is_available' => true,
        ]);

        return response()->json($session, 201);
    }

    public function end(Request $request): JsonResponse
    {
        RetrieverSession::active()
            ->where('user_id', $request->user()->id)
            ->update(['ended_at' => now(), 'is_available' => false]);

        return response()->json(['ok' => true]);
    }

    public function updateLocation(Request $request): JsonResponse
    {
        $data = $request->validate([
            'lat' => 'required|numeric',
            'lng' => 'required|numeric',
        ]);

        $session = RetrieverSession::active()
            ->where('user_id', $request->user()->id)
            ->first();

        if (! $session) {
            return response()->json(['error' => 'Aktif oturum yok.'], 400);
        }

        $session->update([
            'lat' => $data['lat'],
            'lng' => $data['lng'],
            'location_updated_at' => now(),
        ]);

        broadcast(new \App\Events\RetrieverLocationUpdated($session->fresh()));

        return response()->json(['ok' => true]);
    }
}
