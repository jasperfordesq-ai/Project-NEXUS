<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065\Concerns;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\EnablesExternalFederation;

/**
 * Shared fixture for the E-065 external-partner federation regressions
 * (F-329, F-330, F-331, F-345, F-346, F-357, F-365, F-366).
 *
 * Lifted from the two E-065 reproductions so every regression drives the real
 * inbound partner surface exactly as the reviewers did:
 *   `.local-docs-archive/security-log/E-065/repro/slice-a/KomunitinNestedOwnershipTest.php`
 *   `.local-docs-archive/security-log/E-065/repro/slice-f/CreditCommonsPartnerSurfaceTest.php`
 *
 * The external-federation kill switch is opened deliberately (and only here) so
 * the routes are reachable at all — that switch is a verified control and these
 * tests must not be read as evidence about it.
 */
trait DrivesFederationPartnerApi
{
    use EnablesExternalFederation;

    protected string $partnerApiKey = '';

    protected int $partnerKeyId = 0;

    protected string $ccNodeSlug = 'e065node';

    /**
     * @param array<int, string> $permissions Federation API key scopes.
     */
    protected function bootFederationPartner(array $permissions = ['*'], string $prefix = 'e065'): void
    {
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
        Cache::flush();

        DB::statement(
            "DELETE FROM tenant_settings WHERE tenant_id = ? AND setting_key = 'general.maintenance_mode'",
            [$this->testTenantId]
        );

        $this->partnerApiKey = $prefix . '-fed-key-' . bin2hex(random_bytes(8));

        $this->partnerKeyId = (int) DB::table('federation_api_keys')->insertGetId([
            'tenant_id'            => $this->testTenantId,
            'name'                 => 'E-065 regression key',
            'key_hash'             => hash('sha256', $this->partnerApiKey),
            'key_prefix'           => substr($this->partnerApiKey, 0, 8),
            'platform_id'          => $prefix . '-' . bin2hex(random_bytes(4)),
            'permissions'          => json_encode(array_values($permissions)),
            'rate_limit'           => 1000,
            'status'               => 'active',
            'signing_enabled'      => 0,
            'created_by'           => 1,
            'created_at'           => now(),
            'updated_at'           => now(),
            'hourly_request_count' => 0,
        ]);
    }

    protected function tearDownFederationPartner(): void
    {
        FederationApiMiddleware::reset();
        foreach (['HTTP_AUTHORIZATION', 'HTTP_X_FEDERATION_PLATFORM_ID'] as $key) {
            unset($_SERVER[$key]);
        }
    }

    /**
     * Pin a deterministic Credit Commons node identity so account paths in a
     * test are exactly what the controller resolves.
     */
    protected function bootCreditCommonsNode(): void
    {
        DB::table('federation_cc_node_config')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'node_slug' => $this->ccNodeSlug,
                'display_name' => 'E065 node',
                'currency_format' => '<quantity> hours',
                'exchange_rate' => 1.0,
                'validated_window' => 300,
                'last_hash' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    /**
     * The community's own Komunitin currency code — the uppercased tenant slug,
     * which is what buildCurrencyResource() publishes.
     */
    protected function ownCurrencyCode(): string
    {
        return strtoupper((string) DB::table('tenants')->where('id', $this->testTenantId)->value('slug'));
    }

    /** @param array<string, string> $extra */
    protected function partnerHeaders(array $extra = [], string $accept = 'application/json'): array
    {
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $this->partnerApiKey;
        $_SERVER['REQUEST_URI'] = $_SERVER['REQUEST_URI'] ?? '/test';
        $_SERVER['REQUEST_METHOD'] = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $_SERVER['REMOTE_ADDR'] = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

        return array_merge([
            'Authorization' => 'Bearer ' . $this->partnerApiKey,
            'Accept' => $accept,
            'Content-Type' => $accept,
            'X-Tenant-ID' => (string) $this->testTenantId,
        ], $extra);
    }

    /** @param array<string, string> $extra */
    protected function komunitinHeaders(array $extra = []): array
    {
        return $this->partnerHeaders($extra, 'application/vnd.api+json');
    }

    protected function makeMember(float $balance): User
    {
        // An explicit username: CC account paths are "node-slug/username", so a
        // member without one cannot be addressed on that protocol at all.
        return User::factory()->forTenant($this->testTenantId)->create([
            'balance' => $balance,
            'status' => 'active',
            'username' => 'e065' . bin2hex(random_bytes(6)),
        ]);
    }

    protected function optIn(int $userId): void
    {
        DB::table('federation_user_settings')->updateOrInsert(['user_id' => $userId], [
            'federation_optin' => 1,
            'profile_visible_federated' => 1,
            'messaging_enabled_federated' => 1,
            'transactions_enabled_federated' => 1,
            'appear_in_federated_search' => 1,
            'show_skills_federated' => 1,
            'show_location_federated' => 0,
            'service_reach' => 'local_only',
            'opted_in_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    protected function balanceOf(int $userId): float
    {
        return (float) DB::table('users')->where('id', $userId)->value('balance');
    }

    /**
     * An inbound credit agreement that permits `$maxMonthly` hours of
     * externally-originated credit into this community per calendar month.
     */
    protected function grantInboundCreditAgreement(?float $maxMonthly): int
    {
        return (int) DB::table('federation_credit_agreements')->insertGetId([
            'from_tenant_id' => $this->testTenantId,
            'to_tenant_id' => $this->testTenantId,
            'exchange_rate' => 1.0,
            'status' => 'active',
            'max_monthly_credits' => $maxMonthly,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
