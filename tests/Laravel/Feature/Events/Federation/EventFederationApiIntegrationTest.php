<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events\Federation;

use App\Core\FederationApiMiddleware;
use App\Core\TenantContext;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;
use Tests\Laravel\Concerns\EnablesExternalFederation;

final class EventFederationApiIntegrationTest extends TestCase
{
    use DatabaseTransactions;

    use EnablesExternalFederation;

    /** @var list<string> */
    private array $serverKeys = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
        Cache::flush();
        $this->enableEventFederation($this->testTenantId);
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        foreach ($this->serverKeys as $key) {
            unset($_SERVER[$key]);
        }
        FederationApiMiddleware::reset();
        parent::tearDown();
    }

    public function test_signed_inbound_apply_handles_accept_replay_stale_and_conflict(): void
    {
        [$partnerId, $platformId, $secret] = $this->partnerAndHmacKey($this->testTenantId, 'lifecycle');
        $payload = $this->payload(44, 4, 3);

        $accepted = $this->signedPost($payload, $platformId, $secret);
        $accepted->assertStatus(202)
            ->assertJsonPath('data.contract', 'nexus.event.federation.receipt')
            ->assertJsonPath('data.contract_version', 1)
            ->assertJsonPath('data.decision', 'accepted')
            ->assertJsonPath('data.action', 'upsert')
            ->assertJsonPath('data.event_aggregate_version', 4)
            ->assertJsonPath('data.event_calendar_version', 3);
        self::assertStringContainsString('no-store', (string) $accepted->headers->get('Cache-Control'));

        $replay = $this->signedPost($payload, $platformId, $secret);
        $replay->assertOk()->assertJsonPath('data.decision', 'replay');

        $stalePayload = $payload;
        $stalePayload['event_aggregate_version'] = 3;
        $stalePayload['event_calendar_version'] = 2;
        $stalePayload['title'] = 'Stale public title';
        $stale = $this->signedPost($stalePayload, $platformId, $secret);
        $stale->assertOk()->assertJsonPath('data.decision', 'stale');

        $conflictPayload = $payload;
        $conflictPayload['title'] = 'Conflicting public title';
        $conflict = $this->signedPost($conflictPayload, $platformId, $secret);
        $conflict->assertStatus(409)->assertJsonPath('data.decision', 'conflict');

        $projection = DB::table('federation_events')
            ->where('tenant_id', $this->testTenantId)
            ->where('external_partner_id', $partnerId)
            ->where('external_id', '44')
            ->first();
        self::assertNotNull($projection);
        self::assertSame('Federated community gathering', $projection->title);
        self::assertSame(1, (int) $projection->replay_count);
        self::assertSame(1, (int) $projection->stale_count);
        self::assertSame(1, (int) $projection->conflict_count);

        $receiptJson = (string) $accepted->getContent();
        foreach (['title', 'location', 'payload_hash', 'projection_id', 'meeting_link', 'registration'] as $privateField) {
            self::assertStringNotContainsString($privateField, $receiptJson);
        }
    }

    public function test_hmac_nonce_replay_and_unsigned_api_keys_are_rejected(): void
    {
        [, $platformId, $secret] = $this->partnerAndHmacKey($this->testTenantId, 'nonce');
        $payload = $this->payload(45, 1, 0);
        $timestamp = (string) time();
        $nonce = bin2hex(random_bytes(16));

        $this->signedPost($payload, $platformId, $secret, $nonce, $timestamp)->assertStatus(202);
        $this->signedPost($payload, $platformId, $secret, $nonce, $timestamp)
            ->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'SIGNATURE_INVALID');

        [$rawKey] = $this->unsignedApiKey($this->testTenantId, 'unsigned');
        $this->server('HTTP_AUTHORIZATION', 'Bearer ' . $rawKey);
        unset(
            $_SERVER['HTTP_X_FEDERATION_PLATFORM_ID'],
            $_SERVER['HTTP_X_FEDERATION_TIMESTAMP'],
            $_SERVER['HTTP_X_FEDERATION_NONCE'],
            $_SERVER['HTTP_X_FEDERATION_SIGNATURE'],
        );
        FederationApiMiddleware::reset();

        $this->postJson(
            '/api/v2/federation/ingest/events',
            $this->payload(46, 1, 0),
            [
                'Authorization' => 'Bearer ' . $rawKey,
                'X-Tenant-ID' => (string) $this->testTenantId,
                'Accept' => 'application/json',
            ],
        )->assertStatus(401)->assertJsonPath('errors.0.code', 'HMAC_REQUIRED');
    }

    public function test_inbound_boundary_rejects_private_fields_unlinked_keys_and_tenant_mismatch(): void
    {
        [, $platformId, $secret] = $this->partnerAndHmacKey($this->testTenantId, 'strict');
        $unsafe = $this->payload(47, 1, 0);
        $unsafe['meeting_link'] = 'https://meeting.example.test/private-token';
        $unsafe['registration_answers'] = ['dietary' => 'private answer'];

        $this->signedPost($unsafe, $platformId, $secret)
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_FEDERATION_PAYLOAD_INVALID');
        self::assertFalse(DB::table('federation_events')
            ->where('tenant_id', $this->testTenantId)
            ->where('external_id', '47')
            ->exists());

        [$unlinkedPlatform, $unlinkedSecret] = $this->unlinkedHmacKey($this->testTenantId, 'unlinked');
        $this->signedPost($this->payload(48, 1, 0), $unlinkedPlatform, $unlinkedSecret)
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'PARTNER_LINK_REQUIRED');

        $this->enableEventFederation(999);
        [, $foreignPlatform, $foreignSecret] = $this->partnerAndHmacKey(999, 'foreign');
        $this->signedPost(
            $this->payload(49, 1, 0),
            $foreignPlatform,
            $foreignSecret,
            tenantHeader: $this->testTenantId,
        )->assertStatus(403)->assertJsonPath('errors.0.code', 'TENANT_MISMATCH');
    }

    public function test_organizer_and_admin_can_view_only_payload_free_delivery_status(): void
    {
        $owner = $this->activeUser();
        $admin = $this->activeUser(['role' => 'admin', 'is_admin' => true]);
        $event = Event::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'federated_visibility' => 'listed',
            'federation_version' => 6,
            'is_recurring_template' => false,
        ]);
        $partnerId = $this->externalPartner($this->testTenantId, 'diagnostics');
        DB::table('event_federation_deliveries')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $event->id,
            'external_partner_id' => $partnerId,
            'payload_schema_version' => 1,
            'event_aggregate_version' => 6,
            'event_calendar_version' => 2,
            'action' => 'upsert',
            'idempotency_key' => hash('sha256', 'status-idempotency-' . $event->id),
            'payload_hash' => hash('sha256', 'status-payload-' . $event->id),
            'payload' => json_encode([
                'meeting_link' => 'PRIVATE MEETING TOKEN',
                'registration_answers' => 'PRIVATE ANSWER',
                'attendee_roster' => 'PRIVATE ROSTER',
                'claim_token' => 'PRIVATE CLAIM TOKEN',
            ], JSON_THROW_ON_ERROR),
            'status' => 'dead_letter',
            'attempts' => 5,
            'last_attempt_at' => now()->subMinute(),
            'dead_lettered_at' => now()->subMinute(),
            'last_error_code' => 'REMOTE_HTTP_503',
            'last_error' => 'PRIVATE RAW ERROR admin@example.test',
            'created_at' => now()->subHour(),
            'updated_at' => now()->subMinute(),
        ]);

        Sanctum::actingAs($owner, ['*']);
        $ownerResponse = $this->apiGet('/v2/events/' . $event->id . '/federation-status');
        $ownerResponse->assertOk()
            ->assertJsonPath('data.contract_version', 1)
            ->assertJsonPath('data.event_id', (int) $event->id)
            ->assertJsonPath('data.federation_version', 6)
            ->assertJsonPath('data.health', 'degraded')
            ->assertJsonPath('data.counts.dead_letter', 1)
            ->assertJsonPath('data.partners.0.error_code', 'REMOTE_HTTP_503');
        self::assertStringContainsString('no-store', (string) $ownerResponse->headers->get('Cache-Control'));
        $vary = (string) $ownerResponse->headers->get('Vary');
        foreach (['Authorization', 'Cookie', 'X-Tenant-ID'] as $varyHeader) {
            self::assertStringContainsString($varyHeader, $vary);
        }
        $encoded = (string) $ownerResponse->getContent();
        foreach ([
            'PRIVATE MEETING TOKEN',
            'PRIVATE ANSWER',
            'PRIVATE ROSTER',
            'PRIVATE CLAIM TOKEN',
            'PRIVATE RAW ERROR',
            'admin@example.test',
            'payload_hash',
            'idempotency_key',
        ] as $privateValue) {
            self::assertStringNotContainsString($privateValue, $encoded);
        }

        Sanctum::actingAs($admin, ['*']);
        $this->apiGet('/v2/events/' . $event->id . '/federation-status')->assertOk();
    }

    public function test_attendees_and_cross_tenant_users_cannot_view_federation_status(): void
    {
        $owner = $this->activeUser();
        $attendee = $this->activeUser();
        $event = Event::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'federated_visibility' => 'listed',
            'is_recurring_template' => false,
        ]);

        Sanctum::actingAs($attendee, ['*']);
        $this->apiGet('/v2/events/' . $event->id . '/federation-status')
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'EVENT_FEDERATION_FORBIDDEN');

        $foreign = User::factory()->forTenant(999)->create(['status' => 'active', 'role' => 'admin']);
        Sanctum::actingAs($foreign, ['*']);
        $this->apiGet('/v2/events/' . $event->id . '/federation-status')
            ->assertStatus(403);
    }

    /** @return array{int,string,string} */
    private function partnerAndHmacKey(int $tenantId, string $suffix): array
    {
        $partnerId = $this->externalPartner($tenantId, $suffix);
        $platformId = 'event-fed-' . $suffix . '-' . bin2hex(random_bytes(4));
        $secret = bin2hex(random_bytes(32));
        $this->insertApiKey($tenantId, $platformId, $secret, $partnerId, true);

        return [$partnerId, $platformId, $secret];
    }

    /** @return array{string,string} */
    private function unlinkedHmacKey(int $tenantId, string $suffix): array
    {
        $platformId = 'event-fed-' . $suffix . '-' . bin2hex(random_bytes(4));
        $secret = bin2hex(random_bytes(32));
        $this->insertApiKey($tenantId, $platformId, $secret, null, true);

        return [$platformId, $secret];
    }

    /** @return array{string,int} */
    private function unsignedApiKey(int $tenantId, string $suffix): array
    {
        $partnerId = $this->externalPartner($tenantId, $suffix);
        $rawKey = 'fed_event_' . bin2hex(random_bytes(16));
        $platformId = 'event-fed-' . $suffix . '-' . bin2hex(random_bytes(4));
        $keyId = $this->insertApiKey($tenantId, $platformId, '', $partnerId, false, $rawKey);

        return [$rawKey, $keyId];
    }

    private function insertApiKey(
        int $tenantId,
        string $platformId,
        string $secret,
        ?int $partnerId,
        bool $signingEnabled,
        ?string $rawKey = null,
    ): int {
        $rawKey ??= 'fed_event_' . bin2hex(random_bytes(16));

        return (int) DB::table('federation_api_keys')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Event federation API ' . $platformId,
            'key_hash' => hash('sha256', $rawKey),
            'key_prefix' => substr($rawKey, 0, 8),
            'platform_id' => $platformId,
            'external_partner_id' => $partnerId,
            'permissions' => json_encode(['ingest:write'], JSON_THROW_ON_ERROR),
            'rate_limit' => 1000,
            'request_count' => 0,
            'status' => 'active',
            'signing_enabled' => $signingEnabled,
            'signing_secret' => $secret,
            'expires_at' => null,
            'created_by' => 1,
            'created_at' => now(),
        ]);
    }

    private function externalPartner(int $tenantId, string $suffix): int
    {
        return (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Event federation partner ' . $suffix,
            'base_url' => 'https://' . $suffix . '-' . bin2hex(random_bytes(4)) . '.example.test',
            'api_path' => '/api/v2/federation',
            'auth_method' => 'hmac',
            'protocol_type' => 'nexus',
            'status' => 'active',
            'allow_events' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @param array<string,mixed> $payload */
    private function signedPost(
        array $payload,
        string $platformId,
        string $secret,
        ?string $nonce = null,
        ?string $timestamp = null,
        ?int $tenantHeader = null,
    ): TestResponse {
        FederationApiMiddleware::reset();
        $path = '/api/v2/federation/ingest/events';
        $body = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        $timestamp ??= (string) time();
        $nonce ??= bin2hex(random_bytes(16));
        $signature = FederationApiMiddleware::generateSignature(
            $secret,
            'POST',
            $path,
            $timestamp,
            $body,
            $nonce,
        );
        $server = [
            'REQUEST_METHOD' => 'POST',
            'REQUEST_URI' => $path,
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_TENANT_ID' => (string) ($tenantHeader ?? $this->testTenantId),
            'HTTP_X_FEDERATION_PLATFORM_ID' => $platformId,
            'HTTP_X_FEDERATION_TIMESTAMP' => $timestamp,
            'HTTP_X_FEDERATION_NONCE' => $nonce,
            'HTTP_X_FEDERATION_SIGNATURE' => $signature,
        ];
        foreach ($server as $key => $value) {
            $this->server($key, $value);
        }
        unset($_SERVER['HTTP_AUTHORIZATION']);

        return $this->call('POST', $path, [], [], [], $server, $body);
    }

    private function server(string $key, string $value): void
    {
        if (! in_array($key, $this->serverKeys, true)) {
            $this->serverKeys[] = $key;
        }
        $_SERVER[$key] = $value;
    }

    /** @return array<string,mixed> */
    private function payload(int $eventId, int $aggregateVersion, int $calendarVersion): array
    {
        return [
            'payload_schema' => 'nexus.event.federation',
            'payload_schema_version' => 1,
            'action' => 'upsert',
            'source_identity' => 'urn:nexus:event:88:' . $eventId,
            'source_platform' => 'nexus',
            'source_tenant_id' => 88,
            'external_id' => (string) $eventId,
            'event_aggregate_version' => $aggregateVersion,
            'event_calendar_version' => $calendarVersion,
            'occurred_at' => '2030-01-02T10:00:00.000000Z',
            'title' => 'Federated community gathering',
            'starts_at' => '2030-02-01T10:00:00.000000Z',
            'ends_at' => '2030-02-01T12:00:00.000000Z',
            'timezone' => 'UTC',
            'all_day' => false,
            'location' => 'Public library',
            'latitude' => 53.3,
            'longitude' => -6.2,
            'is_online' => false,
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'visibility' => 'listed',
            'created_at' => '2030-01-01T10:00:00.000000Z',
            'updated_at' => '2030-01-02T10:00:00.000000Z',
        ];
    }

    /** @param array<string,mixed> $attributes */
    private function activeUser(array $attributes = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
    }

    private function enableEventFederation(int $tenantId): void
    {
        DB::table('tenants')->where('id', $tenantId)->update([
            'features' => json_encode(['events' => true, 'federation' => true], JSON_THROW_ON_ERROR),
            'updated_at' => now(),
        ]);
        DB::table('federation_system_control')->updateOrInsert(
            ['id' => 1],
            [
                'federation_enabled' => 1,
                'whitelist_mode_enabled' => 0,
                'emergency_lockdown_active' => 0,
                'max_federation_level' => 4,
                'cross_tenant_profiles_enabled' => 1,
                'cross_tenant_messaging_enabled' => 1,
                'cross_tenant_transactions_enabled' => 1,
                'cross_tenant_listings_enabled' => 1,
                'cross_tenant_events_enabled' => 1,
                'cross_tenant_groups_enabled' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );
        foreach (['tenant_federation_enabled', 'tenant_events_enabled'] as $feature) {
            DB::table('federation_tenant_features')->updateOrInsert(
                ['tenant_id' => $tenantId, 'feature_key' => $feature],
                ['is_enabled' => 1, 'updated_at' => now()],
            );
        }
    }
}
