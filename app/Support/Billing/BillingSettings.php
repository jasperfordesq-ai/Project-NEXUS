<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use App\Services\TenantBillingService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The platform team's numbers for the daily billing check.
 *
 * One row per changed setting in `platform_billing_settings`; a missing row is
 * the default below. The defaults are the safe ones to deploy: the check is
 * switched off, and going over the member limit only warns. The day counts
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

    public const OVER_LIMIT_ACTIONS = ['none', 'pause'];

    /** @var array<string, int|bool|string> */
    public const DEFAULTS = [
        'automation_enabled' => false,
        'reminder_days_before' => 7,
        'final_warning_days_late' => 7,
        'suspend_days_late' => 14,
        'limit_warning_percent' => 80,
        'over_limit_action' => 'none',
        'over_limit_grace_days' => 30,
    ];

    /** Inclusive ranges for the whole-number settings. */
    private const RANGES = [
        'reminder_days_before' => [0, 60],
        'final_warning_days_late' => [1, 180],
        'suspend_days_late' => [1, 365],
        'limit_warning_percent' => [50, 99],
        'over_limit_grace_days' => [1, 365],
    ];

    private static bool $cacheFailureReported = false;

    /**
     * Every setting, typed: `automation_enabled` bool, `over_limit_action`
     * string, the rest whole numbers.
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
