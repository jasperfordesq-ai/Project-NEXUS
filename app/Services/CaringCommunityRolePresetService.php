<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Installs KISS-style operational roles into the existing RBAC tables.
 */
class CaringCommunityRolePresetService
{
    private const PERMISSIONS = [
        'caring.view' => 'caring',
        'caring.configure' => 'caring',
        'caring.workflow.review' => 'caring',
        'caring.workflow.assign' => 'caring',
        'caring.reports.view' => 'caring',
        'caring.reports.export' => 'caring',
        'national.kiss_dashboard.view' => 'caring',
        'volunteering.hours.review' => 'volunteering',
        'volunteering.organisations.manage' => 'volunteering',
        'volunteering.opportunities.manage' => 'volunteering',
        'members.assisted_onboarding' => 'users',
        'safeguarding.view' => 'safeguarding',
        'federation.nodes.view' => 'federation',
    ];

    private const PRESETS = [
        'national_admin' => [
            'level' => 90,
            'permissions' => [
                'caring.view',
                'caring.configure',
                'caring.workflow.review',
                'caring.workflow.assign',
                'caring.reports.view',
                'caring.reports.export',
                'national.kiss_dashboard.view',
                'volunteering.hours.review',
                'volunteering.organisations.manage',
                'members.assisted_onboarding',
                'safeguarding.view',
                'federation.nodes.view',
            ],
        ],
        'canton_admin' => [
            'level' => 80,
            'permissions' => [
                'caring.view',
                'caring.workflow.review',
                'caring.workflow.assign',
                'caring.reports.view',
                'caring.reports.export',
                'volunteering.hours.review',
                'volunteering.organisations.manage',
                'members.assisted_onboarding',
                'federation.nodes.view',
            ],
        ],
        'municipality_admin' => [
            'level' => 70,
            'permissions' => [
                'caring.view',
                'caring.workflow.review',
                'caring.reports.view',
                'caring.reports.export',
                'volunteering.hours.review',
                'volunteering.organisations.manage',
                'members.assisted_onboarding',
            ],
        ],
        'cooperative_coordinator' => [
            'level' => 60,
            'permissions' => [
                'caring.view',
                'caring.workflow.review',
                'caring.workflow.assign',
                'volunteering.hours.review',
                'members.assisted_onboarding',
                'safeguarding.view',
            ],
        ],
        'organisation_coordinator' => [
            'level' => 50,
            'permissions' => [
                'caring.view',
                'caring.workflow.review',
                'volunteering.hours.review',
                'volunteering.opportunities.manage',
            ],
        ],
        'trusted_reviewer' => [
            'level' => 40,
            'permissions' => [
                'caring.view',
                'caring.workflow.review',
                'volunteering.hours.review',
            ],
        ],
    ];

    public function status(int $tenantId): array
    {
        if (!$this->tablesAvailable()) {
            return [
                'available' => false,
                'installed_count' => 0,
                'total_count' => count(self::PRESETS),
                'presets' => [],
            ];
        }

        $presets = array_map(fn (string $key, array $preset): array => $this->presetStatus($tenantId, $key, $preset), array_keys(self::PRESETS), self::PRESETS);

        return [
            'available' => true,
            'installed_count' => count(array_filter($presets, fn (array $preset): bool => $preset['installed'])),
            'total_count' => count($presets),
            'presets' => $presets,
        ];
    }

    public function install(int $tenantId, ?string $presetKey = null): array
    {
        if (!$this->tablesAvailable()) {
            return $this->status($tenantId);
        }

        $selectedPresets = $presetKey && isset(self::PRESETS[$presetKey])
            ? [$presetKey => self::PRESETS[$presetKey]]
            : self::PRESETS;

        DB::transaction(function () use ($tenantId, $selectedPresets): void {
            $permissionIds = $this->ensurePermissions();
            foreach ($selectedPresets as $key => $preset) {
                $roleId = $this->ensureRole($tenantId, $key, $preset);
                foreach ($preset['permissions'] as $permissionName) {
                    if (!isset($permissionIds[$permissionName])) {
                        continue;
                    }

                    DB::insert(
                        'INSERT IGNORE INTO role_permissions (role_id, permission_id, granted_by, tenant_id) VALUES (?, ?, ?, ?)',
                        [$roleId, $permissionIds[$permissionName], Auth::id(), $tenantId]
                    );
                }
            }
        });

        return $this->status($tenantId);
    }

    private function tablesAvailable(): bool
    {
        return Schema::hasTable('roles') && Schema::hasTable('permissions') && Schema::hasTable('role_permissions');
    }

    private function presetStatus(int $tenantId, string $key, array $preset): array
    {
        $roleName = $this->roleName($tenantId, $key);
        $role = DB::selectOne('SELECT id FROM roles WHERE tenant_id = ? AND name = ? LIMIT 1', [$tenantId, $roleName]);
        $roleId = $role ? (int) $role->id : null;
        $permissionCount = count($preset['permissions']);
        $installedPermissions = 0;

        if ($roleId !== null) {
            $installedPermissions = (int) (DB::selectOne(
                'SELECT COUNT(*) AS count FROM role_permissions rp INNER JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? AND p.name IN (' . $this->placeholders($permissionCount) . ')',
                array_merge([$roleId], $preset['permissions'])
            )->count ?? 0);
        }

        return [
            'key' => $key,
            'role_name' => $roleName,
            'role_id' => $roleId,
            'installed' => $roleId !== null && $installedPermissions === $permissionCount,
            'permission_count' => $permissionCount,
            'installed_permissions' => $installedPermissions,
        ];
    }

    private function ensurePermissions(): array
    {
        foreach (self::PERMISSIONS as $name => $category) {
            DB::insert(
                'INSERT IGNORE INTO permissions (name, display_name, description, category, tenant_id) VALUES (?, ?, ?, ?, NULL)',
                [$name, $name, null, $category]
            );
            DB::update(
                'UPDATE permissions SET display_name = ?, description = NULL, category = ? WHERE name = ? AND tenant_id IS NULL',
                [$name, $category, $name]
            );
        }

        $rows = DB::select(
            'SELECT id, name FROM permissions WHERE name IN (' . $this->placeholders(count(self::PERMISSIONS)) . ')',
            array_keys(self::PERMISSIONS)
        );

        $permissionIds = [];
        foreach ($rows as $row) {
            $permissionIds[(string) $row->name] = (int) $row->id;
        }

        return $permissionIds;
    }

    private function ensureRole(int $tenantId, string $key, array $preset): int
    {
        $roleName = $this->roleName($tenantId, $key);
        DB::insert(
            'INSERT IGNORE INTO roles (name, display_name, description, level, is_system, tenant_id) VALUES (?, ?, ?, ?, 0, ?)',
            [$roleName, $roleName, null, $preset['level'], $tenantId]
        );

        // F-267: role names are unique across the platform and preset names are
        // predictable, so the name may already belong to another community (or
        // be global). Never adopt such a role — that would move it, with the
        // permissions its owner attached, into this community. Fail closed.
        $role = DB::selectOne('SELECT id, tenant_id FROM roles WHERE name = ? LIMIT 1', [$roleName]);
        if ($role === null || (int) ($role->tenant_id ?? 0) !== $tenantId) {
            Log::error('Caring role preset name is owned by another community; refusing to adopt it', [
                'tenant_id' => $tenantId,
                'role_name' => $roleName,
            ]);
            throw new \RuntimeException('Role preset name is already in use.');
        }

        DB::update(
            'UPDATE roles SET display_name = ?, description = ?, level = ? WHERE id = ? AND tenant_id = ?',
            [$roleName, null, $preset['level'], (int) $role->id, $tenantId]
        );

        return (int) $role->id;
    }

    private function roleName(int $tenantId, string $key): string
    {
        return 'kiss_' . $key . '_t' . $tenantId;
    }

    private function placeholders(int $count): string
    {
        return implode(',', array_fill(0, $count, '?'));
    }
}
