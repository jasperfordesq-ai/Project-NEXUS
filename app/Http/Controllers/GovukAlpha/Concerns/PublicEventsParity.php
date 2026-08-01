<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\GovukAlpha\Concerns;

use App\Core\TenantContext;
use App\Services\EventService;
use App\Support\Events\PublicEventProjection;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * What's On — the accessible frontend's LOGGED-OUT event advertising pages.
 *
 * Composed into AlphaController; method names are module-prefixed (whatsOn*).
 * These are the only accessible-frontend event pages outside
 * RequireAccessibleAuthentication, mirroring the React /whats-on pages:
 * anonymous visitors browse published community events; registering still
 * requires an account.
 *
 * Everything shown comes through PublicEventProjection — the same allowlist
 * the /v2/public/events API serves — so this page cannot leak a field the API
 * would not. Gated 404 (not 403) when either feature is off: a public page
 * that admits it exists but is forbidden invites probing.
 */
trait PublicEventsParity
{
    public function whatsOnIndex(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(
            TenantContext::hasFeature('events') && TenantContext::hasFeature('public_events'),
            404,
        );

        $when = $this->allowed(self::asStr($request->query('when', 'upcoming')), ['upcoming', 'past', 'all'], 'upcoming');

        $filters = [
            'limit' => 20,
            'when' => $when,
            'viewer_id' => null,
            'public_only' => true,
        ];

        $search = trim(self::asStr($request->query('q', '')));
        if ($search !== '') {
            $filters['search'] = $search;
        }
        $cursor = self::asStr($request->query('cursor', ''));
        if ($cursor !== '') {
            $filters['cursor'] = $cursor;
        }

        try {
            $result = app(EventService::class)->getAll($filters);
        } catch (ValidationException) {
            // A garbled cursor is a fresh first page, not an error page.
            $result = app(EventService::class)->getAll(array_diff_key($filters, ['cursor' => true]));
        }

        return $this->view('accessible-frontend::whats-on', [
            'title' => __('govuk_alpha_whats_on.index.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'whats-on',
            'events' => array_map(
                static fn (array $event): array => PublicEventProjection::project($event),
                $result['items'],
            ),
            'when' => $when,
            'search' => $search,
            'nextCursor' => $result['has_more'] ? ($result['cursor'] ?? null) : null,
        ]);
    }

    public function whatsOnShow(Request $request, string $tenantSlug, int $id): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(
            TenantContext::hasFeature('events') && TenantContext::hasFeature('public_events'),
            404,
        );

        $event = EventService::getPublicById($id);

        // Same 404 for "does not exist" and "not publicly visible", so the
        // page cannot be used to probe for private or draft events.
        abort_if($event === null, 404);

        return $this->view('accessible-frontend::whats-on-detail', [
            'title' => __('govuk_alpha_whats_on.show.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'whats-on',
            'event' => PublicEventProjection::project($event, true),
        ]);
    }
}
