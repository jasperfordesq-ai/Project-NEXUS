<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Services\TenantFeatureConfig;
use Illuminate\Support\Facades\DB;

/**
 * Platform team panel → Unfinished features.
 *
 * Every feature the admin Features page marks as an early test (alpha) or a
 * late test (beta), plus every feature that is off unless a community
 * switches it on (`TenantFeatureConfig::FEATURE_DEFAULTS` false), and which
 * communities have each one on. "On" is worked out exactly as the platform
 * works it out: what the community stored, laid over the defaults
 * (`TenantFeatureConfig::mergeFeatures()`), as CommunitiesAtAGlanceService
 * does. Every community is counted, switched off or not.
 *
 * 🔴 Read-only. A switch is changed where it always was, in that community's
 * own admin panel.
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter. Correct only because
 * nothing below the platform team can call it. It reads no member data at
 * all: community names and switches only.
 */
final class UnfinishedFeaturesService
{
    /**
     * The server's copy of the module-level `stage` in
     * react-frontend/src/admin/modules/config/moduleRegistry.ts (the API image
     * does not ship react-frontend/). UnfinishedFeaturesTest fails when the two
     * disagree in either direction; refresh this from the registry.
     * Option-level stages (one setting inside a feature) are not features and
     * are not copied.
     */
    public const STAGES = [
        'public_events' => 'beta',
        'event_attendance_credits' => 'beta',
        'partner_venues' => 'beta',
        'caring_community' => 'alpha',
        'courses' => 'beta',
        'podcasts' => 'beta',
    ];

    /**
     * feature => note key the page shows beside it. Caring Community is an
     * unfinished alpha the owner has ruled is never to be used or switched on
     * (26 Oct 2026); it is listed so a community that has it on is seen, and
     * says so, with nothing that links to it.
     */
    private const NOTES = [
        'caring_community' => 'not_for_use',
    ];

    private const STAGE_ORDER = ['alpha' => 0, 'beta' => 1];

    /**
     * @return array{features: list<array{
     *   key: string,
     *   stage: 'alpha'|'beta'|null,
     *   default_on: bool,
     *   note: string|null,
     *   communities_on: list<array{id: int, name: string}>,
     *   count: int
     * }>}
     */
    public function overview(): array
    {
        $keys = array_keys(self::STAGES);
        foreach (TenantFeatureConfig::FEATURE_DEFAULTS as $key => $on) {
            if ($on === false && !in_array($key, $keys, true)) {
                $keys[] = $key;
            }
        }

        /** @var array<string, list<array{id: int, name: string}>> $on */
        $on = array_fill_keys($keys, []);
        foreach (DB::table('tenants')->orderBy('name')->orderBy('id')->get(['id', 'name', 'features']) as $tenant) {
            $merged = TenantFeatureConfig::mergeFeatures(self::decode($tenant->features));
            foreach ($keys as $key) {
                if (!empty($merged[$key])) {
                    $on[$key][] = ['id' => (int) $tenant->id, 'name' => (string) $tenant->name];
                }
            }
        }

        $rows = [];
        foreach ($keys as $key) {
            $rows[] = [
                'key' => $key,
                'stage' => self::STAGES[$key] ?? null,
                'default_on' => (bool) (TenantFeatureConfig::FEATURE_DEFAULTS[$key] ?? false),
                'note' => self::NOTES[$key] ?? null,
                'communities_on' => $on[$key],
                'count' => count($on[$key]),
            ];
        }

        // Early tests first, then late tests, then the rest; by key within each.
        usort($rows, static function (array $a, array $b): int {
            $rankA = self::STAGE_ORDER[$a['stage'] ?? ''] ?? 2;
            $rankB = self::STAGE_ORDER[$b['stage'] ?? ''] ?? 2;

            return [$rankA, $a['key']] <=> [$rankB, $b['key']];
        });

        return ['features' => $rows];
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
