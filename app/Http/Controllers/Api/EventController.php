<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Event;
use App\Models\EventApplication;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EventController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $events = Event::with(['dropOffPoints'])
            ->where('status', '!=', 'cancelled')
            ->orderByDesc('start_date')
            ->get();

        return response()->json($events);
    }

    public function show(Event $event): JsonResponse
    {
        $event->load('dropOffPoints');
        return response()->json($event);
    }

    public function applications(Request $request, Event $event): JsonResponse
    {
        if (! $request->user()->canManageEvent($event)) abort(403);

        return response()->json(
            $event->applications()->with('user:id,name,email,phone')->get()
        );
    }

    public function apply(Request $request, Event $event): JsonResponse
    {
        $data = $request->validate([
            'type' => 'required|in:pilot,retriever',
            'vehicle_capacity' => 'nullable|integer',
            'vehicle_description' => 'nullable|string|max:255',
            'notes' => 'nullable|string|max:500',
        ]);

        $existing = $event->applications()
            ->where('user_id', $request->user()->id)
            ->where('type', $data['type'])
            ->first();

        if ($existing) {
            return response()->json(['error' => 'Zaten başvurdunuz.'], 409);
        }

        $application = $event->applications()->create([
            ...$data,
            'user_id' => $request->user()->id,
            'status' => 'pending',
        ]);

        return response()->json($application, 201);
    }

    public function myApplications(Request $request): JsonResponse
    {
        $apps = EventApplication::with(['event.dropOffPoints'])
            ->where('user_id', $request->user()->id)
            ->get();

        return response()->json($apps);
    }
}
