<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use App\Services\BillingAutomationService;
use App\Services\BillingStandingService;
use App\Services\TenantBillingService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * "Stop new members joining" (DESIGN 6.4, 6.7): is this community's door shut?
 *
 * The line is walked from the community upward, and the walk STOPS at the
 * first exempt community, the community itself included: an exempt community
 * is untouched by every over-limit rule (DESIGN 6.4) and shields everything
 * below it from the communities above it, exactly as BillingLock treats an
 * exemption for the pause. Among the communities walked, the door is shut by
 * any one that meets all of these:
 *
 *   - the platform team's automatic checks are on;
 *   - its rule for going over its member number is `block_joining`
 *     (OverLimitRule::for()['effective_action']);
 *   - it has a watched limit (BillingAutomationService::watchedLimit(): an
 *     active standard plan whose member number, as it applies to the
 *     community, is a positive number);
 *   - its active members (TenantBillingService::getSubtreeActiveMemberCount(),
 *     the one member number used everywhere) are at or over that number;
 *   - the daily check has told its admins, under the terms in force now,
 *     that it is at or over that number (toldUnderPresentTerms()). Warning
 *     comes first: a hub lowering a member number, a rule changed to
 *     `block_joining`, a smaller plan or the checks being switched on shut
 *     nothing until the next run has sent the fresh notice.
 *
 * Members of a child count towards its parent's number, so a parent's rule
 * shuts its children's doors; a sibling's never does. Tenant 1 never shuts a
 * door and is never shut.
 *
 * A community above shuts a door only once the community below has been told
 * too (task 7A): its `joining_closed_notice_key` must be the full community's
 * noticeKeyFor(), recorded by the daily check when the notice to its admins
 * was accepted. Until then that door stays open, while the full community's
 * own door is shut, and the community above does not cap an import below it
 * either (limits(), tightest(), roomLeft()): only the community's own limit
 * applies.
 *
 * Open again by itself when the count drops or the terms change. Existing members
 * are never touched: this only answers "may a NEW member come to exist here".
 * The billing pause is a separate thing (BillingLock) and refuses sign-ups on
 * its own.
 *
 * Cost and failure. Each community's answer is cached for CACHE_TTL seconds
 * under a generation number; flush() moves to a new generation, so every
 * cached answer on every server is dropped at once (called by the plan, rule,
 * exemption, payer and settings writes). A sign-up must never die because of
 * a billing fault: if the check itself fails, the door answers OPEN and the
 * failure is logged at error, once per process.
 */
final class JoiningGate
{
    public const CODE = 'COMMUNITY_NOT_TAKING_MEMBERS';

    public const CACHE_PREFIX = 'joining_gate:';

    public const GENERATION_KEY = 'joining_gate:generation';

    /** Seconds. */
    public const CACHE_TTL = 60;

    private static bool $cacheFailureReported = false;

    private static bool $checkFailureReported = false;

    /** @var (\Closure(int): ?array{tenant_id:int, active:int, max:int})|null */
    private static ?\Closure $answerOverride = null;

    /**
     * The community (itself or one above it in its line) whose rule shuts the
     * door, or null when the door is open.
     *
     * @param int|null $alreadyCountedIn for a move: the community the person is
     *        leaving. A community in the line above both is not asked, because
     *        the person is already among its members.
     * @return array{tenant_id:int, active:int, max:int}|null
     */
    public static function closedBy(int $tenantId, ?int $alreadyCountedIn = null): ?array
    {
        foreach (self::limits($tenantId, $alreadyCountedIn) as $cap) {
            if ($cap['active'] >= $cap['max']) {
                return $cap;
            }
        }

        return null;
    }

    /**
     * How many new accounts may still come to exist here before a door in the
     * line shuts: the smallest room left (member number less active members,
     * never below 0) among the communities whose rule applies, or null when no
     * cap applies at all.
     */
    public static function roomLeft(int $tenantId): ?int
    {
        $cap = self::tightest($tenantId);

        return $cap === null ? null : max(0, $cap['max'] - $cap['active']);
    }

    /**
     * The community with the least room left, or null when no cap applies.
     *
     * @return array{tenant_id:int, active:int, max:int}|null
     */
    public static function tightest(int $tenantId, ?int $alreadyCountedIn = null): ?array
    {
        $tightest = null;
        foreach (self::limits($tenantId, $alreadyCountedIn) as $cap) {
            if ($tightest === null || $cap['max'] - $cap['active'] < $tightest['max'] - $tightest['active']) {
                $tightest = $cap;
            }
        }

        return $tightest;
    }

    /**
     * Every community whose rule applies to a new member of $tenantId, nearest
     * first, with its count. Empty when the switch is off, when no cap applies,
     * and when the check fails (logged). For callers that use up room as they
     * go (a bulk move).
     *
     * @return list<array{tenant_id:int, active:int, max:int}>
     */
    public static function limits(int $tenantId, ?int $alreadyCountedIn = null): array
    {
        if ($tenantId <= 1) {
            return [];
        }

        try {
            if (!(bool) BillingSettings::get('automation_enabled')) {
                return [];
            }

            $skip = $alreadyCountedIn !== null && $alreadyCountedIn > 0
                ? array_flip(BillingLock::lineNearestFirst($alreadyCountedIn))
                : [];

            $caps = [];
            $toldOf = null;
            foreach (BillingLock::lineNearestFirst($tenantId) as $id) {
                if ($id <= 1) {
                    continue;
                }
                $answer = self::answerFor($id);
                if ($answer['exempt']) {
                    // An exempt community shields itself and everything below it.
                    break;
                }
                if ($id === $tenantId) {
                    $toldOf = $answer['told_of_above'];
                }
                if ($answer['cap'] === null || isset($skip[$id])) {
                    continue;
                }
                // Warning first, for the community below too (task 7A): a
                // community above limits this one at all, by shutting its
                // door or by capping an import at its room left, only once
                // this community's admins have been told, under that
                // community's present terms. Until then only this
                // community's own limit applies.
                if (
                    $id !== $tenantId
                    && self::$answerOverride === null
                    && $toldOf !== $answer['notice_key']
                ) {
                    continue;
                }
                $caps[] = $answer['cap'];
            }

            return $caps;
        } catch (\Throwable $e) {
            if (!self::$checkFailureReported) {
                self::$checkFailureReported = true;
                Log::error('[JoiningGate] member-limit check failed; joining allowed', [
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
            }

            return [];
        }
    }

    /**
     * For the daily check's notice to the communities below (task 7A): every
     * community ABOVE this one whose rule applies to it, nearest first, with
     * its count and the key this community must hold to be shut by it
     * (noticeKeyFor()), whether or not this community has been told. Empty
     * when the switch is off, for tenant 1 and its direct line, when this
     * community or one between is exempt (the shield), and when the check
     * fails (logged, as limits() logs it).
     *
     * @return list<array{tenant_id:int, active:int, max:int, notice_key:string}>
     */
    public static function capsAbove(int $tenantId): array
    {
        if ($tenantId <= 1) {
            return [];
        }

        try {
            if (!(bool) BillingSettings::get('automation_enabled')) {
                return [];
            }

            $caps = [];
            foreach (BillingLock::lineNearestFirst($tenantId) as $id) {
                if ($id <= 1) {
                    continue;
                }
                $answer = self::answerFor($id);
                if ($answer['exempt']) {
                    break;
                }
                if ($id !== $tenantId && $answer['cap'] !== null && $answer['notice_key'] !== null) {
                    $caps[] = $answer['cap'] + ['notice_key' => $answer['notice_key']];
                }
            }

            return $caps;
        } catch (\Throwable $e) {
            Log::error('[JoiningGate] could not read the member limits above a community', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);

            return [];
        }
    }

    /**
     * What a community below must have recorded (`joining_closed_notice_key`)
     * for this community's full member number to shut its door:
     * `<this community's id>|<its present terms key>`, the terms key built
     * exactly as toldUnderPresentTerms() builds it for this community. Null
     * when no member number is watched for it.
     */
    public static function noticeKeyFor(int $tenantId): ?string
    {
        $limit = BillingAutomationService::watchedLimit($tenantId);
        if ($limit === null) {
            return null;
        }

        return self::noticeKey($tenantId, OverLimitRule::for($tenantId), $limit);
    }

    /**
     * The admin-facing message for a shut door. When the community's own plan
     * shut it, it names that plan's member number. When a community above shut
     * it, it names no number: that number belongs to another community's plan.
     *
     * @param array{tenant_id:int, max:int} $closedBy
     */
    public static function adminMessage(array $closedBy, int $forTenantId): string
    {
        if ((int) $closedBy['tenant_id'] !== $forTenantId) {
            return __('api.community_member_limit_reached_above');
        }

        return __('api.community_member_limit_reached', ['max' => (int) $closedBy['max']]);
    }

    /** The would-be member's message. Says nothing about money, plans or limits. */
    public static function memberMessage(): string
    {
        return __('api.community_not_taking_members');
    }

    /**
     * Drop every cached answer, on every server: the next question is answered
     * from the database. Call after any change to a plan, a hub's terms, a rule,
     * an exemption, a payer or the automatic-checks switch.
     */
    public static function flush(): void
    {
        try {
            Cache::forever(self::GENERATION_KEY, bin2hex(random_bytes(8)));
        } catch (\Throwable $e) {
            self::reportCacheFailure($e);
        }
    }

    /**
     * @internal Tests only: replace each community's cap, to prove a failing
     *           check answers open. Null restores the real check.
     * @param (\Closure(int): ?array{tenant_id:int, active:int, max:int})|null $answer
     */
    public static function swapAnswerForTesting(?\Closure $answer): void
    {
        self::$answerOverride = $answer;
        self::$checkFailureReported = false;
        self::flush();
    }

    /**
     * One community's own answer, ignoring the line. Cached; a cache that is
     * down is read through, never fatal.
     *
     * `notice_key` is the key a community below must hold to be shut by this
     * one (null when it has no cap); `told_of_above` is this community's own
     * `joining_closed_notice_key`.
     *
     * @return array{exempt:bool, cap:array{tenant_id:int, active:int, max:int}|null, notice_key:?string, told_of_above:?string}
     */
    private static function answerFor(int $tenantId): array
    {
        if (self::$answerOverride !== null) {
            return ['exempt' => false, 'cap' => (self::$answerOverride)($tenantId), 'notice_key' => null, 'told_of_above' => null];
        }

        try {
            $generation = Cache::get(self::GENERATION_KEY);
            if (!is_string($generation) || $generation === '') {
                $generation = bin2hex(random_bytes(8));
                Cache::forever(self::GENERATION_KEY, $generation);
            }
            $key = self::CACHE_PREFIX . $generation . ':' . $tenantId;
            $cached = Cache::get($key);
        } catch (\Throwable $e) {
            self::reportCacheFailure($e);

            return self::compute($tenantId);
        }

        // An answer cached before a field existed is computed again.
        if (
            is_array($cached)
            && array_key_exists('exempt', $cached)
            && array_key_exists('cap', $cached)
            && array_key_exists('notice_key', $cached)
            && array_key_exists('told_of_above', $cached)
        ) {
            return $cached;
        }

        $answer = self::compute($tenantId);

        try {
            Cache::put($key, $answer, self::CACHE_TTL);
        } catch (\Throwable $e) {
            self::reportCacheFailure($e);
        }

        return $answer;
    }

    /**
     * @return array{exempt:bool, cap:array{tenant_id:int, active:int, max:int}|null, notice_key:?string, told_of_above:?string}
     */
    private static function compute(int $tenantId): array
    {
        if (BillingStandingService::get($tenantId)['exempt']) {
            return ['exempt' => true, 'cap' => null, 'notice_key' => null, 'told_of_above' => null];
        }

        $toldOfAbove = DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->value('joining_closed_notice_key');
        $toldOfAbove = is_string($toldOfAbove) && $toldOfAbove !== '' ? $toldOfAbove : null;
        $open = ['exempt' => false, 'cap' => null, 'notice_key' => null, 'told_of_above' => $toldOfAbove];

        $rule = OverLimitRule::for($tenantId);
        if ($rule['effective_action'] !== 'block_joining') {
            return $open;
        }

        // The same definition of "a limit is watched" the daily check uses.
        $limit = BillingAutomationService::watchedLimit($tenantId);
        if ($limit === null) {
            return $open;
        }

        // Warning first (DESIGN 6.4): the door shuts only once its admins
        // have been told, under the terms in force now, that it is at or
        // over its number.
        if (!self::toldUnderPresentTerms($tenantId, $rule, $limit)) {
            return $open;
        }

        return [
            'exempt' => false,
            'cap' => [
                'tenant_id' => $tenantId,
                'active' => TenantBillingService::getSubtreeActiveMemberCount($tenantId),
                'max' => (int) $limit['max_users'],
            ],
            'notice_key' => self::noticeKey($tenantId, $rule, $limit),
            'told_of_above' => $toldOfAbove,
        ];
    }

    /**
     * @param array{action?:string, effective_action:string, grace_days:int} $rule
     * @param array{plan_id:int, plan_name:string, max_users:int} $limit
     */
    private static function noticeKey(int $tenantId, array $rule, array $limit): string
    {
        return $tenantId . '|' . self::presentTermsKey($tenantId, $rule, $limit);
    }

    /**
     * The terms key the community is told under, built once for the door
     * and for the notice to the communities below (noticeKey()).
     *
     * @param array{action?:string, effective_action:string, grace_days:int} $rule
     * @param array{plan_id:int, plan_name:string, max_users:int} $limit
     */
    private static function presentTermsKey(int $tenantId, array $rule, array $limit): string
    {
        return OverLimitRule::termsKey($tenantId, $limit, $rule);
    }

    /**
     * Whether the daily check has told this community, under the terms in
     * force now, that it is at (`reached`) or over (`over`) its member
     * number: the terms key it recorded is the one it would build today
     * (the same OverLimitRule::termsKey(), so a changed rule, day count,
     * plan or member number, or a hub's change to it, all read as "not told
     * yet"), and the notice was really sent (`limit_notice_at`; the check
     * records `reached` and `over` for this rule only once the mailer
     * accepted them). Switching the checks on empties the stage, so nobody
     * is shut before the first run has told them.
     *
     * @param array{action:string, effective_action:string, grace_days:int} $rule
     * @param array{plan_id:int, plan_name:string, max_users:int} $limit
     */
    private static function toldUnderPresentTerms(int $tenantId, array $rule, array $limit): bool
    {
        $row = DB::table('tenant_billing_standing')
            ->where('tenant_id', $tenantId)
            ->first(['limit_terms_key', 'limit_notice_stage', 'limit_notice_at']);

        if ($row === null || $row->limit_notice_at === null || !in_array($row->limit_notice_stage, ['reached', 'over'], true)) {
            return false;
        }

        return $row->limit_terms_key === self::presentTermsKey($tenantId, $rule, $limit);
    }

    private static function reportCacheFailure(\Throwable $e): void
    {
        if (self::$cacheFailureReported) {
            return;
        }

        self::$cacheFailureReported = true;
        Log::error('[JoiningGate] cache unavailable; reading the member limit from the database', [
            'error' => $e->getMessage(),
        ]);
    }
}
