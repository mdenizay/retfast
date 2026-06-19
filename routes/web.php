<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\EventController;
use App\Http\Controllers\FlightController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::middleware('guest')->group(function () {
    Route::get('/login', [LoginController::class, 'create'])->name('login');
    Route::post('/login', [LoginController::class, 'store'])->name('login.store');
    Route::get('/register', [RegisterController::class, 'create'])->name('register');
    Route::post('/register', [RegisterController::class, 'store'])->name('register.store');
});

Route::middleware('auth')->group(function () {
    Route::post('/logout', [LoginController::class, 'destroy'])->name('logout');

    Route::get('/', [DashboardController::class, 'index'])->name('dashboard');

    // Events (admin + event_manager)
    Route::resource('events', EventController::class);
    Route::post('events/{event}/managers', [EventController::class, 'addManager'])->name('events.managers.add');
    Route::delete('events/{event}/managers/{user}', [EventController::class, 'removeManager'])->name('events.managers.remove');
    Route::patch('events/{event}/applications/{application}', [EventController::class, 'reviewApplication'])->name('events.applications.review');
    Route::get('events/{event}/live', [EventController::class, 'live'])->name('events.live');

    // Flights
    Route::get('events/{event}/flights', [FlightController::class, 'index'])->name('flights.index');
    Route::get('flights/{flight}', [FlightController::class, 'show'])->name('flights.show');
    Route::patch('flights/{flight}/complete', [FlightController::class, 'adminComplete'])->name('flights.complete');

    // Users (admin only)
    Route::middleware('role:admin')->group(function () {
        Route::resource('users', UserController::class)->only(['index', 'update']);
    });
});
