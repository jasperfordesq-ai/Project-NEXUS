<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;

/**
 * GroupSSOService — scaffold for SAML/SSO integration.
 *
 * Manages SSO configuration stored in tenant_settings, maps SAML attributes
 * to user fields, and auto-assigns users to platform groups based on SAML
 * group assertions.
 *
 * This is a scaffold — wire to a SAML package (e.g. onelogin/php-saml or
 * aacotroneo/laravel-saml2) when ready for production SSO.
 */
class GroupSSOService
{
    private const SSO_CONFIG_KEY = 'sso_config';
    private const SSO_GROUP_MAPPINGS_KEY = 'sso_group_mappings';

    /**
     * Default SSO configuration structure.
     */
    private const DEFAULT_CONFIG = [
        'enabled'           => false,
        'provider'          => '',
        'entity_id'         => '',
        'sso_url'           => '',
        'slo_url'           => '',
        'certificate'       => '',
        'attribute_mapping' => [
            'email' => 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
            'name'  => 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
            'role'  => 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
        ],
    ];

    // =========================================================================
    // SSO Configuration
    // =========================================================================

    /**
     * Read SSO configuration from tenant_settings.
     *
     * Returns the full config array with defaults for any missing keys.
     *
     * @return array{enabled: bool, provider: string, entity_id: string, sso_url: string, slo_url: string, certificate: string, attribute_mapping: array}
     */
    public static function getSSOConfig(): array
    {
        $tenantId = TenantContext::getId();

        $raw = app(TenantSettingsService::class)->get($tenantId, self::SSO_CONFIG_KEY);

        if ($raw === null) {
            return self::DEFAULT_CONFIG;
        }

        $config = json_decode($raw, true);

        if (!is_array($config)) {
            return self::DEFAULT_CONFIG;
        }

        // Merge with defaults so callers always get a complete structure
        return array_merge(self::DEFAULT_CONFIG, $config);
    }

    /**
     * Save SSO configuration to tenant_settings.
     *
     * Validates required keys are present, then persists as JSON.
     */
    public static function setSSOConfig(array $config): void
    {
        $tenantId = TenantContext::getId();

        // Merge with defaults to ensure complete structure
        $merged = array_merge(self::DEFAULT_CONFIG, $config);

        // Ensure 'enabled' is always boolean
        $merged['enabled'] = (bool) ($merged['enabled'] ?? false);

        // Ensure attribute_mapping is always an array
        if (!is_array($merged['attribute_mapping'])) {
            $merged['attribute_mapping'] = self::DEFAULT_CONFIG['attribute_mapping'];
        }

        app(TenantSettingsService::class)->set(
            $tenantId,
            self::SSO_CONFIG_KEY,
            json_encode($merged, JSON_UNESCAPED_SLASHES),
            'json'
        );
    }

    // =========================================================================
    // SAML Attribute Mapping
    // =========================================================================

    /**
     * Transform SAML response attributes to user fields using the configured mapping.
     *
     * The mapping is a key-value array where keys are platform field names (email, name, role)
     * and values are SAML attribute URIs/names. This method extracts the corresponding values
     * from the raw SAML assertion attributes.
     *
     * @param  array $samlAttributes Raw SAML assertion attributes (URI => [values])
     * @param  array $mapping        Platform field => SAML attribute URI mapping
     * @return array{email: string, name: string, role: string}
     */
    public static function mapSAMLAttributes(array $samlAttributes, array $mapping): array
    {
        $result = [
            'email' => '',
            'name'  => '',
            'role'  => '',
        ];

        foreach ($mapping as $platformField => $samlKey) {
            if (!array_key_exists($platformField, $result)) {
                // Only map known platform fields
                continue;
            }

            if (isset($samlAttributes[$samlKey])) {
                $value = $samlAttributes[$samlKey];

                // SAML attributes are typically arrays — take the first value
                if (is_array($value)) {
                    $value = $value[0] ?? '';
                }

                $result[$platformField] = (string) $value;
            }
        }

        return $result;
    }

    // =========================================================================
    // Group Mappings
    // =========================================================================

    /**
     * Read SSO group mappings — maps SAML group attribute values to platform group IDs.
     *
     * Returns data from the `group_sso_mappings` table for the current tenant,
     * structured as: [['saml_group_name' => '...', 'group_id' => int, 'auto_assign' => bool], ...]
     *
     * @return array<int, array{saml_group_name: string, group_id: int, auto_assign: bool}>
     */
    public static function getGroupMappings(): array
    {
        $tenantId = TenantContext::getId();

        $rows = DB::select(
            "SELECT saml_group_name, group_id, auto_assign
             FROM group_sso_mappings
             WHERE tenant_id = ?
             ORDER BY saml_group_name",
            [$tenantId]
        );

        return array_map(fn($row) => [
            'saml_group_name' => $row->saml_group_name,
            'group_id'        => (int) $row->group_id,
            'auto_assign'     => (bool) $row->auto_assign,
        ], $rows);
    }

    /**
     * Based on SAML group assertions and configured mappings, auto-assign a user
     * to platform groups.
     *
     * For each SAML group name present in both the assertion and the mappings table
     * (with auto_assign = 1), the user is added to the corresponding platform group
     * if not already a member.
     *
     * @param  int   $userId     The platform user ID
     * @param  array $samlGroups Array of SAML group names from the assertion
     */
    public static function assignSSOGroups(int $userId, array $samlGroups): void
    {
        $tenantId = TenantContext::getId();

        if (empty($samlGroups)) {
            return;
        }

        // Load auto-assign mappings for this tenant
        $placeholders = implode(',', array_fill(0, count($samlGroups), '?'));
        $params = array_merge([$tenantId], $samlGroups);

        $mappings = DB::select(
            "SELECT saml_group_name, group_id
             FROM group_sso_mappings
             WHERE tenant_id = ?
               AND auto_assign = 1
               AND saml_group_name IN ({$placeholders})",
            $params
        );

        if (empty($mappings)) {
            return;
        }

        DB::transaction(function () use ($mappings, $tenantId, $userId): void {
            $now = now()->format('Y-m-d H:i:s');

            foreach ($mappings as $mapping) {
                $groupId = (int) $mapping->group_id;

                // Verify the group exists and is active in this tenant
                $group = DB::selectOne(
                    "SELECT id FROM `groups` WHERE id = ? AND tenant_id = ? AND status = 'active'",
                    [$groupId, $tenantId]
                );

                if (!$group) {
                    continue;
                }

                // Check if user is already a member
                $existing = DB::selectOne(
                    "SELECT id FROM group_members WHERE group_id = ? AND user_id = ? AND tenant_id = ?",
                    [$groupId, $userId, $tenantId]
                );

                if ($existing) {
                    continue;
                }

                GroupService::assertSafeguardingCohortAllowed(
                    $groupId,
                    $userId,
                    (int) $tenantId,
                    'group_sso_assignment',
                );

                DB::insert(
                    "INSERT INTO group_members (tenant_id, group_id, user_id, role, status, joined_at, created_at, updated_at)
                     VALUES (?, ?, ?, 'member', 'active', ?, ?, ?)",
                    [$tenantId, $groupId, $userId, $now, $now, $now]
                );
            }
        });
    }
}
