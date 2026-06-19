<?php

namespace App\Http\Controllers;

use App\Models\Event;
use App\Models\Flight;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function index(Request $request): Response
    {
        $user = $request->user();

        $events = Event::query()
            ->forUser($user)
            ->with(['dropOffPoints'])
            ->orderByDesc('start_date')
            ->limit(10)
            ->get();

        $stats = [];
        if ($user->isAdmin() || $user->isEventManager()) {
            $eventIds = Event::query()->forUser($user)->pluck('id');
            $stats = [
                'total_events' => $eventIds->count(),
                'active_events' => Event::query()->forUser($user)->where('status', 'active')->count(),
                'total_flights' => Flight::whereIn('event_id', $eventIds)->count(),
                'active_flights' => Flight::whereIn('event_id', $eventIds)->whereIn('status', ['flying', 'sos'])->count(),
            ];
        }

        return Inertia::render('Dashboard', [
            'events' => $events,
            'stats' => $stats,
        ]);
    }
}
