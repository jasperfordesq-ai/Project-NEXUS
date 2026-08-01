<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use App\Http\Controllers\GovukAlpha\AlphaController;
use App\Http\Controllers\GovukAlpha\Middleware\RequireAccessibleAuthentication;
use Illuminate\Support\Facades\Route;

/*
 * Partner venues parity routes (accessible GOV.UK frontend).
 *
 * Required INSIDE the {tenantSlug}/accessible + govuk-alpha. group. All four
 * pages are member/staff surfaces, so the whole file sits behind
 * RequireAccessibleAuthentication; the partner_venues feature gate lives in
 * the controller methods (abort_unless), matching the React FeatureGate.
 *
 * The check-in URL segment ('/venues/checkin/{token}') matches the React
 * route exactly: both frontends' member passes encode the SAME URL, so a
 * staff phone lands on whichever frontend the tenant links passes to.
 * Static '/venues/pass' registered before the token wildcard.
 */
Route::middleware(RequireAccessibleAuthentication::class)->group(function (): void {
    Route::get('/venues', [AlphaController::class, 'venuesIndex'])->name('venues.index');
    Route::get('/venues/pass', [AlphaController::class, 'venuesPass'])->name('venues.pass');
    Route::post('/venues/pass/rotate', [AlphaController::class, 'venuesPassRotate'])
        ->middleware('throttle:nexus-route-10-per-1m')
        ->name('venues.pass.rotate');
    Route::get('/venues/checkin/{token}', [AlphaController::class, 'venuesCheckin'])
        ->where('token', '[A-Za-z0-9]+')
        ->name('venues.checkin');
    Route::post('/venues/checkin/{token}', [AlphaController::class, 'venuesCheckinStore'])
        ->where('token', '[A-Za-z0-9]+')
        ->middleware('throttle:nexus-route-30-per-1m')
        ->name('venues.checkin.store');
});
