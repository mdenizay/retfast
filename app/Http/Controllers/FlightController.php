<?php

namespace App\Http\Controllers;

use App\Models\Event;
use App\Models\Flight;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class FlightController extends Controller
{
    public function index(Request $request, Event $event): Response
    {
        if (! $request->user()->canManageEvent($event)) abort(403);

        $flights = $event->flights()
            ->with(['pilot:id,name,avatar_url,phone', 'retrievalRequest'])
            ->withCount('locationPoints')
            ->orderByDesc('started_at')
            ->get();

        return Inertia::render('Flights/Index', [
            'event' => $event,
            'flights' => $flights,
        ]);
    }

    public function show(Flight $flight): Response
    {
        if (! request()->user()->canManageEvent($flight->event)) abort(403);

        $flight->load([
            'pilot:id,name,avatar_url,phone',
            'event:id,name',
            'flightEvents.actor:id,name',
            'retrievalRequest.retriever:id,name,phone',
            'retrievalRequest.dropOffPoint',
        ]);

        $route = $flight->locationPoints()
            ->orderBy('recorded_at')
            ->get(['lat', 'lng', 'altitude', 'speed', 'recorded_at']);

        return Inertia::render('Flights/Show', [
            'flight' => $flight,
            'route' => $route,
        ]);
    }

    public function adminComplete(Request $request, Flight $flight): RedirectResponse
    {
        if (! $request->user()->canManageEvent($flight->event)) abort(403);

        $flight->update(['status' => 'completed', 'completed_at' => now()]);
        $flight->flightEvents()->create([
            'event_id' => $flight->event_id,
            'actor_id' => $request->user()->id,
            'type' => 'admin_completed',
            'message' => $request->user()->name . ' uçuşu yönetici olarak tamamladı.',
        ]);

        broadcast(new \App\Events\FlightStatusUpdated($flight))->toOthers();

        return back()->with('success', 'Uçuş tamamlandı.');
    }
}
