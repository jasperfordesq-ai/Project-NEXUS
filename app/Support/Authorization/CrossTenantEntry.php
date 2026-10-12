<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Authorization;

use Illuminate\Http\Request;
use Throwable;

/**
 * "May this signed-in account operate inside community T on THIS request?"
 *
 * Every request is resolved to one community, and every community-owned query
 * then runs against it. So the decision to let an account's request resolve to
 * a community other than the account's own is the outermost tenant-isolation
 * gate in the platform. It is taken in two places, which must agree, and both
 * ask this class: App\Core\TenantContext::resolve() (a bearer token naming one
 * community while the X-Tenant-ID / X-Tenant-Slug header or the custom domain
 * names another) and App\Http\Middleware\Authenticate (the account's home
 * community differs from the community the request resolved to).
 *
 * The answer, per tier:
 *
 *   - the account's own community — not this class's question. Both gates ask
 *     only when the communities differ, and allows() answers "no" for it so it
 *     can never readmit something the gates refused before (see allows());
 *   - the platform owner (is_super_admin / is_god, or role super_admin|god) —
 *     yes, for every community and every request. This is the exact flag set
 *     both gates used before this class existed, kept byte-for-byte, and
 *     deliberately NOT routed through AdminTier (a platform flag on an
 *     operational-role row was admitted before and still is);
 *   - a tenant super admin (is_tenant_super_admin) that is also admin-tier
 *     (AdminTier — so broker/coordinator rows fail closed whatever flag they
 *     carry) — yes, but ONLY into a community STRICTLY below its home community
 *     by the materialised tenants.path, and ONLY for a management request
 *     (see isManagementRequest()). Never an ancestor, a sibling, or a
 *     separate root; never a member request;
 *   - everyone else — no.
 *
 * 🔴 OWNER RULE, 12 October 2026 (verbatim): "A tenant super admin should be
 * able to administer all tenants below it, but not above it."
 *
 * 🔴 OWNER, 12 October 2026, later the same day (verbatim): "If they're allowed
 * to sign in, they're allowed to sign in to manage those communities if they're
 * a super admin. I don't know why event organiser tools are blocked for tenant
 * super admins to tenants below them."
 *
 * 🔴 Why "management request" and not "any request": managing a community is
 * not being a member of it. A parent's tenant super admin must not post to the
 * child's feed, message its members, transfer credits or sign up for its events
 * as though it belonged there — those member endpoints keep the 403 tenant
 * mismatch. What it may do below is manage:
 *   - the /api/v2/admin/* surface (every route there is admin-, broker-or-admin-
 *     or in-controller-gated; this class only lets the request reach those
 *     gates);
 *   - the event ORGANISER tools under /api/v2/events/{id}/… — an explicit
 *     method + path list (EVENT_ORGANISER_ROUTES), so an event route added later
 *     is refused below until someone decides it is an organiser tool. Taking
 *     part (RSVP, waitlist, own registration, own tickets, forms, agreements,
 *     invitations, reminders, calendar files) is deliberately absent. EventPolicy
 *     still decides, per event, what the account may actually do;
 *   - GET /api/v2/users/me, the read-only identity call the website cannot load
 *     without.
 *
 * mayEnter() is the same rule without a request: "may this account be signed
 * in to community T at all?" — for the places with no route to look at yet
 * (token refresh, sign-in).
 *
 * 🔴 Authority is still decided downstream. This class only stops the request
 * from being turned away at the door; the route's own gate and the controller's
 * own checks still run, and target records stay confined to the community the
 * request resolved to.
 */
final class CrossTenantEntry
{
    /** Platform-wide role strings — the platform owner tier. */
    private const PLATFORM_ROLES = ['super_admin', 'god'];

    /** The admin surface. Matched as a prefix, so the trailing slash matters. */
    private const ADMIN_PREFIX = 'api/v2/admin/';

    /**
     * Read-only identity endpoints the admin panel needs in order to load at
     * all. Exact paths, read methods only.
     */
    private const READ_ONLY_IDENTITY_PATHS = [
        'api/v2/users/me',
        // The member directory search, read only. The event team tab picks the
        // member to add through it. It lists only the community the request
        // resolved to, and shows a manager no more than /api/v2/admin/users
        // already does.
        'api/v2/users',
    ];

    private const READ_METHODS = ['GET', 'HEAD'];

    /** The event organiser surface. Matched segment by segment, see isEventOrganiserRequest(). */
    private const EVENTS_PREFIX = 'api/v2/events/';

    /**
     * Event organiser routes, by method, as the path AFTER the event id.
     * '' is the event itself. In a pattern, '#' is an id segment (a {placeholder}
     * or digits) and '+' is any one segment (a {placeholder} or a literal action
     * word). Everything else is literal.
     *
     * Taking part is deliberately absent: rsvp, waitlist (POST/DELETE),
     * registration/*, reminders, calendar.ics / calendar-actions,
     * offline-checkin/credentials/me, the attendee's registration-product state
     * and submissions, invitations/accept, registrations/#/guests,
     * safety/code-of-conduct/*, safety/guardian-consents, agenda session
     * registration, tickets/#/allocate (for oneself) and tickets/#/quote.
     * Most organiser WRITES are absent too — see the note after the list.
     *
     * @var array<string, list<string>>
     */
    private const EVENT_ORGANISER_ROUTES = [
        'GET' => [
            '',
            'agenda',
            'attendance',
            'attendees',
            'broadcasts',
            'lifecycle-history',
            'offline-checkin',
            'people',
            'people/#/history',
            'registration-product/invitations',
            'registration-product/manage',
            'safety',
            'safety/reviews',
            'staff',
            'tickets',
            'waitlist',
        ],
        'DELETE' => [
            'staff/#',
        ],
        'POST' => [
            'staff',
        ],
    ];

    /*
     * 🔴 WHY THE LIST ABOVE IS SHORT (12 Oct 2026). Most event organiser WRITES
     * cannot be admitted for an account from another community, because the
     * database forbids it: 45 event tables carry composite foreign keys
     * (<actor column>, tenant_id) → users(id, tenant_id), so the account
     * recorded as having acted must belong to the event's community. A visiting
     * tenant super admin's row does not, and the write fails with SQLSTATE 1452
     * — broadcasts, tickets, registration forms/settings, safety requirements,
     * agenda sessions, templates, check-in devices/credentials, offline sync,
     * invitations, and even the analytics READ (it writes an access audit).
     * Cancelling, rejecting or cancelling a registration can cascade into those
     * tables too (pending broadcasts/campaigns, ticket entitlements), so they
     * are out as well. Admitted: the organiser READS that write nothing, and the
     * event team (event_staff_assignments carries no such key). Widening this
     * needs the owner's decision on the schema rule — see the E-103 register
     * entry. Never add a route here without a test that the write succeeds for
     * a visiting tenant super admin.
     */

    /**
     * The columns a user row needs for allows(). Callers that load the user
     * themselves should select at least these.
     */
    public const USER_COLUMNS = ['id', 'tenant_id', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god'];

    /**
     * @param object|array<string,mixed>|null $user Needs USER_COLUMNS.
     * @param string $method HTTP method of the request.
     * @param string $path   The request path (route URI preferred), with or
     *                       without the leading slash.
     */
    public static function allows(object|array|null $user, int $tenantId, string $method, string $path): bool
    {
        if ($user === null || $tenantId <= 0) {
            return false;
        }

        if (self::isPlatformOwner($user)) {
            return true;
        }

        if (! self::isManagementRequest($method, $path)) {
            return false;
        }

        return self::mayEnter($user, $tenantId);
    }

    /**
     * May this account be signed in to community $tenantId at all, as a
     * community other than its own? The platform owner: anywhere. An admin-tier
     * tenant super admin: a community strictly below its home community. No one
     * else. What it may then DO there is allows()'s question.
     *
     * Its own community is not a crossing and answers "no", for the reason given
     * below; callers handle the home community themselves.
     *
     * @param object|array<string,mixed>|null $user Needs USER_COLUMNS.
     */
    public static function mayEnter(object|array|null $user, int $tenantId): bool
    {
        if ($user === null || $tenantId <= 0) {
            return false;
        }

        if (self::isPlatformOwner($user)) {
            return true;
        }

        $homeTenantId = (int) data_get($user, 'tenant_id', 0);
        if ($homeTenantId <= 0) {
            return false;
        }

        if ($homeTenantId === $tenantId) {
            // Not a crossing. Callers ask only when the communities differ; a
            // "yes" here could readmit a token minted for a community the
            // account has since been moved away from, which the gates refused
            // before this class existed.
            return false;
        }

        if (! (bool) data_get($user, 'is_tenant_super_admin', false) || ! AdminTier::allows($user)) {
            return false;
        }

        return TenantAdminScope::isDescendant($homeTenantId, $tenantId);
    }

    /**
     * allows() for the request being handled now.
     *
     * @param object|array<string,mixed>|null $user
     */
    public static function allowsForRequest(object|array|null $user, int $tenantId, ?Request $request = null): bool
    {
        [$method, $path] = self::describeRequest($request);

        return self::allows($user, $tenantId, $method, $path);
    }

    /**
     * May this ACTOR (the signed-in account, looked up by id alone) act in
     * $tenantId on the current request? Its own community, or a crossing that
     * allows() admits.
     *
     * For controllers that load the actor's own row. 🔴 Never look the ACTOR up
     * with `->where('tenant_id', <current community>)`: once a tenant super
     * admin is working in a community below its own, its row is not in the
     * current community and the lookup silently finds nothing. Load the row by
     * id, then ask this. TARGET records (the members, events and settings being
     * administered) must still be confined to the current community.
     *
     * @param object|array<string,mixed>|null $actor Needs USER_COLUMNS.
     */
    public static function actorMayActIn(object|array|null $actor, int $tenantId, ?Request $request = null): bool
    {
        if ($actor === null || $tenantId <= 0) {
            return false;
        }

        if ((int) data_get($actor, 'tenant_id', 0) === $tenantId) {
            return true;
        }

        return self::allowsForRequest($actor, $tenantId, $request);
    }

    /**
     * The ACTING account for work in community $tenantId: active, not deleted,
     * looked up by id alone, and then admitted only if it is in $tenantId or
     * actorMayActIn() admits the crossing. Null otherwise.
     *
     * 🔴 For the actor ONLY. A member being acted ON (the person registered,
     * given a ticket, reviewed, named as a speaker) must still be looked up
     * with `where('tenant_id', $tenantId)`: a tenant super admin from above may
     * manage this community but must never become one of its members' records.
     */
    public static function activeActor(int $userId, int $tenantId, bool $lock = false): ?\App\Models\User
    {
        if ($userId <= 0 || $tenantId <= 0) {
            return null;
        }

        $query = \App\Models\User::withoutGlobalScopes()
            ->whereKey($userId)
            ->where('status', 'active')
            ->whereNull('deleted_at');
        if ($lock) {
            $query->lockForUpdate();
        }

        $actor = $query->first();
        if (! $actor instanceof \App\Models\User || ! self::actorMayActIn($actor, $tenantId)) {
            return null;
        }

        return $actor;
    }

    /**
     * USER_COLUMNS plus the caller's own columns, for an actor lookup that is
     * then checked with actorMayActIn().
     *
     * @param list<string> $columns
     * @return list<string>
     */
    public static function actorColumns(array $columns = []): array
    {
        return array_values(array_unique([...self::USER_COLUMNS, ...$columns]));
    }

    /**
     * The platform owner: the only account that crosses into every community on
     * every request. Exactly the flag set TenantContext and Authenticate used
     * before this class existed.
     *
     * @param object|array<string,mixed>|null $user
     */
    public static function isPlatformOwner(object|array|null $user): bool
    {
        if ($user === null) {
            return false;
        }

        return ! empty(data_get($user, 'is_super_admin'))
            || ! empty(data_get($user, 'is_god'))
            || in_array((string) (data_get($user, 'role') ?? ''), self::PLATFORM_ROLES, true);
    }

    /**
     * Is this a management request — the whole surface a tenant super admin may
     * use in a community below its own? Administration (isAdministrationRequest)
     * or an event organiser tool (isEventOrganiserRequest).
     */
    public static function isManagementRequest(string $method, string $path): bool
    {
        return self::isAdministrationRequest($method, $path)
            || self::isEventOrganiserRequest($method, $path);
    }

    /**
     * Is this one of the event organiser tools in EVENT_ORGANISER_ROUTES?
     *
     * Same refusal of anything ambiguous as isAdministrationRequest(). The event
     * segment must be an id ({id}, {eventId}, {sourceEventId} or digits); the
     * rest must match one listed pattern for this method exactly, segment for
     * segment — never a prefix match, so a longer path is refused.
     */
    public static function isEventOrganiserRequest(string $method, string $path): bool
    {
        $normalised = self::normalisePath($path);
        if ($normalised === null || ! str_starts_with($normalised, self::EVENTS_PREFIX)) {
            return false;
        }

        $patterns = self::EVENT_ORGANISER_ROUTES[strtoupper($method)] ?? [];
        if ($patterns === []) {
            return false;
        }

        $segments = explode('/', substr($normalised, strlen(self::EVENTS_PREFIX)));
        $eventSegment = array_shift($segments);
        if ($eventSegment === null || ! self::isIdSegment($eventSegment)) {
            return false;
        }

        foreach ($patterns as $pattern) {
            $expected = $pattern === '' ? [] : explode('/', $pattern);
            if (count($expected) !== count($segments)) {
                continue;
            }

            $matches = true;
            foreach ($expected as $i => $want) {
                $got = $segments[$i];
                $ok = match ($want) {
                    '#' => self::isIdSegment($got),
                    '+' => preg_match('/^(\{[A-Za-z]+\}|[A-Za-z0-9_-]+)$/', $got) === 1,
                    default => $got === $want,
                };
                if (! $ok) {
                    $matches = false;
                    break;
                }
            }

            if ($matches) {
                return true;
            }
        }

        return false;
    }

    /** A route placeholder ({id}, {userId}, …) or a run of digits. */
    private static function isIdSegment(string $segment): bool
    {
        return ctype_digit($segment) || preg_match('/^\{[A-Za-z]+\}$/', $segment) === 1;
    }

    /**
     * Is this an administration request, in the sense above?
     *
     * Anything ambiguous is refused: a dot segment, an empty segment, a
     * backslash, a NUL, or a percent sign left after one decode. Real admin
     * routes contain none of those, and the router matches against the decoded
     * path — so a path that passes here can only reach a route whose literal
     * prefix is the admin surface. Case-sensitive, like the router.
     */
    public static function isAdministrationRequest(string $method, string $path): bool
    {
        $normalised = self::normalisePath($path);
        if ($normalised === null) {
            return false;
        }

        if (str_starts_with($normalised, self::ADMIN_PREFIX) && strlen($normalised) > strlen(self::ADMIN_PREFIX)) {
            return true;
        }

        return in_array(strtoupper($method), self::READ_METHODS, true)
            && in_array($normalised, self::READ_ONLY_IDENTITY_PATHS, true);
    }

    /**
     * The method and path of the request being handled. Prefers the matched
     * route's URI template — it comes from the route table, not from the
     * client — and falls back to the decoded request path.
     *
     * @return array{0:string,1:string}
     */
    public static function describeRequest(?Request $request = null): array
    {
        try {
            $request ??= app('request');
        } catch (Throwable) {
            return ['', ''];
        }

        if (! $request instanceof Request) {
            return ['', ''];
        }

        $method = strtoupper($request->getMethod());

        try {
            $route = $request->route();
            if (is_object($route) && method_exists($route, 'uri')) {
                return [$method, (string) $route->uri()];
            }
        } catch (Throwable) {
            // No route resolver yet — fall through to the path.
        }

        return [$method, $request->decodedPath()];
    }

    private static function normalisePath(string $path): ?string
    {
        $decoded = rawurldecode($path);
        $trimmed = ltrim($decoded, '/');

        if ($trimmed === ''
            || str_contains($trimmed, '%')
            || str_contains($trimmed, '\\')
            || str_contains($trimmed, "\0")
            || str_contains($trimmed, '//')
            || str_ends_with($trimmed, '/')
        ) {
            return null;
        }

        foreach (explode('/', $trimmed) as $segment) {
            if ($segment === '.' || $segment === '..') {
                return null;
            }
        }

        return $trimmed;
    }
}
