<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use App\Http\Controllers\Api\AdminMarketplaceCategoryController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Marketplace & Freecycle — admin category management
|--------------------------------------------------------------------------
|
| Loaded by RouteServiceProvider right after routes/api.php, under the same
| `api` middleware group and `/api` prefix. Kept in its own file because
| routes/api.php was mid-edit in another session when this feature landed
| (17 Oct 2026), exactly as routes/api-volunteering-qualifications.php was.
|
| Mirrors the `/v2/admin/marketplace/*` routes in routes/api.php: Sanctum
| auth plus the `admin` middleware (EnsureIsAdmin), and the controller
| re-checks requireAdmin() and the `marketplace` feature gate itself.
|
| `reorder` is declared before `{id}` so the literal segment wins.
*/

Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::get('/v2/admin/marketplace/categories', [AdminMarketplaceCategoryController::class, 'index']);
    Route::post('/v2/admin/marketplace/categories', [AdminMarketplaceCategoryController::class, 'store']);
    Route::put('/v2/admin/marketplace/categories/reorder', [AdminMarketplaceCategoryController::class, 'reorder']);
    Route::put('/v2/admin/marketplace/categories/{id}', [AdminMarketplaceCategoryController::class, 'update'])
        ->whereNumber('id');
    Route::delete('/v2/admin/marketplace/categories/{id}', [AdminMarketplaceCategoryController::class, 'destroy'])
        ->whereNumber('id');
});
