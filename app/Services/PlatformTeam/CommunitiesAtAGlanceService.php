<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Services\PlatformCapabilityService;
use App\Services\TenantFeatureConfig;
use Illuminate\Support\Facades\DB;

/**
 * Platform team panel → Communities at a glance.
 *
 * Every community against every optional feature and every core part: on or
 * off, worked out exactly as the platform itself works it out
 * (`TenantContext::hasFeature()` / `hasModule()`: what the community stored,
 * laid over `TenantFeatureConfig`'s defaults).
 *
 * 🔴 Read-only. A switch is changed where it always was, in that community's
 * own admin panel. One place per setting: this page must never grow an edit
 * control.
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter. Correct only because
 * nothing below the platform team can call it. It reads no member data at
 * all: community names and switches only.
 *
 * `held_platform_wide` lists the features a platform-wide switch is holding
 * off right now, so "on" in a community's column is not read as "working".
 * Only one feature has such a switch today (FEATURE_NEEDS_PLATFORM_SWITCH);
 * the other platform switches are rollout gates inside the events feature
 * and have no community switch of their own.
 */
final class CommunitiesAtAGlanceService
{
    /**
     * Not a column. An unfinished alpha feature the owner has ruled is never
     * to be used, referenced or switched on (26 Oct 2026); a grid that showed
     * it as a normal switch would present it as one.
     */
    private const HIDDEN_FEATURES = ['caring_community'];

    /**
     * community feature => the platform capability that must also be on.
     * See App\Services\EventCreditService: attendance rewards need both.
     */
    private const FEATURE_NEEDS_PLATFORM_SWITCH = [
        'event_attendance_credits' => 'attendance_credits',
    ];

    /** @return list<string> the feature columns, in the order the platform defines them */
    public static function features(): array
    {
        return array_values(array_diff(array_keys(TenantFeatureConfig::FEATURE_DEFAULTS), self::HIDDEN_FEATURES));
    }

    /**
     * @return array{
     *   features: list<string>,
     *   modules: list<string>,
     *   held_platform_wide: list<string>,
     *   communities: list<array<string, mixed>>
     * }
     */
    public function grid(): array
    {
        $features = self::features();
        $modules = array_keys(TenantFeatureConfig::MODULE_DEFAULTS);

        $communities = [];
        foreach (DB::table('tenants')->orderBy('name')->orderBy('id')->get(['id', 'name', 'slug', 'is_active', 'features', 'configuration']) as $tenant) {
            $storedFeatures = self::decode($tenant->features);
            $configuration = self::decode($tenant->configuration);
            $storedModules = is_array($configuration['modules'] ?? null) ? $configuration['modules'] : null;

            $allFeatures = TenantFeatureConfig::mergeFeatures($storedFeatures);
            $allModules = TenantFeatureConfig::mergeModules($storedModules);

            $communities[] = [
                'id' => (int) $tenant->id,
                'name' => (string) $tenant->name,
                'slug' => $tenant->slug !== null ? (string) $tenant->slug : null,
                'active' => !empty($tenant->is_active),
                // Only the columns: a stored key the platform does not define
                // (left behind by old code) is not a switch and is not sent.
                'features' => array_combine($features, array_map(
                    static fn (string $key): bool => !empty($allFeatures[$key]),
                    $features,
                )),
                'modules' => array_combine($modules, array_map(
                    static fn (string $key): bool => !empty($allModules[$key]),
                    $modules,
                )),
            ];
        }

        return [
            'features' => $features,
            'modules' => $modules,
            'held_platform_wide' => $this->heldPlatformWide(),
            'communities' => $communities,
        ];
    }

    /** @return list<string> */
    private function heldPlatformWide(): array
    {
        $state = [];
        foreach ((new PlatformCapabilityService())->inspect() as $row) {
            $state[$row['capability']] = $row['value'];
        }

        $held = [];
        foreach (self::FEATURE_NEEDS_PLATFORM_SWITCH as $feature => $capability) {
            $definition = PlatformCapabilityService::CAPABILITIES[$capability] ?? null;
            if ($definition === null || !array_key_exists($capability, $state)) {
                continue;
            }
            $off = $definition['type'] === 'bool' ? '0' : ($definition['off'] ?? 'off');
            if ($state[$capability] === $off) {
                $held[] = $feature;
            }
        }

        return $held;
    }

    /** @return array<string, mixed>|null */
    private static function decode(mixed $json): ?array
    {
        if (!is_string($json) || $json === '') {
            return null;
        }
        $decoded = json_decode($json, true);

        return is_array($decoded) ? $decoded : null;
    }
}
