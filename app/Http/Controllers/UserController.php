<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class UserController extends Controller
{
    public function index(): Response
    {
        $users = User::orderBy('name')->get(['id', 'name', 'email', 'role', 'phone', 'is_active', 'created_at']);
        return Inertia::render('Users/Index', ['users' => $users]);
    }

    public function update(Request $request, User $user): RedirectResponse
    {
        $data = $request->validate([
            'role' => 'sometimes|in:admin,event_manager,pilot,retriever',
            'is_active' => 'sometimes|boolean',
            'phone' => 'sometimes|nullable|string|max:20',
        ]);
        $user->update($data);
        return back()->with('success', 'Kullanıcı güncellendi.');
    }
}
