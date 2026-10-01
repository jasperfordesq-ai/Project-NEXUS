<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Listeners;

use App\Core\TenantContext;
use App\Events\UserFederatedOptOut;
use App\Listeners\PushFederationDataRetraction;
use App\Services\FederationAuditService;
use App\Services\FederationFeatureService;
use Illuminate\Encryption\Encrypter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * PushFederationDataRetractionTest
 *
 * Verifies that PushFederationDataRetraction::handle() pushes a retraction
 * (DELETE /members) to every federated-identity partner when a user opts out,
 * and sends nothing when prerequisites are not met.
 *
 * Unique tenant id: 99677 — isolated from all other listener test files.
 *
 * NOTE on Crypt in Docker dev environment:
 * The Docker compose.yml sets APP_KEY to a placeholder value that is not a
 * valid AES-256 key. This makes the Encrypter singleton fail to initialise.
 * We swap in a fresh Encrypter with a known-good random key in setUp() so
 * that Crypt::encryptString / Crypt::decryptString work correctly, and we
 * store partner api_key values encrypted with that same key.
 */
class PushFederationDataRetractionTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99677;

    /**
     * A public IP that passes OutboundUrlGuard::isPublicIp() (example.com = 93.184.216.34).
     * Http::fake() intercepts all calls so no real connection is ever made.
     * Each partner insertion uses a unique base URL to avoid uk_tenant_url conflicts.
     */
    private const PARTNER_IP_BASE = '93.184.216.34';
    private const PARTNER_API_PATH = '/api/v1/federation';

    private PushFederationDataRetraction $listener;
    private int $partnerId;
    private int $partnerCounter = 0;
    /** Encrypted api_key value generated with the test-safe Encrypter. */
    private string $encryptedApiKey;

    protected function setUp(): void
    {
        parent::setUp();

        // Ensure the Encrypter singleton uses a valid key regardless of Docker env.
        // compose.yml injects APP_KEY=nexus-dev-app-key-change-in-production which is
        // NOT a valid AES-256 key — without this swap, any Crypt:: call throws a
        // RuntimeException that bypasses decryptCredential's DecryptException catch,
        // causing buildAuthHeaders to return 'Authentication setup failed' and the
        // HTTP call to be skipped entirely.
        $safeKey = random_bytes(32); // 256-bit key, always valid for AES-256-CBC
        $this->app->forgetInstance('encrypter');
        $this->app->instance('encrypter', new Encrypter($safeKey, 'AES-256-CBC'));
        \App\Services\FederationExternalApiClient::clearAdapterCache();

        // Pre-encrypt a test api_key value with the same safe Encrypter.
        $this->encryptedApiKey = Crypt::encryptString('test-api-key');

        Queue::fake();

        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'              => 'Retraction Test Tenant',
                'slug'              => 'retraction-test-' . self::TENANT_ID,
                'domain'            => null,
                'is_active'         => true,
                'depth'             => 0,
                'allows_subtenants' => false,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]
        );

        TenantContext::setById(self::TENANT_ID);

        $this->enableFederationForTenant(self::TENANT_ID);

        $this->partnerId = $this->insertPartner(self::TENANT_ID);

        $auditSvc   = $this->createMock(FederationAuditService::class);
        $featureSvc = new FederationFeatureService($auditSvc);
        $this->listener = new PushFederationDataRetraction($featureSvc);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private function enableFederationForTenant(int $tenantId): void
    {
        DB::table('federation_system_control')->updateOrInsert(
            ['id' => 1],
            [
                'federation_enabled'                => 1,
                'whitelist_mode_enabled'            => 0,
                'emergency_lockdown_active'         => 0,
                'max_federation_level'              => 4,
                'cross_tenant_profiles_enabled'     => 1,
                'cross_tenant_messaging_enabled'    => 1,
                'cross_tenant_transactions_enabled' => 1,
                'cross_tenant_listings_enabled'     => 1,
                'cross_tenant_events_enabled'       => 1,
                'cross_tenant_groups_enabled'       => 1,
                'created_at'                        => now(),
            ]
        );

        DB::table('federation_tenant_features')->updateOrInsert(
            ['tenant_id' => $tenantId, 'feature_key' => 'tenant_federation_enabled'],
            ['is_enabled' => 1, 'updated_at' => now()]
        );
    }

    /** Each call returns a unique base URL so the uk_tenant_url constraint is never violated. */
    private function nextPartnerBase(): string
    {
        $port = 8001 + ($this->partnerCounter++);
        return 'https://' . self::PARTNER_IP_BASE . ':' . $port;
    }

    private function insertPartner(int $tenantId, string $status = 'active'): int
    {
        $base = $this->nextPartnerBase();
        return (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id'         => $tenantId,
            'name'              => 'Retraction Partner ' . uniqid(),
            'base_url'          => $base,
            'api_path'          => self::PARTNER_API_PATH,
            'auth_method'       => 'api_key',
            'api_key'           => $this->encryptedApiKey,
            'protocol_type'     => 'nexus',
            'status'            => $status,
            'allow_member_sync' => 1,
            'created_at'        => now(),
        ]);
    }

    private function insertFederatedIdentity(int $tenantId, int $userId, int $partnerId, string $externalUserId = ''): int
    {
        if ($externalUserId === '') {
            $externalUserId = 'ext-user-' . uniqid();
        }
        return (int) DB::table('federated_identities')->insertGetId([
            'tenant_id'        => $tenantId,
            'local_user_id'    => $userId,
            'partner_id'       => $partnerId,
            'external_user_id' => $externalUserId,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);
    }

    private function insertUser(int $tenantId): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'name'       => 'Test User ' . uniqid(),
            'email'      => 'test-' . uniqid() . '@example.com',
            'status'     => 'active',
            'created_at' => now(),
        ]);
    }

    private function partnerDeleteUrlWildcard(): string
    {
        // NexusAdapter::mapEndpoint('members') = '/members'
        // Wildcard matches any partner port-based URL.
        return 'https://' . self::PARTNER_IP_BASE . '*/members';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Happy-path: retraction is sent for each linked identity
    // ─────────────────────────────────────────────────────────────────────────

    public function test_handle_sends_delete_retraction_to_partner_for_opted_out_user(): void
    {
        Http::fake([
            $this->partnerDeleteUrlWildcard() => Http::response(['success' => true], 200),
        ]);

        $userId    = $this->insertUser(self::TENANT_ID);
        $extUserId = 'ext-abc-123';
        $this->insertFederatedIdentity(self::TENANT_ID, $userId, $this->partnerId, $extUserId);

        $event = new UserFederatedOptOut($userId, self::TENANT_ID, 'opt_out');
        $this->listener->handle($event);

        Http::assertSent(function (\Illuminate\Http\Client\Request $req) use ($extUserId): bool {
            $body = json_decode($req->body(), true);
            return $req->method() === 'DELETE'
                && str_contains($req->url(), '/members')
                && ($body['action'] ?? '') === 'retracted'
                && ($body['reason'] ?? '') === 'opt_out'
                && ($body['external_user_id'] ?? '') === $extUserId;
        });
    }

    public function test_handle_sends_retraction_for_account_deleted_reason(): void
    {
        Http::fake([
            $this->partnerDeleteUrlWildcard() => Http::response(['success' => true], 200),
        ]);

        $userId = $this->insertUser(self::TENANT_ID);
        $this->insertFederatedIdentity(self::TENANT_ID, $userId, $this->partnerId);

        $event = new UserFederatedOptOut($userId, self::TENANT_ID, 'account_deleted');
        $this->listener->handle($event);

        Http::assertSent(function (\Illuminate\Http\Client\Request $req): bool {
            $body = json_decode($req->body(), true);
            return ($body['reason'] ?? '') === 'account_deleted';
        });
    }

    public function test_handle_sends_retraction_to_every_linked_partner(): void
    {
        $partnerId2 = $this->insertPartner(self::TENANT_ID);

        Http::fake([
            'https://' . self::PARTNER_IP_BASE . '*/members' => Http::response(['success' => true], 200),
        ]);

        $userId = $this->insertUser(self::TENANT_ID);
        $this->insertFederatedIdentity(self::TENANT_ID, $userId, $this->partnerId, 'ext-u-1');
        $this->insertFederatedIdentity(self::TENANT_ID, $userId, $partnerId2, 'ext-u-2');

        $event = new UserFederatedOptOut($userId, self::TENANT_ID, 'opt_out');
        $this->listener->handle($event);

        // Two identities → two HTTP calls.
        Http::assertSentCount(2);
    }

    public function test_handle_payload_contains_local_user_id(): void
    {
        Http::fake([
            $this->partnerDeleteUrlWildcard() => Http::response(['success' => true], 200),
        ]);

        $userId = $this->insertUser(self::TENANT_ID);
        $this->insertFederatedIdentity(self::TENANT_ID, $userId, $this->partnerId);

        $event = new UserFederatedOptOut($userId, self::TENANT_ID, 'opt_out');
        $this->listener->handle($event);

        Http::assertSent(function (\Illuminate\Http\Client\Request $req) use ($userId): bool {
            $body = json_decode($req->body(), true);
            return ($body['local_user_id'] ?? null) === $userId;
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Guard paths: nothing sent when prerequisites fail
    // ─────────────────────────────────────────────────────────────────────────

    public function test_handle_sends_nothing_when_user_has_no_federated_identities(): void
    {
        Http::fake();

        $userId = $this->insertUser(self::TENANT_ID);
        // No federated_identities row inserted.

        $event = new UserFederatedOptOut($userId, self::TENANT_ID, 'opt_out');
        $this->listener->handle($event);

        Http::assertNothingSent();
    }

    public function test_handle_sends_nothing_when_federation_globally_disabled(): void
    {
        Http::fake();

        DB::table('federation_system_control')
            ->where('id', 1)
            ->update(['federation_enabled' => 0]);

        $userId = $this->insertUser(self::TENANT_ID);
        $this->insertFederatedIdentity(self::TENANT_ID, $userId, $this->partnerId);

        $event = new UserFederatedOptOut($userId, self::TENANT_ID, 'opt_out');
        $this->listener->handle($event);

        Http::assertNothingSent();
    }

    public function test_handle_sends_nothing_for_unknown_tenant(): void
    {
        Http::fake();

        $event = new UserFederatedOptOut(99, 99999999, 'opt_out');
        $this->listener->handle($event);

        Http::assertNothingSent();
    }

    public function test_handle_throws_on_partner_500_so_the_erasure_is_retried(): void
    {
        // F-485: this test used to assert the OPPOSITE and said so — that
        // FederationExternalApiClient::request() catches every exception and
        // returns an array, "therefore ... the RuntimeException path in this
        // listener is dead code". It was: the declared 4 tries / 5 min / 30 min
        // / 2 h backoff never ran and failed() never paged an operator, so a
        // refused GDPR erasure was recorded as a success. The listener now
        // inspects the returned array, as PushTransactionToFederatedPartner
        // already did, and fails the job so the retries can run.
        Http::fake([
            $this->partnerDeleteUrlWildcard() => Http::response('Gateway Error', 500),
        ]);

        $userId = $this->insertUser(self::TENANT_ID);
        $this->insertFederatedIdentity(self::TENANT_ID, $userId, $this->partnerId);

        $event = new UserFederatedOptOut($userId, self::TENANT_ID, 'opt_out');

        $threw = null;
        try {
            $this->listener->handle($event);
        } catch (\Throwable $e) {
            $threw = $e;
        }

        $this->assertNotNull($threw, 'a refused erasure must fail the job so the queue retries it');
        Http::assertSent(fn ($req) => str_contains($req->url(), '/members'));
    }

    public function test_handle_sends_nothing_and_does_not_throw_for_suspended_partner(): void
    {
        // Suspended partners are excluded by getPartner() (only 'active'/'failed' are queried).
        // F-485: that is an operator state on THIS side, not a transient partner
        // fault, so it is logged at error and does NOT drive the retry loop —
        // retrying could not reach the partner and would alert on every opt-out
        // until the partner is reinstated or unlinked.
        Http::fake();

        $userId             = $this->insertUser(self::TENANT_ID);
        $suspendedPartnerId = $this->insertPartner(self::TENANT_ID, 'suspended');
        $this->insertFederatedIdentity(self::TENANT_ID, $userId, $suspendedPartnerId, 'ext-susp-1');

        $event = new UserFederatedOptOut($userId, self::TENANT_ID, 'opt_out');
        $this->listener->handle($event);

        Http::assertNothingSent();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Listener configuration
    // ─────────────────────────────────────────────────────────────────────────

    public function test_listener_implements_should_queue(): void
    {
        $this->assertInstanceOf(\Illuminate\Contracts\Queue\ShouldQueue::class, $this->listener);
    }

    public function test_listener_is_on_federation_queue(): void
    {
        $this->assertSame('federation', $this->listener->queue);
    }
}
