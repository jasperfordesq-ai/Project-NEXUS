<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Support\Tenancy\TenantSubtree;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Which "Powered by" badge a community's footer shows.
 *
 * Three sources, first match wins:
 *
 *   1. The community's OWN badge (`general.powered_by_*`).
 *   2. The NETWORK badge (`general.network_powered_by_*`) of its nearest
 *      ancestor that has one. A hub sets this once and every community below
 *      it — at any depth, including communities created later — shows it. The
 *      hub's own footer is unaffected: a network badge is for the communities
 *      UNDER it, never for itself.
 *   3. Nothing, in which case both frontends fall back to the built-in
 *      Project NEXUS badge.
 *
 * Resolution is per GROUP, not per field. A community that has set any of its
 * own badge fields uses only its own; it never borrows the image from one
 * source and the link from another, which would put one organisation's logo
 * in front of another organisation's website.
 *
 * Every key is platform-god only to change (AdminConfigController).
 */
final class PoweredByBadgeService
{
    /** Public config keys the footers read, in bootstrap `config`. */
    public const BADGE_FIELDS = [
        'powered_by_label',
        'powered_by_url',
        'powered_by_image_light',
        'powered_by_image_dark',
    ];

    /** Prefix that turns a badge field into its network (inherited) twin. */
    public const NETWORK_PREFIX = 'network_';

    /**
     * Every general setting this feature owns, own and network, without the
     * `general.` prefix.
     *
     * @return list<string>
     */
    public static function allSettingKeys(): array
    {
        return array_merge(self::BADGE_FIELDS, self::networkSettingKeys());
    }

    /** @return list<string> */
    public static function networkSettingKeys(): array
    {
        return array_map(static fn (string $f): string => self::NETWORK_PREFIX . $f, self::BADGE_FIELDS);
    }

    /**
     * The badge fields to publish for $tenantId: a subset of BADGE_FIELDS with
     * non-empty values, or [] for the built-in default.
     *
     * @return array<string, string>
     */
    public static function resolveForTenant(int $tenantId): array
    {
        if ($tenantId <= 0) {
            return [];
        }

        try {
            $own = self::readFields($tenantId, self::BADGE_FIELDS);
            if ($own !== []) {
                return $own;
            }

            $ancestors = TenantSubtree::ancestorIds($tenantId);
            if ($ancestors === []) {
                return [];
            }

            $rows = DB::table('tenant_settings')
                ->whereIn('tenant_id', $ancestors)
                ->whereIn('setting_key', self::prefixed(self::networkSettingKeys()))
                ->select('tenant_id', 'setting_key', 'setting_value')
                ->get();

            $byTenant = [];
            foreach ($rows as $row) {
                $value = trim((string) ($row->setting_value ?? ''));
                if ($value === '') {
                    continue;
                }
                $field = substr((string) $row->setting_key, strlen('general.' . self::NETWORK_PREFIX));
                $byTenant[(int) $row->tenant_id][$field] = $value;
            }

            foreach ($ancestors as $ancestorId) {
                if (!empty($byTenant[$ancestorId])) {
                    return self::ordered($byTenant[$ancestorId]);
                }
            }

            return [];
        } catch (\Throwable $e) {
            // The footer badge must never break bootstrap. Falling back to the
            // built-in default is visible and harmless; log so it is not silent.
            Log::error('[PoweredByBadgeService] badge resolution failed', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);

            return [];
        }
    }

    /**
     * Communities whose cached bootstrap may show $tenantId's network badge:
     * every active descendant.
     *
     * @return list<int>
     */
    public static function inheritingTenantIds(int $tenantId): array
    {
        return TenantSubtree::descendantIds($tenantId);
    }

    /**
     * @param list<string> $fields
     * @return array<string, string>
     */
    private static function readFields(int $tenantId, array $fields): array
    {
        $rows = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->whereIn('setting_key', self::prefixed($fields))
            ->pluck('setting_value', 'setting_key');

        $out = [];
        foreach ($rows as $key => $value) {
            $value = trim((string) ($value ?? ''));
            if ($value !== '') {
                $out[substr((string) $key, strlen('general.'))] = $value;
            }
        }

        return self::ordered($out);
    }

    /**
     * @param array<string, string> $fields
     * @return array<string, string>
     */
    private static function ordered(array $fields): array
    {
        $out = [];
        foreach (self::BADGE_FIELDS as $field) {
            if (isset($fields[$field])) {
                $out[$field] = $fields[$field];
            }
        }

        return $out;
    }

    /**
     * @param list<string> $keys
     * @return list<string>
     */
    private static function prefixed(array $keys): array
    {
        return array_map(static fn (string $k): string => 'general.' . $k, $keys);
    }
}
