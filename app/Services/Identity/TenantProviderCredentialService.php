<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Identity;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * TenantProviderCredentialService
 *
 * Manages per-tenant, per-provider API credentials with AES-256-GCM encryption at rest.
 * Tenants can bring their own API keys for any identity verification provider.
 */
class TenantProviderCredentialService
{
    /**
     * Get decrypted credentials for a tenant + provider.
     *
     * @return array|null Decrypted credentials array or null if none stored
     */
    public static function get(int $tenantId, string $providerSlug): ?array
    {
        try {
            $credentialRow = DB::selectOne(
                "SELECT credentials_encrypted FROM tenant_provider_credentials
                 WHERE tenant_id = ? AND provider_slug = ? AND is_active = 1
                 LIMIT 1",
                [$tenantId, $providerSlug]
            );
            $row = $credentialRow ? (array) $credentialRow : null;

            if (!$row || empty($row['credentials_encrypted'])) {
                return null;
            }

            return RegistrationPolicyService::decryptConfig($row['credentials_encrypted']);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("[TenantProviderCredentialService] Failed to get credentials for tenant {$tenantId}, provider {$providerSlug}: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Save (upsert) encrypted credentials for a tenant + provider.
     *
     * @param array $credentials ['api_key' => '...', 'webhook_secret' => '...', ...]
     */
    public static function save(int $tenantId, string $providerSlug, array $credentials): bool
    {
        // Filter out empty values
        $credentials = array_filter($credentials, fn($v) => $v !== '' && $v !== null);

        if (empty($credentials)) {
            return false;
        }

        // If existing credentials exist, merge (so partial updates don't wipe other fields)
        $existing = self::get($tenantId, $providerSlug);
        if ($existing) {
            $credentials = array_merge($existing, $credentials);
        }

        $encrypted = RegistrationPolicyService::encryptConfig($credentials);

        DB::statement(
            "INSERT INTO tenant_provider_credentials
                (tenant_id, provider_slug, credentials_encrypted, is_active)
             VALUES (?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
                credentials_encrypted = VALUES(credentials_encrypted),
                is_active = 1,
                updated_at = CURRENT_TIMESTAMP",
            [$tenantId, $providerSlug, $encrypted]
        );

        return true;
    }

    /**
     * Delete credentials for a tenant + provider.
     */
    public static function delete(int $tenantId, string $providerSlug): bool
    {
        // DB::statement() returns a bool, so the rowCount() this used to call
        // failed every time and "Remove keys" answered 500 (found 13 Nov 2026).
        $deleted = DB::delete(
            "DELETE FROM tenant_provider_credentials WHERE tenant_id = ? AND provider_slug = ?",
            [$tenantId, $providerSlug]
        );

        return $deleted > 0;
    }

    /**
     * Check if a tenant has credentials stored for a provider.
     */
    public static function hasCredentials(int $tenantId, string $providerSlug): bool
    {
        try {
            $row = DB::selectOne(
                "SELECT 1 FROM tenant_provider_credentials
                 WHERE tenant_id = ? AND provider_slug = ? AND is_active = 1
                 LIMIT 1",
                [$tenantId, $providerSlug]
            );

            return $row !== null;
        } catch (\Throwable $e) {
            Log::warning('[TenantProviderCredential] hasCredentials check failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * List which providers have credentials configured for a tenant.
     *
     * @return array<string, bool> Map of provider_slug => has_credentials
     */
    public static function listConfigured(int $tenantId): array
    {
        try {
            $rows = DB::statement(
                "SELECT provider_slug FROM tenant_provider_credentials
                 WHERE tenant_id = ? AND is_active = 1",
                [$tenantId]
            )->fetchAll();

            $configured = [];
            foreach ($rows as $row) {
                $configured[$row['provider_slug']] = true;
            }
            return $configured;
        } catch (\Throwable $e) {
            Log::warning('[TenantProviderCredential] listConfigured failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get the credential field names a provider requires.
     */
    public static function getRequiredFields(string $providerSlug): array
    {
        $fields = [
            'stripe_identity' => ['api_key', 'webhook_secret'],
            'veriff'          => ['api_key', 'webhook_secret'],
            'jumio'           => ['api_key', 'webhook_secret'],
            'onfido'          => ['api_key', 'webhook_secret'],
            'idenfy'          => ['api_key', 'webhook_secret'],
        ];

        return $fields[$providerSlug] ?? ['api_key'];
    }
}
