<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\GovukAlpha\Concerns;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Members directory & profiles — accessible (GOV.UK) frontend parity methods.
 *
 * Composed into AlphaController. Trait methods may call the controller's
 * private helpers ($this->view, $this->currentUserId, $this->assertTenantSlug,
 * $this->allowed, self::asStr). New method names MUST be module-prefixed and
 * unique across AlphaController and every sibling trait. Resolve services via
 * app(SomeService::class) rather than the constructor.
 *
 * The core AlphaController already ships the member directory (members()),
 * the member profile page (memberProfile()), connection / endorse / block
 * actions, profile stats, reviews, availability, activity and earned-badge
 * display. Those are NOT rebuilt here.
 *
 * This trait delivers the React-parity reputation surface that the core
 * profile page does NOT yet render (and which lives in service payloads the
 * core profileStats() helper drops on the floor):
 *   - membersInsights: a "Reputation and recognition" page per member that
 *     surfaces the NEXUS score badge (total / tier / percentile), the full
 *     stats grid INCLUDING groups joined and events attended, the per-method
 *     verification badge row (email / phone / ID / address / admin / DBS /
 *     org-vouched / peer-endorsed), and the showcased earned badges grid.
 *     Parity with react-frontend/src/pages/profile/ProfilePage.tsx
 *     (NEXUS score 671-697, stat cards 854-883 incl. groups/events,
 *     VerificationBadgeSummary 1043-1048, showcased badges 758-766).
 *
 * Every backing call is the SAME tenant-scoped service the React API uses:
 *   - \App\Services\UserService::getPublicProfile() / getOwnProfile()
 *     (mirrors UsersController profile payload — includes stats, nexus_score,
 *     groups_count, events_attended, badges).
 *   - \App\Services\MemberVerificationBadgeService::getUserBadges()
 *     (mirrors the verification badge endpoint VerificationBadgeSummary reads).
 * No money/auth/notification logic is reimplemented; this is a read-only view.
 */
trait MembersParity
{
    /**
     * "Reputation and recognition" page for a member. Surfaces the NEXUS score,
     * the full activity stats grid (incl. groups joined + events attended), the
     * per-method verification badge row and the showcased earned badges — all of
     * which the React profile renders but the core accessible profile page does
     * not. Auth-gated and feature-gated identically to the core memberProfile()
     * page (connections feature), with the same cross-tenant 404 + block-aware
     * privacy semantics (delegated to UserService).
     */
    public function membersInsights(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(\App\Core\TenantContext::hasFeature('connections'), 403);

        $viewerId = $this->currentUserId();
        if ($viewerId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $isOwnProfile = $id === $viewerId;

        // getPublicProfile() applies block + privacy + onboarding-visibility gating
        // and returns null for a hidden / cross-tenant / unknown member (the same
        // null the core profile page 404s on). Calling it with viewerId === id for
        // the owner skips the privacy stripping and returns the full own payload.
        $profile = \App\Services\UserService::getPublicProfile($id, $viewerId);
        abort_if($profile === null, 404);

        $stats = is_array($profile['stats'] ?? null) ? $profile['stats'] : [];

        // Flattened-to-root fields (UserService::getPublicProfile flattens these)
        // with a stats[] fallback so own-profile (getMe) payloads still resolve.
        $insightsStats = [
            'hours_given'     => (float) ($profile['total_hours_given'] ?? $stats['total_hours_given'] ?? 0),
            'hours_received'  => (float) ($profile['total_hours_received'] ?? $stats['total_hours_received'] ?? 0),
            'listings_count'  => (int) ($stats['listings_count'] ?? 0),
            'connections_count' => (int) ($stats['connections_count'] ?? 0),
            'reviews_count'   => (int) ($stats['reviews_count'] ?? 0),
            'groups_count'    => (int) ($profile['groups_count'] ?? $stats['groups_count'] ?? 0),
            'events_attended' => (int) ($profile['events_attended'] ?? $stats['events_attended'] ?? 0),
            'rating'          => $profile['rating'] ?? $stats['average_rating'] ?? null,
            'level'           => (int) ($profile['level'] ?? 1),
            'xp'              => (int) ($profile['xp'] ?? 0),
        ];

        // NEXUS score summary: { total_score, tier, percentile } or null.
        $nexusScore = is_array($profile['nexus_score'] ?? null) ? $profile['nexus_score'] : null;

        // Per-method verification badges (email/phone/id/address/admin/dbs/org/peer).
        $verificationBadges = [];
        try {
            $verificationBadges = app(\App\Services\MemberVerificationBadgeService::class)->getUserBadges($id);
        } catch (\Throwable $e) {
            report($e);
        }

        // Earned / showcased badges — the gamification badges with name + icon.
        $earnedBadges = is_array($profile['badges'] ?? null) ? $profile['badges'] : [];

        $displayName = trim((string) ($profile['name'] ?? ''));
        if ($displayName === '') {
            $displayName = trim(((string) ($profile['first_name'] ?? '')) . ' ' . ((string) ($profile['last_name'] ?? '')));
        }
        if ($displayName === '') {
            $displayName = __('govuk_alpha_members.insights.unknown_member');
        }

        return $this->view('accessible-frontend::members-insights', [
            'title'              => __('govuk_alpha_members.insights.title', ['name' => $displayName]),
            'tenantSlug'         => $tenantSlug,
            'activeNav'          => $isOwnProfile ? 'profile' : 'members',
            'memberId'           => $id,
            'isOwnProfile'       => $isOwnProfile,
            'displayName'        => $displayName,
            'profile'            => $profile,
            'insightsStats'      => $insightsStats,
            'nexusScore'         => $nexusScore,
            'verificationBadges' => $verificationBadges,
            'earnedBadges'       => $earnedBadges,
        ]);
    }

    /**
     * "Recommended members" directory — the CommunityRank-sorted ordering the
     * React members page exposes via ?sort=communityrank (MembersPage.tsx 46,
     * 102-109, 424-426). The core accessible members.index whitelist only allows
     * name/joined/rating/hours_given, so this is the parity surface for the
     * algorithmic ranking. Backed by the SAME service the UsersController index
     * uses for communityrank — \App\Services\MemberRankingService::rankMembers()
     * — so the order, scores and tenant/privacy/visibility scoping are identical.
     *
     * Auth- + connections-feature-gated exactly like the core members directory.
     * When the algorithm is disabled for the tenant we degrade to the standard
     * directory (the ranking link is simply hidden in that case), so the page
     * never serves an empty or misleading "recommended" list.
     */
    public function membersDiscover(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(\App\Core\TenantContext::hasFeature('connections'), 403);

        $viewerId = $this->currentUserId();
        if ($viewerId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $ranking = app(\App\Services\MemberRankingService::class);
        $rankingEnabled = false;
        try {
            $rankingEnabled = $ranking->isEnabled();
        } catch (\Throwable $e) {
            report($e);
        }

        $search = trim(self::asStr($request->query('q')));
        $limit = $this->membersIntQuery($request, 'limit', 24, 1, 100);
        $offset = $this->membersIntQuery($request, 'offset', 0, 0, 100000);

        $items = [];
        $meta = ['total_items' => 0, 'offset' => $offset, 'per_page' => $limit, 'has_more' => false];
        $error = null;

        if ($rankingEnabled) {
            $tenantId = \App\Core\TenantContext::getId();
            $viewer = \App\Models\User::query()
                ->where('id', $viewerId)
                ->where('tenant_id', $tenantId)
                ->first(['latitude', 'longitude']);

            try {
                $ranked = $ranking->rankMembers(
                    $tenantId,
                    $limit,
                    $offset,
                    $search,
                    $viewerId,
                    $viewer && $viewer->latitude !== null ? (float) $viewer->latitude : null,
                    $viewer && $viewer->longitude !== null ? (float) $viewer->longitude : null
                );
                $items = $this->membersHydrateRanked(is_array($ranked['items'] ?? null) ? $ranked['items'] : [], $viewerId);
                $total = (int) ($ranked['total'] ?? count($items));
                $meta = [
                    'total_items' => $total,
                    'offset' => $offset,
                    'per_page' => $limit,
                    'has_more' => ($offset + $limit) < $total,
                ];
            } catch (\Throwable $e) {
                report($e);
                $error = __('govuk_alpha.states.error_title');
            }
        }

        return $this->view('accessible-frontend::members-discover', [
            'title' => __('govuk_alpha_members.discover.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'members',
            'items' => $items,
            'meta' => $meta,
            'search' => $search,
            'rankingEnabled' => $rankingEnabled,
            'error' => $error,
        ]);
    }

    /**
     * "Members near me" directory — the location/radius filter the React members
     * page exposes via the dedicated /v2/members/nearby endpoint (MembersPage.tsx
     * 214-220, 305-316). HTML-first, no-JS: a plain GET radius <select> drives the
     * Haversine lookup. Backed by the SAME service the UsersController nearby()
     * endpoint uses — \App\Services\UserService::getNearby() — so the distance
     * maths, tenant scoping and privacy/visibility gating are identical.
     *
     * Auth- + connections-feature-gated like the core directory. When the viewer
     * has no saved coordinates we render the directory with a hint pointing them
     * at their profile (mirroring the React near_me_no_location toast) rather than
     * silently returning nothing.
     */
    public function membersNearby(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(\App\Core\TenantContext::hasFeature('connections'), 403);

        $viewerId = $this->currentUserId();
        if ($viewerId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = \App\Core\TenantContext::getId();
        $search = trim(self::asStr($request->query('q')));
        // The saved match-preference radius seeds the default; an explicit
        // ?radius= always wins. savedNearDefault() returns 'any' when nothing
        // is stored, which this page (radius-mandatory) maps back to 25.
        $savedDefault = $this->savedNearDefault();
        $radius = $this->allowed(
            self::asStr($request->query('radius', $savedDefault === 'any' ? '25' : $savedDefault)),
            ['5', '10', '25', '50', '100'],
            '25',
        );
        $limit = $this->membersIntQuery($request, 'limit', 24, 1, 100);
        $offset = $this->membersIntQuery($request, 'offset', 0, 0, 100000);

        $items = [];
        $meta = ['offset' => $offset, 'per_page' => $limit, 'has_more' => false];
        $error = null;
        $hasLocation = false;

        $viewer = \App\Models\User::query()
            ->where('id', $viewerId)
            ->where('tenant_id', $tenantId)
            ->first(['latitude', 'longitude']);

        if ($viewer && $viewer->latitude !== null && $viewer->longitude !== null) {
            $hasLocation = true;
            try {
                $result = \App\Services\UserService::getNearby(
                    (float) $viewer->latitude,
                    (float) $viewer->longitude,
                    [
                        'radius_km' => (float) $radius,
                        'limit' => $limit,
                        'offset' => $offset,
                        'q' => $search,
                    ],
                    $viewerId
                );
                $rawItems = is_array($result['items'] ?? null) ? $result['items'] : [];
                $items = $this->membersHydrateNearby($rawItems, $viewerId);
                $meta = [
                    'offset' => $offset,
                    'per_page' => $limit,
                    'has_more' => (bool) ($result['has_more'] ?? false),
                ];
            } catch (\Throwable $e) {
                report($e);
                $error = __('govuk_alpha.states.error_title');
            }
        }

        return $this->view('accessible-frontend::members-nearby', [
            'title' => __('govuk_alpha_members.nearby.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'members',
            'items' => $items,
            'meta' => $meta,
            'search' => $search,
            'radius' => $radius,
            'hasLocation' => $hasLocation,
            'error' => $error,
        ]);
    }

    /**
     * Clamp a query int to a range. Local to this trait so it does not collide
     * with the controller's private intQuery() helper (same behaviour, prefixed).
     */
    private function membersIntQuery(Request $request, string $key, int $default, int $min, int $max): int
    {
        $value = $request->query($key, $default);
        return max($min, min($max, is_numeric($value) ? (int) $value : $default));
    }

    /**
     * Turn MemberRankingService::rankMembers() rows (user_id + score) into the
     * card shape the members views expect, fetching display fields with the same
     * tenant-scoped projection the core directory uses and attaching the viewer's
     * per-card connection state. Preserves the ranked order.
     *
     * @param  list<array<string, mixed>>  $rankedItems
     * @return list<array<string, mixed>>
     */
    private function membersHydrateRanked(array $rankedItems, int $viewerId): array
    {
        $orderedIds = [];
        $scoreByUserId = [];
        foreach ($rankedItems as $row) {
            $uid = (int) ($row['user_id'] ?? 0);
            if ($uid > 0) {
                $orderedIds[] = $uid;
                $scoreByUserId[$uid] = (float) ($row['score'] ?? 0.0);
            }
        }

        if ($orderedIds === []) {
            return [];
        }

        $tenantId = \App\Core\TenantContext::getId();
        $placeholders = implode(',', array_fill(0, count($orderedIds), '?'));
        $orderPlaceholders = implode(',', array_fill(0, count($orderedIds), '?'));

        $sql = "SELECT u.id,
                       CASE
                           WHEN u.profile_type = 'organisation' AND u.organization_name IS NOT NULL AND u.organization_name != '' THEN u.organization_name
                           ELSE CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))
                       END as name,
                       u.avatar_url as avatar,
                       COALESCE(u.tagline, LEFT(u.bio, 120)) as tagline,
                       u.location,
                       u.created_at,
                       u.is_verified,
                       COALESCE(u.level, 0) as level,
                       r.avg_rating as rating,
                       COALESCE(tg.total_given, 0) as total_hours_given,
                       COALESCE(tr.total_received, 0) as total_hours_received
                FROM users u
                LEFT JOIN (SELECT receiver_id, AVG(rating) as avg_rating FROM reviews WHERE tenant_id = ? GROUP BY receiver_id) r ON r.receiver_id = u.id
                LEFT JOIN (SELECT sender_id, COALESCE(SUM(amount), 0) as total_given FROM transactions WHERE status = 'completed' AND tenant_id = ? GROUP BY sender_id) tg ON tg.sender_id = u.id
                LEFT JOIN (SELECT receiver_id, COALESCE(SUM(amount), 0) as total_received FROM transactions WHERE status = 'completed' AND tenant_id = ? GROUP BY receiver_id) tr ON tr.receiver_id = u.id
                WHERE u.tenant_id = ? AND u.id IN ($placeholders)
                ORDER BY FIELD(u.id, $orderPlaceholders)";

        $params = array_merge([$tenantId, $tenantId, $tenantId, $tenantId], $orderedIds, $orderedIds);
        $rows = \Illuminate\Support\Facades\DB::select($sql, $params);

        return $this->alphaAttachIdentityVerified(array_map(function (object $row) use ($viewerId, $scoreByUserId): array {
            $member = (array) $row;
            $member['avatar'] = $this->resolveAsset(self::asStr($member['avatar'] ?? null) ?: null);
            $member['community_rank_score'] = $scoreByUserId[(int) $member['id']] ?? null;
            try {
                $member['connection_state'] = \App\Services\ConnectionService::getStatus($viewerId, (int) $member['id'])['status'] ?? 'none';
            } catch (\Throwable $e) {
                $member['connection_state'] = 'none';
            }

            return $member;
        }, $rows));
    }

    /**
     * Normalise UserService::getNearby() rows into the card shape the members
     * views expect (resolve avatar to a same-origin URL, attach the viewer's
     * connection state) while preserving the service's distance field.
     *
     * @param  list<array<string, mixed>>  $nearbyItems
     * @return list<array<string, mixed>>
     */
    private function membersHydrateNearby(array $nearbyItems, int $viewerId): array
    {
        $out = [];
        foreach ($nearbyItems as $row) {
            if (! is_array($row)) {
                continue;
            }
            $row['avatar'] = $this->resolveAsset(self::asStr($row['avatar'] ?? null) ?: null);
            try {
                $row['connection_state'] = \App\Services\ConnectionService::getStatus($viewerId, (int) ($row['id'] ?? 0))['status'] ?? 'none';
            } catch (\Throwable $e) {
                $row['connection_state'] = 'none';
            }
            $out[] = $row;
        }

        return $this->alphaAttachIdentityVerified($out);
    }
}
