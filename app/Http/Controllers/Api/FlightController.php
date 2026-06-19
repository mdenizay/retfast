<?php

namespace App\Http\Controllers\Api;

use App\Events\FlightStatusUpdated;
use App\Events\PilotLocationUpdated;
use App\Http\Controllers\Controller;
use App\Models\EventApplication;
use App\Models\Flight;
use App\Models\FlightEvent;
use App\Models\LocationPoint;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FlightController extends Controller
{
    public function start(Request $request): JsonResponse
    {
        $data = $request->validate(['event_id' => 'required|exists:events,id']);
        $user = $request->user();

        $approved = EventApplication::where('event_id', $data['event_id'])
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->exists();

        if (! $approved) {
            return response()->json(['error' => 'Bu etkinlik için onayınız yok.'], 403);
        }

        // Return existing active flight
        $existing = Flight::where('pilot_id', $user->id)
            ->where('event_id', $data['event_id'])
            ->whereIn('status', ['flying', 'sos'])
            ->with('pilot:id,name,avatar_url')
            ->first();

        if ($existing) {
            return response()->json($existing);
        }

        $flightNumber = Flight::where('pilot_id', $user->id)
            ->where('event_id', $data['event_id'])
            ->count() + 1;

        $flight = Flight::create([
            'event_id' => $data['event_id'],
            'pilot_id' => $user->id,
            'flight_number' => $flightNumber,
            'status' => 'flying',
        ]);

        FlightEvent::create([
            'flight_id' => $flight->id,
            'event_id' => $flight->event_id,
            'actor_id' => $user->id,
            'type' => 'started',
            'message' => "{$user->name} uçuşa başladı (Uçuş #{$flightNumber})",
        ]);

        broadcast(new FlightStatusUpdated($flight->load('pilot:id,name,avatar_url')));

        return response()->json($flight->load('pilot:id,name,avatar_url'), 201);
    }

    public function active(Request $request): JsonResponse
    {
        $flight = Flight::where('pilot_id', $request->user()->id)
            ->whereIn('status', ['flying', 'sos', 'landed'])
            ->with('pilot:id,name,avatar_url')
            ->latest('started_at')
            ->first();

        return response()->json($flight);
    }

    public function show(Flight $flight): JsonResponse
    {
        $flight->load([
            'pilot:id,name,avatar_url,phone',
            'event:id,name',
            'retrievalRequest.dropOffPoint',
        ]);
        return response()->json($flight);
    }

    public function route(Flight $flight): JsonResponse
    {
        $points = $flight->locationPoints()
            ->orderBy('recorded_at')
            ->get(['lat', 'lng', 'altitude', 'speed', 'heading', 'recorded_at']);
        return response()->json($points);
    }

    public function addLocations(Request $request, Flight $flight): JsonResponse
    {
        if ($flight->pilot_id !== $request->user()->id) abort(403);
        if (! in_array($flight->status, ['flying', 'sos'])) {
            return response()->json(['error' => 'Uçuş aktif değil.'], 400);
        }

        $data = $request->validate([
            'points' => 'required|array|min:1',
            'points.*.lat' => 'required|numeric',
            'points.*.lng' => 'required|numeric',
            'points.*.altitude' => 'nullable|numeric',
            'points.*.speed' => 'nullable|numeric',
            'points.*.heading' => 'nullable|numeric',
            'points.*.accuracy' => 'nullable|numeric',
            'points.*.recorded_at' => 'required|date',
        ]);

        $points = collect($data['points'])->map(fn ($p) => [
            ...$p,
            'flight_id' => $flight->id,
            'created_at' => now(),
            'updated_at' => now(),
        ])->all();

        LocationPoint::insert($points);

        // Broadcast last location
        $last = end($data['points']);
        broadcast(new PilotLocationUpdated($flight, $last));

        return response()->json(['inserted' => count($points)]);
    }

    public function land(Request $request, Flight $flight): JsonResponse
    {
        if ($flight->pilot_id !== $request->user()->id) abort(403);
        $data = $request->validate(['lat' => 'required|numeric', 'lng' => 'required|numeric']);

        $flight->update([
            'status' => 'landed',
            'landed_at' => now(),
            'landing_lat' => $data['lat'],
            'landing_lng' => $data['lng'],
        ]);

        FlightEvent::create([
            'flight_id' => $flight->id,
            'event_id' => $flight->event_id,
            'actor_id' => $request->user()->id,
            'type' => 'landed',
            'message' => "{$request->user()->name} iniş yaptı",
            'lat' => $data['lat'],
            'lng' => $data['lng'],
        ]);

        broadcast(new FlightStatusUpdated($flight->fresh()->load('pilot:id,name,avatar_url')));

        return response()->json($flight);
    }

    public function sos(Request $request, Flight $flight): JsonResponse
    {
        if ($flight->pilot_id !== $request->user()->id) abort(403);
        $data = $request->validate(['lat' => 'required|numeric', 'lng' => 'required|numeric']);

        $flight->update(['status' => 'sos', 'sos_triggered_at' => now()]);

        FlightEvent::create([
            'flight_id' => $flight->id,
            'event_id' => $flight->event_id,
            'actor_id' => $request->user()->id,
            'type' => 'sos',
            'message' => "🆘 {$request->user()->name} acil yardım istedi",
            'lat' => $data['lat'],
            'lng' => $data['lng'],
        ]);

        broadcast(new FlightStatusUpdated($flight->fresh()->load('pilot:id,name,avatar_url')));

        return response()->json(['ok' => true]);
    }

    public function sosResolve(Request $request, Flight $flight): JsonResponse
    {
        if ($flight->pilot_id !== $request->user()->id) abort(403);
        if ($flight->status !== 'sos') {
            return response()->json(['error' => 'Uçuş SOS modunda değil.'], 400);
        }

        $flight->update(['status' => 'flying']);

        FlightEvent::create([
            'flight_id' => $flight->id,
            'event_id' => $flight->event_id,
            'actor_id' => $request->user()->id,
            'type' => 'sos_resolved',
            'message' => "{$request->user()->name} SOS iptal etti, uçuş devam ediyor",
        ]);

        broadcast(new FlightStatusUpdated($flight->fresh()->load('pilot:id,name,avatar_url')));

        return response()->json(['ok' => true]);
    }

    public function heartbeat(Request $request, Flight $flight): JsonResponse
    {
        if ($flight->pilot_id !== $request->user()->id) abort(403);
        return response()->json(['ok' => true]);
    }

    public function adminComplete(Request $request, Flight $flight): JsonResponse
    {
        if (! $request->user()->canManageEvent($flight->event)) abort(403);

        $flight->update(['status' => 'completed', 'completed_at' => now()]);

        FlightEvent::create([
            'flight_id' => $flight->id,
            'event_id' => $flight->event_id,
            'actor_id' => $request->user()->id,
            'type' => 'admin_completed',
            'message' => "{$request->user()->name} uçuşu yönetici olarak tamamladı",
        ]);

        broadcast(new FlightStatusUpdated($flight->fresh()->load('pilot:id,name,avatar_url')));

        return response()->json($flight);
    }
}
