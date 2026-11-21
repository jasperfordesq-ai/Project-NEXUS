<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Support\Billing\BillingSettings;
use App\Support\Billing\OverLimitRule;
use App\Support\Billing\PlanTerms;
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
 *   `not_billed`, not the platform's own. Reminders before the date (by
 *   default 30, 14, 7 and 1 days before; each sent once, see reminderStep()),
 *   "due" the day after it, a final warning, then an automatic pause for
 *   non-payment. Each late stage is sent once per paid-until date
 *   (`last_notice_stage`). A run moves at most one stage, with the normal
 *   schedule's spacing between them, so nothing is paused without a final
 *   warning that has stood its time (see paymentStep()). Card payers get no
 *   reminder: their card renews by itself. A card payer is warned but not
 *   paused while Stripe is still retrying its card (owner, 20 Nov 2026): the
 *   pause comes once Stripe has given up (see stripeIsStillRetrying()), or
 *   at the latest `card_retry_max_days_late` days late.
 * - Member limit: for a community on a STANDARD package with a member limit,
 *   not exempt. Active members (signed in within 90 days, the whole branch)
 *   against the limit: approaching, reached, over. A stage is told at most
 *   once a month, and the recorded stage drops only when clearly below its
 *   line, so hovering at a line does not mail people daily. What going over
 *   does is the community's rule (OverLimitRule: its own, its hub's default,
 *   or the platform's; default pause 30 days after the present episode's
 *   "over" notice, never without one). A community paused
 *   for that is opened again when it is back under, on a bigger package, no
 *   longer has a limit, or its rule no longer pauses. Stop new members and
 *   move up are only named in the notices here; later stages carry them out.
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
     * Stripe's subscription statuses that mean "the payment has not arrived
     * but Stripe is still trying to collect it". Every other status, and no
     * status at all, means there is nothing to wait for.
     */
    private const STRIPE_STILL_RETRYING = ['past_due', 'incomplete'];

    /** A member-limit stage is not told again within this many days. */
    private const LIMIT_NOTICE_HOLD_DAYS = 30;

    /** Below this percent a community has clearly left "reached" / "over". */
    private const LIMIT_LEAVE_REACHED_PERCENT = 95;

    /** Points under the warning percent to have clearly left "approaching". */
    private const LIMIT_LEAVE_MARGIN = 5;

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

    /**
     * Where one community stands against its package's member limit, measured
     * exactly as the daily check measures it: active members of the whole
     * branch, the platform's warning percent. For the community's own admin
     * banner, so what they are warned of on screen is what the check would
     * mail them.
     *
     * Null when no limit is watched: no package, an unlimited one, or a
     * retired (non-standard) one.
     *
     * `rule` is what will happen when it goes over: the rule the check
     * follows for it (OverLimitRule effective action) while the automatic
     * checks are on, and `none` while they are off, because then nothing
     * will happen and the banner must not say it will. `acts_on` is the day
     * it would pause it (limitActsOn()).
     *
     * @return array{used:int, max:int, percent:int, stage:?string, rule:string, acts_on:?string}|null
     */
    public static function memberLimitState(int $tenantId): ?array
    {
        $limit = self::limitedCommunities($tenantId)[$tenantId] ?? null;
        if ($limit === null) {
            return null;
        }

        $active = TenantBillingService::getSubtreeActiveMemberCount($tenantId, StandardPlans::ACTIVE_WINDOW_DAYS);
        $max = $limit['max_users'];
        $rule = OverLimitRule::for($tenantId);

        return [
            'used' => $active,
            'max' => $max,
            'percent' => (int) floor($active * 100 / $max),
            'stage' => self::limitStage($active, $max, (int) BillingSettings::get('limit_warning_percent')),
            'rule' => BillingSettings::get('automation_enabled') ? $rule['effective_action'] : 'none',
            'acts_on' => self::limitActsOn($tenantId, $rule, $active),
        ];
    }

    /**
     * Whole days a community's payment is late, counted as the payment clock
     * counts them (1 = the day after the paid-until date). Null when it is
     * not late, or when the clock does not run for it at all — no date,
     * exempt, not billed, the platform's own community — so the admin banner
     * never warns of a pause that cannot come.
     */
    public static function overdueDays(int $tenantId, ?CarbonInterface $today = null): ?int
    {
        if ($tenantId === 1) {
            return null;
        }

        $row = DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->first();
        if ($row === null || $row->paid_until === null || !empty($row->exempt)) {
            return null;
        }

        $payer = $row->payer ?? BillingStandingService::defaultPayer($tenantId);
        if ($payer === 'not_billed') {
            return null;
        }

        $paidUntil = CarbonImmutable::parse(substr((string) $row->paid_until, 0, 10));
        $daysLate = (int) $paidUntil->diffInDays(self::day($today), false);

        return $daysLate >= 1 ? $daysLate : null;
    }

    /**
     * The earliest day the payment clock could pause a community for
     * non-payment: the paid-until date plus `suspend_days_late`. For Billing
     * control, beside the paid-until date.
     *
     * It is the earliest, not a promise: a community the check has not yet
     * warned is paused later (a run moves one stage at a time), and a card
     * payer Stripe is still retrying may be waited for. Null when no
     * automatic pause can come: the checks are switched off, no date, not
     * billed, exempt, or already paused. Never a day already gone: a
     * community long overdue that the check has not paused yet cannot be
     * paused before today.
     *
     * Pure: reads only the platform's settings.
     */
    public static function earliestPauseDate(?string $paidUntil, string $payer, bool $exempt, bool $suspended, ?CarbonInterface $today = null): ?string
    {
        if ($paidUntil === null || trim($paidUntil) === '' || $payer === 'not_billed' || $exempt || $suspended) {
            return null;
        }

        // While the daily check is off nothing is paused automatically, so
        // naming a day would promise a pause that will not come.
        if (!BillingSettings::get('automation_enabled')) {
            return null;
        }

        $byDate = CarbonImmutable::parse(substr($paidUntil, 0, 10))
            ->addDays((int) BillingSettings::get('suspend_days_late'));

        return self::later($byDate, self::day($today))->toDateString();
    }

    /**
     * The day the daily check would pause a community for being over its
     * member number, under the present state: its rule pauses, it is over a
     * watched limit now, and its days (counted from the day this episode's
     * "over" notice was sent, or today when none is on record yet) run out
     * on that day. Never a day already gone.
     *
     * The earliest, not a promise, like earliestPauseDate(): a community the
     * check has not yet told it is over is told first and paused later. Null
     * when no such pause can come: the rule does not pause, the checks are
     * switched off, no watched limit, not over, exempt, or already paused.
     *
     * @param array{effective_action:string, grace_days:int} $rule OverLimitRule::for()
     * @param int|null $active the community's active members, when the caller has counted them
     */
    public static function limitActsOn(int $tenantId, array $rule, ?int $active = null, ?CarbonInterface $today = null): ?string
    {
        if ($rule['effective_action'] !== 'pause' || !BillingSettings::get('automation_enabled')) {
            return null;
        }

        $limit = self::limitedCommunities($tenantId)[$tenantId] ?? null;
        if ($limit === null) {
            return null;
        }

        $active ??= TenantBillingService::getSubtreeActiveMemberCount($tenantId, StandardPlans::ACTIVE_WINDOW_DAYS);
        // Not over (a kept episode at or just under the member number
        // included): no date, since nothing happens unless it goes back over.
        if ($active <= $limit['max_users']) {
            return null;
        }

        $row = DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->first(['exempt', 'suspended_at', 'over_limit_since', 'limit_notice_stage', 'limit_notice_at', 'limit_terms_key']);
        if ($row !== null && (!empty($row->exempt) || $row->suspended_at !== null)) {
            return null;
        }

        // Counted from this episode's "over" notice, as the check counts it.
        // Terms changed since the count began: the next check starts the
        // count again today, so nothing on record counts. No notice on record
        // for this episode: it goes out at the next check, so today.
        $day = self::day($today);
        $restartPending = ($row?->limit_terms_key ?? null) !== OverLimitRule::termsKey($tenantId, $limit, $rule);
        $warnedOn = $restartPending ? null : self::episodeOverNoticeDay($row);

        return self::later(($warnedOn ?? $day)->addDays((int) $rule['grace_days']), $day)->toDateString();
    }

    /** `approaching` from the warning percent, `reached` at 100%, `over` above it; else null. */
    private static function limitStage(int $active, int $max, int $warningPercent): ?string
    {
        if ($active > $max) {
            return 'over';
        }
        if ($active >= $max) {
            return 'reached';
        }
        if ($active * 100 >= $warningPercent * $max) {
            return 'approaching';
        }

        return null;
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
        // one with a member limit, one paused for being over a limit that may
        // no longer apply, and one with a member-limit count on record that
        // no limit backs any more (it is cleared: no limit, no count).
        $ids = array_keys($limits);
        foreach ($standing as $id => $row) {
            if (
                $row->paid_until !== null
                || ($row->suspended_at !== null && $row->suspension_reason === 'over_limit')
                || $row->over_limit_since !== null
                || $row->limit_notice_stage !== null
                || $row->limit_notice_at !== null
                || ($row->limit_terms_key ?? null) !== null
            ) {
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
                $paymentRecorded = null;
                foreach (self::paymentClock($id, (string) $tenant->name, $row, $settings, $today, $act, $paymentRecorded) as $entry) {
                    $outcome[] = $entry;
                }

                if ($act) {
                    $row = DB::table('tenant_billing_standing')->where('tenant_id', $id)->first();
                } elseif ($row !== null && $paymentRecorded !== null) {
                    // The preview records nothing; the member-limit clock
                    // must still see what the run would have recorded.
                    $row = clone $row;
                    $row->last_notice_stage = $paymentRecorded;
                    $row->last_notice_at = self::stamp($today);
                    if ($paymentRecorded === 'suspend' && $row->suspended_at === null) {
                        // The run pauses it for non-payment here, and the
                        // member-limit clock then leaves it alone.
                        $row->suspended_at = self::stamp($today);
                        $row->suspension_reason = 'non_payment';
                    }
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
     * `$recordedStage` is set to the stage this run records (or would
     * record, in a preview), so the member-limit clock after it sees the same
     * state in a preview as in a run.
     *
     * @param array<string, int|bool|string> $settings
     * @return list<array{tenant_id:int, tenant_name:string, clock:string, action:string, detail:array<string, mixed>}>
     */
    private static function paymentClock(int $id, string $name, ?object $row, array $settings, CarbonImmutable $today, bool $act, ?string &$recordedStage = null): array
    {
        if ($row === null || $row->paid_until === null || !empty($row->exempt)) {
            return [];
        }

        $payer = $row->payer ?? BillingStandingService::defaultPayer($id);
        if ($payer === 'not_billed') {
            return [];
        }

        $recordedRank = self::PAYMENT_STAGES[(string) $row->last_notice_stage] ?? 0;
        if ($recordedRank > 0 && self::noticeDay($row->last_notice_at) === null) {
            // A stage with no date (written by hand): the waiting starts
            // today, so the next stage is never sent without its gap.
            if ($act) {
                BillingStandingService::recordCheckState($id, ['last_notice_at' => self::stamp($today)]);
            }

            return [];
        }

        $step = self::paymentStep($row, (string) $payer, $settings, $today);
        if ($step === null) {
            return [];
        }
        $stage = $step['stage'];

        $paidUntil = CarbonImmutable::parse(substr((string) $row->paid_until, 0, 10));
        $facts = [
            'paid_until' => $paidUntil->toDateString(),
            'days_late' => max(0, (int) $paidUntil->diffInDays($today, false)),
            'pause_date' => self::pauseDate($stage, $paidUntil, $settings, $today)->toDateString(),
        ];
        if ($stage === 'reminder') {
            $facts['days_before'] = (int) self::reminderDay($paidUntil, $settings, $today);
            $facts['days_left'] = -(int) $paidUntil->diffInDays($today, false);
        }

        $longestWait = (int) $settings['card_retry_max_days_late'];
        if (
            $stage === 'suspend'
            && !$step['silent']
            && $payer === 'platform_card'
            && $facts['days_late'] < $longestWait
            && self::stripeIsStillRetrying($id)
        ) {
            // Owner, 20 November 2026: a card payer is not paused while
            // Stripe is still retrying its card. Nothing is recorded and
            // nobody is told; the entry is in the list so the platform team
            // can see who is being waited for, and can pause by hand. The
            // pause comes on the first run after Stripe gives up, and at the
            // latest once the payment is `card_retry_max_days_late` days
            // late, whatever Stripe says: Stripe's retry schedule is set in
            // Stripe, and the platform must not wait on it for ever.
            $facts['pause_date'] = $paidUntil->addDays($longestWait)->toDateString();

            return [self::entry($id, $name, 'payment', 'waiting_for_stripe', $facts)];
        }

        $recordedStage = $stage;
        if ($act) {
            // Recorded first: a notice is sent once even if the mail fails.
            BillingStandingService::recordCheckState($id, ['last_notice_stage' => $stage, 'last_notice_at' => self::stamp($today)]);
        }

        if ($step['silent']) {
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
     * Whether Stripe is still trying to collect a card payer's payment.
     *
     * Read from what Stripe last told us about the community's subscription
     * (`tenant_plan_assignments.stripe_status`, kept word for word by the
     * webhook handlers). `past_due` and `incomplete` mean retries are still
     * running. `unpaid`, `canceled`, `incomplete_expired` and `paused` mean
     * Stripe has stopped. No subscription, or a status never received, is
     * not waited for: there is no sign that anything is being retried.
     *
     * A failed lookup is not swallowed here: evaluate() logs it and skips
     * this community for today, so an error never turns into a pause.
     */
    private static function stripeIsStillRetrying(int $tenantId): bool
    {
        $status = DB::table('tenant_plan_assignments')
            ->where('tenant_id', $tenantId)
            ->whereNotNull('stripe_subscription_id')
            ->orderByDesc('id')
            ->value('stripe_status');

        return in_array($status, self::STRIPE_STILL_RETRYING, true);
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

        return self::reminderDay($paidUntil, $settings, $today) !== null ? 'reminder' : null;
    }

    /**
     * The reminder day (days before the paid-until date) that applies today:
     * of the reminders whose date (paid-until − days) has come, the latest.
     * Null while none has come, once the date has passed, and when the
     * platform team chose no reminders.
     *
     * @param array<string, int|bool|string> $settings
     */
    private static function reminderDay(CarbonImmutable $paidUntil, array $settings, CarbonImmutable $today): ?int
    {
        $daysLeft = -(int) $paidUntil->diffInDays($today, false);
        if ($daysLeft < 0) {
            return null;
        }

        $applies = null;
        foreach (self::reminderDays($settings) as $days) {
            if ($days >= $daysLeft && ($applies === null || $days < $applies)) {
                $applies = $days;
            }
        }

        return $applies;
    }

    /**
     * The reminder days from this run's copy of the settings, so the preview
     * and the run read one set of numbers.
     *
     * @param array<string, int|bool|string> $settings
     * @return list<int>
     */
    private static function reminderDays(array $settings): array
    {
        $value = (string) ($settings['reminder_days'] ?? '');
        if ($value === '') {
            return [];
        }

        return array_map('intval', explode(',', $value));
    }

    /**
     * The one payment stage this run takes, or null.
     *
     * Never more than one stage beyond the one recorded, and never sooner
     * than the normal schedule spaces them: the final warning comes
     * `final_warning_days_late` − 1 days after "now due" (due is normally the
     * first late day), the pause `suspend_days_late` − `final_warning_days_late`
     * days after the final warning. So a community long overdue, or one the
     * check meets for the first time, is told before it is paused, and a
     * community followed day by day gets exactly the design's days.
     *
     * The reminder is skipped once the date has passed, and always for a
     * card payer: its card renews by itself, and Stripe moves the date.
     *
     * A community already paused that is late enough to be paused records
     * the pause stage silently: it is closed already, and a person who lifts
     * that pause is not overruled next morning.
     *
     * @param array<string, int|bool|string> $settings
     * @return array{stage:string, silent:bool}|null
     */
    private static function paymentStep(object $row, string $payer, array $settings, CarbonImmutable $today): ?array
    {
        $byDate = self::paymentStage($row, $settings, $today);
        if ($byDate === null) {
            return null;
        }

        $dateRank = self::PAYMENT_STAGES[$byDate];
        $recorded = self::PAYMENT_STAGES[(string) $row->last_notice_stage] ?? 0;

        if ($byDate === 'reminder') {
            return self::reminderStep($row, $payer, $recorded, $settings, $today);
        }

        if ($dateRank <= $recorded) {
            return null;
        }

        if ($row->suspended_at !== null && $byDate === 'suspend') {
            return ['stage' => 'suspend', 'silent' => true];
        }

        $next = $recorded + 1;
        if ($next === self::PAYMENT_STAGES['reminder'] && ($dateRank > $next || $payer === 'platform_card')) {
            if ($dateRank === $next) {
                return null;
            }
            $next = self::PAYMENT_STAGES['due'];
        }

        if ($next >= self::PAYMENT_STAGES['final_warning']) {
            $since = self::noticeDay($row->last_notice_at);
            [$toFinal, $toPause] = self::gaps($settings);
            $gap = $next === self::PAYMENT_STAGES['final_warning'] ? $toFinal : $toPause;
            if ($since === null || $since->addDays($gap)->greaterThan($today)) {
                return null;
            }
        }

        $names = array_flip(self::PAYMENT_STAGES);

        return ['stage' => $names[$next], 'silent' => false];
    }

    /**
     * Whether today's reminder is sent: when nothing is recorded for this
     * paid-until date, or the last reminder went out before today's
     * reminder's date. So each reminder goes once, and a run after missed
     * days sends only the latest one that has come, never a burst. Never for
     * a card payer, never once a later stage is recorded.
     *
     * A date that has just been set carries the day it was set
     * (`last_notice_at` with no stage, see setPaidUntil()): a reminder whose
     * day had already gone by then is not sent after the fact. Without that,
     * a community paying month by month got "payment is due soon" the
     * morning after it paid.
     *
     * @param array<string, int|bool|string> $settings
     * @return array{stage:string, silent:bool}|null
     */
    private static function reminderStep(object $row, string $payer, int $recorded, array $settings, CarbonImmutable $today): ?array
    {
        if ($payer === 'platform_card' || $recorded > self::PAYMENT_STAGES['reminder']) {
            return null;
        }

        $sentOn = self::noticeDay($row->last_notice_at);
        if ($recorded === self::PAYMENT_STAGES['reminder'] || $sentOn !== null) {
            $paidUntil = CarbonImmutable::parse(substr((string) $row->paid_until, 0, 10));
            $days = self::reminderDay($paidUntil, $settings, $today);
            if ($days === null || $sentOn === null || !$sentOn->lessThan($paidUntil->subDays($days))) {
                return null;
            }
        }

        return ['stage' => 'reminder', 'silent' => false];
    }

    /**
     * Days from "now due" to the final warning, and from the final warning to
     * the pause, as the normal schedule spaces them. At least one day each.
     *
     * @param array<string, int|bool|string> $settings
     * @return array{0:int, 1:int}
     */
    private static function gaps(array $settings): array
    {
        $final = (int) $settings['final_warning_days_late'];
        $suspend = (int) $settings['suspend_days_late'];

        return [max(1, $final - 1), max(1, $suspend - $final)];
    }

    /**
     * The earliest day the pause can come once this stage is sent, so a
     * notice never names a pause date already gone.
     *
     * @param array<string, int|bool|string> $settings
     */
    private static function pauseDate(string $stage, CarbonImmutable $paidUntil, array $settings, CarbonImmutable $today): CarbonImmutable
    {
        if ($stage === 'suspend') {
            return $today;
        }

        [$toFinal, $toPause] = self::gaps($settings);

        if ($stage === 'final_warning') {
            $finalOn = $today;
        } else {
            $dueOn = $stage === 'due' ? $today : $paidUntil->addDay();
            $finalOn = self::later($paidUntil->addDays((int) $settings['final_warning_days_late']), $dueOn->addDays($toFinal));
        }

        return self::later($paidUntil->addDays((int) $settings['suspend_days_late']), $finalOn->addDays($toPause));
    }

    private static function later(CarbonImmutable $a, CarbonImmutable $b): CarbonImmutable
    {
        return $a->greaterThan($b) ? $a : $b;
    }

    /**
     * When a notice is recorded: the check's "today" at the wall clock's
     * time, so the gaps between stages count the check's days.
     */
    private static function stamp(CarbonImmutable $today): string
    {
        return $today->toDateString() . ' ' . now()->format('H:i:s');
    }

    private static function noticeDay(mixed $value): ?CarbonImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }

        return CarbonImmutable::parse(substr((string) $value, 0, 10));
    }

    /**
     * @param array{plan_id:int, plan_name:string, max_users:int}|null $limit
     * @param array<string, int|bool|string> $settings
     * @return list<array{tenant_id:int, tenant_name:string, clock:string, action:string, detail:array<string, mixed>}>
     */
    private static function limitClock(int $id, string $name, ?object $row, ?array $limit, array $settings, CarbonImmutable $today, bool $act): array
    {
        if ($row !== null && !empty($row->exempt)) {
            // Nothing is counted while exempt, and nothing counted before it
            // survives it: taking the exemption off always starts afresh.
            $kept = $row->over_limit_since !== null || $row->limit_notice_stage !== null
                || $row->limit_notice_at !== null || ($row->limit_terms_key ?? null) !== null;
            if ($act && $kept) {
                BillingStandingService::recordCheckState($id, [
                    'over_limit_since' => null,
                    'limit_notice_stage' => null,
                    'limit_notice_at' => null,
                    'limit_terms_key' => null,
                ]);
            }

            return [];
        }

        $pausedForLimit = $row !== null
            && $row->suspended_at !== null
            && $row->suspension_reason === 'over_limit';

        // Paused for something else (not paying, or a person's pause): the
        // clock does not run and keeps nothing. A count kept silently here
        // would let the morning after the restore pause the community for
        // being over, with no warning ever sent. Restored, it starts afresh:
        // today the first day over, the "over" notice, the full days to go.
        if ($row !== null && $row->suspended_at !== null && !$pausedForLimit) {
            $kept = $row->over_limit_since !== null || $row->limit_notice_stage !== null
                || $row->limit_notice_at !== null;
            if ($act && $kept) {
                BillingStandingService::recordCheckState($id, [
                    'over_limit_since' => null,
                    'limit_notice_stage' => null,
                    'limit_notice_at' => null,
                ]);
            }

            return [];
        }

        if ($limit === null) {
            // No limit applies any more (no plan, or not a standard one), so
            // no count survives it: a plan with a member number later starts
            // a fresh episode, with its own notice and its full days.
            $kept = $row !== null && ($row->over_limit_since !== null || $row->limit_notice_stage !== null
                || $row->limit_notice_at !== null || ($row->limit_terms_key ?? null) !== null);
            if ($act && $kept) {
                BillingStandingService::recordCheckState($id, [
                    'over_limit_since' => null,
                    'limit_notice_stage' => null,
                    'limit_notice_at' => null,
                    'limit_terms_key' => null,
                ]);
            }

            if ($pausedForLimit) {
                return self::lift($id, $name, $row, $today, $act, ['reason' => 'no_limit']);
            }

            return [];
        }

        $active = TenantBillingService::getSubtreeActiveMemberCount($id, StandardPlans::ACTIVE_WINDOW_DAYS);
        $max = $limit['max_users'];
        $percent = (int) floor($active * 100 / $max);
        $stage = self::limitStage($active, $max, (int) $settings['limit_warning_percent']);

        // The community's rule: its own, its hub's default, or the platform's.
        // `rule` is what the check does; `rule_action` what was chosen, so the
        // notice can tell "warn only" from "move up, but it pays by card".
        $rule = OverLimitRule::for($id);

        // The terms the count is running under. A count kept under other
        // terms — a changed rule, default, days, payer, plan or member
        // number, or a count from before terms were recorded (the old
        // warn-only default) — starts again in this run: today becomes the
        // first day over, a fresh notice goes out for the present stage, and
        // nothing can be paused before the full days have passed. Decided
        // here, whatever route changed the terms, so no caller can forget it.
        //
        // A community paused for being over is not restarted: it stays paused
        // unless a lift condition below holds. Only the terms are recorded.
        $key = OverLimitRule::termsKey($id, $limit, $rule);
        $storedKey = $row?->limit_terms_key ?? null;
        $restart = false;
        if ($storedKey !== $key) {
            $hasCount = $row !== null && ($row->over_limit_since !== null || $row->limit_notice_stage !== null);
            $restart = $hasCount && !$pausedForLimit;

            if ($act) {
                $write = ['limit_terms_key' => $key];
                if ($restart) {
                    $write += ['over_limit_since' => null, 'limit_notice_stage' => null, 'limit_notice_at' => null];
                }
                BillingStandingService::recordCheckState($id, $write);
            }
        }
        if ($restart) {
            // The run and the preview both carry on from the emptied count.
            $row = clone $row;
            $row->over_limit_since = null;
            $row->limit_notice_stage = null;
            $row->limit_notice_at = null;
        }

        $facts = [
            'active_members' => $active,
            'max_users' => $max,
            'percent' => $percent,
            'plan_name' => $limit['plan_name'],
            'window_days' => StandardPlans::ACTIVE_WINDOW_DAYS,
            'stage' => $stage,
            'rule' => $rule['effective_action'],
            'rule_action' => $rule['action'],
            'grace_days' => $rule['grace_days'],
        ];

        if ($stage !== 'over' && $pausedForLimit) {
            return self::lift($id, $name, $row, $today, $act, $facts);
        }

        // Paused for being over under a rule that no longer pauses (changed to
        // warn only, stop new members, or move up): the pause goes, as when
        // no limit applies any more.
        if ($pausedForLimit && $rule['effective_action'] !== 'pause') {
            return self::lift($id, $name, $row, $today, $act, $facts + ['reason' => 'rule_changed']);
        }

        $recorded = self::LIMIT_STAGES[(string) $row?->limit_notice_stage] ?? 0;
        $current = $stage === null ? 0 : self::LIMIT_STAGES[$stage];

        // The episode: from the first run seen over with no first day over on
        // record, to the first run seen clearly under (below 95% of the
        // member number), or one of the explicit ends: a lift, a restore by
        // hand, a terms restart, an exemption, a pause for something else, no
        // limit, the checks switched on. Between 95% and the member number
        // the episode and its notice are kept: a dip of a member or two does
        // not buy a new count or cost the admins another email, and going
        // back over is paused on the episode's own date. A day over on record
        // is this episode's; none means the episode starts today.
        $clearlyUnder = $active * 100 < self::LIMIT_LEAVE_REACHED_PERCENT * $max;
        $overSince = $row?->over_limit_since !== null ? CarbonImmutable::parse(substr((string) $row->over_limit_since, 0, 10)) : null;
        if ($stage === 'over' && $overSince === null) {
            $overSince = $today;
        }

        // The "over" notice counts only for the episode it was sent in. A
        // stage held at "over" from an earlier episode (back under for a few
        // days, a lift, a restore by hand) is not a warning for this one.
        $overNoticeDay = self::episodeOverNoticeDay($row);
        $overDue = $stage === 'over' && $overNoticeDay === null;

        // A kept episode (not over, not clearly under) lasts only until its
        // pause date: notice day + days. Not over on or after that day, it
        // ends, so no pause ever rests on a notice older than the days plus
        // the days it then stayed over, and a community hovering at its line
        // gets at most one "over" notice per `grace_days`. An episode with no
        // notice on record has no pause date and ends only when clearly under.
        $keptEpisodeExpired = $stage !== 'over' && !$clearlyUnder && $overNoticeDay !== null
            && $today->greaterThanOrEqualTo($overNoticeDay->addDays($rule['grace_days']));

        // Up is immediate and tells people. Down needs both a month since
        // the last notice and being clearly below the line, so a community
        // hovering at a line is told once, not every time it crosses it.
        // "Over" is not decided here: it is tied to the episode (above), and
        // recorded only once it was really sent (below).
        $newRecorded = $recorded;
        if ($stage !== 'over') {
            if ($current > $recorded) {
                $newRecorded = $current;
            } elseif ($current < $recorded) {
                $lastNotice = self::noticeDay($row?->limit_notice_at);
                if ($lastNotice === null || !$lastNotice->addDays(self::LIMIT_NOTICE_HOLD_DAYS)->greaterThan($today)) {
                    $newRecorded = self::heldLimitRank($recorded, $active, $max, (int) $settings['limit_warning_percent']);
                }
            }
        }

        // Every date the rule names counts from this episode's "over" notice:
        // the day it was sent when it is on record, otherwise today, the
        // earliest it could go out. Nothing is paused without one on record.
        // Not over today (a kept episode between 95% and the member number):
        // no date at all, since nothing happens unless it goes back over, and
        // then it is paused on the first day over on or after notice + days.
        $warnedOn = $overNoticeDay ?? $today;
        $pauseOn = ($stage === 'over' && $rule['effective_action'] === 'pause' && $overNoticeDay !== null)
            ? $overNoticeDay->addDays($rule['grace_days'])
            : null;
        if ($stage === 'over' && $rule['effective_action'] === 'pause') {
            $facts['pause_date'] = $warnedOn->addDays($rule['grace_days'])->toDateString();
        }
        if ($overSince !== null) {
            $facts['over_limit_since'] = $overSince->toDateString();
        }

        // Move up is not carried out yet (a later stage): the "over" notice
        // already says which plan it would move to, and when, or that no plan
        // fits and a person must decide.
        if ($stage === 'over' && $rule['effective_action'] === 'upgrade') {
            $target = PlanTerms::smallestFitting($id, $active);
            if ($target !== null) {
                $facts['move_date'] = $warnedOn->addDays($rule['grace_days'])->toDateString();
                $facts['move_plan'] = $target['name'];
            }
        }

        $out = [];

        if ($act) {
            $state = [];
            if ($stage === 'over' && $row?->over_limit_since === null) {
                $state['over_limit_since'] = $today->toDateString();
            }
            if ($stage !== 'over' && $row?->over_limit_since !== null && $clearlyUnder) {
                $state['over_limit_since'] = null;
            }
            if ($keptEpisodeExpired) {
                // Through its warning period under its number: the episode
                // ends, so going over again is a new one, with a fresh notice
                // and the full days. The stage is set to where the community
                // is now (not emptied), so "approaching" or "reached" is not
                // re-sent the next morning because of this.
                $names = array_flip(self::LIMIT_STAGES);
                $state['over_limit_since'] = null;
                $state['limit_notice_at'] = null;
                $state['limit_notice_stage'] = $names[$current] ?? null;
            }
            if ($newRecorded !== $recorded) {
                $names = array_flip(self::LIMIT_STAGES);
                $state['limit_notice_stage'] = $names[$newRecorded] ?? null;
                if ($newRecorded > $recorded) {
                    $state['limit_notice_at'] = self::stamp($today);
                }
            }
            if ($stage === 'over' && $pausedForLimit && $recorded !== self::LIMIT_STAGES['over']) {
                // Paused for being over already: the stage is noted, silently
                // and with no date, so it never stands for a warning.
                $state['limit_notice_stage'] = 'over';
            }
            BillingStandingService::recordCheckState($id, $state);
        }

        // A community paused for being over is lifted above once it is not
        // over, so "approaching" and "reached" only reach one that is open.
        if ($stage !== null && $stage !== 'over' && $current > $recorded) {
            if ($act) {
                self::tell(fn () => match ($stage) {
                    'approaching' => BillingStandingNotifier::limitApproaching($id, $facts),
                    default => BillingStandingNotifier::limitReached($id, $facts),
                }, $id);
            }
            $out[] = self::entry($id, $name, 'member_limit', $stage, $facts);
        }

        // A community paused for being over (the only pause that reaches
        // here) is told nothing: it would be told it "will be paused on" a
        // date while already paused.
        if (!$pausedForLimit && $overDue) {
            // Recorded as sent only once it was sent: a notice that failed
            // is due again at the next run, and the days start from the day
            // it does go out. A community nobody can be mailed about (no
            // admin address, no payee) "succeeds" with no recipients: there
            // is nobody to wait for, and holding it back would mean it is
            // never paused at all. A preview sends nothing and assumes the
            // send would succeed.
            if ($act) {
                $sent = self::tell(fn () => BillingStandingNotifier::limitOver($id, $facts), $id);
                if ($sent) {
                    BillingStandingService::recordCheckState($id, [
                        'limit_notice_stage' => 'over',
                        'limit_notice_at' => self::stamp($today),
                    ]);
                } else {
                    Log::error('[BillingAutomation] the "over" member-limit notice was not sent; it is due again at the next run', [
                        'tenant_id' => $id,
                    ]);
                }
            }
            $out[] = self::entry($id, $name, 'member_limit', 'over', $facts);
        }

        if ($pauseOn !== null && !$pausedForLimit && $today->greaterThanOrEqualTo($pauseOn)) {
            if ($act) {
                self::pause($id, 'over_limit', $facts);
            }
            $out[] = self::entry($id, $name, 'member_limit', 'suspend', $facts);
        }

        return $out;
    }

    /**
     * The day this episode's "over" notice was sent, or null when none is on
     * record for it: the stage is "over" and the notice's day is on or after
     * the first day over. With no first day over on record the episode starts
     * in this run, so nothing on record can belong to it.
     */
    private static function episodeOverNoticeDay(?object $row): ?CarbonImmutable
    {
        if ($row === null || ($row->limit_notice_stage ?? null) !== 'over' || ($row->over_limit_since ?? null) === null) {
            return null;
        }

        $sentOn = self::noticeDay($row->limit_notice_at ?? null);
        $since = CarbonImmutable::parse(substr((string) $row->over_limit_since, 0, 10));

        return $sentOn !== null && !$sentOn->lessThan($since) ? $sentOn : null;
    }

    /**
     * The member-limit stage to keep on record once the community has dropped
     * below the recorded one: it leaves "reached"/"over" only below 95%, and
     * "approaching" only below the warning percent less 5.
     */
    private static function heldLimitRank(int $recorded, int $active, int $max, int $warningPercent): int
    {
        if ($recorded >= self::LIMIT_STAGES['reached'] && $active * 100 >= self::LIMIT_LEAVE_REACHED_PERCENT * $max) {
            return $recorded;
        }
        if ($active * 100 >= ($warningPercent - self::LIMIT_LEAVE_MARGIN) * $max) {
            return self::LIMIT_STAGES['approaching'];
        }

        return 0;
    }

    /**
     * Open a community paused for being over its limit, now that it is not.
     *
     * Unless the payment clock has reached its pause stage for the current
     * paid-until date (it runs first, and records that stage silently for a
     * community already paused): then it stays paused, and the pause is
     * recorded as for non-payment, so that paying up is what opens it.
     *
     * @param array<string, mixed> $facts
     * @return list<array{tenant_id:int, tenant_name:string, clock:string, action:string, detail:array<string, mixed>}>
     */
    private static function lift(int $id, string $name, object $row, CarbonImmutable $today, bool $act, array $facts): array
    {
        $payer = $row->payer ?? BillingStandingService::defaultPayer($id);
        $paymentPause = $row->paid_until !== null
            && $payer !== 'not_billed'
            && ($row->last_notice_stage ?? null) === 'suspend';

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
     * False when the send threw, so a caller that records a notice only once
     * it went out (the member limit's "over") can tell; the payment clock's
     * callers ignore it and behave as before.
     */
    private static function tell(callable $send, int $tenantId): bool
    {
        try {
            $send();

            return true;
        } catch (\Throwable $e) {
            Log::error('[BillingAutomation] a billing notice could not be sent', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    /**
     * Communities on a standard package with a member limit, with that limit
     * and the plan's name as they apply to the community: for one that pays
     * its parent, the parent's version of the plan (PlanTerms).
     *
     * Only standard packages: a community on a retired plan keeps the terms it
     * had, and nobody promised it a limit would be watched. The member number
     * is filtered after the hub's changes are applied, so a hub can give an
     * unlimited plan a limit. It cannot take one away: a hub's null means
     * "follow the default", and a member number it sets is 1 or more.
     *
     * @return array<int, array{plan_id:int, plan_name:string, max_users:int}>
     */
    private static function limitedCommunities(?int $onlyTenantId = null): array
    {
        $query = DB::table('tenant_plan_assignments as tpa')
            ->join('pay_plans as pp', 'pp.id', '=', 'tpa.pay_plan_id')
            ->where('tpa.status', 'active')
            ->where('pp.is_standard', 1);
        if ($onlyTenantId !== null) {
            $query->where('tpa.tenant_id', $onlyTenantId);
        }
        $rows = $query
            ->orderBy('tpa.id')
            ->get(['tpa.tenant_id', 'tpa.pay_plan_id', 'pp.name', 'pp.max_users']);

        // One active assignment per community is the rule; if there are
        // more, the newest wins.
        $newest = [];
        foreach ($rows as $row) {
            $newest[(int) $row->tenant_id] = $row;
        }

        $limits = [];
        foreach ($newest as $tenantId => $row) {
            $applied = PlanTerms::applyHubChanges($tenantId, (int) $row->pay_plan_id, [
                'name' => (string) $row->name,
                'max_users' => $row->max_users !== null ? (int) $row->max_users : null,
            ])['values'];

            if ($applied['max_users'] === null || $applied['max_users'] <= 0) {
                continue;
            }
            $limits[$tenantId] = [
                'plan_id' => (int) $row->pay_plan_id,
                'plan_name' => (string) $applied['name'],
                'max_users' => (int) $applied['max_users'],
            ];
        }

        return $limits;
    }

    /**
     * The member limit the daily check watches for one community, as it
     * applies to it, or null when none is watched.
     *
     * @return array{plan_id:int, plan_name:string, max_users:int}|null
     */
    public static function watchedLimit(int $tenantId): ?array
    {
        return self::limitedCommunities($tenantId)[$tenantId] ?? null;
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
