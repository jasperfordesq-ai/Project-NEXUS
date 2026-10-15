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
 *     without;
 *   - the "Confirm it is you" step-up calls (STEP_UP_CONFIRMATION_ROUTES), so a
 *     high-risk admin action admitted above can actually be confirmed.
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

    /** The member API a visitor may read (isVisitorReadRequest()). */
    private const MEMBER_API_PREFIX = 'api/v2/';

    /**
     * Reads outside the member API that every member page needs: the site's
     * navigation menus (MenuController, read only). Pattern syntax: matchesAny().
     *
     * @var list<string>
     */
    private const VISITOR_EXTRA_READS = [
        'api/menus',
        'api/menus/+',
    ];

    /** The error code of a request refused to a visitor (isVisitor()). */
    public const VISITOR_READ_ONLY_CODE = 'visiting_manager_read_only';

    /**
     * Member-side reads a visitor may NOT make, although they are GETs: they
     * write, leave a trace a member can see, or create rows for the caller.
     * Pattern syntax: see matchesAny(). The first entry must be a literal path
     * (a test calls it).
     *
     * @var list<string>
     */
    public const VISITOR_REFUSED_READS = [
        // Personal data exports and statements: built for, and recorded
        // against, the caller (the member export also notifies admins).
        'api/v2/me/data-export',
        'api/v2/caring-community/me/data-export',
        'api/v2/caring-community/my-ahv-pension-export',
        'api/v2/jobs/gdpr-export',
        'api/v2/wallet/statement',
        'api/v2/groups/#/export',
        'api/v2/groups/#/exports/*',
        // Opening a conversation marks it read, and the read marker also
        // touches the caller's notifications in its own community.
        'api/v2/messages/#',
        'api/v2/messages/#/*',
        // Rows, passes and credentials created for the caller on first read.
        'api/v2/marketplace/seller/*',
        'api/v2/caring-community/regional-points/*',
        'api/v2/caring-community/hour-transfer/my-history',
        'api/v2/gamification/nexus-score',
        'api/v2/partner-venues/pass',
        'api/v2/volunteering/shifts/#/checkin',
        'api/v2/courses/#/certificate',
        'api/v2/volunteering/certificates/+/html',
        // Reads that change the caller's own records or what a member sees.
        'api/v2/safeguarding/my-preferences',
        'api/v2/caring-community/my-trust-tier',
        'api/v2/identity/status',
        'api/v2/federation/activity',
        'api/v2/goals/#/insights',
        'api/v2/users/me/sub-accounts',
        'api/v2/users/me/sub-accounts/*',
    ];

    /**
     * The two calls behind the "Confirm it is you" prompt that guards high-risk
     * admin actions (RequireRecentSecondFactor). Without them a manager working
     * below could reach a guarded admin route but never confirm it: the prompt
     * reported "no authenticator app" and the code was refused at this door.
     * Both concern only the signed-in account's own second factor, and the
     * confirmation they mint is bound to the community the request resolved
     * to. Exact method + path.
     *
     * @var array<string, string>
     */
    private const STEP_UP_CONFIRMATION_ROUTES = [
        'api/webauthn/status' => 'GET',
        'api/webauthn/security-confirm' => 'POST',
    ];

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
            'analytics',
            'analytics/export.csv',
            'attendance',
            'attendees',
            'broadcasts',
            'federation-status',
            'lifecycle-history',
            'offline-checkin',
            'offline-checkin/batches/lookup',
            'offline-checkin/batches/#',
            'offline-checkin/conflicts',
            'people',
            'people/export.csv',
            'people/#/history',
            'recurrence-definition-blueprints',
            'registration-product/invitations',
            'registration-product/manage',
            'registration-product/retention',
            'safety',
            'safety/reviews',
            'staff',
            'tickets',
            'tickets/reconciliation',
            'waitlist',
        ],
        'PUT' => [
            '',
            'agenda/order',
            'agenda/sessions/#',
            'recurring',
            'registration-product/forms/#',
            'registration-product/settings',
            'safety/requirements',
            'ticket-types/#',
        ],
        'DELETE' => [
            '',
            'safety/reviews/#',
            'staff/#',
        ],
        'POST' => [
            'agenda/sessions',
            'agenda/sessions/#/cancel',
            'attendance',
            'attendance/bulk',
            'attendance/code',
            'attendees/#/check-in',
            'broadcasts',
            'broadcasts/preview',
            'cancel',
            'image',
            'offline-checkin/conflicts/#',
            'offline-checkin/credentials',
            'offline-checkin/credentials/#/revoke',
            'offline-checkin/credentials/#/rotate',
            'offline-checkin/devices',
            'offline-checkin/devices/#/revoke',
            'offline-checkin/devices/#/rotate',
            'offline-checkin/manifest',
            'offline-checkin/scan',
            'offline-checkin/sync',
            'people/bulk',
            'people/#/approve',
            'people/#/attendance',
            'people/#/cancel',
            'people/#/reject',
            'publish',
            'recurrence-definition-blueprints/commit',
            'recurrence-definition-blueprints/preview',
            'recurrence-revisions/commit',
            'recurrence-revisions/preview',
            'registration-product/campaigns/preview',
            'registration-product/campaigns/#/cancel',
            'registration-product/campaigns/#/issue',
            'registration-product/campaigns/#/schedule',
            'registration-product/forms',
            'registration-product/forms/#/fork',
            'registration-product/forms/#/publish',
            'registration-product/guests/#/attendance/+',
            'registration-product/guests/#/cancel',
            'registration-product/invitations/#/revoke',
            'registration-product/retention/dry-run',
            'registration-product/retention/#/apply',
            'registration-product/settings/publish',
            'registration-product/submissions/export',
            'safety/requirements/archive',
            'safety/requirements/publish',
            'safety/reviews',
            'series',
            'staff',
            'submit',
            'template-preview',
            'templates',
            'ticket-entitlements/#/cancel',
            'ticket-types',
            'ticket-types/#/+',
            'tickets/#/allocate/#',
        ],
    ];

    /** One organiser message, addressed by its own id rather than the event's. */
    private const EVENT_BROADCASTS_PREFIX = 'api/v2/event-broadcasts/';

    /**
     * The organiser-message routes under EVENT_BROADCASTS_PREFIX, by method,
     * as the path AFTER the broadcast id ('' is the message itself). Without
     * them a manager below could draft a message (an event route) but never
     * open, send, cancel or retry it (E-106). EventBroadcastService still
     * authorises every action against the message's event.
     *
     * @var array<string, list<string>>
     */
    private const EVENT_BROADCAST_ROUTES = [
        'GET' => [''],
        'POST' => ['revisions', 'schedule', 'cancel', 'retry'],
    ];

    /*
     * 🔴 HOW ORGANISER CHANGES BELOW ARE RECORDED (owner, 12 Oct 2026: option 3).
     * About 45 event tables carry composite foreign keys (<actor column>,
     * tenant_id) → users(id, tenant_id): the account recorded as having acted
     * must belong to the event's community. A manager from another community
     * therefore acts here as its DELEGATE (ManagerDelegate; activeActor();
     * BaseApiController::getActingUserId()). Never add a route here without a
     * test, in TenantSuperAdminManagesBelowTest or beside it, that the action
     * succeeds for a visiting tenant super admin and names the delegate.
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

        if (! self::isManagementRequest($method, $path) && ! self::isVisitorReadRequest($method, $path)) {
            return false;
        }

        return self::mayEnter($user, $tenantId);
    }

    /**
     * Is this account VISITING community $tenantId — a tenant super admin from
     * a community above, signed in here to manage and look around, never as a
     * member? The platform owner is never a visitor (it may do anything
     * anywhere); its own community is not a visit.
     *
     * Used to answer a refused request with VISITOR_READ_ONLY_CODE instead of
     * a tenant mismatch, which the website treats as a foreign account and
     * signs out.
     *
     * @param object|array<string,mixed>|null $user Needs USER_COLUMNS.
     */
    public static function isVisitor(object|array|null $user, int $tenantId): bool
    {
        return ! self::isPlatformOwner($user) && self::mayEnter($user, $tenantId);
    }

    /**
     * The error for a request refused at the door: VISITOR_READ_ONLY_CODE when
     * the account is a visitor here (isVisitor()), otherwise the caller's own
     * community-mismatch code and message, unchanged.
     *
     * @param object|array<string,mixed>|null $user Needs USER_COLUMNS.
     * @return array{code:string,message:string}
     */
    public static function refusalError(object|array|null $user, int $tenantId, string $mismatchCode, string $mismatchMessage): array
    {
        if (self::isVisitor($user, $tenantId)) {
            return [
                'code' => self::VISITOR_READ_ONLY_CODE,
                'message' => 'You are visiting this community as a manager from another community. You can look around, but you cannot take part here.',
            ];
        }

        return ['code' => $mismatchCode, 'message' => $mismatchMessage];
    }

    /**
     * Is this a member-side READ a visitor may make — GET/HEAD of the member
     * API (api/v2/*) that is not on VISITOR_REFUSED_READS?
     *
     * 🔴 Owner, 15 Oct 2026: a tenant super admin should "be able to browse the
     * children so he can see what's going on", with "as much leeway as
     * possible", but with "strict rules to stop any confusion, like acting as
     * an ordinary member on the site". So: everything a member of the community
     * can see, and no member action. Every write outside isManagementRequest()
     * stays refused here, at the door, whatever the page shows.
     *
     * Same refusal of anything ambiguous as isAdministrationRequest().
     */
    public static function isVisitorReadRequest(string $method, string $path): bool
    {
        if (! in_array(strtoupper($method), self::READ_METHODS, true)) {
            return false;
        }

        $normalised = self::normalisePath($path);
        if ($normalised === null) {
            return false;
        }

        if (self::matchesAny($normalised, self::VISITOR_EXTRA_READS)) {
            return true;
        }

        if (! str_starts_with($normalised, self::MEMBER_API_PREFIX)
            || strlen($normalised) <= strlen(self::MEMBER_API_PREFIX)
        ) {
            return false;
        }

        return ! self::matchesAny($normalised, self::VISITOR_REFUSED_READS);
    }

    /**
     * Does $path match one of $patterns, segment for segment? In a pattern '#'
     * is an id segment (a {placeholder} or digits) and '+' is any one segment.
     * A pattern ending in '/*' also matches everything below it.
     *
     * @param list<string> $patterns
     */
    private static function matchesAny(string $path, array $patterns): bool
    {
        $segments = explode('/', $path);
        foreach ($patterns as $pattern) {
            $prefix = str_ends_with($pattern, '/*');
            $expected = explode('/', $prefix ? substr($pattern, 0, -2) : $pattern);
            if ($prefix ? count($segments) < count($expected) : count($segments) !== count($expected)) {
                continue;
            }

            $matches = true;
            foreach ($expected as $i => $want) {
                $got = $segments[$i];
                $ok = match ($want) {
                    '#' => self::isIdSegment($got),
                    '+' => preg_match('/^(\{[A-Za-z_]+\}|[A-Za-z0-9_.-]+)$/', $got) === 1,
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

        // 🔴 Management only, never a visitor's read (E-107): acting needs an
        // account of THIS community (activeActor() creates the delegate), and
        // merely looking around must never create one.
        if (self::isPlatformOwner($actor)) {
            return true;
        }
        [$method, $path] = self::describeRequest($request);

        return self::isManagementRequest($method, $path) && self::mayEnter($actor, $tenantId);
    }

    /**
     * Is the request being handled now a VISIT (isVisitor()) by the signed-in
     * account? For the places that record that someone looked — view and
     * download counters — which must not count a manager looking around from
     * above (owner, 15 Oct 2026: browsing must not confuse anyone). Fails open
     * to "not a visit" only when there is no signed-in account or community,
     * which is never a visit.
     */
    public static function isVisitingNow(): bool
    {
        try {
            $user = auth()->user();
            $tenantId = (int) \App\Core\TenantContext::getId();
        } catch (Throwable) {
            return false;
        }

        return $user !== null && $tenantId > 0
            && (int) data_get($user, 'tenant_id', 0) !== $tenantId
            && self::isVisitor($user, $tenantId);
    }

    /**
     * The ACTING account for work in community $tenantId: an active member of
     * it; a usable delegate of it (ManagerDelegate); or, for a manager from
     * another community whose crossing actorMayActIn() admits, that manager's
     * delegate here (created on first use). Null otherwise.
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
            ->whereIn('status', ['active', ManagerDelegate::STATUS])
            ->whereNull('deleted_at');
        if ($lock) {
            $query->lockForUpdate();
        }

        $actor = $query->first();
        if (! $actor instanceof \App\Models\User) {
            return null;
        }

        // A delegate already inside this community: usable only while the
        // manager it stands for is still active and still admitted here.
        if (ManagerDelegate::isDelegate($actor)) {
            return ManagerDelegate::isUsable($actor, $tenantId) ? $actor : null;
        }

        if ((int) $actor->tenant_id === $tenantId) {
            return $actor;
        }

        // A manager from another community, on a request the door admitted:
        // it acts here as its delegate, so what it does can be recorded
        // against an account of THIS community (owner, 12 Oct 2026: option 3).
        if (! self::actorMayActIn($actor, $tenantId)) {
            return null;
        }

        return ManagerDelegate::forPrincipal($actor, $tenantId, $lock);
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
        if ($normalised !== null && str_starts_with($normalised, self::EVENT_BROADCASTS_PREFIX)) {
            $segments = explode('/', substr($normalised, strlen(self::EVENT_BROADCASTS_PREFIX)));
            $broadcastSegment = array_shift($segments);

            return $broadcastSegment !== null
                && self::isIdSegment($broadcastSegment)
                && count($segments) <= 1
                && in_array(
                    $segments[0] ?? '',
                    self::EVENT_BROADCAST_ROUTES[strtoupper($method)] ?? [],
                    true,
                );
        }
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

        if ((self::STEP_UP_CONFIRMATION_ROUTES[$normalised] ?? null) === strtoupper($method)) {
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
