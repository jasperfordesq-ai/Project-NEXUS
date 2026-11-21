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
     * @param array<string, int|string|null> $facts active_members, max_users, plan_name, window_days
     */
    public static function limitApproaching(int $tenantId, array $facts): int
    {
        return self::limitNotice($tenantId, $facts, 'limit_approaching', false, null, 'default');
    }

    /**
     * @param array<string, int|string|null> $facts active_members, max_users, plan_name, window_days
     */
    public static function limitReached(int $tenantId, array $facts): int
    {
        return self::limitNotice($tenantId, $facts, 'limit_reached', true, null, 'warning');
    }

    /**
     * Over the limit. With a `pause_date` the community will be paused on it
     * if still over; without one, going over only warns.
     *
     * @param array<string, int|string|null> $facts active_members, max_users, plan_name, window_days, pause_date?
     */
    public static function limitOver(int $tenantId, array $facts): int
    {
        $pauseDate = isset($facts['pause_date']) ? (string) $facts['pause_date'] : null;
        $closing = $pauseDate !== null
            ? [self::KEY . 'limit_over_will_pause', ['date' => $pauseDate]]
            : [self::KEY . 'limit_over_warn_only', []];

        return self::limitNotice($tenantId, $facts, 'limit_over', true, $closing, 'warning');
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
    private static function paymentNotice(int $tenantId, array $facts, string $stage, bool $tellPayee, string $theme): int
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

        $admins = self::admins($tenantId);
        $subjectParams = ['date' => $params['date'], 'pause_date' => $params['pause_date']];

        $sent = self::deliver($admins, $about['name'], self::KEY . "{$stage}_subject", self::KEY . "{$stage}_title", [$body, $payTo], $theme, '/admin', $subjectParams);

        if ($tellPayee) {
            $sent += self::toPayees($tenantId, $about, $admins, self::KEY . "{$stage}_subject", self::KEY . "{$stage}_title", [$body], $theme, $subjectParams);
        }

        return $sent;
    }

    /**
     * @param array<string, int|string|null> $facts
     * @param array{0:string, 1:array<string, string>}|null $closing
     */
    private static function limitNotice(int $tenantId, array $facts, string $stage, bool $tellPayee, ?array $closing, string $theme): int
    {
        $about = self::community($tenantId);
        if ($about === null) {
            return 0;
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
        $sent = self::deliver($admins, $about['name'], self::KEY . "{$stage}_subject", self::KEY . "{$stage}_title", $paragraphs, $theme, '/admin');

        if ($tellPayee) {
            $sent += self::toPayees($tenantId, $about, $admins, self::KEY . "{$stage}_subject", self::KEY . "{$stage}_title", $paragraphs, $theme);
        }

        return $sent;
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
        if ($about['pays_parent']) {
            $note = [self::KEY . 'payee_note_parent', ['community' => $about['name']]];
            $path = '/super-admin/branch-payments';
        } else {
            $note = [self::KEY . 'payee_note_platform', ['community' => $about['name']]];
            $path = '/platform-team/billing';
        }

        $alreadyTold = $admins->pluck('id')->map(static fn ($id): int => (int) $id)->all();
        $payees = self::payees($about)
            ->reject(static fn ($person): bool => in_array((int) $person->id, $alreadyTold, true))
            ->values();

        $paragraphs[] = $note;

        return self::deliver($payees, $about['name'], $subjectKey, $titleKey, $paragraphs, $theme, $path, $subjectParams);
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
        if ($people->isEmpty()) {
            return 0;
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

        $sent = 0;
        foreach ($people->groupBy('tenant_id') as $contextTenantId => $group) {
            $sent += (int) TenantContext::runForTenant((int) $contextTenantId, static function () use ($group, $subjectKey, $subjectParams, $titleKey, $safeParagraphs, $theme, $path): int {
                $url = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $path;
                $count = 0;

                foreach ($group as $person) {
                    $ok = LocaleContext::withLocale($person, static function () use ($person, $subjectKey, $subjectParams, $titleKey, $safeParagraphs, $theme, $url): bool {
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

                    // Counted when it reached the mailer, whatever the provider said.
                    $count++;

                    if (!$ok) {
                        Log::warning('[BillingStandingNotifier] billing notice was not accepted by the mailer', [
                            'tenant_id' => (int) $person->tenant_id,
                            'user_id' => (int) $person->id,
                        ]);
                    }
                }

                return $count;
            });
        }

        return $sent;
    }
}
