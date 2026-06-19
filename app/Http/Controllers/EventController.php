<?php

namespace App\Http\Controllers;

use App\Models\Event;
use App\Models\EventApplication;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class EventController extends Controller
{
    public function index(Request $request): Response
    {
        $events = Event::query()
            ->forUser($request->user())
            ->with(['dropOffPoints', 'managers:id,name,email'])
            ->withCount(['applications', 'applications as pending_count' => fn ($q) => $q->where('status', 'pending')])
            ->orderByDesc('start_date')
            ->get();

        return Inertia::render('Events/Index', ['events' => $events]);
    }

    public function create(Request $request): Response
    {
        if (! in_array($request->user()->role, ['admin', 'event_manager'])) abort(403);
        return Inertia::render('Events/Create');
    }

    public function store(Request $request): RedirectResponse
    {
        if (! in_array($request->user()->role, ['admin', 'event_manager'])) abort(403);
        $data = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'location' => 'required|string|max:255',
            'start_date' => 'required|date',
            'end_date' => 'required|date|after:start_date',
            'map_center_lat' => 'nullable|numeric',
            'map_center_lng' => 'nullable|numeric',
            'map_zoom' => 'nullable|integer|min:1|max:20',
            'max_pilots' => 'nullable|integer|min:1',
            'drop_off_points' => 'nullable|array',
            'drop_off_points.*.name' => 'required|string',
            'drop_off_points.*.lat' => 'required|numeric',
            'drop_off_points.*.lng' => 'required|numeric',
        ]);

        $event = Event::create([...$data, 'created_by' => $request->user()->id]);

        foreach ($data['drop_off_points'] ?? [] as $i => $point) {
            $event->dropOffPoints()->create([...$point, 'is_default' => $i === 0]);
        }

        return redirect()->route('events.show', $event)->with('success', 'Etkinlik oluşturuldu.');
    }

    public function show(Event $event): Response
    {
        $this->authorizeEventAccess($event);
        $event->load(['dropOffPoints', 'managers:id,name,email,role', 'creator:id,name']);
        $applications = $event->applications()->with('user:id,name,email,phone,role')->get();
        $pendingManagers = User::where('role', 'event_manager')->get(['id', 'name', 'email']);

        return Inertia::render('Events/Show', [
            'event' => $event,
            'applications' => $applications,
            'available_managers' => $pendingManagers,
        ]);
    }

    public function edit(Request $request, Event $event): Response
    {
        if (! $request->user()->canManageEvent($event)) abort(403);
        $event->load('dropOffPoints');
        return Inertia::render('Events/Edit', ['event' => $event]);
    }

    public function update(Request $request, Event $event): RedirectResponse
    {
        if (! $request->user()->canManageEvent($event)) abort(403);
        $data = $request->validate([
            'name' => 'sometimes|string|max:255',
            'description' => 'nullable|string',
            'location' => 'sometimes|string|max:255',
            'status' => 'sometimes|in:draft,active,completed,cancelled',
            'start_date' => 'sometimes|date',
            'end_date' => 'sometimes|date',
            'map_center_lat' => 'nullable|numeric',
            'map_center_lng' => 'nullable|numeric',
            'map_zoom' => 'nullable|integer',
            'max_pilots' => 'nullable|integer',
        ]);
        $event->update($data);
        return back()->with('success', 'Etkinlik güncellendi.');
    }

    public function destroy(Request $request, Event $event): RedirectResponse
    {
        if (! $request->user()->isAdmin()) abort(403);
        $event->delete();
        return redirect()->route('events.index')->with('success', 'Etkinlik silindi.');
    }

    public function addManager(Request $request, Event $event): RedirectResponse
    {
        if (! $request->user()->isAdmin()) abort(403);
        $request->validate(['user_id' => 'required|exists:users,id']);
        $event->managers()->syncWithoutDetaching([$request->user_id]);
        return back()->with('success', 'Yönetici eklendi.');
    }

    public function removeManager(Request $request, Event $event, User $user): RedirectResponse
    {
        if (! $request->user()->isAdmin()) abort(403);
        $event->managers()->detach($user->id);
        return back()->with('success', 'Yönetici kaldırıldı.');
    }

    public function reviewApplication(Request $request, Event $event, EventApplication $application): RedirectResponse
    {
        $this->authorizeEventAccess($event);
        $request->validate(['status' => 'required|in:approved,rejected']);
        $application->update([
            'status' => $request->status,
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);
        return back()->with('success', 'Başvuru güncellendi.');
    }

    public function live(Event $event): Response
    {
        $this->authorizeEventAccess($event);
        $event->load('dropOffPoints');
        return Inertia::render('Events/Live', ['event' => $event]);
    }

    private function authorizeEventAccess(Event $event): void
    {
        if (! request()->user()?->canManageEvent($event)) {
            abort(403);
        }
    }
}
