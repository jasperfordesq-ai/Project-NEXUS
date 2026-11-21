<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\FormattingLocale;
use App\I18n\LocaleContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Tells people about a community's payment standing: that it has been paused
 * or restored, and the daily check's notices before that (a payment coming
 * due, due, late; the member limit approaching, reached, passed).
 *
 * Two audiences, never members:
 *
 * - the community's own admins — every one of them, not the first one found:
 *   the person who can sort out the payment may not be whoever happens to
 *   come first. "Admin" includes accounts whose admin level is a flag and not
 *   a role.
 * - "whoever the community pays", for the notices that need someone to chase
 *   it: the active tenant super admins of its direct parent when it pays its
 *   parent, otherwise the platform team (`is_god` AND `is_super_admin`).
 *   Each is mailed in the context of their OWN community, so the link opens
 *   their own panel.
 *
 * Each person is mailed in their own language, subject included, inside the
 * loop. Subjects are plain text; anything put into a body is escaped. Dates
 * and numbers go in through placeholders. Category `billing`, which a paused
 * community may still receive.
 *
 * Callers decide WHEN (only when the state really changed, once per stage);
 * a failure to send is theirs to swallow, so a pause never fails because mail
 * did.
 */
final class BillingStandingNotifier
{
    private const KEY = 'emails_misc.billing_standing.';

    /**
     * The community has been paused. `$automatic` (the daily check paused it)
     * also tells whoever the community pays and the platform team; a person
     * who paused it by hand already knows.
     *
     * @param array<string, int|string|null> $facts paid_until, days_late (non-payment); over_limit_since (over the limit)
     * @return int how many people were mailed
     */
    public static function paused(int $tenantId, bool $automatic = false, array $facts = []): int
    {
        $about = self::community($tenantId);
        if ($about === null) {
            return 0;
        }

        $reason = BillingStandingService::get($tenantId)['suspension_reason'] ?? 'non_payment';
        $overLimit = $reason === 'over_limit';

        if ($overLimit) {
            $adminBody = [self::KEY . 'paused_body_over_limit', ['community' => $about['name'], 'date' => (string) ($facts['over_limit_since'] ?? '')]];
        } elseif ($about['payee_name'] !== null) {
            $adminBody = [self::KEY . 'paused_body_parent', ['community' => $about['name'], 'payee' => $about['payee_name']]];
        } else {
            $adminBody = [self::KEY . 'paused_body_platform', ['community' => $about['name']]];
        }

        $admins = self::admins($tenantId);
        $sent = self::deliver($admins, $about['name'], self::KEY . 'paused_subject', self::KEY . 'paused_title', [$adminBody], 'warning', '/admin');

        if ($automatic) {
            $payeeBody = $overLimit
                ? [self::KEY . 'payee_paused_body_over_limit', ['community' => $about['name'], 'date' => (string) ($facts['over_limit_since'] ?? '')]]
                : [self::KEY . 'payee_paused_body', ['community' => $about['name'], 'date' => (string) ($facts['paid_until'] ?? ''), 'days' => (string) ($facts['days_late'] ?? '')]];

            $payees = self::payees($about);
            $sent += self::toPayees($tenantId, $about, $admins, self::KEY . 'paused_subject', self::KEY . 'payee_paused_title', [$payeeBody], 'warning');

            // DESIGN §6.5: an automatic pause also reaches the platform team.
            // For a community that pays the platform it already has; for one
            // that pays its parent, the platform team is told too, and nobody
            // already told as an admin or as the parent's manager is told twice.
            if ($about['pays_parent']) {
                $alreadyTold = $admins->pluck('id')->merge($payees->pluck('id'))
                    ->map(static fn ($id): int => (int) $id)->all();
                $team = self::platformTeam()
                    ->reject(static fn ($person): bool => in_array((int) $person->id, $alreadyTold, true))
                    ->values();

                $sent += self::deliver(
                    $team,
                    $about['name'],
                    self::KEY . 'paused_subject',
                    self::KEY . 'payee_paused_title',
                    [$payeeBody, [self::KEY . 'payee_note_platform', ['community' => $about['name']]]],
                    'warning',
                    '/platform-team/billing'
                );
            }
        }

        return $sent;
    }

    /** @return int how many admins were mailed */
    public static function restored(int $tenantId): int
    {
        $about = self::community($tenantId);
        if ($about === null) {
            return 0;
        }

        return self::deliver(
            self::admins($tenantId),
            $about['name'],
            self::KEY . 'restored_subject',
            self::KEY . 'restored_title',
            [[self::KEY . 'restored_body', ['community' => $about['name']]]],
            'default',
            '/admin'
        );
    }

    /**
     * A payment comes due soon. The community's admins only.
     *
     * @param array<string, int|string|null> $facts paid_until
     */
    public static function paymentReminder(int $tenantId, array $facts): int
    {
        return self::paymentNotice($tenantId, $facts, 'reminder', false, 'default');
    }

    /**
     * The paid-up date has passed. The admins and whoever the community pays.
     *
     * @param array<string, int|string|null> $facts paid_until
     */
    public static function paymentDue(int $tenantId, array $facts): int
    {
        return self::paymentNotice($tenantId, $facts, 'due', true, 'warning');
    }

    /**
     * The last notice before an automatic pause. The admins and whoever the
     * community pays.
     *
     * @param array<string, int|string|null> $facts paid_until, days_late, pause_date
     */
    public static function paymentFinalWarning(int $tenantId, array $facts): int
    {
        return self::paymentNotice($tenantId, $facts, 'final_warning', true, 'warning');
    }

    /**
     * Close to the limit. The admins and whoever the community pays (DESIGN
     * 6.5), with what its rule will do if it goes over.
     *
     * @param array<string, mixed> $facts active_members, max_users, plan_name, window_days, rule?, grace_days?
     * @return array{tried:int, accepted:int} see deliverCounted()
     */
    public static function limitApproaching(int $tenantId, array $facts): array
    {
        return self::limitNotice($tenantId, $facts, 'limit_approaching', true, self::ruleLine($facts), 'default');
    }

    /**
     * @param array<string, mixed> $facts active_members, max_users, plan_name, window_days, rule?, grace_days?
     * @return array{tried:int, accepted:int} see deliverCounted()
     */
    public static function limitReached(int $tenantId, array $facts): array
    {
        return self::limitNotice($tenantId, $facts, 'limit_reached', true, self::ruleLine($facts, true), 'warning');
    }

    /**
     * Over the limit. The closing line says what the community's rule will
     * do (`rule`, the action the daily check follows):
     *
     * - `none`: nothing more — unless "move up" was chosen and it pays by
     *   card (`rule_action` `upgrade`), when a person must move it;
     * - `block_joining`: from now on new members cannot join until it is
     *   back under (the "reached" notice says the same);
     * - `pause`: paused on `pause_date` if still over;
     * - `upgrade`: moved to `move_plan` on `move_date` if still over, with
     *   its price (`move_price_monthly` / `move_price_yearly`, in
     *   `move_currency`) when one is recorded; or a person must decide when
     *   it cannot be moved automatically (no `move_plan`).
     *
     * Without `rule` (a caller from before the rules existed): a
     * `pause_date` means pause, else warn only.
     *
     * @param array<string, mixed> $facts active_members, max_users, plan_name, window_days, rule?, rule_action?, pause_date?, move_date?, move_plan?, move_price_monthly?, move_price_yearly?, move_currency?
     * @return array{tried:int, accepted:int} see deliverCounted()
     */
    public static function limitOver(int $tenantId, array $facts): array
    {
        $pauseDate = isset($facts['pause_date']) ? (string) $facts['pause_date'] : null;
        $rule = isset($facts['rule']) ? (string) $facts['rule'] : ($pauseDate !== null ? 'pause' : 'none');

        $closing = match ($rule) {
            'pause' => [self::KEY . 'limit_over_will_pause', ['date' => (string) $pauseDate]],
            'block_joining' => [self::KEY . 'limit_joining_closed_now', []],
            'upgrade' => isset($facts['move_plan'], $facts['move_date'])
                ? self::moveUpLine($facts)
                : [self::KEY . 'limit_over_needs_decision', []],
            default => ($facts['rule_action'] ?? null) === 'upgrade'
                ? [self::KEY . 'limit_over_needs_decision', []]
                : [self::KEY . 'limit_over_warn_only', []],
        };

        return self::limitNotice($tenantId, $facts, 'limit_over', true, $closing, 'warning');
    }

    /**
     * "It will be moved to PLAN (price) on DATE" (DESIGN 6.5); without the
     * price when none is recorded for the plan.
     *
     * @param array<string, mixed> $facts
     * @return array{0:string, 1:array<string, string|\Closure>}
     */
    private static function moveUpLine(array $facts): array
    {
        $params = ['date' => (string) $facts['move_date'], 'plan' => (string) $facts['move_plan']];
        $price = self::priceText($facts['move_price_monthly'] ?? null, $facts['move_price_yearly'] ?? null, $facts['move_currency'] ?? null);
        if ($price === null) {
            return [self::KEY . 'limit_over_will_move_up', $params];
        }

        return [self::KEY . 'limit_over_will_move_up_priced', $params + ['price' => $price]];
    }

    /**
     * A plan's price as a short phrase ("€229.00 a month"), written in the
     * reader's locale: the monthly price when one is recorded, else the
     * yearly one. Null when neither is (missing or 0).
     */
    private static function priceText(mixed $monthly, mixed $yearly, mixed $currency): ?\Closure
    {
        $code = strtoupper((string) ($currency ?? 'eur')) === 'GBP' ? 'GBP' : 'EUR';
        $month = self::chargedAmount($monthly);
        $year = self::chargedAmount($yearly);

        if ($month !== null) {
            return static fn (): string => __(self::KEY . 'price_a_month', ['amount' => self::money($month, $code)]);
        }
        if ($year !== null) {
            return static fn (): string => __(self::KEY . 'price_a_year', ['amount' => self::money($year, $code)]);
        }

        return null;
    }

    /**
     * The daily check moved the community up to a bigger plan (DESIGN 6.5).
     * Its admins and whoever it pays: the old plan, the new plan, its member
     * number and its price in the community's billing currency (for one that
     * pays its hub, the hub's price; TenantBillingService::planChangedFacts()).
     *
     * @param array<string, mixed> $facts old_plan_name, plan_name, max_users, price_monthly, price_yearly, currency, active_members
     * @return array{tried:int, accepted:int} see deliverCounted()
     */
    public static function movedUp(int $tenantId, array $facts): array
    {
        $about = self::community($tenantId);
        if ($about === null) {
            return ['tried' => 0, 'accepted' => 0];
        }

        $plan = (string) ($facts['plan_name'] ?? '');
        $maxUsers = isset($facts['max_users']) ? (int) $facts['max_users'] : null;
        $currency = strtoupper((string) ($facts['currency'] ?? 'eur')) === 'GBP' ? 'GBP' : 'EUR';
        $monthly = self::chargedAmount($facts['price_monthly'] ?? null);
        $yearly = self::chargedAmount($facts['price_yearly'] ?? null);

        $paragraphs = [
            $maxUsers !== null
                ? [self::KEY . 'moved_up_body', [
                    'community' => $about['name'],
                    'count' => self::number((int) ($facts['active_members'] ?? 0)),
                    'old' => (string) ($facts['old_plan_name'] ?? ''),
                    'plan' => $plan,
                    'max' => self::number($maxUsers),
                ]]
                : [self::KEY . 'plan_changed_body_no_limit', ['community' => $about['name'], 'plan' => $plan]],
        ];

        $monthlyText = static fn (): string => self::money((float) $monthly, $currency);
        $yearlyText = static fn (): string => self::money((float) $yearly, $currency);
        $paragraphs[] = match (true) {
            $monthly !== null && $yearly !== null => [self::KEY . 'plan_changed_price', ['monthly' => $monthlyText, 'yearly' => $yearlyText]],
            $monthly !== null => [self::KEY . 'plan_changed_price_monthly', ['monthly' => $monthlyText]],
            $yearly !== null => [self::KEY . 'plan_changed_price_yearly', ['yearly' => $yearlyText]],
            default => [self::KEY . 'plan_changed_no_charge', []],
        };

        $adminParagraphs = $paragraphs;
        if ($about['payee_name'] !== null) {
            $adminParagraphs[] = [self::KEY . 'pay_to_parent', ['payee' => $about['payee_name']]];
        }

        $admins = self::admins($tenantId);
        $subjectParams = ['plan' => $plan];
        $counts = self::deliverCounted($admins, $about['name'], self::KEY . 'moved_up_subject', self::KEY . 'moved_up_title', $adminParagraphs, 'default', '/admin', $subjectParams);

        return self::add($counts, self::toPayeesCounted($tenantId, $about, $admins, self::KEY . 'moved_up_subject', self::KEY . 'moved_up_title', $paragraphs, 'default', $subjectParams));
    }

    /**
     * The daily check could not move the community up, so a person must
     * decide (DESIGN 6.4). `reason`:
     *
     * - `no_plan_fits`: no plan offered to it is big enough;
     * - `custom_price`: its assignment has a specially agreed price;
     * - `card_subscription`: it pays the platform by card, so only the
     *   platform team can move it.
     *
     * Whoever it pays and the platform team, nobody twice; for
     * `card_subscription` the platform team only. Its admins were told in
     * its "over" notice that it would not be moved automatically.
     *
     * @param array<string, mixed> $facts reason, active_members, max_users, plan_name, window_days
     * @return array{tried:int, accepted:int} see deliverCounted()
     */
    public static function moveNeedsDecision(int $tenantId, array $facts): array
    {
        $about = self::community($tenantId);
        if ($about === null) {
            return ['tried' => 0, 'accepted' => 0];
        }

        $reason = (string) ($facts['reason'] ?? 'no_plan_fits');
        $reasonKey = match ($reason) {
            'custom_price' => 'move_decision_custom_price',
            'card_subscription' => 'move_decision_card_subscription',
            default => 'move_decision_no_plan_fits',
        };

        $paragraphs = [
            [self::KEY . 'limit_usage', [
                'community' => $about['name'],
                'count' => self::number((int) ($facts['active_members'] ?? 0)),
                'max' => self::number((int) ($facts['max_users'] ?? 0)),
                'plan' => (string) ($facts['plan_name'] ?? ''),
            ]],
            [self::KEY . 'active_member_note', ['days' => self::number((int) ($facts['window_days'] ?? 0))]],
            [self::KEY . $reasonKey, []],
        ];

        $counts = ['tried' => 0, 'accepted' => 0];
        $told = [];
        if ($reason !== 'card_subscription' && $about['pays_parent']) {
            $payees = self::payees($about);
            $told = $payees->pluck('id')->map(static fn ($id): int => (int) $id)->all();
            $counts = self::deliverCounted($payees, $about['name'], self::KEY . 'move_decision_subject', self::KEY . 'move_decision_title', $paragraphs, 'warning', '/super-admin/branch-payments');
        }

        // For a community that pays the platform, whoever it pays IS the
        // platform team: one mail each, never two.
        $team = self::platformTeam()
            ->reject(static fn ($person): bool => in_array((int) $person->id, $told, true))
            ->values();

        return self::add($counts, self::deliverCounted($team, $about['name'], self::KEY . 'move_decision_subject', self::KEY . 'move_decision_title', $paragraphs, 'warning', '/platform-team/billing'));
    }

    /**
     * A community above this one (`above_name`) is at its member number under
     * "stop new members joining", so this community's door is shut too
     * (task 7A). Every admin of this community, nobody else: the community
     * above was told in its own notice. No member number, price or plan name:
     * those belong to the other community.
     *
     * @param array<string, mixed> $facts above_tenant_id, above_name
     * @return array{tried:int, accepted:int} see deliverCounted()
     */
    public static function joiningClosedByAbove(int $tenantId, array $facts): array
    {
        $about = self::community($tenantId);
        if ($about === null) {
            return ['tried' => 0, 'accepted' => 0];
        }

        $params = ['community' => $about['name'], 'above' => (string) ($facts['above_name'] ?? '')];

        return self::deliverCounted(
            self::admins($tenantId),
            $about['name'],
            self::KEY . 'joining_closed_above_subject',
            self::KEY . 'joining_closed_above_title',
            [
                [self::KEY . 'joining_closed_above_body', $params],
                [self::KEY . 'joining_closed_above_members', []],
                [self::KEY . 'joining_closed_above_reopens', $params],
            ],
            'warning',
            '/admin'
        );
    }

    /**
     * The community above that shut this community's door no longer does
     * (task 7A): new members can join again. Every admin of this community.
     *
     * @param array<string, mixed> $facts above_tenant_id, above_name
     * @return array{tried:int, accepted:int} see deliverCounted()
     */
    public static function joiningOpenedAgain(int $tenantId, array $facts): array
    {
        $about = self::community($tenantId);
        if ($about === null) {
            return ['tried' => 0, 'accepted' => 0];
        }

        return self::deliverCounted(
            self::admins($tenantId),
            $about['name'],
            self::KEY . 'joining_opened_again_subject',
            self::KEY . 'joining_opened_again_title',
            [[self::KEY . 'joining_opened_again_body', ['community' => $about['name'], 'above' => (string) ($facts['above_name'] ?? '')]]],
            'default',
            '/admin'
        );
    }

    /**
     * @param array{tried:int, accepted:int} $a
     * @param array{tried:int, accepted:int} $b
     * @return array{tried:int, accepted:int}
     */
    private static function add(array $a, array $b): array
    {
        return ['tried' => $a['tried'] + $b['tried'], 'accepted' => $a['accepted'] + $b['accepted']];
    }

    /**
     * The sentence in the "approaching" and "reached" notices saying what the
     * rule will do if the community goes or stays over. None for warn only.
     *
     * @param array<string, int|string|null> $facts
     * @return array{0:string, 1:array<string, string>}|null
     */
    private static function ruleLine(array $facts, bool $atTheNumber = false): ?array
    {
        $days = (string) ($facts['grace_days'] ?? '');

        // "Move up" promises an automatic move only when the check knows one
        // will happen: not when no plan fits, the price was specially agreed
        // (`move_decision`), or it pays by card (followed as warn only). The
        // same condition the "over" notice uses.
        $rule = $facts['rule'] ?? null;
        $moveNeedsDecision = ($rule === 'upgrade' && isset($facts['move_decision']))
            || ($rule !== 'upgrade' && ($facts['rule_action'] ?? null) === 'upgrade');
        if ($moveNeedsDecision) {
            return [self::KEY . 'limit_over_needs_decision', []];
        }

        return match ($facts['rule'] ?? null) {
            // At its number the door is shut from now on (JoiningGate).
            'block_joining' => $atTheNumber
                ? [self::KEY . 'limit_joining_closed_now', []]
                : [self::KEY . 'limit_rule_block_joining', []],
            'pause' => [self::KEY . 'limit_rule_pause', ['days' => $days]],
            'upgrade' => [self::KEY . 'limit_rule_upgrade', ['days' => $days]],
            default => null,
        };
    }

    /**
     * The community's plan has changed. Every admin of the community, not
     * whoever it pays: the person who changed it already knows.
     *
     * Money is written in the currency the community is billed in, in each
     * reader's own number format. A price that is missing or 0 is "no charge
     * recorded", never "€0.00".
     *
     * @param array<string, mixed> $facts plan_name, max_users, price_monthly, price_yearly, currency; old_plan_name?, payee_name?
     * @return int how many admins were mailed
     */
    public static function planChanged(int $tenantId, array $facts): int
    {
        $about = self::community($tenantId);
        if ($about === null) {
            return 0;
        }

        $plan = (string) ($facts['plan_name'] ?? '');
        $maxUsers = isset($facts['max_users']) ? (int) $facts['max_users'] : null;
        $currency = strtoupper((string) ($facts['currency'] ?? 'eur')) === 'GBP' ? 'GBP' : 'EUR';
        $monthly = self::chargedAmount($facts['price_monthly'] ?? null);
        $yearly = self::chargedAmount($facts['price_yearly'] ?? null);
        $oldPlan = isset($facts['old_plan_name']) && $facts['old_plan_name'] !== '' ? (string) $facts['old_plan_name'] : null;
        $payee = isset($facts['payee_name']) && $facts['payee_name'] !== ''
            ? (string) $facts['payee_name']
            : $about['payee_name'];

        $paragraphs = [
            $maxUsers !== null
                ? [self::KEY . 'plan_changed_body', ['community' => $about['name'], 'plan' => $plan, 'max' => self::number($maxUsers)]]
                : [self::KEY . 'plan_changed_body_no_limit', ['community' => $about['name'], 'plan' => $plan]],
        ];
        if ($oldPlan !== null) {
            $paragraphs[] = [self::KEY . 'plan_changed_was', ['plan' => $oldPlan]];
        }

        $monthlyText = static fn (): string => self::money((float) $monthly, $currency);
        $yearlyText = static fn (): string => self::money((float) $yearly, $currency);
        $paragraphs[] = match (true) {
            $monthly !== null && $yearly !== null => [self::KEY . 'plan_changed_price', ['monthly' => $monthlyText, 'yearly' => $yearlyText]],
            $monthly !== null => [self::KEY . 'plan_changed_price_monthly', ['monthly' => $monthlyText]],
            $yearly !== null => [self::KEY . 'plan_changed_price_yearly', ['yearly' => $yearlyText]],
            default => [self::KEY . 'plan_changed_no_charge', []],
        };

        if ($payee !== null) {
            $paragraphs[] = [self::KEY . 'pay_to_parent', ['payee' => $payee]];
        }

        return self::deliver(
            self::admins($tenantId),
            $about['name'],
            self::KEY . 'plan_changed_subject',
            self::KEY . 'plan_changed_title',
            $paragraphs,
            'default',
            '/admin',
            ['plan' => $plan]
        );
    }

    /** An amount worth stating, or null for one that is missing or 0. */
    private static function chargedAmount(mixed $value): ?float
    {
        if ($value === null || $value === '' || !is_numeric($value)) {
            return null;
        }

        return (float) $value > 0 ? (float) $value : null;
    }

    /**
     * An amount in the reader's language and region (called inside the
     * per-recipient locale wrap), with the currency's own symbol.
     */
    private static function money(float $amount, string $currency): string
    {
        if (class_exists(\NumberFormatter::class)) {
            try {
                $formatter = new \NumberFormatter(str_replace('-', '_', FormattingLocale::resolve()), \NumberFormatter::CURRENCY);
                $formatted = $formatter->formatCurrency($amount, $currency);
                if (is_string($formatted) && $formatted !== '') {
                    return $formatted;
                }
            } catch (\Throwable) {
                // Fall through to the plain form below.
            }
        }

        return ($currency === 'GBP' ? '£' : '€') . number_format($amount, 2);
    }

    /** A whole number in the reader's format; resolved inside the locale wrap. */
    private static function number(int $value): \Closure
    {
        return static function () use ($value): string {
            if (class_exists(\NumberFormatter::class)) {
                try {
                    $formatted = (new \NumberFormatter(str_replace('-', '_', FormattingLocale::resolve()), \NumberFormatter::DECIMAL))->format($value);
                    if (is_string($formatted) && $formatted !== '') {
                        return $formatted;
                    }
                } catch (\Throwable) {
                    // Fall through to the plain form below.
                }
            }

            return (string) $value;
        };
    }

    /**
     * @param array<string, int|string|null> $facts
     */
    /**
     * A payment notice for the daily check, which must know whether the
     * community was really told before it counts the notice as given: the
     * counts for the community's OWN admins (`tried`, `accepted`). Whoever it
     * pays is told as well, as before, and is not part of the count.
     *
     * @param 'reminder'|'due'|'final_warning' $stage
     * @param array<string, mixed> $facts
     * @return array{tried:int, accepted:int}
     */
    public static function paymentNoticeCounted(int $tenantId, array $facts, string $stage): array
    {
        $counts = ['tried' => 0, 'accepted' => 0];
        match ($stage) {
            'reminder' => self::paymentNotice($tenantId, $facts, 'reminder', false, 'default', $counts),
            'due' => self::paymentNotice($tenantId, $facts, 'due', true, 'warning', $counts),
            default => self::paymentNotice($tenantId, $facts, 'final_warning', true, 'warning', $counts),
        };

        return $counts;
    }

    /**
     * @param array{tried:int, accepted:int}|null $adminCounts set to what the mailer did for the community's own admins
     */
    private static function paymentNotice(int $tenantId, array $facts, string $stage, bool $tellPayee, string $theme, ?array &$adminCounts = null): int
    {
        $about = self::community($tenantId);
        if ($about === null) {
            return 0;
        }

        $params = [
            'community' => $about['name'],
            'date' => (string) ($facts['paid_until'] ?? ''),
            'days' => (string) ($facts['days_late'] ?? ''),
            'pause_date' => (string) ($facts['pause_date'] ?? ''),
        ];
        $body = [self::KEY . "{$stage}_body", $params];
        $payTo = $about['payee_name'] !== null
            ? [self::KEY . 'pay_to_parent', ['payee' => $about['payee_name']]]
            : [self::KEY . 'pay_to_platform', []];
        // A card payer has nobody to pay by hand: its card is charged. It was
        // told "payment is made to the platform team", which sends it looking
        // for an invoice when the thing to do is check the card.
        if ($about['payee_name'] === null && BillingStandingService::get($tenantId)['payer'] === 'platform_card') {
            $payTo = [self::KEY . 'pay_by_card', []];
        }

        // Which plan, and what it costs. A payment notice said that money
        // was due and never how much.
        $amount = self::planPriceLines($tenantId);

        $admins = self::admins($tenantId);
        $subjectParams = ['date' => $params['date'], 'pause_date' => $params['pause_date']];

        $adminCounts = self::deliverCounted($admins, $about['name'], self::KEY . "{$stage}_subject", self::KEY . "{$stage}_title", [$body, ...$amount, $payTo], $theme, '/admin', $subjectParams);
        $sent = $adminCounts['tried'];

        if ($tellPayee) {
            $sent += self::toPayees($tenantId, $about, $admins, self::KEY . "{$stage}_subject", self::KEY . "{$stage}_title", [$body, ...$amount], $theme, $subjectParams);
        }

        return $sent;
    }

    /**
     * "It is on the PLAN plan." and "Its price is X a month or Y a year.",
     * for a payment notice: the plan as it applies to the community and its
     * price in the currency it is billed in (its hub's price when it pays its
     * hub; TenantBillingService::planChangedFacts()). Empty with no plan in
     * force, or one that costs nothing: then there is no amount to state.
     *
     * @return list<array{0:string, 1:array<string, string|\Closure>}>
     */
    private static function planPriceLines(int $tenantId): array
    {
        try {
            $facts = TenantBillingService::planChangedFacts($tenantId, null);
        } catch (\RuntimeException) {
            return [];
        }

        $currency = strtoupper((string) $facts['currency']) === 'GBP' ? 'GBP' : 'EUR';
        $monthly = self::chargedAmount($facts['price_monthly']);
        $yearly = self::chargedAmount($facts['price_yearly']);
        if ($monthly === null && $yearly === null) {
            return [];
        }

        $monthlyText = static fn (): string => self::money((float) $monthly, $currency);
        $yearlyText = static fn (): string => self::money((float) $yearly, $currency);

        return [
            [self::KEY . 'payment_plan', ['plan' => (string) $facts['plan_name']]],
            match (true) {
                $monthly !== null && $yearly !== null => [self::KEY . 'plan_changed_price', ['monthly' => $monthlyText, 'yearly' => $yearlyText]],
                $monthly !== null => [self::KEY . 'plan_changed_price_monthly', ['monthly' => $monthlyText]],
                default => [self::KEY . 'plan_changed_price_yearly', ['yearly' => $yearlyText]],
            },
        ];
    }

    /**
     * @param array<string, mixed> $facts
     * @param array{0:string, 1:array<string, string|\Closure>}|null $closing
     * @return array{tried:int, accepted:int}
     */
    private static function limitNotice(int $tenantId, array $facts, string $stage, bool $tellPayee, ?array $closing, string $theme): array
    {
        $about = self::community($tenantId);
        if ($about === null) {
            return ['tried' => 0, 'accepted' => 0];
        }

        $paragraphs = [
            [self::KEY . 'limit_usage', [
                'community' => $about['name'],
                'count' => (string) ($facts['active_members'] ?? ''),
                'max' => (string) ($facts['max_users'] ?? ''),
                'plan' => (string) ($facts['plan_name'] ?? ''),
            ]],
            [self::KEY . 'active_member_note', ['days' => (string) ($facts['window_days'] ?? '')]],
        ];
        if ($closing !== null) {
            $paragraphs[] = $closing;
        }

        $admins = self::admins($tenantId);
        $counts = self::deliverCounted($admins, $about['name'], self::KEY . "{$stage}_subject", self::KEY . "{$stage}_title", $paragraphs, $theme, '/admin');

        if ($tellPayee) {
            $counts = self::add($counts, self::toPayeesCounted($tenantId, $about, $admins, self::KEY . "{$stage}_subject", self::KEY . "{$stage}_title", $paragraphs, $theme));
        }

        return $counts;
    }

    /**
     * The community, who it pays and that payee's name (null = the platform).
     *
     * @return array{id:int, name:string, parent_id:?int, pays_parent:bool, payee_name:?string}|null
     */
    private static function community(int $tenantId): ?array
    {
        $community = DB::table('tenants')->where('id', $tenantId)->first(['id', 'name', 'parent_id']);
        if (!$community) {
            return null;
        }

        $parentId = $community->parent_id !== null ? (int) $community->parent_id : null;
        $paysParent = BillingStandingService::get($tenantId)['payer'] === 'parent' && $parentId !== null;
        $payeeName = $paysParent ? DB::table('tenants')->where('id', $parentId)->value('name') : null;

        return [
            'id' => $tenantId,
            'name' => (string) $community->name,
            'parent_id' => $parentId,
            'pays_parent' => $paysParent,
            'payee_name' => $payeeName !== null ? (string) $payeeName : null,
        ];
    }

    private static function admins(int $tenantId): Collection
    {
        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNotNull('email')
            ->where(static function ($query): void {
                $query->whereIn('role', ['admin', 'tenant_admin'])
                    ->orWhere('is_admin', 1)
                    ->orWhere('is_tenant_super_admin', 1)
                    ->orWhere('is_super_admin', 1);
            })
            ->get(['id', 'tenant_id', 'email', 'first_name', 'name', 'preferred_language']);
    }

    /**
     * Whoever the community pays: the active tenant super admins of its direct
     * parent when it pays its parent, otherwise the platform team.
     *
     * @param array{id:int, name:string, parent_id:?int, pays_parent:bool, payee_name:?string} $about
     */
    private static function payees(array $about): Collection
    {
        if (!$about['pays_parent']) {
            return self::platformTeam();
        }

        return DB::table('users')
            ->where('status', 'active')
            ->whereNotNull('email')
            ->where('tenant_id', $about['parent_id'])
            ->where('is_tenant_super_admin', 1)
            ->get(['id', 'tenant_id', 'email', 'first_name', 'name', 'preferred_language']);
    }

    /** Active platform team members: `is_god` AND `is_super_admin`. */
    private static function platformTeam(): Collection
    {
        return DB::table('users')
            ->where('status', 'active')
            ->whereNotNull('email')
            ->where('is_god', 1)
            ->where('is_super_admin', 1)
            ->get(['id', 'tenant_id', 'email', 'first_name', 'name', 'preferred_language']);
    }

    /**
     * Mail whoever the community pays, leaving out anyone already told as one
     * of its admins.
     *
     * @param array{id:int, name:string, parent_id:?int, pays_parent:bool, payee_name:?string} $about
     * @param list<array{0:string, 1:array<string, string|\Closure>}> $paragraphs
     * @param array<string, string> $subjectParams
     */
    private static function toPayees(
        int $tenantId,
        array $about,
        Collection $admins,
        string $subjectKey,
        string $titleKey,
        array $paragraphs,
        string $theme,
        array $subjectParams = []
    ): int {
        return self::toPayeesCounted($tenantId, $about, $admins, $subjectKey, $titleKey, $paragraphs, $theme, $subjectParams)['tried'];
    }

    /**
     * toPayees(), with the mailer's answer as deliverCounted() gives it.
     *
     * @param array{id:int, name:string, parent_id:?int, pays_parent:bool, payee_name:?string} $about
     * @param list<array{0:string, 1:array<string, string|\Closure>}> $paragraphs
     * @param array<string, string> $subjectParams
     * @return array{tried:int, accepted:int}
     */
    private static function toPayeesCounted(
        int $tenantId,
        array $about,
        Collection $admins,
        string $subjectKey,
        string $titleKey,
        array $paragraphs,
        string $theme,
        array $subjectParams = []
    ): array {
        if ($about['pays_parent']) {
            $note = [self::KEY . 'payee_note_parent', ['community' => $about['name']]];
            $path = '/super-admin/branch-payments';
        } else {
            $note = [self::KEY . 'payee_note_platform', ['community' => $about['name']]];
            $path = '/platform-team/billing';
        }

        $everyPayee = self::payees($about);

        // A community that pays its parent, where the parent has nobody who
        // manages its communities' payments: the notice used to go to no one
        // but the community itself. The platform team is told instead, and
        // told why it is reading it.
        if ($about['pays_parent'] && $everyPayee->isEmpty()) {
            Log::warning('[BillingStandingNotifier] a community pays a parent that has no manager; the platform team is told instead', [
                'tenant_id' => $tenantId,
                'parent_id' => $about['parent_id'],
            ]);
            $everyPayee = self::platformTeam();
            $note = [self::KEY . 'payee_note_no_manager', [
                'community' => $about['name'],
                'payee' => (string) ($about['payee_name'] ?? ''),
            ]];
            $path = '/platform-team/billing';
        }

        $alreadyTold = $admins->pluck('id')->map(static fn ($id): int => (int) $id)->all();
        $payees = $everyPayee
            ->reject(static fn ($person): bool => in_array((int) $person->id, $alreadyTold, true))
            ->values();

        $paragraphs[] = $note;

        return self::deliverCounted($payees, $about['name'], $subjectKey, $titleKey, $paragraphs, $theme, $path, $subjectParams);
    }

    /**
     * @param list<array{0:string, 1:array<string, string|\Closure>}> $paragraphs
     * @param array<string, string> $subjectParams
     */
    private static function deliver(
        Collection $people,
        string $communityName,
        string $subjectKey,
        string $titleKey,
        array $paragraphs,
        string $theme,
        string $path,
        array $subjectParams = []
    ): int {
        return self::deliverCounted($people, $communityName, $subjectKey, $titleKey, $paragraphs, $theme, $path, $subjectParams)['tried'];
    }

    /**
     * deliver(), also saying how many sends the mailer accepted. `tried` is
     * every person a send was attempted for; `accepted` those for whom
     * EmailDispatchService answered true. A provider outage does not throw
     * (the dispatch service catches it and answers false), so a caller that
     * records a notice as sent must read `accepted`, not `tried`.
     *
     * @param list<array{0:string, 1:array<string, string|\Closure>}> $paragraphs
     * @param array<string, string> $subjectParams
     * @return array{tried:int, accepted:int}
     */
    private static function deliverCounted(
        Collection $people,
        string $communityName,
        string $subjectKey,
        string $titleKey,
        array $paragraphs,
        string $theme,
        string $path,
        array $subjectParams = []
    ): array {
        if ($people->isEmpty()) {
            return ['tried' => 0, 'accepted' => 0];
        }

        // Bodies are HTML: every value put into one is escaped. The subject is
        // plain text: the community's name as it is. A value given as a
        // closure (a sum of money, a number) is worked out inside each
        // reader's locale, so it is written the way that reader writes it.
        $safeParagraphs = static function () use ($paragraphs): array {
            $out = [];
            foreach ($paragraphs as [$key, $params]) {
                $safe = [];
                foreach ($params as $name => $value) {
                    $text = $value instanceof \Closure ? (string) $value() : (string) $value;
                    $safe[$name] = htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
                }
                $out[] = [$key, $safe];
            }

            return $out;
        };
        $subjectParams = ['community' => $communityName] + $subjectParams;

        $tried = 0;
        $accepted = 0;
        foreach ($people->groupBy('tenant_id') as $contextTenantId => $group) {
            /** @var array{tried:int, accepted:int} $counts */
            $counts = TenantContext::runForTenant((int) $contextTenantId, static function () use ($group, $subjectKey, $subjectParams, $titleKey, $safeParagraphs, $theme, $path): array {
                $url = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $path;
                $count = 0;
                $ok = 0;

                foreach ($group as $person) {
                    $took = LocaleContext::withLocale($person, static function () use ($person, $subjectKey, $subjectParams, $titleKey, $safeParagraphs, $theme, $url): bool {
                        $builder = EmailTemplateBuilder::make();
                        if ($theme !== 'default') {
                            $builder->theme($theme);
                        }

                        $builder
                            ->title(__($titleKey))
                            ->greeting($person->first_name ?? $person->name ?? __('emails.common.fallback_name'));
                        foreach ($safeParagraphs() as [$key, $params]) {
                            $builder->paragraph(__($key, $params));
                        }

                        return EmailDispatchService::sendRaw(
                            (string) $person->email,
                            __($subjectKey, $subjectParams),
                            $builder->button(__('emails_misc.billing_standing.cta'), $url)->render(),
                            null,
                            null,
                            null,
                            'billing',
                            ['tenant_id' => (int) $person->tenant_id]
                        );
                    });

                    // `tried` counts every send that could reach a mail
                    // provider, whatever it then said; `accepted` only what
                    // the mailer took. An address the dispatcher refuses
                    // before the transport (empty, or a reserved domain that
                    // can never be delivered) is nobody to wait for, so it is
                    // not counted as tried: a community whose only contacts
                    // are like that is treated as having nobody to tell.
                    $routable = trim((string) $person->email) !== ''
                        && !EmailDispatchService::isUnroutableRecipient((string) $person->email);
                    if ($routable) {
                        $count++;
                    }

                    if ($took && $routable) {
                        $ok++;
                    } elseif ($routable) {
                        Log::warning('[BillingStandingNotifier] billing notice was not accepted by the mailer', [
                            'tenant_id' => (int) $person->tenant_id,
                            'user_id' => (int) $person->id,
                        ]);
                    }
                }

                return ['tried' => $count, 'accepted' => $ok];
            });
            $tried += (int) ($counts['tried'] ?? 0);
            $accepted += (int) ($counts['accepted'] ?? 0);
        }

        return ['tried' => $tried, 'accepted' => $accepted];
    }
}
