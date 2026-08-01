<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use App\Http\Controllers\GovukAlpha\AlphaController;
use Illuminate\Support\Facades\Route;

/*
 * What's On parity routes (accessible GOV.UK frontend) — PUBLIC.
 *
 * Required INSIDE the {tenantSlug}/accessible + govuk-alpha. group.
 * Deliberately NOT behind RequireAccessibleAuthentication: these are the
 * logged-out event advertising pages, gated in the controller on the
 * events + public_events tenant features (404 when off). Registration still
 * requires an account. Path matches the React public pages ('/whats-on') so
 * shared links work on either frontend.
 */
Route::get('/whats-on', [AlphaController::class, 'whatsOnIndex'])
    ->middleware('throttle:nexus-route-60-per-1m')
    ->name('whats-on.index');
Route::get('/whats-on/{id}', [AlphaController::class, 'whatsOnShow'])
    ->whereNumber('id')
    ->middleware('throttle:nexus-route-60-per-1m')
    ->name('whats-on.show');
