<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Names;

use App\Core\TenantContext;
use App\Support\Members\MemberProfileVisibility;
use Illuminate\Container\Container;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * Who is looking — and may they see surnames? (E-122)
 *
 * Owner rule, 10 November 2026: "No surnames should be anywhere on the site
 * apart from for admins", and, asked about brokers and coordinators: "Brokers
 * too" — in their OWN community.
 *
 * One decision, asked by {@see \App\Support\UserDisplayName} and by
 * {@see \App\Models\User} serialisation. It is answered, in this order, from:
 *
 *  1. the innermost SCOPE the code opened ({@see withFullNames()},
 *     {@see withPublicNames()}, {@see forRecipient()});
 *  2. a GRANT placed on the request by a gate that has just proved the caller
 *     may use an admin or broker screen ({@see grantForRequest()});
 *  3. the SIGNED-IN VIEWER: staff of the community the request resolved to
 *     ({@see MemberProfileVisibility::viewerSeesSurnamesOf()}).
 *
 * With no viewer at all — a queue job, a scheduled command, a signed-out
 * visitor — the answer is NO. A full name built there must name a reason
 * ({@see NameReason}).
 *
 * A member always sees their OWN surname ({@see allowsSurnameOf()}): "own"
 * means the person the innermost scope is rendering for, else the signed-in
 * viewer. {@see withPublicNames()} switches even that off.
 *
 * 🔴 None of this changes anything until `config('names.surname_audience_enforced')`
 * is true ({@see enforced()}). The callers check that first.
 *
 * State and why it is safe across requests, tests and queue workers:
 *  - the viewer's answer is memoised on the current REQUEST's attribute bag,
 *    keyed by viewer and community, and only while a route is being served.
 *    It is never held in a static or a container singleton, so it cannot
 *    outlive the request — not under Octane, not in a queue worker (which has
 *    no routed request, so nothing is memoised there), and not between two
 *    requests made by one feature test;
 *  - the scope stack IS static, but every push is popped in a `finally`, so it
 *    is empty again whenever no scope is running.
 */
final class NameAudience
{
    /** The single switch. Off until E-122 stage 4. */
    public const CONFIG_KEY = 'names.surname_audience_enforced';

    private const GRANT_ATTRIBUTE = 'names.full_reason';
    private const MEMO_ATTRIBUTE = 'names.viewer_sees_surnames';

    /**
     * Innermost last. `allow === null` means "not worked out yet" (a
     * recipient scope decides lazily, so opening one costs no query).
     *
     * @var list<array{allow: bool|null, viewer: int|null, community: int}>
     */
    private static array $scopes = [];

    /**
     * Is the central rule switched on? False also when there is no
     * application (a plain unit test), so the name helpers keep working there.
     */
    public static function enforced(): bool
    {
        $app = Container::getInstance();

        return $app->bound('config')
            && (bool) $app->make('config')->get(self::CONFIG_KEY, false);
    }

    /**
     * May the current audience see OTHER PEOPLE's surnames?
     *
     * Use this where no single member is being named (a SQL expression, a
     * prefixed row, a search clause). Where one member is being named, use
     * {@see allowsSurnameOf()} so that their own name stays whole.
     */
    public static function allowsSurnames(): bool
    {
        $index = count(self::$scopes) - 1;
        if ($index >= 0) {
            return self::scopeAllows($index);
        }

        $request = self::currentRequest();
        if ($request !== null && $request->attributes->get(self::GRANT_ATTRIBUTE) instanceof NameReason) {
            return true;
        }

        return self::viewerAllowed($request, self::signedInViewerId(), (int) TenantContext::getId());
    }

    /**
     * May the current audience see the surname of member `$memberId`?
     * True for the audience of {@see allowsSurnames()}, and for the member
     * themself.
     */
    public static function allowsSurnameOf(?int $memberId): bool
    {
        if ($memberId !== null && $memberId > 0) {
            $index = count(self::$scopes) - 1;
            $viewerId = $index >= 0 ? self::$scopes[$index]['viewer'] : self::signedInViewerId();
            // A scope with allow === false and no viewer is withPublicNames():
            // nobody is "self" there.
            if ($viewerId !== null && $viewerId === $memberId) {
                return true;
            }
        }

        return self::allowsSurnames();
    }

    /**
     * Run `$fn` with full names, for the stated reason.
     *
     * @template T
     * @param callable(): T $fn
     * @return T
     */
    public static function withFullNames(NameReason $why, callable $fn): mixed
    {
        // $why is the greppable record of the decision; nothing reads it back.
        unset($why);

        return self::scoped(['allow' => true, 'viewer' => null, 'community' => 0], $fn);
    }

    /**
     * Run `$fn` with first names only, whoever is signed in — for output that
     * reaches people other than the caller: another community (federation, a
     * partner), a broadcast channel, a cached payload. Beats an admin viewer
     * and a route grant, and nobody counts as "self" inside it.
     *
     * @template T
     * @param callable(): T $fn
     * @return T
     */
    public static function withPublicNames(callable $fn): mixed
    {
        return self::scoped(['allow' => false, 'viewer' => null, 'community' => 0], $fn);
    }

    /**
     * Run `$fn` for one RECIPIENT of an email, a bell or a push: names are
     * what that person may see in the current community, never what the HTTP
     * caller may see. The recipient's own name stays whole. A null recipient,
     * or one without an id, gets first names.
     *
     * Sits beside `LocaleContext::withLocale($recipient, …)`; it is not folded
     * into it because that helper is also given bare locale strings.
     *
     * @template T
     * @param int|object|array<string, mixed>|null $recipient a user id, or anything carrying `id`
     * @param callable(): T $fn
     * @return T
     */
    public static function forRecipient(int|object|array|null $recipient, callable $fn): mixed
    {
        $recipientId = match (true) {
            is_int($recipient) => $recipient,
            $recipient === null => 0,
            default => (int) data_get($recipient, 'id', 0),
        };

        if ($recipientId <= 0) {
            return self::scoped(['allow' => false, 'viewer' => null, 'community' => 0], $fn);
        }

        return self::scoped(
            ['allow' => null, 'viewer' => $recipientId, 'community' => (int) TenantContext::getId()],
            $fn,
        );
    }

    /**
     * Record that this request has passed a gate which entitles the caller to
     * full names. For the admin / broker gates only — call it on the success
     * path, immediately before the request is let through.
     */
    public static function grantForRequest(Request $request, NameReason $why): void
    {
        $request->attributes->set(self::GRANT_ATTRIBUTE, $why);
    }

    /** {@see grantForRequest()} for a gate that has no Request in hand (a controller helper). */
    public static function grantForCurrentRequest(NameReason $why): void
    {
        $request = self::currentRequest();
        if ($request !== null) {
            self::grantForRequest($request, $why);
        }
    }

    /**
     * @template T
     * @param array{allow: bool|null, viewer: int|null, community: int} $scope
     * @param callable(): T $fn
     * @return T
     */
    private static function scoped(array $scope, callable $fn): mixed
    {
        self::$scopes[] = $scope;

        try {
            return $fn();
        } finally {
            array_pop(self::$scopes);
        }
    }

    private static function scopeAllows(int $index): bool
    {
        $scope = self::$scopes[$index];
        if ($scope['allow'] === null) {
            // A recipient: decided once, on first use, and kept on the scope.
            $scope['allow'] = MemberProfileVisibility::viewerSeesSurnamesOf($scope['viewer'], $scope['community']);
            self::$scopes[$index] = $scope;
        }

        return $scope['allow'];
    }

    private static function viewerAllowed(?Request $request, ?int $viewerId, int $communityId): bool
    {
        if ($viewerId === null || $viewerId <= 0) {
            return false;
        }

        // Memoise only while a route is being served: that Request object is
        // created for one HTTP request and thrown away after it. Outside one
        // (console, queue worker, global middleware) the bound Request can be
        // long-lived, so the rule is simply asked again.
        if ($request === null || $request->route() === null) {
            return MemberProfileVisibility::viewerSeesSurnamesOf($viewerId, $communityId);
        }

        /** @var array<string, bool> $memo */
        $memo = $request->attributes->get(self::MEMO_ATTRIBUTE, []);
        $key = $viewerId . ':' . $communityId;
        if (! array_key_exists($key, $memo)) {
            $memo[$key] = MemberProfileVisibility::viewerSeesSurnamesOf($viewerId, $communityId);
            $request->attributes->set(self::MEMO_ATTRIBUTE, $memo);
        }

        return $memo[$key];
    }

    private static function signedInViewerId(): ?int
    {
        $id = Auth::id();

        return is_numeric($id) && (int) $id > 0 ? (int) $id : null;
    }

    private static function currentRequest(): ?Request
    {
        $app = Container::getInstance();
        if (! $app->bound('request')) {
            return null;
        }

        $request = $app->make('request');

        return $request instanceof Request ? $request : null;
    }
}
