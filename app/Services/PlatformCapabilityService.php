<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Platform rollout switches, settable by the platform owner from the UI.
 *
 * These used to be environment variables only, which meant raising a platform
 * gate required SSH access to the server. A stored override here wins over the
 * environment; no override means the environment still decides, so an empty
 * table behaves exactly as before.
 *
 * 🔴 SECURITY: only the capabilities in CAPABILITIES may be changed, and each
 * one names the exact config path it may write. An HTTP caller can never set an
 * arbitrary config key — the allowlist is the whole boundary.
 *
 * 🔴 SCOPE: these are boolean/mode ROLLOUT gates. The other capabilities shown
 * on the events settings screen (ticketing, agenda, offline sync, and so on)
 * are derived from whether their database tables exist — they report what is
 * INSTALLED and are not switches. Do not add them here; "turning off" a table
 * that exists would be a lie, and turning one "on" cannot conjure a schema.
 */
final class PlatformCapabilityService
{
    private const CACHE_KEY = 'platform_capability_overrides';

    private const CACHE_TTL = 300;

    /**
     * The switchable platform capabilities.
     *
     * type 'bool'  → stored as '1'/'0', written to config as a real boolean.
     * type 'enum'  → stored as one of `values`, written through verbatim.
     *
     * @var array<string, array{config:string, type:string, values?:list<string>, off?:string}>
     */
    public const CAPABILITIES = [
        'attendance_credits' => [
            'config' => 'events.attendance_credit_mode',
            'type' => 'enum',
            'values' => ['off', 'treasury'],
            'off' => 'off',
        ],
        'recurrence_v2' => [
            'config' => 'events.recurrence.engine_v2_enabled',
            'type' => 'bool',
        ],
        'rolling_recurrence' => [
            'config' => 'events.recurrence.materialization.enabled',
            'type' => 'bool',
        ],
        'recurrence_definition_blueprints' => [
            'config' => 'events.recurrence.definition_blueprints.enabled',
            'type' => 'bool',
        ],
        'timed_waitlist_offers' => [
            'config' => 'events.registration.timed_waitlist_offers_enabled',
            'type' => 'bool',
        ],
        'optional_analytics_capture' => [
            'config' => 'events.analytics.optional_capture_enabled',
            'type' => 'bool',
        ],
    ];

    /**
     * Stored overrides, keyed by capability.
     *
     * Fails OPEN to an empty set: if the table is missing (fresh install, or
     * mid-migration) or unreadable, the environment keeps deciding rather than
     * every rollout gate slamming shut.
     *
     * @return array<string, string>
     */
    public function overrides(): array
    {
        try {
            $cached = Cache::get(self::CACHE_KEY);
            if (is_array($cached)) {
                return $cached;
            }

            if (! Schema::hasTable('platform_capability_overrides')) {
                return [];
            }

            $rows = DB::table('platform_capability_overrides')
                ->pluck('value', 'capability')
                ->filter(static fn (mixed $value, mixed $key): bool => is_string($key)
                    && array_key_exists($key, self::CAPABILITIES))
                ->map(static fn (mixed $value): string => (string) $value)
                ->all();

            Cache::put(self::CACHE_KEY, $rows, self::CACHE_TTL);

            return $rows;
        } catch (\Throwable $exception) {
            Log::warning('Platform capability overrides unreadable; using environment values', [
                'error' => $exception->getMessage(),
            ]);

            return [];
        }
    }

    /**
     * Apply stored overrides onto the runtime config.
     *
     * Called once per request from a service provider, so every existing
     * config('events...') read picks the override up without a single call site
     * changing. Only capabilities WITH a stored row are touched — which is also
     * why tests are unaffected: they have no rows, so nothing is overwritten.
     */
    public function applyToConfig(): void
    {
        foreach ($this->overrides() as $capability => $value) {
            $definition = self::CAPABILITIES[$capability] ?? null;
            if ($definition === null) {
                continue;
            }

            if ($definition['type'] === 'bool') {
                config([$definition['config'] => $value === '1']);

                continue;
            }

            if (in_array($value, $definition['values'] ?? [], true)) {
                config([$definition['config'] => $value]);
            }
        }
    }

    /**
     * The current state of every switchable capability, for the admin screen.
     *
     * @return list<array{capability:string, type:string, values:list<string>, value:string, source:string, env_value:string}>
     */
    public function inspect(): array
    {
        $overrides = $this->overrides();
        $rows = [];

        foreach (self::CAPABILITIES as $capability => $definition) {
            // The env value is whatever config holds BEFORE overrides are
            // applied — but by request time they already are, so read it from
            // the definition's own default instead of guessing.
            $effective = config($definition['config']);
            $effectiveString = $definition['type'] === 'bool'
                ? ((bool) $effective ? '1' : '0')
                : (is_string($effective) ? $effective : ($definition['off'] ?? 'off'));

            $rows[] = [
                'capability' => $capability,
                'type' => $definition['type'],
                'values' => $definition['values'] ?? ['0', '1'],
                'value' => $overrides[$capability] ?? $effectiveString,
                'source' => array_key_exists($capability, $overrides) ? 'platform_override' : 'environment',
                'env_value' => $effectiveString,
            ];
        }

        return $rows;
    }

    /**
     * Store an override. Returns false when the capability or value is not
     * allowed, so the caller can answer 422 rather than silently doing nothing.
     */
    public function set(string $capability, string $value, int $actorUserId, ?string $reason = null): bool
    {
        $definition = self::CAPABILITIES[$capability] ?? null;
        if ($definition === null) {
            return false;
        }

        if ($definition['type'] === 'bool') {
            if (! in_array($value, ['0', '1'], true)) {
                return false;
            }
        } elseif (! in_array($value, $definition['values'] ?? [], true)) {
            return false;
        }

        DB::table('platform_capability_overrides')->updateOrInsert(
            ['capability' => $capability],
            [
                'value' => $value,
                'updated_by_user_id' => $actorUserId,
                'reason' => $reason !== null ? mb_substr(trim($reason), 0, 500) : null,
                'updated_at' => now(),
                'created_at' => now(),
            ],
        );

        Cache::forget(self::CACHE_KEY);

        Log::info('Platform capability changed', [
            'capability' => $capability,
            'value' => $value,
            'actor_user_id' => $actorUserId,
        ]);

        return true;
    }

    /** Drop an override so the environment decides again. */
    public function clear(string $capability): bool
    {
        if (! array_key_exists($capability, self::CAPABILITIES)) {
            return false;
        }

        DB::table('platform_capability_overrides')->where('capability', $capability)->delete();
        Cache::forget(self::CACHE_KEY);

        return true;
    }
}
