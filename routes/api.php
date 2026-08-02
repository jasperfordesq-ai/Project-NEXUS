<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Support\Facades\Route;

// Global route pattern: {id} parameters must be numeric
Route::pattern('id', '[0-9]+');

/*
|--------------------------------------------------------------------------
| Laravel API Routes
|--------------------------------------------------------------------------
|
| Routes registered here are served by Laravel's router. Laravel 12 is the sole
| HTTP handler for the API; keep new routes here or in explicit route partials.
|
*/

// ==========================================================================
// Laravel API controllers live under App\Http\Controllers\Api.
// Keep controllers thin and move business rules into app/Services.
// ==========================================================================

// Health check -- confirms Laravel routing is operational
// NOTE: Do NOT expose framework version or tenant_id — this endpoint is public.
Route::get('/laravel/health', function () {
    return response()->json([
        'status' => 'ok',
    ]);
});
Route::get('/v2/health', fn () => response()->json(['status' => 'ok']));
// External prerender invalidation webhook. Authentication is performed by the
// controller using the configured bearer/HMAC secret, so this route must stay
// outside the Sanctum admin group.
Route::post('/v2/prerender/invalidate', [\App\Http\Controllers\Api\AdminPrerenderController::class, 'invalidate'])
    ->middleware('throttle:nexus-route-60-per-1m');
Route::post('/v2/sales/orders', [\App\Http\Controllers\Api\SalesOrderController::class, 'submit'])
    ->middleware('throttle:nexus-route-5-per-1m');

// ============================================
// MIGRATED ROUTES — Tenant Bootstrap
// Source: httpdocs/routes/tenant-bootstrap.php
// ============================================
Route::get('/v2/tenant/bootstrap', [\App\Http\Controllers\Api\TenantBootstrapController::class, 'bootstrap']);
Route::get('/v2/pwa/manifest', [\App\Http\Controllers\Api\PwaManifestController::class, 'show'])
    ->middleware('throttle:nexus-route-60-per-1m');
Route::get('/v2/tenants', [\App\Http\Controllers\Api\TenantBootstrapController::class, 'list']);
Route::get('/v2/platform/stats', [\App\Http\Controllers\Api\TenantBootstrapController::class, 'platformStats']);
Route::get('/v2/config/algorithms', [\App\Http\Controllers\Api\AdminConfigController::class, 'getAlgorithmInfo']);
Route::get('/v2/config/google-maps', [\App\Http\Controllers\Api\MapsConfigController::class, 'show'])
    ->middleware('throttle:nexus-route-60-per-1m');
Route::get('/v2/media/thumbnail', [\App\Http\Controllers\Api\MediaThumbnailController::class, 'show'])
    ->middleware('throttle:nexus-route-300-per-1m');
// UPRN-backed UK address lookup (OS Places API proxy; active only when
// the tenant's geocoding_provider is os_places)
Route::get('/v2/geo/os-places/search', [\App\Http\Controllers\Api\OsPlacesController::class, 'search'])
    ->middleware('throttle:nexus-route-60-per-1m');

// ============================================

// PUBLIC ROUTES — Job Feed (RSS/XML and JSON for aggregator syndication)
// No auth required, tenant-scoped via subdomain/header (Agent D)
// ============================================
Route::get('/v2/jobs/feed.xml', [\App\Http\Controllers\Api\JobFeedController::class, 'rssFeed'])->middleware('throttle:nexus-route-30-per-1m');
Route::get('/v2/jobs/feed.json', [\App\Http\Controllers\Api\JobFeedController::class, 'jsonFeed'])->middleware('throttle:nexus-route-30-per-1m');
Route::get('/v2/jobs/feed/indeed.xml', [\App\Http\Controllers\Api\JobFeedController::class, 'indeedXml'])->middleware('throttle:nexus-route-30-per-1m');

// ============================================
// PUBLIC ROUTES — Clubs / Verein directory (AG15, no auth required)
// ============================================
Route::get('/v2/clubs', [\App\Http\Controllers\Api\ClubsApiController::class, 'index']);

// ============================================
// PUBLIC ROUTES — Events advertising (no auth required)
// Read-only. Gated by BOTH `events` and `public_events`, so opting a community
// into public advertising is a deliberate, separate decision. Registration
// still requires an account — nothing here is a write path.
// ============================================
Route::middleware(['feature:events', 'feature:public_events'])->group(function (): void {
    Route::get('/v2/public/events', [\App\Http\Controllers\Api\EventPublicController::class, 'index']);
    Route::get('/v2/public/events/{id}', [\App\Http\Controllers\Api\EventPublicController::class, 'show'])
        ->whereNumber('id');
});

// ============================================
// PUBLIC ROUTES — SEO metadata (no auth required)
// React frontend fetches per-page metadata for <head> tags
// ============================================
Route::get('/v2/seo/metadata/{slug}', [\App\Http\Controllers\Api\SeoController::class, 'metadata'])
    ->where('slug', '.*');
Route::get('/v2/seo/redirects', [\App\Http\Controllers\Api\SeoController::class, 'redirects']);

// ============================================
// PUBLIC ROUTES — Explore / Discover
// Supports both authenticated (personalized) and anonymous (global) access
// ============================================
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/v2/explore', [\App\Http\Controllers\Api\ExploreController::class, 'index']);
    Route::get('/v2/explore/for-you', [\App\Http\Controllers\Api\ExploreController::class, 'forYou']);
    Route::get('/v2/explore/trending', [\App\Http\Controllers\Api\ExploreController::class, 'trending']);
    Route::get('/v2/explore/popular-listings', [\App\Http\Controllers\Api\ExploreController::class, 'popularListings']);
    Route::get('/v2/explore/category/{slug}', [\App\Http\Controllers\Api\ExploreController::class, 'category']);
});

// ============================================
// Categories — public read-only (used by listings, explore, search pages)
// ============================================
Route::get('/v2/categories', function (\Illuminate\Http\Request $request) {
    $type = $request->query('type', 'listing');
    $allowed = ['listing', 'event', 'events', 'volunteering', 'resource'];
    if (!in_array($type, $allowed, true)) {
        $type = 'listing';
    }
    $categoryTypes = in_array($type, ['event', 'events'], true)
        ? ['event', 'events']
        : [$type];
    $canonicalType = in_array($type, ['event', 'events'], true) ? 'event' : $type;
    $categories = \App\Models\Category::whereIn('type', $categoryTypes)
        ->where('tenant_id', \App\Core\TenantContext::getId())
        ->where('is_active', 1)
        ->orderBy('name')
        ->orderBy('id')
        ->get()
        ->map(function (\App\Models\Category $category) use ($canonicalType) {
            $category->setAttribute('type', $canonicalType);

            return $category;
        });
    $response = response()->json(['data' => $categories], 200, [], JSON_UNESCAPED_UNICODE);
    $etag = '"' . sha1((string) $response->getContent()) . '"';
    $response->headers->set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    $response->headers->set('ETag', $etag);

    $ifNoneMatch = $request->headers->get('If-None-Match');
    if ($ifNoneMatch !== null) {
        $candidateEtags = array_map('trim', explode(',', $ifNoneMatch));
        if (in_array($etag, $candidateEtags, true) || in_array(trim($etag, '"'), $candidateEtags, true)) {
            $response->setStatusCode(304);
            $response->setContent('');
        }
    }

    return $response;
});

// ============================================
// Authenticated Groups discovery boundary. Member identity and aggregate group
// data are never exposed anonymously; the tenant feature flag fails closed.
// ============================================
Route::middleware(['auth:sanctum', 'feature:groups'])
    ->where(['id' => '[0-9]+'])
    ->group(function () {
    Route::get('/v2/groups', [\App\Http\Controllers\Api\GroupsController::class, 'index']);
    Route::get('/v2/groups/form-capabilities', [\App\Http\Controllers\Api\GroupsController::class, 'formCapabilities']);
    Route::get('/v2/groups/{id}', [\App\Http\Controllers\Api\GroupsController::class, 'show']);
    Route::get('/v2/groups/{id}/members', [\App\Http\Controllers\Api\GroupsController::class, 'members'])->middleware('group.tab:members');
});

// ============================================
// AG44 — Public self-service tenant provisioning (NO auth — anyone may apply)
// These are outside the auth:sanctum group so Sanctum middleware doesn't interfere.
// ============================================
Route::post('/v2/provisioning-requests', [\App\Http\Controllers\Api\TenantProvisioningController::class, 'submit'])
    ->middleware('throttle:nexus-route-5-per-60m');
Route::get('/v2/provisioning-requests/check-slug/{slug}', [\App\Http\Controllers\Api\TenantProvisioningController::class, 'checkSlug']);
Route::get('/v2/provisioning-requests/status/{token}', [\App\Http\Controllers\Api\TenantProvisioningController::class, 'status']);

// Revocable, capability-URL calendar subscription. The controller resolves
// the tenant from the signed-looking opaque path and verifies only a stored
// SHA-256 token hash; no member identity or restricted access data is emitted.
Route::get('/v2/events/calendar/personal/{tenantSlug}/{secret}.ics', [
    \App\Http\Controllers\Api\EventCalendarController::class,
    'personalFeed',
])
    ->where('tenantSlug', '[a-z0-9][a-z0-9-]{0,99}')
    ->where('secret', 'nxc_[a-f0-9]{64}')
    ->middleware([
        \App\Http\Middleware\RedactEventCalendarFeedSecret::class,
        'throttle:nexus-route-60-per-1m',
    ]);

// One-use external guardian capability. Tenant scope still comes from the
// request host/header; authentication is optional and the token is never logged.
Route::post('/v2/events/safety/guardian-consents/grant', [
    \App\Http\Controllers\Api\EventSafetyController::class,
    'grantGuardianConsent',
])->middleware(['feature:events', 'throttle:nexus-route-10-per-1m']);

// ============================================
// Authenticated routes — Sanctum token authentication required
// Controllers also enforce auth via $this->requireAuth() as a fallback
// ============================================
Route::middleware('auth:sanctum')->group(function () {

// ============================================
// Support reports — in-app problem reporting
// ============================================
Route::post('/v2/support/reports', [\App\Http\Controllers\Api\SupportReportController::class, 'store'])
    ->middleware('throttle:nexus-route-10-per-1m');

// Explore — authenticated actions (tracking, dismissals, experiments)
Route::post('/v2/explore/track', [\App\Http\Controllers\Api\ExploreController::class, 'track']);
Route::post('/v2/explore/dismiss', [\App\Http\Controllers\Api\ExploreController::class, 'dismiss']);
Route::get('/v2/explore/experiments', [\App\Http\Controllers\Api\ExploreController::class, 'experiments']);
Route::get('/v2/explore/analytics', [\App\Http\Controllers\Api\ExploreController::class, 'analytics']);

// MIGRATED ROUTES — Exchanges
// Source: httpdocs/routes/exchanges.php
// ============================================
Route::get('/v2/exchanges/config', [\App\Http\Controllers\Api\ExchangesController::class, 'config']);
Route::get('/v2/exchanges/check', [\App\Http\Controllers\Api\ExchangesController::class, 'check']);
Route::get('/v2/exchanges/needs-attention-count', [\App\Http\Controllers\Api\ExchangesController::class, 'needsAttentionCount']);
Route::get('/v2/exchanges', [\App\Http\Controllers\Api\ExchangesController::class, 'index']);
Route::post('/v2/exchanges', [\App\Http\Controllers\Api\ExchangesController::class, 'store']);
Route::get('/v2/exchanges/{id}', [\App\Http\Controllers\Api\ExchangesController::class, 'show']);
Route::post('/v2/exchanges/{id}/accept', [\App\Http\Controllers\Api\ExchangesController::class, 'accept']);
Route::post('/v2/exchanges/{id}/decline', [\App\Http\Controllers\Api\ExchangesController::class, 'decline']);
Route::post('/v2/exchanges/{id}/start', [\App\Http\Controllers\Api\ExchangesController::class, 'start']);
Route::post('/v2/exchanges/{id}/complete', [\App\Http\Controllers\Api\ExchangesController::class, 'complete']);
Route::post('/v2/exchanges/{id}/confirm', [\App\Http\Controllers\Api\ExchangesController::class, 'confirm']);
Route::delete('/v2/exchanges/{id}', [\App\Http\Controllers\Api\ExchangesController::class, 'cancel']);

// ============================================
// Presence — Real-time online/offline status
// ============================================
Route::post('/v2/presence/heartbeat', [\App\Http\Controllers\Api\PresenceController::class, 'heartbeat']);
Route::get('/v2/presence/users', [\App\Http\Controllers\Api\PresenceController::class, 'users']);
Route::put('/v2/presence/status', [\App\Http\Controllers\Api\PresenceController::class, 'setStatus']);
Route::put('/v2/presence/privacy', [\App\Http\Controllers\Api\PresenceController::class, 'setPrivacy']);
Route::get('/v2/presence/online-count', [\App\Http\Controllers\Api\PresenceController::class, 'onlineCount']);

// ============================================
// MIGRATED ROUTES — Events
// Source: httpdocs/routes/events.php
// ============================================
Route::middleware('feature:events')->group(function () {
    Route::get('/v2/events', [\App\Http\Controllers\Api\EventsController::class, 'index']);
    Route::get('/v2/events/recurrence-capabilities', [
        \App\Http\Controllers\Api\EventRecurrenceCapabilityController::class,
        'show',
    ]);
    Route::get('/v2/events/nearby', [\App\Http\Controllers\Api\EventsController::class, 'nearby']);
    Route::get('/v2/events/calendar', [\App\Http\Controllers\Api\EventCalendarController::class, 'index']);
    Route::get('/v2/events/calendar/feed.ics', [\App\Http\Controllers\Api\EventCalendarController::class, 'tenantFeed']);
    Route::get('/v2/events/calendar/feed-tokens', [\App\Http\Controllers\Api\EventCalendarController::class, 'tokens']);
    Route::post('/v2/events/calendar/feed-tokens', [\App\Http\Controllers\Api\EventCalendarController::class, 'createToken'])
        ->middleware('throttle:nexus-route-10-per-1m');
    Route::delete('/v2/events/calendar/feed-tokens/{tokenId}', [\App\Http\Controllers\Api\EventCalendarController::class, 'revokeToken'])
        ->whereNumber('tokenId');
    Route::post('/v2/events/recurring', [\App\Http\Controllers\Api\EventsController::class, 'createRecurring']);
    Route::get('/v2/events/series', [\App\Http\Controllers\Api\EventsController::class, 'listSeries']);
    Route::post('/v2/events/series', [\App\Http\Controllers\Api\EventsController::class, 'createSeries']);
    Route::get('/v2/events/series/{seriesId}', [\App\Http\Controllers\Api\EventsController::class, 'showSeries'])->whereNumber('seriesId');
    Route::get('/v2/event-templates', [\App\Http\Controllers\Api\EventTemplateController::class, 'index']);
    Route::get('/v2/event-templates/{templateId}', [\App\Http\Controllers\Api\EventTemplateController::class, 'show'])
        ->whereNumber('templateId');
    Route::get('/v2/event-templates/{templateId}/history', [\App\Http\Controllers\Api\EventTemplateController::class, 'history'])
        ->whereNumber('templateId');
    Route::post('/v2/events/{sourceEventId}/template-preview', [\App\Http\Controllers\Api\EventTemplateController::class, 'previewCapture'])
        ->whereNumber('sourceEventId')->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/events/{sourceEventId}/templates', [\App\Http\Controllers\Api\EventTemplateController::class, 'capture'])
        ->whereNumber('sourceEventId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/event-templates/{templateId}/revisions', [\App\Http\Controllers\Api\EventTemplateController::class, 'revise'])
        ->whereNumber('templateId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/event-templates/{templateId}/archive', [\App\Http\Controllers\Api\EventTemplateController::class, 'archive'])
        ->whereNumber('templateId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/event-templates/{templateId}/materialization-preview', [\App\Http\Controllers\Api\EventTemplateController::class, 'previewMaterialization'])
        ->whereNumber('templateId')->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/event-templates/{templateId}/materializations', [\App\Http\Controllers\Api\EventTemplateController::class, 'materialize'])
        ->whereNumber('templateId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events', [\App\Http\Controllers\Api\EventsController::class, 'store']);
    Route::get('/v2/events/{id}/calendar.ics', [\App\Http\Controllers\Api\EventCalendarController::class, 'eventFeed'])
        ->whereNumber('id');
    Route::get('/v2/events/{id}/calendar-actions', [\App\Http\Controllers\Api\EventCalendarController::class, 'actions'])
        ->whereNumber('id');
    Route::get('/v2/events/{id}/federation-status', [\App\Http\Controllers\Api\EventFederationStatusController::class, 'show'])
        ->whereNumber('id');
    Route::get('/v2/events/{id}/analytics', [\App\Http\Controllers\Api\EventAnalyticsController::class, 'show'])
        ->whereNumber('id')->middleware('throttle:nexus-route-120-per-1m');
    Route::get('/v2/events/{id}/analytics/export.csv', [\App\Http\Controllers\Api\EventAnalyticsController::class, 'export'])
        ->whereNumber('id')->middleware('throttle:nexus-route-10-per-1m');
    Route::get('/v2/events/{id}/tickets', [\App\Http\Controllers\Api\EventTicketController::class, 'index'])
        ->whereNumber('id')->middleware('throttle:nexus-route-120-per-1m');
    Route::get('/v2/events/{id}/tickets/reconciliation', [\App\Http\Controllers\Api\EventTicketController::class, 'reconcile'])
        ->whereNumber('id')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/tickets/{ticketTypeId}/quote', [\App\Http\Controllers\Api\EventTicketController::class, 'quote'])
        ->whereNumber('id')->whereNumber('ticketTypeId')->middleware('throttle:nexus-route-120-per-1m');
    Route::post('/v2/events/{id}/ticket-types', [\App\Http\Controllers\Api\EventTicketController::class, 'createType'])
        ->whereNumber('id')->middleware('throttle:nexus-route-30-per-1m');
    Route::put('/v2/events/{id}/ticket-types/{ticketTypeId}', [\App\Http\Controllers\Api\EventTicketController::class, 'updateType'])
        ->whereNumber('id')->whereNumber('ticketTypeId')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/ticket-types/{ticketTypeId}/{action}', [\App\Http\Controllers\Api\EventTicketController::class, 'transitionType'])
        ->whereNumber('id')->whereNumber('ticketTypeId')->whereIn('action', ['activate', 'pause', 'archive'])
        ->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/tickets/{ticketTypeId}/allocate', [\App\Http\Controllers\Api\EventTicketController::class, 'allocateSelf'])
        ->whereNumber('id')->whereNumber('ticketTypeId')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/tickets/{ticketTypeId}/allocate/{userId}', [\App\Http\Controllers\Api\EventTicketController::class, 'allocateForMember'])
        ->whereNumber('id')->whereNumber('ticketTypeId')->whereNumber('userId')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/ticket-entitlements/{entitlementId}/cancel', [\App\Http\Controllers\Api\EventTicketController::class, 'cancelEntitlement'])
        ->whereNumber('id')->whereNumber('entitlementId')->middleware('throttle:nexus-route-30-per-1m');
    Route::get('/v2/events/{id}/lifecycle-history', [\App\Http\Controllers\Api\EventLifecycleHistoryController::class, 'index'])
        ->whereNumber('id')->middleware('throttle:nexus-route-120-per-1m');
    Route::post('/v2/events/{id}/recurrence-revisions/preview', [\App\Http\Controllers\Api\EventRecurrenceRevisionController::class, 'preview'])
        ->whereNumber('id')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/recurrence-revisions/commit', [\App\Http\Controllers\Api\EventRecurrenceRevisionController::class, 'commit'])
        ->whereNumber('id')->middleware('throttle:nexus-route-10-per-1m');
    Route::get('/v2/events/{id}/recurrence-definition-blueprints', [\App\Http\Controllers\Api\EventRecurrenceDefinitionBlueprintController::class, 'history'])
        ->whereNumber('id')->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/events/{id}/recurrence-definition-blueprints/preview', [\App\Http\Controllers\Api\EventRecurrenceDefinitionBlueprintController::class, 'preview'])
        ->whereNumber('id')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/recurrence-definition-blueprints/commit', [\App\Http\Controllers\Api\EventRecurrenceDefinitionBlueprintController::class, 'commit'])
        ->whereNumber('id')->middleware('throttle:nexus-route-10-per-1m');
    Route::get('/v2/events/{id}', [\App\Http\Controllers\Api\EventsController::class, 'show'])->whereNumber('id');
    Route::put('/v2/events/{id}', [\App\Http\Controllers\Api\EventsController::class, 'update'])->whereNumber('id');
    Route::post('/v2/events/{id}/submit', [\App\Http\Controllers\Api\EventsController::class, 'submitForReview'])->whereNumber('id');
    Route::post('/v2/events/{id}/publish', [\App\Http\Controllers\Api\EventsController::class, 'publish'])->whereNumber('id');
    Route::delete('/v2/events/{id}', [\App\Http\Controllers\Api\EventsController::class, 'destroy'])->whereNumber('id');
    Route::post('/v2/events/{id}/rsvp', [\App\Http\Controllers\Api\EventsController::class, 'rsvp'])->whereNumber('id');
    Route::delete('/v2/events/{id}/rsvp', [\App\Http\Controllers\Api\EventsController::class, 'removeRsvp'])->whereNumber('id');
    Route::get('/v2/events/{id}/attendees', [\App\Http\Controllers\Api\EventsController::class, 'attendees'])->whereNumber('id');
    Route::post('/v2/events/{id}/attendees/{attendeeId}/check-in', [\App\Http\Controllers\Api\EventsController::class, 'checkIn'])
        ->whereNumber('id')->whereNumber('attendeeId');
    Route::post('/v2/events/{id}/cancel', [\App\Http\Controllers\Api\EventsController::class, 'cancel'])->whereNumber('id');
    Route::post('/v2/events/{id}/waitlist', [\App\Http\Controllers\Api\EventsController::class, 'joinWaitlist'])->whereNumber('id');
    Route::delete('/v2/events/{id}/waitlist', [\App\Http\Controllers\Api\EventsController::class, 'leaveWaitlist'])->whereNumber('id');
    Route::post('/v2/events/{id}/image', [\App\Http\Controllers\Api\EventsController::class, 'uploadImage'])
        ->whereNumber('id')->middleware('throttle:nexus-route-20-per-1m');
    Route::put('/v2/events/{id}/recurring', [\App\Http\Controllers\Api\EventsController::class, 'updateRecurring'])->whereNumber('id');
    Route::get('/v2/events/{id}/waitlist', [\App\Http\Controllers\Api\EventsController::class, 'waitlist'])->whereNumber('id');
    Route::get('/v2/events/{id}/reminders', [\App\Http\Controllers\Api\EventsController::class, 'getReminders'])->whereNumber('id');
    Route::put('/v2/events/{id}/reminders', [\App\Http\Controllers\Api\EventsController::class, 'updateReminders'])->whereNumber('id');
    Route::delete('/v2/events/{id}/reminders', [\App\Http\Controllers\Api\EventsController::class, 'deleteReminders'])->whereNumber('id');
    Route::get('/v2/events/{id}/safety', [\App\Http\Controllers\Api\EventSafetyController::class, 'show'])->whereNumber('id');
    Route::put('/v2/events/{id}/safety/requirements', [\App\Http\Controllers\Api\EventSafetyController::class, 'saveRequirements'])->whereNumber('id');
    Route::post('/v2/events/{id}/safety/requirements/publish', [\App\Http\Controllers\Api\EventSafetyController::class, 'publishRequirements'])->whereNumber('id');
    Route::post('/v2/events/{id}/safety/requirements/archive', [\App\Http\Controllers\Api\EventSafetyController::class, 'archiveRequirements'])->whereNumber('id');
    Route::post('/v2/events/{id}/safety/code-of-conduct/acknowledgements', [\App\Http\Controllers\Api\EventSafetyController::class, 'acknowledgeCode'])->whereNumber('id');
    Route::delete('/v2/events/{id}/safety/code-of-conduct/acknowledgements/{acknowledgementId}', [\App\Http\Controllers\Api\EventSafetyController::class, 'withdrawCode'])->whereNumber('id')->whereNumber('acknowledgementId');
    Route::post('/v2/events/{id}/safety/guardian-consents', [\App\Http\Controllers\Api\EventSafetyController::class, 'requestGuardianConsent'])->whereNumber('id')->middleware('throttle:nexus-route-5-per-1m');
    Route::delete('/v2/events/{id}/safety/guardian-consents/{consentId}', [\App\Http\Controllers\Api\EventSafetyController::class, 'withdrawGuardianConsent'])->whereNumber('id')->whereNumber('consentId');
    Route::get('/v2/events/{id}/safety/reviews', [\App\Http\Controllers\Api\EventSafetyController::class, 'reviews'])->whereNumber('id');
    Route::post('/v2/events/{id}/safety/reviews', [\App\Http\Controllers\Api\EventSafetyController::class, 'recordReview'])->whereNumber('id')->middleware('throttle:nexus-route-30-per-1m');
    Route::delete('/v2/events/{id}/safety/reviews/{denialId}', [\App\Http\Controllers\Api\EventSafetyController::class, 'withdrawReview'])->whereNumber('id')->whereNumber('denialId');
    Route::get('/v2/events/{id}/attendance', [\App\Http\Controllers\Api\EventsController::class, 'getAttendance'])->whereNumber('id');
    Route::post('/v2/events/{id}/attendance', [\App\Http\Controllers\Api\EventsController::class, 'markAttendance'])->whereNumber('id');
    Route::post('/v2/events/{id}/attendance/bulk', [\App\Http\Controllers\Api\EventsController::class, 'bulkMarkAttendance'])->whereNumber('id');
    Route::post('/v2/events/{id}/series', [\App\Http\Controllers\Api\EventsController::class, 'linkToSeries'])->whereNumber('id');
    Route::get('/v2/events/{id}/staff', [\App\Http\Controllers\Api\EventStaffController::class, 'index'])
        ->whereNumber('id');
    Route::post('/v2/events/{id}/staff', [\App\Http\Controllers\Api\EventStaffController::class, 'store'])
        ->whereNumber('id');
    Route::delete('/v2/events/{id}/staff/{assignmentId}', [\App\Http\Controllers\Api\EventStaffController::class, 'destroy'])
        ->whereNumber('id')->whereNumber('assignmentId');
    Route::get('/v2/events/{id}/agenda', [\App\Http\Controllers\Api\EventAgendaController::class, 'index'])
        ->whereNumber('id');
    Route::post('/v2/events/{id}/agenda/sessions', [\App\Http\Controllers\Api\EventAgendaController::class, 'store'])
        ->whereNumber('id')->middleware('throttle:nexus-route-60-per-1m');
    Route::put('/v2/events/{id}/agenda/order', [\App\Http\Controllers\Api\EventAgendaController::class, 'reorder'])
        ->whereNumber('id')->middleware('throttle:nexus-route-60-per-1m');
    Route::put('/v2/events/{id}/agenda/sessions/{sessionId}', [\App\Http\Controllers\Api\EventAgendaController::class, 'update'])
        ->whereNumber('id')->whereNumber('sessionId')->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/events/{id}/agenda/sessions/{sessionId}/cancel', [\App\Http\Controllers\Api\EventAgendaController::class, 'cancel'])
        ->whereNumber('id')->whereNumber('sessionId')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/agenda/sessions/{sessionId}/registration', [\App\Http\Controllers\Api\EventAgendaController::class, 'register'])
        ->whereNumber('id')->whereNumber('sessionId')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/agenda/sessions/{sessionId}/registration/withdraw', [\App\Http\Controllers\Api\EventAgendaController::class, 'withdraw'])
        ->whereNumber('id')->whereNumber('sessionId')->middleware('throttle:nexus-route-30-per-1m');
    Route::get('/v2/events/{id}/offline-checkin', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'workspace'])
        ->whereNumber('id')->middleware('throttle:nexus-route-120-per-1m');
    Route::get('/v2/events/{id}/offline-checkin/credentials/me', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'myCredential'])
        ->whereNumber('id')->middleware('throttle:nexus-route-120-per-1m');
    Route::post('/v2/events/{id}/offline-checkin/credentials', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'issueCredential'])
        ->whereNumber('id')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/offline-checkin/credentials/{credentialId}/rotate', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'rotateCredential'])
        ->whereNumber('id')->whereNumber('credentialId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/offline-checkin/credentials/{credentialId}/revoke', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'revokeCredential'])
        ->whereNumber('id')->whereNumber('credentialId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/offline-checkin/devices', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'registerDevice'])
        ->whereNumber('id')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/offline-checkin/devices/{deviceId}/rotate', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'rotateDevice'])
        ->whereNumber('id')->whereNumber('deviceId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/offline-checkin/devices/{deviceId}/revoke', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'revokeDevice'])
        ->whereNumber('id')->whereNumber('deviceId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/offline-checkin/manifest', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'manifest'])
        ->whereNumber('id')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/offline-checkin/sync', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'stage'])
        ->whereNumber('id')->middleware('throttle:nexus-route-120-per-1m');
    Route::get('/v2/events/{id}/offline-checkin/batches/{batchId}', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'batch'])
        ->whereNumber('id')->whereNumber('batchId')->middleware('throttle:nexus-route-120-per-1m');
    Route::get('/v2/events/{id}/offline-checkin/conflicts', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'conflicts'])
        ->whereNumber('id')->middleware('throttle:nexus-route-120-per-1m');
    Route::post('/v2/events/{id}/offline-checkin/conflicts/{itemId}', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'resolveConflict'])
        ->whereNumber('id')->whereNumber('itemId')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/offline-checkin/scan', [\App\Http\Controllers\Api\EventOfflineCheckinController::class, 'scan'])
        ->whereNumber('id')->middleware('throttle:nexus-route-300-per-1m');
    Route::get('/v2/events/{eventId}/broadcasts', [\App\Http\Controllers\Api\EventBroadcastController::class, 'index'])
        ->whereNumber('eventId')->middleware('throttle:nexus-route-120-per-1m');
    Route::post('/v2/events/{eventId}/broadcasts/preview', [\App\Http\Controllers\Api\EventBroadcastController::class, 'preview'])
        ->whereNumber('eventId')->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/events/{eventId}/broadcasts', [\App\Http\Controllers\Api\EventBroadcastController::class, 'store'])
        ->whereNumber('eventId')->middleware('throttle:nexus-route-20-per-1m');
    Route::get('/v2/event-broadcasts/{broadcastId}', [\App\Http\Controllers\Api\EventBroadcastController::class, 'show'])
        ->whereNumber('broadcastId')->middleware('throttle:nexus-route-120-per-1m');
    Route::post('/v2/event-broadcasts/{broadcastId}/revisions', [\App\Http\Controllers\Api\EventBroadcastController::class, 'revise'])
        ->whereNumber('broadcastId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/event-broadcasts/{broadcastId}/schedule', [\App\Http\Controllers\Api\EventBroadcastController::class, 'schedule'])
        ->whereNumber('broadcastId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/event-broadcasts/{broadcastId}/cancel', [\App\Http\Controllers\Api\EventBroadcastController::class, 'cancel'])
        ->whereNumber('broadcastId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/event-broadcasts/{broadcastId}/retry', [\App\Http\Controllers\Api\EventBroadcastController::class, 'retry'])
        ->whereNumber('broadcastId')->middleware('throttle:nexus-route-20-per-1m');
    Route::get('/v2/events/{id}/registration-product', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'attendeeState'])
        ->whereNumber('id')->middleware('throttle:nexus-route-120-per-1m');
    Route::get('/v2/events/{id}/registration-product/manage', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'organizerOverview'])
        ->whereNumber('id')->middleware('throttle:nexus-route-120-per-1m');
    Route::put('/v2/events/{id}/registration-product/settings', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'saveSettings'])
        ->whereNumber('id')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/settings/publish', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'publishSettings'])
        ->whereNumber('id')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/forms', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'createForm'])
        ->whereNumber('id')->middleware('throttle:nexus-route-20-per-1m');
    Route::put('/v2/events/{id}/registration-product/forms/{formId}', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'updateForm'])
        ->whereNumber('id')->whereNumber('formId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/forms/{formId}/fork', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'forkForm'])
        ->whereNumber('id')->whereNumber('formId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/forms/{formId}/publish', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'publishForm'])
        ->whereNumber('id')->whereNumber('formId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/submissions', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'saveSubmission'])
        ->whereNumber('id')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/registration-product/submissions/{submissionId}/submit', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'submit'])
        ->whereNumber('id')->whereNumber('submissionId')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/registration-product/submissions/{submissionId}/amend', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'amend'])
        ->whereNumber('id')->whereNumber('submissionId')->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/registration-product/submissions/{submissionId}/answers', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'answers'])
        ->whereNumber('id')->whereNumber('submissionId')->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/events/{id}/registration-product/submissions/export', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'export'])
        ->whereNumber('id')->middleware('throttle:nexus-route-10-per-1m');
    Route::post('/v2/events/{id}/registration-product/campaigns/preview', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'previewCampaign'])
        ->whereNumber('id')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/campaigns/{campaignId}/schedule', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'scheduleCampaign'])
        ->whereNumber('id')->whereNumber('campaignId')->middleware('throttle:nexus-route-10-per-1m');
    Route::post('/v2/events/{id}/registration-product/campaigns/{campaignId}/issue', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'issueCampaign'])
        ->whereNumber('id')->whereNumber('campaignId')->middleware('throttle:nexus-route-10-per-1m');
    Route::post('/v2/events/{id}/registration-product/campaigns/{campaignId}/cancel', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'cancelCampaign'])
        ->whereNumber('id')->whereNumber('campaignId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/invitations/{invitationId}/revoke', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'revokeInvitation'])
        ->whereNumber('id')->whereNumber('invitationId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/invitations/accept', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'acceptInvitation'])
        ->whereNumber('id')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/invitations/{invitationId}/accept', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'acceptMemberInvitation'])
        ->whereNumber('id')->whereNumber('invitationId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/registrations/{registrationId}/guests', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'captureGuest'])
        ->whereNumber('id')->whereNumber('registrationId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/guests/{guestId}/cancel', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'cancelGuest'])
        ->whereNumber('id')->whereNumber('guestId')->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/events/{id}/registration-product/guests/{guestId}/attendance/{action}', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'transitionGuestAttendance'])
        ->whereNumber('id')->whereNumber('guestId')->whereIn('action', ['check_in', 'check_out', 'no_show', 'undo'])
        ->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/events/{id}/registration-product/retention/dry-run', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'retentionDryRun'])
        ->whereNumber('id')->middleware('throttle:nexus-route-10-per-1m');
    Route::post('/v2/events/{id}/registration-product/retention/{dryRunId}/apply', [\App\Http\Controllers\Api\EventRegistrationProductController::class, 'retentionApply'])
        ->whereNumber('id')->whereNumber('dryRunId')->middleware('throttle:nexus-route-5-per-1m');
});

// Canonical registration/People API. Legacy RSVP and waitlist endpoints above
// remain authoritative for existing clients during the dual-write window.
Route::middleware(['auth:sanctum', 'feature:events'])->group(function () {
    Route::get('/v2/events/{id}/relationship', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'show',
    ])->whereNumber('id');
    Route::post('/v2/events/{id}/registration/confirm', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'confirm',
    ])->whereNumber('id');
    Route::post('/v2/events/{id}/registration/withdraw', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'withdraw',
    ])->whereNumber('id');
    Route::post('/v2/events/{id}/registration/waitlist', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'joinWaitlist',
    ])->whereNumber('id');
    Route::post('/v2/events/{id}/registration/waitlist/leave', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'leaveWaitlist',
    ])->whereNumber('id');
    Route::post('/v2/events/{id}/registration/waitlist/accept', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'acceptOffer',
    ])->whereNumber('id');
    Route::get('/v2/events/{id}/people', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'people',
    ])->whereNumber('id');
    Route::get('/v2/events/{id}/people/export.csv', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'exportPeople',
    ])->whereNumber('id')->middleware('throttle:nexus-route-10-per-1m');
    Route::post('/v2/events/{id}/people/bulk', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'bulk',
    ])->whereNumber('id')->middleware('throttle:events-people-bulk');
    Route::get('/v2/events/{id}/people/{userId}/history', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'history',
    ])->whereNumber('id')->whereNumber('userId');
    Route::post('/v2/events/{id}/people/{userId}/attendance', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'attendance',
    ])->whereNumber('id')->whereNumber('userId')->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/events/{id}/people/{userId}/approve', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'approve',
    ])->whereNumber('id')->whereNumber('userId');
    Route::post('/v2/events/{id}/people/{userId}/reject', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'reject',
    ])->whereNumber('id')->whereNumber('userId');
    Route::post('/v2/events/{id}/people/{userId}/cancel', [
        \App\Http\Controllers\Api\EventRegistrationController::class,
        'cancel',
    ])->whereNumber('id')->whereNumber('userId');
});

// ============================================
// MIGRATED ROUTES — Listings (controller routes only)
// Source: httpdocs/routes/listings.php
// NOTE: Categories endpoint moved to public routes (above auth:sanctum group)
// ============================================
// ListingsController uses constructor DI (App\Services\ListingService),
// returns JsonResponse from every method, and handles validation via Laravel's
// ValidationException. Use it as the reference implementation pattern.
Route::middleware('module:listings')->group(function () {
    Route::get('/v2/listings', [\App\Http\Controllers\Api\ListingsController::class, 'index']);
    Route::get('/v2/listings/nearby', [\App\Http\Controllers\Api\ListingsController::class, 'nearby']);
    Route::get('/v2/listings/saved', [\App\Http\Controllers\Api\ListingsController::class, 'getSavedListings']);
    Route::get('/v2/listings/featured', [\App\Http\Controllers\Api\ListingsController::class, 'featured']);
    Route::get('/v2/listings/tags/popular', [\App\Http\Controllers\Api\ListingsController::class, 'popularTags'])->withoutMiddleware('auth:sanctum');
    Route::get('/v2/listings/tags/autocomplete', [\App\Http\Controllers\Api\ListingsController::class, 'autocompleteTags'])->withoutMiddleware('auth:sanctum');
    Route::post('/v2/listings', [\App\Http\Controllers\Api\ListingsController::class, 'store'])->middleware('onboarding-required');
    Route::post('/v2/listings/generate-description', [\App\Http\Controllers\Api\ListingsController::class, 'generateDescription']);
    Route::get('/v2/listings/{id}', [\App\Http\Controllers\Api\ListingsController::class, 'show']);
    Route::put('/v2/listings/{id}', [\App\Http\Controllers\Api\ListingsController::class, 'update']);
    Route::delete('/v2/listings/{id}', [\App\Http\Controllers\Api\ListingsController::class, 'destroy']);
    Route::post('/v2/listings/{id}/save', [\App\Http\Controllers\Api\ListingsController::class, 'saveListing'])->middleware('throttle:nexus-route-30-per-1m');
    Route::delete('/v2/listings/{id}/save', [\App\Http\Controllers\Api\ListingsController::class, 'unsaveListing'])->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/listings/{id}/image', [\App\Http\Controllers\Api\ListingsController::class, 'uploadImage'])->middleware('throttle:nexus-route-20-per-1m');
    Route::delete('/v2/listings/{id}/image', [\App\Http\Controllers\Api\ListingsController::class, 'deleteImage'])->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/listings/{id}/images', [\App\Http\Controllers\Api\ListingsController::class, 'uploadImages'])->middleware('throttle:nexus-route-20-per-1m');
    Route::delete('/v2/listings/{id}/images/{imageId}', [\App\Http\Controllers\Api\ListingsController::class, 'deleteListingImage'])->middleware('throttle:nexus-route-20-per-1m');
    Route::put('/v2/listings/{id}/images/reorder', [\App\Http\Controllers\Api\ListingsController::class, 'reorderImages'])->middleware('throttle:nexus-route-30-per-1m');
    Route::post('/v2/listings/{id}/renew', [\App\Http\Controllers\Api\ListingsController::class, 'renew']);
    Route::get('/v2/listings/{id}/analytics', [\App\Http\Controllers\Api\ListingsController::class, 'analytics']);
    Route::put('/v2/listings/{id}/tags', [\App\Http\Controllers\Api\ListingsController::class, 'setSkillTags']);
    Route::post('/v2/listings/{id}/report', [\App\Http\Controllers\Api\ListingsController::class, 'report']);
});

// ============================================
// MIGRATED ROUTES — Messages
// Source: httpdocs/routes/messages.php
// ============================================
Route::get('/v2/messages', [\App\Http\Controllers\Api\MessagesController::class, 'conversations']);
Route::get('/v2/messages/unread-count', [\App\Http\Controllers\Api\MessagesController::class, 'unreadCount']);
Route::get('/v2/messages/restriction-status', [\App\Http\Controllers\Api\MessagesController::class, 'restrictionStatus']);
Route::post('/v2/messages', [\App\Http\Controllers\Api\MessagesController::class, 'send'])->middleware('onboarding-required');
Route::post('/v2/messages/typing', [\App\Http\Controllers\Api\MessagesController::class, 'typing']);
Route::post('/v2/messages/voice', [\App\Http\Controllers\Api\MessagesController::class, 'sendVoice']);
Route::get('/v2/messages/{message}/attachments/{attachment}', [\App\Http\Controllers\Api\MessageMediaController::class, 'attachment']);
Route::get('/v2/messages/{message}/voice', [\App\Http\Controllers\Api\MessageMediaController::class, 'voice']);
Route::delete('/v2/messages/conversations/{id}', [\App\Http\Controllers\Api\MessagesController::class, 'archiveConversation']);
Route::get('/v2/messages/{id}', [\App\Http\Controllers\Api\MessagesController::class, 'show']);
Route::put('/v2/messages/{id}/read', [\App\Http\Controllers\Api\MessagesController::class, 'markRead']);
Route::post('/v2/messages/{id}/reactions', [\App\Http\Controllers\Api\MessagesController::class, 'toggleReaction']);
Route::post('/v2/messages/{id}/request-coordinator', [\App\Http\Controllers\Api\MessagesController::class, 'requestCoordinator']);
Route::post('/v2/messages/{id}/translate', [\App\Http\Controllers\Api\MessagesController::class, 'translateTranscript']);
Route::post('/v2/ugc-translate', [\App\Http\Controllers\Api\UgcTranslationController::class, 'translate']);
Route::put('/v2/messages/{id}', [\App\Http\Controllers\Api\MessagesController::class, 'update']);
Route::delete('/v2/messages/{id}', [\App\Http\Controllers\Api\MessagesController::class, 'deleteMessage']);
Route::delete('/v2/conversations/{id}', [\App\Http\Controllers\Api\MessagesController::class, 'archive']);
Route::post('/v2/messages/conversations/{id}/restore', [\App\Http\Controllers\Api\MessagesController::class, 'restoreConversation']);
Route::get('/v2/messages/reactions/batch', [\App\Http\Controllers\Api\MessagesController::class, 'getReactionsBatch']);

// ============================================
// Group Conversations (Group DMs)
// ============================================
Route::middleware('feature:groups')
    ->where([
        'id' => '[0-9]+',
        'userId' => '[0-9]+',
    ])
    ->group(function () {
Route::post('/v2/conversations/groups', [\App\Http\Controllers\Api\GroupConversationController::class, 'store']);
Route::get('/v2/conversations/groups', [\App\Http\Controllers\Api\GroupConversationController::class, 'index']);
Route::get('/v2/conversations/{id}/participants', [\App\Http\Controllers\Api\GroupConversationController::class, 'participants']);
Route::post('/v2/conversations/{id}/participants', [\App\Http\Controllers\Api\GroupConversationController::class, 'addParticipant']);
Route::delete('/v2/conversations/{id}/participants/{userId}', [\App\Http\Controllers\Api\GroupConversationController::class, 'removeParticipant']);
Route::patch('/v2/conversations/{id}/group', [\App\Http\Controllers\Api\GroupConversationController::class, 'updateGroup']);
Route::get('/v2/conversations/{id}/messages', [\App\Http\Controllers\Api\GroupConversationController::class, 'messages']);
Route::post('/v2/conversations/{id}/messages', [\App\Http\Controllers\Api\GroupConversationController::class, 'sendMessage']);
});

// ============================================
// MIGRATED ROUTES — Groups & Connections
// Source: httpdocs/routes/groups.php
Route::get('/v2/connections/status/me', function () {
    return response()->json(['errors' => [['code' => 'invalid_user', 'message' => 'Cannot check connection status with yourself']]], 422);
}); // Guard: reject literal "me" before {userId} param
// ============================================
// NOTE: GET /v2/groups, /v2/groups/{id}, /v2/groups/{id}/members are registered
// in the authenticated feature-gated group above.
Route::middleware('feature:groups')
    ->where([
        'id' => '[0-9]+',
        'userId' => '[0-9]+',
        'discussionId' => '[0-9]+',
        'announcementId' => '[0-9]+',
        'fileId' => '[0-9]+',
        'inviteId' => '[0-9]+',
        'questionId' => '[0-9]+',
        'answerId' => '[0-9]+',
        'pageId' => '[0-9]+',
        'mediaId' => '[0-9]+',
        'webhookId' => '[0-9]+',
        'challengeId' => '[0-9]+',
        'postId' => '[0-9]+',
    ])
    ->group(function () {
Route::post('/v2/groups', [\App\Http\Controllers\Api\GroupsController::class, 'store']);
Route::get('/v2/groups/recommendations', [\App\Http\Controllers\Api\GroupRecommendController::class, 'index']);
Route::post('/v2/groups/recommendations/track', [\App\Http\Controllers\Api\GroupRecommendController::class, 'track']);
Route::get('/v2/groups/recommendations/metrics', [\App\Http\Controllers\Api\GroupRecommendController::class, 'metrics']);
Route::put('/v2/groups/{id}', [\App\Http\Controllers\Api\GroupsController::class, 'update']);
Route::post('/v2/groups/{id}/settings', [\App\Http\Controllers\Api\GroupsController::class, 'updateForm'])->middleware('throttle:nexus-route-20-per-1m');
Route::delete('/v2/groups/{id}', [\App\Http\Controllers\Api\GroupsController::class, 'destroy']);
Route::get('/v2/groups/{id}/similar', [\App\Http\Controllers\Api\GroupRecommendController::class, 'similar']);
Route::post('/v2/groups/{id}/join', [\App\Http\Controllers\Api\GroupsController::class, 'join'])->middleware('throttle:groups-join');
Route::delete('/v2/groups/{id}/membership', [\App\Http\Controllers\Api\GroupsController::class, 'leave']);
Route::put('/v2/groups/{id}/members/{userId}', [\App\Http\Controllers\Api\GroupsController::class, 'updateMember']);
Route::delete('/v2/groups/{id}/members/{userId}', [\App\Http\Controllers\Api\GroupsController::class, 'removeMember']);
Route::get('/v2/groups/{id}/requests', [\App\Http\Controllers\Api\GroupsController::class, 'pendingRequests']);
Route::post('/v2/groups/{id}/requests/{userId}', [\App\Http\Controllers\Api\GroupsController::class, 'handleRequest'])->middleware('throttle:groups-join');
Route::get('/v2/groups/{id}/discussions', [\App\Http\Controllers\Api\GroupsController::class, 'discussions'])->middleware('group.tab:discussion');
Route::post('/v2/groups/{id}/discussions', [\App\Http\Controllers\Api\GroupsController::class, 'createDiscussion'])->middleware('group.tab:discussion');
Route::get('/v2/groups/{id}/discussions/{discussionId}', [\App\Http\Controllers\Api\GroupsController::class, 'discussionMessages'])->middleware('group.tab:discussion');
Route::post('/v2/groups/{id}/discussions/{discussionId}/messages', [\App\Http\Controllers\Api\GroupsController::class, 'postToDiscussion'])->middleware('group.tab:discussion');
Route::post('/v2/groups/{id}/image', [\App\Http\Controllers\Api\GroupsController::class, 'uploadImage'])->middleware('throttle:groups-upload');
Route::delete('/v2/groups/{id}/image', [\App\Http\Controllers\Api\GroupsController::class, 'removeImage'])->middleware('throttle:nexus-route-20-per-1m');
Route::get('/v2/groups/{id}/announcements', [\App\Http\Controllers\Api\GroupsController::class, 'announcements'])->middleware('group.tab:announcements');
Route::post('/v2/groups/{id}/announcements', [\App\Http\Controllers\Api\GroupsController::class, 'createAnnouncement'])->middleware('group.tab:announcements');
Route::put('/v2/groups/{id}/announcements/{announcementId}', [\App\Http\Controllers\Api\GroupsController::class, 'updateAnnouncement'])->middleware('group.tab:announcements');
Route::delete('/v2/groups/{id}/announcements/{announcementId}', [\App\Http\Controllers\Api\GroupsController::class, 'deleteAnnouncement'])->middleware('group.tab:announcements');
Route::get('/v2/groups/{id}/files', [\App\Http\Controllers\Api\GroupFilesController::class, 'index'])->middleware('group.tab:files');
Route::post('/v2/groups/{id}/files', [\App\Http\Controllers\Api\GroupFilesController::class, 'store'])->middleware(['throttle:groups-upload', 'group.tab:files']);
Route::get('/v2/groups/{id}/files/folders', [\App\Http\Controllers\Api\GroupFilesController::class, 'folders'])->middleware('group.tab:files');
Route::get('/v2/groups/{id}/files/stats', [\App\Http\Controllers\Api\GroupFilesController::class, 'stats'])->middleware('group.tab:files');
Route::get('/v2/groups/{id}/files/{fileId}/download', [\App\Http\Controllers\Api\GroupFilesController::class, 'download'])->middleware('group.tab:files');
Route::delete('/v2/groups/{id}/files/{fileId}', [\App\Http\Controllers\Api\GroupFilesController::class, 'destroy'])->middleware('group.tab:files');
Route::get('/v2/groups/{id}/analytics', [\App\Http\Controllers\Api\GroupAnalyticsController::class, 'dashboard'])->middleware(['throttle:groups-analytics-read', 'group.tab:analytics']);
Route::get('/v2/groups/{id}/analytics/growth', [\App\Http\Controllers\Api\GroupAnalyticsController::class, 'growth'])->middleware(['throttle:groups-analytics-read', 'group.tab:analytics']);
Route::get('/v2/groups/{id}/analytics/engagement', [\App\Http\Controllers\Api\GroupAnalyticsController::class, 'engagement'])->middleware(['throttle:groups-analytics-read', 'group.tab:analytics']);
Route::get('/v2/groups/{id}/analytics/contributors', [\App\Http\Controllers\Api\GroupAnalyticsController::class, 'contributors'])->middleware(['throttle:groups-analytics-read', 'group.tab:analytics']);
Route::get('/v2/groups/{id}/analytics/retention', [\App\Http\Controllers\Api\GroupAnalyticsController::class, 'retention'])->middleware(['throttle:groups-analytics-read', 'group.tab:analytics']);
Route::get('/v2/groups/{id}/analytics/comparative', [\App\Http\Controllers\Api\GroupAnalyticsController::class, 'comparative'])->middleware(['throttle:groups-analytics-read', 'group.tab:analytics']);
Route::get('/v2/groups/{id}/analytics/export/members', [\App\Http\Controllers\Api\GroupAnalyticsController::class, 'exportMembers'])->middleware(['throttle:groups-analytics-export', 'group.tab:analytics']);
Route::get('/v2/groups/{id}/analytics/export/activity', [\App\Http\Controllers\Api\GroupAnalyticsController::class, 'exportActivity'])->middleware(['throttle:groups-analytics-export', 'group.tab:analytics']);
Route::get('/v2/groups/{id}/invites', [\App\Http\Controllers\Api\GroupInviteController::class, 'index'])->middleware('throttle:groups-invite-read');
Route::post('/v2/groups/{id}/invites/link', [\App\Http\Controllers\Api\GroupInviteController::class, 'createLink'])->middleware('throttle:groups-invite-write');
Route::post('/v2/groups/{id}/invites/email', [\App\Http\Controllers\Api\GroupInviteController::class, 'sendEmails'])->middleware('throttle:groups-invite-write');
Route::delete('/v2/groups/{id}/invites/{inviteId}', [\App\Http\Controllers\Api\GroupInviteController::class, 'revoke'])->middleware('throttle:groups-invite-write');
Route::get('/v2/groups/invite/{token}', [\App\Http\Controllers\Api\GroupInviteController::class, 'show'])->middleware('throttle:groups-invite-read');
Route::post('/v2/groups/invite/{token}/accept', [\App\Http\Controllers\Api\GroupInviteController::class, 'accept'])->middleware('throttle:groups-invite-write');
Route::get('/v2/groups/{id}/tags', [\App\Http\Controllers\Api\GroupTagController::class, 'index']);
Route::put('/v2/groups/{id}/tags', [\App\Http\Controllers\Api\GroupTagController::class, 'update']);
Route::get('/v2/group-tags', [\App\Http\Controllers\Api\GroupTagController::class, 'allTags']);
Route::get('/v2/group-tags/popular', [\App\Http\Controllers\Api\GroupTagController::class, 'popular']);
Route::get('/v2/group-tags/suggest', [\App\Http\Controllers\Api\GroupTagController::class, 'suggest']);
Route::get('/v2/groups/{id}/questions', [\App\Http\Controllers\Api\GroupQAController::class, 'index'])->middleware('group.tab:qa');
Route::post('/v2/groups/{id}/questions', [\App\Http\Controllers\Api\GroupQAController::class, 'ask'])->middleware('group.tab:qa');
Route::get('/v2/groups/{id}/questions/{questionId}', [\App\Http\Controllers\Api\GroupQAController::class, 'show'])->middleware('group.tab:qa');
Route::put('/v2/groups/{id}/questions/{questionId}', [\App\Http\Controllers\Api\GroupQAController::class, 'updateQuestion'])->middleware('group.tab:qa');
Route::delete('/v2/groups/{id}/questions/{questionId}', [\App\Http\Controllers\Api\GroupQAController::class, 'destroyQuestion'])->middleware('group.tab:qa');
Route::post('/v2/groups/{id}/questions/{questionId}/answers', [\App\Http\Controllers\Api\GroupQAController::class, 'answer'])->middleware('group.tab:qa');
Route::put('/v2/groups/{id}/answers/{answerId}', [\App\Http\Controllers\Api\GroupQAController::class, 'updateAnswer'])->middleware('group.tab:qa');
Route::delete('/v2/groups/{id}/answers/{answerId}', [\App\Http\Controllers\Api\GroupQAController::class, 'destroyAnswer'])->middleware('group.tab:qa');
Route::post('/v2/groups/{id}/answers/{answerId}/accept', [\App\Http\Controllers\Api\GroupQAController::class, 'accept'])->middleware('group.tab:qa');
Route::post('/v2/groups/{id}/qa/vote', [\App\Http\Controllers\Api\GroupQAController::class, 'vote'])->middleware(['throttle:groups-vote', 'group.tab:qa']);
Route::get('/v2/groups/{id}/wiki', [\App\Http\Controllers\Api\GroupWikiController::class, 'index'])->middleware('group.tab:wiki');
Route::post('/v2/groups/{id}/wiki', [\App\Http\Controllers\Api\GroupWikiController::class, 'create'])->middleware('group.tab:wiki');
Route::get('/v2/groups/{id}/wiki/{slug}', [\App\Http\Controllers\Api\GroupWikiController::class, 'show'])->middleware('group.tab:wiki');
Route::put('/v2/groups/{id}/wiki/{pageId}', [\App\Http\Controllers\Api\GroupWikiController::class, 'update'])->middleware('group.tab:wiki');
Route::delete('/v2/groups/{id}/wiki/{pageId}', [\App\Http\Controllers\Api\GroupWikiController::class, 'destroy'])->middleware('group.tab:wiki');
Route::get('/v2/groups/{id}/wiki/{pageId}/revisions', [\App\Http\Controllers\Api\GroupWikiController::class, 'revisions'])->middleware('group.tab:wiki');
Route::get('/v2/groups/{id}/media', [\App\Http\Controllers\Api\GroupMediaController::class, 'index'])->middleware('group.tab:media');
Route::post('/v2/groups/{id}/media', [\App\Http\Controllers\Api\GroupMediaController::class, 'upload'])->middleware(['throttle:groups-upload', 'group.tab:media']);
Route::delete('/v2/groups/{id}/media/{mediaId}', [\App\Http\Controllers\Api\GroupMediaController::class, 'destroy'])->middleware('group.tab:media');
Route::get('/v2/groups/{id}/webhooks', [\App\Http\Controllers\Api\GroupWebhookController::class, 'index']);
Route::post('/v2/groups/{id}/webhooks', [\App\Http\Controllers\Api\GroupWebhookController::class, 'store']);
Route::delete('/v2/groups/{id}/webhooks/{webhookId}', [\App\Http\Controllers\Api\GroupWebhookController::class, 'destroy']);
Route::put('/v2/groups/{id}/webhooks/{webhookId}/toggle', [\App\Http\Controllers\Api\GroupWebhookController::class, 'toggle']);
Route::get('/v2/groups/{id}/welcome', [\App\Http\Controllers\Api\GroupWelcomeController::class, 'getConfig']);
Route::put('/v2/groups/{id}/welcome', [\App\Http\Controllers\Api\GroupWelcomeController::class, 'setConfig']);
Route::get('/v2/group-templates', [\App\Http\Controllers\Api\GroupTemplateController::class, 'index']);
Route::get('/v2/groups/{id}/custom-fields', [\App\Http\Controllers\Api\GroupCustomFieldController::class, 'getValues']);
Route::put('/v2/groups/{id}/custom-fields', [\App\Http\Controllers\Api\GroupCustomFieldController::class, 'setValues']);
Route::get('/v2/groups/{id}/export', [\App\Http\Controllers\Api\GroupDataExportController::class, 'exportAll'])->middleware('throttle:groups-export-write');
Route::post('/v2/groups/{id}/exports', [\App\Http\Controllers\Api\GroupDataExportController::class, 'requestExport'])->middleware('throttle:groups-export-write');
Route::get('/v2/groups/{id}/exports/{exportId}', [\App\Http\Controllers\Api\GroupDataExportController::class, 'exportStatus'])->whereUuid('exportId')->middleware('throttle:groups-export-read');
Route::get('/v2/groups/{id}/exports/{exportId}/download', [\App\Http\Controllers\Api\GroupDataExportController::class, 'downloadExport'])->whereUuid('exportId')->middleware('throttle:groups-export-read');
Route::get('/v2/groups/{id}/challenges', [\App\Http\Controllers\Api\GroupChallengeController::class, 'index'])->middleware('group.tab:challenges');
Route::post('/v2/groups/{id}/challenges', [\App\Http\Controllers\Api\GroupChallengeController::class, 'store'])->middleware('group.tab:challenges');
Route::delete('/v2/groups/{id}/challenges/{challengeId}', [\App\Http\Controllers\Api\GroupChallengeController::class, 'destroy'])->middleware('group.tab:challenges');
Route::get('/v2/groups/{id}/scheduled-posts', [\App\Http\Controllers\Api\GroupScheduledPostController::class, 'index'])->middleware('group.tab:announcements');
Route::post('/v2/groups/{id}/scheduled-posts', [\App\Http\Controllers\Api\GroupScheduledPostController::class, 'store'])->middleware('group.tab:announcements');
Route::delete('/v2/groups/{id}/scheduled-posts/{postId}', [\App\Http\Controllers\Api\GroupScheduledPostController::class, 'cancel'])->middleware('group.tab:announcements');
Route::get('/v2/groups/{id}/notification-prefs', [\App\Http\Controllers\Api\GroupNotificationPrefController::class, 'get']);
Route::put('/v2/groups/{id}/notification-prefs', [\App\Http\Controllers\Api\GroupNotificationPrefController::class, 'set']);
Route::get('/v2/group-collections', [\App\Http\Controllers\Api\GroupCollectionController::class, 'index']);
Route::get('/v2/group-collections/{id}', [\App\Http\Controllers\Api\GroupCollectionController::class, 'show']);
Route::get('/v2/groups/{id}/mentions/suggest', [\App\Http\Controllers\Api\GroupMentionController::class, 'suggestions']);
});
Route::get('/v2/connections', [\App\Http\Controllers\Api\ConnectionsController::class, 'index']);
Route::get('/v2/connections/pending', [\App\Http\Controllers\Api\ConnectionsController::class, 'pendingCounts']);
Route::get('/v2/connections/status/{userId}', [\App\Http\Controllers\Api\ConnectionsController::class, 'status']);
Route::post('/v2/connections/request', [\App\Http\Controllers\Api\ConnectionsController::class, 'request']);
Route::post('/v2/connections/{id}/accept', [\App\Http\Controllers\Api\ConnectionsController::class, 'accept']);
Route::post('/v2/connections/{id}/decline', [\App\Http\Controllers\Api\ConnectionsController::class, 'decline']);
Route::delete('/v2/connections/{id}', [\App\Http\Controllers\Api\ConnectionsController::class, 'destroy']);
Route::get('/v2/connections/suggestions', [\App\Http\Controllers\Api\ConnectionSuggestionController::class, 'suggestions']);

// ============================================
// MIGRATED ROUTES — Users (controller routes only)
// Source: httpdocs/routes/users.php
Route::get('/v2/users/search', [\App\Http\Controllers\Api\UsersController::class, 'search']);
Route::get('/v2/users', [\App\Http\Controllers\Api\UsersController::class, 'index']); // Member directory
// ============================================
Route::get('/v2/me/stats', [\App\Http\Controllers\Api\UsersController::class, 'stats']);
Route::get('/v2/users/me', [\App\Http\Controllers\Api\UsersController::class, 'me']);
Route::put('/v2/users/me', [\App\Http\Controllers\Api\UsersController::class, 'update']);
Route::get('/v2/users/me/preferences', [\App\Http\Controllers\Api\UsersController::class, 'getPreferences']);
Route::put('/v2/users/me/preferences', [\App\Http\Controllers\Api\UsersController::class, 'updatePreferences']);
Route::put('/v2/users/me/theme', [\App\Http\Controllers\Api\UsersController::class, 'updateTheme']);
Route::put('/v2/users/me/theme-preferences', [\App\Http\Controllers\Api\UsersController::class, 'updateThemePreferences']);
Route::put('/v2/users/me/language', [\App\Http\Controllers\Api\UsersController::class, 'updateLanguage']);
Route::post('/v2/users/me/avatar', [\App\Http\Controllers\Api\UsersController::class, 'updateAvatar']);
Route::post('/v2/users/me/password', [\App\Http\Controllers\Api\UsersController::class, 'updatePassword']);
Route::delete('/v2/users/me', [\App\Http\Controllers\Api\UsersController::class, 'deleteAccount']);
Route::get('/v2/users/me/listings', [\App\Http\Controllers\Api\UsersController::class, 'myListings']);
Route::get('/v2/users/me/notifications', [\App\Http\Controllers\Api\UsersController::class, 'notificationPreferences']);
Route::put('/v2/users/me/notifications', [\App\Http\Controllers\Api\UsersController::class, 'updateNotificationPreferences']);
Route::put('/v2/users/me/notification-settings', [\App\Http\Controllers\Api\NotificationSettingsController::class, 'update']);
Route::get('/v2/users/me/consent', [\App\Http\Controllers\Api\UsersController::class, 'getConsent']);
Route::put('/v2/users/me/consent', [\App\Http\Controllers\Api\UsersController::class, 'updateConsent']);
Route::post('/v2/users/me/gdpr-request', [\App\Http\Controllers\Api\UsersController::class, 'createGdprRequest']);
Route::put('/v2/users/me/resume-visibility', [\App\Http\Controllers\Api\JobVacanciesController::class, 'updateResumeVisibility']);
Route::get('/v2/users/me/sessions', [\App\Http\Controllers\Api\UsersController::class, 'sessions']);
Route::get('/v2/users/me/match-preferences', [\App\Http\Controllers\Api\MatchPreferencesController::class, 'show']);
Route::put('/v2/users/me/match-preferences', [\App\Http\Controllers\Api\MatchPreferencesController::class, 'update']);
Route::get('/v2/users/me/insurance', [\App\Http\Controllers\Api\UserInsuranceController::class, 'list']);
Route::post('/v2/users/me/insurance', [\App\Http\Controllers\Api\UserInsuranceController::class, 'store']);
// GDPR / FADP — member personal-data export (R3)
Route::post('/v2/me/data-export', [\App\Http\Controllers\Api\MemberDataExportController::class, 'create']);
Route::get('/v2/me/data-export/history', [\App\Http\Controllers\Api\MemberDataExportController::class, 'history']);
// Block users
Route::get('/v2/users/blocked', [\App\Http\Controllers\Api\BlockUserController::class, 'index']);
Route::post('/v2/users/{id}/block', [\App\Http\Controllers\Api\BlockUserController::class, 'block']);
Route::delete('/v2/users/{id}/block', [\App\Http\Controllers\Api\BlockUserController::class, 'unblock']);
Route::get('/v2/users/{id}/block-status', [\App\Http\Controllers\Api\BlockUserController::class, 'status']);
Route::get('/v2/users/{id}', [\App\Http\Controllers\Api\UsersController::class, 'show']);
Route::get('/v2/users/{id}/listings', [\App\Http\Controllers\Api\UsersController::class, 'listings']);
Route::get('/v2/members/nearby', [\App\Http\Controllers\Api\UsersController::class, 'nearby']);
// Skills (categories + search are public; remaining skill routes require auth)
Route::get('/v2/skills/categories', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'getCategories'])->withoutMiddleware('auth:sanctum');
Route::get('/v2/skills/search', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'search'])->withoutMiddleware('auth:sanctum');
Route::get('/v2/skills/members', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'getMembersWithSkill']);
Route::get('/v2/skills/categories/{id}', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'getCategoryById']);
Route::post('/v2/skills/categories', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'createCategory'])->middleware('admin');
Route::put('/v2/skills/categories/{id}', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'updateCategory'])->middleware('admin');
Route::delete('/v2/skills/categories/{id}', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'deleteCategory'])->middleware('admin');
Route::get('/v2/users/me/skills', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'getMySkills']);
Route::post('/v2/users/me/skills', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'addSkill']);
Route::put('/v2/users/me/skills/{id}', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'updateSkill']);
Route::delete('/v2/users/me/skills/{id}', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'removeSkill']);
Route::get('/v2/users/{id}/skills', [\App\Http\Controllers\Api\SkillTaxonomyController::class, 'getUserSkills']);
// Availability
Route::get('/v2/users/me/availability', [\App\Http\Controllers\Api\MemberAvailabilityController::class, 'getMyAvailability']);
Route::put('/v2/users/me/availability', [\App\Http\Controllers\Api\MemberAvailabilityController::class, 'setBulkAvailability']);
Route::put('/v2/users/me/availability/{day}', [\App\Http\Controllers\Api\MemberAvailabilityController::class, 'setDayAvailability']);
Route::post('/v2/users/me/availability/date', [\App\Http\Controllers\Api\MemberAvailabilityController::class, 'addSpecificDate']);
Route::delete('/v2/users/me/availability/{id}', [\App\Http\Controllers\Api\MemberAvailabilityController::class, 'deleteSlot']);
Route::get('/v2/users/{id}/availability', [\App\Http\Controllers\Api\MemberAvailabilityController::class, 'getUserAvailability']);
Route::get('/v2/members/availability/compatible', [\App\Http\Controllers\Api\MemberAvailabilityController::class, 'findCompatibleTimes']);
Route::get('/v2/members/availability/available', [\App\Http\Controllers\Api\MemberAvailabilityController::class, 'getAvailableMembers']);
// Endorsements
Route::post('/v2/members/{id}/endorse', [\App\Http\Controllers\Api\EndorsementController::class, 'endorse']);
Route::delete('/v2/members/{id}/endorse', [\App\Http\Controllers\Api\EndorsementController::class, 'removeEndorsement']);
Route::get('/v2/members/{id}/endorsements', [\App\Http\Controllers\Api\EndorsementController::class, 'getEndorsements']);
Route::get('/v2/members/top-endorsed', [\App\Http\Controllers\Api\EndorsementController::class, 'getTopEndorsed']);
// Peer Endorsements (verification badge system)
Route::post('/v2/members/{id}/peer-endorse', [\App\Http\Controllers\Api\PeerEndorsementController::class, 'endorse']);
// Activity Dashboard
Route::get('/v2/users/me/activity/dashboard', [\App\Http\Controllers\Api\MemberActivityController::class, 'getDashboard']);
Route::get('/v2/users/me/activity/timeline', [\App\Http\Controllers\Api\MemberActivityController::class, 'getTimeline']);
Route::get('/v2/users/me/activity/hours', [\App\Http\Controllers\Api\MemberActivityController::class, 'getHours']);
Route::get('/v2/users/me/activity/monthly', [\App\Http\Controllers\Api\MemberActivityController::class, 'getMonthlyHours']);
Route::get('/v2/users/{id}/activity/dashboard', [\App\Http\Controllers\Api\MemberActivityController::class, 'getPublicDashboard']);
// Verification Badges
Route::get('/v2/users/{id}/verification-badges', [\App\Http\Controllers\Api\MemberVerificationBadgeController::class, 'getUserBadges']);
// NOTE: Admin badge management routes moved to admin middleware group below
// ─── Federation: INTERNAL surface ───────────────────────────────────────────
// For this installation's OWN logged-in members (auth:sanctum), not partners.
// This is how communities sharing one installation — sub-communities and the
// Partner Timebanks panel — federate with each other. It is deliberately NOT
// behind the external kill switch: a switch meant for other installations must
// never cut off our own members. See feedback in docs/FEDERATION_API_MANUAL.md
// ("inside versus outside").
//
// 🔴 The /v2/federation/ prefix holds BOTH internal and external routes. Only
// the ingest/, komunitin/, cc/, external/, hour-transfer/ and aggregates paths
// under it face other installations. The prefix alone tells you nothing.
Route::get('/v2/federation/status', [\App\Http\Controllers\Api\FederationV2Controller::class, 'status']);
Route::post('/v2/federation/opt-in', [\App\Http\Controllers\Api\FederationV2Controller::class, 'optIn'])->middleware('throttle:nexus-route-10-per-1m');
Route::post('/v2/federation/setup', [\App\Http\Controllers\Api\FederationV2Controller::class, 'setup'])->middleware('throttle:nexus-route-10-per-1m');
Route::post('/v2/federation/opt-out', [\App\Http\Controllers\Api\FederationV2Controller::class, 'optOut'])->middleware('throttle:nexus-route-10-per-1m');
Route::get('/v2/federation/partners', [\App\Http\Controllers\Api\FederationV2Controller::class, 'partners']);
Route::get('/v2/federation/partners/{id}', [\App\Http\Controllers\Api\FederationV2Controller::class, 'partnerDetail'])
    ->where('id', '(?:[0-9]+|ext-[0-9]+)');
Route::get('/v2/federation/activity', [\App\Http\Controllers\Api\FederationV2Controller::class, 'activity']);
Route::get('/v2/federation/events', [\App\Http\Controllers\Api\FederationV2Controller::class, 'events']);
Route::get('/v2/federation/groups', [\App\Http\Controllers\Api\FederationV2Controller::class, 'groups'])->middleware('throttle:nexus-route-60-per-1m');
Route::get('/v2/federation/listings', [\App\Http\Controllers\Api\FederationV2Controller::class, 'listings'])->middleware('throttle:nexus-route-60-per-1m');
Route::get('/v2/federation/members', [\App\Http\Controllers\Api\FederationV2Controller::class, 'members'])->middleware('throttle:nexus-route-60-per-1m');
Route::get('/v2/federation/members/{id}', [\App\Http\Controllers\Api\FederationV2Controller::class, 'member'])
    ->where('id', '(?:[0-9]+|ext-[0-9]+-.+)');
Route::get('/v2/federation/members/{id}/reviews', [\App\Http\Controllers\Api\FederationV2Controller::class, 'memberReviews'])
    ->where('id', '.*');
Route::get('/v2/federation/messages', [\App\Http\Controllers\Api\FederationV2Controller::class, 'messages']);
Route::post('/v2/federation/messages', [\App\Http\Controllers\Api\FederationV2Controller::class, 'sendMessage'])->middleware('throttle:nexus-route-20-per-1m');
Route::post('/v2/federation/messages/mark-read-batch', [\App\Http\Controllers\Api\FederationV2Controller::class, 'markMessagesReadBatch'])->middleware('throttle:nexus-route-60-per-1m');
Route::post('/v2/federation/messages/{id}/mark-read', [\App\Http\Controllers\Api\FederationV2Controller::class, 'markMessageRead'])->middleware('throttle:nexus-route-60-per-1m');
Route::post('/v2/federation/messages/{id}/translate', [\App\Http\Controllers\Api\FederationV2Controller::class, 'translateMessage']);
Route::post('/v2/federation/transactions', [\App\Http\Controllers\Api\FederationV2Controller::class, 'sendTransaction'])->middleware('throttle:nexus-route-20-per-1m');
Route::get('/v2/federation/settings', [\App\Http\Controllers\Api\FederationV2Controller::class, 'getSettings']);
Route::put('/v2/federation/settings', [\App\Http\Controllers\Api\FederationV2Controller::class, 'updateSettings'])->middleware('throttle:nexus-route-20-per-1m');
Route::get('/v2/federation/connections', [\App\Http\Controllers\Api\FederationV2Controller::class, 'connections']);
Route::post('/v2/federation/connections', [\App\Http\Controllers\Api\FederationV2Controller::class, 'sendConnectionRequest'])->middleware('throttle:nexus-route-10-per-1m');
Route::post('/v2/federation/connections/{id}/accept', [\App\Http\Controllers\Api\FederationV2Controller::class, 'acceptConnection'])->middleware('throttle:nexus-route-20-per-1m');
Route::post('/v2/federation/connections/{id}/reject', [\App\Http\Controllers\Api\FederationV2Controller::class, 'rejectConnection'])->middleware('throttle:nexus-route-20-per-1m');
Route::delete('/v2/federation/connections/{id}', [\App\Http\Controllers\Api\FederationV2Controller::class, 'removeConnection'])->middleware('throttle:nexus-route-20-per-1m');
Route::get('/v2/federation/connections/status/{userId}/{tenantId}', [\App\Http\Controllers\Api\FederationV2Controller::class, 'connectionStatus']);
// Sub-Accounts
Route::get('/v2/users/me/sub-accounts', [\App\Http\Controllers\Api\SubAccountController::class, 'getChildAccounts']);
Route::get('/v2/users/me/parent-accounts', [\App\Http\Controllers\Api\SubAccountController::class, 'getParentAccounts']);
Route::post('/v2/users/me/sub-accounts', [\App\Http\Controllers\Api\SubAccountController::class, 'requestRelationship']);
Route::put('/v2/users/me/sub-accounts/{id}/approve', [\App\Http\Controllers\Api\SubAccountController::class, 'approveRelationship']);
Route::put('/v2/users/me/sub-accounts/{id}/permissions', [\App\Http\Controllers\Api\SubAccountController::class, 'updatePermissions']);
Route::delete('/v2/users/me/sub-accounts/{id}', [\App\Http\Controllers\Api\SubAccountController::class, 'revokeRelationship']);
Route::get('/v2/users/me/sub-accounts/{childId}/activity', [\App\Http\Controllers\Api\SubAccountController::class, 'getChildActivity']);

// ============================================
// MIGRATED ROUTES — Social (Wallet, Feed, Notifications, Reviews, Search, Polls)
// Source: httpdocs/routes/social.php
// Realtime config (was closure in legacy router, now a controller)
Route::get('/v2/realtime/config', [\App\Http\Controllers\Api\RealtimeController::class, 'config']);
// ============================================
// Wallet
Route::get('/v2/wallet/config', [\App\Http\Controllers\Api\WalletController::class, 'config']);
Route::get('/v2/wallet/balance', [\App\Http\Controllers\Api\WalletController::class, 'balance']);
Route::get('/v2/wallet/transactions', [\App\Http\Controllers\Api\WalletController::class, 'transactions']);
Route::get('/v2/wallet/transactions/{id}', [\App\Http\Controllers\Api\WalletController::class, 'showTransaction']);
Route::post('/v2/wallet/transfer', [\App\Http\Controllers\Api\WalletController::class, 'transfer'])->middleware('onboarding-required');
Route::delete('/v2/wallet/transactions/{id}', [\App\Http\Controllers\Api\WalletController::class, 'destroyTransaction']);
Route::get('/v2/wallet/user-search', [\App\Http\Controllers\Api\WalletController::class, 'userSearch']);
Route::get('/v2/wallet/pending-count', [\App\Http\Controllers\Api\WalletController::class, 'pendingCount']);
// Feed
Route::get('/v2/feed', [\App\Http\Controllers\Api\SocialController::class, 'feedV2']);
Route::get('/v2/feed/posts/{id}', [\App\Http\Controllers\Api\SocialController::class, 'showPost']);
Route::get('/v2/feed/items/{type}/{id}', [\App\Http\Controllers\Api\SocialController::class, 'showItem'])
    ->where('type', '[a-z_]+')
    ->where('id', '[0-9]+');
Route::post('/v2/feed/posts', [\App\Http\Controllers\Api\SocialController::class, 'createPostV2']);
Route::post('/v2/feed/like', [\App\Http\Controllers\Api\SocialController::class, 'likeV2']);
Route::post('/v2/feed/polls', [\App\Http\Controllers\Api\SocialController::class, 'createPollV2']);
Route::get('/v2/feed/polls/{id}', [\App\Http\Controllers\Api\SocialController::class, 'getPollV2']);
Route::post('/v2/feed/polls/{id}/vote', [\App\Http\Controllers\Api\SocialController::class, 'votePollV2']);
Route::get('/v2/feed/posts/scheduled', [\App\Http\Controllers\Api\SocialController::class, 'scheduledPosts']);
Route::put('/v2/feed/posts/{id}', [\App\Http\Controllers\Api\SocialController::class, 'updatePostV2']);
Route::post('/v2/feed/posts/{id}/not-interested', [\App\Http\Controllers\Api\SocialController::class, 'notInterested']);
Route::post('/v2/feed/posts/{id}/hide', [\App\Http\Controllers\Api\SocialController::class, 'hidePostV2']);
Route::post('/v2/feed/posts/{id}/report', [\App\Http\Controllers\Api\SocialController::class, 'reportPostV2']);
Route::post('/v2/feed/items/{type}/{id}/report', [\App\Http\Controllers\Api\SocialController::class, 'reportItemV2'])
    ->where('type', '[a-z_]+')
    ->where('id', '[0-9]+');
Route::delete('/v2/feed/posts/{id}', [\App\Http\Controllers\Api\SocialController::class, 'deletePostV2']);
Route::post('/v2/feed/posts/{id}/delete', [\App\Http\Controllers\Api\SocialController::class, 'deletePostV2']); // deprecated: use DELETE /v2/feed/posts/{id}
Route::post('/v2/feed/users/{id}/mute', [\App\Http\Controllers\Api\SocialController::class, 'muteUserV2']);
Route::post('/v2/feed/posts/{id}/impression', [\App\Http\Controllers\Api\SocialController::class, 'recordImpression']);
Route::post('/v2/feed/posts/{id}/click', [\App\Http\Controllers\Api\SocialController::class, 'recordClick']);
// Polymorphic CTR tracking — covers listings, events, polls, etc. so EdgeRank
// gets click-through signal across every reactable feed surface.
Route::post('/v2/feed/impression', [\App\Http\Controllers\Api\SocialController::class, 'recordImpressionV2']);
Route::post('/v2/feed/click', [\App\Http\Controllers\Api\SocialController::class, 'recordClickV2']);
// Feed Sidebar
Route::get('/v2/community/stats', [\App\Http\Controllers\Api\FeedSidebarController::class, 'communityStats']);
Route::get('/v2/members/suggested', [\App\Http\Controllers\Api\FeedSidebarController::class, 'suggestedMembers']);
Route::get('/v2/feed/sidebar', [\App\Http\Controllers\Api\FeedSidebarController::class, 'sidebar']);
// Feed Sharing & Hashtags
Route::post('/v2/feed/posts/{id}/share', [\App\Http\Controllers\Api\FeedSocialController::class, 'sharePost']);
Route::delete('/v2/feed/posts/{id}/share', [\App\Http\Controllers\Api\FeedSocialController::class, 'unsharePost']);
Route::get('/v2/feed/posts/{id}/sharers', [\App\Http\Controllers\Api\FeedSocialController::class, 'getSharers']);
// Polymorphic share endpoints — body: { type, id, comment? }
Route::post('/v2/shares', [\App\Http\Controllers\Api\FeedSocialController::class, 'share']);
Route::delete('/v2/shares', [\App\Http\Controllers\Api\FeedSocialController::class, 'unshare']);
Route::get('/v2/feed/hashtags/trending', [\App\Http\Controllers\Api\FeedSocialController::class, 'getTrendingHashtags']);
Route::get('/v2/feed/hashtags/search', [\App\Http\Controllers\Api\FeedSocialController::class, 'searchHashtags']);
Route::get('/v2/feed/hashtags/{tag}', [\App\Http\Controllers\Api\FeedSocialController::class, 'getHashtagPosts']);
// Reactions — polymorphic (canonical) + legacy aliases
//   Reactions are polymorphic: post, listing, event, goal, poll, review,
//   volunteer, challenge, resource, comment.
Route::post('/v2/reactions', [\App\Http\Controllers\Api\ReactionController::class, 'toggle']);
Route::get('/v2/reactions/{type}/{id}', [\App\Http\Controllers\Api\ReactionController::class, 'show']);
Route::get('/v2/reactions/{type}/{id}/users/{reactionType}', [\App\Http\Controllers\Api\ReactionController::class, 'reactors']);
// Legacy aliases (kept for backward compatibility — delegate to polymorphic impl)
Route::post('/v2/posts/{id}/reactions', [\App\Http\Controllers\Api\ReactionController::class, 'togglePostReaction']);
Route::get('/v2/posts/{id}/reactions', [\App\Http\Controllers\Api\ReactionController::class, 'getPostReactions']);
Route::get('/v2/posts/{id}/reactions/{type}/users', [\App\Http\Controllers\Api\ReactionController::class, 'getPostReactors']);
Route::post('/v2/comments/{id}/reactions', [\App\Http\Controllers\Api\ReactionController::class, 'toggleCommentReaction']);
Route::get('/v2/comments/{id}/reactions', [\App\Http\Controllers\Api\ReactionController::class, 'getCommentReactions']);
// Link Previews
Route::get('/v2/link-preview', [\App\Http\Controllers\Api\LinkPreviewController::class, 'show']);
Route::post('/v2/link-preview', [\App\Http\Controllers\Api\LinkPreviewController::class, 'fetch']);
// Post Media (carousel / multi-image)
Route::post('/v2/posts/{id}/media', [\App\Http\Controllers\Api\PostMediaController::class, 'uploadMedia'])->middleware('throttle:nexus-route-20-per-1m');
Route::put('/v2/posts/{id}/media/reorder', [\App\Http\Controllers\Api\PostMediaController::class, 'reorderMedia']);
Route::delete('/v2/posts/media/{mediaId}', [\App\Http\Controllers\Api\PostMediaController::class, 'removeMedia']);
Route::put('/v2/posts/media/{mediaId}/alt', [\App\Http\Controllers\Api\PostMediaController::class, 'updateAltText']);
// Post Views & Analytics
Route::post('/v2/feed/posts/{id}/view', [\App\Http\Controllers\Api\PostAnalyticsController::class, 'recordView']);
Route::get('/v2/feed/posts/{id}/analytics', [\App\Http\Controllers\Api\PostAnalyticsController::class, 'analytics']);
// Bookmarks / Save Collections
Route::post('/v2/bookmarks', [\App\Http\Controllers\Api\BookmarkController::class, 'toggle']);
Route::get('/v2/bookmarks', [\App\Http\Controllers\Api\BookmarkController::class, 'index']);
Route::get('/v2/bookmarks/status', [\App\Http\Controllers\Api\BookmarkController::class, 'status']);
Route::post('/v2/bookmarks/{id}/move', [\App\Http\Controllers\Api\BookmarkController::class, 'move']);
Route::get('/v2/bookmark-collections', [\App\Http\Controllers\Api\BookmarkController::class, 'collections']);
Route::post('/v2/bookmark-collections', [\App\Http\Controllers\Api\BookmarkController::class, 'createCollection']);
Route::match(['patch', 'put'], '/v2/bookmark-collections/{id}', [\App\Http\Controllers\Api\BookmarkController::class, 'updateCollection']);
Route::delete('/v2/bookmark-collections/{id}', [\App\Http\Controllers\Api\BookmarkController::class, 'deleteCollection']);
// Notifications
Route::get('/v2/notifications', [\App\Http\Controllers\Api\NotificationsController::class, 'index']);
Route::get('/v2/notifications/grouped', [\App\Http\Controllers\Api\NotificationsController::class, 'grouped']);
Route::get('/v2/notifications/counts', [\App\Http\Controllers\Api\NotificationsController::class, 'counts']);
Route::post('/v2/notifications/group/read', [\App\Http\Controllers\Api\NotificationsController::class, 'markGroupRead']);
Route::post('/v2/notifications/group/{groupKey}/read', [\App\Http\Controllers\Api\NotificationsController::class, 'markGroupRead']);
Route::post('/v2/notifications/read-all', [\App\Http\Controllers\Api\NotificationsController::class, 'markAllRead']);
Route::delete('/v2/notifications', [\App\Http\Controllers\Api\NotificationsController::class, 'destroyAll']);
// Per-context notification frequency settings (digest). Must be registered
// BEFORE /v2/notifications/{id} or 'settings' is swallowed as an {id}.
Route::get('/v2/notifications/settings', [\App\Http\Controllers\Api\UsersController::class, 'getSettings']);
Route::post('/v2/notifications/settings', [\App\Http\Controllers\Api\UsersController::class, 'updateSettings']);
Route::get('/v2/notifications/{id}', [\App\Http\Controllers\Api\NotificationsController::class, 'show']);
Route::post('/v2/notifications/{id}/read', [\App\Http\Controllers\Api\NotificationsController::class, 'markRead']);
Route::delete('/v2/notifications/{id}', [\App\Http\Controllers\Api\NotificationsController::class, 'destroy']);
// Reviews
Route::get('/v2/reviews/pending', [\App\Http\Controllers\Api\ReviewsController::class, 'pending']);
// Registered BEFORE /v2/reviews/{id} so 'given' is not swallowed as an {id}.
Route::get('/v2/reviews/given', [\App\Http\Controllers\Api\ReviewsController::class, 'given']);
Route::get('/v2/reviews/user/{userId}', [\App\Http\Controllers\Api\ReviewsController::class, 'userReviews']);
Route::get('/v2/users/{userId}/reviews', [\App\Http\Controllers\Api\ReviewsController::class, 'userReviews']);
Route::get('/v2/reviews/user/{userId}/stats', [\App\Http\Controllers\Api\ReviewsController::class, 'userStats']);

Route::get('/v2/reviews/{id}', [\App\Http\Controllers\Api\ReviewsController::class, 'show']);
Route::post('/v2/reviews', [\App\Http\Controllers\Api\ReviewsController::class, 'store']);
Route::delete('/v2/reviews/{id}', [\App\Http\Controllers\Api\ReviewsController::class, 'destroy']);
// Search
Route::get('/v2/search', [\App\Http\Controllers\Api\SearchController::class, 'index']);
Route::get('/v2/search/suggestions', [\App\Http\Controllers\Api\SearchController::class, 'suggestions']);
Route::get('/v2/search/saved', [\App\Http\Controllers\Api\SearchController::class, 'savedSearches']);
Route::post('/v2/search/saved', [\App\Http\Controllers\Api\SearchController::class, 'saveSearch']);
Route::delete('/v2/search/saved/{id}', [\App\Http\Controllers\Api\SearchController::class, 'deleteSavedSearch']);
Route::post('/v2/search/saved/{id}/run', [\App\Http\Controllers\Api\SearchController::class, 'runSavedSearch']);
Route::get('/v2/search/trending', [\App\Http\Controllers\Api\SearchController::class, 'trending']);
// Metrics
Route::post('/v2/metrics', [\App\Http\Controllers\Api\MetricsController::class, 'store']);
Route::get('/v2/metrics/summary', [\App\Http\Controllers\Api\MetricsController::class, 'summary']);
// Polls
Route::get('/v2/polls', [\App\Http\Controllers\Api\PollsController::class, 'index']);
Route::post('/v2/polls', [\App\Http\Controllers\Api\PollsController::class, 'store']);
Route::get('/v2/polls/categories', [\App\Http\Controllers\Api\PollsController::class, 'categories']);
Route::get('/v2/polls/{id}', [\App\Http\Controllers\Api\PollsController::class, 'show']);
Route::put('/v2/polls/{id}', [\App\Http\Controllers\Api\PollsController::class, 'update']);
Route::delete('/v2/polls/{id}', [\App\Http\Controllers\Api\PollsController::class, 'destroy']);
Route::post('/v2/polls/{id}/vote', [\App\Http\Controllers\Api\PollsController::class, 'vote']);
Route::post('/v2/polls/{id}/rank', [\App\Http\Controllers\Api\PollsController::class, 'rank']);
Route::get('/v2/polls/{id}/ranked-results', [\App\Http\Controllers\Api\PollsController::class, 'rankedResults']);
Route::get('/v2/polls/{id}/export', [\App\Http\Controllers\Api\PollsController::class, 'export']);

// ============================================
// MIGRATED ROUTES — Content (Jobs, Ideation, Goals, Gamification, Volunteering, Comments, Blog, Help, Pages, Resources, KB)
// Source: httpdocs/routes/content.php
// ============================================
Route::get('/v2/jobs', [\App\Http\Controllers\Api\JobVacanciesController::class, 'index']);
Route::post('/v2/jobs', [\App\Http\Controllers\Api\JobVacanciesController::class, 'store']);
Route::get('/v2/jobs/recommended', [\App\Http\Controllers\Api\JobVacanciesController::class, 'recommended']);
Route::get('/v2/jobs/applications/{id}/cv', [\App\Http\Controllers\Api\JobVacanciesController::class, 'downloadCv']);
Route::get('/v2/jobs/saved', [\App\Http\Controllers\Api\JobVacanciesController::class, 'savedJobs']);
Route::get('/v2/jobs/my-applications', [\App\Http\Controllers\Api\JobVacanciesController::class, 'myApplications']);
Route::get('/v2/jobs/my-postings', [\App\Http\Controllers\Api\JobVacanciesController::class, 'myPostings']);
// AI description generator + duplicate detection (Agent A)
Route::post('/v2/jobs/generate-description', [\App\Http\Controllers\Api\JobVacanciesController::class, 'generateDescription']);
Route::post('/v2/jobs/check-duplicate', [\App\Http\Controllers\Api\JobVacanciesController::class, 'checkDuplicate']);
// Talent search (Agent C)
Route::get('/v2/jobs/talent-search', [\App\Http\Controllers\Api\JobVacanciesController::class, 'talentSearch']);
Route::get('/v2/jobs/talent-search/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'talentProfile']);
Route::get('/v2/jobs/alerts', [\App\Http\Controllers\Api\JobVacanciesController::class, 'listAlerts']);
Route::post('/v2/jobs/alerts', [\App\Http\Controllers\Api\JobVacanciesController::class, 'createAlert']);
Route::delete('/v2/jobs/alerts/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'deleteAlert']);
Route::put('/v2/jobs/alerts/{id}/unsubscribe', [\App\Http\Controllers\Api\JobVacanciesController::class, 'unsubscribeAlert']);
Route::put('/v2/jobs/alerts/{id}/resubscribe', [\App\Http\Controllers\Api\JobVacanciesController::class, 'resubscribeAlert']);
// Employer reviews
Route::get('/v2/jobs/employer-reviews/{userId}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'employerReviews']);
Route::post('/v2/jobs/employer-reviews', [\App\Http\Controllers\Api\JobVacanciesController::class, 'createEmployerReview']);
// Saved profile — static literal routes BEFORE {id} wildcard
Route::get('/v2/jobs/saved-profile', [\App\Http\Controllers\Api\JobVacanciesController::class, 'getSavedProfile']);
Route::put('/v2/jobs/saved-profile', [\App\Http\Controllers\Api\JobVacanciesController::class, 'saveSavedProfile']);
// Job templates
Route::get('/v2/jobs/templates', [\App\Http\Controllers\Api\JobVacanciesController::class, 'listTemplates']);
Route::post('/v2/jobs/templates', [\App\Http\Controllers\Api\JobVacanciesController::class, 'createTemplate']);
Route::get('/v2/jobs/templates/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'getTemplate']);
Route::delete('/v2/jobs/templates/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'deleteTemplate']);
// Offer letter templates (static routes before {id} wildcard)
Route::get('/v2/jobs/offer-templates', [\App\Http\Controllers\Api\JobVacanciesController::class, 'offerTemplates']);
Route::post('/v2/jobs/offer-templates', [\App\Http\Controllers\Api\JobVacanciesController::class, 'createOfferTemplate']);
Route::delete('/v2/jobs/offer-templates/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'deleteOfferTemplate']);
Route::post('/v2/jobs/offer-templates/{id}/render', [\App\Http\Controllers\Api\JobVacanciesController::class, 'renderOfferTemplate']);
// Salary benchmark lookup
Route::get('/v2/jobs/salary-benchmark', [\App\Http\Controllers\Api\JobVacanciesController::class, 'salaryBenchmark']);
// GDPR — static literal routes before {id} wildcard
Route::get('/v2/jobs/gdpr-export', [\App\Http\Controllers\Api\JobVacanciesController::class, 'gdprExport']);
Route::delete('/v2/jobs/gdpr-erase-me', [\App\Http\Controllers\Api\JobVacanciesController::class, 'gdprErase']);
// Pipeline rules
Route::get('/v2/jobs/{id}/pipeline-rules', [\App\Http\Controllers\Api\JobVacanciesController::class, 'listPipelineRules']);
Route::post('/v2/jobs/{id}/pipeline-rules', [\App\Http\Controllers\Api\JobVacanciesController::class, 'createPipelineRule']);
Route::delete('/v2/jobs/pipeline-rules/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'deletePipelineRule']);
Route::post('/v2/jobs/{id}/pipeline-rules/run', [\App\Http\Controllers\Api\JobVacanciesController::class, 'runPipelineRules']);
// Bulk application actions
Route::post('/v2/jobs/{id}/applications/bulk-status', [\App\Http\Controllers\Api\JobVacanciesController::class, 'bulkUpdateApplicationStatus']);
// AI candidate ranking
Route::post('/v2/jobs/{id}/ai-rank', [\App\Http\Controllers\Api\JobVacanciesController::class, 'aiRankCandidates']);
// Static literal routes MUST come before {id} wildcard to avoid mismatching
Route::get('/v2/jobs/my-interviews', [\App\Http\Controllers\Api\JobVacanciesController::class, 'myInterviews']);
Route::get('/v2/jobs/my-offers', [\App\Http\Controllers\Api\JobVacanciesController::class, 'myOffers']);
Route::get('/v2/jobs/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'show']);
Route::put('/v2/jobs/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'update']);
Route::delete('/v2/jobs/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'destroy']);
Route::post('/v2/jobs/{id}/apply', [\App\Http\Controllers\Api\JobVacanciesController::class, 'apply']);
Route::post('/v2/jobs/{id}/save', [\App\Http\Controllers\Api\JobVacanciesController::class, 'saveJob']);
Route::delete('/v2/jobs/{id}/save', [\App\Http\Controllers\Api\JobVacanciesController::class, 'unsaveJob']);
Route::get('/v2/jobs/{id}/match', [\App\Http\Controllers\Api\JobVacanciesController::class, 'matchPercentage']);
Route::get('/v2/jobs/{id}/qualified', [\App\Http\Controllers\Api\JobVacanciesController::class, 'qualificationAssessment']);
Route::get('/v2/jobs/{id}/applications', [\App\Http\Controllers\Api\JobVacanciesController::class, 'applications']);
Route::get('/v2/jobs/{id}/applications/export-csv', [\App\Http\Controllers\Api\JobVacanciesController::class, 'exportApplicationsCsv']);
Route::get('/v2/jobs/{id}/analytics', [\App\Http\Controllers\Api\JobVacanciesController::class, 'analytics']);
Route::post('/v2/jobs/{id}/renew', [\App\Http\Controllers\Api\JobVacanciesController::class, 'renewJob']);
Route::post('/v2/jobs/{id}/feature', [\App\Http\Controllers\Api\JobVacanciesController::class, 'featureJob']);
Route::delete('/v2/jobs/{id}/feature', [\App\Http\Controllers\Api\JobVacanciesController::class, 'unfeatureJob']);
Route::put('/v2/jobs/applications/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'updateApplication']);
Route::get('/v2/jobs/applications/{id}/history', [\App\Http\Controllers\Api\JobVacanciesController::class, 'applicationHistory']);
// Interviews
Route::post('/v2/jobs/applications/{id}/interview', [\App\Http\Controllers\Api\JobVacanciesController::class, 'proposeInterview']);
Route::put('/v2/jobs/interviews/{id}/accept', [\App\Http\Controllers\Api\JobVacanciesController::class, 'acceptInterview']);
Route::put('/v2/jobs/interviews/{id}/decline', [\App\Http\Controllers\Api\JobVacanciesController::class, 'declineInterview']);
Route::delete('/v2/jobs/interviews/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'cancelInterview']);
// Interview calendar export
Route::get('/v2/jobs/interviews/{interviewId}/calendar', [\App\Http\Controllers\Api\JobVacanciesController::class, 'interviewCalendar']);
Route::get('/v2/jobs/interviews/{interviewId}/calendar-links', [\App\Http\Controllers\Api\JobVacanciesController::class, 'interviewCalendarLinks']);
Route::get('/v2/jobs/{id}/interviews', [\App\Http\Controllers\Api\JobVacanciesController::class, 'getInterviews']);
// Offers
Route::post('/v2/jobs/applications/{id}/offer', [\App\Http\Controllers\Api\JobVacanciesController::class, 'createOffer']);
Route::put('/v2/jobs/offers/{id}/accept', [\App\Http\Controllers\Api\JobVacanciesController::class, 'acceptOffer']);
Route::put('/v2/jobs/offers/{id}/reject', [\App\Http\Controllers\Api\JobVacanciesController::class, 'rejectOffer']);
Route::delete('/v2/jobs/offers/{id}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'withdrawOffer']);
Route::get('/v2/jobs/applications/{id}/offer', [\App\Http\Controllers\Api\JobVacanciesController::class, 'getApplicationOffer']);
// AI CV parsing
Route::get('/v2/jobs/applications/{id}/parse-cv', [\App\Http\Controllers\Api\JobVacanciesController::class, 'parseResumeCv']);
// Referrals
Route::post('/v2/jobs/{id}/referral', [\App\Http\Controllers\Api\JobVacanciesController::class, 'getOrCreateReferral']);
Route::get('/v2/jobs/{id}/referral-stats', [\App\Http\Controllers\Api\JobVacanciesController::class, 'referralStats']);
// Scorecards
Route::put('/v2/jobs/applications/{id}/scorecard', [\App\Http\Controllers\Api\JobVacanciesController::class, 'upsertScorecard']);
Route::get('/v2/jobs/applications/{id}/scorecards', [\App\Http\Controllers\Api\JobVacanciesController::class, 'getScorecards']);
// Hiring team
Route::get('/v2/jobs/{id}/team', [\App\Http\Controllers\Api\JobVacanciesController::class, 'getTeam']);
Route::post('/v2/jobs/{id}/team', [\App\Http\Controllers\Api\JobVacanciesController::class, 'addTeamMember']);
Route::delete('/v2/jobs/{id}/team/{userId}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'removeTeamMember']);
// Interview self-scheduling slots (Agent E)
Route::get('/v2/jobs/{id}/interview-slots', [\App\Http\Controllers\Api\JobVacanciesController::class, 'listInterviewSlots']);
Route::post('/v2/jobs/{id}/interview-slots', [\App\Http\Controllers\Api\JobVacanciesController::class, 'createInterviewSlots']);
Route::post('/v2/jobs/{id}/interview-slots/bulk', [\App\Http\Controllers\Api\JobVacanciesController::class, 'bulkCreateInterviewSlots']);
Route::post('/v2/jobs/interview-slots/{slotId}/book', [\App\Http\Controllers\Api\JobVacanciesController::class, 'bookInterviewSlot']);
Route::delete('/v2/jobs/interview-slots/{slotId}/book', [\App\Http\Controllers\Api\JobVacanciesController::class, 'cancelInterviewSlotBooking']);
Route::delete('/v2/jobs/interview-slots/{slotId}', [\App\Http\Controllers\Api\JobVacanciesController::class, 'deleteInterviewSlot']);
// Job audit trail
Route::get('/v2/jobs/{id}/audit-trail', [\App\Http\Controllers\Api\JobVacanciesController::class, 'auditTrail']);
Route::post('/v2/jobs/{id}/ai-chat', [\App\Http\Controllers\Api\JobVacanciesController::class, 'aiJobChat']);
Route::get('/v2/jobs/{id}/predictions', [\App\Http\Controllers\Api\JobVacanciesController::class, 'predictions']);
Route::get('/v2/ideation-challenges', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'index']);
Route::post('/v2/ideation-challenges', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'store']);
Route::get('/v2/ideation-ideas/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'showIdea']);
Route::put('/v2/ideation-ideas/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'updateIdea']);
Route::put('/v2/ideation-ideas/{id}/draft', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'updateDraft']);
Route::delete('/v2/ideation-ideas/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'deleteIdea']);
Route::post('/v2/ideation-ideas/{id}/vote', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'voteIdea']);
Route::put('/v2/ideation-ideas/{id}/status', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'updateIdeaStatus']);
Route::get('/v2/ideation-ideas/{id}/comments', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'comments']);
Route::post('/v2/ideation-ideas/{id}/comments', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'addComment']);
Route::delete('/v2/ideation-comments/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'deleteComment']);
Route::get('/v2/ideation-challenges/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'show']);
Route::put('/v2/ideation-challenges/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'update']);
Route::delete('/v2/ideation-challenges/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'destroy']);
Route::put('/v2/ideation-challenges/{id}/status', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'updateStatus']);
Route::get('/v2/ideation-challenges/{id}/ideas/drafts', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'ideaDrafts']);
Route::get('/v2/ideation-challenges/{id}/ideas', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'ideas']);
Route::post('/v2/ideation-challenges/{id}/ideas', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'submitIdea']);
Route::post('/v2/ideation-challenges/{id}/favorite', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'toggleFavorite']);
Route::post('/v2/ideation-challenges/{id}/duplicate', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'duplicate']);
Route::post('/v2/ideation-ideas/{id}/convert-to-group', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'convertToGroup']);
Route::get('/v2/goals', [\App\Http\Controllers\Api\GoalsController::class, 'index']);
Route::post('/v2/goals', [\App\Http\Controllers\Api\GoalsController::class, 'store']);
Route::get('/v2/goals/discover', [\App\Http\Controllers\Api\GoalsController::class, 'discover']);
Route::get('/v2/goals/mentoring', [\App\Http\Controllers\Api\GoalsController::class, 'mentoring']);
Route::get('/v2/goals/templates', [\App\Http\Controllers\Api\GoalsController::class, 'templates']);
Route::get('/v2/goals/templates/categories', [\App\Http\Controllers\Api\GoalsController::class, 'templateCategories']);
Route::post('/v2/goals/templates', [\App\Http\Controllers\Api\GoalsController::class, 'createTemplate']);
Route::post('/v2/goals/from-template/{templateId}', [\App\Http\Controllers\Api\GoalsController::class, 'createFromTemplate']);
Route::get('/v2/goals/{id}', [\App\Http\Controllers\Api\GoalsController::class, 'show']);
Route::put('/v2/goals/{id}', [\App\Http\Controllers\Api\GoalsController::class, 'update']);
Route::delete('/v2/goals/{id}', [\App\Http\Controllers\Api\GoalsController::class, 'destroy']);
Route::post('/v2/goals/{id}/progress', [\App\Http\Controllers\Api\GoalsController::class, 'progress']);
Route::post('/v2/goals/{id}/buddy', [\App\Http\Controllers\Api\GoalsController::class, 'buddy']);
Route::post('/v2/goals/{id}/buddy/nudge', [\App\Http\Controllers\Api\GoalsController::class, 'buddyNudge']);
Route::post('/v2/goals/{id}/complete', [\App\Http\Controllers\Api\GoalsController::class, 'complete']);
Route::get('/v2/goals/{id}/checkins', [\App\Http\Controllers\Api\GoalsController::class, 'listCheckins']);
Route::post('/v2/goals/{id}/checkins', [\App\Http\Controllers\Api\GoalsController::class, 'createCheckin']);
Route::get('/v2/goals/{id}/history', [\App\Http\Controllers\Api\GoalsController::class, 'history']);
Route::get('/v2/goals/{id}/history/summary', [\App\Http\Controllers\Api\GoalsController::class, 'historySummary']);
Route::get('/v2/goals/{id}/insights', [\App\Http\Controllers\Api\GoalsController::class, 'insights']);
Route::get('/v2/goals/{id}/reminder', [\App\Http\Controllers\Api\GoalsController::class, 'getReminder']);
Route::put('/v2/goals/{id}/reminder', [\App\Http\Controllers\Api\GoalsController::class, 'setReminder']);
Route::delete('/v2/goals/{id}/reminder', [\App\Http\Controllers\Api\GoalsController::class, 'deleteReminder']);
Route::get('/v2/gamification/profile', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'profile']);
Route::get('/v2/gamification/badges', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'badges']);
Route::get('/v2/gamification/badges/{key}', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'showBadge']);
Route::get('/v2/gamification/leaderboard', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'leaderboard']);
Route::get('/v2/gamification/challenges', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'challenges']);
Route::get('/v2/gamification/collections', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'collections']);
Route::get('/v2/gamification/daily-reward', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'dailyRewardStatus']);
Route::post('/v2/gamification/daily-reward', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'claimDailyReward']);
Route::get('/v2/gamification/shop', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'shop']);
Route::post('/v2/gamification/shop/purchase', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'purchase']);
Route::put('/v2/gamification/showcase', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'updateShowcase']);
Route::get('/v2/gamification/seasons', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'seasons']);
Route::get('/v2/gamification/seasons/current', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'currentSeason']);
Route::post('/v2/gamification/challenges/{id}/claim', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'claimChallenge']);
Route::get('/v2/gamification/nexus-score', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'nexusScore']);
Route::get('/v2/gamification/community-dashboard', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'communityDashboard']);
Route::get('/v2/gamification/personal-journey', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'personalJourney']);
Route::get('/v2/gamification/member-spotlight', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'memberSpotlight']);
Route::get('/v2/gamification/engagement-history', [\App\Http\Controllers\Api\GamificationV2Controller::class, 'engagementHistory']);
Route::get('/v2/volunteering/opportunities', [\App\Http\Controllers\Api\VolunteerController::class, 'opportunities']);
Route::post('/v2/volunteering/opportunities', [\App\Http\Controllers\Api\VolunteerController::class, 'createOpportunity']);
Route::get('/v2/volunteering/opportunities/{id}', [\App\Http\Controllers\Api\VolunteerController::class, 'showOpportunity']);
Route::put('/v2/volunteering/opportunities/{id}', [\App\Http\Controllers\Api\VolunteerController::class, 'updateOpportunity']);
Route::delete('/v2/volunteering/opportunities/{id}', [\App\Http\Controllers\Api\VolunteerController::class, 'deleteOpportunity']);
Route::get('/v2/volunteering/opportunities/{id}/shifts', [\App\Http\Controllers\Api\VolunteerController::class, 'shifts']);
Route::get('/v2/volunteering/opportunities/{id}/applications', [\App\Http\Controllers\Api\VolunteerController::class, 'opportunityApplications']);
Route::post('/v2/volunteering/opportunities/{id}/apply', [\App\Http\Controllers\Api\VolunteerController::class, 'apply']);
Route::get('/v2/volunteering/applications', [\App\Http\Controllers\Api\VolunteerController::class, 'myApplications']);
Route::put('/v2/volunteering/applications/{id}', [\App\Http\Controllers\Api\VolunteerController::class, 'handleApplication']);
Route::delete('/v2/volunteering/applications/{id}', [\App\Http\Controllers\Api\VolunteerController::class, 'withdrawApplication']);
Route::get('/v2/volunteering/shifts', [\App\Http\Controllers\Api\VolunteerController::class, 'myShifts']);
Route::post('/v2/volunteering/shifts/{id}/signup', [\App\Http\Controllers\Api\VolunteerController::class, 'signUp']);
Route::delete('/v2/volunteering/shifts/{id}/signup', [\App\Http\Controllers\Api\VolunteerController::class, 'cancelSignup']);
Route::get('/v2/volunteering/hours', [\App\Http\Controllers\Api\VolunteerController::class, 'myHours']);
Route::post('/v2/volunteering/hours', [\App\Http\Controllers\Api\VolunteerController::class, 'logHours']);
Route::get('/v2/volunteering/hours/summary', [\App\Http\Controllers\Api\VolunteerController::class, 'hoursSummary']);
Route::get('/v2/volunteering/hours/pending-review', [\App\Http\Controllers\Api\VolunteerController::class, 'pendingHoursReview']);
Route::put('/v2/volunteering/hours/{id}/verify', [\App\Http\Controllers\Api\VolunteerController::class, 'verifyHours']);
Route::get('/v2/volunteering/my-organisations', [\App\Http\Controllers\Api\VolunteerController::class, 'myOrganisations']);
Route::get('/v2/volunteering/organisations', [\App\Http\Controllers\Api\VolunteerController::class, 'organisations']);
Route::post('/v2/volunteering/organisations', [\App\Http\Controllers\Api\VolunteerController::class, 'createOrganisation']);
Route::get('/v2/volunteering/organisations/{id}', [\App\Http\Controllers\Api\VolunteerController::class, 'showOrganisation']);
// Organisation dashboard & wallet endpoints (org owner/admin only)
//
// Authorization enforced via VolunteerController::ensureOrgAccess() per-org
// ownership check (tenant scope + org.user_id creator OR org_members.role IN
// ('owner','admin') OR platform super_admin/god). This is NOT the platform
// `admin` middleware — that would gate by platform role, which is a different
// scope. Per-org gating must live in the controller so non-admin org owners
// retain access to their own org dashboards. Returns 403 when access denied.
// See app/Http/Controllers/Api/VolunteerController.php :: ensureOrgAccess().
Route::get('/v2/volunteering/organisations/{id}/stats', [\App\Http\Controllers\Api\VolunteerController::class, 'orgStats']);
Route::get('/v2/volunteering/organisations/{id}/wallet', [\App\Http\Controllers\Api\VolunteerController::class, 'orgWalletBalance']);
Route::get('/v2/volunteering/organisations/{id}/wallet/transactions', [\App\Http\Controllers\Api\VolunteerController::class, 'orgWalletTransactions']);
Route::post('/v2/volunteering/organisations/{id}/wallet/deposit', [\App\Http\Controllers\Api\VolunteerController::class, 'orgWalletDeposit']);
Route::get('/v2/volunteering/organisations/{id}/volunteers', [\App\Http\Controllers\Api\VolunteerController::class, 'orgVolunteers']);
Route::get('/v2/volunteering/organisations/{id}/applications', [\App\Http\Controllers\Api\VolunteerController::class, 'orgApplications']);
Route::get('/v2/volunteering/organisations/{id}/hours/pending', [\App\Http\Controllers\Api\VolunteerController::class, 'orgHoursPending']);
Route::put('/v2/volunteering/organisations/{id}', [\App\Http\Controllers\Api\VolunteerController::class, 'updateOrganisation']);
Route::post('/v2/volunteering/reviews', [\App\Http\Controllers\Api\VolunteerController::class, 'createReview']);
Route::get('/v2/volunteering/reviews/organization/{id}', [\App\Http\Controllers\Api\VolunteerController::class, 'getOrganizationReviews']);
Route::get('/v2/volunteering/reviews/{type}/{id}', [\App\Http\Controllers\Api\VolunteerController::class, 'getReviews']);
Route::get('/v2/comments', [\App\Http\Controllers\Api\CommentsController::class, 'index']);
Route::post('/v2/comments', [\App\Http\Controllers\Api\CommentsController::class, 'store']);
Route::put('/v2/comments/{id}', [\App\Http\Controllers\Api\CommentsController::class, 'update']);
Route::delete('/v2/comments/{id}', [\App\Http\Controllers\Api\CommentsController::class, 'destroy']);
// Note: POST /v2/comments/{id}/reactions is handled by ReactionController (line ~354)
Route::get('/v2/mentions/search', [\App\Http\Controllers\Api\MentionController::class, 'search']);
Route::get('/v2/mentions/me', [\App\Http\Controllers\Api\MentionController::class, 'myMentions']);
Route::get('/v2/blog', [\App\Http\Controllers\Api\BlogPublicController::class, 'index'])->withoutMiddleware('auth:sanctum');
Route::get('/v2/blog/categories', [\App\Http\Controllers\Api\BlogPublicController::class, 'categories'])->withoutMiddleware('auth:sanctum');
Route::get('/v2/blog/{slug}', [\App\Http\Controllers\Api\BlogPublicController::class, 'show'])->withoutMiddleware('auth:sanctum');
Route::get('/v2/help/faqs', [\App\Http\Controllers\Api\HelpController::class, 'getFaqs'])->withoutMiddleware('auth:sanctum');
Route::get('/v2/public-changelog', [\App\Http\Controllers\Api\PublicChangelogController::class, 'index'])
    ->withoutMiddleware('auth:sanctum');
Route::get('/v2/public-static-route-content/{pageKey}', [\App\Http\Controllers\Api\PublicStaticRouteContentController::class, 'show'])
    ->where('pageKey', '[a-z0-9-]+')
    ->withoutMiddleware('auth:sanctum');
Route::get('/v2/public-page-content/{pageKey}', [\App\Http\Controllers\Api\StaticPublicPageController::class, 'show'])
    ->where('pageKey', '[a-z0-9-]+')
    ->withoutMiddleware('auth:sanctum');
Route::get('/v2/pages/{slug}', [\App\Http\Controllers\Api\PagesPublicController::class, 'show'])->withoutMiddleware('auth:sanctum');
Route::get('/v2/resources', [\App\Http\Controllers\Api\ResourcePublicController::class, 'index']);
Route::get('/v2/resources/categories', [\App\Http\Controllers\Api\ResourcePublicController::class, 'categories']);
Route::get('/v2/resources/categories/tree', [\App\Http\Controllers\Api\ResourceCategoryController::class, 'tree']);
Route::post('/v2/resources/categories', [\App\Http\Controllers\Api\ResourceCategoryController::class, 'store'])->middleware('admin');
Route::put('/v2/resources/categories/{id}', [\App\Http\Controllers\Api\ResourceCategoryController::class, 'update'])->middleware('admin');
Route::delete('/v2/resources/categories/{id}', [\App\Http\Controllers\Api\ResourceCategoryController::class, 'destroy'])->middleware('admin');
Route::put('/v2/resources/reorder', [\App\Http\Controllers\Api\ResourceCategoryController::class, 'reorder'])->middleware('admin');
Route::post('/v2/resources', [\App\Http\Controllers\Api\ResourcePublicController::class, 'store']);
Route::get('/v2/resources/{id}/download', [\App\Http\Controllers\Api\ResourcePublicController::class, 'download']);
Route::put('/v2/resources/{id}', [\App\Http\Controllers\Api\ResourcePublicController::class, 'update']);
Route::delete('/v2/resources/{id}', [\App\Http\Controllers\Api\ResourcePublicController::class, 'destroy']);
Route::get('/v2/kb', [\App\Http\Controllers\Api\KnowledgeBaseController::class, 'index']);
Route::get('/v2/kb/search', [\App\Http\Controllers\Api\KnowledgeBaseController::class, 'search']);
Route::post('/v2/kb', [\App\Http\Controllers\Api\KnowledgeBaseController::class, 'store']);
Route::get('/v2/kb/slug/{slug}', [\App\Http\Controllers\Api\KnowledgeBaseController::class, 'showBySlug']);
Route::get('/v2/kb/{id}', [\App\Http\Controllers\Api\KnowledgeBaseController::class, 'show']);
Route::put('/v2/kb/{id}', [\App\Http\Controllers\Api\KnowledgeBaseController::class, 'update']);
Route::delete('/v2/kb/{id}', [\App\Http\Controllers\Api\KnowledgeBaseController::class, 'destroy']);
Route::post('/v2/kb/{id}/feedback', [\App\Http\Controllers\Api\KnowledgeBaseController::class, 'feedback']);
Route::post('/v2/kb/{id}/attachments', [\App\Http\Controllers\Api\KnowledgeBaseController::class, 'uploadAttachment']);
Route::get('/v2/kb/{id}/attachments/{attachmentId}/download', [\App\Http\Controllers\Api\KnowledgeBaseController::class, 'downloadAttachment']);
Route::delete('/v2/kb/{id}/attachments/{attachmentId}', [\App\Http\Controllers\Api\KnowledgeBaseController::class, 'deleteAttachment']);

// ============================================
// STORIES — 24-hour disappearing content
// ============================================
Route::get('/v2/stories', [\App\Http\Controllers\Api\StoryController::class, 'index']);
Route::get('/v2/stories/user/{userId}', [\App\Http\Controllers\Api\StoryController::class, 'userStories']);
Route::post('/v2/stories', [\App\Http\Controllers\Api\StoryController::class, 'store']);
Route::post('/v2/stories/{id}/view', [\App\Http\Controllers\Api\StoryController::class, 'view']);
Route::get('/v2/stories/{id}/viewers', [\App\Http\Controllers\Api\StoryController::class, 'viewers']);
Route::post('/v2/stories/{id}/react', [\App\Http\Controllers\Api\StoryController::class, 'react']);
Route::delete('/v2/stories/{id}', [\App\Http\Controllers\Api\StoryController::class, 'destroy']);
Route::post('/v2/stories/{id}/poll/vote', [\App\Http\Controllers\Api\StoryController::class, 'pollVote']);
Route::post('/v2/stories/{id}/reply', [\App\Http\Controllers\Api\StoryController::class, 'reply']);
Route::get('/v2/stories/highlights/{userId}', [\App\Http\Controllers\Api\StoryController::class, 'highlights']);
Route::get('/v2/stories/highlights/{id}/stories', [\App\Http\Controllers\Api\StoryController::class, 'highlightStories']);
Route::post('/v2/stories/highlights', [\App\Http\Controllers\Api\StoryController::class, 'createHighlight']);
Route::post('/v2/stories/highlights/{id}/items', [\App\Http\Controllers\Api\StoryController::class, 'addHighlightItem']);
Route::delete('/v2/stories/highlights/{id}', [\App\Http\Controllers\Api\StoryController::class, 'deleteHighlight']);
Route::put('/v2/stories/highlights/reorder', [\App\Http\Controllers\Api\StoryController::class, 'reorderHighlights']);
Route::put('/v2/stories/highlights/{id}', [\App\Http\Controllers\Api\StoryController::class, 'updateHighlight']);
Route::delete('/v2/stories/highlights/{id}/items/{storyId}', [\App\Http\Controllers\Api\StoryController::class, 'removeHighlightItem']);
Route::get('/v2/stories/archive', [\App\Http\Controllers\Api\StoryController::class, 'archive']);
Route::get('/v2/stories/close-friends', [\App\Http\Controllers\Api\StoryController::class, 'closeFriends']);
Route::post('/v2/stories/close-friends', [\App\Http\Controllers\Api\StoryController::class, 'addCloseFriend']);
Route::delete('/v2/stories/close-friends/{friendId}', [\App\Http\Controllers\Api\StoryController::class, 'removeCloseFriend']);
Route::post('/v2/stories/{id}/analytics', [\App\Http\Controllers\Api\StoryController::class, 'trackAnalytics']);
Route::get('/v2/stories/{id}/analytics', [\App\Http\Controllers\Api\StoryController::class, 'getAnalytics']);
Route::post('/v2/stories/{id}/stickers', [\App\Http\Controllers\Api\StoryController::class, 'saveStickers']);

// ============================================

// Stripe donation payment routes
Route::post('/v2/donations/payment-intent', [\App\Http\Controllers\Api\DonationPaymentController::class, 'createPaymentIntent']);
Route::get('/v2/donations/{id}/receipt', [\App\Http\Controllers\Api\DonationPaymentController::class, 'getDonationReceipt']);

// ============================================
// Marketplace Module — Authenticated routes
// Completely standalone from Listings (timebanking)
// ============================================

// Marketplace Listings — CRUD & management
Route::post('/v2/marketplace/listings', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'store']);
Route::put('/v2/marketplace/listings/{id}', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'update']);
Route::delete('/v2/marketplace/listings/{id}', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'destroy']);
Route::post('/v2/marketplace/listings/{id}/images', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'uploadImages'])->middleware('throttle:nexus-route-20-per-1m');
Route::put('/v2/marketplace/listings/{id}/images/reorder', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'reorderImages']);
Route::delete('/v2/marketplace/listings/{id}/images/{imageId}', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'deleteImage']);
Route::post('/v2/marketplace/listings/{id}/video', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'uploadVideo'])->middleware('throttle:nexus-route-10-per-1m');
Route::delete('/v2/marketplace/listings/{id}/video', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'deleteVideo']);
Route::post('/v2/marketplace/listings/{id}/renew', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'renew']);
Route::get('/v2/marketplace/listings/{id}/analytics', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'analytics']);
Route::post('/v2/marketplace/listings/generate-description', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'generateDescription']);

// Marketplace Listings — Saved/favorites
Route::get('/v2/marketplace/listings/saved', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'savedListings']);
Route::post('/v2/marketplace/listings/{id}/save', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'save']);
Route::delete('/v2/marketplace/listings/{id}/save', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'unsave']);

// Marketplace Offers — Negotiation
Route::post('/v2/marketplace/listings/{id}/offers', [\App\Http\Controllers\Api\MarketplaceOfferController::class, 'store']);
Route::get('/v2/marketplace/listings/{id}/offers', [\App\Http\Controllers\Api\MarketplaceOfferController::class, 'listForListing']);
Route::put('/v2/marketplace/offers/{id}/accept', [\App\Http\Controllers\Api\MarketplaceOfferController::class, 'accept']);
Route::put('/v2/marketplace/offers/{id}/decline', [\App\Http\Controllers\Api\MarketplaceOfferController::class, 'decline']);
Route::put('/v2/marketplace/offers/{id}/counter', [\App\Http\Controllers\Api\MarketplaceOfferController::class, 'counter']);
Route::put('/v2/marketplace/offers/{id}/accept-counter', [\App\Http\Controllers\Api\MarketplaceOfferController::class, 'acceptCounter']);
Route::delete('/v2/marketplace/offers/{id}', [\App\Http\Controllers\Api\MarketplaceOfferController::class, 'withdraw']);
Route::get('/v2/marketplace/my-offers/sent', [\App\Http\Controllers\Api\MarketplaceOfferController::class, 'sentOffers']);
Route::get('/v2/marketplace/my-offers/received', [\App\Http\Controllers\Api\MarketplaceOfferController::class, 'receivedOffers']);

// Marketplace Seller — Profile & dashboard
Route::post('/v2/marketplace/seller/profile', [\App\Http\Controllers\Api\MarketplaceSellerController::class, 'updateProfile']);
Route::get('/v2/marketplace/seller/dashboard', [\App\Http\Controllers\Api\MarketplaceSellerController::class, 'dashboard']);
Route::get('/v2/marketplace/seller/onboard/status', [\App\Http\Controllers\Api\MarketplaceSellerController::class, 'onboardStatus']);

// Marketplace Orders — Purchase lifecycle
Route::post('/v2/marketplace/orders', [\App\Http\Controllers\Api\MarketplaceOrderController::class, 'store']);
Route::get('/v2/marketplace/orders/purchases', [\App\Http\Controllers\Api\MarketplaceOrderController::class, 'purchases']);
Route::get('/v2/marketplace/orders/sales', [\App\Http\Controllers\Api\MarketplaceOrderController::class, 'sales']);
Route::get('/v2/marketplace/orders/{id}', [\App\Http\Controllers\Api\MarketplaceOrderController::class, 'show']);
Route::put('/v2/marketplace/orders/{id}/ship', [\App\Http\Controllers\Api\MarketplaceOrderController::class, 'ship']);
Route::put('/v2/marketplace/orders/{id}/confirm-delivery', [\App\Http\Controllers\Api\MarketplaceOrderController::class, 'confirmDelivery']);
Route::put('/v2/marketplace/orders/{id}/cancel', [\App\Http\Controllers\Api\MarketplaceOrderController::class, 'cancel']);
Route::post('/v2/marketplace/orders/{id}/rate', [\App\Http\Controllers\Api\MarketplaceOrderController::class, 'rate']);
Route::get('/v2/marketplace/orders/{id}/ratings', [\App\Http\Controllers\Api\MarketplaceOrderController::class, 'orderRatings']);
Route::post('/v2/marketplace/orders/{id}/dispute', [\App\Http\Controllers\Api\MarketplaceOrderController::class, 'dispute']);

// Marketplace Payments — Stripe Connect
Route::post('/v2/marketplace/payments/create-intent', [\App\Http\Controllers\Api\MarketplacePaymentController::class, 'createIntent']);
Route::post('/v2/marketplace/payments/confirm', [\App\Http\Controllers\Api\MarketplacePaymentController::class, 'confirm']);
Route::get('/v2/marketplace/payments/{id}/status', [\App\Http\Controllers\Api\MarketplacePaymentController::class, 'status']);
Route::get('/v2/marketplace/seller/payouts', [\App\Http\Controllers\Api\MarketplacePaymentController::class, 'payouts']);
Route::get('/v2/marketplace/seller/balance', [\App\Http\Controllers\Api\MarketplacePaymentController::class, 'balance']);
Route::post('/v2/marketplace/seller/onboard', [\App\Http\Controllers\Api\MarketplacePaymentController::class, 'onboard']);

// Marketplace Discovery — Saved searches & collections
Route::get('/v2/marketplace/saved-searches', [\App\Http\Controllers\Api\MarketplaceDiscoveryController::class, 'listSavedSearches']);
Route::post('/v2/marketplace/saved-searches', [\App\Http\Controllers\Api\MarketplaceDiscoveryController::class, 'storeSavedSearch']);
Route::delete('/v2/marketplace/saved-searches/{id}', [\App\Http\Controllers\Api\MarketplaceDiscoveryController::class, 'destroySavedSearch']);
Route::get('/v2/marketplace/collections', [\App\Http\Controllers\Api\MarketplaceDiscoveryController::class, 'listCollections']);
Route::post('/v2/marketplace/collections', [\App\Http\Controllers\Api\MarketplaceDiscoveryController::class, 'storeCollection']);
Route::put('/v2/marketplace/collections/{id}', [\App\Http\Controllers\Api\MarketplaceDiscoveryController::class, 'updateCollection']);
Route::delete('/v2/marketplace/collections/{id}', [\App\Http\Controllers\Api\MarketplaceDiscoveryController::class, 'destroyCollection']);
Route::post('/v2/marketplace/collections/{id}/items', [\App\Http\Controllers\Api\MarketplaceDiscoveryController::class, 'addCollectionItem']);
Route::delete('/v2/marketplace/collections/{id}/items/{listingId}', [\App\Http\Controllers\Api\MarketplaceDiscoveryController::class, 'removeCollectionItem']);
Route::get('/v2/marketplace/collections/{id}/items', [\App\Http\Controllers\Api\MarketplaceDiscoveryController::class, 'listCollectionItems']);

// Marketplace Promotions — Paid listing promotions
Route::get('/v2/marketplace/promotions/products', [\App\Http\Controllers\Api\MarketplacePromotionController::class, 'products']);
Route::post('/v2/marketplace/listings/{id}/promote', [\App\Http\Controllers\Api\MarketplacePromotionController::class, 'promote']);
Route::get('/v2/marketplace/listings/{id}/promotion', [\App\Http\Controllers\Api\MarketplacePromotionController::class, 'showPromotion']);
Route::get('/v2/marketplace/promotions/mine', [\App\Http\Controllers\Api\MarketplacePromotionController::class, 'myPromotions']);

// Marketplace Group — Group-scoped marketplace (MKT37)
Route::get('/v2/marketplace/groups/{groupId}/listings', [\App\Http\Controllers\Api\MarketplaceGroupController::class, 'listings'])
    ->whereNumber('groupId')->middleware('feature:groups');
Route::get('/v2/marketplace/groups/{groupId}/stats', [\App\Http\Controllers\Api\MarketplaceGroupController::class, 'stats'])
    ->whereNumber('groupId')->middleware('feature:groups');

// Marketplace Community Delivery — Peer-to-peer delivery for time credits (MKT39)
Route::post('/v2/marketplace/orders/{orderId}/delivery-offers', [\App\Http\Controllers\Api\MarketplaceCommunityDeliveryController::class, 'store']);
Route::get('/v2/marketplace/orders/{orderId}/delivery-offers', [\App\Http\Controllers\Api\MarketplaceCommunityDeliveryController::class, 'index']);
Route::put('/v2/marketplace/orders/{orderId}/delivery-offers/{delivererId}/accept', [\App\Http\Controllers\Api\MarketplaceCommunityDeliveryController::class, 'accept']);
Route::put('/v2/marketplace/orders/{orderId}/delivery-offers/{delivererId}/confirm', [\App\Http\Controllers\Api\MarketplaceCommunityDeliveryController::class, 'confirm']);

// Marketplace AI — Auto-reply for sellers (MKT32)
Route::post('/v2/marketplace/listings/{id}/auto-reply', [\App\Http\Controllers\Api\MarketplaceAiController::class, 'autoReply']);

// Marketplace DSA Reports — User reporting (MKT6)
Route::post('/v2/marketplace/listings/{id}/report', [\App\Http\Controllers\Api\MarketplaceReportController::class, 'store']);
Route::get('/v2/marketplace/reports', [\App\Http\Controllers\Api\MarketplaceReportController::class, 'mine']);
Route::get('/v2/marketplace/reports/{id}', [\App\Http\Controllers\Api\MarketplaceReportController::class, 'show']);
Route::post('/v2/marketplace/reports/{id}/appeal', [\App\Http\Controllers\Api\MarketplaceReportController::class, 'appeal']);

// AG63 — Merchant Coupons (member-facing)
Route::get('/v2/coupons', [\App\Http\Controllers\Api\MerchantCouponController::class, 'index']);
Route::get('/v2/coupons/{id}', [\App\Http\Controllers\Api\MerchantCouponController::class, 'show']);
Route::post('/v2/coupons/{id}/qr', [\App\Http\Controllers\Api\MerchantCouponController::class, 'generateQr']);
Route::post('/v2/coupons/redeem-qr', [\App\Http\Controllers\Api\MerchantCouponController::class, 'redeemQr']);
Route::post('/v2/coupons/validate', [\App\Http\Controllers\Api\MerchantCouponController::class, 'validateCode']);

// AG63 — Merchant Coupons (seller-side CRUD)
Route::get('/v2/marketplace/seller/coupons', [\App\Http\Controllers\Api\MerchantCouponSellerController::class, 'index']);
Route::post('/v2/marketplace/seller/coupons', [\App\Http\Controllers\Api\MerchantCouponSellerController::class, 'store']);
Route::put('/v2/marketplace/seller/coupons/{id}', [\App\Http\Controllers\Api\MerchantCouponSellerController::class, 'update']);
Route::delete('/v2/marketplace/seller/coupons/{id}', [\App\Http\Controllers\Api\MerchantCouponSellerController::class, 'destroy']);
Route::get('/v2/marketplace/seller/coupons/{id}/redemptions', [\App\Http\Controllers\Api\MerchantCouponSellerController::class, 'redemptions']);

// AG63 — Merchant Coupons (admin oversight)
Route::get('/v2/admin/marketplace/coupons', [\App\Http\Controllers\Api\Admin\MerchantCouponAdminController::class, 'index']);
Route::post('/v2/admin/marketplace/coupons/{id}/suspend', [\App\Http\Controllers\Api\Admin\MerchantCouponAdminController::class, 'suspend']);
Route::delete('/v2/admin/marketplace/coupons/{id}', [\App\Http\Controllers\Api\Admin\MerchantCouponAdminController::class, 'destroy']);

// AG61 — KI-Agenten (admin oversight: definitions, runs, proposals)
Route::get('/v2/admin/agents', [\App\Http\Controllers\Api\Admin\AgentAdminController::class, 'index']);
Route::patch('/v2/admin/agents/{id}', [\App\Http\Controllers\Api\Admin\AgentAdminController::class, 'update'])->whereNumber('id');
Route::post('/v2/admin/agents/{id}/toggle', [\App\Http\Controllers\Api\Admin\AgentAdminController::class, 'toggle'])->whereNumber('id');
Route::post('/v2/admin/agents/{id}/run-now', [\App\Http\Controllers\Api\Admin\AgentAdminController::class, 'runNow'])->whereNumber('id');
Route::get('/v2/admin/agents/runs', [\App\Http\Controllers\Api\Admin\AgentAdminController::class, 'runs']);
Route::get('/v2/admin/agents/proposals', [\App\Http\Controllers\Api\Admin\AgentAdminController::class, 'proposals']);
Route::post('/v2/admin/agents/proposals/{id}/approve', [\App\Http\Controllers\Api\Admin\AgentAdminController::class, 'approve'])->whereNumber('id');
Route::post('/v2/admin/agents/proposals/{id}/reject', [\App\Http\Controllers\Api\Admin\AgentAdminController::class, 'reject'])->whereNumber('id');
Route::post('/v2/admin/agents/proposals/{id}/edit-approve', [\App\Http\Controllers\Api\Admin\AgentAdminController::class, 'editAndApprove'])->whereNumber('id');

// Marketplace Shipping Options — Seller shipping management (MKT31)
Route::get('/v2/marketplace/seller/shipping-options', [\App\Http\Controllers\Api\MarketplaceSellerController::class, 'shippingOptions']);
Route::post('/v2/marketplace/seller/shipping-options', [\App\Http\Controllers\Api\MarketplaceSellerController::class, 'createShippingOption']);
Route::put('/v2/marketplace/seller/shipping-options/{id}', [\App\Http\Controllers\Api\MarketplaceSellerController::class, 'updateShippingOption']);
Route::delete('/v2/marketplace/seller/shipping-options/{id}', [\App\Http\Controllers\Api\MarketplaceSellerController::class, 'deleteShippingOption']);

// Marketplace Pro Seller Bulk Tools — Bulk actions, CSV export/import
Route::post('/v2/marketplace/listings/bulk-action', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'bulkAction']);
Route::get('/v2/marketplace/listings/export-csv', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'exportCsv']);
Route::post('/v2/marketplace/listings/import-csv', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'importCsv']);

// AG45 — Marketplace pickup slots (click-and-collect)
Route::get('/v2/marketplace/seller/pickup-slots', [\App\Http\Controllers\Api\MarketplacePickupSlotController::class, 'slotsIndex']);
Route::post('/v2/marketplace/seller/pickup-slots', [\App\Http\Controllers\Api\MarketplacePickupSlotController::class, 'slotsStore']);
Route::put('/v2/marketplace/seller/pickup-slots/{id}', [\App\Http\Controllers\Api\MarketplacePickupSlotController::class, 'slotsUpdate']);
Route::delete('/v2/marketplace/seller/pickup-slots/{id}', [\App\Http\Controllers\Api\MarketplacePickupSlotController::class, 'slotsDestroy']);
Route::post('/v2/marketplace/seller/pickup-scan', [\App\Http\Controllers\Api\MarketplacePickupSlotController::class, 'scanQr']);
Route::post('/v2/marketplace/orders/{id}/pickup-reservation', [\App\Http\Controllers\Api\MarketplacePickupSlotController::class, 'reserve']);
Route::get('/v2/marketplace/me/pickups', [\App\Http\Controllers\Api\MarketplacePickupSlotController::class, 'myReservations']);

// AG46 — Marketplace inventory
Route::patch('/v2/marketplace/seller/listings/{id}/inventory', [\App\Http\Controllers\Api\MarketplaceInventoryController::class, 'updateInventory']);

// AG48 — Merchant Onboarding Wizard (self-serve SME onboarding)
Route::get('/v2/merchant-onboarding/status', [\App\Http\Controllers\Api\MerchantOnboardingController::class, 'status']);
Route::post('/v2/merchant-onboarding/step-1', [\App\Http\Controllers\Api\MerchantOnboardingController::class, 'saveStep1']);
Route::post('/v2/merchant-onboarding/step-2', [\App\Http\Controllers\Api\MerchantOnboardingController::class, 'saveStep2']);
Route::post('/v2/merchant-onboarding/step-3', [\App\Http\Controllers\Api\MerchantOnboardingController::class, 'saveStep3']);
Route::post('/v2/merchant-onboarding/image', [\App\Http\Controllers\Api\MerchantOnboardingController::class, 'uploadImage']);
Route::post('/v2/merchant-onboarding/complete', [\App\Http\Controllers\Api\MerchantOnboardingController::class, 'complete']);

// SOC13 — Social login (OAuth) authenticated endpoints (link/unlink/identities)
Route::post('/v2/auth/oauth/{provider}/link', [\App\Http\Controllers\Auth\SocialAuthController::class, 'link'])
    ->where('provider', 'google|facebook');
Route::delete('/v2/auth/oauth/{provider}/unlink', [\App\Http\Controllers\Auth\SocialAuthController::class, 'unlink'])
    ->where('provider', 'google|facebook');
Route::get('/v2/auth/oauth/me/identities', [\App\Http\Controllers\Auth\SocialAuthController::class, 'identities']);

// ============================================
// Courses Module (ALPHA) — Authenticated routes
// Self-contained learning module; gated by the per-tenant `courses` feature.
// ============================================

// Learner — enrollment, progress, reviews
Route::get('/v2/me/courses', [\App\Http\Controllers\Api\CourseEnrollmentController::class, 'myCourses']);
Route::get('/v2/courses/mine', [\App\Http\Controllers\Api\CourseController::class, 'authored']);
Route::post('/v2/courses/{id}/enroll', [\App\Http\Controllers\Api\CourseEnrollmentController::class, 'enroll'])->where('id', '[0-9]+');
Route::delete('/v2/courses/{id}/enroll', [\App\Http\Controllers\Api\CourseEnrollmentController::class, 'drop'])->where('id', '[0-9]+');
Route::get('/v2/courses/{id}/progress', [\App\Http\Controllers\Api\CourseEnrollmentController::class, 'progress'])->where('id', '[0-9]+');
Route::post('/v2/courses/{id}/lessons/{lessonId}/complete', [\App\Http\Controllers\Api\CourseEnrollmentController::class, 'completeLesson'])->where(['id' => '[0-9]+', 'lessonId' => '[0-9]+']);
Route::post('/v2/courses/{id}/reviews', [\App\Http\Controllers\Api\CourseEnrollmentController::class, 'review'])->where('id', '[0-9]+');
Route::get('/v2/courses/{id}/certificate', [\App\Http\Controllers\Api\CourseEnrollmentController::class, 'certificate'])->where('id', '[0-9]+');
Route::get('/v2/courses/{id}/prerequisites', [\App\Http\Controllers\Api\CourseEnrollmentController::class, 'prerequisites'])->where('id', '[0-9]+');

// Cohorts
Route::get('/v2/courses/{courseId}/cohorts', [\App\Http\Controllers\Api\CourseCohortController::class, 'index'])->where('courseId', '[0-9]+');
Route::post('/v2/courses/{courseId}/cohorts', [\App\Http\Controllers\Api\CourseCohortController::class, 'store'])->where('courseId', '[0-9]+');
Route::delete('/v2/courses/{courseId}/cohorts/{cohortId}', [\App\Http\Controllers\Api\CourseCohortController::class, 'destroy'])->where(['courseId' => '[0-9]+', 'cohortId' => '[0-9]+']);

// Per-lesson discussions
Route::get('/v2/courses/{courseId}/lessons/{lessonId}/discussions', [\App\Http\Controllers\Api\CourseDiscussionController::class, 'index'])->where(['courseId' => '[0-9]+', 'lessonId' => '[0-9]+']);
Route::post('/v2/courses/{courseId}/lessons/{lessonId}/discussions', [\App\Http\Controllers\Api\CourseDiscussionController::class, 'store'])->where(['courseId' => '[0-9]+', 'lessonId' => '[0-9]+']);
Route::delete('/v2/courses/discussions/{id}', [\App\Http\Controllers\Api\CourseDiscussionController::class, 'destroy'])->where('id', '[0-9]+');

// Learner — quizzes
Route::get('/v2/courses/quizzes/{quizId}', [\App\Http\Controllers\Api\CourseQuizController::class, 'show'])->where('quizId', '[0-9]+');
Route::post('/v2/courses/quizzes/{quizId}/attempt', [\App\Http\Controllers\Api\CourseQuizController::class, 'attempt'])->where('quizId', '[0-9]+');

// Authoring — course CRUD (instructor or admin)
Route::post('/v2/courses', [\App\Http\Controllers\Api\CourseController::class, 'store']);
Route::put('/v2/courses/{id}', [\App\Http\Controllers\Api\CourseController::class, 'update'])->where('id', '[0-9]+');
Route::delete('/v2/courses/{id}', [\App\Http\Controllers\Api\CourseController::class, 'destroy'])->where('id', '[0-9]+');
Route::get('/v2/courses/{id}/analytics', [\App\Http\Controllers\Api\CourseController::class, 'analytics'])->where('id', '[0-9]+');
Route::post('/v2/courses/{id}/publish', [\App\Http\Controllers\Api\CourseController::class, 'publish'])->where('id', '[0-9]+');
Route::post('/v2/courses/{id}/unpublish', [\App\Http\Controllers\Api\CourseController::class, 'unpublish'])->where('id', '[0-9]+');

// Authoring — sections & lessons builder
Route::post('/v2/courses/{courseId}/sections', [\App\Http\Controllers\Api\CourseContentController::class, 'storeSection'])->where('courseId', '[0-9]+');
Route::put('/v2/courses/{courseId}/sections/{sectionId}', [\App\Http\Controllers\Api\CourseContentController::class, 'updateSection'])->where(['courseId' => '[0-9]+', 'sectionId' => '[0-9]+']);
Route::delete('/v2/courses/{courseId}/sections/{sectionId}', [\App\Http\Controllers\Api\CourseContentController::class, 'deleteSection'])->where(['courseId' => '[0-9]+', 'sectionId' => '[0-9]+']);
Route::post('/v2/courses/{courseId}/lessons', [\App\Http\Controllers\Api\CourseContentController::class, 'storeLesson'])->where('courseId', '[0-9]+');
Route::put('/v2/courses/{courseId}/lessons/{lessonId}', [\App\Http\Controllers\Api\CourseContentController::class, 'updateLesson'])->where(['courseId' => '[0-9]+', 'lessonId' => '[0-9]+']);
Route::delete('/v2/courses/{courseId}/lessons/{lessonId}', [\App\Http\Controllers\Api\CourseContentController::class, 'deleteLesson'])->where(['courseId' => '[0-9]+', 'lessonId' => '[0-9]+']);

// Group linkage
Route::get('/v2/groups/{groupId}/courses', [\App\Http\Controllers\Api\CourseGroupController::class, 'forGroup'])->where('groupId', '[0-9]+')->middleware('feature:groups');
Route::get('/v2/courses/{courseId}/groups', [\App\Http\Controllers\Api\CourseGroupController::class, 'groupsForCourse'])->where('courseId', '[0-9]+')->middleware('feature:groups');
Route::post('/v2/courses/{courseId}/groups/{groupId}', [\App\Http\Controllers\Api\CourseGroupController::class, 'attach'])->where(['courseId' => '[0-9]+', 'groupId' => '[0-9]+'])->middleware('feature:groups');
Route::delete('/v2/courses/{courseId}/groups/{groupId}', [\App\Http\Controllers\Api\CourseGroupController::class, 'detach'])->where(['courseId' => '[0-9]+', 'groupId' => '[0-9]+'])->middleware('feature:groups');

// Grading (instructor/admin)
Route::get('/v2/courses/{courseId}/grading', [\App\Http\Controllers\Api\CourseQuizController::class, 'gradingQueue'])->where('courseId', '[0-9]+');
Route::post('/v2/courses/attempts/{attemptId}/grade', [\App\Http\Controllers\Api\CourseQuizController::class, 'gradeAttempt'])->where('attemptId', '[0-9]+');

// Authoring — quizzes & questions
Route::post('/v2/courses/{courseId}/quizzes', [\App\Http\Controllers\Api\CourseQuizController::class, 'storeQuiz'])->where('courseId', '[0-9]+');
Route::post('/v2/courses/{courseId}/quizzes/{quizId}/questions', [\App\Http\Controllers\Api\CourseQuizController::class, 'storeQuestion'])->where(['courseId' => '[0-9]+', 'quizId' => '[0-9]+']);
Route::delete('/v2/courses/{courseId}/quizzes/{quizId}/questions/{questionId}', [\App\Http\Controllers\Api\CourseQuizController::class, 'deleteQuestion'])->where(['courseId' => '[0-9]+', 'quizId' => '[0-9]+', 'questionId' => '[0-9]+']);

// Podcasts Module — member-created shows and episodes.
Route::get('/v2/podcasts/mine', [\App\Http\Controllers\Api\PodcastController::class, 'authored']);
Route::get('/v2/podcasts/{id}/validate-feed', [\App\Http\Controllers\Api\PodcastController::class, 'validateFeedForOwner'])->where('id', '[0-9]+');
Route::get('/v2/podcasts/{id}/stats', [\App\Http\Controllers\Api\PodcastController::class, 'stats'])->where('id', '[0-9]+');
Route::post('/v2/podcasts', [\App\Http\Controllers\Api\PodcastController::class, 'store']);
Route::put('/v2/podcasts/{id}', [\App\Http\Controllers\Api\PodcastController::class, 'update'])->where('id', '[0-9]+');
Route::post('/v2/podcasts/{id}/artwork', [\App\Http\Controllers\Api\PodcastController::class, 'uploadArtwork'])->where('id', '[0-9]+');
Route::post('/v2/podcasts/{id}/publish', [\App\Http\Controllers\Api\PodcastController::class, 'publish'])->where('id', '[0-9]+');
Route::post('/v2/podcasts/{id}/archive', [\App\Http\Controllers\Api\PodcastController::class, 'archive'])->where('id', '[0-9]+');
Route::delete('/v2/podcasts/{id}', [\App\Http\Controllers\Api\PodcastController::class, 'destroy'])->where('id', '[0-9]+');
Route::post('/v2/podcasts/{showId}/episodes', [\App\Http\Controllers\Api\PodcastController::class, 'storeEpisode'])->where('showId', '[0-9]+');
Route::put('/v2/podcasts/{showId}/episodes/{episodeId}', [\App\Http\Controllers\Api\PodcastController::class, 'updateEpisode'])->where(['showId' => '[0-9]+', 'episodeId' => '[0-9]+']);
Route::post('/v2/podcasts/{showId}/episodes/{episodeId}/cover', [\App\Http\Controllers\Api\PodcastController::class, 'uploadEpisodeCover'])->where(['showId' => '[0-9]+', 'episodeId' => '[0-9]+']);
Route::post('/v2/podcasts/{showId}/episodes/{episodeId}/publish', [\App\Http\Controllers\Api\PodcastController::class, 'publishEpisode'])->where(['showId' => '[0-9]+', 'episodeId' => '[0-9]+']);
Route::post('/v2/podcasts/{showId}/episodes/{episodeId}/archive', [\App\Http\Controllers\Api\PodcastController::class, 'archiveEpisode'])->where(['showId' => '[0-9]+', 'episodeId' => '[0-9]+']);
Route::delete('/v2/podcasts/{showId}/episodes/{episodeId}', [\App\Http\Controllers\Api\PodcastController::class, 'destroyEpisode'])->where(['showId' => '[0-9]+', 'episodeId' => '[0-9]+']);
Route::post('/v2/podcasts/{showId}/subscribe', [\App\Http\Controllers\Api\PodcastController::class, 'subscribe'])->where('showId', '[0-9]+');
Route::post('/v2/podcasts/episodes/{episodeId}/reaction', [\App\Http\Controllers\Api\PodcastController::class, 'reaction'])->where('episodeId', '[0-9]+');
Route::post('/v2/podcasts/episodes/{episodeId}/report', [\App\Http\Controllers\Api\PodcastController::class, 'report'])->where('episodeId', '[0-9]+');

}); // End Route::middleware('auth:sanctum')

// Identity-free analytics acknowledgement. This endpoint returns only
// {recorded:true} and preserves anonymous listening metrics for an already-known
// public episode ID.
Route::post('/v2/podcasts/episodes/{episodeId}/listen', [\App\Http\Controllers\Api\PodcastController::class, 'listen'])
    ->where('episodeId', '[0-9]+')
    ->withoutMiddleware('auth:sanctum');

// Identity-free podcast distribution. Native media elements and podcast
// clients cannot attach SPA bearer tokens. Controllers expose only approved
// public resources; restricted hosted media requires a capability signature.
Route::get('/v2/podcasts/media/{tenantId}/{episodeId}/audio', [\App\Http\Controllers\Api\PodcastController::class, 'audio'])
    ->where(['tenantId' => '[0-9]+', 'episodeId' => '[0-9]+'])
    ->middleware('throttle:podcast-media');
Route::get('/v2/podcasts/transcripts/{tenantId}/{episodeId}.txt', [\App\Http\Controllers\Api\PodcastController::class, 'transcript'])
    ->where(['tenantId' => '[0-9]+', 'episodeId' => '[0-9]+'])
    ->middleware('throttle:nexus-route-60-per-1m');
Route::get('/v2/podcasts/chapters/{tenantId}/{episodeId}.json', [\App\Http\Controllers\Api\PodcastController::class, 'chapters'])
    ->where(['tenantId' => '[0-9]+', 'episodeId' => '[0-9]+'])
    ->middleware('throttle:nexus-route-60-per-1m');
Route::get('/v2/podcasts/feed/{tenantId}/{showSlug}.xml', [\App\Http\Controllers\Api\PodcastController::class, 'rssForTenant'])
    ->where(['tenantId' => '[0-9]+', 'showSlug' => '[A-Za-z0-9_-]+'])
    ->middleware('throttle:nexus-route-30-per-1m');
Route::get('/v2/podcasts/{showSlug}/feed.xml', [\App\Http\Controllers\Api\PodcastController::class, 'rss'])
    ->middleware('throttle:nexus-route-30-per-1m');

// ============================================
// Courses, podcasts, and marketplace contain member identity and require auth.
// ============================================
Route::middleware('auth:sanctum')->group(function () {
Route::get('/v2/courses', [\App\Http\Controllers\Api\CourseController::class, 'index']);
Route::get('/v2/courses/categories', [\App\Http\Controllers\Api\CourseController::class, 'categories']);
Route::get('/v2/courses/{id}/reviews', [\App\Http\Controllers\Api\CourseController::class, 'reviews'])->where('id', '[0-9]+');
Route::get('/v2/courses/{idOrSlug}', [\App\Http\Controllers\Api\CourseController::class, 'show']);

// ============================================
// Podcasts Module — authenticated content routes
// ============================================
Route::get('/v2/podcasts', [\App\Http\Controllers\Api\PodcastController::class, 'index']);
Route::get('/v2/podcasts/{showSlug}', [\App\Http\Controllers\Api\PodcastController::class, 'show']);
Route::get('/v2/podcasts/{showSlug}/{episodeSlug}', [\App\Http\Controllers\Api\PodcastController::class, 'episode']);

// ============================================
// Marketplace Module — authenticated content routes
// ============================================
Route::get('/v2/marketplace/listings', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'index']);
Route::get('/v2/marketplace/listings/nearby', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'nearby']);
Route::get('/v2/marketplace/listings/featured', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'featured']);
Route::get('/v2/marketplace/listings/free', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'free']);
Route::get('/v2/marketplace/listings/{id}', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'show']);
Route::get('/v2/marketplace/categories', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'categories']);
Route::get('/v2/marketplace/categories/{slug}/listings', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'categoryListings'])
    ->where('slug', '[A-Za-z0-9_-]+');
Route::get('/v2/marketplace/categories/{id}/template', [\App\Http\Controllers\Api\MarketplaceListingController::class, 'categoryTemplate']);
Route::get('/v2/marketplace/sellers/{id}', [\App\Http\Controllers\Api\MarketplaceSellerController::class, 'show']);
Route::get('/v2/marketplace/sellers/{id}/listings', [\App\Http\Controllers\Api\MarketplaceSellerController::class, 'listings']);
Route::get('/v2/marketplace/sellers/{id}/shipping-options', [\App\Http\Controllers\Api\MarketplaceSellerController::class, 'shippingOptionsForSeller']);
Route::get('/v2/marketplace/listings/{id}/pickup-slots', [\App\Http\Controllers\Api\MarketplacePickupSlotController::class, 'listForListing']);
});

// ============================================
// Federation cross-node aggregates (R1+R2 — Caring Community federation)
// Public, no auth — but throttled. Returns 404 silently when the tenant
// has not opted in. Each query is signed and logged for 12 months.
// ============================================
Route::get('/v2/federation/aggregates', [\App\Http\Controllers\Api\FederationAggregateController::class, 'show'])
    ->middleware(['throttle:nexus-route-60-per-1m', 'federation.external:aggregates']);

// ============================================
// Admin routes — Sanctum auth + admin middleware
// Controllers also enforce auth via $this->requireAdmin() as a fallback
// ============================================
Route::middleware(['auth:sanctum', 'admin'])->group(function () {

// MIGRATED ROUTES — Admin API (Dashboard, Users, Listings, Config, Cache, Jobs, Federation, CRM, Super Admin)
// Source: httpdocs/routes/admin-api.php
// ============================================
// Admin verification badge management (distinct path to avoid collision with gamification badges at line 539)
Route::post('/v2/admin/users/{id}/verification-badges', [\App\Http\Controllers\Api\MemberVerificationBadgeController::class, 'grantBadge']);
Route::delete('/v2/admin/users/{id}/verification-badges/{type}', [\App\Http\Controllers\Api\MemberVerificationBadgeController::class, 'revokeBadge']);
Route::get('/v2/admin/users/{id}/verification-badges', [\App\Http\Controllers\Api\MemberVerificationBadgeController::class, 'getAdminBadgeList']);

// Tenant-wide audit trail export (CSV) — activity_log + org_audit_log
Route::get('/v2/admin/audit-log/export.csv', [\App\Http\Controllers\Api\AdminAuditLogController::class, 'exportCsv']);

// SSO provider management (IT-Sec-05)
Route::get('/v2/admin/sso/providers', [\App\Http\Controllers\Api\AdminSsoProvidersController::class, 'index']);
Route::put('/v2/admin/sso/providers/{providerKey}', [\App\Http\Controllers\Api\AdminSsoProvidersController::class, 'upsert'])
    ->where('providerKey', '[a-z0-9_-]{2,20}');
Route::delete('/v2/admin/sso/providers/{providerKey}', [\App\Http\Controllers\Api\AdminSsoProvidersController::class, 'destroy'])
    ->where('providerKey', '[a-z0-9_-]{2,20}');
Route::post('/v2/admin/sso/providers/{providerKey}/test', [\App\Http\Controllers\Api\AdminSsoProvidersController::class, 'test'])
    ->where('providerKey', '[a-z0-9_-]{2,20}');

// Data retention policies (IT-Data-03)
Route::get('/v2/admin/retention/policies', [\App\Http\Controllers\Api\AdminRetentionController::class, 'index']);
Route::put('/v2/admin/retention/policies/{dataType}', [\App\Http\Controllers\Api\AdminRetentionController::class, 'update']);
Route::get('/v2/admin/retention/runs', [\App\Http\Controllers\Api\AdminRetentionController::class, 'runs']);

Route::get('/v2/admin/dashboard/stats', [\App\Http\Controllers\Api\AdminDashboardController::class, 'stats']);
Route::get('/v2/admin/dashboard/trends', [\App\Http\Controllers\Api\AdminDashboardController::class, 'trends']);
Route::get('/v2/admin/dashboard/activity', [\App\Http\Controllers\Api\AdminDashboardController::class, 'activity']);
// Broker-or-admin: the broker panel's Members, Onboarding and member-detail
// drawer drive these. Brokers get list/show, approval + suspension (incl.
// bulk), safe profile edits, 2FA reset, verification / password-reset / welcome
// emails, a read-only GDPR-consent view, and (audited) balance adjustment.
// Privileged actions stay admin-only (store/import, destroy, ban, badges,
// direct password set) or super-admin-only (impersonate, super-admin
// promotion). AdminUsersController@update additionally rejects broker attempts
// to change role/status/email/profile_type/organization_name. See
// tests/Laravel/Feature/Controllers/BrokerUserActionsAuthorizationTest.php.
Route::withoutMiddleware('admin')->middleware('broker-or-admin')->group(function () {
    Route::get('/v2/admin/users', [\App\Http\Controllers\Api\AdminUsersController::class, 'index']);
    Route::get('/v2/admin/users/{id}', [\App\Http\Controllers\Api\AdminUsersController::class, 'show'])->whereNumber('id');
    Route::post('/v2/admin/users/{id}/approve', [\App\Http\Controllers\Api\AdminUsersController::class, 'approve']);
    Route::post('/v2/admin/users/{id}/suspend', [\App\Http\Controllers\Api\AdminUsersController::class, 'suspend']);
    Route::post('/v2/admin/users/{id}/reactivate', [\App\Http\Controllers\Api\AdminUsersController::class, 'reactivate']);
    Route::put('/v2/admin/users/{id}', [\App\Http\Controllers\Api\AdminUsersController::class, 'update'])->whereNumber('id');
    Route::post('/v2/admin/users/bulk-approve', [\App\Http\Controllers\Api\AdminUsersController::class, 'bulkApprove']);
    Route::post('/v2/admin/users/bulk-suspend', [\App\Http\Controllers\Api\AdminUsersController::class, 'bulkSuspend']);
    Route::post('/v2/admin/users/{id}/reset-2fa', [\App\Http\Controllers\Api\AdminUsersController::class, 'reset2fa'])->whereNumber('id');
    Route::get('/v2/admin/users/{id}/consents', [\App\Http\Controllers\Api\AdminUsersController::class, 'getConsents'])->whereNumber('id');
    Route::post('/v2/admin/users/{id}/send-password-reset', [\App\Http\Controllers\Api\AdminUsersController::class, 'sendPasswordReset'])->whereNumber('id');
    Route::post('/v2/admin/users/{id}/send-verification-email', [\App\Http\Controllers\Api\EmailVerificationController::class, 'adminResendVerification'])->whereNumber('id');
    Route::post('/v2/admin/users/{id}/send-welcome-email', [\App\Http\Controllers\Api\AdminUsersController::class, 'sendWelcomeEmail'])->whereNumber('id');
});
Route::post('/v2/admin/users', [\App\Http\Controllers\Api\AdminUsersController::class, 'store']);
Route::post('/v2/admin/users/import', [\App\Http\Controllers\Api\AdminUsersController::class, 'import']);
Route::get('/v2/admin/users/import/template', [\App\Http\Controllers\Api\AdminUsersController::class, 'importTemplate']);
Route::delete('/v2/admin/users/{id}', [\App\Http\Controllers\Api\AdminUsersController::class, 'destroy']);
Route::post('/v2/admin/users/{id}/ban', [\App\Http\Controllers\Api\AdminUsersController::class, 'ban']);
Route::post('/v2/admin/users/badges/recheck-all', [\App\Http\Controllers\Api\AdminGamificationController::class, 'recheckAll']);
Route::post('/v2/admin/users/{id}/badges', [\App\Http\Controllers\Api\AdminUsersController::class, 'addBadge']);
Route::delete('/v2/admin/users/{id}/badges/{badgeId}', [\App\Http\Controllers\Api\AdminUsersController::class, 'removeBadge']);
// impersonate, super-admin promotion — moved to super-admin middleware group (see below)
Route::post('/v2/admin/users/{id}/badges/recheck', [\App\Http\Controllers\Api\AdminUsersController::class, 'recheckBadges'])->whereNumber('id');
Route::post('/v2/admin/users/{id}/password', [\App\Http\Controllers\Api\AdminUsersController::class, 'setPassword'])->whereNumber('id');
// Listings index is used by the broker panel's Risk Tags create-modal
// autocomplete. Other listing-management endpoints stay admin-only.
Route::withoutMiddleware('admin')->middleware('broker-or-admin')->group(function () {
    Route::get('/v2/admin/listings', [\App\Http\Controllers\Api\AdminListingsController::class, 'index']);
});
Route::get('/v2/admin/listings/featured', [\App\Http\Controllers\Api\AdminListingsController::class, 'featured']);
Route::get('/v2/admin/listings/stats', [\App\Http\Controllers\Api\AdminListingsController::class, 'stats']);
Route::get('/v2/admin/listings/moderation-queue', [\App\Http\Controllers\Api\AdminListingsController::class, 'moderationQueue']);
Route::get('/v2/admin/listings/moderation-stats', [\App\Http\Controllers\Api\AdminListingsController::class, 'moderationStats']);
Route::get('/v2/admin/listings/{id}', [\App\Http\Controllers\Api\AdminListingsController::class, 'show']);
Route::post('/v2/admin/listings/{id}/approve', [\App\Http\Controllers\Api\AdminListingsController::class, 'approve']);
Route::delete('/v2/admin/listings/{id}', [\App\Http\Controllers\Api\AdminListingsController::class, 'destroy']);
Route::get('/v2/admin/categories', [\App\Http\Controllers\Api\AdminCategoriesController::class, 'index']);
Route::post('/v2/admin/categories', [\App\Http\Controllers\Api\AdminCategoriesController::class, 'store']);
Route::put('/v2/admin/categories/{id}', [\App\Http\Controllers\Api\AdminCategoriesController::class, 'update']);
Route::delete('/v2/admin/categories/{id}', [\App\Http\Controllers\Api\AdminCategoriesController::class, 'destroy']);
Route::get('/v2/admin/attributes', [\App\Http\Controllers\Api\AdminCategoriesController::class, 'listAttributes']);
Route::post('/v2/admin/attributes', [\App\Http\Controllers\Api\AdminCategoriesController::class, 'storeAttribute']);
Route::put('/v2/admin/attributes/{id}', [\App\Http\Controllers\Api\AdminCategoriesController::class, 'updateAttribute']);
Route::delete('/v2/admin/attributes/{id}', [\App\Http\Controllers\Api\AdminCategoriesController::class, 'destroyAttribute']);
Route::get('/v2/admin/config', [\App\Http\Controllers\Api\AdminConfigController::class, 'getConfig']);
Route::put('/v2/admin/config/features', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateFeature']);
Route::put('/v2/admin/config/modules', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateModule']);
Route::get('/v2/admin/cache/stats', [\App\Http\Controllers\Api\AdminConfigController::class, 'cacheStats']);
Route::post('/v2/admin/cache/clear', [\App\Http\Controllers\Api\AdminConfigController::class, 'clearCache']);
Route::get('/v2/admin/background-jobs', [\App\Http\Controllers\Api\AdminConfigController::class, 'getJobs']);
Route::post('/v2/admin/background-jobs/{id}/run', [\App\Http\Controllers\Api\AdminConfigController::class, 'runJob']);
Route::get('/v2/admin/settings', [\App\Http\Controllers\Api\AdminConfigController::class, 'getSettings']);
Route::put('/v2/admin/settings', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateSettings']);
Route::post('/v2/admin/settings/partner-logo', [\App\Http\Controllers\Api\AdminConfigController::class, 'uploadPartnerLogo']);
Route::post('/v2/admin/settings/powered-by-image-light', [\App\Http\Controllers\Api\AdminConfigController::class, 'uploadPoweredByImageLight']);
Route::post('/v2/admin/settings/powered-by-image-dark',  [\App\Http\Controllers\Api\AdminConfigController::class, 'uploadPoweredByImageDark']);
Route::post('/v2/admin/settings/header-logo',       [\App\Http\Controllers\Api\AdminConfigController::class, 'uploadHeaderLogo']);
Route::post('/v2/admin/settings/header-logo-dark',  [\App\Http\Controllers\Api\AdminConfigController::class, 'uploadHeaderLogoDark']);
Route::delete('/v2/admin/settings/header-logo',      [\App\Http\Controllers\Api\AdminConfigController::class, 'removeHeaderLogo']);
Route::delete('/v2/admin/settings/header-logo-dark', [\App\Http\Controllers\Api\AdminConfigController::class, 'removeHeaderLogoDark']);
Route::put('/v2/admin/settings/header-colors',       [\App\Http\Controllers\Api\AdminConfigController::class, 'saveHeaderColors']);
Route::get('/v2/admin/config/registration-policy', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'getPolicy']);
Route::put('/v2/admin/config/registration-policy', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'updatePolicy']);
Route::get('/v2/admin/identity/providers', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'listProviders']);
Route::get('/v2/admin/identity/sessions', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'listSessions']);
Route::get('/v2/admin/identity/audit-log', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'getAuditLog']);
Route::post('/v2/admin/identity/sessions/{id}/approve', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'adminApproveVerification']);
Route::post('/v2/admin/identity/sessions/{id}/reject', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'adminRejectVerification']);
Route::get('/v2/admin/identity/provider-health', [\App\Http\Controllers\Api\IdentityProviderHealthController::class, 'getProviderHealth']);
Route::get('/v2/admin/identity/provider-credentials', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'listProviderCredentials']);
Route::put('/v2/admin/identity/provider-credentials/{slug}', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'saveProviderCredentials']);
Route::delete('/v2/admin/identity/provider-credentials/{slug}', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'deleteProviderCredentials']);
Route::get('/v2/admin/invite-codes', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'listInviteCodes']);
Route::post('/v2/admin/invite-codes', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'generateInviteCodes']);
Route::delete('/v2/admin/invite-codes/{id}', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'deactivateInviteCode']);
Route::get('/v2/admin/registration/breaker', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'getBreakerStatus']);
Route::post('/v2/admin/registration/resume-signups', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'resumeSignups']);
Route::get('/v2/admin/config/groups', [\App\Http\Controllers\Api\AdminConfigController::class, 'getGroupConfig']);
Route::get('/v2/admin/config/events', [\App\Http\Controllers\Api\AdminConfigController::class, 'getEventConfig']);
Route::get('/v2/admin/config/events/audit-log', [\App\Http\Controllers\Api\AdminConfigController::class, 'getEventConfigAuditLog']);
Route::put('/v2/admin/config/events', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateEventConfig']);
Route::post('/v2/admin/config/events/restore-defaults', [\App\Http\Controllers\Api\AdminConfigController::class, 'restoreEventConfigDefaults']);
Route::put('/v2/admin/config/groups', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateGroupConfig']);
Route::put('/v2/admin/config/groups/bulk', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateGroupConfigBulk']);
Route::get('/v2/admin/config/listings', [\App\Http\Controllers\Api\AdminConfigController::class, 'getListingConfig']);
Route::put('/v2/admin/config/listings', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateListingConfig']);
Route::put('/v2/admin/config/listings/bulk', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateListingConfigBulk']);
Route::get('/v2/admin/config/volunteering', [\App\Http\Controllers\Api\AdminConfigController::class, 'getVolunteeringConfig']);
Route::put('/v2/admin/config/volunteering/bulk', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateVolunteeringConfigBulk']);
Route::get('/v2/admin/config/jobs', [\App\Http\Controllers\Api\AdminConfigController::class, 'getJobConfig']);
Route::put('/v2/admin/config/jobs/bulk', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateJobConfigBulk']);
Route::get('/v2/admin/config/podcasts', [\App\Http\Controllers\Api\AdminConfigController::class, 'getPodcastConfig']);
Route::put('/v2/admin/config/podcasts/bulk', [\App\Http\Controllers\Api\AdminConfigController::class, 'updatePodcastConfigBulk']);
Route::get('/v2/admin/config/authentication', [\App\Http\Controllers\Api\AdminConfigController::class, 'getAuthenticationConfig']);
Route::put('/v2/admin/config/authentication/bulk', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateAuthenticationConfigBulk']);
Route::get('/v2/admin/config/identity', [\App\Http\Controllers\Api\AdminConfigController::class, 'getIdentityConfig']);
Route::put('/v2/admin/config/identity/bulk', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateIdentityConfigBulk']);
Route::get('/v2/admin/config/translation', [\App\Http\Controllers\Api\AdminConfigController::class, 'getTranslationConfig']);
Route::put('/v2/admin/config/translation', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateTranslationConfig']);
Route::put('/v2/admin/config/translation/bulk', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateTranslationConfigBulk']);
Route::get('/v2/admin/translation/glossary', [\App\Http\Controllers\Api\AdminConfigController::class, 'getGlossary']);
Route::post('/v2/admin/translation/glossary', [\App\Http\Controllers\Api\AdminConfigController::class, 'createGlossaryEntry']);
Route::delete('/v2/admin/translation/glossary/{id}', [\App\Http\Controllers\Api\AdminConfigController::class, 'deleteGlossaryEntry']);
Route::get('/v2/admin/config/ai', [\App\Http\Controllers\Api\AdminConfigController::class, 'getAiConfig']);
Route::put('/v2/admin/config/ai', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateAiConfig']);
Route::get('/v2/admin/config/feed-algorithm', [\App\Http\Controllers\Api\AdminConfigController::class, 'getFeedAlgorithmConfig']);
Route::put('/v2/admin/config/feed-algorithm', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateFeedAlgorithmConfig']);
Route::get('/v2/admin/config/algorithms', [\App\Http\Controllers\Api\AdminConfigController::class, 'getAlgorithmConfig']);
Route::put('/v2/admin/config/algorithm/{area}', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateAlgorithmConfig']);
Route::get('/v2/admin/config/algorithm-health', [\App\Http\Controllers\Api\AdminConfigController::class, 'getAlgorithmHealth']);
Route::get('/v2/admin/config/images', [\App\Http\Controllers\Api\AdminConfigController::class, 'getImageConfig']);
Route::put('/v2/admin/config/images', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateImageConfig']);
Route::get('/v2/admin/config/seo', [\App\Http\Controllers\Api\AdminConfigController::class, 'getSeoConfig']);
Route::put('/v2/admin/config/seo', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateSeoConfig']);
Route::get('/v2/admin/config/sitemap-stats', [\App\Http\Controllers\Api\AdminConfigController::class, 'getSitemapStats']);
Route::post('/v2/admin/config/sitemap-clear-cache', [\App\Http\Controllers\Api\AdminConfigController::class, 'clearSitemapCache']);
Route::get('/v2/admin/config/languages', [\App\Http\Controllers\Api\AdminConfigController::class, 'getLanguageConfig']);
Route::put('/v2/admin/config/languages', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateLanguageConfig']);
Route::get('/v2/admin/config/native-app', [\App\Http\Controllers\Api\AdminConfigController::class, 'getNativeAppConfig']);
Route::put('/v2/admin/config/native-app', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateNativeAppConfig']);
Route::get('/v2/admin/config/native-app/build-manifest', [\App\Http\Controllers\Api\AdminConfigController::class, 'getNativeAppBuildManifest']);
// ── Admin: Landing Page Configuration ──────────────────────────────────────
Route::get('/v2/admin/config/landing-page', [\App\Http\Controllers\Api\AdminConfigController::class, 'getLandingPageConfig']);
Route::put('/v2/admin/config/landing-page', [\App\Http\Controllers\Api\AdminConfigController::class, 'updateLandingPageConfig']);
// ── Admin: Onboarding Module Configuration ─────────────────────────────────
Route::get('/v2/admin/config/onboarding', [\App\Http\Controllers\Api\AdminOnboardingConfigController::class, 'getConfig']);
Route::put('/v2/admin/config/onboarding', [\App\Http\Controllers\Api\AdminOnboardingConfigController::class, 'updateConfig']);
Route::get('/v2/admin/config/onboarding/presets', [\App\Http\Controllers\Api\AdminOnboardingConfigController::class, 'getPresets']);
Route::post('/v2/admin/config/onboarding/apply-preset', [\App\Http\Controllers\Api\AdminOnboardingConfigController::class, 'applyPreset']);

// ── Admin: Safeguarding Options CRUD ────────────────────────────────────────
// Broker-or-admin: safeguarding options management lives in the broker panel
// (/broker/safeguarding-options) since 2026-07-02. Mutations throttled like
// the other broker decision endpoints. See BrokerModerationAuthorizationTest.
Route::withoutMiddleware('admin')->middleware('broker-or-admin')->group(function () {
    Route::get('/v2/admin/safeguarding/options', [\App\Http\Controllers\Api\AdminSafeguardingOptionsController::class, 'index']);
    Route::post('/v2/admin/safeguarding/options', [\App\Http\Controllers\Api\AdminSafeguardingOptionsController::class, 'store'])->middleware('throttle:nexus-route-60-per-1m');
    Route::put('/v2/admin/safeguarding/options/reorder', [\App\Http\Controllers\Api\AdminSafeguardingOptionsController::class, 'reorder'])->middleware('throttle:nexus-route-60-per-1m');
    Route::put('/v2/admin/safeguarding/options/{id}', [\App\Http\Controllers\Api\AdminSafeguardingOptionsController::class, 'update'])->middleware('throttle:nexus-route-60-per-1m');
    Route::delete('/v2/admin/safeguarding/options/{id}', [\App\Http\Controllers\Api\AdminSafeguardingOptionsController::class, 'destroy'])->middleware('throttle:nexus-route-60-per-1m');
});

Route::get('/v2/admin/system/cron-jobs', [\App\Http\Controllers\Api\AdminConfigController::class, 'getCronJobs']);
Route::post('/v2/admin/system/cron-jobs/{id}/run', [\App\Http\Controllers\Api\AdminConfigController::class, 'runCronJob']);
Route::get('/v2/admin/system/cron-jobs/logs', [\App\Http\Controllers\Api\AdminCronController::class, 'getLogs']);
Route::get('/v2/admin/system/cron-jobs/logs/{id}', [\App\Http\Controllers\Api\AdminCronController::class, 'getLogDetail']);
Route::delete('/v2/admin/system/cron-jobs/logs', [\App\Http\Controllers\Api\AdminCronController::class, 'clearLogs']);
Route::get('/v2/admin/system/cron-jobs/settings', [\App\Http\Controllers\Api\AdminCronController::class, 'getGlobalSettings']);
Route::put('/v2/admin/system/cron-jobs/settings', [\App\Http\Controllers\Api\AdminCronController::class, 'updateGlobalSettings']);
Route::get('/v2/admin/system/cron-jobs/health', [\App\Http\Controllers\Api\AdminCronController::class, 'getHealthMetrics']);
Route::get('/v2/admin/system/cron-jobs/{jobId}/settings', [\App\Http\Controllers\Api\AdminCronController::class, 'getJobSettings']);
Route::put('/v2/admin/system/cron-jobs/{jobId}/settings', [\App\Http\Controllers\Api\AdminCronController::class, 'updateJobSettings']);
Route::get('/v2/admin/system/activity-log', [\App\Http\Controllers\Api\AdminDashboardController::class, 'activity']);
Route::get('/v2/admin/email/status', [\App\Http\Controllers\Api\AdminEmailController::class, 'status']);
Route::post('/v2/admin/email/test', [\App\Http\Controllers\Api\AdminEmailController::class, 'test']);
Route::post('/v2/admin/email/test-gmail', [\App\Http\Controllers\Api\AdminEmailController::class, 'testGmail']);
Route::get('/v2/admin/email/config', [\App\Http\Controllers\Api\AdminEmailController::class, 'getConfig']);
Route::put('/v2/admin/email/config', [\App\Http\Controllers\Api\AdminEmailController::class, 'updateConfig']);
Route::post('/v2/admin/email/test-provider', [\App\Http\Controllers\Api\AdminEmailController::class, 'testProvider']);
Route::get('/v2/admin/matching/config', [\App\Http\Controllers\Api\AdminMatchingController::class, 'getConfig']);
Route::put('/v2/admin/matching/config', [\App\Http\Controllers\Api\AdminMatchingController::class, 'updateConfig']);
Route::post('/v2/admin/matching/cache/clear', [\App\Http\Controllers\Api\AdminMatchingController::class, 'clearCache']);
Route::get('/v2/admin/matching/stats', [\App\Http\Controllers\Api\AdminMatchingController::class, 'getStats']);
// Broker-or-admin: reviewing smart-match proposals is a core broker duty, so
// the five approval endpoints are shared with the broker panel's Match
// Approvals pages. Matching config/analytics/cache stay admin-only above.
// The controller adds a self-guard: a broker must not approve/reject a match
// they are a party to (mirrors the adjust-balance self-dealing guard). See
// tests/Laravel/Feature/Controllers/BrokerMatchApprovalAuthorizationTest.php.
Route::withoutMiddleware('admin')->middleware('broker-or-admin')->group(function () {
    Route::get('/v2/admin/matching/approvals', [\App\Http\Controllers\Api\AdminMatchingController::class, 'index']);
    Route::get('/v2/admin/matching/approvals/stats', [\App\Http\Controllers\Api\AdminMatchingController::class, 'approvalStats']);
    Route::get('/v2/admin/matching/approvals/{id}', [\App\Http\Controllers\Api\AdminMatchingController::class, 'show']);
    // Mutations throttled to 60/min/user like the other broker decision
    // endpoints — far above interactive speed, blocks scripted abuse.
    Route::post('/v2/admin/matching/approvals/{id}/approve', [\App\Http\Controllers\Api\AdminMatchingController::class, 'approve'])->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/admin/matching/approvals/{id}/reject', [\App\Http\Controllers\Api\AdminMatchingController::class, 'reject'])->middleware('throttle:nexus-route-60-per-1m');
});
Route::get('/v2/admin/help/faqs', [\App\Http\Controllers\Api\HelpController::class, 'adminGetFaqs']);
Route::post('/v2/admin/help/faqs', [\App\Http\Controllers\Api\HelpController::class, 'adminCreateFaq']);
Route::put('/v2/admin/help/faqs/{id}', [\App\Http\Controllers\Api\HelpController::class, 'adminUpdateFaq']);
Route::delete('/v2/admin/help/faqs/{id}', [\App\Http\Controllers\Api\HelpController::class, 'adminDeleteFaq']);
Route::post('/v2/admin/blog/bulk-delete', [\App\Http\Controllers\Api\AdminBlogController::class, 'bulkDelete']);
Route::post('/v2/admin/blog/bulk-publish', [\App\Http\Controllers\Api\AdminBlogController::class, 'bulkPublish']);
Route::get('/v2/admin/blog', [\App\Http\Controllers\Api\AdminBlogController::class, 'index']);
Route::post('/v2/admin/blog', [\App\Http\Controllers\Api\AdminBlogController::class, 'store']);
Route::get('/v2/admin/blog/{id}', [\App\Http\Controllers\Api\AdminBlogController::class, 'show']);
Route::put('/v2/admin/blog/{id}', [\App\Http\Controllers\Api\AdminBlogController::class, 'update']);
Route::delete('/v2/admin/blog/{id}', [\App\Http\Controllers\Api\AdminBlogController::class, 'destroy']);
Route::post('/v2/admin/blog/{id}/toggle-status', [\App\Http\Controllers\Api\AdminBlogController::class, 'toggleStatus']);
// Broker-or-admin: feed/comments/reviews moderation lives in the broker
// panel (/broker/moderation/*) since 2026-07-02. Controllers add self-dealing
// guards (a broker cannot moderate content they are a party to); announcer
// grant/revoke is privilege management and stays admin-only below.
// See BrokerModerationAuthorizationTest.
Route::withoutMiddleware('admin')->middleware('broker-or-admin')->group(function () {
    Route::get('/v2/admin/feed/posts', [\App\Http\Controllers\Api\AdminFeedController::class, 'index']);
    Route::get('/v2/admin/feed/posts/{id}', [\App\Http\Controllers\Api\AdminFeedController::class, 'show']);
    Route::post('/v2/admin/feed/posts/{id}/hide', [\App\Http\Controllers\Api\AdminFeedController::class, 'hide'])->middleware('throttle:nexus-route-60-per-1m');
    Route::delete('/v2/admin/feed/posts/{id}', [\App\Http\Controllers\Api\AdminFeedController::class, 'destroy'])->middleware('throttle:nexus-route-60-per-1m');
    Route::get('/v2/admin/feed/stats', [\App\Http\Controllers\Api\AdminFeedController::class, 'stats']);
    Route::get('/v2/admin/comments', [\App\Http\Controllers\Api\AdminCommentsController::class, 'index']);
    Route::get('/v2/admin/comments/{id}', [\App\Http\Controllers\Api\AdminCommentsController::class, 'show']);
    Route::post('/v2/admin/comments/{id}/hide', [\App\Http\Controllers\Api\AdminCommentsController::class, 'hide'])->middleware('throttle:nexus-route-60-per-1m');
    Route::delete('/v2/admin/comments/{id}', [\App\Http\Controllers\Api\AdminCommentsController::class, 'destroy'])->middleware('throttle:nexus-route-60-per-1m');
    Route::get('/v2/admin/reviews', [\App\Http\Controllers\Api\AdminReviewsController::class, 'index']);
    Route::get('/v2/admin/reviews/{id}', [\App\Http\Controllers\Api\AdminReviewsController::class, 'show']);
    Route::post('/v2/admin/reviews/{id}/flag', [\App\Http\Controllers\Api\AdminReviewsController::class, 'flag'])->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/admin/reviews/{id}/hide', [\App\Http\Controllers\Api\AdminReviewsController::class, 'hide'])->middleware('throttle:nexus-route-60-per-1m');
    Route::delete('/v2/admin/reviews/{id}', [\App\Http\Controllers\Api\AdminReviewsController::class, 'destroy'])->middleware('throttle:nexus-route-60-per-1m');
});
// AG14: Municipal Announcer role management — admin-only (privilege mgmt).
Route::post('/v2/admin/feed/grant-announcer', [\App\Http\Controllers\Api\AdminFeedController::class, 'grantAnnouncer']);
Route::delete('/v2/admin/feed/revoke-announcer/{id}', [\App\Http\Controllers\Api\AdminFeedController::class, 'revokeAnnouncer']);
Route::get('/v2/admin/support-reports', [\App\Http\Controllers\Api\AdminSupportReportController::class, 'index']);
Route::get('/v2/admin/support-reports/stats', [\App\Http\Controllers\Api\AdminSupportReportController::class, 'stats']);
Route::get('/v2/admin/support-reports/assignees', [\App\Http\Controllers\Api\AdminSupportReportController::class, 'assignees']);
Route::get('/v2/admin/support-reports/{id}', [\App\Http\Controllers\Api\AdminSupportReportController::class, 'show'])->whereNumber('id');
Route::put('/v2/admin/support-reports/{id}', [\App\Http\Controllers\Api\AdminSupportReportController::class, 'update'])->whereNumber('id');
Route::patch('/v2/admin/support-reports/{id}', [\App\Http\Controllers\Api\AdminSupportReportController::class, 'update'])->whereNumber('id');

// Public caring community endpoint — no auth required (invite lookup)
Route::get('/v2/caring-community/invite/{code}', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'lookupInvite'])
    ->withoutMiddleware(['auth:sanctum', 'admin', \App\Http\Middleware\EnsureIsAdmin::class])
    ->middleware('throttle:nexus-route-60-per-1m');

// Member-facing caring community endpoints (auth:sanctum via global middleware)
Route::withoutMiddleware(['admin', \App\Http\Middleware\EnsureIsAdmin::class])->group(function () {
    Route::post('/v2/caring-community/request-help', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'requestHelp'])
        ->middleware('throttle:nexus-route-10-per-1m');
    Route::post('/v2/caring-community/request-help/voice', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'requestHelpVoice'])
        ->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/caring-community/offer-favour', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'offerFavour'])
        ->middleware('throttle:nexus-route-10-per-1m');
});

Route::get('/v2/admin/caring-community/workflow', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'workflow']);
Route::put('/v2/admin/caring-community/workflow/policy', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'updatePolicy']);
Route::put('/v2/admin/caring-community/workflow/reviews/{id}/assign', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'assignReview']);
Route::put('/v2/admin/caring-community/workflow/reviews/{id}/escalate', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'escalateReview']);
Route::put('/v2/admin/caring-community/workflow/reviews/{id}/decision', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'decideReview']);
Route::get('/v2/admin/caring-community/role-presets', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'rolePresets']);
Route::post('/v2/admin/caring-community/role-presets/install', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'installRolePresets']);
Route::get('/v2/admin/caring-community/member-statements/{userId}', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'memberStatement']);
Route::get('/v2/admin/caring-community/support-relationships', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'supportRelationships']);
Route::post('/v2/admin/caring-community/support-relationships', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'createSupportRelationship']);
Route::put('/v2/admin/caring-community/support-relationships/{id}', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'updateSupportRelationship']);
Route::post('/v2/admin/caring-community/support-relationships/{id}/hours', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'logSupportRelationshipHours']);
Route::get('/v2/admin/caring-community/tandem-suggestions', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'tandemSuggestions']);
Route::post('/v2/admin/caring-community/tandem-suggestions/dismiss', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'dismissTandemSuggestion']);
Route::get('/v2/admin/caring-community/nudges/analytics', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'nudgeAnalytics']);
Route::put('/v2/admin/caring-community/nudges/config', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'updateNudgeConfig']);
Route::post('/v2/admin/caring-community/nudges/dispatch', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'dispatchNudges']);
Route::post('/v2/admin/caring-community/assisted-onboarding', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'assistedOnboarding']);
Route::get('/v2/admin/caring-community/paper-onboarding', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'paperOnboardingList']);
Route::post('/v2/admin/caring-community/paper-onboarding', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'paperOnboardingUpload']);
Route::post('/v2/admin/caring-community/paper-onboarding/{id}/confirm', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'paperOnboardingConfirm']);
Route::post('/v2/admin/caring-community/invite-codes', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'generateInviteCode']);
Route::get('/v2/admin/caring-community/invite-codes', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'listInviteCodes']);
Route::get('/v2/admin/caring-community/favours', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'listFavours']);
Route::get('/v2/admin/caring-community/forecast', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'forecast']);
Route::post('/v2/admin/caring-community/vereine/{organizationId}/members/import/preview', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'previewVereinMemberImport']);
Route::post('/v2/admin/caring-community/vereine/{organizationId}/members/import', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'importVereinMembers']);
Route::post('/v2/admin/caring-community/vereine/{organizationId}/admins', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'assignVereinAdmin']);
// Member-facing caring community endpoints (auth required, scoped to current user)
Route::withoutMiddleware(['admin', \App\Http\Middleware\EnsureIsAdmin::class])->group(function () {
    Route::get('/v2/caring-community/my-relationships', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'myRelationships']);
    Route::post('/v2/caring-community/my-relationships/{id}/pause', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'pauseRelationship']);
    Route::post('/v2/caring-community/my-relationships/{id}/end', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'endRelationship']);
    Route::post('/v2/caring-community/my-relationships/{id}/resume', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'resumeRelationship']);
    Route::put('/v2/caring-community/me/onboarding-choice', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'setOnboardingChoice']);
    Route::get('/v2/caring-community/my-future-care-fund', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'myFutureCareFund']);
    Route::get('/v2/caring-community/my-ahv-pension-export', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'myAhvPensionExport']);
    Route::get('/v2/caring-community/markt', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'markt']);
});
Route::post('/v2/caring-community/vereine/{organizationId}/members/import/preview', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'previewVereinMemberImport'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::post('/v2/caring-community/vereine/{organizationId}/members/import', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'importVereinMembers'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);

// Caring loyalty bridge (time credits ↔ marketplace) — member-facing
// Caring Community - regional points (A1), isolated and off by default
Route::withoutMiddleware(['admin', \App\Http\Middleware\EnsureIsAdmin::class])->group(function () {
    Route::get('/v2/caring-community/regional-points/summary', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'regionalPointsSummary']);
    Route::get('/v2/caring-community/regional-points/history', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'regionalPointsHistory']);
    Route::post('/v2/caring-community/regional-points/transfer', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'regionalPointsTransfer']);
    Route::get('/v2/caring-community/regional-points/marketplace/quote', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'regionalPointsMarketplaceQuote']);
    Route::post('/v2/caring-community/regional-points/marketplace/redeem', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'regionalPointsMarketplaceRedeem']);
});
Route::get('/v2/admin/caring-community/regional-points/config', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'regionalPointsConfig']);
Route::put('/v2/admin/caring-community/regional-points/config', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'updateRegionalPointsConfig']);
Route::get('/v2/admin/caring-community/regional-points/ledger', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'regionalPointsLedger']);
Route::post('/v2/admin/caring-community/regional-points/issue', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'issueRegionalPoints']);
Route::post('/v2/admin/caring-community/regional-points/adjust', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'adjustRegionalPoints']);
Route::get('/v2/admin/caring-community/regional-points/seller-settings/{userId}', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'getRegionalPointSellerSettings']);
Route::put('/v2/admin/caring-community/regional-points/seller-settings', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'updateRegionalPointSellerSettings']);

Route::withoutMiddleware(['admin', \App\Http\Middleware\EnsureIsAdmin::class])->group(function () {
    Route::get('/v2/caring-community/loyalty/quote', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'loyaltyQuote']);
    Route::post('/v2/caring-community/loyalty/redeem', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'loyaltyRedeem']);
    Route::get('/v2/caring-community/loyalty/my-history', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'loyaltyMyHistory']);
});

// Caring Community — Member-side GDPR/FADP data export (E3)
Route::get('/v2/caring-community/me/data-export', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'myDataExport'])
    ->withoutMiddleware(['admin', \App\Http\Middleware\EnsureIsAdmin::class]);

// Caring Community — federation directory (browse discoverable peer communities)
Route::get('/v2/caring-community/federation-directory', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'federationDirectory'])
    ->withoutMiddleware(['admin', \App\Http\Middleware\EnsureIsAdmin::class]);

// Caring Community — cooperative-to-cooperative banked-hour transfer (K3)
Route::withoutMiddleware(['admin', \App\Http\Middleware\EnsureIsAdmin::class])->group(function () {
    Route::post('/v2/caring-community/hour-transfer/initiate', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'hourTransferInitiate']);
    Route::get('/v2/caring-community/hour-transfer/my-history', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'hourTransferMyHistory']);
});
Route::get('/v2/admin/caring-community/hour-transfer/pending', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'hourTransferPending']);
Route::post('/v2/admin/caring-community/hour-transfer/{id}/approve', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'hourTransferApprove']);
Route::post('/v2/admin/caring-community/hour-transfer/{id}/reject', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'hourTransferReject']);
Route::get('/v2/admin/caring-community/hour-transfer/inbound', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'hourTransferInbound']);

// Caring Community — K5: time-credit gifting (member-to-member, same-tenant)
Route::withoutMiddleware(['admin', \App\Http\Middleware\EnsureIsAdmin::class])->group(function () {
    Route::post('/v2/caring-community/hour-gifts/send', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'hourGiftSend']);
    Route::post('/v2/caring-community/hour-gifts/{id}/accept', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'hourGiftAccept']);
    Route::post('/v2/caring-community/hour-gifts/{id}/decline', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'hourGiftDecline']);
    Route::post('/v2/caring-community/hour-gifts/{id}/revert', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'hourGiftRevert']);
    Route::get('/v2/caring-community/hour-gifts/inbox', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'hourGiftInbox']);
    Route::get('/v2/caring-community/hour-gifts/sent', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'hourGiftSent']);
});

// AG55 — Verein-to-Verein federation (admin + member-facing)
// Verein admin endpoints (consent, network, event sharing). Use the controller's
// own role check (verein_admin or tenant admin); skip the global EnsureIsAdmin
// alias so a Verein admin who isn't a platform admin can still access them.
Route::get('/v2/vereine/{organizationId}/federation-consent', [\App\Http\Controllers\Api\Verein\VereinFederationAdminController::class, 'getConsent'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::put('/v2/vereine/{organizationId}/federation-consent', [\App\Http\Controllers\Api\Verein\VereinFederationAdminController::class, 'updateConsent'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/vereine/{organizationId}/network', [\App\Http\Controllers\Api\Verein\VereinFederationAdminController::class, 'getNetwork'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::post('/v2/vereine/{organizationId}/share-event', [\App\Http\Controllers\Api\Verein\VereinFederationAdminController::class, 'shareEvent'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/vereine/{organizationId}/shared-events', [\App\Http\Controllers\Api\Verein\VereinFederationAdminController::class, 'listSharedEvents'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::delete('/v2/vereine/{organizationId}/event-shares/{shareId}', [\App\Http\Controllers\Api\Verein\VereinFederationAdminController::class, 'withdrawShare'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);

// Member-facing AG55 endpoints (any authed user)
Route::get('/v2/vereine/{organizationId}/cross-invitations', [\App\Http\Controllers\Api\Verein\VereinFederationMemberController::class, 'listForVerein'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::post('/v2/vereine/{organizationId}/cross-invitations', [\App\Http\Controllers\Api\Verein\VereinFederationMemberController::class, 'create'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/vereine/cross-invite-targets/{userId}', [\App\Http\Controllers\Api\Verein\VereinFederationMemberController::class, 'crossInviteTargets'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/me/verein-invitations', [\App\Http\Controllers\Api\Verein\VereinFederationMemberController::class, 'listMine'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::post('/v2/me/verein-invitations/{id}/respond', [\App\Http\Controllers\Api\Verein\VereinFederationMemberController::class, 'respond'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
// Public municipality events calendar (consent-gated upstream; throttled)
Route::get('/v2/municipality/events-calendar', [\App\Http\Controllers\Api\Verein\VereinFederationMemberController::class, 'defaultMunicipalityCalendar'])
    ->middleware('throttle:nexus-route-30-per-1m')
    ->withoutMiddleware(['auth:sanctum', \App\Http\Middleware\EnsureIsAdmin::class]);
Route::get('/v2/municipality/{municipalityCode}/events-calendar', [\App\Http\Controllers\Api\Verein\VereinFederationMemberController::class, 'municipalityCalendar'])
    ->middleware('throttle:nexus-route-30-per-1m')
    ->withoutMiddleware(['auth:sanctum', \App\Http\Middleware\EnsureIsAdmin::class]);

// Caring Community — Safeguarding reports (K9)
// AG32 — KISS estate / legacy hours
Route::get('/v2/caring-community/hour-estate', [\App\Http\Controllers\Api\HourEstateController::class, 'myEstate'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::put('/v2/caring-community/hour-estate', [\App\Http\Controllers\Api\HourEstateController::class, 'nominate'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/admin/caring-community/hour-estates', [\App\Http\Controllers\Api\HourEstateController::class, 'adminIndex']);
Route::post('/v2/admin/caring-community/hour-estates/{id}/report-deceased', [\App\Http\Controllers\Api\HourEstateController::class, 'reportDeceased']);
Route::post('/v2/admin/caring-community/hour-estates/{id}/settle', [\App\Http\Controllers\Api\HourEstateController::class, 'settle']);

// AG33 — KISS Treffen ritual meeting subtype
Route::get('/v2/caring-community/kiss-treffen', [\App\Http\Controllers\Api\KissTreffenController::class, 'index'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/caring-community/kiss-treffen/{eventId}', [\App\Http\Controllers\Api\KissTreffenController::class, 'show'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::put('/v2/admin/caring-community/kiss-treffen/{eventId}', [\App\Http\Controllers\Api\KissTreffenController::class, 'adminUpsert']);
Route::post('/v2/admin/caring-community/kiss-treffen/{eventId}/minutes', [\App\Http\Controllers\Api\KissTreffenController::class, 'adminRecordMinutes']);

Route::withoutMiddleware(['admin', \App\Http\Middleware\EnsureIsAdmin::class])->group(function () {
    Route::post('/v2/caring-community/safeguarding/report', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'safeguardingReport']);
    Route::get('/v2/caring-community/safeguarding/my-reports', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'safeguardingMyReports']);
});
// Deliberately auth-only (no `admin` middleware): AdminCaringCommunityController's
// guardSafeguarding() grants access to non-admin safeguarding officers (users with
// safeguarding.view/manage permissions) plus coordinators/brokers for view-level
// actions. Adding `admin` here would lock those legitimate roles out.
Route::withoutMiddleware(['admin', \App\Http\Middleware\EnsureIsAdmin::class])->group(function () {
    Route::get('/v2/admin/caring-community/safeguarding/dashboard', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'safeguardingDashboard']);
    Route::get('/v2/admin/caring-community/safeguarding/reports', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'safeguardingList']);
    Route::get('/v2/admin/caring-community/safeguarding/reports/{id}', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'safeguardingShow']);
    Route::post('/v2/admin/caring-community/safeguarding/reports/{id}/assign', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'safeguardingAssign']);
    Route::post('/v2/admin/caring-community/safeguarding/reports/{id}/escalate', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'safeguardingEscalate']);
    Route::post('/v2/admin/caring-community/safeguarding/reports/{id}/status', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'safeguardingStatus']);
    Route::post('/v2/admin/caring-community/safeguarding/reports/{id}/note', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'safeguardingNote']);
});

// Caring loyalty bridge — admin
Route::get('/v2/admin/caring-community/loyalty/redemptions', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'listLoyaltyRedemptions']);
Route::get('/v2/admin/caring-community/loyalty/seller-settings/{userId}', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'getLoyaltySellerSettings']);
Route::put('/v2/admin/caring-community/loyalty/seller-settings', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'updateLoyaltySellerSettings']);
Route::post('/v2/admin/caring-community/loyalty/redemptions/{id}/reverse', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'reverseLoyaltyRedemption']);

// AG64 — Care-Provider Directory
Route::get('/v2/caring-community/providers', [\App\Http\Controllers\Api\CareProviderDirectoryController::class, 'index'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/caring-community/providers/{id}', [\App\Http\Controllers\Api\CareProviderDirectoryController::class, 'show'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/caring-community/sub-regions', [\App\Http\Controllers\Api\CaringSubRegionController::class, 'index'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/admin/caring-community/providers', [\App\Http\Controllers\Api\CareProviderDirectoryController::class, 'adminIndex']);
Route::get('/v2/admin/caring-community/providers/duplicates', [\App\Http\Controllers\Api\CareProviderDirectoryController::class, 'adminDuplicates']);
Route::post('/v2/admin/caring-community/providers', [\App\Http\Controllers\Api\CareProviderDirectoryController::class, 'store']);
Route::put('/v2/admin/caring-community/providers/{id}', [\App\Http\Controllers\Api\CareProviderDirectoryController::class, 'adminUpdate']);
Route::delete('/v2/admin/caring-community/providers/{id}', [\App\Http\Controllers\Api\CareProviderDirectoryController::class, 'adminDelete']);
Route::post('/v2/admin/caring-community/providers/{id}/verify', [\App\Http\Controllers\Api\CareProviderDirectoryController::class, 'adminVerify']);
Route::get('/v2/admin/caring-community/sub-regions', [\App\Http\Controllers\Api\CaringSubRegionController::class, 'adminIndex']);
Route::post('/v2/admin/caring-community/sub-regions', [\App\Http\Controllers\Api\CaringSubRegionController::class, 'store']);
Route::put('/v2/admin/caring-community/sub-regions/{id}', [\App\Http\Controllers\Api\CaringSubRegionController::class, 'update']);
Route::delete('/v2/admin/caring-community/sub-regions/{id}', [\App\Http\Controllers\Api\CaringSubRegionController::class, 'delete']);

// AG67 — Trust Tier System
Route::get('/v2/caring-community/my-trust-tier', [\App\Http\Controllers\Api\TrustTierController::class, 'myTier'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
// Task D — transparency: per-signal trust tier breakdown for the authenticated member
Route::get('/v2/caring-community/me/trust-tier/breakdown', [\App\Http\Controllers\Api\CaringCommunityApiController::class, 'myTrustTierBreakdown'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/admin/caring-community/trust-tier/config', [\App\Http\Controllers\Api\TrustTierController::class, 'getTierConfig']);
Route::put('/v2/admin/caring-community/trust-tier/config', [\App\Http\Controllers\Api\TrustTierController::class, 'updateTierConfig']);
Route::post('/v2/admin/caring-community/trust-tier/recompute', [\App\Http\Controllers\Api\TrustTierController::class, 'recomputeTiers']);

// AG71 — Warmth Pass
Route::get('/v2/caring-community/my-warmth-pass', [\App\Http\Controllers\Api\WarmthPassController::class, 'myPass'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/admin/caring-community/warmth-pass/{userId}', [\App\Http\Controllers\Api\WarmthPassController::class, 'adminViewPass']);

// Care Recipient Circle + Municipal ROI
Route::get('/v2/admin/caring-community/recipient/{userId}/circle', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'recipientCircle']);
Route::get('/v2/admin/caring-community/municipal-roi', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'municipalRoi']);
Route::get('/v2/admin/caring-community/municipal-roi/export', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'municipalRoiExport']);
Route::get('/v2/admin/caring-community/category-coefficients', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'listCategoryCoefficients']);
Route::put('/v2/admin/caring-community/category-coefficients/{id}', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'updateCategoryCoefficient']);

// AG68 — Caregiver/Angehörigen Support Flow
Route::get('/v2/caring-community/caregiver/links', [\App\Http\Controllers\Api\CaregiverApiController::class, 'myLinks'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::post('/v2/caring-community/caregiver/links', [\App\Http\Controllers\Api\CaregiverApiController::class, 'addLink'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::delete('/v2/caring-community/caregiver/links/{id}', [\App\Http\Controllers\Api\CaregiverApiController::class, 'removeLink'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/caring-community/caregiver/schedule/{caredForId}', [\App\Http\Controllers\Api\CaregiverApiController::class, 'caregiverSchedule'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/caring-community/caregiver/burnout-check', [\App\Http\Controllers\Api\CaregiverApiController::class, 'burnoutCheck'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::post('/v2/caring-community/caregiver/request-on-behalf', [\App\Http\Controllers\Api\CaregiverApiController::class, 'requestOnBehalf'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/caring-community/caregiver/cover-requests', [\App\Http\Controllers\Api\CaregiverApiController::class, 'coverRequests'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::post('/v2/caring-community/caregiver/cover-requests', [\App\Http\Controllers\Api\CaregiverApiController::class, 'createCoverRequest'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/caring-community/caregiver/cover-requests/{id}/candidates', [\App\Http\Controllers\Api\CaregiverApiController::class, 'coverCandidates'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::post('/v2/caring-community/caregiver/cover-requests/{id}/assign', [\App\Http\Controllers\Api\CaregiverApiController::class, 'assignCoverCandidate'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);

// AG66 — KPI Baseline
Route::get('/v2/admin/caring-community/kpi-baselines', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'listKpiBaselines']);
Route::post('/v2/admin/caring-community/kpi-baselines', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'captureKpiBaseline']);
Route::get('/v2/admin/caring-community/kpi-baselines/{id}/compare', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'compareKpiBaseline']);

// AG83 — Pilot Success Scoreboard
Route::get('/v2/admin/caring-community/pilot-scoreboard', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'pilotScoreboard']);
Route::get('/v2/admin/caring-community/pilot-scoreboard/baselines', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'pilotScoreboardBaselines']);
Route::post('/v2/admin/caring-community/pilot-scoreboard/pre-pilot', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'capturePrePilotBaseline']);
Route::post('/v2/admin/caring-community/pilot-scoreboard/quarterly', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'captureQuarterlyReview']);

// AG81 — Operating Policy
Route::get('/v2/admin/caring-community/operating-policy', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'operatingPolicyShow']);
Route::put('/v2/admin/caring-community/operating-policy', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'operatingPolicyUpdate']);

// AG80 — FADP/nDSG Disclosure Pack
Route::get('/v2/admin/caring-community/disclosure-pack', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'disclosurePackShow']);
Route::put('/v2/admin/caring-community/disclosure-pack', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'disclosurePackUpdate']);
Route::get('/v2/admin/caring-community/disclosure-pack/export', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'disclosurePackExport']);

// AG84 — Pilot Data Quality
Route::get('/v2/admin/caring-community/data-quality/dashboard', [\App\Http\Controllers\Api\Admin\TenantDataQualityController::class, 'dashboard']);
Route::get('/v2/admin/caring-community/data-quality/checks/{checkKey}/rows', [\App\Http\Controllers\Api\Admin\TenantDataQualityController::class, 'affectedRows']);

// AG82 — Commercial Boundary Map
Route::get('/v2/admin/caring-community/commercial-boundary', [\App\Http\Controllers\Api\Admin\CommercialBoundaryController::class, 'matrix']);
Route::put('/v2/admin/caring-community/commercial-boundary/override', [\App\Http\Controllers\Api\Admin\CommercialBoundaryController::class, 'setOverride']);

// AG85 — Isolated-Node Decision Gate
Route::get('/v2/admin/caring-community/isolated-node', [\App\Http\Controllers\Api\Admin\IsolatedNodeController::class, 'index']);
Route::put('/v2/admin/caring-community/isolated-node/items/{itemKey}', [\App\Http\Controllers\Api\Admin\IsolatedNodeController::class, 'update']);

// AG87 — External Integration Backlog
Route::get('/v2/admin/caring-community/external-integrations', [\App\Http\Controllers\Api\Admin\ExternalIntegrationController::class, 'index']);
Route::post('/v2/admin/caring-community/external-integrations/seed-defaults', [\App\Http\Controllers\Api\Admin\ExternalIntegrationController::class, 'seedDefaults']);
Route::post('/v2/admin/caring-community/external-integrations', [\App\Http\Controllers\Api\Admin\ExternalIntegrationController::class, 'store']);
Route::put('/v2/admin/caring-community/external-integrations/{itemId}', [\App\Http\Controllers\Api\Admin\ExternalIntegrationController::class, 'update']);
Route::delete('/v2/admin/caring-community/external-integrations/{itemId}', [\App\Http\Controllers\Api\Admin\ExternalIntegrationController::class, 'destroy']);

// AG95 — Pilot Launch Readiness Dashboard
Route::get('/v2/admin/caring-community/launch-readiness', [\App\Http\Controllers\Api\Admin\PilotLaunchReadinessController::class, 'index']);
Route::post('/v2/admin/caring-community/launch-readiness/acknowledge-boundary', [\App\Http\Controllers\Api\Admin\PilotLaunchReadinessController::class, 'acknowledgeBoundary']);
Route::post('/v2/admin/caring-community/launch-readiness/launch', [\App\Http\Controllers\Api\AdminCaringCommunityController::class, 'launchPilot']);

// AG96 — Help Request SLA Breach Dashboard
Route::get('/v2/admin/caring-community/sla-dashboard', [\App\Http\Controllers\Api\Admin\HelpRequestSlaController::class, 'dashboard']);

// AG89 — Municipal Communication & Moderation Copilot
Route::get('/v2/admin/caring-community/copilot/proposals', [\App\Http\Controllers\Api\Admin\MunicipalCopilotController::class, 'index']);
Route::post('/v2/admin/caring-community/copilot/proposals', [\App\Http\Controllers\Api\Admin\MunicipalCopilotController::class, 'generate']);
Route::post('/v2/admin/caring-community/copilot/proposals/{proposalId}/accept', [\App\Http\Controllers\Api\Admin\MunicipalCopilotController::class, 'accept']);
Route::post('/v2/admin/caring-community/copilot/proposals/{proposalId}/reject', [\App\Http\Controllers\Api\Admin\MunicipalCopilotController::class, 'reject']);

// AG90 — Personalised Civic Digest
Route::get('/v2/caring-community/digest', [\App\Http\Controllers\Api\CivicDigestController::class, 'myDigest'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/caring-community/digest/prefs', [\App\Http\Controllers\Api\CivicDigestController::class, 'myPrefs'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::put('/v2/caring-community/digest/prefs', [\App\Http\Controllers\Api\CivicDigestController::class, 'updateMyPrefs'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/admin/caring-community/digest/cadence', [\App\Http\Controllers\Api\CivicDigestController::class, 'tenantCadence']);
Route::put('/v2/admin/caring-community/digest/cadence', [\App\Http\Controllers\Api\CivicDigestController::class, 'setTenantCadence']);

// AG91 — Success-Story Proof Cards
Route::get('/v2/caring-community/success-stories', [\App\Http\Controllers\Api\SuccessStoryController::class, 'index'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/admin/caring-community/success-stories', [\App\Http\Controllers\Api\Admin\SuccessStoryAdminController::class, 'index']);
Route::post('/v2/admin/caring-community/success-stories/seed-demo', [\App\Http\Controllers\Api\Admin\SuccessStoryAdminController::class, 'seed']);
Route::post('/v2/admin/caring-community/success-stories', [\App\Http\Controllers\Api\Admin\SuccessStoryAdminController::class, 'store']);
Route::put('/v2/admin/caring-community/success-stories/{storyId}', [\App\Http\Controllers\Api\Admin\SuccessStoryAdminController::class, 'update']);
Route::delete('/v2/admin/caring-community/success-stories/{storyId}', [\App\Http\Controllers\Api\Admin\SuccessStoryAdminController::class, 'destroy']);
Route::post('/v2/admin/caring-community/success-stories/{storyId}/refresh-live', [\App\Http\Controllers\Api\Admin\SuccessStoryAdminController::class, 'refresh']);

// AG92 — Two-Way Municipality Feedback Inbox
Route::post('/v2/caring-community/feedback', [\App\Http\Controllers\Api\MunicipalityFeedbackController::class, 'submit'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/caring-community/feedback/mine', [\App\Http\Controllers\Api\MunicipalityFeedbackController::class, 'myList'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/admin/caring-community/feedback/dashboard', [\App\Http\Controllers\Api\Admin\AdminMunicipalityFeedbackController::class, 'dashboard']);
Route::get('/v2/admin/caring-community/feedback/export.csv', [\App\Http\Controllers\Api\Admin\AdminMunicipalityFeedbackController::class, 'exportCsv']);
Route::get('/v2/admin/caring-community/feedback', [\App\Http\Controllers\Api\Admin\AdminMunicipalityFeedbackController::class, 'index']);
Route::get('/v2/admin/caring-community/feedback/{id}', [\App\Http\Controllers\Api\Admin\AdminMunicipalityFeedbackController::class, 'show'])->whereNumber('id');
Route::put('/v2/admin/caring-community/feedback/{id}/triage', [\App\Http\Controllers\Api\Admin\AdminMunicipalityFeedbackController::class, 'triage'])->whereNumber('id');
Route::post('/v2/admin/caring-community/feedback/{id}/resolve', [\App\Http\Controllers\Api\Admin\AdminMunicipalityFeedbackController::class, 'resolve'])->whereNumber('id');
Route::post('/v2/admin/caring-community/feedback/{id}/close', [\App\Http\Controllers\Api\Admin\AdminMunicipalityFeedbackController::class, 'close'])->whereNumber('id');

// AG93 — Open-Standards and Integration Showcase
Route::get('/v2/admin/caring-community/integration-showcase', [\App\Http\Controllers\Api\Admin\IntegrationShowcaseController::class, 'index']);

// AG94 — Newsletter and Pilot-Region Lead Nurture
Route::post('/v2/caring-community/leads/capture', [\App\Http\Controllers\Api\LeadCaptureController::class, 'capture'])
    ->withoutMiddleware(['auth:sanctum', 'admin'])
    ->middleware('throttle:nexus-route-10-per-1m');
Route::get('/v2/admin/caring-community/leads/summary', [\App\Http\Controllers\Api\Admin\LeadNurtureAdminController::class, 'summary']);
Route::get('/v2/admin/caring-community/leads/export.csv', [\App\Http\Controllers\Api\Admin\LeadNurtureAdminController::class, 'exportCsv']);
Route::get('/v2/admin/caring-community/leads', [\App\Http\Controllers\Api\Admin\LeadNurtureAdminController::class, 'index']);
Route::put('/v2/admin/caring-community/leads/{contactId}', [\App\Http\Controllers\Api\Admin\LeadNurtureAdminController::class, 'update']);
Route::post('/v2/admin/caring-community/leads/{contactId}/unsubscribe', [\App\Http\Controllers\Api\Admin\LeadNurtureAdminController::class, 'unsubscribe']);

// AG65 — Academic / research partnership framework
Route::get('/v2/caring-community/research/consent', [\App\Http\Controllers\Api\ResearchPartnershipController::class, 'myConsent'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::put('/v2/caring-community/research/consent', [\App\Http\Controllers\Api\ResearchPartnershipController::class, 'updateMyConsent'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/admin/caring-community/research/partners', [\App\Http\Controllers\Api\ResearchPartnershipController::class, 'adminIndex']);
Route::post('/v2/admin/caring-community/research/partners', [\App\Http\Controllers\Api\ResearchPartnershipController::class, 'adminStore']);
Route::post('/v2/admin/caring-community/research/partners/{partnerId}/dataset-exports', [\App\Http\Controllers\Api\ResearchPartnershipController::class, 'adminGenerateDataset'])
    ->middleware('throttle:bulk-export');
Route::get('/v2/admin/caring-community/research/dataset-exports', [\App\Http\Controllers\Api\ResearchPartnershipController::class, 'adminDatasetExports']);
Route::post('/v2/admin/caring-community/research/dataset-exports/{exportId}/revoke', [\App\Http\Controllers\Api\ResearchPartnershipController::class, 'adminRevokeDatasetExport']);
Route::get('/v2/admin/caring-community/research/agreement-templates', [\App\Http\Controllers\Api\ResearchPartnershipController::class, 'adminListAgreementTemplates']);
Route::post('/v2/admin/caring-community/research/agreement-templates/{key}/render', [\App\Http\Controllers\Api\ResearchPartnershipController::class, 'adminRenderAgreementTemplate']);

// AG23 follow-up — Cross-platform federation peers
Route::get('/v2/admin/caring-community/federation-peers', [\App\Http\Controllers\Api\AdminFederationPeerController::class, 'index']);
Route::post('/v2/admin/caring-community/federation-peers', [\App\Http\Controllers\Api\AdminFederationPeerController::class, 'store']);
Route::put('/v2/admin/caring-community/federation-peers/{id}/status', [\App\Http\Controllers\Api\AdminFederationPeerController::class, 'updateStatus']);
Route::post('/v2/admin/caring-community/federation-peers/{id}/rotate-secret', [\App\Http\Controllers\Api\AdminFederationPeerController::class, 'rotateSecret']);
Route::delete('/v2/admin/caring-community/federation-peers/{id}', [\App\Http\Controllers\Api\AdminFederationPeerController::class, 'destroy']);

// AG23 follow-up — Public inbound federation endpoint registered outside the auth+admin group at end of file

// AG70 — Emergency/Safety Alert Tier
Route::get('/v2/caring-community/emergency-alerts', [\App\Http\Controllers\Api\EmergencyAlertController::class, 'activeAlerts'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::post('/v2/caring-community/emergency-alerts/{id}/dismiss', [\App\Http\Controllers\Api\EmergencyAlertController::class, 'dismiss'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/admin/caring-community/emergency-alerts', [\App\Http\Controllers\Api\EmergencyAlertController::class, 'adminList']);
Route::post('/v2/admin/caring-community/emergency-alerts', [\App\Http\Controllers\Api\EmergencyAlertController::class, 'store']);
Route::delete('/v2/admin/caring-community/emergency-alerts/{id}', [\App\Http\Controllers\Api\EmergencyAlertController::class, 'deactivate']);

// AG69 — Multi-stage project announcement tracking
Route::get('/v2/caring-community/projects', [\App\Http\Controllers\Api\ProjectAnnouncementController::class, 'index'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/caring-community/projects/{id}', [\App\Http\Controllers\Api\ProjectAnnouncementController::class, 'show'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::post('/v2/caring-community/projects/{id}/subscribe', [\App\Http\Controllers\Api\ProjectAnnouncementController::class, 'subscribe'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::delete('/v2/caring-community/projects/{id}/subscribe', [\App\Http\Controllers\Api\ProjectAnnouncementController::class, 'unsubscribe'])
    ->withoutMiddleware(\App\Http\Middleware\EnsureIsAdmin::class);
Route::get('/v2/admin/caring-community/projects', [\App\Http\Controllers\Api\ProjectAnnouncementController::class, 'adminIndex']);
Route::post('/v2/admin/caring-community/projects', [\App\Http\Controllers\Api\ProjectAnnouncementController::class, 'adminStore']);
Route::get('/v2/admin/caring-community/projects/{id}', [\App\Http\Controllers\Api\ProjectAnnouncementController::class, 'adminShow']);
Route::put('/v2/admin/caring-community/projects/{id}', [\App\Http\Controllers\Api\ProjectAnnouncementController::class, 'adminUpdate']);
Route::post('/v2/admin/caring-community/projects/{id}/publish', [\App\Http\Controllers\Api\ProjectAnnouncementController::class, 'adminPublish']);
Route::post('/v2/admin/caring-community/projects/{id}/updates', [\App\Http\Controllers\Api\ProjectAnnouncementController::class, 'adminCreateUpdate']);
Route::post('/v2/admin/caring-community/project-updates/{id}/publish', [\App\Http\Controllers\Api\ProjectAnnouncementController::class, 'adminPublishUpdate']);

// NOTE: the AdminReportsController member-report routes (index/stats/{id}/
// resolve/dismiss) are broker-or-admin — they live in the group BELOW the
// literal /reports/* analytics routes so `{id}` cannot shadow them.
Route::get('/v2/admin/reports/social-value', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'socialValue']);
Route::put('/v2/admin/reports/social-value/config', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'updateSocialValueConfig']);
Route::get('/v2/admin/reports/members', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'memberReports']);
Route::get('/v2/admin/reports/hours', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'hoursReports']);
Route::get('/v2/admin/reports/municipal-impact', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'municipalImpact']);
Route::get('/v2/admin/reports/municipal-impact/verification', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'municipalVerification']);
Route::post('/v2/admin/reports/municipal-impact/verification/dns', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'startMunicipalDnsVerification']);
Route::post('/v2/admin/reports/municipal-impact/verification/attest', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'attestMunicipalVerification']);
Route::post('/v2/admin/reports/municipal-impact/verification/{id}/revoke', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'revokeMunicipalVerification']);
Route::get('/v2/admin/reports/municipal-impact/templates', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'municipalImpactTemplates']);
Route::post('/v2/admin/reports/municipal-impact/templates', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'createMunicipalImpactTemplate']);
Route::put('/v2/admin/reports/municipal-impact/templates/{id}', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'updateMunicipalImpactTemplate']);
Route::delete('/v2/admin/reports/municipal-impact/templates/{id}', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'deleteMunicipalImpactTemplate']);
Route::get('/v2/admin/reports/export-types', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'exportTypes']);
Route::get('/v2/admin/reports/{type}/export', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'exportReport']);
// Broker-or-admin: member-content reports triage lives in the broker panel
// (/broker/moderation/reports) since 2026-07-02. The controller adds a
// self-dealing guard (a broker cannot resolve/dismiss a report they filed or
// that targets them). Registered AFTER the literal /reports/* analytics
// routes above so {id} does not shadow them. See
// BrokerModerationAuthorizationTest.
Route::withoutMiddleware('admin')->middleware('broker-or-admin')->group(function () {
    Route::get('/v2/admin/reports', [\App\Http\Controllers\Api\AdminReportsController::class, 'index']);
    Route::get('/v2/admin/reports/stats', [\App\Http\Controllers\Api\AdminReportsController::class, 'stats']);
    Route::get('/v2/admin/reports/{id}', [\App\Http\Controllers\Api\AdminReportsController::class, 'show']);
    Route::post('/v2/admin/reports/{id}/resolve', [\App\Http\Controllers\Api\AdminReportsController::class, 'resolve'])->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/admin/reports/{id}/dismiss', [\App\Http\Controllers\Api\AdminReportsController::class, 'dismiss'])->middleware('throttle:nexus-route-60-per-1m');
});
Route::get('/v2/admin/gamification/stats', [\App\Http\Controllers\Api\AdminGamificationController::class, 'stats']);
Route::get('/v2/admin/gamification/badges', [\App\Http\Controllers\Api\AdminGamificationController::class, 'badges']);
Route::post('/v2/admin/gamification/badges', [\App\Http\Controllers\Api\AdminGamificationController::class, 'createBadge']);
Route::delete('/v2/admin/gamification/badges/{id}', [\App\Http\Controllers\Api\AdminGamificationController::class, 'deleteBadge']);
Route::get('/v2/admin/gamification/campaigns', [\App\Http\Controllers\Api\AdminGamificationController::class, 'campaigns']);
Route::post('/v2/admin/gamification/campaigns', [\App\Http\Controllers\Api\AdminGamificationController::class, 'createCampaign']);
Route::put('/v2/admin/gamification/campaigns/{id}', [\App\Http\Controllers\Api\AdminGamificationController::class, 'updateCampaign']);
Route::delete('/v2/admin/gamification/campaigns/{id}', [\App\Http\Controllers\Api\AdminGamificationController::class, 'deleteCampaign']);
Route::get('/v2/admin/gamification/challenges', [\App\Http\Controllers\Api\AdminGamificationController::class, 'challenges']);
Route::post('/v2/admin/gamification/challenges', [\App\Http\Controllers\Api\AdminGamificationController::class, 'createChallenge']);
Route::put('/v2/admin/gamification/challenges/{id}', [\App\Http\Controllers\Api\AdminGamificationController::class, 'updateChallenge'])->whereNumber('id');
Route::delete('/v2/admin/gamification/challenges/{id}', [\App\Http\Controllers\Api\AdminGamificationController::class, 'deleteChallenge'])->whereNumber('id');
Route::post('/v2/admin/gamification/recheck-all', [\App\Http\Controllers\Api\AdminGamificationController::class, 'recheckAll']);
Route::post('/v2/admin/gamification/bulk-award', [\App\Http\Controllers\Api\AdminGamificationController::class, 'bulkAward']);
Route::get('/v2/admin/gamification/badge-config', [\App\Http\Controllers\Api\AdminGamificationController::class, 'getBadgeConfig']);
Route::put('/v2/admin/gamification/badge-config/{badgeKey}', [\App\Http\Controllers\Api\AdminGamificationController::class, 'updateBadgeConfig']);
Route::post('/v2/admin/gamification/badge-config/{badgeKey}/reset', [\App\Http\Controllers\Api\AdminGamificationController::class, 'resetBadgeConfig']);
Route::where([
    'id' => '[0-9]+',
    'groupId' => '[0-9]+',
    'userId' => '[0-9]+',
    'tagId' => '[0-9]+',
])->group(function () {
Route::get('/v2/admin/groups', [\App\Http\Controllers\Api\AdminGroupsController::class, 'index']);
Route::get('/v2/admin/groups/analytics', [\App\Http\Controllers\Api\AdminGroupsController::class, 'analytics']);
Route::get('/v2/admin/groups/approvals', [\App\Http\Controllers\Api\AdminGroupsController::class, 'approvals']);
Route::post('/v2/admin/groups/approvals/{id}/approve', [\App\Http\Controllers\Api\AdminGroupsController::class, 'approveMember']);
Route::post('/v2/admin/groups/approvals/{id}/reject', [\App\Http\Controllers\Api\AdminGroupsController::class, 'rejectMember']);
Route::get('/v2/admin/groups/moderation', [\App\Http\Controllers\Api\AdminGroupsController::class, 'moderation']);
Route::get('/v2/admin/groups/types', [\App\Http\Controllers\Api\AdminGroupsController::class, 'getGroupTypes']);
Route::post('/v2/admin/groups/types', [\App\Http\Controllers\Api\AdminGroupsController::class, 'createGroupType']);
Route::put('/v2/admin/groups/types/{id}', [\App\Http\Controllers\Api\AdminGroupsController::class, 'updateGroupType']);
Route::delete('/v2/admin/groups/types/{id}', [\App\Http\Controllers\Api\AdminGroupsController::class, 'deleteGroupType']);
Route::post('/v2/admin/groups/batch-geocode', [\App\Http\Controllers\Api\AdminGroupsController::class, 'batchGeocode']);
Route::get('/v2/admin/groups/recommendations', [\App\Http\Controllers\Api\AdminGroupsController::class, 'getRecommendationData']);
Route::get('/v2/admin/groups/featured', [\App\Http\Controllers\Api\AdminGroupsController::class, 'getFeaturedGroups']);
Route::post('/v2/admin/groups/featured/update', [\App\Http\Controllers\Api\AdminGroupsController::class, 'updateFeaturedGroups']);
Route::put('/v2/admin/groups/{id}/status', [\App\Http\Controllers\Api\AdminGroupsController::class, 'updateStatus']);
Route::delete('/v2/admin/groups/{id}', [\App\Http\Controllers\Api\AdminGroupsController::class, 'deleteGroup']);
Route::get('/v2/admin/groups/{id}', [\App\Http\Controllers\Api\AdminGroupsController::class, 'getGroup']);
Route::put('/v2/admin/groups/{id}', [\App\Http\Controllers\Api\AdminGroupsController::class, 'updateGroup']);
Route::put('/v2/admin/groups/{id}/toggle-featured', [\App\Http\Controllers\Api\AdminGroupsController::class, 'toggleFeatured']);
Route::post('/v2/admin/groups/{id}/geocode', [\App\Http\Controllers\Api\AdminGroupsController::class, 'geocodeGroup']);
Route::get('/v2/admin/groups/{groupId}/members', [\App\Http\Controllers\Api\AdminGroupsController::class, 'getMembers']);
Route::post('/v2/admin/groups/{groupId}/members/{userId}/promote', [\App\Http\Controllers\Api\AdminGroupsController::class, 'promoteMember']);
Route::post('/v2/admin/groups/{groupId}/members/{userId}/demote', [\App\Http\Controllers\Api\AdminGroupsController::class, 'demoteMember']);
Route::delete('/v2/admin/groups/{groupId}/members/{userId}', [\App\Http\Controllers\Api\AdminGroupsController::class, 'kickMember']);
Route::post('/v2/admin/groups/bulk-archive', [\App\Http\Controllers\Api\AdminGroupsController::class, 'bulkArchive']);
Route::post('/v2/admin/groups/bulk-unarchive', [\App\Http\Controllers\Api\AdminGroupsController::class, 'bulkUnarchive']);
Route::post('/v2/admin/groups/{id}/archive', [\App\Http\Controllers\Api\AdminGroupsController::class, 'archiveGroup']);
Route::post('/v2/admin/groups/{id}/unarchive', [\App\Http\Controllers\Api\AdminGroupsController::class, 'unarchiveGroup']);
Route::post('/v2/admin/groups/{id}/transfer-ownership', [\App\Http\Controllers\Api\AdminGroupsController::class, 'transferOwnership']);
Route::post('/v2/admin/groups/{id}/merge', [\App\Http\Controllers\Api\AdminGroupsController::class, 'mergeGroup']);
Route::post('/v2/admin/groups/{id}/clone', [\App\Http\Controllers\Api\AdminGroupsController::class, 'cloneGroup']);
Route::get('/v2/admin/groups/{id}/audit-log', [\App\Http\Controllers\Api\AdminGroupsController::class, 'auditLog']);
Route::get('/v2/admin/group-tags', [\App\Http\Controllers\Api\AdminGroupsController::class, 'listTags']);
Route::post('/v2/admin/group-tags', [\App\Http\Controllers\Api\AdminGroupsController::class, 'createTag']);
Route::delete('/v2/admin/group-tags/{tagId}', [\App\Http\Controllers\Api\AdminGroupsController::class, 'deleteTag']);
Route::get('/v2/admin/group-collections', [\App\Http\Controllers\Api\AdminGroupsController::class, 'listCollections']);
Route::post('/v2/admin/group-collections', [\App\Http\Controllers\Api\AdminGroupsController::class, 'createCollection']);
Route::put('/v2/admin/group-collections/{id}', [\App\Http\Controllers\Api\AdminGroupsController::class, 'updateCollection']);
Route::delete('/v2/admin/group-collections/{id}', [\App\Http\Controllers\Api\AdminGroupsController::class, 'deleteCollection']);
Route::put('/v2/admin/group-collections/{id}/groups', [\App\Http\Controllers\Api\AdminGroupsController::class, 'setCollectionGroups']);
Route::get('/v2/admin/group-auto-assign-rules', [\App\Http\Controllers\Api\AdminGroupsController::class, 'listAutoAssignRules']);
Route::post('/v2/admin/group-auto-assign-rules', [\App\Http\Controllers\Api\AdminGroupsController::class, 'createAutoAssignRule']);
Route::put('/v2/admin/group-auto-assign-rules/{id}', [\App\Http\Controllers\Api\AdminGroupsController::class, 'updateAutoAssignRule']);
Route::delete('/v2/admin/group-auto-assign-rules/{id}', [\App\Http\Controllers\Api\AdminGroupsController::class, 'deleteAutoAssignRule']);
});
Route::get('/v2/admin/timebanking/stats', [\App\Http\Controllers\Api\AdminTimebankingController::class, 'stats']);
Route::get('/v2/admin/timebanking/alerts', [\App\Http\Controllers\Api\AdminTimebankingController::class, 'alerts']);
Route::put('/v2/admin/timebanking/alerts/{id}', [\App\Http\Controllers\Api\AdminTimebankingController::class, 'updateAlert']);
// Broker-or-admin: brokers may adjust a member's time balance from the broker
// panel's member-detail drawer (audited; controller enforces broker-or-admin).
Route::withoutMiddleware('admin')->middleware('broker-or-admin')->group(function () {
    Route::post('/v2/admin/timebanking/adjust-balance', [\App\Http\Controllers\Api\AdminTimebankingController::class, 'adjustBalance']);
});
Route::get('/v2/admin/timebanking/org-wallets', [\App\Http\Controllers\Api\AdminTimebankingController::class, 'orgWallets']);
Route::get('/v2/admin/timebanking/user-report', [\App\Http\Controllers\Api\AdminTimebankingController::class, 'userReport']);
Route::get('/v2/admin/timebanking/user-statement', [\App\Http\Controllers\Api\AdminTimebankingController::class, 'userStatement']);
Route::get('/v2/admin/wallet/grants', [\App\Http\Controllers\Api\AdminWalletGrantController::class, 'index']);
Route::post('/v2/admin/wallet/grant', [\App\Http\Controllers\Api\AdminWalletGrantController::class, 'store']);
Route::get('/v2/admin/enterprise/dashboard', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'dashboard']);
Route::get('/v2/admin/enterprise/roles', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'roles']);
Route::post('/v2/admin/enterprise/roles', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'createRole']);
Route::get('/v2/admin/enterprise/roles/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'showRole']);
Route::put('/v2/admin/enterprise/roles/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'updateRole']);
Route::delete('/v2/admin/enterprise/roles/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'deleteRole']);
Route::get('/v2/admin/enterprise/permissions', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'permissions']);
Route::get('/v2/admin/enterprise/gdpr/dashboard', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'gdprDashboard']);
Route::get('/v2/admin/enterprise/gdpr/requests', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'gdprRequests']);
Route::put('/v2/admin/enterprise/gdpr/requests/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'updateGdprRequest']);
Route::get('/v2/admin/enterprise/gdpr/consents', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'gdprConsents']);
Route::get('/v2/admin/enterprise/gdpr/breaches', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'gdprBreaches']);
Route::post('/v2/admin/enterprise/gdpr/breaches', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'createBreach']);
Route::get('/v2/admin/enterprise/gdpr/audit/export', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'gdprAuditExport']);
Route::get('/v2/admin/enterprise/gdpr/audit', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'gdprAudit']);
Route::get('/v2/admin/enterprise/monitoring', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'monitoring']);
Route::get('/v2/admin/enterprise/monitoring/health', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'healthCheck']);
Route::get('/v2/admin/enterprise/monitoring/logs', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'logs']);
Route::get('/v2/admin/enterprise/config', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'config']);
Route::put('/v2/admin/enterprise/config', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'updateConfig']);
Route::post('/v2/admin/enterprise/config/reset', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'resetConfig']);
Route::get('/v2/admin/enterprise/config/secrets', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'secrets']);

// Enterprise GDPR — extended endpoints
Route::get('/v2/admin/enterprise/gdpr/statistics', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'gdprStatistics']);
Route::get('/v2/admin/enterprise/gdpr/trends', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'gdprTrends']);
Route::post('/v2/admin/enterprise/gdpr/requests', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'createGdprRequest']);
Route::get('/v2/admin/enterprise/gdpr/requests/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'showGdprRequest']);
Route::put('/v2/admin/enterprise/gdpr/requests/{id}/assign', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'assignGdprRequest']);
Route::post('/v2/admin/enterprise/gdpr/requests/{id}/notes', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'addGdprRequestNote']);
Route::post('/v2/admin/enterprise/gdpr/requests/{id}/export', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'generateGdprExport']);

// Enterprise GDPR — consent type management
Route::get('/v2/admin/enterprise/gdpr/consent-types', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'consentTypes']);
Route::post('/v2/admin/enterprise/gdpr/consent-types', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'createConsentType']);
Route::put('/v2/admin/enterprise/gdpr/consent-types/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'updateConsentType']);
Route::delete('/v2/admin/enterprise/gdpr/consent-types/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'deleteConsentType']);
Route::get('/v2/admin/enterprise/gdpr/consent-types/{slug}/users', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'consentTypeUsers']);
Route::get('/v2/admin/enterprise/gdpr/consent-types/{slug}/export', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'exportConsentTypeUsers']);

// Enterprise GDPR — breach detail & DPA notification
Route::get('/v2/admin/enterprise/gdpr/breaches/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'showBreach']);
Route::put('/v2/admin/enterprise/gdpr/breaches/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'updateBreach']);
Route::post('/v2/admin/enterprise/gdpr/breaches/{id}/notify-dpa', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'notifyDpa']);

// Enterprise monitoring — log files, requirements, health history
Route::get('/v2/admin/enterprise/monitoring/log-files', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'logFiles']);
Route::get('/v2/admin/enterprise/monitoring/log-files/{filename}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'viewLogFile']);
Route::delete('/v2/admin/enterprise/monitoring/log-files/{filename}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'clearLogFile']);
Route::get('/v2/admin/enterprise/monitoring/requirements', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'systemRequirements']);
Route::get('/v2/admin/enterprise/monitoring/health-history', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'healthCheckHistory']);

// Enterprise config — feature flags & secrets management
Route::get('/v2/admin/enterprise/config/features', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'featureFlags']);
Route::patch('/v2/admin/enterprise/config/features', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'updateFeatureFlag']);
Route::post('/v2/admin/enterprise/config/secrets/{key}/rotate', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'rotateSecret']);
Route::delete('/v2/admin/enterprise/config/secrets/{key}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'deleteSecret']);
Route::post('/v2/admin/enterprise/config/secrets/test-vault', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'testVaultConnection']);

Route::get('/v2/admin/legal-documents', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'legalDocs']);
Route::post('/v2/admin/legal-documents', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'createLegalDoc']);
Route::get('/v2/admin/legal-documents/compliance', [\App\Http\Controllers\Api\AdminLegalDocController::class, 'getComplianceStats']);
Route::get('/v2/admin/legal-documents/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'showLegalDoc']);
Route::put('/v2/admin/legal-documents/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'updateLegalDoc']);
Route::delete('/v2/admin/legal-documents/{id}', [\App\Http\Controllers\Api\AdminEnterpriseController::class, 'deleteLegalDoc']);
Route::get('/v2/admin/legal-documents/{docId}/versions', [\App\Http\Controllers\Api\AdminLegalDocController::class, 'getVersions']);
Route::get('/v2/admin/legal-documents/{docId}/versions/compare', [\App\Http\Controllers\Api\AdminLegalDocController::class, 'compareVersions']);
Route::post('/v2/admin/legal-documents/{docId}/versions', [\App\Http\Controllers\Api\AdminLegalDocController::class, 'createVersion']);
Route::put('/v2/admin/legal-documents/{docId}/versions/{versionId}', [\App\Http\Controllers\Api\AdminLegalDocController::class, 'updateVersion']);
Route::delete('/v2/admin/legal-documents/{docId}/versions/{versionId}', [\App\Http\Controllers\Api\AdminLegalDocController::class, 'deleteVersion']);
Route::post('/v2/admin/legal-documents/versions/{versionId}/publish', [\App\Http\Controllers\Api\AdminLegalDocController::class, 'publishVersion']);
Route::get('/v2/admin/legal-documents/versions/{versionId}/acceptances', [\App\Http\Controllers\Api\AdminLegalDocController::class, 'getAcceptances']);
Route::get('/v2/admin/legal-documents/{docId}/acceptances/export', [\App\Http\Controllers\Api\AdminLegalDocController::class, 'exportAcceptances']);
Route::post('/v2/admin/legal-documents/{docId}/versions/{versionId}/notify', [\App\Http\Controllers\Api\AdminLegalDocController::class, 'notifyUsers']);
Route::get('/v2/admin/legal-documents/{docId}/versions/{versionId}/pending-count', [\App\Http\Controllers\Api\AdminLegalDocController::class, 'getUsersPendingCount']);
// Broker-or-admin endpoints — accessible to role='broker' as well as admin roles.
// Brokers run the broker control panel at /broker/* in the React frontend; without
// this override, EnsureIsAdmin (the 'admin' alias) returns 403 for role='broker' by
// design. See app/Http/Middleware/EnsureIsBrokerOrAdmin.php.
Route::withoutMiddleware('admin')->middleware('broker-or-admin')->group(function () {
    Route::get('/v2/admin/broker/dashboard', [\App\Http\Controllers\Api\AdminBrokerController::class, 'dashboard']);
    Route::get('/v2/admin/broker/exchanges', [\App\Http\Controllers\Api\AdminBrokerController::class, 'exchanges']);
    // Mutation endpoints throttled to 60/min/user to limit blast radius
    // from a compromised broker account: mass-flagging messages, mass-
    // toggling monitoring, mass-tagging listings would otherwise be
    // unbounded. 60/min is well above any reasonable interactive use
    // (one decision every second is already very fast for a human
    // reviewer) but blocks scripted abuse.
    Route::post('/v2/admin/broker/exchanges/{id}/approve', [\App\Http\Controllers\Api\AdminBrokerController::class, 'approveExchange'])->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/admin/broker/exchanges/{id}/reject', [\App\Http\Controllers\Api\AdminBrokerController::class, 'rejectExchange'])->middleware('throttle:nexus-route-60-per-1m');
    Route::get('/v2/admin/broker/risk-tags', [\App\Http\Controllers\Api\AdminBrokerController::class, 'riskTags']);
    Route::get('/v2/admin/broker/messages', [\App\Http\Controllers\Api\AdminBrokerController::class, 'messages']);
    Route::get('/v2/admin/broker/messages/unreviewed-count', [\App\Http\Controllers\Api\AdminBrokerController::class, 'unreviewedCount']);
    Route::post('/v2/admin/broker/messages/{id}/review', [\App\Http\Controllers\Api\AdminBrokerController::class, 'reviewMessage'])->middleware('throttle:nexus-route-60-per-1m');
    Route::get('/v2/admin/broker/monitoring', [\App\Http\Controllers\Api\AdminBrokerController::class, 'monitoring']);
    Route::post('/v2/admin/broker/messages/{id}/flag', [\App\Http\Controllers\Api\AdminBrokerController::class, 'flagMessage'])->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/admin/broker/monitoring/{userId}', [\App\Http\Controllers\Api\AdminBrokerController::class, 'setMonitoring'])->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/admin/broker/risk-tags/{listingId}', [\App\Http\Controllers\Api\AdminBrokerController::class, 'saveRiskTag'])->middleware('throttle:nexus-route-60-per-1m');
    Route::delete('/v2/admin/broker/risk-tags/{listingId}', [\App\Http\Controllers\Api\AdminBrokerController::class, 'removeRiskTag'])->middleware('throttle:nexus-route-60-per-1m');
    Route::get('/v2/admin/broker/configuration', [\App\Http\Controllers\Api\AdminBrokerController::class, 'getConfiguration']);
    Route::post('/v2/admin/broker/configuration', [\App\Http\Controllers\Api\AdminBrokerController::class, 'saveConfiguration'])->middleware('throttle:nexus-route-30-per-1m');
    Route::get('/v2/admin/broker/exchanges/{id}', [\App\Http\Controllers\Api\AdminBrokerController::class, 'showExchange']);
    Route::get('/v2/admin/broker/messages/{id}', [\App\Http\Controllers\Api\AdminBrokerController::class, 'showMessage']);
    Route::post('/v2/admin/broker/messages/{id}/approve', [\App\Http\Controllers\Api\AdminBrokerController::class, 'approveMessage'])->middleware('throttle:nexus-route-60-per-1m');
    Route::get('/v2/admin/broker/archives', [\App\Http\Controllers\Api\AdminBrokerController::class, 'archives']);
    Route::get('/v2/admin/broker/archives/{id}', [\App\Http\Controllers\Api\AdminBrokerController::class, 'showArchive']);
    Route::get('/v2/admin/vetting/stats', [\App\Http\Controllers\Api\AdminVettingController::class, 'stats']);
    Route::get('/v2/admin/vetting/policy', [\App\Http\Controllers\Api\AdminVettingController::class, 'policy']);
    Route::put('/v2/admin/vetting/policy', [\App\Http\Controllers\Api\AdminVettingController::class, 'updatePolicy'])->middleware('throttle:nexus-route-20-per-1m');
    Route::post('/v2/admin/vetting/policy/rotate', [\App\Http\Controllers\Api\AdminVettingController::class, 'rotatePolicy'])->middleware('throttle:nexus-route-5-per-1m');
    Route::get('/v2/admin/vetting/user/{userId}', [\App\Http\Controllers\Api\AdminVettingController::class, 'getUserRecords']);
    Route::post('/v2/admin/vetting/user/{userId}/confirm', [\App\Http\Controllers\Api\AdminVettingController::class, 'confirm'])->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/admin/vetting/user/{userId}/revoke', [\App\Http\Controllers\Api\AdminVettingController::class, 'revoke'])->middleware('throttle:nexus-route-60-per-1m');
    Route::post('/v2/admin/vetting/reviews/{reviewId}/resolve', [\App\Http\Controllers\Api\AdminVettingController::class, 'resolveReview'])->middleware('throttle:nexus-route-60-per-1m');
    Route::get('/v2/admin/vetting', [\App\Http\Controllers\Api\AdminVettingController::class, 'list']);
    Route::get('/v2/admin/vetting/{id}', [\App\Http\Controllers\Api\AdminVettingController::class, 'show']);
    Route::get('/v2/admin/insurance/stats', [\App\Http\Controllers\Api\AdminInsuranceCertificateController::class, 'stats']);
    Route::get('/v2/admin/insurance/user/{userId}', [\App\Http\Controllers\Api\AdminInsuranceCertificateController::class, 'getUserCertificates']);
    Route::get('/v2/admin/insurance', [\App\Http\Controllers\Api\AdminInsuranceCertificateController::class, 'list']);
    Route::get('/v2/admin/insurance/{id}', [\App\Http\Controllers\Api\AdminInsuranceCertificateController::class, 'show']);
    Route::post('/v2/admin/insurance', [\App\Http\Controllers\Api\AdminInsuranceCertificateController::class, 'store']);
    Route::put('/v2/admin/insurance/{id}', [\App\Http\Controllers\Api\AdminInsuranceCertificateController::class, 'update']);
    Route::post('/v2/admin/insurance/{id}/verify', [\App\Http\Controllers\Api\AdminInsuranceCertificateController::class, 'verify']);
    Route::post('/v2/admin/insurance/{id}/reject', [\App\Http\Controllers\Api\AdminInsuranceCertificateController::class, 'reject']);
    Route::delete('/v2/admin/insurance/{id}', [\App\Http\Controllers\Api\AdminInsuranceCertificateController::class, 'destroy']);
});
Route::get('/v2/admin/newsletters', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'index']);
Route::post('/v2/admin/newsletters', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'store']);
Route::get('/v2/admin/newsletters/subscribers', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'subscribers']);
Route::post('/v2/admin/newsletters/subscribers', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'addSubscriber']);
Route::post('/v2/admin/newsletters/subscribers/import', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'importSubscribers']);
Route::get('/v2/admin/newsletters/subscribers/export', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'exportSubscribers']);
Route::post('/v2/admin/newsletters/subscribers/sync', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'syncPlatformMembers']);
Route::delete('/v2/admin/newsletters/subscribers/{id}', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'removeSubscriber']);
Route::get('/v2/admin/newsletters/segments', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'segments']);
Route::post('/v2/admin/newsletters/segments', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'storeSegment']);
Route::post('/v2/admin/newsletters/segments/preview', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'previewSegment']);
Route::get('/v2/admin/newsletters/segments/suggestions', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'getSegmentSuggestions']);
Route::get('/v2/admin/newsletters/segments/{id}', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'showSegment']);
Route::put('/v2/admin/newsletters/segments/{id}', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'updateSegment']);
Route::delete('/v2/admin/newsletters/segments/{id}', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'destroySegment']);
Route::get('/v2/admin/newsletters/templates', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'templates']);
Route::post('/v2/admin/newsletters/templates', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'storeTemplate']);
Route::get('/v2/admin/newsletters/templates/{id}', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'showTemplate']);
Route::put('/v2/admin/newsletters/templates/{id}', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'updateTemplate']);
Route::delete('/v2/admin/newsletters/templates/{id}', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'destroyTemplate']);
Route::post('/v2/admin/newsletters/templates/{id}/duplicate', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'duplicateTemplate']);
Route::get('/v2/admin/newsletters/templates/{id}/preview', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'previewTemplate']);
Route::get('/v2/admin/newsletters/analytics', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'analytics']);
Route::get('/v2/admin/newsletters/bounces', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'getBounces']);
Route::get('/v2/admin/newsletters/suppression-list', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'getSuppressionList']);
Route::post('/v2/admin/newsletters/suppression-list/{email}/unsuppress', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'unsuppress']);
Route::post('/v2/admin/newsletters/suppression-list/{email}/suppress', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'suppress']);
Route::get('/v2/admin/newsletters/send-time-optimizer', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'getSendTimeData']);
Route::get('/v2/admin/newsletters/diagnostics', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'getDiagnostics']);
Route::get('/v2/admin/newsletters/bounce-trends', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'getBounceTrends']);
Route::post('/v2/admin/newsletters/recipient-count', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'recipientCount']);
Route::post('/v2/admin/newsletters/preview', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'preview']);
Route::get('/v2/admin/newsletters/{id}', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'show']);
Route::get('/v2/admin/newsletters/{id}/resend-info', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'getResendInfo']);
Route::post('/v2/admin/newsletters/{id}/resend', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'resend']);
Route::post('/v2/admin/newsletters/{id}/send', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'sendNewsletter']);
Route::post('/v2/admin/newsletters/{id}/send-test', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'sendTest']);
Route::post('/v2/admin/newsletters/{id}/duplicate', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'duplicateNewsletter']);
Route::get('/v2/admin/newsletters/{id}/activity', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'activity']);
Route::get('/v2/admin/newsletters/{id}/openers', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'openers']);
Route::get('/v2/admin/newsletters/{id}/clickers', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'clickers']);
Route::get('/v2/admin/newsletters/{id}/non-openers', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'nonOpeners']);
Route::get('/v2/admin/newsletters/{id}/openers-no-click', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'openersNoClick']);
Route::get('/v2/admin/newsletters/{id}/email-clients', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'emailClients']);
Route::get('/v2/admin/newsletters/{id}/stats', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'stats']);
Route::post('/v2/admin/newsletters/{id}/ab-winner', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'selectAbWinner']);
Route::put('/v2/admin/newsletters/{id}', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'update']);
Route::delete('/v2/admin/newsletters/{id}', [\App\Http\Controllers\Api\AdminNewsletterController::class, 'destroy']);
Route::get('/v2/admin/volunteering', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'index']);
Route::get('/v2/admin/volunteering/opportunities', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'opportunities']);
Route::get('/v2/admin/volunteering/applications', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'applications']);
Route::get('/v2/admin/volunteering/approvals', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'approvals']);
Route::get('/v2/admin/volunteering/organizations', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'organizations']);
Route::post('/v2/admin/volunteering/organizations', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'createOrganization']);
Route::put('/v2/admin/volunteering/organizations/{id}', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'updateOrganization']);
Route::get('/v2/admin/volunteering/organizations/{id}/members', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'organizationMembers']);
Route::post('/v2/admin/volunteering/approvals/{id}/approve', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'approveApplication']);
Route::post('/v2/admin/volunteering/approvals/{id}/decline', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'declineApplication']);
Route::post('/v2/admin/volunteering/send-shift-reminders', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'sendShiftReminders']);
Route::get('/v2/admin/volunteering/expenses', [\App\Http\Controllers\Api\VolunteerExpenseController::class, 'adminExpenses']);
Route::get('/v2/admin/volunteering/expenses/export', [\App\Http\Controllers\Api\VolunteerExpenseController::class, 'exportExpenses']);
Route::get('/v2/admin/volunteering/expenses/policies', [\App\Http\Controllers\Api\VolunteerExpenseController::class, 'getExpensePolicies']);
Route::put('/v2/admin/volunteering/expenses/policies', [\App\Http\Controllers\Api\VolunteerExpenseController::class, 'updateExpensePolicy']);
// NOTE: the {id} route must stay below the literal /export and /policies routes or it shadows them
Route::put('/v2/admin/volunteering/expenses/{id}', [\App\Http\Controllers\Api\VolunteerExpenseController::class, 'reviewExpense']);
Route::get('/v2/admin/volunteering/expenses/{id}/receipt', [\App\Http\Controllers\Api\VolunteerExpenseController::class, 'downloadReceipt'])->whereNumber('id');
Route::get('/v2/admin/volunteering/guardian-consents', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'adminGuardianConsents']);
Route::get('/v2/admin/volunteering/training', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'adminTraining']);
Route::put('/v2/admin/volunteering/training/{id}/verify', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'verifyTraining']);
Route::put('/v2/admin/volunteering/training/{id}/reject', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'rejectTraining']);
Route::get('/v2/admin/volunteering/incidents', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'adminIncidents']);
Route::put('/v2/admin/volunteering/incidents/{id}', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'updateIncident']);
Route::get('/v2/admin/volunteering/wellbeing/alerts', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'adminWellbeingAlerts']);
Route::put('/v2/admin/volunteering/wellbeing/alerts/{id}', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'updateWellbeingAlert'])->whereNumber('id');
Route::put('/v2/admin/volunteering/organizations/{id}/dlp', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'assignDlp']);
Route::put('/v2/admin/volunteering/organizations/{id}/wallet/adjust', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'adjustOrgWallet']);
Route::get('/v2/admin/volunteering/organizations/{id}/wallet/transactions', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'orgWalletTransactions']);
Route::put('/v2/admin/volunteering/organizations/{id}/status', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'updateOrgStatus']);
Route::get('/v2/admin/volunteering/hours', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'listHours']);
Route::post('/v2/admin/volunteering/hours/{id}/verify', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'verifyHours']);
// Analytics, activity feed, reorder, donors, trends
Route::get('/v2/admin/volunteering/trends', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'trends']);
Route::get('/v2/admin/volunteering/reminder-logs', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'reminderLogs']);
Route::post('/v2/admin/volunteering/custom-fields/reorder', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'reorderCustomFields']);
Route::get('/v2/admin/volunteering/giving-days/{id}/donors', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'givingDayDonors']);
Route::get('/v2/admin/volunteering/giving-days/{id}/trends', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'givingDayTrends']);
Route::get('/v2/admin/volunteering/activity-feed', [\App\Http\Controllers\Api\AdminVolunteerController::class, 'activityFeed']);
Route::get('/v2/admin/volunteering/custom-fields', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'adminCustomFields']);
Route::post('/v2/admin/volunteering/custom-fields', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'createCustomField']);
Route::put('/v2/admin/volunteering/custom-fields/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'updateCustomField']);
Route::delete('/v2/admin/volunteering/custom-fields/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'deleteCustomField']);
Route::get('/v2/admin/volunteering/reminder-settings', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'getReminderSettings']);
Route::put('/v2/admin/volunteering/reminder-settings', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'updateReminderSettings']);
Route::get('/v2/admin/volunteering/community-projects', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'adminCommunityProjects']);
Route::put('/v2/admin/volunteering/community-projects/{id}/review', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'reviewCommunityProject']);
Route::get('/v2/admin/volunteering/webhooks', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'getWebhooks']);
Route::post('/v2/admin/volunteering/webhooks', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'createWebhook']);
Route::put('/v2/admin/volunteering/webhooks/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'updateWebhook']);
Route::delete('/v2/admin/volunteering/webhooks/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'deleteWebhook']);
Route::post('/v2/admin/volunteering/webhooks/{id}/test', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'testWebhook']);
Route::get('/v2/admin/volunteering/webhooks/{id}/logs', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'getWebhookLogs']);
Route::get('/v2/admin/volunteering/giving-days', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'adminGivingDays']);
Route::post('/v2/admin/volunteering/giving-days', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'createGivingDay']);
Route::put('/v2/admin/volunteering/giving-days/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'updateGivingDay']);
Route::get('/v2/admin/volunteering/donations', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'listDonations']);
Route::get('/v2/admin/volunteering/donations/export', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'exportDonations']);
Route::post('/v2/admin/volunteering/donations/{id}/complete', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'completeDonation']);
Route::post('/v2/admin/donations/{id}/refund', [\App\Http\Controllers\Api\DonationPaymentController::class, 'adminRefund']);
Route::middleware('feature:events')->group(function () {
    Route::get('/v2/admin/events', [\App\Http\Controllers\Api\AdminEventsController::class, 'index']);
    Route::get('/v2/admin/events/{id}', [\App\Http\Controllers\Api\AdminEventsController::class, 'show'])->whereNumber('id');
    Route::post('/v2/admin/events/{id}/approve', [\App\Http\Controllers\Api\AdminEventsController::class, 'approve'])->whereNumber('id');
    Route::post('/v2/admin/events/{id}/reject', [\App\Http\Controllers\Api\AdminEventsController::class, 'reject'])->whereNumber('id');
    Route::post('/v2/admin/events/{id}/postpone', [\App\Http\Controllers\Api\AdminEventsController::class, 'postpone'])->whereNumber('id');
    Route::post('/v2/admin/events/{id}/cancel', [\App\Http\Controllers\Api\AdminEventsController::class, 'cancel'])->whereNumber('id');
    Route::post('/v2/admin/events/{id}/complete', [\App\Http\Controllers\Api\AdminEventsController::class, 'complete'])->whereNumber('id');
    Route::post('/v2/admin/events/{id}/archive', [\App\Http\Controllers\Api\AdminEventsController::class, 'archive'])->whereNumber('id');
    Route::post('/v2/admin/events/{id}/restore', [\App\Http\Controllers\Api\AdminEventsController::class, 'restore'])->whereNumber('id');
    Route::post('/v2/admin/events/{id}/reschedule', [\App\Http\Controllers\Api\AdminEventsController::class, 'reschedule'])->whereNumber('id');
    Route::delete('/v2/admin/events/{id}', [\App\Http\Controllers\Api\AdminEventsController::class, 'destroy'])->whereNumber('id');
});
Route::get('/v2/admin/polls', [\App\Http\Controllers\Api\AdminPollsController::class, 'index']);
Route::get('/v2/admin/polls/{id}', [\App\Http\Controllers\Api\AdminPollsController::class, 'show']);
Route::delete('/v2/admin/polls/{id}', [\App\Http\Controllers\Api\AdminPollsController::class, 'destroy']);
Route::get('/v2/admin/goals', [\App\Http\Controllers\Api\AdminGoalsController::class, 'index']);
Route::get('/v2/admin/goals/{id}', [\App\Http\Controllers\Api\AdminGoalsController::class, 'show']);
Route::delete('/v2/admin/goals/{id}', [\App\Http\Controllers\Api\AdminGoalsController::class, 'destroy']);
Route::get('/v2/admin/resources', [\App\Http\Controllers\Api\AdminResourcesController::class, 'index']);
Route::get('/v2/admin/resources/{id}', [\App\Http\Controllers\Api\AdminResourcesController::class, 'show']);
Route::delete('/v2/admin/resources/{id}', [\App\Http\Controllers\Api\AdminResourcesController::class, 'destroy']);
Route::get('/v2/admin/jobs', [\App\Http\Controllers\Api\AdminJobsController::class, 'index']);
// Static literal admin job routes BEFORE {id} wildcard (Agent B + D)
Route::get('/v2/admin/jobs/moderation-queue', [\App\Http\Controllers\Api\AdminJobsController::class, 'moderationQueue']);
Route::get('/v2/admin/jobs/moderation-stats', [\App\Http\Controllers\Api\AdminJobsController::class, 'moderationStats']);
Route::get('/v2/admin/jobs/spam-stats', [\App\Http\Controllers\Api\AdminJobsController::class, 'spamStats']);
Route::get('/v2/admin/jobs/bias-audit', [\App\Http\Controllers\Api\AdminJobsController::class, 'biasAudit']);
Route::get('/v2/admin/jobs/stats', [\App\Http\Controllers\Api\AdminJobsController::class, 'stats']);
Route::get('/v2/admin/jobs/interviews', [\App\Http\Controllers\Api\AdminJobsController::class, 'interviews']);
Route::get('/v2/admin/jobs/offers', [\App\Http\Controllers\Api\AdminJobsController::class, 'offers']);
Route::get('/v2/admin/jobs/templates', [\App\Http\Controllers\Api\AdminJobsController::class, 'templates']);
Route::delete('/v2/admin/jobs/templates/{id}', [\App\Http\Controllers\Api\AdminJobsController::class, 'deleteTemplate']);
Route::put('/v2/admin/jobs/applications/{id}', [\App\Http\Controllers\Api\AdminJobsController::class, 'updateApplicationStatus']);
// Wildcard {id} routes
Route::get('/v2/admin/jobs/{id}', [\App\Http\Controllers\Api\AdminJobsController::class, 'show']);
Route::delete('/v2/admin/jobs/{id}', [\App\Http\Controllers\Api\AdminJobsController::class, 'destroy']);
Route::post('/v2/admin/jobs/{id}/feature', [\App\Http\Controllers\Api\AdminJobsController::class, 'feature']);
Route::post('/v2/admin/jobs/{id}/unfeature', [\App\Http\Controllers\Api\AdminJobsController::class, 'unfeature']);
Route::get('/v2/admin/jobs/{id}/applications', [\App\Http\Controllers\Api\AdminJobsController::class, 'getApplications']);
Route::post('/v2/admin/jobs/{id}/approve', [\App\Http\Controllers\Api\AdminJobsController::class, 'approve']);
Route::post('/v2/admin/jobs/{id}/reject', [\App\Http\Controllers\Api\AdminJobsController::class, 'reject']);
Route::post('/v2/admin/jobs/{id}/flag', [\App\Http\Controllers\Api\AdminJobsController::class, 'flag']);
// Marketplace Admin
Route::get('/v2/admin/marketplace/dashboard', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'dashboard']);
Route::post('/v2/admin/marketplace/bulk-reject', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'bulkReject']);
Route::get('/v2/admin/marketplace/listings', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'listings']);
Route::post('/v2/admin/marketplace/listings/{id}/approve', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'approveListing']);
Route::post('/v2/admin/marketplace/listings/{id}/reject', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'rejectListing']);
Route::delete('/v2/admin/marketplace/listings/{id}', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'destroyListing']);
Route::get('/v2/admin/marketplace/sellers', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'sellers']);
Route::post('/v2/admin/marketplace/sellers/{id}/verify', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'verifySeller']);
Route::post('/v2/admin/marketplace/sellers/{id}/suspend', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'suspendSeller']);
// Marketplace Admin — DSA Reports (Phase 4)
Route::get('/v2/admin/marketplace/reports', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'reports']);
Route::post('/v2/admin/marketplace/reports/{id}/acknowledge', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'acknowledgeReport']);
Route::put('/v2/admin/marketplace/reports/{id}/resolve', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'resolveReport']);
Route::put('/v2/admin/marketplace/reports/{id}/resolve-appeal', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'resolveReportAppeal']);
Route::get('/v2/admin/marketplace/disputes', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'disputes']);
Route::put('/v2/admin/marketplace/disputes/{id}/resolve', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'resolveDispute']);
Route::get('/v2/admin/marketplace/transparency', [\App\Http\Controllers\Api\AdminMarketplaceController::class, 'transparencyStats']);
// Marketplace Admin — DSA Reports for a specific listing
Route::get('/v2/admin/marketplace/listings/{id}/reports', [\App\Http\Controllers\Api\MarketplaceReportController::class, 'index']);

// Courses Module (ALPHA) — Admin (moderation, instructors, categories, analytics)
Route::get('/v2/admin/courses', [\App\Http\Controllers\Api\AdminCourseController::class, 'index']);
Route::get('/v2/admin/courses/analytics', [\App\Http\Controllers\Api\AdminCourseController::class, 'analytics']);
Route::post('/v2/admin/courses/{id}/moderate', [\App\Http\Controllers\Api\AdminCourseController::class, 'moderate'])->where('id', '[0-9]+');
Route::get('/v2/admin/courses/instructors', [\App\Http\Controllers\Api\AdminCourseController::class, 'listInstructors']);
Route::post('/v2/admin/courses/instructors', [\App\Http\Controllers\Api\AdminCourseController::class, 'grantInstructor']);
Route::delete('/v2/admin/courses/instructors/{userId}', [\App\Http\Controllers\Api\AdminCourseController::class, 'revokeInstructor'])->where('userId', '[0-9]+');
Route::post('/v2/admin/courses/categories', [\App\Http\Controllers\Api\AdminCourseController::class, 'storeCategory']);
Route::put('/v2/admin/courses/categories/{id}', [\App\Http\Controllers\Api\AdminCourseController::class, 'updateCategory'])->where('id', '[0-9]+');
Route::delete('/v2/admin/courses/categories/{id}', [\App\Http\Controllers\Api\AdminCourseController::class, 'deleteCategory'])->where('id', '[0-9]+');
Route::post('/v2/admin/courses/discussions/{id}/hide', [\App\Http\Controllers\Api\CourseDiscussionController::class, 'hide'])->where('id', '[0-9]+');

// Podcasts Module — Admin moderation and analytics
Route::get('/v2/admin/podcasts', [\App\Http\Controllers\Api\AdminPodcastController::class, 'index']);
Route::post('/v2/admin/podcasts/shows/{id}/moderate', [\App\Http\Controllers\Api\AdminPodcastController::class, 'moderateShow'])->where('id', '[0-9]+');
Route::get('/v2/admin/podcasts/shows/{id}/validate-feed', [\App\Http\Controllers\Api\AdminPodcastController::class, 'validateFeed'])->where('id', '[0-9]+');
Route::post('/v2/admin/podcasts/episodes/{id}/moderate', [\App\Http\Controllers\Api\AdminPodcastController::class, 'moderateEpisode'])->where('id', '[0-9]+');
Route::post('/v2/admin/podcasts/reports/{reportId}/resolve', [\App\Http\Controllers\Api\AdminPodcastController::class, 'resolveReport'])->where('reportId', '[0-9]+');
Route::post('/v2/admin/podcasts/storage/verify', [\App\Http\Controllers\Api\AdminPodcastController::class, 'verifyStorage']);

Route::get('/v2/admin/ideation', [\App\Http\Controllers\Api\AdminIdeationController::class, 'index']);
Route::get('/v2/admin/ideation/{id}', [\App\Http\Controllers\Api\AdminIdeationController::class, 'show']);
Route::delete('/v2/admin/ideation/{id}', [\App\Http\Controllers\Api\AdminIdeationController::class, 'destroy']);
Route::post('/v2/admin/ideation/{id}/status', [\App\Http\Controllers\Api\AdminIdeationController::class, 'updateStatus']);
Route::get('/v2/admin/federation/settings', [\App\Http\Controllers\Api\AdminFederationController::class, 'settings']);
Route::put('/v2/admin/federation/settings', [\App\Http\Controllers\Api\AdminFederationController::class, 'updateSettings']);
Route::get('/v2/admin/federation/partnerships', [\App\Http\Controllers\Api\AdminFederationController::class, 'partnerships']);
Route::post('/v2/admin/federation/partnerships/{id}/approve', [\App\Http\Controllers\Api\AdminFederationController::class, 'approvePartnership']);
Route::post('/v2/admin/federation/partnerships/{id}/reject', [\App\Http\Controllers\Api\AdminFederationController::class, 'rejectPartnership']);
Route::post('/v2/admin/federation/partnerships/{id}/terminate', [\App\Http\Controllers\Api\AdminFederationController::class, 'terminatePartnership']);
Route::post('/v2/admin/federation/partnerships/{id}/reactivate', [\App\Http\Controllers\Api\AdminFederationController::class, 'reactivatePartnership']);
Route::post('/v2/admin/federation/partnerships/request', [\App\Http\Controllers\Api\AdminFederationController::class, 'requestPartnership']);
Route::get('/v2/admin/federation/partnerships/{id}', [\App\Http\Controllers\Api\AdminFederationController::class, 'partnershipDetail']);
Route::post('/v2/admin/federation/partnerships/{id}/counter-propose', [\App\Http\Controllers\Api\AdminFederationController::class, 'counterProposePartnership']);
Route::put('/v2/admin/federation/partnerships/{id}/permissions', [\App\Http\Controllers\Api\AdminFederationController::class, 'updatePartnershipPermissions']);
Route::get('/v2/admin/federation/partnerships/{id}/audit-log', [\App\Http\Controllers\Api\AdminFederationController::class, 'partnershipAuditLog']);
Route::get('/v2/admin/federation/partnerships/{id}/stats', [\App\Http\Controllers\Api\AdminFederationController::class, 'partnershipStats']);
Route::get('/v2/admin/federation/directory', [\App\Http\Controllers\Api\AdminFederationController::class, 'directory']);
Route::get('/v2/admin/federation/directory/profile', [\App\Http\Controllers\Api\AdminFederationController::class, 'profile']);
Route::put('/v2/admin/federation/directory/profile', [\App\Http\Controllers\Api\AdminFederationController::class, 'updateProfile']);
Route::get('/v2/admin/federation/topics', [\App\Http\Controllers\Api\AdminFederationController::class, 'topics']);
Route::get('/v2/admin/federation/topics/mine', [\App\Http\Controllers\Api\AdminFederationController::class, 'myTopics']);
Route::put('/v2/admin/federation/topics/mine', [\App\Http\Controllers\Api\AdminFederationController::class, 'updateMyTopics']);
Route::get('/v2/admin/federation/analytics', [\App\Http\Controllers\Api\AdminFederationController::class, 'analytics']);
Route::get('/v2/admin/federation/activity', [\App\Http\Controllers\Api\AdminFederationController::class, 'activityFeed']);
Route::get('/v2/admin/federation/api-keys', [\App\Http\Controllers\Api\AdminFederationController::class, 'apiKeys']);
Route::post('/v2/admin/federation/api-keys', [\App\Http\Controllers\Api\AdminFederationController::class, 'createApiKey']);
Route::post('/v2/admin/federation/api-keys/{id}/revoke', [\App\Http\Controllers\Api\AdminFederationController::class, 'revokeApiKey']);
Route::get('/v2/admin/federation/data', [\App\Http\Controllers\Api\AdminFederationController::class, 'dataManagement']);
Route::get('/v2/admin/federation/export/{type}', [\App\Http\Controllers\Api\AdminFederationController::class, 'exportData']);
// Federation cross-node aggregate consent (R1+R2 — Caring Community federation)
Route::get('/v2/admin/federation/aggregate-consent', [\App\Http\Controllers\Api\AdminFederationAggregateController::class, 'consent']);
Route::put('/v2/admin/federation/aggregate-consent', [\App\Http\Controllers\Api\AdminFederationAggregateController::class, 'updateConsent']);
Route::post('/v2/admin/federation/aggregate-consent/rotate-secret', [\App\Http\Controllers\Api\AdminFederationAggregateController::class, 'rotateSecret']);
Route::get('/v2/admin/federation/aggregate-consent/audit-log', [\App\Http\Controllers\Api\AdminFederationAggregateController::class, 'auditLog']);
Route::get('/v2/admin/federation/aggregate-consent/preview', [\App\Http\Controllers\Api\AdminFederationAggregateController::class, 'preview']);
// Enhanced federation analytics overview (KPIs + chart data)
Route::get('/v2/admin/federation/analytics/overview', [\App\Http\Controllers\Api\AdminFederationAnalyticsController::class, 'overview']);
// Federation data management: full export / import / purge
// Bulk data export/import — keyed per authenticated admin (not per IP) so
// multiple admins behind a shared NAT don't starve each other. See
// RouteServiceProvider::boot() `bulk-export` limiter.
Route::post('/v2/admin/federation/data/export', [\App\Http\Controllers\Api\AdminFederationDataController::class, 'export'])
    ->middleware('throttle:bulk-export');
Route::post('/v2/admin/federation/data/import', [\App\Http\Controllers\Api\AdminFederationDataController::class, 'import'])
    ->middleware('throttle:bulk-export');
Route::post('/v2/admin/federation/data/purge', [\App\Http\Controllers\Api\AdminFederationDataController::class, 'purge']);
Route::get('/v2/admin/federation/neighborhoods', [\App\Http\Controllers\Api\AdminFederationNeighborhoodsController::class, 'index']);
Route::post('/v2/admin/federation/neighborhoods', [\App\Http\Controllers\Api\AdminFederationNeighborhoodsController::class, 'store']);
Route::get('/v2/admin/federation/available-tenants', [\App\Http\Controllers\Api\AdminFederationNeighborhoodsController::class, 'availableTenants']);
Route::delete('/v2/admin/federation/neighborhoods/{id}', [\App\Http\Controllers\Api\AdminFederationNeighborhoodsController::class, 'destroy']);
Route::post('/v2/admin/federation/neighborhoods/{id}/tenants', [\App\Http\Controllers\Api\AdminFederationNeighborhoodsController::class, 'addTenant']);
Route::delete('/v2/admin/federation/neighborhoods/{id}/tenants/{tenantId}', [\App\Http\Controllers\Api\AdminFederationNeighborhoodsController::class, 'removeTenant']);
Route::get('/v2/admin/federation/credit-agreements', [\App\Http\Controllers\Api\AdminFederationCreditAgreementsController::class, 'index']);
Route::post('/v2/admin/federation/credit-agreements', [\App\Http\Controllers\Api\AdminFederationCreditAgreementsController::class, 'store']);
Route::post('/v2/admin/federation/credit-agreements/{id}/{action}', [\App\Http\Controllers\Api\AdminFederationCreditAgreementsController::class, 'action']);
Route::get('/v2/admin/federation/credit-agreements/{id}/transactions', [\App\Http\Controllers\Api\AdminFederationCreditAgreementsController::class, 'transactions']);
Route::get('/v2/admin/federation/credit-balances', [\App\Http\Controllers\Api\AdminFederationCreditAgreementsController::class, 'balances']);
Route::get('/v2/admin/federation/partners', [\App\Http\Controllers\Api\AdminFederationCreditAgreementsController::class, 'partners']);
// External federation partners
Route::get('/v2/admin/federation/external-partners', [\App\Http\Controllers\Api\AdminFederationExternalPartnersController::class, 'index']);
Route::post('/v2/admin/federation/external-partners', [\App\Http\Controllers\Api\AdminFederationExternalPartnersController::class, 'store']);
Route::put('/v2/admin/federation/external-partners/{id}', [\App\Http\Controllers\Api\AdminFederationExternalPartnersController::class, 'update']);
Route::delete('/v2/admin/federation/external-partners/{id}', [\App\Http\Controllers\Api\AdminFederationExternalPartnersController::class, 'destroy']);
Route::post('/v2/admin/federation/external-partners/{id}/health-check', [\App\Http\Controllers\Api\AdminFederationExternalPartnersController::class, 'healthCheck']);
Route::get('/v2/admin/federation/external-partners/{id}/logs', [\App\Http\Controllers\Api\AdminFederationExternalPartnersController::class, 'logs']);
// Federation webhooks
Route::get('/v2/admin/federation/webhooks', [\App\Http\Controllers\Api\AdminFederationWebhooksController::class, 'index']);
Route::post('/v2/admin/federation/webhooks', [\App\Http\Controllers\Api\AdminFederationWebhooksController::class, 'store']);
Route::put('/v2/admin/federation/webhooks/{id}', [\App\Http\Controllers\Api\AdminFederationWebhooksController::class, 'update']);
Route::delete('/v2/admin/federation/webhooks/{id}', [\App\Http\Controllers\Api\AdminFederationWebhooksController::class, 'destroy']);
Route::post('/v2/admin/federation/webhooks/{id}/test', [\App\Http\Controllers\Api\AdminFederationWebhooksController::class, 'test']);
Route::get('/v2/admin/federation/webhooks/{id}/logs', [\App\Http\Controllers\Api\AdminFederationWebhooksController::class, 'logs']);
Route::post('/v2/admin/federation/webhook-logs/{id}/retry', [\App\Http\Controllers\Api\AdminFederationWebhooksController::class, 'retry']);
// Credit Commons node configuration
Route::get('/v2/admin/federation/cc-config', [\App\Http\Controllers\Api\AdminCcConfigController::class, 'show']);
Route::put('/v2/admin/federation/cc-config', [\App\Http\Controllers\Api\AdminCcConfigController::class, 'update']);
// NOTE: Federation user routes moved to auth-only group (not admin-only)
Route::get('/v2/admin/pages', [\App\Http\Controllers\Api\AdminContentController::class, 'getPages']);
Route::post('/v2/admin/pages', [\App\Http\Controllers\Api\AdminContentController::class, 'createPage']);
Route::get('/v2/admin/pages/{id}', [\App\Http\Controllers\Api\AdminContentController::class, 'getPage']);
Route::put('/v2/admin/pages/{id}', [\App\Http\Controllers\Api\AdminContentController::class, 'updatePage']);
Route::delete('/v2/admin/pages/{id}', [\App\Http\Controllers\Api\AdminContentController::class, 'deletePage']);
Route::get('/v2/admin/menus', [\App\Http\Controllers\Api\AdminContentController::class, 'getMenus']);
Route::post('/v2/admin/menus', [\App\Http\Controllers\Api\AdminContentController::class, 'createMenu']);
Route::get('/v2/admin/menus/{id}', [\App\Http\Controllers\Api\AdminContentController::class, 'getMenu']);
Route::put('/v2/admin/menus/{id}', [\App\Http\Controllers\Api\AdminContentController::class, 'updateMenu']);
Route::delete('/v2/admin/menus/{id}', [\App\Http\Controllers\Api\AdminContentController::class, 'deleteMenu']);
Route::get('/v2/admin/menus/{id}/items', [\App\Http\Controllers\Api\AdminContentController::class, 'getMenuItems']);
Route::post('/v2/admin/menus/{id}/items', [\App\Http\Controllers\Api\AdminContentController::class, 'createMenuItem']);
Route::post('/v2/admin/menus/{id}/items/reorder', [\App\Http\Controllers\Api\AdminContentController::class, 'reorderMenuItems']);
Route::put('/v2/admin/menu-items/{id}', [\App\Http\Controllers\Api\AdminContentController::class, 'updateMenuItem']);
Route::delete('/v2/admin/menu-items/{id}', [\App\Http\Controllers\Api\AdminContentController::class, 'deleteMenuItem']);
Route::get('/v2/admin/plans', [\App\Http\Controllers\Api\AdminContentController::class, 'getPlans']);
Route::post('/v2/admin/plans', [\App\Http\Controllers\Api\AdminContentController::class, 'createPlan']);
Route::get('/v2/admin/plans/{id}', [\App\Http\Controllers\Api\AdminContentController::class, 'getPlan']);
Route::put('/v2/admin/plans/{id}', [\App\Http\Controllers\Api\AdminContentController::class, 'updatePlan']);
Route::delete('/v2/admin/plans/{id}', [\App\Http\Controllers\Api\AdminContentController::class, 'deletePlan']);
Route::post('/v2/admin/plans/{id}/sync-stripe', [\App\Http\Controllers\Api\AdminContentController::class, 'syncPlanToStripe']);
Route::get('/v2/admin/subscriptions', [\App\Http\Controllers\Api\AdminContentController::class, 'getSubscriptions']);
// Billing — Stripe subscription management
Route::get('/v2/admin/billing/subscription', [\App\Http\Controllers\Api\AdminBillingController::class, 'getSubscription']);
Route::post('/v2/admin/billing/checkout', [\App\Http\Controllers\Api\AdminBillingController::class, 'createCheckoutSession']);
Route::post('/v2/admin/billing/portal', [\App\Http\Controllers\Api\AdminBillingController::class, 'createPortalSession']);
Route::get('/v2/admin/billing/invoices', [\App\Http\Controllers\Api\AdminBillingController::class, 'getInvoices']);
Route::post('/v2/admin/billing/upgrade-request', [\App\Http\Controllers\Api\AdminBillingController::class, 'requestUpgrade']);
Route::get('/v2/admin/tools/redirects', [\App\Http\Controllers\Api\AdminToolsController::class, 'getRedirects']);
Route::post('/v2/admin/tools/redirects', [\App\Http\Controllers\Api\AdminToolsController::class, 'createRedirect']);
Route::delete('/v2/admin/tools/redirects/{id}', [\App\Http\Controllers\Api\AdminToolsController::class, 'deleteRedirect']);
Route::get('/v2/admin/tools/404-errors', [\App\Http\Controllers\Api\AdminToolsController::class, 'get404Errors']);
Route::delete('/v2/admin/tools/404-errors/{id}', [\App\Http\Controllers\Api\AdminToolsController::class, 'delete404Error']);
Route::post('/v2/admin/tools/health-check', [\App\Http\Controllers\Api\AdminToolsController::class, 'runHealthCheck']);
Route::get('/v2/admin/tools/ip-debug', [\App\Http\Controllers\Api\AdminToolsController::class, 'ipDebug']);
Route::get('/v2/admin/tools/webp-stats', [\App\Http\Controllers\Api\AdminToolsController::class, 'getWebpStats']);
Route::post('/v2/admin/tools/webp-convert', [\App\Http\Controllers\Api\AdminToolsController::class, 'runWebpConversion']);
Route::post('/v2/admin/tools/seed', [\App\Http\Controllers\Api\AdminToolsController::class, 'runSeedGenerator']);
Route::get('/v2/admin/tools/blog-backups', [\App\Http\Controllers\Api\AdminToolsController::class, 'getBlogBackups']);
Route::post('/v2/admin/tools/blog-backups/{id}/restore', [\App\Http\Controllers\Api\AdminToolsController::class, 'restoreBlogBackup']);
Route::get('/v2/admin/tools/seo-audit', [\App\Http\Controllers\Api\AdminToolsController::class, 'getSeoAudit']);
Route::post('/v2/admin/tools/seo-audit', [\App\Http\Controllers\Api\AdminToolsController::class, 'runSeoAudit']);

// Prerender engine admin (SEO module).
// Read endpoints accept tenant_admin+; mutating endpoints (enqueue/cancel)
// require super_admin and are gated inside the controller.
Route::get('/v2/admin/prerender/summary',          [\App\Http\Controllers\Api\AdminPrerenderController::class, 'summary']);
Route::get('/v2/admin/prerender/inventory',        [\App\Http\Controllers\Api\AdminPrerenderController::class, 'inventory']);
Route::get('/v2/admin/prerender/inspect',          [\App\Http\Controllers\Api\AdminPrerenderController::class, 'inspect']);
Route::get('/v2/admin/prerender/coverage',         [\App\Http\Controllers\Api\AdminPrerenderController::class, 'coverage']);
Route::get('/v2/admin/prerender/tenant-safety',    [\App\Http\Controllers\Api\AdminPrerenderController::class, 'tenantSafety']);
Route::get('/v2/admin/prerender/events',           [\App\Http\Controllers\Api\AdminPrerenderController::class, 'events']);
Route::get('/v2/admin/prerender/failures',         [\App\Http\Controllers\Api\AdminPrerenderController::class, 'failures']);
Route::get('/v2/admin/prerender/jobs',             [\App\Http\Controllers\Api\AdminPrerenderController::class, 'jobs']);
Route::get('/v2/admin/prerender/jobs/{id}',        [\App\Http\Controllers\Api\AdminPrerenderController::class, 'showJob'])->whereNumber('id');
Route::post('/v2/admin/prerender/jobs',            [\App\Http\Controllers\Api\AdminPrerenderController::class, 'enqueue']);
Route::post('/v2/admin/prerender/jobs/{id}/cancel',[\App\Http\Controllers\Api\AdminPrerenderController::class, 'cancelJob'])->whereNumber('id');
Route::post('/v2/admin/prerender/purge',           [\App\Http\Controllers\Api\AdminPrerenderController::class, 'purge']);
Route::post('/v2/admin/prerender/purge-unexpected',[\App\Http\Controllers\Api\AdminPrerenderController::class, 'purgeUnexpected']);
Route::post('/v2/admin/prerender/invalidate',      [\App\Http\Controllers\Api\AdminPrerenderController::class, 'invalidate']);
Route::get('/v2/admin/prerender/analytics',        [\App\Http\Controllers\Api\AdminPrerenderController::class, 'analytics']);
Route::post('/v2/admin/prerender/auto-recache',    [\App\Http\Controllers\Api\AdminPrerenderController::class, 'autoRecache']);
Route::post('/v2/admin/prerender/detect-drift',    [\App\Http\Controllers\Api\AdminPrerenderController::class, 'detectDrift']);
Route::get('/v2/admin/prerender/metrics',          [\App\Http\Controllers\Api\AdminPrerenderController::class, 'metrics']);
Route::get('/v2/admin/prerender/realtime-channel', [\App\Http\Controllers\Api\AdminPrerenderController::class, 'realtimeChannel']);
// Round 2 — health, audit, breaker reset, emergency queue reset.
Route::get('/v2/admin/prerender/health',           [\App\Http\Controllers\Api\AdminPrerenderController::class, 'health']);
Route::get('/v2/admin/prerender/audit',            [\App\Http\Controllers\Api\AdminPrerenderController::class, 'auditLog']);
Route::post('/v2/admin/prerender/reset-breaker',   [\App\Http\Controllers\Api\AdminPrerenderController::class, 'resetBreaker']);
Route::post('/v2/admin/prerender/reset-queue',     [\App\Http\Controllers\Api\AdminPrerenderController::class, 'resetQueue']);
Route::post('/v2/admin/prerender/reset-all',       [\App\Http\Controllers\Api\AdminPrerenderController::class, 'resetAll']);
// Round 3 — CSV export + TTL inspector.
Route::get('/v2/admin/prerender/export/{kind}.csv', [\App\Http\Controllers\Api\AdminPrerenderController::class, 'exportCsv'])
    ->where('kind', 'audit|inventory|jobs');
Route::get('/v2/admin/prerender/ttl-inspector',     [\App\Http\Controllers\Api\AdminPrerenderController::class, 'ttlInspector']);
// Round 4 — retry job + sitemap explorer.
Route::post('/v2/admin/prerender/jobs/{id}/retry',  [\App\Http\Controllers\Api\AdminPrerenderController::class, 'retryJob'])->whereNumber('id');
Route::get('/v2/admin/prerender/sitemap-explorer',  [\App\Http\Controllers\Api\AdminPrerenderController::class, 'sitemapExplorer']);
Route::get('/v2/admin/deliverability/dashboard', [\App\Http\Controllers\Api\AdminDeliverabilityController::class, 'getDashboard']);
Route::get('/v2/admin/deliverability/analytics', [\App\Http\Controllers\Api\AdminDeliverabilityController::class, 'getAnalytics']);
Route::get('/v2/admin/deliverability', [\App\Http\Controllers\Api\AdminDeliverabilityController::class, 'getDeliverables']);
Route::post('/v2/admin/deliverability', [\App\Http\Controllers\Api\AdminDeliverabilityController::class, 'createDeliverable']);
Route::get('/v2/admin/deliverability/{id}', [\App\Http\Controllers\Api\AdminDeliverabilityController::class, 'getDeliverable']);
Route::put('/v2/admin/deliverability/{id}', [\App\Http\Controllers\Api\AdminDeliverabilityController::class, 'updateDeliverable']);
Route::delete('/v2/admin/deliverability/{id}', [\App\Http\Controllers\Api\AdminDeliverabilityController::class, 'deleteDeliverable']);
Route::post('/v2/admin/deliverability/{id}/comments', [\App\Http\Controllers\Api\AdminDeliverabilityController::class, 'addComment']);
// Safeguarding workflow endpoints — broker-or-admin (broker panel uses these).
Route::withoutMiddleware('admin')->middleware('broker-or-admin')->group(function () {
    Route::get('/v2/admin/safeguarding/dashboard', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'dashboard']);
    Route::get('/v2/admin/safeguarding/flagged-messages', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'flaggedMessages']);
    Route::get('/v2/admin/safeguarding/assignments', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'assignments']);
    Route::post('/v2/admin/safeguarding/flagged-messages/{id}/review', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'reviewMessage']);
    Route::post('/v2/admin/safeguarding/assignments', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'createAssignment']);
    Route::delete('/v2/admin/safeguarding/assignments/{id}', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'deleteAssignment']);
    Route::get('/v2/admin/safeguarding/member-preferences', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'memberPreferences']);
});

// Tier 2a — tenant-level safeguarding declaration (Tusla / Children First Act 2015)
Route::get('/v2/admin/safeguarding/statement', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'getStatement']);
Route::post('/v2/admin/safeguarding/statement', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'uploadStatement']);
Route::get('/v2/admin/safeguarding/statement/download', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'downloadStatement']);

// Tier 3c — per-member audit trail (activity log + message copies + assignments)
Route::get('/v2/admin/safeguarding/members/{userId}/activity', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'memberActivity']);
Route::get('/v2/admin/safeguarding/members/{userId}/activity.csv', [\App\Http\Controllers\Api\AdminSafeguardingController::class, 'memberActivityCsv']);

}); // End Route::middleware(['auth:sanctum', 'admin'])

// Tier 3b — member self-service safeguarding endpoints (tenant-authenticated)
Route::middleware(['auth:sanctum'])->group(function () {
    Route::get('/v2/safeguarding/my-preferences', [\App\Http\Controllers\Api\SafeguardingMemberController::class, 'myPreferences']);
    Route::get('/v2/safeguarding/my-vetting-status', [\App\Http\Controllers\Api\SafeguardingMemberController::class, 'myVettingStatus']);
    Route::post('/v2/safeguarding/confirm-policy-review', [\App\Http\Controllers\Api\SafeguardingMemberController::class, 'confirmPolicyReview'])->middleware('throttle:nexus-route-10-per-1m');
    Route::post('/v2/safeguarding/vetting-review-request', [\App\Http\Controllers\Api\SafeguardingMemberController::class, 'requestVettingReview'])->middleware('throttle:nexus-route-10-per-1m');
    Route::post('/v2/safeguarding/revoke', [\App\Http\Controllers\Api\SafeguardingMemberController::class, 'revoke']);
});

// AG23 follow-up — Public inbound federation endpoint (HMAC signature auth, no session)
Route::post('/v2/federation/hour-transfer/inbound', [\App\Http\Controllers\Api\FederationHourTransferController::class, 'inbound'])
    ->middleware(['throttle:nexus-route-30-per-1m', 'federation.external:hour_transfer']);

// AG54 — Verein membership dues (member-facing + verein-admin scoped)
Route::middleware(['auth:sanctum'])->group(function () {
    // Member-facing
    Route::get('/v2/me/verein-dues', [\App\Http\Controllers\Api\Verein\MyDuesController::class, 'myDues']);
    Route::get('/v2/me/verein-dues/{duesId}', [\App\Http\Controllers\Api\Verein\MyDuesController::class, 'showDues'])->whereNumber('duesId');
    Route::post('/v2/me/verein-dues/{duesId}/pay', [\App\Http\Controllers\Api\Verein\MyDuesController::class, 'payDues'])->whereNumber('duesId');
    Route::get('/v2/users/{userId}/verein-membership-status', [\App\Http\Controllers\Api\Verein\MyDuesController::class, 'membershipStatus'])->whereNumber('userId');

    // Verein-admin scoped (tenant admin OR scoped verein_admin per-org)
    Route::get('/v2/vereine/{organizationId}/dues/fee-config', [\App\Http\Controllers\Api\Verein\VereinDuesAdminController::class, 'getFeeConfig'])->whereNumber('organizationId');
    Route::put('/v2/vereine/{organizationId}/dues/fee-config', [\App\Http\Controllers\Api\Verein\VereinDuesAdminController::class, 'setFeeConfig'])->whereNumber('organizationId');
    Route::post('/v2/vereine/{organizationId}/dues/generate', [\App\Http\Controllers\Api\Verein\VereinDuesAdminController::class, 'generateAnnualDues'])->whereNumber('organizationId');
    Route::get('/v2/vereine/{organizationId}/dues', [\App\Http\Controllers\Api\Verein\VereinDuesAdminController::class, 'listDues'])->whereNumber('organizationId');
    Route::get('/v2/vereine/{organizationId}/dues/overdue', [\App\Http\Controllers\Api\Verein\VereinDuesAdminController::class, 'listOverdue'])->whereNumber('organizationId');
    Route::post('/v2/vereine/{organizationId}/dues/{duesId}/waive', [\App\Http\Controllers\Api\Verein\VereinDuesAdminController::class, 'waiveDues'])->whereNumber('organizationId')->whereNumber('duesId');
    Route::post('/v2/vereine/{organizationId}/dues/{duesId}/remind', [\App\Http\Controllers\Api\Verein\VereinDuesAdminController::class, 'sendReminder'])->whereNumber('organizationId')->whereNumber('duesId');
});

// ============================================
// Super Admin routes — Sanctum auth + super-admin middleware
// ============================================
Route::middleware(['auth:sanctum', 'super-admin'])->group(function () {

Route::get('/v2/admin/super/dashboard', [\App\Http\Controllers\Api\AdminSuperController::class, 'dashboard']);
Route::get('/v2/admin/super/tenants', [\App\Http\Controllers\Api\AdminSuperController::class, 'tenantList']);
Route::get('/v2/admin/super/tenants/hierarchy', [\App\Http\Controllers\Api\AdminSuperController::class, 'tenantHierarchy']);
Route::post('/v2/admin/super/tenants', [\App\Http\Controllers\Api\AdminSuperController::class, 'tenantCreate']);
Route::get('/v2/admin/super/tenants/{id}', [\App\Http\Controllers\Api\AdminSuperController::class, 'tenantShow']);
Route::put('/v2/admin/super/tenants/{id}', [\App\Http\Controllers\Api\AdminSuperController::class, 'tenantUpdate']);
Route::delete('/v2/admin/super/tenants/{id}', [\App\Http\Controllers\Api\AdminSuperController::class, 'tenantDelete']);
Route::get('/v2/admin/super/tenants/{id}/purge-preview', [\App\Http\Controllers\Api\AdminSuperController::class, 'tenantPurgePreview']);
Route::post('/v2/admin/super/tenants/{id}/purge', [\App\Http\Controllers\Api\AdminSuperController::class, 'tenantPurge']);
Route::post('/v2/admin/super/tenants/{id}/reactivate', [\App\Http\Controllers\Api\AdminSuperController::class, 'tenantReactivate']);
Route::post('/v2/admin/super/tenants/{id}/toggle-hub', [\App\Http\Controllers\Api\AdminSuperController::class, 'tenantToggleHub']);
Route::post('/v2/admin/super/tenants/{id}/move', [\App\Http\Controllers\Api\AdminSuperController::class, 'tenantMove']);
Route::get('/v2/admin/super/users', [\App\Http\Controllers\Api\AdminSuperController::class, 'userList']);
Route::post('/v2/admin/super/users', [\App\Http\Controllers\Api\AdminSuperController::class, 'userCreate']);
Route::get('/v2/admin/super/users/{id}', [\App\Http\Controllers\Api\AdminSuperController::class, 'userShow']);
Route::put('/v2/admin/super/users/{id}', [\App\Http\Controllers\Api\AdminSuperController::class, 'userUpdate']);
// Platform rollout switches. Platform super-admin only — these set the ceiling
// every community's own settings sit under, so they are not tenant-admin
// endpoints. Authorisation is enforced in the controller, not just here.
Route::get('/v2/admin/super/platform-capabilities', [\App\Http\Controllers\Api\SuperAdmin\PlatformCapabilityController::class, 'index']);
Route::put('/v2/admin/super/platform-capabilities', [\App\Http\Controllers\Api\SuperAdmin\PlatformCapabilityController::class, 'update']);

Route::post('/v2/admin/super/users/{id}/grant-super-admin', [\App\Http\Controllers\Api\AdminSuperController::class, 'userGrantSuperAdmin']);
Route::post('/v2/admin/super/users/{id}/revoke-super-admin', [\App\Http\Controllers\Api\AdminSuperController::class, 'userRevokeSuperAdmin']);
Route::post('/v2/admin/super/users/{id}/grant-global-super-admin', [\App\Http\Controllers\Api\AdminSuperController::class, 'userGrantGlobalSuperAdmin']);
Route::post('/v2/admin/super/users/{id}/revoke-global-super-admin', [\App\Http\Controllers\Api\AdminSuperController::class, 'userRevokeGlobalSuperAdmin']);
Route::post('/v2/admin/super/users/{id}/move-tenant', [\App\Http\Controllers\Api\AdminSuperController::class, 'userMoveTenant']);
Route::post('/v2/admin/super/users/{id}/move-and-promote', [\App\Http\Controllers\Api\AdminSuperController::class, 'userMoveAndPromote']);
Route::post('/v2/admin/super/bulk/move-users', [\App\Http\Controllers\Api\AdminSuperController::class, 'bulkMoveUsers']);
Route::post('/v2/admin/super/bulk/update-tenants', [\App\Http\Controllers\Api\AdminSuperController::class, 'bulkUpdateTenants']);
Route::get('/v2/admin/super/audit', [\App\Http\Controllers\Api\AdminSuperController::class, 'audit']);
Route::get('/v2/admin/super/federation', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationOverview']);
Route::get('/v2/admin/super/federation/system-controls', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationGetSystemControls']);
Route::get('/v2/admin/super/federation/jwt-status', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationGetJwtStatus']);
Route::get('/v2/admin/super/federation/external-status', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationGetExternalStatus']);
Route::put('/v2/admin/super/federation/system-controls', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationUpdateSystemControls']);
Route::post('/v2/admin/super/federation/emergency-lockdown', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationEmergencyLockdown']);
Route::post('/v2/admin/super/federation/lift-lockdown', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationLiftLockdown']);
Route::get('/v2/admin/super/federation/whitelist', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationGetWhitelist']);
Route::post('/v2/admin/super/federation/whitelist', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationAddToWhitelist']);
Route::delete('/v2/admin/super/federation/whitelist/{tenantId}', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationRemoveFromWhitelist']);
Route::get('/v2/admin/super/federation/partnerships', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationPartnerships']);
Route::post('/v2/admin/super/federation/partnerships/{id}/suspend', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationSuspendPartnership']);
Route::post('/v2/admin/super/federation/partnerships/{id}/reactivate', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationReactivatePartnership']);
Route::post('/v2/admin/super/federation/partnerships/{id}/terminate', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationTerminatePartnership']);
Route::get('/v2/admin/super/federation/tenant/{id}/features', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationGetTenantFeatures']);
Route::put('/v2/admin/super/federation/tenant/{id}/features', [\App\Http\Controllers\Api\AdminSuperController::class, 'federationUpdateTenantFeature']);

// Impersonate and super-admin promotion — requires super-admin (moved from admin group)
Route::post('/v2/admin/users/{id}/impersonate', [\App\Http\Controllers\Api\AdminUsersController::class, 'impersonate']);
Route::put('/v2/admin/users/{id}/super-admin', [\App\Http\Controllers\Api\AdminUsersController::class, 'setSuperAdmin']);
Route::put('/v2/admin/users/{id}/global-super-admin', [\App\Http\Controllers\Api\AdminUsersController::class, 'setGlobalSuperAdmin']);

// Identity verification fee configuration (super admin only)
Route::put('/v2/admin/super/identity/fee', [\App\Http\Controllers\Api\AdminSuperController::class, 'setIdentityVerificationFee']);

// Billing snapshot and plan assignment (god-level only)
Route::get('/v2/admin/super/billing/snapshot', [\App\Http\Controllers\Api\AdminSuperController::class, 'getBillingSnapshot']);
Route::post('/v2/admin/super/billing/assign-plan', [\App\Http\Controllers\Api\AdminSuperController::class, 'assignPlan']);
Route::get('/v2/admin/super/billing/revenue', [\App\Http\Controllers\Api\AdminSuperController::class, 'getRevenueDashboard']);
Route::get('/v2/admin/super/billing/export', [\App\Http\Controllers\Api\AdminSuperController::class, 'exportBillingCsv']);
Route::post('/v2/admin/super/billing/delegate/grant', [\App\Http\Controllers\Api\AdminSuperController::class, 'grantBillingDelegate']);
Route::post('/v2/admin/super/billing/delegate/revoke', [\App\Http\Controllers\Api\AdminSuperController::class, 'revokeBillingDelegate']);
Route::post('/v2/admin/super/billing/pause', [\App\Http\Controllers\Api\AdminSuperController::class, 'pauseTenantBilling']);
Route::post('/v2/admin/super/billing/resume', [\App\Http\Controllers\Api\AdminSuperController::class, 'resumeTenantBilling']);
Route::post('/v2/admin/super/billing/grace-period', [\App\Http\Controllers\Api\AdminSuperController::class, 'setBillingGracePeriod']);

// AG44 — Tenant provisioning queue (super-admin review + approve)
Route::get('/v2/super-admin/provisioning-requests', [\App\Http\Controllers\Api\SuperAdmin\TenantProvisioningController::class, 'index']);
Route::get('/v2/super-admin/provisioning-requests/{id}', [\App\Http\Controllers\Api\SuperAdmin\TenantProvisioningController::class, 'show'])->whereNumber('id');
Route::post('/v2/super-admin/provisioning-requests/{id}/approve', [\App\Http\Controllers\Api\SuperAdmin\TenantProvisioningController::class, 'approve'])->whereNumber('id');
Route::post('/v2/super-admin/provisioning-requests/{id}/reject', [\App\Http\Controllers\Api\SuperAdmin\TenantProvisioningController::class, 'reject'])->whereNumber('id');
Route::post('/v2/super-admin/provisioning-requests/{id}/retry', [\App\Http\Controllers\Api\SuperAdmin\TenantProvisioningController::class, 'retry'])->whereNumber('id');

}); // End Route::middleware(['auth:sanctum', 'super-admin'])

// ============================================
// National KISS Foundation Dashboard — Sanctum auth only
// ============================================
// Endpoint-level authorization (super-admin OR users with the
// `national.kiss_dashboard.view` permission) is enforced inside the
// controller. This keeps the route reachable for KISS national admins who
// are NOT platform super-admins.
Route::middleware(['auth:sanctum'])->group(function () {
    Route::get('/v2/admin/national/kiss/cooperatives', [\App\Http\Controllers\Api\Admin\NationalKissDashboardController::class, 'cooperatives']);
    Route::get('/v2/admin/national/kiss/summary', [\App\Http\Controllers\Api\Admin\NationalKissDashboardController::class, 'summary']);
    Route::get('/v2/admin/national/kiss/comparative', [\App\Http\Controllers\Api\Admin\NationalKissDashboardController::class, 'comparative']);
    Route::get('/v2/admin/national/kiss/trend', [\App\Http\Controllers\Api\Admin\NationalKissDashboardController::class, 'trend']);
});

// ============================================
// Admin CRM routes — Sanctum auth + admin middleware
// ============================================
Route::middleware(['auth:sanctum', 'admin'])->group(function () {

Route::get('/v2/admin/crm/dashboard', [\App\Http\Controllers\Api\AdminCrmController::class, 'dashboard']);
// Broker-or-admin: funnel + member notes are used by the broker panel's
// Members and Onboarding pages.
Route::withoutMiddleware('admin')->middleware('broker-or-admin')->group(function () {
    Route::get('/v2/admin/crm/funnel', [\App\Http\Controllers\Api\AdminCrmController::class, 'funnel']);
    Route::get('/v2/admin/crm/notes', [\App\Http\Controllers\Api\AdminCrmController::class, 'listNotes']);
    Route::post('/v2/admin/crm/notes', [\App\Http\Controllers\Api\AdminCrmController::class, 'createNote']);
});
Route::get('/v2/admin/crm/admins', [\App\Http\Controllers\Api\AdminCrmController::class, 'listAdmins']);
Route::put('/v2/admin/crm/notes/{id}', [\App\Http\Controllers\Api\AdminCrmController::class, 'updateNote']);
Route::delete('/v2/admin/crm/notes/{id}', [\App\Http\Controllers\Api\AdminCrmController::class, 'deleteNote']);
Route::get('/v2/admin/crm/tasks', [\App\Http\Controllers\Api\AdminCrmController::class, 'listTasks']);
Route::post('/v2/admin/crm/tasks', [\App\Http\Controllers\Api\AdminCrmController::class, 'createTask']);
Route::put('/v2/admin/crm/tasks/{id}', [\App\Http\Controllers\Api\AdminCrmController::class, 'updateTask']);
Route::delete('/v2/admin/crm/tasks/{id}', [\App\Http\Controllers\Api\AdminCrmController::class, 'deleteTask']);
Route::get('/v2/admin/crm/tags', [\App\Http\Controllers\Api\AdminCrmController::class, 'listTags']);
Route::post('/v2/admin/crm/tags', [\App\Http\Controllers\Api\AdminCrmController::class, 'addTag']);
Route::delete('/v2/admin/crm/tags/bulk', [\App\Http\Controllers\Api\AdminCrmController::class, 'bulkRemoveTag']);
Route::delete('/v2/admin/crm/tags/{id}', [\App\Http\Controllers\Api\AdminCrmController::class, 'removeTag']);
Route::get('/v2/admin/crm/timeline', [\App\Http\Controllers\Api\AdminCrmController::class, 'timeline']);
Route::get('/v2/admin/crm/export/notes', [\App\Http\Controllers\Api\AdminCrmController::class, 'exportNotes']);
Route::get('/v2/admin/crm/export/tasks', [\App\Http\Controllers\Api\AdminCrmController::class, 'exportTasks']);
Route::get('/v2/admin/crm/export/dashboard', [\App\Http\Controllers\Api\AdminCrmController::class, 'exportDashboard']);

// ============================================

}); // End Route::middleware(['auth:sanctum', 'admin']) — CRM

// ============================================
// Public routes (auth, CSRF, VAPID — no auth required)
// ============================================
Route::get('/push/vapid-key', [\App\Http\Controllers\Api\PushController::class, 'vapidKey']);
Route::get('/push/vapid-public-key', [\App\Http\Controllers\Api\PushController::class, 'vapidKey']);
// Session management — rate-limited to prevent abuse (30 req/min per IP)
Route::middleware('throttle:nexus-route-30-per-1m')->group(function () {
    Route::post('/auth/heartbeat', [\App\Http\Controllers\Api\AuthController::class, 'heartbeat']);
    Route::get('/auth/check-session', [\App\Http\Controllers\Api\AuthController::class, 'checkSession']);
    Route::post('/auth/refresh-session', [\App\Http\Controllers\Api\AuthController::class, 'refreshSession']);
    Route::post('/auth/restore-session', [\App\Http\Controllers\Api\AuthController::class, 'restoreSession']);
});
// Rate-limited auth endpoints (30 requests/minute per IP — DoS protection; brute-force handled by DB limiter in controller)
Route::middleware('throttle:nexus-route-30-per-1m')->group(function () {
    Route::post('/auth/login', [\App\Http\Controllers\Api\AuthController::class, 'login']);
    Route::post('/v2/auth/register', [\App\Http\Controllers\Api\RegistrationController::class, 'register']);
    Route::post('/webauthn/auth-challenge', [\App\Http\Controllers\Api\WebAuthnController::class, 'authChallenge']);
    Route::post('/webauthn/auth-verify', [\App\Http\Controllers\Api\WebAuthnController::class, 'authVerify']);
});
// TOTP verify — strict throttle (5/min) to prevent 6-digit code brute-force during 2FA login
Route::get('/v2/auth/registration-info', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'getRegistrationInfo'])->middleware('throttle:nexus-route-30-per-1m');
Route::post('/v2/auth/validate-invite', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'validateInviteCode'])->middleware('throttle:nexus-route-10-per-1m');
Route::post('/totp/verify', [\App\Http\Controllers\Api\TotpController::class, 'verify'])->middleware('throttle:nexus-route-5-per-1m');
// Password reset endpoints — stricter throttle to mitigate email enumeration/spam (5/min per IP)
Route::middleware('throttle:nexus-route-5-per-1m')->group(function () {
    Route::post('/auth/forgot-password', [\App\Http\Controllers\Api\PasswordResetController::class, 'forgotPassword']);
    Route::post('/auth/reset-password', [\App\Http\Controllers\Api\PasswordResetController::class, 'resetPassword']);
});
Route::middleware('throttle:nexus-route-30-per-1m')->group(function () {
    Route::post('/auth/verify-email', [\App\Http\Controllers\Api\EmailVerificationController::class, 'verifyEmail']);
    Route::post('/auth/resend-verification', [\App\Http\Controllers\Api\EmailVerificationController::class, 'resendVerification']);
    Route::post('/auth/resend-verification-by-email', [\App\Http\Controllers\Api\EmailVerificationController::class, 'resendVerificationByEmail']);
});

// Auth utilities — rate-limited to prevent token enumeration/abuse (30 req/min per IP)
Route::middleware('throttle:nexus-route-30-per-1m')->group(function () {
    Route::post('/auth/logout', [\App\Http\Controllers\Api\AuthController::class, 'logout']);
    Route::post('/auth/refresh-token', [\App\Http\Controllers\Api\AuthController::class, 'refreshToken']);
    Route::post('/auth/validate-token', [\App\Http\Controllers\Api\AuthController::class, 'validateToken']);
    Route::get('/auth/validate-token', [\App\Http\Controllers\Api\AuthController::class, 'validateToken']);
});
// CSRF tokens are high-frequency, rate-limit more generously (60 req/min per IP)
Route::middleware('throttle:nexus-route-60-per-1m')->group(function () {
    Route::get('/auth/csrf-token', [\App\Http\Controllers\Api\AuthController::class, 'getCsrfToken']);
    Route::get('/v2/csrf-token', [\App\Http\Controllers\Api\AuthController::class, 'getCsrfToken']);
    Route::get('/csrf-token', [\App\Http\Controllers\Api\AuthController::class, 'getCsrfToken']);
});

// Newsletter unsubscribe/tracking — public (recipients may not be logged in)
Route::get('/v2/newsletter/unsubscribe', [\App\Http\Controllers\Api\NewsletterController::class, 'unsubscribe'])->middleware('throttle:nexus-route-30-per-1m');
Route::post('/v2/newsletter/unsubscribe', [\App\Http\Controllers\Api\NewsletterController::class, 'unsubscribe'])->middleware('throttle:nexus-route-30-per-1m');
Route::get('/v2/newsletter/pixel/{token}', [\App\Http\Controllers\Api\NewsletterController::class, 'trackOpen']);
Route::get('/v2/newsletter/click/{token}', [\App\Http\Controllers\Api\NewsletterController::class, 'trackClick'])->middleware('throttle:nexus-route-120-per-1m');

// SOC13 — Social login (OAuth). Redirect/callback are public so anonymous
// visitors can start a sign-in flow. Link/unlink/identities live inside
// auth:sanctum below.
Route::middleware('throttle:nexus-route-30-per-1m')->group(function () {
    Route::get('/v2/auth/oauth/enabled-providers', [\App\Http\Controllers\Auth\SocialAuthController::class, 'enabledProviders']);
    Route::post('/v2/auth/oauth/exchange', [\App\Http\Controllers\Auth\SocialAuthController::class, 'exchange']);
    Route::get('/v2/auth/oauth/{provider}/redirect', [\App\Http\Controllers\Auth\SocialAuthController::class, 'redirect'])
        ->where('provider', 'google|facebook');
    Route::match(['get', 'post'], '/v2/auth/oauth/{provider}/callback', [\App\Http\Controllers\Auth\SocialAuthController::class, 'callback'])
        ->where('provider', 'google|facebook');
});

// SSO engine (IT-Sec-05) — tenant-configured OIDC providers (Entra ID,
// Hivebrite, …). Public so anonymous visitors can start a sign-in flow;
// token exchange reuses /v2/auth/oauth/exchange above.
Route::middleware('throttle:nexus-route-30-per-1m')->group(function () {
    Route::get('/v2/auth/sso/providers', [\App\Http\Controllers\Auth\SsoAuthController::class, 'providers']);
    Route::get('/v2/auth/sso/callback', [\App\Http\Controllers\Auth\SsoAuthController::class, 'callback']);
    Route::get('/v2/auth/sso/{provider}/redirect', [\App\Http\Controllers\Auth\SsoAuthController::class, 'redirect'])
        ->where('provider', '[a-z0-9_-]{2,20}');
});

// ============================================
// Public routes — No auth required
// These were incorrectly inside auth:sanctum but must be accessible
// to unauthenticated visitors (menus, WebAuthn login, password reset, etc.)
// ============================================
Route::get('/menus', [\App\Http\Controllers\Api\MenuController::class, 'index']);
Route::get('/menus/config', [\App\Http\Controllers\Api\MenuController::class, 'config']);
Route::get('/menus/mobile', [\App\Http\Controllers\Api\MenuController::class, 'mobile']);
Route::get('/menus/{slug}', [\App\Http\Controllers\Api\MenuController::class, 'show']);
Route::post('/v2/contact', [\App\Http\Controllers\Api\CoreController::class, 'apiSubmit'])->middleware('throttle:nexus-route-5-per-1m');

// API documentation
Route::get('/docs', [\App\Http\Controllers\Api\OpenApiDocController::class, 'ui']);
Route::get('/docs/openapi.json', [\App\Http\Controllers\Api\OpenApiDocController::class, 'json']);
Route::get('/docs/openapi.yaml', [\App\Http\Controllers\Api\OpenApiDocController::class, 'yaml']);

// ============================================
// Misc/legacy/federation routes — Sanctum auth required
// Controllers also enforce auth internally as a fallback
// ============================================
Route::middleware('auth:sanctum')->group(function () {

// MIGRATED ROUTES — Misc API (Social, Auth, Push, AI, Menus, Wallet Features, Events, Volunteering, Ideation, Matching)
// Source: httpdocs/routes/misc-api.php
// ============================================
// Legacy social routes (deprecated — use V2 GET/POST equivalents above)
Route::get('/social/test', [\App\Http\Controllers\Api\SocialController::class, 'test']);
Route::post('/social/like', [\App\Http\Controllers\Api\SocialController::class, 'like']);
Route::post('/social/likers', [\App\Http\Controllers\Api\SocialController::class, 'likers']); // deprecated: use V2 GET equivalent
Route::post('/social/comments', [\App\Http\Controllers\Api\SocialController::class, 'comments']); // deprecated: use V2 GET equivalent
Route::post('/social/share', [\App\Http\Controllers\Api\SocialController::class, 'share']);
Route::post('/social/delete', [\App\Http\Controllers\Api\SocialController::class, 'delete']);
Route::post('/social/reaction', [\App\Http\Controllers\Api\SocialController::class, 'reaction']);
Route::post('/social/reply', [\App\Http\Controllers\Api\SocialController::class, 'reply']);
Route::post('/social/edit-comment', [\App\Http\Controllers\Api\SocialController::class, 'editComment']);
Route::post('/social/delete-comment', [\App\Http\Controllers\Api\SocialController::class, 'deleteComment']);
Route::post('/social/mention-search', [\App\Http\Controllers\Api\SocialController::class, 'mentionSearch']); // deprecated: use V2 GET equivalent
Route::post('/social/feed', [\App\Http\Controllers\Api\SocialController::class, 'feed']); // deprecated: use GET /v2/feed
Route::post('/social/create-post', [\App\Http\Controllers\Api\SocialController::class, 'createPost']);
// Generic authenticated upload endpoint — throttle to prevent storage DoS via
// high-frequency small-file uploads. Canonical path is /v2/upload (matches the
// controller's $isV2Api contract and every frontend caller, e.g. the newsletter
// builder's asset manager). /upload is kept as a legacy alias.
Route::middleware('throttle:nexus-route-30-per-1m')->post('/v2/upload', [\App\Http\Controllers\Api\UploadController::class, 'store']);
Route::middleware('throttle:nexus-route-30-per-1m')->post('/upload', [\App\Http\Controllers\Api\UploadController::class, 'store']);
// Asset library — list the tenant's previously-uploaded images (newsletter builder).
Route::middleware('throttle:nexus-route-60-per-1m')->get('/v2/upload/list', [\App\Http\Controllers\Api\UploadController::class, 'index']);
Route::post('/push/subscribe', [\App\Http\Controllers\Api\PushController::class, 'subscribe']);
Route::post('/push/unsubscribe', [\App\Http\Controllers\Api\PushController::class, 'unsubscribe']);
Route::post('/push/send', [\App\Http\Controllers\Api\PushController::class, 'send']);
Route::get('/push/status', [\App\Http\Controllers\Api\PushController::class, 'status']);
Route::post('/push/register-device', [\App\Http\Controllers\Api\PushController::class, 'registerDevice']);
Route::post('/push/unregister-device', [\App\Http\Controllers\Api\PushController::class, 'unregisterDevice']);
Route::post('/auth/revoke', [\App\Http\Controllers\Api\AuthController::class, 'revokeToken']);
Route::post('/auth/revoke-all', [\App\Http\Controllers\Api\AuthController::class, 'revokeAllTokens']);
Route::post('/auth/admin-session', [\App\Http\Controllers\Api\AuthController::class, 'adminSession']);
Route::get('/auth/admin-session', [\App\Http\Controllers\Api\AuthController::class, 'adminSession']);
Route::get('/v2/auth/verification-status', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'getVerificationStatus']);
Route::post('/v2/auth/start-verification', [\App\Http\Controllers\Api\RegistrationPolicyController::class, 'startVerification'])->middleware('throttle:nexus-route-10-per-1m');

// Optional identity verification (for active users wanting an ID Verified badge)
Route::get('/v2/identity/status', [\App\Http\Controllers\Api\OptionalIdentityVerificationController::class, 'getStatus']);
Route::post('/v2/identity/start', [\App\Http\Controllers\Api\OptionalIdentityVerificationController::class, 'startVerification'])->middleware('throttle:nexus-route-5-per-1m');
Route::post('/v2/identity/save-dob', [\App\Http\Controllers\Api\OptionalIdentityVerificationController::class, 'saveDob'])->middleware('throttle:nexus-route-10-per-1m');
Route::post('/v2/identity/create-payment', [\App\Http\Controllers\Api\OptionalIdentityVerificationController::class, 'createPaymentIntent'])->middleware('throttle:nexus-route-5-per-1m');
// NOTE: identity webhook route moved to public webhook section (below auth group)
// NOTE: /docs, /auth/forgot-password, /auth/reset-password, /auth/verify-email,
// /auth/resend-verification, /auth/resend-verification-by-email are public routes (registered above auth group)
// NOTE: /totp/verify moved to public routes section (user has no token during 2FA login)
Route::get('/totp/status', [\App\Http\Controllers\Api\TotpController::class, 'status']);
// SOC13 — Social login (OAuth) authenticated routes
Route::post('/v2/auth/oauth/{provider}/link', [\App\Http\Controllers\Auth\SocialAuthController::class, 'link'])
    ->where('provider', 'google|facebook')->middleware('throttle:nexus-route-10-per-1m');
Route::delete('/v2/auth/oauth/{provider}/unlink', [\App\Http\Controllers\Auth\SocialAuthController::class, 'unlink'])
    ->where('provider', 'google|facebook')->middleware('throttle:nexus-route-10-per-1m');
Route::get('/v2/auth/oauth/me/identities', [\App\Http\Controllers\Auth\SocialAuthController::class, 'identities'])
    ->middleware('throttle:nexus-route-30-per-1m');

Route::get('/v2/auth/2fa/status', [\App\Http\Controllers\Api\TwoFactorController::class, 'status'])->middleware('throttle:nexus-route-30-per-1m');
Route::post('/v2/auth/2fa/setup', [\App\Http\Controllers\Api\TwoFactorController::class, 'setup'])->middleware('throttle:nexus-route-5-per-1m');
Route::post('/v2/auth/2fa/verify', [\App\Http\Controllers\Api\TwoFactorController::class, 'verify'])->middleware('throttle:nexus-route-5-per-1m');
Route::post('/v2/auth/2fa/disable', [\App\Http\Controllers\Api\TwoFactorController::class, 'disable'])->middleware('throttle:nexus-route-5-per-1m');
Route::post('/app/check-version', [\App\Http\Controllers\Api\AppController::class, 'checkVersion'])->withoutMiddleware('auth:sanctum');
Route::get('/app/version', [\App\Http\Controllers\Api\AppController::class, 'version'])->withoutMiddleware('auth:sanctum');
Route::post('/app/log', [\App\Http\Controllers\Api\AppController::class, 'log'])->withoutMiddleware('auth:sanctum')->middleware('throttle:nexus-route-10-per-1m');
Route::post('/pusher/auth', [\App\Http\Controllers\Api\PusherController::class, 'auth']);
Route::get('/pusher/auth', [\App\Http\Controllers\Api\PusherController::class, 'auth']);
Route::get('/pusher/config', [\App\Http\Controllers\Api\PusherController::class, 'config']);
// Alias under /v2 — already-shipped mobile builds request /api/v2/pusher/config;
// without this alias those binaries 404 and realtime silently dies on mobile.
Route::get('/v2/pusher/config', [\App\Http\Controllers\Api\PusherController::class, 'config']);
// WebAuthn state-changing endpoints — rate-limited (10 req/min per IP) to prevent abuse of
// challenge generation and credential mutation. Public pre-login WebAuthn endpoints
// (/webauthn/auth-challenge, /webauthn/auth-verify) are throttled separately at throttle:nexus-route-30-per-1m
// in the public auth group above.
Route::post('/webauthn/register-challenge', [\App\Http\Controllers\Api\WebAuthnController::class, 'registerChallenge'])->middleware('throttle:nexus-route-10-per-1m');
Route::post('/webauthn/register-verify', [\App\Http\Controllers\Api\WebAuthnController::class, 'registerVerify'])->middleware('throttle:nexus-route-10-per-1m');
Route::post('/webauthn/security-confirm', [\App\Http\Controllers\Api\WebAuthnController::class, 'confirmSecurityAction'])->middleware('throttle:nexus-route-10-per-1m');
// NOTE: POST /webauthn/auth-challenge and /webauthn/auth-verify are public
// routes (registered above this auth group) because they are pre-login flows.
Route::post('/webauthn/remove', [\App\Http\Controllers\Api\WebAuthnController::class, 'remove'])->middleware('throttle:nexus-route-10-per-1m');
Route::post('/webauthn/rename', [\App\Http\Controllers\Api\WebAuthnController::class, 'rename'])->middleware('throttle:nexus-route-10-per-1m');
Route::post('/webauthn/remove-all', [\App\Http\Controllers\Api\WebAuthnController::class, 'removeAll'])->middleware('throttle:nexus-route-10-per-1m');
Route::get('/webauthn/credentials', [\App\Http\Controllers\Api\WebAuthnController::class, 'credentials']);
Route::get('/webauthn/status', [\App\Http\Controllers\Api\WebAuthnController::class, 'status']);
Route::post('/ai/chat', [\App\Http\Controllers\Api\AiChatController::class, 'chat']);
Route::post('/ai/chat/feedback', [\App\Http\Controllers\Api\AiChatController::class, 'feedback']);
Route::get('/ai/chat/starters', [\App\Http\Controllers\Api\AiChatController::class, 'starters']);
Route::post('/ai/chat/stream', [\App\Http\Controllers\Api\AiChatController::class, 'streamChat']);
Route::get('/ai/conversations', [\App\Http\Controllers\Api\AiChatController::class, 'listConversations']);
Route::get('/ai/conversations/{id}', [\App\Http\Controllers\Api\AiChatController::class, 'getConversation']);
Route::post('/ai/conversations', [\App\Http\Controllers\Api\AiChatController::class, 'createConversation']);
Route::delete('/ai/conversations/{id}', [\App\Http\Controllers\Api\AiChatController::class, 'deleteConversation']);
Route::get('/ai/providers', [\App\Http\Controllers\Api\AiChatController::class, 'getProviders']);
Route::get('/ai/limits', [\App\Http\Controllers\Api\AiChatController::class, 'getLimits']);
Route::post('/ai/test-provider', [\App\Http\Controllers\Api\AiChatController::class, 'testProvider'])->middleware(['admin', 'throttle:nexus-route-10-per-1m']);
Route::post('/ai/generate/listing', [\App\Http\Controllers\Api\AiChatController::class, 'generateListing']);
Route::post('/ai/generate/event', [\App\Http\Controllers\Api\AiChatController::class, 'generateEvent']);
Route::post('/ai/generate/message', [\App\Http\Controllers\Api\AiChatController::class, 'generateMessage']);
Route::post('/ai/generate/bio', [\App\Http\Controllers\Api\AiChatController::class, 'generateBio']);
Route::post('/ai/generate/newsletter', [\App\Http\Controllers\Api\AiChatController::class, 'generateNewsletter']);
Route::post('/ai/generate/blog', [\App\Http\Controllers\Api\AiChatController::class, 'generateBlog']);
Route::post('/ai/generate/page', [\App\Http\Controllers\Api\AiChatController::class, 'generatePage']);
Route::post('/menus/clear-cache', [\App\Http\Controllers\Api\MenuController::class, 'clearCache']);
// NOTE: GET /menus, /menus/config, /menus/mobile, /menus/{slug} are public routes (registered above auth group)
// NOTE: POST /v2/contact is a public route (registered above auth group)
Route::post('/help/feedback', [\App\Http\Controllers\Api\HelpController::class, 'feedback']);
Route::get('/groups/{id}/analytics', [\App\Http\Controllers\Api\AdminGroupsController::class, 'apiData'])
    ->whereNumber('id')->middleware(['feature:groups', 'auth:sanctum', 'admin']);
Route::middleware('feature:groups')->whereNumber('id')->group(function () {
    Route::get('/recommendations/groups', [\App\Http\Controllers\Api\GroupRecommendController::class, 'index']);
    Route::post('/recommendations/track', [\App\Http\Controllers\Api\GroupRecommendController::class, 'track']);
    Route::get('/recommendations/metrics', [\App\Http\Controllers\Api\GroupRecommendController::class, 'metrics']);
    Route::get('/recommendations/similar/{id}', [\App\Http\Controllers\Api\GroupRecommendController::class, 'similar']);
});
Route::get('/notifications/settings', [\App\Http\Controllers\Api\UsersController::class, 'getSettings']);
Route::post('/notifications/settings', [\App\Http\Controllers\Api\UsersController::class, 'updateSettings']);

// Generic one-click unsubscribe for ANY bulk / notification email.
// Public — token-authenticated, no login required (link from an email).
// Both verbs are required: GET for browser visits, POST for List-Unsubscribe-Post
// one-click compliance (Gmail / Yahoo Feb-2024 bulk-sender rules).
Route::get('/v2/notifications/unsubscribe', [\App\Http\Controllers\Api\NotificationUnsubscribeController::class, 'show'])->withoutMiddleware('auth:sanctum');
Route::post('/v2/notifications/unsubscribe', [\App\Http\Controllers\Api\NotificationUnsubscribeController::class, 'oneClick'])->withoutMiddleware('auth:sanctum');

// Admin email deliverability dashboard endpoints (auth + admin middleware required).
Route::get('/v2/admin/email-deliverability/summary',          [\App\Http\Controllers\Api\AdminEmailDeliverabilityController::class, 'summary'])->middleware(['auth:sanctum', 'admin']);
Route::get('/v2/admin/email-deliverability/push-summary',     [\App\Http\Controllers\Api\AdminEmailDeliverabilityController::class, 'pushSummary'])->middleware(['auth:sanctum', 'admin']);
Route::get('/v2/admin/email-deliverability/trigger-audit',    [\App\Http\Controllers\Api\AdminEmailDeliverabilityController::class, 'triggerAudit'])->middleware(['auth:sanctum', 'admin']);
Route::get('/v2/admin/email-deliverability/logs',             [\App\Http\Controllers\Api\AdminEmailDeliverabilityController::class, 'logs'])->middleware(['auth:sanctum', 'admin']);
Route::get('/v2/admin/email-deliverability/queues',           [\App\Http\Controllers\Api\AdminEmailDeliverabilityController::class, 'queues'])->middleware(['auth:sanctum', 'admin']);
Route::get('/v2/admin/email-deliverability/suppressions',     [\App\Http\Controllers\Api\AdminEmailDeliverabilityController::class, 'suppressions'])->middleware(['auth:sanctum', 'admin']);
Route::delete('/v2/admin/email-deliverability/suppressions/{id}', [\App\Http\Controllers\Api\AdminEmailDeliverabilityController::class, 'removeSuppression'])->middleware(['auth:sanctum', 'admin']);
Route::get('/v2/admin/email-deliverability/user/{userId}',    [\App\Http\Controllers\Api\AdminEmailDeliverabilityController::class, 'userHistory'])->middleware(['auth:sanctum', 'admin']);
Route::get('/leaderboard', [\App\Http\Controllers\Api\GamificationController::class, 'api']);
Route::get('/leaderboard/widget', [\App\Http\Controllers\Api\GamificationController::class, 'widget']);
Route::get('/streaks', [\App\Http\Controllers\Api\GamificationController::class, 'streaks']);
Route::get('/achievements', [\App\Http\Controllers\Api\GamificationController::class, 'api']);
Route::get('/achievements/progress', [\App\Http\Controllers\Api\GamificationController::class, 'progress']);
Route::post('/daily-reward/check', [\App\Http\Controllers\Api\GamificationController::class, 'checkDailyReward']);
Route::get('/daily-reward/status', [\App\Http\Controllers\Api\GamificationController::class, 'getDailyStatus']);
Route::get('/gamification/challenges', [\App\Http\Controllers\Api\GamificationController::class, 'getChallenges']);
Route::get('/gamification/collections', [\App\Http\Controllers\Api\GamificationController::class, 'getCollections']);
Route::get('/gamification/shop', [\App\Http\Controllers\Api\GamificationController::class, 'getShopItems']);
Route::post('/gamification/shop/purchase', [\App\Http\Controllers\Api\GamificationController::class, 'purchaseItem']);
Route::get('/gamification/summary', [\App\Http\Controllers\Api\GamificationController::class, 'getSummary']);
Route::post('/gamification/showcase', [\App\Http\Controllers\Api\GamificationController::class, 'updateShowcase']);
Route::get('/gamification/showcased', [\App\Http\Controllers\Api\GamificationController::class, 'getShowcasedBadges']);
Route::get('/gamification/share', [\App\Http\Controllers\Api\GamificationController::class, 'shareAchievement']);
Route::get('/gamification/seasons', [\App\Http\Controllers\Api\GamificationController::class, 'getSeasons']);
Route::get('/gamification/seasons/current', [\App\Http\Controllers\Api\GamificationController::class, 'getCurrentSeason']);
Route::post('/shop/purchase', [\App\Http\Controllers\Api\GamificationController::class, 'purchaseItem']);
Route::get('/insights', [\App\Http\Controllers\Api\AdminDashboardController::class, 'apiInsights'])->middleware(['auth:sanctum', 'admin']);
Route::post('/feed/hide', [\App\Http\Controllers\Api\FeedController::class, 'hidePost']);
Route::post('/feed/mute', [\App\Http\Controllers\Api\FeedController::class, 'muteUser']);
Route::post('/feed/report', [\App\Http\Controllers\Api\FeedController::class, 'reportPost']);
Route::post('/messages/voice', [\App\Http\Controllers\Api\VoiceMessageController::class, 'store']);
// Legacy message routes removed — all clients use /v2/messages (MessagesController)
Route::post('/messages/delete', [\App\Http\Controllers\Api\MessagesController::class, 'deleteMessage']);
Route::post('/messages/delete-conversation', [\App\Http\Controllers\Api\MessagesController::class, 'deleteConversation']);
Route::post('/messages/reaction', [\App\Http\Controllers\Api\MessagesController::class, 'toggleReaction']);
Route::get('/messages/reactions-batch', [\App\Http\Controllers\Api\MessagesController::class, 'getReactionsBatch']);
Route::get('/admin/users/search', [\App\Http\Controllers\Api\AdminTimebankingController::class, 'userSearchApi'])->middleware(['auth:sanctum', 'admin']);
// Newsletter unsubscribe/tracking — moved to public routes (no auth required)
// See public section below line 1244
Route::post('/gdpr/consent', [\App\Http\Controllers\Api\GdprController::class, 'updateConsent']);
Route::post('/gdpr/request', [\App\Http\Controllers\Api\GdprController::class, 'createRequest']);
Route::post('/gdpr/delete-account', [\App\Http\Controllers\Api\GdprController::class, 'deleteAccount']);
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::get('/v2/admin/community-analytics', [\App\Http\Controllers\Api\AdminCommunityAnalyticsController::class, 'index']);
    Route::get('/v2/admin/community-analytics/export', [\App\Http\Controllers\Api\AdminCommunityAnalyticsController::class, 'export']);
    Route::get('/v2/admin/community-analytics/geography', [\App\Http\Controllers\Api\AdminCommunityAnalyticsController::class, 'geography']);
    Route::get('/v2/admin/impact-report', [\App\Http\Controllers\Api\AdminImpactReportController::class, 'index']);
    Route::put('/v2/admin/impact-report/config', [\App\Http\Controllers\Api\AdminImpactReportController::class, 'updateConfig']);
});
// ── Onboarding — Sanctum auth required ───────────────────────────────────────
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/v2/onboarding/status', [\App\Http\Controllers\Api\OnboardingController::class, 'status']);
    Route::get('/v2/onboarding/config', [\App\Http\Controllers\Api\OnboardingController::class, 'getConfig']);
    Route::get('/v2/onboarding/categories', [\App\Http\Controllers\Api\OnboardingController::class, 'categories']);
    Route::get('/v2/onboarding/safeguarding-options', [\App\Http\Controllers\Api\OnboardingController::class, 'safeguardingOptions']);
    Route::post('/v2/onboarding/safeguarding', [\App\Http\Controllers\Api\OnboardingController::class, 'saveSafeguarding'])->middleware('throttle:nexus-route-5-per-1m');
    Route::post('/v2/onboarding/complete', [\App\Http\Controllers\Api\OnboardingController::class, 'complete'])->middleware('throttle:nexus-route-5-per-1m');
});
Route::middleware('feature:groups')
    ->where([
        'id' => '[0-9]+',
        'userId' => '[0-9]+',
    ])
    ->group(function () {
Route::get('/v2/group-exchanges', [\App\Http\Controllers\Api\GroupExchangeController::class, 'index']);
Route::post('/v2/group-exchanges', [\App\Http\Controllers\Api\GroupExchangeController::class, 'store']);
Route::get('/v2/group-exchanges/{id}', [\App\Http\Controllers\Api\GroupExchangeController::class, 'show']);
Route::put('/v2/group-exchanges/{id}', [\App\Http\Controllers\Api\GroupExchangeController::class, 'update']);
Route::delete('/v2/group-exchanges/{id}', [\App\Http\Controllers\Api\GroupExchangeController::class, 'destroy']);
Route::post('/v2/group-exchanges/{id}/participants', [\App\Http\Controllers\Api\GroupExchangeController::class, 'addParticipant']);
Route::delete('/v2/group-exchanges/{id}/participants/{userId}', [\App\Http\Controllers\Api\GroupExchangeController::class, 'removeParticipant']);
Route::post('/v2/group-exchanges/{id}/start', [\App\Http\Controllers\Api\GroupExchangeController::class, 'start']);
Route::post('/v2/group-exchanges/{id}/confirm', [\App\Http\Controllers\Api\GroupExchangeController::class, 'confirm']);
Route::post('/v2/group-exchanges/{id}/complete', [\App\Http\Controllers\Api\GroupExchangeController::class, 'complete']);
});
Route::get('/v2/wallet/statement', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'statement']);
Route::get('/v2/wallet/categories', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'listCategories']);
Route::post('/v2/wallet/categories', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'createCategory']);
Route::put('/v2/wallet/categories/{id}', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'updateCategory']);
Route::delete('/v2/wallet/categories/{id}', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'deleteCategory']);
Route::get('/v2/wallet/community-fund', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'communityFundBalance']);
Route::get('/v2/wallet/community-fund/transactions', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'communityFundTransactions']);
Route::post('/v2/wallet/community-fund/deposit', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'communityFundDeposit']);
Route::post('/v2/wallet/community-fund/withdraw', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'communityFundWithdraw']);
Route::post('/v2/wallet/community-fund/donate', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'communityFundDonate']);
Route::post('/v2/wallet/donate', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'donate']);
Route::get('/v2/wallet/donations', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'donationHistory']);
Route::get('/v2/wallet/starting-balance', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'getStartingBalance']);
Route::put('/v2/wallet/starting-balance', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'setStartingBalance']);
Route::post('/v2/exchanges/{id}/rate', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'rateExchange']);
Route::get('/v2/exchanges/{id}/ratings', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'exchangeRatings']);
Route::get('/v2/users/{id}/rating', [\App\Http\Controllers\Api\WalletFeaturesController::class, 'userRating']);
Route::get('/v2/volunteering/recommended-shifts', [\App\Http\Controllers\Api\VolunteerController::class, 'recommendedShifts']);
Route::get('/v2/volunteering/certificates', [\App\Http\Controllers\Api\VolunteerCertificateController::class, 'myCertificates']);
Route::post('/v2/volunteering/certificates', [\App\Http\Controllers\Api\VolunteerCertificateController::class, 'generateCertificate']);
Route::get('/v2/volunteering/certificates/verify/{code}', [\App\Http\Controllers\Api\VolunteerCertificateController::class, 'verifyCertificate'])->middleware('auth:sanctum');
Route::get('/v2/volunteering/certificates/{code}/html', [\App\Http\Controllers\Api\VolunteerCertificateController::class, 'certificateHtml'])->middleware('auth:sanctum');
Route::get('/v2/volunteering/credentials', [\App\Http\Controllers\Api\VolunteerCertificateController::class, 'myCredentials']);
Route::post('/v2/volunteering/credentials', [\App\Http\Controllers\Api\VolunteerCertificateController::class, 'uploadCredential'])->middleware('throttle:nexus-route-20-per-1m');
Route::get('/v2/volunteering/credentials/{id}/download', [\App\Http\Controllers\Api\VolunteerCertificateController::class, 'downloadCredential']);
Route::delete('/v2/volunteering/credentials/{id}', [\App\Http\Controllers\Api\VolunteerCertificateController::class, 'deleteCredential']);
Route::get('/v2/volunteering/emergency-alerts', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'myEmergencyAlerts']);
Route::post('/v2/volunteering/emergency-alerts', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'createEmergencyAlert']);
Route::put('/v2/volunteering/emergency-alerts/{id}', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'respondToEmergencyAlert']);
Route::delete('/v2/volunteering/emergency-alerts/{id}', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'cancelEmergencyAlert']);
Route::get('/v2/volunteering/wellbeing', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'wellbeingDashboard']);
Route::post('/v2/volunteering/wellbeing/checkin', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'wellbeingCheckin']);
Route::get('/v2/volunteering/wellbeing/my-status', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'myWellbeingStatus']);
Route::get('/v2/volunteering/swaps', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'getSwapRequests']);
Route::post('/v2/volunteering/swaps', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'requestSwap']);
Route::put('/v2/volunteering/swaps/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'respondToSwap']);
Route::delete('/v2/volunteering/swaps/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'cancelSwap']);
Route::get('/v2/volunteering/admin/swaps', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'adminPendingSwaps']);
Route::put('/v2/volunteering/admin/swaps/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'adminDecideSwap']);
Route::get('/v2/volunteering/my-waitlists', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'myWaitlists']);
Route::post('/v2/volunteering/shifts/{id}/waitlist', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'joinWaitlist']);
Route::delete('/v2/volunteering/shifts/{id}/waitlist', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'leaveWaitlist']);
Route::post('/v2/volunteering/shifts/{id}/waitlist/promote', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'promoteFromWaitlist']);
Route::get('/v2/volunteering/group-reservations', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'myGroupReservations']);
Route::post('/v2/volunteering/shifts/{id}/group-reserve', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'groupReserve']);
Route::post('/v2/volunteering/group-reservations/{id}/members', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'addGroupMember']);
Route::delete('/v2/volunteering/group-reservations/{id}/members/{userId}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'removeGroupMember']);
Route::delete('/v2/volunteering/group-reservations/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'cancelGroupReservation']);
Route::get('/v2/volunteering/shifts/{id}/checkin', [\App\Http\Controllers\Api\VolunteerCheckInController::class, 'getCheckIn']);
Route::post('/v2/volunteering/checkin/verify/{token}', [\App\Http\Controllers\Api\VolunteerCheckInController::class, 'verifyCheckIn']);
Route::post('/v2/volunteering/checkin/checkout/{token}', [\App\Http\Controllers\Api\VolunteerCheckInController::class, 'checkOut']);
Route::get('/v2/volunteering/shifts/{id}/checkins', [\App\Http\Controllers\Api\VolunteerCheckInController::class, 'shiftCheckIns']);

// Event attendance rewards — a tenant-admin funding decision, not an organiser
// field: the credits are minted against the community.
Route::middleware(['feature:events', 'feature:event_attendance_credits'])->group(function (): void {
    Route::get('/v2/admin/events/{id}/attendance-reward', [\App\Http\Controllers\Api\AdminEventAttendanceRewardController::class, 'show'])->whereNumber('id');
    Route::put('/v2/admin/events/{id}/attendance-reward', [\App\Http\Controllers\Api\AdminEventAttendanceRewardController::class, 'update'])->whereNumber('id');
    // Retry MINTS, so it stays behind the tenant flag (the service adds the
    // platform-mode check on top).
    Route::post('/v2/admin/events/attendance-claims/{claimId}/retry', [\App\Http\Controllers\Api\AdminEventAttendanceRewardController::class, 'retry'])->whereNumber('claimId');
});

// The audit ledger and the CORRECTION path are deliberately outside the
// event_attendance_credits gate: disabling that flag is the incident response
// to a bad batch of rewards, and admins must still be able to inspect the
// ledger and reverse erroneous claims at exactly that moment. ('attendance-
// claims' is a literal segment, so it cannot collide with the numeric {id}
// reward routes above.)
Route::middleware('feature:events')->group(function (): void {
    Route::get('/v2/admin/events/attendance-claims', [\App\Http\Controllers\Api\AdminEventAttendanceRewardController::class, 'claims']);
    Route::post('/v2/admin/events/attendance-claims/{claimId}/reverse', [\App\Http\Controllers\Api\AdminEventAttendanceRewardController::class, 'reverse'])->whereNumber('claimId');
});

// Partner venues — member pass QR, staff-scanned engagement recording, and
// tenant-admin management. Engagement only: the platform issues no coupon and
// applies no discount here.
Route::middleware('feature:partner_venues')->group(function (): void {
    Route::get('/v2/partner-venues', [\App\Http\Controllers\Api\PartnerVenueController::class, 'index']);
    Route::get('/v2/partner-venues/pass', [\App\Http\Controllers\Api\PartnerVenueController::class, 'pass']);
    Route::post('/v2/partner-venues/pass/rotate', [\App\Http\Controllers\Api\PartnerVenueController::class, 'rotatePass']);
    Route::get('/v2/partner-venues/my-visits', [\App\Http\Controllers\Api\PartnerVenueController::class, 'myVisits']);
    // POST-only by design: member details are revealed only after an authorised
    // staff account confirms the scan, so a prefetch can never disclose them.
    Route::post('/v2/partner-venues/visits/verify/{token}', [\App\Http\Controllers\Api\PartnerVenueController::class, 'recordVisit']);

    Route::get('/v2/admin/partner-venues', [\App\Http\Controllers\Api\AdminPartnerVenueController::class, 'index']);
    Route::post('/v2/admin/partner-venues', [\App\Http\Controllers\Api\AdminPartnerVenueController::class, 'store']);
    Route::get('/v2/admin/partner-venues/reports/summary', [\App\Http\Controllers\Api\AdminPartnerVenueController::class, 'summary']);
    Route::get('/v2/admin/partner-venues/visits/export.csv', [\App\Http\Controllers\Api\AdminPartnerVenueController::class, 'exportCsv']);
    Route::put('/v2/admin/partner-venues/{id}', [\App\Http\Controllers\Api\AdminPartnerVenueController::class, 'update'])->whereNumber('id');
    Route::post('/v2/admin/partner-venues/{id}/archive', [\App\Http\Controllers\Api\AdminPartnerVenueController::class, 'archive'])->whereNumber('id');
    Route::get('/v2/admin/partner-venues/{id}/staff', [\App\Http\Controllers\Api\AdminPartnerVenueController::class, 'staff'])->whereNumber('id');
    Route::post('/v2/admin/partner-venues/{id}/staff', [\App\Http\Controllers\Api\AdminPartnerVenueController::class, 'addStaff'])->whereNumber('id');
    Route::delete('/v2/admin/partner-venues/{id}/staff/{userId}', [\App\Http\Controllers\Api\AdminPartnerVenueController::class, 'removeStaff'])->whereNumber('id')->whereNumber('userId');
});
Route::get('/v2/volunteering/opportunities/{id}/recurring-patterns', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'recurringPatterns']);
Route::post('/v2/volunteering/opportunities/{id}/recurring-patterns', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'createRecurringPattern']);
Route::put('/v2/volunteering/recurring-patterns/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'updateRecurringPattern']);
Route::delete('/v2/volunteering/recurring-patterns/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'deleteRecurringPattern']);
Route::get('/v2/volunteering/expenses', [\App\Http\Controllers\Api\VolunteerExpenseController::class, 'myExpenses']);
Route::post('/v2/volunteering/expenses', [\App\Http\Controllers\Api\VolunteerExpenseController::class, 'submitExpense']);
Route::get('/v2/volunteering/expenses/{id}', [\App\Http\Controllers\Api\VolunteerExpenseController::class, 'getExpense']);
Route::get('/v2/volunteering/guardian-consents', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'myGuardianConsents']);
Route::post('/v2/volunteering/guardian-consents', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'requestGuardianConsent']);
// Guardian-consent verify: GET is a read-only token lookup; the actual grant is
// POST-only so unauthenticated prefetches (mail scanners) can never flip state.
Route::get('/v2/volunteering/guardian-consents/verify/{token}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'showGuardianConsentVerification'])->withoutMiddleware('auth:sanctum');
Route::post('/v2/volunteering/guardian-consents/verify/{token}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'verifyGuardianConsent'])->withoutMiddleware('auth:sanctum');
Route::delete('/v2/volunteering/guardian-consents/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'withdrawGuardianConsent']);
Route::get('/v2/volunteering/training', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'myTraining']);
Route::post('/v2/volunteering/training', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'recordTraining']);
Route::post('/v2/volunteering/incidents', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'reportIncident']);
Route::get('/v2/volunteering/incidents', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'getIncidents']);
Route::get('/v2/volunteering/incidents/{id}', [\App\Http\Controllers\Api\VolunteerWellbeingController::class, 'getIncident']);
Route::get('/v2/volunteering/custom-fields', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'getCustomFields']);
Route::get('/v2/volunteering/accessibility-needs', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'myAccessibilityNeeds']);
Route::put('/v2/volunteering/accessibility-needs', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'updateAccessibilityNeeds']);
Route::get('/v2/volunteering/community-projects', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'getCommunityProjects']);
Route::post('/v2/volunteering/community-projects', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'proposeCommunityProject']);
Route::get('/v2/volunteering/community-projects/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'getCommunityProject']);
Route::put('/v2/volunteering/community-projects/{id}', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'updateCommunityProject']);
Route::post('/v2/volunteering/community-projects/{id}/support', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'supportCommunityProject']);
Route::delete('/v2/volunteering/community-projects/{id}/support', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'unsupportCommunityProject']);
Route::get('/v2/volunteering/donations', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'getDonations']);
Route::post('/v2/volunteering/donations', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'createDonation']);
Route::get('/v2/volunteering/giving-days', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'getGivingDays']);
Route::get('/v2/volunteering/giving-days/{id}/stats', [\App\Http\Controllers\Api\VolunteerCommunityController::class, 'getGivingDayStats']);
Route::get('/v2/ideation-categories', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'listCategories']);
Route::post('/v2/ideation-categories', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'createCategory'])->middleware('admin');
Route::put('/v2/ideation-categories/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'updateCategory'])->middleware('admin');
Route::delete('/v2/ideation-categories/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'deleteCategory'])->middleware('admin');
Route::get('/v2/ideation-tags/popular', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'popularTags']);
Route::get('/v2/ideation-tags', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'listTags']);
Route::post('/v2/ideation-tags', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'createTag']);
Route::delete('/v2/ideation-tags/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'deleteTag']);
Route::get('/v2/ideation-ideas/{id}/media', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'listIdeaMedia']);
Route::post('/v2/ideation-ideas/{id}/media', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'addIdeaMedia']);
Route::delete('/v2/ideation-media/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'deleteIdeaMedia']);
Route::get('/v2/ideation-campaigns', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'listCampaigns']);
Route::get('/v2/ideation-campaigns/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'showCampaign']);
Route::post('/v2/ideation-campaigns', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'createCampaign']);
Route::put('/v2/ideation-campaigns/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'updateCampaign']);
Route::delete('/v2/ideation-campaigns/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'deleteCampaign']);
Route::post('/v2/ideation-campaigns/{id}/challenges', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'linkChallengeToCampaign']);
Route::delete('/v2/ideation-campaigns/{id}/challenges/{challengeId}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'unlinkChallengeFromCampaign']);
Route::get('/v2/ideation-templates', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'listTemplates']);
Route::get('/v2/ideation-templates/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'showTemplate']);
Route::post('/v2/ideation-templates', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'createTemplate']);
Route::put('/v2/ideation-templates/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'updateTemplate']);
Route::delete('/v2/ideation-templates/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'deleteTemplate']);
Route::get('/v2/ideation-templates/{id}/data', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'getTemplateData']);
Route::get('/v2/ideation-challenges/{id}/outcome', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'getOutcome']);
Route::put('/v2/ideation-challenges/{id}/outcome', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'upsertOutcome']);
Route::get('/v2/ideation-outcomes/dashboard', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'outcomesDashboard']);
Route::get('/v2/ideation-challenges/{id}/team-links', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'getTeamLinks']);
Route::middleware('feature:groups')
    ->where([
        'id' => '[0-9]+',
        'groupId' => '[0-9]+',
        'chatroomId' => '[0-9]+',
        'messageId' => '[0-9]+',
    ])
    ->group(function () {
Route::get('/v2/groups/{id}/chatrooms', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'listChatrooms'])->middleware('group.tab:chatrooms');
Route::post('/v2/groups/{id}/chatrooms', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'createChatroom'])->middleware('group.tab:chatrooms');
Route::delete('/v2/group-chatrooms/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'deleteChatroom'])->middleware('group.tab:chatrooms');
Route::get('/v2/group-chatrooms/{id}/messages', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'chatroomMessages'])->middleware('group.tab:chatrooms');
Route::post('/v2/group-chatrooms/{id}/messages', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'postChatroomMessage'])->middleware(['throttle:groups-chat-write', 'group.tab:chatrooms']);
Route::delete('/v2/group-chatroom-messages/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'deleteChatroomMessage'])->middleware('group.tab:chatrooms');
Route::post('/v2/groups/{groupId}/chatrooms/{chatroomId}/pin/{messageId}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'pinChatroomMessage'])->middleware('group.tab:chatrooms');
Route::delete('/v2/groups/{groupId}/chatrooms/{chatroomId}/pin/{messageId}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'unpinChatroomMessage'])->middleware('group.tab:chatrooms');
Route::get('/v2/groups/{groupId}/chatrooms/{chatroomId}/pinned', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'pinnedChatroomMessages'])->middleware('group.tab:chatrooms');
Route::get('/v2/groups/{id}/tasks', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'listTasks'])->middleware('group.tab:tasks');
Route::post('/v2/groups/{id}/tasks', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'createTask'])->middleware('group.tab:tasks');
Route::get('/v2/team-tasks/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'showTask'])->middleware('group.tab:tasks');
Route::put('/v2/team-tasks/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'updateTask'])->middleware('group.tab:tasks');
Route::delete('/v2/team-tasks/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'deleteTask'])->middleware('group.tab:tasks');
Route::get('/v2/groups/{id}/task-stats', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'taskStats'])->middleware('group.tab:tasks');
Route::get('/v2/groups/{id}/documents', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'listDocuments'])->middleware('group.tab:files');
Route::post('/v2/groups/{id}/documents', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'uploadDocument'])->middleware(['throttle:groups-upload', 'group.tab:files']);
Route::delete('/v2/team-documents/{id}', [\App\Http\Controllers\Api\IdeationChallengesController::class, 'deleteDocument'])->middleware('group.tab:files');
});
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::get('/v2/admin/members/inactive', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'inactiveMembers']);
    Route::post('/v2/admin/members/inactive/detect', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'detectInactive']);
    Route::post('/v2/admin/members/inactive/notify', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'markInactiveNotified']);
    // Moderation SETTINGS stay admin-only — tenant moderation policy, same
    // precedent as matching configuration.
    Route::get('/v2/admin/moderation/settings', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'moderationSettings']);
    Route::put('/v2/admin/moderation/settings', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'updateModerationSettings']);
});
// Broker-or-admin: the content moderation queue lives in the broker panel
// (/broker/moderation/queue) since 2026-07-02. The controller adds a
// self-dealing guard (a broker cannot review their own queued content).
// See BrokerModerationAuthorizationTest.
Route::middleware(['auth:sanctum', 'broker-or-admin'])->group(function () {
    Route::get('/v2/admin/moderation/queue', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'moderationQueue']);
    Route::post('/v2/admin/moderation/{id}/review', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'moderationReview'])->middleware('throttle:nexus-route-60-per-1m');
    Route::get('/v2/admin/moderation/stats', [\App\Http\Controllers\Api\AdminAnalyticsReportsController::class, 'moderationStats']);
});
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::post('/v2/admin/listings/{id}/feature', [\App\Http\Controllers\Api\AdminListingsController::class, 'feature']);
    Route::delete('/v2/admin/listings/{id}/feature', [\App\Http\Controllers\Api\AdminListingsController::class, 'unfeature']);
    Route::post('/v2/admin/listings/{id}/reject', [\App\Http\Controllers\Api\AdminListingsController::class, 'reject']);
});
// search saved/trending duplicates removed — registered at lines 345-349
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::get('/v2/admin/search/analytics', [\App\Http\Controllers\Api\AdminListingsController::class, 'searchAnalytics']);
    Route::get('/v2/admin/search/trending', [\App\Http\Controllers\Api\AdminListingsController::class, 'searchTrending']);
    Route::get('/v2/admin/search/zero-results', [\App\Http\Controllers\Api\AdminListingsController::class, 'searchZeroResults']);
});
// Matching routes — auth:sanctum required (controller uses $this->requireAuth())
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/v2/matches/all', [\App\Http\Controllers\Api\MatchingController::class, 'allMatches']);
    Route::post('/v2/matches/{id}/dismiss', [\App\Http\Controllers\Api\MatchingController::class, 'dismiss'])->whereNumber('id');
    // Typed variant — supports non-listing sources (groups etc.)
    Route::post('/v2/matches/{sourceType}/{sourceId}/dismiss', [\App\Http\Controllers\Api\MatchingController::class, 'dismissTyped'])
        ->whereAlpha('sourceType')->whereNumber('sourceId');
});

// ============================================
// MIGRATED ROUTES — Legacy API (Polls, Goals, Events, Wallet, Cookie Consent, Legal, Nexus Score, Notifications, Listings)
// Source: httpdocs/routes/legacy-api.php
// ============================================
Route::get('/polls', [\App\Http\Controllers\Api\PollsController::class, 'index']);
Route::post('/polls/vote', [\App\Http\Controllers\Api\PollsController::class, 'vote']);
Route::get('/goals', [\App\Http\Controllers\Api\GoalsController::class, 'index']);
// Legacy routes removed: /goals/update and /goals/offer-buddy — use V2 endpoints instead
Route::get('/vol_opportunities', [\App\Http\Controllers\Api\VolunteerController::class, 'index']);
Route::get('/events', [\App\Http\Controllers\Api\EventsController::class, 'index'])->middleware('feature:events');
// Legacy POST /events/rsvp removed: it had no {id} route parameter and no callers.
Route::get('/wallet/balance', [\App\Http\Controllers\Api\WalletController::class, 'balance']);
Route::get('/cookie-consent', [\App\Http\Controllers\Api\CookieConsentController::class, 'show']);
Route::post('/cookie-consent', [\App\Http\Controllers\Api\CookieConsentController::class, 'store']);
Route::get('/cookie-consent/inventory', [\App\Http\Controllers\Api\CookieConsentController::class, 'inventory']);
Route::get('/cookie-consent/check/{category}', [\App\Http\Controllers\Api\CookieConsentController::class, 'check']);
Route::put('/cookie-consent/{id}', [\App\Http\Controllers\Api\CookieConsentController::class, 'update']);
Route::delete('/cookie-consent/{id}', [\App\Http\Controllers\Api\CookieConsentController::class, 'withdraw']);
// Legal document routes are registered OUTSIDE this auth group (see below)
// because GET /v2/legal/{type} must be public — the React useLegalDocument
// hook fetches custom legal docs without authentication (skipAuth: true).
// Keeping them here caused a recurring regression: the API returned 401,
// the hook silently fell back, and tenants lost their custom policies.
Route::get('/nexus-score', [\App\Http\Controllers\Api\GamificationController::class, 'apiGetScore']);
Route::post('/nexus-score/recalculate', [\App\Http\Controllers\Api\GamificationController::class, 'apiRecalculateScores']);
Route::get('/wallet/transactions', [\App\Http\Controllers\Api\WalletController::class, 'transactions']);
Route::get('/wallet/pending-count', [\App\Http\Controllers\Api\WalletController::class, 'pendingCount']);
Route::post('/wallet/transfer', [\App\Http\Controllers\Api\WalletController::class, 'transfer']);
// Legacy route removed: /wallet/delete — use V2 DELETE /v2/wallet/transactions/{id} instead
Route::post('/wallet/user-search', [\App\Http\Controllers\Api\WalletController::class, 'userSearch']);
Route::get('/members', [\App\Http\Controllers\Api\CoreController::class, 'members']);
Route::get('/listings', [\App\Http\Controllers\Api\CoreController::class, 'listings']);
Route::get('/groups', [\App\Http\Controllers\Api\CoreController::class, 'groups'])->middleware('feature:groups');
// Legacy GET /messages removed — all clients use /v2/messages (MessagesController)
Route::get('/notifications', [\App\Http\Controllers\Api\CoreController::class, 'notifications']);
Route::get('/notifications/check', [\App\Http\Controllers\Api\CoreController::class, 'checkNotifications']);
Route::get('/notifications/unread-count', [\App\Http\Controllers\Api\CoreController::class, 'unreadCount']);
Route::get('/notifications/poll', [\App\Http\Controllers\Api\NotificationsController::class, 'poll']);
Route::post('/notifications/read', [\App\Http\Controllers\Api\NotificationsController::class, 'markRead']);
Route::post('/notifications/delete', [\App\Http\Controllers\Api\NotificationsController::class, 'delete']);
Route::post('/listings/delete', [\App\Http\Controllers\Api\ListingsController::class, 'delete']);

}); // End Route::middleware('auth:sanctum') — Misc/legacy routes

// ============================================
// MIGRATED ROUTES — Federation API V1  (partner READS, current, not retired)
//
// 🔴 The "V1" is an audience, not a version to be upgraded away from. Nothing
// replaced this: it is the ONLY surface where an external partner reads our
// members, listings, messages, reviews and transaction status in NEXUS's own
// format. /v2/federation/ingest/* is inbound push, Komunitin and Credit Commons
// speak other platforms' formats, and /v2/federation/* (bare) is our own
// members. Do not delete this on the assumption v2 supersedes it.
//
// Source: httpdocs/routes/federation-api-v1.php
// These routes use their own fedAuth() method (FederationApiMiddleware)
// for authentication — they must NOT be inside auth:sanctum.
//
// The whole block is wrapped in 'federation.external:legacy_v1' because
// index/health/oauthToken/testWebhook never call fedAuth() at all — a gate
// placed only inside the authenticator would leave the OAuth token mint open.
// ============================================
Route::middleware('federation.external:legacy_v1')->group(function () {
    Route::get('/v1/federation', [\App\Http\Controllers\Api\FederationController::class, 'index']);
    Route::get('/v1/federation/health', [\App\Http\Controllers\Api\FederationController::class, 'health']);
    Route::get('/v1/federation/timebanks', [\App\Http\Controllers\Api\FederationController::class, 'timebanks']);
    Route::get('/v1/federation/members', [\App\Http\Controllers\Api\FederationController::class, 'members']);
    Route::get('/v1/federation/members/{id}', [\App\Http\Controllers\Api\FederationController::class, 'member']);
    Route::get('/v1/federation/listings', [\App\Http\Controllers\Api\FederationController::class, 'listings']);
    Route::get('/v1/federation/listings/{id}', [\App\Http\Controllers\Api\FederationController::class, 'listing']);
    Route::get('/v1/federation/messages', [\App\Http\Controllers\Api\FederationController::class, 'getMessages']);
    Route::get('/v1/federation/reviews', [\App\Http\Controllers\Api\FederationController::class, 'getReviews']);
    Route::get('/v1/federation/transactions/{id}', [\App\Http\Controllers\Api\FederationController::class, 'getTransaction']);
    // Write operations rate-limited to prevent abuse (20 req/min per IP)
    Route::middleware('throttle:nexus-route-20-per-1m')->group(function () {
        Route::post('/v1/federation/messages', [\App\Http\Controllers\Api\FederationController::class, 'sendMessage']);
        Route::post('/v1/federation/transactions', [\App\Http\Controllers\Api\FederationController::class, 'createTransaction']);
        Route::post('/v1/federation/reviews', [\App\Http\Controllers\Api\FederationController::class, 'createReview']);
    });
    Route::post('/v1/federation/oauth/token', [\App\Http\Controllers\Api\FederationController::class, 'oauthToken'])->middleware('throttle:nexus-route-10-per-1m');
    Route::post('/v1/federation/webhooks/test', [\App\Http\Controllers\Api\FederationController::class, 'testWebhook']);
});

// External federation partner webhook receiver — HMAC-authenticated, no Sanctum.
// TimeOverflow and other external partners POST events here.
Route::post('/v2/federation/external/webhooks/receive', [\App\Http\Controllers\Api\FederationExternalWebhookController::class, 'receive'])->middleware(['throttle:nexus-route-200-per-1m', 'federation.external:webhooks']);

// ============================================
// FEDERATION PROTOCOL ENDPOINTS — Komunitin (JSON:API) & Credit Commons
// Authenticated via FederationApiMiddleware (API key, HMAC, JWT, or OAuth2).
// These endpoints serve NEXUS data in protocol-native formats so that
// external platforms can query us as a compatible federation partner.
// ============================================
Route::middleware(['federation.api', 'throttle:nexus-route-200-per-1m'])->group(function () {
    // Each protocol family carries its own external kill switch so protocols
    // can be re-enabled one at a time as their security audit passes. Nested
    // inside federation.api so the outer middleware order stays untouched; in
    // practice the equivalent backstop inside FederationApiMiddleware
    // ::authenticate() blocks these first, before any partner key lookup.
    Route::middleware('federation.external:komunitin')->group(function () {
    // --- Komunitin (JSON:API accounting protocol) ---
    // Full spec: https://github.com/community-exchange-network/komunitin
    Route::get('/v2/federation/komunitin/currencies', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'currencies']);
    Route::post('/v2/federation/komunitin/currencies', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'createCurrency']);
    Route::get('/v2/federation/komunitin/{code}/currency', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'currency']);
    Route::patch('/v2/federation/komunitin/{code}/currency', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'updateCurrency']);
    Route::get('/v2/federation/komunitin/{code}/currency/settings', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'currencySettings']);
    Route::patch('/v2/federation/komunitin/{code}/currency/settings', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'updateCurrencySettings']);
    Route::get('/v2/federation/komunitin/{code}/accounts', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'accounts']);
    Route::post('/v2/federation/komunitin/{code}/accounts', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'createAccount']);
    Route::get('/v2/federation/komunitin/{code}/accounts/{id}', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'account']);
    Route::patch('/v2/federation/komunitin/{code}/accounts/{id}', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'updateAccount']);
    Route::delete('/v2/federation/komunitin/{code}/accounts/{id}', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'deleteAccount']);
    Route::delete('/v2/federation/komunitin/{code}/currency', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'deleteCurrency']);
    Route::get('/v2/federation/komunitin/{code}/transfers', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'transfers']);
    Route::get('/v2/federation/komunitin/{code}/transfers/{id}', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'transfer']);
    Route::post('/v2/federation/komunitin/{code}/transfers', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'createTransfer']);
    Route::patch('/v2/federation/komunitin/{code}/transfers/{id}', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'updateTransfer']);
    Route::delete('/v2/federation/komunitin/{code}/transfers/{id}', [\App\Http\Controllers\Api\FederationKomunitinController::class, 'deleteTransfer']);
    });

    Route::middleware('federation.external:credit_commons')->group(function () {
    // --- Credit Commons protocol ---
    Route::get('/v2/federation/cc/about', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'about']);
    Route::get('/v2/federation/cc/accounts', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'accounts']);
    Route::get('/v2/federation/cc/account', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'accountStats']);
    Route::get('/v2/federation/cc/account/history', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'accountHistory']);
    Route::get('/v2/federation/cc/account/history/{acc_id}', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'accountHistory']);
    Route::get('/v2/federation/cc/account/{acc_id}', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'accountStats']);
    Route::post('/v2/federation/cc/transaction', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'createTransaction']);
    Route::get('/v2/federation/cc/transactions', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'transactions']);
    Route::get('/v2/federation/cc/transaction/{uuid}', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'transaction']);
    Route::patch('/v2/federation/cc/transaction/{uuid}/{state}', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'transitionTransaction']);
    Route::post('/v2/federation/cc/transaction/relay', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'relayTransaction']);
    Route::get('/v2/federation/cc/entries', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'entries']);
    Route::get('/v2/federation/cc/entries/{uuid}', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'transactionEntries']);
    Route::get('/v2/federation/cc/forms', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'forms']);

    // --- Credit Commons three-phase proposal (external-node inbound) ---
    Route::post('/v2/federation/cc/transactions/propose', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'proposeTransaction']);
    Route::post('/v2/federation/cc/transactions/{uuid}/validate', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'validateTransaction']);
    Route::post('/v2/federation/cc/transactions/{uuid}/commit', [\App\Http\Controllers\Api\FederationCreditCommonsController::class, 'commitTransaction']);
    });

    Route::middleware('federation.external:nexus')->group(function () {
    // --- Nexus Native V2 inbound entity push (REST) ---
    // 🔴 "Nexus native" means traffic with ANOTHER Project NEXUS installation.
    // It is not internal, despite carrying the product's own name — that name is
    // the single biggest source of confusion in this file. Inbound ONLY: a
    // partner PUSHES entities to us here and can read nothing. Partner READS
    // live on the v1 partner API (/v1/federation/*), which is a different
    // audience, not an older version of this.
    //
    // Partners using the Nexus protocol POST entities here. Event facts use a
    // strict versioned projection with signature, replay, stale, and conflict handling.
    // Namespaced under /ingest/ to avoid colliding with user-facing FederationV2Controller routes
    Route::post('/v2/federation/ingest/reviews', [\App\Http\Controllers\Api\FederationNativeIngestController::class, 'reviews']);
    Route::post('/v2/federation/ingest/listings', [\App\Http\Controllers\Api\FederationNativeIngestController::class, 'listings']);
    Route::post('/v2/federation/ingest/events', [\App\Http\Controllers\Api\EventFederationInboundController::class, 'apply']);
    Route::post('/v2/federation/ingest/groups', [\App\Http\Controllers\Api\FederationNativeIngestController::class, 'groups']);
    Route::post('/v2/federation/ingest/connections', [\App\Http\Controllers\Api\FederationNativeIngestController::class, 'connections']);
    Route::post('/v2/federation/ingest/volunteering', [\App\Http\Controllers\Api\FederationNativeIngestController::class, 'volunteering']);
    Route::post('/v2/federation/ingest/members/sync', [\App\Http\Controllers\Api\FederationNativeIngestController::class, 'membersSync']);
    });
});

// ============================================
// PUBLIC LEGAL DOCUMENT ROUTES — No auth required
// Custom tenant legal docs (Terms, Privacy, etc.) must be accessible
// without authentication — the React useLegalDocument hook fetches
// these with skipAuth:true for all visitors including non-logged-in users.
// ============================================
Route::get('/v2/legal/versions/compare', [\App\Http\Controllers\Api\LegalController::class, 'apiCompareVersions']);
Route::get('/v2/legal/version/{versionId}', [\App\Http\Controllers\Api\LegalController::class, 'apiGetVersion']);
Route::get('/v2/legal/{type}/versions', [\App\Http\Controllers\Api\LegalController::class, 'apiGetVersions']);
Route::get('/v2/legal/{type}', [\App\Http\Controllers\Api\LegalController::class, 'apiGetDocument']);

// Legal acceptance routes — require auth (user must be identified to record acceptance)
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/v2/legal/acceptance/status', [\App\Http\Controllers\Api\LegalAcceptanceController::class, 'getStatus']);
    Route::post('/v2/legal/acceptance/accept-all', [\App\Http\Controllers\Api\LegalAcceptanceController::class, 'acceptAll']);
    Route::post('/legal/accept', [\App\Http\Controllers\Api\LegalController::class, 'accept']);
    Route::post('/legal/accept-all', [\App\Http\Controllers\Api\LegalController::class, 'acceptAll']);
    Route::get('/legal/status', [\App\Http\Controllers\Api\LegalController::class, 'status']);
});

// ============================================
// PUBLIC WEBHOOK ROUTES — No auth required
// ============================================
// Postmark event webhook (Delivery/Bounce/SpamComplaint/Open/SubscriptionChange).
// Public — Postmark cannot present a Sanctum token; authenticated in the
// controller via HTTP Basic auth (or X-Postmark-Webhook-Secret) against
// POSTMARK_WEBHOOK_SECRET.
Route::post('/v2/webhooks/postmark', [\App\Http\Controllers\Api\PostmarkWebhookController::class, 'events'])->middleware('throttle:nexus-route-120-per-1m');

// Identity verification provider webhooks (e.g., Onfido, Jumio)
// Must be public — providers send callbacks without Sanctum tokens.
Route::post('/v2/webhooks/identity/{provider_slug}', [\App\Http\Controllers\Api\IdentityWebhookController::class, 'handleWebhook'])->middleware('throttle:nexus-route-60-per-1m');

// Stripe webhook (no auth, no CSRF — signature verified in controller)
Route::post('/v2/webhooks/stripe', [\App\Http\Controllers\Api\StripeWebhookController::class, 'handleWebhook'])->middleware('throttle:nexus-route-120-per-1m');

// Marketplace Stripe webhook (separate endpoint for Connect events with marketplace-specific secret)
Route::post('/v2/marketplace/webhooks/stripe', [\App\Http\Controllers\Api\StripeWebhookController::class, 'handleWebhook'])->middleware('throttle:nexus-route-120-per-1m');

// AG42 — Swiss FADP Compliance Pack
// Audit 2026-07-09 P2 #4: route-level auth added (controllers self-check too,
// but requireAuth/requireAdmin verify identity/role only — the middleware layer
// also enforces token↔tenant binding and account status).
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/v2/me/fadp/consent-history', [\App\Http\Controllers\Api\FadpComplianceController::class, 'myConsentHistory']);
    Route::post('/v2/me/fadp/consent', [\App\Http\Controllers\Api\FadpComplianceController::class, 'recordConsent']);
});
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::get('/v2/admin/fadp/retention-config', [\App\Http\Controllers\Api\FadpComplianceController::class, 'getRetentionConfig']);
    Route::put('/v2/admin/fadp/retention-config', [\App\Http\Controllers\Api\FadpComplianceController::class, 'updateRetentionConfig']);
    Route::get('/v2/admin/fadp/processing-activities', [\App\Http\Controllers\Api\FadpComplianceController::class, 'getProcessingActivities']);
    Route::post('/v2/admin/fadp/processing-activities', [\App\Http\Controllers\Api\FadpComplianceController::class, 'upsertProcessingActivity']);
    Route::delete('/v2/admin/fadp/processing-activities/{id}', [\App\Http\Controllers\Api\FadpComplianceController::class, 'deleteProcessingActivity']);
    Route::get('/v2/admin/fadp/consent-ledger', [\App\Http\Controllers\Api\FadpComplianceController::class, 'exportConsentLedger']);
    Route::get('/v2/admin/fadp/processing-register', [\App\Http\Controllers\Api\FadpComplianceController::class, 'processingRegister']);
    Route::get('/v2/admin/fadp/processing-register.csv', [\App\Http\Controllers\Api\FadpComplianceController::class, 'processingRegisterCsv']);
    Route::get('/v2/admin/fadp/disclosure-pack', [\App\Http\Controllers\Api\FadpComplianceController::class, 'disclosurePack']);
});

// AG43 — Citizen Residency Verification
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/v2/me/residency-verification', [\App\Http\Controllers\Api\ResidencyVerificationController::class, 'myStatus']);
    Route::post('/v2/me/residency-verification', [\App\Http\Controllers\Api\ResidencyVerificationController::class, 'submitDeclaration']);
});
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::get('/v2/admin/residency-verifications', [\App\Http\Controllers\Api\ResidencyVerificationController::class, 'adminList']);
    Route::post('/v2/admin/residency-verifications/{id}/attest', [\App\Http\Controllers\Api\ResidencyVerificationController::class, 'adminAttest']);
});

// AG56 — Local Advertising Platform
// Deliberately public: ad serving + impression/click beacons work for
// logged-out visitors (controller uses getOptionalUserId()). Do NOT wrap.
Route::get('/v2/ads/active', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'getActiveAds']);
Route::post('/v2/ads/impression', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'recordImpression']);
Route::post('/v2/ads/impression/{impressionId}/click', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'recordClick']);
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/v2/me/ad-campaigns', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'myAdCampaigns']);
    Route::post('/v2/me/ad-campaigns', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'createCampaign']);
    Route::get('/v2/me/ad-campaigns/{id}/stats', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'getMyCampaignStats']);
    Route::post('/v2/me/ad-campaigns/{campaignId}/creatives', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'addCreative']);
});
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::get('/v2/admin/ad-campaigns', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'adminListCampaigns']);
    Route::get('/v2/admin/ad-campaigns/stats', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'adminOverviewStats']);
    Route::get('/v2/admin/ad-campaigns/{id}', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'adminGetCampaign']);
    Route::post('/v2/admin/ad-campaigns/{id}/approve', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'adminApproveCampaign']);
    Route::post('/v2/admin/ad-campaigns/{id}/reject', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'adminRejectCampaign']);
    Route::post('/v2/admin/ad-campaigns/{id}/pause', [\App\Http\Controllers\Api\LocalAdvertisingController::class, 'adminPauseCampaign']);
});

// AG57 — Paid Push Campaign Management
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/v2/me/push-campaigns', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'myCampaigns']);
    Route::post('/v2/me/push-campaigns', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'createCampaign']);
    Route::post('/v2/me/push-campaigns/estimate-audience', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'estimateAudience']);
    Route::put('/v2/me/push-campaigns/{id}', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'updateCampaign']);
    Route::post('/v2/me/push-campaigns/{id}/submit', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'submitForReview']);
    Route::delete('/v2/me/push-campaigns/{id}', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'cancelCampaign']);
});
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::get('/v2/admin/push-campaigns', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'adminListCampaigns']);
    Route::get('/v2/admin/push-campaigns/stats', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'adminOverviewStats']);
    Route::get('/v2/admin/push-campaigns/{id}', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'adminGetCampaign']);
    Route::post('/v2/admin/push-campaigns/{id}/approve', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'adminApproveCampaign']);
    Route::post('/v2/admin/push-campaigns/{id}/reject', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'adminRejectCampaign']);
    Route::post('/v2/admin/push-campaigns/{id}/dispatch', [\App\Http\Controllers\Api\PaidPushCampaignController::class, 'adminDispatchCampaign']);
});

// AG62 — Municipality Survey & Feedback Tool
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/v2/caring-community/surveys', [\App\Http\Controllers\Api\MunicipalSurveyController::class, 'activeSurveys']);
    Route::get('/v2/caring-community/surveys/{id}', [\App\Http\Controllers\Api\MunicipalSurveyController::class, 'getSurvey']);
    Route::post('/v2/caring-community/surveys/{id}/respond', [\App\Http\Controllers\Api\MunicipalSurveyController::class, 'submitSurvey']);
});
// Deliberately auth-only (no `admin` middleware): these methods self-check via
// hasAnnouncerAccess(), which also grants the non-admin `municipality_announcer`
// role. Adding `admin` here would lock announcers out of survey management.
Route::middleware('auth:sanctum')
    ->withoutMiddleware(['admin', \App\Http\Middleware\EnsureIsAdmin::class])
    ->group(function () {
        Route::get('/v2/admin/caring-community/surveys', [\App\Http\Controllers\Api\MunicipalSurveyController::class, 'adminListSurveys']);
        Route::post('/v2/admin/caring-community/surveys', [\App\Http\Controllers\Api\MunicipalSurveyController::class, 'adminCreateSurvey']);
        Route::get('/v2/admin/caring-community/surveys/{id}', [\App\Http\Controllers\Api\MunicipalSurveyController::class, 'adminGetSurvey']);
        Route::put('/v2/admin/caring-community/surveys/{id}', [\App\Http\Controllers\Api\MunicipalSurveyController::class, 'adminUpdateSurvey']);
        Route::post('/v2/admin/caring-community/surveys/{id}/publish', [\App\Http\Controllers\Api\MunicipalSurveyController::class, 'adminPublishSurvey']);
        Route::post('/v2/admin/caring-community/surveys/{id}/close', [\App\Http\Controllers\Api\MunicipalSurveyController::class, 'adminCloseSurvey']);
        Route::get('/v2/admin/caring-community/surveys/{id}/export', [\App\Http\Controllers\Api\MunicipalSurveyController::class, 'adminExportCsv']);
    });

// ============================================
// AG61 — KI-Agenten Autonomous Agent Framework
// ============================================
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::get('/v2/admin/ki-agents/config', [\App\Http\Controllers\Api\KiAgentController::class, 'getConfig']);
    Route::put('/v2/admin/ki-agents/config', [\App\Http\Controllers\Api\KiAgentController::class, 'updateConfig']);
    Route::get('/v2/admin/ki-agents/runs', [\App\Http\Controllers\Api\KiAgentController::class, 'listRuns']);
    Route::get('/v2/admin/ki-agents/runs/{id}', [\App\Http\Controllers\Api\KiAgentController::class, 'getRun']);
    Route::post('/v2/admin/ki-agents/trigger', [\App\Http\Controllers\Api\KiAgentController::class, 'triggerRun']);
    Route::get('/v2/admin/ki-agents/proposals', [\App\Http\Controllers\Api\KiAgentController::class, 'listProposals']);
    Route::post('/v2/admin/ki-agents/proposals/{id}/approve', [\App\Http\Controllers\Api\KiAgentController::class, 'approveProposal']);
    Route::post('/v2/admin/ki-agents/proposals/{id}/reject', [\App\Http\Controllers\Api\KiAgentController::class, 'rejectProposal']);
    Route::post('/v2/admin/ki-agents/proposals/approve-eligible', [\App\Http\Controllers\Api\KiAgentController::class, 'approveAllEligible']);
    Route::get('/v2/admin/ki-agents/stats', [\App\Http\Controllers\Api\KiAgentController::class, 'getStats']);

    // AI Module Docs — per-tenant, admin-editable "how each module works" prompts
    Route::get('/v2/admin/ai-module-docs', [\App\Http\Controllers\Api\Admin\AiModuleDocsController::class, 'index']);
    Route::post('/v2/admin/ai-module-docs', [\App\Http\Controllers\Api\Admin\AiModuleDocsController::class, 'store']);
    Route::put('/v2/admin/ai-module-docs/{id}', [\App\Http\Controllers\Api\Admin\AiModuleDocsController::class, 'update']);
    Route::delete('/v2/admin/ai-module-docs/{id}', [\App\Http\Controllers\Api\Admin\AiModuleDocsController::class, 'destroy']);
    Route::post('/v2/admin/ai-module-docs/seed-defaults', [\App\Http\Controllers\Api\Admin\AiModuleDocsController::class, 'seedDefaults']);

    // AI chat trace metrics (cost, latency, tool usage, downvoted "unanswered" turns)
    Route::get('/v2/admin/ai-traces/metrics', [\App\Http\Controllers\Api\Admin\AiTraceMetricsController::class, 'metrics']);

    // AG59 — Regional Analytics Product
    Route::get('/v2/admin/regional-analytics/overview', [\App\Http\Controllers\Api\RegionalAnalyticsController::class, 'overview']);
    Route::get('/v2/admin/regional-analytics/heatmap', [\App\Http\Controllers\Api\RegionalAnalyticsController::class, 'heatmap']);
    Route::get('/v2/admin/regional-analytics/demand-supply', [\App\Http\Controllers\Api\RegionalAnalyticsController::class, 'demandSupply']);
    Route::get('/v2/admin/regional-analytics/demographics', [\App\Http\Controllers\Api\RegionalAnalyticsController::class, 'demographics']);
    Route::get('/v2/admin/regional-analytics/engagement-trends', [\App\Http\Controllers\Api\RegionalAnalyticsController::class, 'engagementTrends']);
    Route::get('/v2/admin/regional-analytics/volunteer-breakdown', [\App\Http\Controllers\Api\RegionalAnalyticsController::class, 'volunteerBreakdown']);
    Route::get('/v2/admin/regional-analytics/help-requests', [\App\Http\Controllers\Api\RegionalAnalyticsController::class, 'helpRequests']);
    Route::get('/v2/admin/regional-analytics/export', [\App\Http\Controllers\Api\RegionalAnalyticsController::class, 'exportReport']);
    Route::post('/v2/admin/regional-analytics/invalidate-cache', [\App\Http\Controllers\Api\RegionalAnalyticsController::class, 'invalidateCache']);
});

// AG71 — Pilot Region Inquiry & Qualification Funnel
// Deliberately public: logged-out lead-capture form (throttled). Do NOT wrap.
Route::post('/v2/pilot-inquiry', [\App\Http\Controllers\Api\PilotInquiryController::class, 'submitInquiry'])->middleware('throttle:nexus-route-5-per-1m');
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::get('/v2/admin/pilot-inquiries', [\App\Http\Controllers\Api\PilotInquiryController::class, 'adminList']);
    Route::get('/v2/admin/pilot-inquiries/stats', [\App\Http\Controllers\Api\PilotInquiryController::class, 'adminPipelineStats']);
    Route::get('/v2/admin/pilot-inquiries/export', [\App\Http\Controllers\Api\PilotInquiryController::class, 'adminExportCsv']);
    Route::get('/v2/admin/pilot-inquiries/{id}', [\App\Http\Controllers\Api\PilotInquiryController::class, 'adminGet']);
    Route::post('/v2/admin/pilot-inquiries/{id}/stage', [\App\Http\Controllers\Api\PilotInquiryController::class, 'adminUpdateStage']);
    Route::post('/v2/admin/pilot-inquiries/{id}/assign', [\App\Http\Controllers\Api\PilotInquiryController::class, 'adminAssign']);
    Route::post('/v2/admin/pilot-inquiries/{id}/notes', [\App\Http\Controllers\Api\PilotInquiryController::class, 'adminUpdateNotes']);
});

// Public billing — available plans (pricing page, no auth required)
Route::get('/v2/billing/plans', [\App\Http\Controllers\Api\AdminBillingController::class, 'getPlansPublic']);

// AG58 — Member Premium Tier paywall framework
// Public list of tiers (pricing page accessible to logged-out visitors)
Route::get('/v2/member-premium/tiers', [\App\Http\Controllers\Api\MemberPremiumController::class, 'listTiers'])->withoutMiddleware('auth:sanctum');

// Member-authenticated endpoints
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/v2/member-premium/me', [\App\Http\Controllers\Api\MemberPremiumController::class, 'me']);
    Route::post('/v2/member-premium/checkout', [\App\Http\Controllers\Api\MemberPremiumController::class, 'checkout']);
    Route::post('/v2/member-premium/cancel', [\App\Http\Controllers\Api\MemberPremiumController::class, 'cancel']);
    Route::post('/v2/member-premium/billing-portal', [\App\Http\Controllers\Api\MemberPremiumController::class, 'billingPortal']);

    // Admin: tier CRUD + subscriber view
    Route::get('/v2/admin/member-premium/tiers', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'listTiers']);
    Route::post('/v2/admin/member-premium/tiers', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'createTier']);
    Route::get('/v2/admin/member-premium/settings', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'settings']);
    Route::put('/v2/admin/member-premium/settings', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'updateSettings']);
    Route::post('/v2/admin/member-premium/connect/onboarding', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'createConnectOnboarding']);
    Route::get('/v2/admin/member-premium/finance/overview', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'financeOverview']);
    Route::get('/v2/admin/member-premium/finance/disputes', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'financeDisputes']);
    Route::get('/v2/admin/member-premium/finance/gift-aid-export', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'giftAidExport']);
    Route::get('/v2/admin/member-premium/finance/annual-receipts', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'annualReceiptsExport']);
    Route::get('/v2/admin/member-premium/tiers/{id}', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'showTier'])->whereNumber('id');
    Route::put('/v2/admin/member-premium/tiers/{id}', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'updateTier'])->whereNumber('id');
    Route::delete('/v2/admin/member-premium/tiers/{id}', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'deleteTier'])->whereNumber('id');
    Route::post('/v2/admin/member-premium/tiers/{id}/sync-stripe', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'syncStripe'])->whereNumber('id');
    Route::get('/v2/admin/member-premium/subscribers', [\App\Http\Controllers\Api\Admin\MemberPremiumAdminController::class, 'listSubscribers']);
});

// AG60 — Partner API (banking / payment / admin integrations)
//
// The whole block — including the OAuth endpoints below, which deliberately run
// without partner.api — sits behind the Partner API kill switch. This is a
// SEPARATE switch from external partner federation: different system, different
// credentials, so each label stays honest. Gating only the scoped routes would
// leave the token mint open.
Route::middleware('partner.api.enabled')->group(function () {

// OAuth2 client_credentials grant — public; no auth middleware.
Route::post('/partner/v1/oauth/token', [\App\Http\Controllers\Api\PartnerApi\PartnerOAuthController::class, 'token'])
    ->withoutMiddleware('auth:sanctum');
Route::post('/partner/v1/oauth/revoke', [\App\Http\Controllers\Api\PartnerApi\PartnerOAuthController::class, 'revoke'])
    ->withoutMiddleware('auth:sanctum');

// Partner API endpoints — guarded by partner.api:<scope> middleware.
Route::middleware('partner.api:users.read')->group(function () {
    Route::get('/partner/v1/users', [\App\Http\Controllers\Api\PartnerApi\PartnerV1Controller::class, 'listUsers'])
        ->withoutMiddleware('auth:sanctum');
    Route::get('/partner/v1/users/{id}', [\App\Http\Controllers\Api\PartnerApi\PartnerV1Controller::class, 'showUser'])
        ->whereNumber('id')->withoutMiddleware('auth:sanctum');
});
Route::middleware('partner.api:listings.read')->group(function () {
    Route::get('/partner/v1/listings', [\App\Http\Controllers\Api\PartnerApi\PartnerV1Controller::class, 'listListings'])
        ->withoutMiddleware('auth:sanctum');
});
Route::middleware('partner.api:wallet.read')->group(function () {
    Route::get('/partner/v1/wallet/balance/{userId}', [\App\Http\Controllers\Api\PartnerApi\PartnerV1Controller::class, 'walletBalance'])
        ->whereNumber('userId')->withoutMiddleware('auth:sanctum');
});
Route::middleware('partner.api:wallet.write')->group(function () {
    Route::post('/partner/v1/wallet/credit', [\App\Http\Controllers\Api\PartnerApi\PartnerV1Controller::class, 'walletCredit'])
        ->withoutMiddleware('auth:sanctum');
});
Route::middleware('partner.api:aggregates.read')->group(function () {
    Route::get('/partner/v1/aggregates/community', [\App\Http\Controllers\Api\PartnerApi\PartnerV1Controller::class, 'communityAggregates'])
        ->withoutMiddleware('auth:sanctum');
});
Route::middleware('partner.api:webhooks.manage')->group(function () {
    Route::get('/partner/v1/webhooks/subscriptions', [\App\Http\Controllers\Api\PartnerApi\PartnerV1Controller::class, 'listWebhookSubscriptions'])
        ->withoutMiddleware('auth:sanctum');
    Route::post('/partner/v1/webhooks/subscriptions', [\App\Http\Controllers\Api\PartnerApi\PartnerV1Controller::class, 'createWebhookSubscription'])
        ->withoutMiddleware('auth:sanctum');
});

}); // End Route::middleware('partner.api.enabled') — AG60 Partner API

// ============================================
// AG59 — Paid Regional Analytics product
// ============================================
// Partner-facing endpoints: auth via subscription_token (Bearer header or ?token=)
// — controller resolves the token directly, so no Sanctum middleware here.
Route::prefix('partner-analytics')->group(function () {
    Route::get('/me/dashboard', [\App\Http\Controllers\Api\RegionalAnalyticsPartnerController::class, 'dashboard']);
    Route::get('/me/reports', [\App\Http\Controllers\Api\RegionalAnalyticsPartnerController::class, 'reports']);
    Route::get('/me/reports/{id}/download', [\App\Http\Controllers\Api\RegionalAnalyticsPartnerController::class, 'downloadReport'])
        ->whereNumber('id');
});

// Super-admin CRUD + report generation + access log
Route::middleware(['auth:sanctum', 'super-admin'])->prefix('super-admin/regional-analytics')->group(function () {
    Route::get('/subscriptions', [\App\Http\Controllers\Api\SuperAdmin\RegionalAnalyticsAdminController::class, 'index']);
    Route::post('/subscriptions', [\App\Http\Controllers\Api\SuperAdmin\RegionalAnalyticsAdminController::class, 'store']);
    Route::get('/subscriptions/{id}', [\App\Http\Controllers\Api\SuperAdmin\RegionalAnalyticsAdminController::class, 'show'])->whereNumber('id');
    Route::put('/subscriptions/{id}', [\App\Http\Controllers\Api\SuperAdmin\RegionalAnalyticsAdminController::class, 'update'])->whereNumber('id');
    Route::delete('/subscriptions/{id}', [\App\Http\Controllers\Api\SuperAdmin\RegionalAnalyticsAdminController::class, 'destroy'])->whereNumber('id');
    Route::post('/subscriptions/{id}/generate-report', [\App\Http\Controllers\Api\SuperAdmin\RegionalAnalyticsAdminController::class, 'generateReport'])->whereNumber('id');
    Route::get('/access-log', [\App\Http\Controllers\Api\SuperAdmin\RegionalAnalyticsAdminController::class, 'accessLog']);
});

// Admin: Partner CRUD + credential rotation + call log
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::get('/v2/admin/api-partners', [\App\Http\Controllers\Api\Admin\ApiPartnerAdminController::class, 'index']);
    Route::post('/v2/admin/api-partners', [\App\Http\Controllers\Api\Admin\ApiPartnerAdminController::class, 'store']);
    Route::get('/v2/admin/api-partners/{id}', [\App\Http\Controllers\Api\Admin\ApiPartnerAdminController::class, 'show'])->whereNumber('id');
    Route::put('/v2/admin/api-partners/{id}', [\App\Http\Controllers\Api\Admin\ApiPartnerAdminController::class, 'update'])->whereNumber('id');
    Route::post('/v2/admin/api-partners/{id}/activate', [\App\Http\Controllers\Api\Admin\ApiPartnerAdminController::class, 'activate'])->whereNumber('id');
    Route::post('/v2/admin/api-partners/{id}/suspend', [\App\Http\Controllers\Api\Admin\ApiPartnerAdminController::class, 'suspend'])->whereNumber('id');
    Route::post('/v2/admin/api-partners/{id}/regenerate-credentials', [\App\Http\Controllers\Api\Admin\ApiPartnerAdminController::class, 'regenerateCredentials'])->whereNumber('id');
    Route::get('/v2/admin/api-partners/{id}/call-log', [\App\Http\Controllers\Api\Admin\ApiPartnerAdminController::class, 'callLog'])->whereNumber('id');
});

// ============================================
// SOC10 — Bookmarks / Saved Collections
// SOC14 — Appreciations / Thank-you
// ============================================
Route::middleware('auth:sanctum')->group(function () {
    // SOC10 — collections
    Route::get('/v2/me/collections', [\App\Http\Controllers\Api\SavedCollectionsController::class, 'listCollections']);
    Route::post('/v2/me/collections', [\App\Http\Controllers\Api\SavedCollectionsController::class, 'createCollection']);
    Route::patch('/v2/me/collections/{id}', [\App\Http\Controllers\Api\SavedCollectionsController::class, 'updateCollection'])->whereNumber('id');
    Route::delete('/v2/me/collections/{id}', [\App\Http\Controllers\Api\SavedCollectionsController::class, 'deleteCollection'])->whereNumber('id');
    Route::get('/v2/me/collections/{id}/items', [\App\Http\Controllers\Api\SavedCollectionsController::class, 'listItems'])->whereNumber('id');

    // SOC10 — saved items
    Route::get('/v2/me/saved-items/check', [\App\Http\Controllers\Api\SavedCollectionsController::class, 'checkSingle']);
    Route::post('/v2/me/saved-items/check-bulk', [\App\Http\Controllers\Api\SavedCollectionsController::class, 'checkBulk']);
    Route::post('/v2/me/saved-items', [\App\Http\Controllers\Api\SavedCollectionsController::class, 'saveItem']);
    Route::delete('/v2/me/saved-items', [\App\Http\Controllers\Api\SavedCollectionsController::class, 'unsaveByPair']);
    Route::delete('/v2/me/saved-items/{id}', [\App\Http\Controllers\Api\SavedCollectionsController::class, 'unsaveItem'])->whereNumber('id');

    // SOC10 — view another user's public collections
    Route::get('/v2/users/{userId}/public-collections', [\App\Http\Controllers\Api\SavedCollectionsController::class, 'publicCollections'])->whereNumber('userId');

    // SOC14 — appreciations
    Route::post('/v2/appreciations', [\App\Http\Controllers\Api\AppreciationsController::class, 'send']);
    Route::get('/v2/appreciations/most-appreciated', [\App\Http\Controllers\Api\AppreciationsController::class, 'mostAppreciated']);
    Route::get('/v2/me/appreciations', [\App\Http\Controllers\Api\AppreciationsController::class, 'mine']);
    Route::get('/v2/users/{userId}/appreciations', [\App\Http\Controllers\Api\AppreciationsController::class, 'publicForUser'])->whereNumber('userId');
    Route::post('/v2/appreciations/{id}/react', [\App\Http\Controllers\Api\AppreciationsController::class, 'react'])->whereNumber('id');
    Route::delete('/v2/appreciations/{id}/react', [\App\Http\Controllers\Api\AppreciationsController::class, 'removeReaction'])->whereNumber('id');
});
Route::post('/csp-report', [\App\Http\Controllers\Api\SecurityReportController::class, 'csp']);
