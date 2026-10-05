<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use App\Http\Controllers\Api\VolunteerQualificationController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Volunteer qualifications register
|--------------------------------------------------------------------------
|
| Loaded by RouteServiceProvider right after routes/api.php, under the same
| `api` middleware group and `/api` prefix. Kept in its own file because
| routes/api.php was mid-edit in another session when this feature landed.
|
| Member + organisation routes mirror the volunteering member routes in
| routes/api.php (Sanctum auth; the controller enforces the `volunteering`
| feature gate and tenant scoping). The staff list mirrors the
| `broker-or-admin` group used by the broker panel: admins, tenant admins,
| brokers and coordinators may read every record in the community.
|
| Spec: .local-docs-archive/volunteering-credentials/QUALIFICATIONS-BUILD-SPEC-2026-10-05.md §4
*/

Route::middleware('auth:sanctum')->group(function () {
    // Member — own records only
    Route::get('/v2/volunteering/qualifications', [VolunteerQualificationController::class, 'index']);
    Route::post('/v2/volunteering/qualifications', [VolunteerQualificationController::class, 'store'])
        ->middleware('throttle:nexus-route-20-per-1m');
    Route::put('/v2/volunteering/qualifications/{id}', [VolunteerQualificationController::class, 'update'])
        ->whereNumber('id');

    // Owner, or an organisation confirmer / community staff member for that volunteer
    Route::post('/v2/volunteering/qualifications/{id}/withdraw', [VolunteerQualificationController::class, 'withdraw'])
        ->whereNumber('id');

    // Organisation confirmer (organization_id required) or community staff
    Route::post('/v2/volunteering/qualifications/{id}/confirm', [VolunteerQualificationController::class, 'confirm'])
        ->whereNumber('id');

    // Organisation dashboard — volunteers linked to the org through an approved application
    Route::get('/v2/volunteering/organizations/{orgId}/qualifications', [VolunteerQualificationController::class, 'organizationIndex'])
        ->whereNumber('orgId');
});

// Community staff — admin, tenant admin, broker, coordinator
Route::middleware(['auth:sanctum', 'broker-or-admin'])->group(function () {
    Route::get('/v2/admin/volunteering/qualifications', [VolunteerQualificationController::class, 'staffIndex']);
});
