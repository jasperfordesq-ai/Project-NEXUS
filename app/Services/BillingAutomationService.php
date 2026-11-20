<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Support\Billing\BillingSettings;
use App\Support\Billing\StandardPlans;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The daily billing check (`billing:apply-standing`, 08:00).
 *
 * Two clocks per community:
 *
 * - Payment: for a community with a paid-until date, not exempt, not
 *   `not_billed`, not the platform's own. A reminder before the date, "due"
 *   the day after it, a final warning, then an automatic pause for
 *   non-payment. Each stage is sent once per paid-until date
 *   (`last_notice_stage`); a missed day sends only the highest stage due.
 * - Member limit: for a community on a STANDARD package with a member limit,
 *   not exempt. Active members (signed in within 90 days, the whole branch)
 *   against the limit: approaching, reached, over. Going over only warns,
 *   unless the platform team chose "pause after N days over"; a community
 *   paused for that is opened again when it is back under, on a bigger
 *   package, or no longer has a limit.
 *
 * `run()` acts only while the master switch (`automation_enabled`) is on, and
 * otherwise does nothing at all. `preview()` never acts and never sends: it is
 * the "what would happen today" list the platform team reads before turning
 * the switch on. Both take "today" as an argument, so the result for a given
 * day does not depend on when the job happens to run.
 *
 * Safe to run twice in a day: every notice and every pause is recorded before
 * the next run looks.
 */
final class BillingAutomationService
{
    private const PAYMENT_STAGES = ['reminder' => 1, 'due' => 2, 'final_warning' => 3, 'suspend' => 4];

    private const LIMIT_STAGES = ['approaching' => 1, 'reached' => 2, 'over' => 3];

    /**
     * Apply the check for "today". Returns what was done.
     *
     * @return list<array{tenant_id:int, tenant_name:string, clock:string, action:string, detail:array<string, mixed>}>
     */
    public static function run(?CarbonInterface $today = null): array
    {
        if (!BillingSettings::get('automation_enabled')) {
            return [];
        }

        return self::evaluate(self::day($today), true);
    }

    /**
     * What `run()` would do today, without doing any of it.
     *
     * @return list<array{tenant_id:int, tenant_name:string, clock:string, action:string, detail:array<string, mixed>}>
     */
    public static function preview(?CarbonInterface $today = null): array
    {
        return self::evaluate(self::day($today), false);
    }

    private static function day(?CarbonInterface $today): CarbonImmutable
    {
        return CarbonImmutable::parse(($today ?? now())->toDateString());
    }

    /**
     * @return list<array{tenant_id:int, tenant_name:string, clock:string, action:string, detail:array<string, mixed>}>
     */
    private static function evaluate(CarbonImmutable $today, bool $act): array
    {
        $settings = BillingSettings::all();
        $standing = [];
        foreach (DB::table('tenant_billing_standing')->get() as $row) {
            $standing[(int) $row->tenant_id] = $row;
        }

        $limits = self::limitedCommunities();

        // Every community either clock may touch: one with a paid-until date,
        // one with a member limit, and one paused for being over a limit that
        // may no longer apply.
        $ids = array_keys($limits);
        foreach ($standing as $id => $row) {
            if ($row->paid_until !== null || ($row->suspended_at !== null && $row->suspension_reason === 'over_limit')) {
                $ids[] = $id;
            }
        }
        $ids = array_values(array_unique(array_filter($ids, static fn (int $id): bool => $id !== 1)));
        sort($ids);

        if ($ids === []) {
            return [];
        }

        $tenants = DB::table('tenants')->whereIn('id', $ids)->get(['id', 'name', 'is_active'])->keyBy('id');

        $outcome = [];
        foreach ($ids as $id) {
            $tenant = $tenants->get($id);
            // A deactivated community is off for everyone already; there is
            // nobody to warn and nothing to pause.
            if (!$tenant || (int) $tenant->is_active !== 1) {
                continue;
            }

            try {
                $row = $standing[$id] ?? null;
                foreach (self::paymentClock($id, (string) $tenant->name, $row, $settings, $today, $act) as $entry) {
                    $outcome[] = $entry;
                }

                if ($act) {
                    $row = DB::table('tenant_billing_standing')->where('tenant_id', $id)->first();
                }

                foreach (self::limitClock($id, (string) $tenant->name, $row, $limits[$id] ?? null, $settings, $today, $act) as $entry) {
                    $outcome[] = $entry;
                }
            } catch (\Throwable $e) {
                // One broken community must not stop the check for the rest.
                Log::error('[BillingAutomation] the daily check failed for a community', [
                    'tenant_id' => $id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $outcome;
    }

    /**
     * @param array<string, int|bool|string> $settings
     * @return list<array{tenant_id:int, tenant_name:string, clock:string, action:string, detail:array<string, mixed>}>
     */
    private static function paymentClock(int $id, string $name, ?object $row, array $settings, CarbonImmutable $today, bool $act): array
    {
        if ($row === null || $row->paid_until === null || !empty($row->exempt)) {
            return [];
        }

        $payer = $row->payer ?? BillingStandingService::defaultPayer($id);
        if ($payer === 'not_billed') {
            return [];
        }

        $stage = self::paymentStage($row, $settings, $today);
        $recorded = self::PAYMENT_STAGES[(string) $row->last_notice_stage] ?? 0;
        if ($stage === null || self::PAYMENT_STAGES[$stage] <= $recorded) {
            return [];
        }

        $paidUntil = CarbonImmutable::parse(substr((string) $row->paid_until, 0, 10));
        $facts = [
            'paid_until' => $paidUntil->toDateString(),
            'days_late' => max(0, (int) $paidUntil->diffInDays($today, false)),
            'pause_date' => $paidUntil->addDays((int) $settings['suspend_days_late'])->toDateString(),
        ];

        $alreadyPaused = $row->suspended_at !== null;

        if ($act) {
            // Recorded first: a notice is sent once even if the mail fails.
            BillingStandingService::recordCheckState($id, ['last_notice_stage' => $stage, 'last_notice_at' => now()]);
        }

        if ($stage === 'suspend' && $alreadyPaused) {
            // Paused already, for whatever reason: never paused twice, and
            // nobody is told it again. The stage is still recorded, so a
            // person who lifts that pause is not overruled next morning.
            return [];
        }

        if ($act) {
            if ($stage === 'suspend') {
                self::pause($id, 'non_payment', $facts);
            } else {
                self::tell(fn () => match ($stage) {
                    'reminder' => BillingStandingNotifier::paymentReminder($id, $facts),
                    'due' => BillingStandingNotifier::paymentDue($id, $facts),
                    default => BillingStandingNotifier::paymentFinalWarning($id, $facts),
                }, $id);
            }
        }

        return [self::entry($id, $name, 'payment', $stage, $facts)];
    }

    /**
     * The highest payment stage that applies today, or null.
     *
     * @param array<string, int|bool|string> $settings
     */
    private static function paymentStage(object $row, array $settings, CarbonImmutable $today): ?string
    {
        $paidUntil = CarbonImmutable::parse(substr((string) $row->paid_until, 0, 10));
        $daysLate = (int) $paidUntil->diffInDays($today, false);

        if ($daysLate >= (int) $settings['suspend_days_late']) {
            return 'suspend';
        }
        if ($daysLate >= (int) $settings['final_warning_days_late']) {
            return 'final_warning';
        }
        if ($daysLate >= 1) {
            return 'due';
        }

        // 0 means "no reminder", not "a reminder on the last paid day".
        $before = (int) $settings['reminder_days_before'];
        if ($before > 0 && -$daysLate <= $before) {
            return 'reminder';
        }

        return null;
    }

    /**
     * @param array{plan_name:string, max_users:int}|null $limit
     * @param array<string, int|bool|string> $settings
     * @return list<array{tenant_id:int, tenant_name:string, clock:string, action:string, detail:array<string, mixed>}>
     */
    private static function limitClock(int $id, string $name, ?object $row, ?array $limit, array $settings, CarbonImmutable $today, bool $act): array
    {
        if ($row !== null && !empty($row->exempt)) {
            return [];
        }

        $pausedForLimit = $row !== null
            && $row->suspended_at !== null
            && $row->suspension_reason === 'over_limit';

        if ($limit === null) {
            // No limit applies any more (no plan, or not a standard one).
            if ($pausedForLimit) {
                return self::lift($id, $name, $row, $today, $act, ['reason' => 'no_limit']);
            }

            return [];
        }

        $active = TenantBillingService::getSubtreeActiveMemberCount($id, StandardPlans::ACTIVE_WINDOW_DAYS);
        $max = $limit['max_users'];
        $percent = (int) floor($active * 100 / $max);

        if ($active > $max) {
            $stage = 'over';
        } elseif ($active >= $max) {
            $stage = 'reached';
        } elseif ($active * 100 >= (int) $settings['limit_warning_percent'] * $max) {
            $stage = 'approaching';
        } else {
            $stage = null;
        }

        $facts = [
            'active_members' => $active,
            'max_users' => $max,
            'percent' => $percent,
            'plan_name' => $limit['plan_name'],
            'window_days' => StandardPlans::ACTIVE_WINDOW_DAYS,
            'stage' => $stage,
        ];

        if ($stage !== 'over' && $pausedForLimit) {
            return self::lift($id, $name, $row, $today, $act, $facts);
        }

        $recordedStage = $row?->limit_notice_stage;
        $recorded = self::LIMIT_STAGES[(string) $recordedStage] ?? 0;
        $current = $stage === null ? 0 : self::LIMIT_STAGES[$stage];

        $overSince = $row?->over_limit_since !== null ? CarbonImmutable::parse(substr((string) $row->over_limit_since, 0, 10)) : null;
        if ($stage === 'over' && $overSince === null) {
            $overSince = $today;
        }

        $pauses = $settings['over_limit_action'] === 'pause';
        $pauseOn = ($stage === 'over' && $pauses && $overSince !== null)
            ? $overSince->addDays((int) $settings['over_limit_grace_days'])
            : null;
        if ($pauseOn !== null) {
            $facts['pause_date'] = $pauseOn->toDateString();
        }
        if ($overSince !== null) {
            $facts['over_limit_since'] = $overSince->toDateString();
        }

        $out = [];

        if ($act) {
            $state = [];
            if ($stage === 'over' && $row?->over_limit_since === null) {
                $state['over_limit_since'] = $today->toDateString();
            }
            if ($stage !== 'over' && $row?->over_limit_since !== null) {
                $state['over_limit_since'] = null;
            }
            if ($current !== $recorded) {
                // Up: a notice is due. Down: the stage that still applies, so
                // rising again tells people again.
                $state['limit_notice_stage'] = $stage;
                if ($current > $recorded) {
                    $state['limit_notice_at'] = now();
                }
            }
            BillingStandingService::recordCheckState($id, $state);
        }

        if ($stage !== null && $current > $recorded) {
            if ($act) {
                self::tell(fn () => match ($stage) {
                    'approaching' => BillingStandingNotifier::limitApproaching($id, $facts),
                    'reached' => BillingStandingNotifier::limitReached($id, $facts),
                    default => BillingStandingNotifier::limitOver($id, $facts),
                }, $id);
            }
            $out[] = self::entry($id, $name, 'member_limit', $stage, $facts);
        }

        $isPaused = $row !== null && $row->suspended_at !== null;
        if ($pauseOn !== null && !$isPaused && $today->greaterThanOrEqualTo($pauseOn)) {
            if ($act) {
                self::pause($id, 'over_limit', $facts);
            }
            $out[] = self::entry($id, $name, 'member_limit', 'suspend', $facts);
        }

        return $out;
    }

    /**
     * Open a community paused for being over its limit, now that it is not.
     *
     * Unless its payment is late enough to be paused for that instead: then
     * it stays paused, and the pause is recorded as for non-payment, so that
     * paying up is what opens it.
     *
     * @param array<string, mixed> $facts
     * @return list<array{tenant_id:int, tenant_name:string, clock:string, action:string, detail:array<string, mixed>}>
     */
    private static function lift(int $id, string $name, object $row, CarbonImmutable $today, bool $act, array $facts): array
    {
        $settings = BillingSettings::all();
        $payer = $row->payer ?? BillingStandingService::defaultPayer($id);
        $paymentPause = $row->paid_until !== null
            && $payer !== 'not_billed'
            && self::paymentStage($row, $settings, $today) === 'suspend';

        if ($act) {
            BillingStandingService::recordCheckState($id, ['over_limit_since' => null]);

            if ($paymentPause) {
                // Closed before and after: nobody is told anything new.
                BillingStandingService::restore($id, null, 'Back under the member limit; payment still late');
                BillingStandingService::suspend($id, null, 'auto', 'Payment late', 'non_payment');

                return [];
            }

            BillingStandingService::restore($id, null, 'Back within the member limit');
            if (BillingStandingService::get($id)['locked'] === false) {
                self::tell(fn () => BillingStandingNotifier::restored($id), $id);
            }
        }

        if ($paymentPause) {
            return [];
        }

        return [self::entry($id, $name, 'member_limit', 'restore', $facts)];
    }

    /**
     * Pause and, when that really closed the community, tell its admins and
     * whoever it pays.
     *
     * @param array<string, mixed> $facts
     */
    private static function pause(int $id, string $reason, array $facts): void
    {
        $wasLocked = BillingStandingService::get($id)['locked'];
        BillingStandingService::suspend($id, null, 'auto', null, $reason);

        if (!$wasLocked && BillingStandingService::get($id)['locked']) {
            self::tell(fn () => BillingStandingNotifier::paused($id, true, $facts), $id);
        }
    }

    /**
     * Mail failing must never undo or stop the check: logged, and no further.
     */
    private static function tell(callable $send, int $tenantId): void
    {
        try {
            $send();
        } catch (\Throwable $e) {
            Log::error('[BillingAutomation] a billing notice could not be sent', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Communities on a standard package with a member limit, with that limit.
     *
     * Only standard packages: a community on a retired plan keeps the terms it
     * had, and nobody promised it a limit would be watched.
     *
     * @return array<int, array{plan_name:string, max_users:int}>
     */
    private static function limitedCommunities(): array
    {
        $rows = DB::table('tenant_plan_assignments as tpa')
            ->join('pay_plans as pp', 'pp.id', '=', 'tpa.pay_plan_id')
            ->where('tpa.status', 'active')
            ->where('pp.is_standard', 1)
            ->whereNotNull('pp.max_users')
            ->where('pp.max_users', '>', 0)
            ->orderBy('tpa.id')
            ->get(['tpa.tenant_id', 'pp.name', 'pp.max_users']);

        $limits = [];
        foreach ($rows as $row) {
            // One active assignment per community is the rule; if there are
            // more, the newest wins.
            $limits[(int) $row->tenant_id] = ['plan_name' => (string) $row->name, 'max_users' => (int) $row->max_users];
        }

        return $limits;
    }

    /**
     * @param array<string, mixed> $detail
     * @return array{tenant_id:int, tenant_name:string, clock:string, action:string, detail:array<string, mixed>}
     */
    private static function entry(int $id, string $name, string $clock, string $action, array $detail): array
    {
        return ['tenant_id' => $id, 'tenant_name' => $name, 'clock' => $clock, 'action' => $action, 'detail' => $detail];
    }
}
