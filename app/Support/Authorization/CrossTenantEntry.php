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
 *     by the materialised tenants.path, and ONLY for an administration request
 *     (see isAdministrationRequest()). Never an ancestor, a sibling, or a
 *     separate root; never a member request;
 *   - everyone else — no.
 *
 * 🔴 OWNER RULE, 12 October 2026 (verbatim): "A tenant super admin should be
 * able to administer all tenants below it, but not above it."
 *
 * 🔴 Why "administration request" and not "any request": administering a
 * community is not being a member of it. A parent's tenant super admin must not
 * post to the child's feed, message its members, transfer credits or register
 * for its events as though it belonged there — those member endpoints keep the
 * 403 tenant mismatch. What it may do below is what the admin panel does: the
 * /api/v2/admin/* surface (every route there is admin-, broker-or-admin- or
 * in-controller-gated; this class only lets the request reach those gates), and
 * GET /api/v2/users/me, the read-only identity call the panel cannot load
 * without.
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
    private const READ_ONLY_IDENTITY_PATHS = ['api/v2/users/me'];

    private const READ_METHODS = ['GET', 'HEAD'];

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

        if (! self::isAdministrationRequest($method, $path)) {
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
