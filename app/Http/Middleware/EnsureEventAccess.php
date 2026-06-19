<?php

namespace App\Http\Middleware;

use App\Models\Event;
use Closure;
use Illuminate\Http\Request;

class EnsureEventAccess
{
    public function handle(Request $request, Closure $next): mixed
    {
        $event = $request->route('event');
        if (! $event instanceof Event) {
            $event = Event::findOrFail($event);
        }

        if (! $request->user()?->canManageEvent($event)) {
            if ($request->expectsJson()) {
                return response()->json(['error' => 'Forbidden'], 403);
            }
            abort(403);
        }

        return $next($request);
    }
}
