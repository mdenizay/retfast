<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\EventController;
use App\Http\Controllers\Api\FlightController;
use App\Http\Controllers\Api\LiveController;
use App\Http\Controllers\Api\RetrievalController;
use App\Http\Controllers\Api\RetrieverSessionController;
use Illuminate\Support\Facades\Route;

// Public auth routes
Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/login', [AuthController::class, 'login']);

// Authenticated API routes
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/refresh', [AuthController::class, 'refresh']); // re-issue token with current role

    // Events
    Route::get('/events', [EventController::class, 'index']);
    Route::get('/events/{event}', [EventController::class, 'show']);
    Route::get('/events/{event}/applications', [EventController::class, 'applications']);
    Route::post('/events/{event}/apply', [EventController::class, 'apply']);
    Route::get('/events/my-applications', [EventController::class, 'myApplications']);

    // Flights
    Route::post('/flights/start', [FlightController::class, 'start']);
    Route::get('/flights/active', [FlightController::class, 'active']);
    Route::get('/flights/{flight}', [FlightController::class, 'show']);
    Route::get('/flights/{flight}/route', [FlightController::class, 'route']);
    Route::post('/flights/{flight}/locations', [FlightController::class, 'addLocations']);
    Route::post('/flights/{flight}/land', [FlightController::class, 'land']);
    Route::post('/flights/{flight}/sos', [FlightController::class, 'sos']);
    Route::post('/flights/{flight}/sos-resolve', [FlightController::class, 'sosResolve']);
    Route::post('/flights/{flight}/heartbeat', [FlightController::class, 'heartbeat']);
    Route::patch('/flights/{flight}/admin-complete', [FlightController::class, 'adminComplete']);

    // Retrieval
    Route::get('/retrieval/nearby', [RetrievalController::class, 'nearby']);
    Route::post('/retrieval/request', [RetrievalController::class, 'request']);
    Route::delete('/retrieval/request/{retrievalRequest}', [RetrievalController::class, 'cancel']);
    Route::patch('/retrieval/{retrievalRequest}/status', [RetrievalController::class, 'updateStatus']);
    Route::get('/retrieval/my-active', [RetrievalController::class, 'myActive']);

    // Retriever session
    Route::get('/retriever/session', [RetrieverSessionController::class, 'current']);
    Route::post('/retriever/session/start', [RetrieverSessionController::class, 'start']);
    Route::post('/retriever/session/end', [RetrieverSessionController::class, 'end']);
    Route::post('/retriever/session/location', [RetrieverSessionController::class, 'updateLocation']);

    // Live snapshot (for web map without WS)
    Route::get('/live/{event}/snapshot', [LiveController::class, 'snapshot']);
});
