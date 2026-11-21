<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use App\Services\BillingStandingService;
use App\Services\TenantBillingService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The platform team's numbers for the daily billing check.
 *
 * One row per changed setting in `platform_billing_settings`; a missing row is
 * the default below. The defaults are the safe ones to deploy: the check is
 * switched off, so nothing happens until the platform team turns it on; then
 * going over the member limit pauses after the days (owner, 21 Nov 2026). The day counts
 * are the design's placeholders; the owner sets the real ones.
 *
 * Every change is checked as a whole before anything is written (the pause day
 * must stay after the final warning), and audited in `billing_audit_log` under
 * tenant 0, which is "the platform", not a community.
 *
 * A bad key or value throws `\DomainException('billing_setting_invalid')`.
 */
final class BillingSettings
{
    public const CACHE_KEY = 'billing_settings:all';

    public const CACHE_TTL = 60;

    /** The platform default rule for going over a member number (OverLimitRule::ACTIONS). */
    public const OVER_LIMIT_ACTIONS = ['none', 'block_joining', 'pause', 'upgrade'];

    /**
     * `reminder_days` is a list of days before the paid-until date, stored as
     * a string ("30,14,7,1", largest first; "" = no reminders). It replaced the
     * single `reminder_days_before` (owner, 20 Nov 2026: warnings from a month
     * before, then in steps). A stored row under the old key is ignored.
     *
     * `card_retry_max_days_late` is the longest a card payer Stripe is still
     * retrying is waited for before the normal pause applies.
     *
     * @var array<string, int|bool|string>
     */
    public const DEFAULTS = [
        'automation_enabled' => false,
        'reminder_days' => '30,14,7,1',
        'final_warning_days_late' => 7,
        'suspend_days_late' => 14,
        'card_retry_max_days_late' => 30,
        'limit_warning_percent' => 80,
        // Owner, 21 Nov 2026: a community that stays over its member number
        // is paused. Only a missing row takes this; a stored `none` on an
        // existing installation stays `none`.
        'over_limit_action' => 'pause',
        'over_limit_grace_days' => 30,
    ];

    /** Inclusive ranges for the whole-number settings. */
    private const RANGES = [
        'final_warning_days_late' => [1, 180],
        'suspend_days_late' => [1, 365],
        'card_retry_max_days_late' => [1, 180],
        'limit_warning_percent' => [50, 99],
        'over_limit_grace_days' => [1, 365],
    ];

    /** Each reminder day's inclusive range, and how many there may be. */
    private const REMINDER_DAY_RANGE = [1, 120];

    private const REMINDER_DAYS_MAX = 8;

    private static bool $cacheFailureReported = false;

    /**
     * Every setting, typed: `automation_enabled` bool, `reminder_days` and
     * `over_limit_action` strings, the rest whole numbers.
     *
     * @return array<string, int|bool|string>
     */
    public static function all(): array
    {
        try {
            $cached = Cache::get(self::CACHE_KEY);
        } catch (\Throwable $e) {
            self::reportCacheFailure($e);

            return self::read();
        }

        if (is_array($cached) && array_keys($cached) === array_keys(self::DEFAULTS)) {
            return $cached;
        }

        $settings = self::read();

        try {
            Cache::put(self::CACHE_KEY, $settings, self::CACHE_TTL);
        } catch (\Throwable $e) {
            self::reportCacheFailure($e);
        }

        return $settings;
    }

    public static function get(string $key): int|bool|string
    {
        if (!array_key_exists($key, self::DEFAULTS)) {
            throw new \DomainException('billing_setting_invalid');
        }

        return self::all()[$key];
    }

    /**
     * The reminder days before the paid-until date, largest first. Empty
     * when the platform team chose no reminders.
     *
     * @return list<int>
     */
    public static function reminderDays(): array
    {
        $value = (string) self::get('reminder_days');
        if ($value === '') {
            return [];
        }

        return array_map('intval', explode(',', $value));
    }

    public static function set(string $key, mixed $value, ?int $userId): void
    {
        self::setMany([$key => $value], $userId);
    }

    /**
     * Change several settings at once. Checked together: either every value
     * is saved, or none is.
     *
     * @param array<string, mixed> $values
     */
    public static function setMany(array $values, ?int $userId): void
    {
        $current = self::read();
        $next = $current;

        foreach ($values as $key => $value) {
            if (!is_string($key) || !array_key_exists($key, self::DEFAULTS)) {
                throw new \DomainException('billing_setting_invalid');
            }
            $next[$key] = self::normalise($key, $value);
        }

        if ($next['suspend_days_late'] <= $next['final_warning_days_late']) {
            throw new \DomainException('billing_setting_invalid');
        }

        $now = now();
        DB::transaction(static function () use ($current, $next, $userId, $now): void {
            foreach ($next as $key => $value) {
                if ($current[$key] === $value) {
                    continue;
                }

                $row = [
                    'setting_value' => self::store($value),
                    'updated_by_user_id' => $userId,
                    'updated_at' => $now,
                ];
                if (DB::table('platform_billing_settings')->where('setting_key', $key)->exists()) {
                    DB::table('platform_billing_settings')->where('setting_key', $key)->update($row);
                } else {
                    DB::table('platform_billing_settings')->insert($row + ['setting_key' => $key, 'created_at' => $now]);
                }

                TenantBillingService::logAudit(
                    0,
                    $userId,
                    'billing_setting_changed',
                    [$key => $current[$key]],
                    [$key => $value],
                    null
                );
            }
            // A changed platform rule or day count clears no count here: the
            // daily check sees from each community's terms key
            // (OverLimitRule::termsKey()) whether it follows this default, and
            // restarts only those, with a fresh notice.

            // Switching the automatic checks ON starts every member-limit
            // count afresh, so the first run warns before it pauses: a count
            // kept from before (or run on while the switch was off) would
            // pause at once on a notice weeks old, though the screens said
            // nothing would happen while the checks were off. Switching off,
            // or saving with the switch unchanged, does nothing here.
            if (!$current['automation_enabled'] && $next['automation_enabled']) {
                BillingStandingService::restartAllLimitClocks();
                // The payment warnings too: a "final warning" recorded before
                // the checks were switched off would otherwise pause on the
                // first run, weeks or months later, with no fresh notice.
                BillingStandingService::restartPaymentClock(null);
            }
        });

        self::flush();
    }

    /** Forget the cached copy. */
    public static function flush(): void
    {
        try {
            Cache::forget(self::CACHE_KEY);
        } catch (\Throwable $e) {
            self::reportCacheFailure($e);
        }
        JoiningGate::flush(); // the switch or the platform rule may have changed
    }

    /**
     * The stored values over the defaults. A stored value that no longer
     * passes the checks (edited by hand, or a range narrowed later) falls back
     * to the default and is logged: the check must never run on a nonsense
     * number, and must never stop because of one.
     *
     * @return array<string, int|bool|string>
     */
    private static function read(): array
    {
        $settings = self::DEFAULTS;

        $rows = DB::table('platform_billing_settings')->get(['setting_key', 'setting_value']);
        foreach ($rows as $row) {
            $key = (string) $row->setting_key;
            if (!array_key_exists($key, self::DEFAULTS)) {
                continue;
            }

            try {
                $settings[$key] = self::normalise($key, (string) $row->setting_value);
            } catch (\DomainException) {
                Log::error('[BillingSettings] stored value is not valid; using the default', [
                    'setting_key' => $key,
                ]);
            }
        }

        return $settings;
    }

    private static function normalise(string $key, mixed $value): int|bool|string
    {
        if ($key === 'automation_enabled') {
            if (is_bool($value)) {
                return $value;
            }
            if ($value === 1 || $value === '1' || $value === 'true') {
                return true;
            }
            if ($value === 0 || $value === '0' || $value === 'false') {
                return false;
            }

            throw new \DomainException('billing_setting_invalid');
        }

        if ($key === 'over_limit_action') {
            if (is_string($value) && in_array($value, self::OVER_LIMIT_ACTIONS, true)) {
                return $value;
            }

            throw new \DomainException('billing_setting_invalid');
        }

        if ($key === 'reminder_days') {
            return self::normaliseReminderDays($value);
        }

        if (is_string($value) && preg_match('/^\d{1,6}$/', $value) === 1) {
            $value = (int) $value;
        }
        if (!is_int($value)) {
            throw new \DomainException('billing_setting_invalid');
        }

        [$min, $max] = self::RANGES[$key];
        if ($value < $min || $value > $max) {
            throw new \DomainException('billing_setting_invalid');
        }

        return $value;
    }

    /**
     * "7, 30,14" or [7, 30, 14] → "30,14,7". Whole numbers 1 to 120, each
     * once, largest first, at most eight. An empty string or list is "no
     * reminders". A gap between commas, a fraction or a word is refused
     * rather than guessed at.
     *
     * Null is "no reminders" too: Laravel turns an empty string in a request
     * into null before the controller sees it, so an emptied field arrives
     * as null.
     */
    private static function normaliseReminderDays(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        if (is_string($value)) {
            $value = trim($value);
            $parts = $value === '' ? [] : array_map('trim', explode(',', $value));
        } elseif (is_array($value) && array_is_list($value)) {
            $parts = $value;
        } else {
            throw new \DomainException('billing_setting_invalid');
        }

        [$min, $max] = self::REMINDER_DAY_RANGE;
        $days = [];
        foreach ($parts as $part) {
            if (is_string($part) && preg_match('/^\d{1,4}$/', $part) === 1) {
                $part = (int) $part;
            }
            if (!is_int($part) || $part < $min || $part > $max) {
                throw new \DomainException('billing_setting_invalid');
            }
            $days[$part] = $part;
        }

        if (count($days) > self::REMINDER_DAYS_MAX) {
            throw new \DomainException('billing_setting_invalid');
        }

        rsort($days);

        return implode(',', $days);
    }

    private static function store(int|bool|string $value): string
    {
        if (is_bool($value)) {
            return $value ? '1' : '0';
        }

        return (string) $value;
    }

    private static function reportCacheFailure(\Throwable $e): void
    {
        if (self::$cacheFailureReported) {
            return;
        }

        self::$cacheFailureReported = true;
        Log::error('[BillingSettings] cache unavailable; reading settings from the database', [
            'error' => $e->getMessage(),
        ]);
    }
}
