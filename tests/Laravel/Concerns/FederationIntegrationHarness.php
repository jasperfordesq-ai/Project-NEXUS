<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Concerns;

use App\Services\FederationExternalApiClient;
use App\Services\FederationFeatureService;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;

/**
 * FederationIntegrationHarness — shared helpers for end-to-end federation
 * two-way flow tests.
 *
 * Provides:
 *  - setupPartner($protocol)                 → creates an active test partner with all allow_* flags ON
 *  - enableFederationForTenant($tenantId)    → seeds system_control + whitelist + tenant_features
 *  - fakePartnerHttp()                        → Http::fake() returning 200 for everything
 *  - assertOutboundPush($entity, $contains)  → asserts an Http::sent matched entity + payload shape
 *  - simulateInboundWebhook($partner, $evt, $data) → posts an HMAC-signed webhook
 *
 * Not a test case by itself — tests `use` this trait from Laravel\TestCase.
 */
trait FederationIntegrationHarness
{
    /** Plaintext signing secret used for outbound / inbound HMAC in tests. */
    protected string $testSigningSecret = 'test-federation-secret-1234567890';

    /**
     * Monotonic counter for generating distinct partner base URLs.
     *
     * federation_external_partners has a UNIQUE (tenant_id, base_url) constraint
     * (uk_tenant_url), so creating several partners for one tenant in a single
     * test — e.g. one per protocol — must use distinct base URLs. Each must still
     * be a public-IP literal so OutboundUrlGuard::isSafeHttpUrl() passes without DNS.
     */
    protected static int $partnerUrlSeq = 0;

    /**
     * Create a test partner with the given protocol_type and all allow_* flags ON.
     * Returns the partner row as a stdClass so callers can ->id, ->signing_secret etc.
     */
    protected function setupPartner(string $protocol = 'nexus', ?int $tenantId = null): object
    {
        $tenantId = $tenantId ?? $this->testTenantId;

        $encryptedSecret = Crypt::encryptString($this->testSigningSecret);

        // Distinct public-IP literal per partner so the UNIQUE (tenant_id, base_url)
        // constraint isn't violated when a test creates several partners for one
        // tenant (e.g. one per protocol). 93.184.216.0/24 is example.com's public
        // block; any host in it is a public IP, so OutboundUrlGuard::isSafeHttpUrl()
        // passes without DNS (it short-circuits on IP literals). A '.test' hostname
        // would be unresolvable and the SSRF guard would block every outbound request.
        $octet = 1 + (self::$partnerUrlSeq++ % 254);
        $baseUrl = 'https://93.184.216.' . $octet;

        $row = [
            'tenant_id'            => $tenantId,
            'name'                 => 'Test ' . ucfirst($protocol) . ' Partner ' . uniqid(),
            'description'          => 'Harness-created partner for ' . $protocol,
            'base_url'             => $baseUrl,
            'api_path'             => '/api/v1',
            'api_key'              => 'test-api-key',
            'auth_method'          => 'hmac',
            'signing_secret'       => $encryptedSecret,
            'status'               => 'active',
            'verified_at'          => now(),
            'allow_member_search'  => 1,
            'allow_listing_search' => 1,
            'allow_messaging'      => 1,
            'allow_transactions'   => 1,
            'allow_events'         => 1,
            'allow_groups'         => 1,
            'created_at'           => now(),
            'updated_at'           => now(),
        ];

        // New allow_* columns (migration 2026_04_12_110000).
        foreach (['allow_connections', 'allow_volunteering', 'allow_member_sync'] as $col) {
            if ($this->columnExists('federation_external_partners', $col)) {
                $row[$col] = 1;
            }
        }

        // allow_reviews — may or may not exist; include if column is present.
        if ($this->columnExists('federation_external_partners', 'allow_reviews')) {
            $row['allow_reviews'] = 1;
        }

        // protocol_type — added by migration 2026_04_11_200000
        if ($this->columnExists('federation_external_partners', 'protocol_type')) {
            $row['protocol_type'] = $protocol;
        }

        $id = DB::table('federation_external_partners')->insertGetId($row);

        // Bust adapter cache so this partner resolves with its fresh protocol_type.
        FederationExternalApiClient::clearAdapterCache();

        $partner = DB::table('federation_external_partners')->where('id', $id)->first();
        if (!$partner) {
            $this->fail("Harness: failed to persist test partner for protocol '{$protocol}'");
        }

        return $partner;
    }

    /**
     * Seed a federation_user_settings opt-in row for a local user so inbound
     * federated messages/transactions are accepted. The message handler
     * (FederatedMessageService::storeExternalMessage) rejects delivery unless
     * the recipient has explicitly opted into federated messaging — this models
     * the real consent requirement, so tests that exercise inbound delivery must
     * seed it rather than relying on the all-zero column defaults.
     */
    protected function optInUserToFederation(int $userId): void
    {
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $userId],
            [
                'federation_optin'              => 1,
                'profile_visible_federated'     => 1,
                'messaging_enabled_federated'   => 1,
                'transactions_enabled_federated' => 1,
                'appear_in_federated_search'    => 1,
                'opted_in_at'                   => now(),
                'updated_at'                    => now(),
            ]
        );
    }

    /**
     * Seed the 3 federation gating tables so the tenant is fully enabled.
     */
    protected function enableFederationForTenant(?int $tenantId = null): void
    {
        $tenantId = $tenantId ?? $this->testTenantId;

        // 1. System-wide control row
        DB::table('federation_system_control')->updateOrInsert(
            ['id' => 1],
            [
                'federation_enabled'                => 1,
                'whitelist_mode_enabled'            => 1,
                'cross_tenant_profiles_enabled'     => 1,
                'cross_tenant_messaging_enabled'    => 1,
                'cross_tenant_transactions_enabled' => 1,
                'cross_tenant_listings_enabled'     => 1,
                'cross_tenant_events_enabled'       => 1,
                'cross_tenant_groups_enabled'       => 1,
                'emergency_lockdown_active'         => 0,
                'updated_at'                        => now(),
            ]
        );

        // 1b. External partner protocols. Ships disabled in production and must
        // be opted into explicitly per test, so a NEW external route added
        // without a kill-switch gate fails its test loudly instead of being
        // silently permitted by a globally permissive fixture.
        $this->enableExternalFederationProtocols();

        // 2. Whitelist the tenant
        DB::table('federation_tenant_whitelist')->updateOrInsert(
            ['tenant_id' => $tenantId],
            [
                'approved_at' => now(),
                'approved_by' => 1,
            ]
        );

        // 3. Feature flags — enable both federation + everything downstream features use
        foreach ([
            'tenant_federation_enabled',
            'federation',
        ] as $feature) {
            DB::table('federation_tenant_features')->updateOrInsert(
                ['tenant_id' => $tenantId, 'feature_key' => $feature],
                [
                    'is_enabled' => 1,
                    'updated_at' => now(),
                ]
            );
        }

        // Ensure tenant-level feature gate `TenantContext::hasFeature('federation')`
        // resolves truthy. We stamp it into tenants.features JSON as belt-and-braces.
        try {
            $tenant = DB::table('tenants')->where('id', $tenantId)->first();
            if ($tenant && $this->columnExists('tenants', 'features')) {
                $features = json_decode($tenant->features ?? '{}', true) ?: [];
                $features['federation'] = true;
                DB::table('tenants')->where('id', $tenantId)->update([
                    'features'   => json_encode($features),
                    'updated_at' => now(),
                ]);
            }
        } catch (\Throwable $e) {
            // Non-fatal: some test schemas may not have this column.
        }
    }

    /**
     * Turn on the external partner federation kill switch for a test.
     *
     * External federation ships OFF, so any test that exercises an external
     * protocol surface (Komunitin, Credit Commons, legacy v1, partner webhooks,
     * cross-platform hour transfers, aggregates, Nexus ingest) must call this.
     *
     * @param array<int, string>|null $protocols Defaults to every protocol.
     */
    protected function enableExternalFederationProtocols(?array $protocols = null): void
    {
        $protocols ??= FederationFeatureService::externalProtocolNames();

        $update = ['external_federation_enabled' => 1, 'updated_at' => now()];
        foreach ($protocols as $protocol) {
            $column = FederationFeatureService::externalProtocolColumn($protocol);
            if ($column !== null) {
                $update[$column] = 1;
            }
        }

        DB::table('federation_system_control')->updateOrInsert(['id' => 1], $update);

        app(FederationFeatureService::class)->clearCache();
    }

    /**
     * Http::fake() returning 200 + a minimal success envelope for any outbound URL.
     */
    protected function fakePartnerHttp(): void
    {
        Http::fake(function ($request) {
            return Http::response([
                'success' => true,
                'data'    => ['id' => 99, 'status' => 'accepted'],
            ], 200);
        });
    }

    /**
     * Stub the email dispatcher so inbound-webhook side-effects that send a
     * recipient notification email do not hit a real SMTP/SendGrid/Gmail
     * transport during tests. EmailDispatchService::sendRaw() resolves the
     * dispatcher via app(EmailDispatchService::class), so binding a stub
     * instance here makes every federated notification email a no-op success.
     *
     * Without this, the test box has no reachable SMTP host, so the email
     * returns false → handlers treat delivery as failed and surface HTTP 500.
     * Email delivery is an out-of-band side effect, not the webhook's core
     * contract (persist + acknowledge), so faking it is correct test isolation.
     */
    protected function fakeFederationEmail(): void
    {
        $stub = new class extends \App\Services\EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        };

        $this->app->instance(\App\Services\EmailDispatchService::class, $stub);
    }

    /**
     * Assert that at least one outbound HTTP request matched the given
     * entity endpoint fragment and contains the expected payload fields.
     *
     * @param string $entityEndpointFragment E.g. '/listings', '/reviews', '/members'
     * @param array<string,mixed> $expectedPayloadContains
     */
    protected function assertOutboundPush(string $entityEndpointFragment, array $expectedPayloadContains = []): void
    {
        Http::assertSent(function ($request) use ($entityEndpointFragment, $expectedPayloadContains) {
            if (!str_contains($request->url(), $entityEndpointFragment)) {
                return false;
            }
            $body = $request->data();
            foreach ($expectedPayloadContains as $key => $value) {
                // Support dot-path `attributes.title`
                $actual = data_get($body, $key);
                if ($value !== null && $actual !== $value) {
                    return false;
                }
                if ($value === null && $actual === null && !data_get($body, $key, '___missing___') !== '___missing___') {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * Simulate an inbound webhook from the given partner using HMAC auth.
     * Signs the body with the partner's plaintext secret (decrypted from DB).
     *
     * @param array<string,mixed> $data
     */
    protected function simulateInboundWebhook(object $partner, string $eventType, array $data = []): TestResponse
    {
        $uri       = '/api/v2/federation/external/webhooks/receive';
        $timestamp = (string) time();
        $nonce     = bin2hex(random_bytes(16)); // 32 chars (8–128 required), fresh per call

        $payload = [
            'event'      => $eventType,
            'partner_id' => $partner->id,
            'timestamp'  => $timestamp,
            'data'       => $data,
        ];
        $body = json_encode($payload);

        // FederationExternalWebhookController::identifyAndVerifyPartner() verifies the
        // HMAC over a canonical string (METHOD\nURI\nTIMESTAMP\nNONCE\nBODY) and requires
        // X-Federation-Nonce for replay protection. Sign exactly that.
        $stringToSign = implode("\n", ['POST', $uri, $timestamp, $nonce, $body]);
        $signature = hash_hmac('sha256', $stringToSign, $this->testSigningSecret);

        return $this->postJson(
            $uri,
            $payload,
            [
                'X-Webhook-Signature' => $signature,
                'X-Webhook-Timestamp' => $timestamp,
                'X-Federation-Nonce'  => $nonce,
                'Content-Type'        => 'application/json',
                'Accept'              => 'application/json',
            ]
        );
    }

    /**
     * True if the column exists on the given table. Silent on failure.
     */
    protected function columnExists(string $table, string $column): bool
    {
        try {
            return \Illuminate\Support\Facades\Schema::hasColumn($table, $column);
        } catch (\Throwable $e) {
            return false;
        }
    }
}
