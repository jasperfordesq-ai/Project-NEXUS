<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\FederationApiMiddleware;
use App\Core\SuperPanelAccess;
use App\Core\TenantContext;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-468 (E-075 A-5) — `GET /v1/federation/messages` must serve a key only the
 * correspondence that key is a party to, on BOTH arms of its `$isExternal`
 * fork.
 *
 * F-446 (E-074 `dc14215fe`) gave the EXTERNAL arm a participation filter: a
 * partner reads only the messages recorded against its own
 * `federation_external_partners` row, and the arm fails closed — an empty page
 * — when no such row resolves. That fix is sound.
 *
 * The INTERNAL arm (`FederationController::getMessages()`) was left scoping on
 * the key's own `tenant_id`, which `AdminFederationController::createApiKey()`
 * sets to the ISSUING community. That is not a participation check at all: it
 * returns every federated message where any member of the issuing community is
 * a party, including their exchanges with a THIRD community — subject and full
 * body, content the recipient's own member API will not return to them
 * (`MessageService` filters `is_federated = 0` on every conversation read).
 *
 * A key with no external-partner binding identifies no counterparty, so it is a
 * party to nothing and must read nothing — the same fail-closed outcome the
 * external arm already produces when the partner cannot be resolved.
 *
 * These tests assert the CORRECT behaviour and fail before the fix.
 *
 * Prerequisite: the legacy v1 external-federation protocol switched on (it
 * ships disabled). The tests switch it on themselves.
 */
final class F468IssuedPartnerKeyCannotReadFederatedCorrespondenceTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private const THIRD_TENANT_ID = 90873;
    private const SECRET_SUBJECT = 'F468 private subject line';
    private const SECRET_BODY = 'F468 private body that no key holder should read.';
    private const DELIVERED_BODY = 'F468 body the bound partner itself delivered.';

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        $this->makeTenant(self::THIRD_TENANT_ID, 'e075-f468-third');
        SuperPanelAccess::reset();
        $this->enableExternalFederation();
        $this->allowSafeguarding();
        FederationApiMiddleware::reset();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    /**
     * THE FIX — a key issued with no partner binding must not be handed the
     * issuing community's members' private federated correspondence.
     */
    public function test_a_key_with_no_partner_binding_reads_no_federated_correspondence(): void
    {
        $local = $this->federatedMember($this->testTenantId);
        $thirdParty = $this->federatedMember(self::THIRD_TENANT_ID);
        $messageId = $this->federatedMessage($local, $thirdParty);

        $apiKey = $this->mintKey(['messages:read'], null);

        // The key really is the unbound, internal-arm kind — asserted, not
        // assumed, because F-463 changed what a BOUND key is stored as.
        $stored = DB::table('federation_api_keys')
            ->where('key_hash', hash('sha256', $apiKey))
            ->first(['tenant_id', 'platform_id']);
        self::assertNotNull($stored, 'the key row exists');
        self::assertNull($stored->platform_id, 'precondition: an unbound key takes the internal arm');
        self::assertSame(
            $this->testTenantId,
            (int) $stored->tenant_id,
            'precondition: and its tenant_id is the ISSUING community, not a counterparty'
        );

        $this->useKey($apiKey, 'GET', '/api/v1/federation/messages');
        $response = $this->apiGet('/v1/federation/messages?per_page=100', ['X-API-Key' => $apiKey]);
        self::assertSame(200, $response->status(), (string) $response->getContent());

        self::assertNull(
            $this->rowFor($response->json('data') ?? [], $messageId),
            'a key that is party to nothing must read nothing. ' . (string) $response->getContent()
        );
        self::assertStringNotContainsString(
            self::SECRET_BODY,
            (string) $response->getContent(),
            'and no message body may leak'
        );
        self::assertStringNotContainsString(
            self::SECRET_SUBJECT,
            (string) $response->getContent(),
            'nor the subject line'
        );
    }

    /**
     * THE FIX, THROUGH EVERY DIRECTION — `direction` must not reopen it.
     */
    public function test_the_direction_parameter_does_not_reopen_it(): void
    {
        $local = $this->federatedMember($this->testTenantId);
        $thirdParty = $this->federatedMember(self::THIRD_TENANT_ID);
        $this->federatedMessage($local, $thirdParty);

        $apiKey = $this->mintKey(['messages:read'], null);

        foreach (['inbound', 'outbound', 'all'] as $direction) {
            $this->useKey($apiKey, 'GET', '/api/v1/federation/messages');
            $response = $this->apiGet(
                '/v1/federation/messages?per_page=100&direction=' . $direction,
                ['X-API-Key' => $apiKey]
            );
            self::assertSame(200, $response->status(), (string) $response->getContent());
            self::assertStringNotContainsString(
                self::SECRET_BODY,
                (string) $response->getContent(),
                'direction=' . $direction . ' must not widen what the key may read'
            );
        }
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — a key bound to an external partner still
     * reads back the correspondence that partner itself delivered. This is the
     * arm F-446 guarded, and F-463 made it reachable; the feature survives.
     */
    public function test_control_a_partner_bound_key_still_reads_back_what_it_delivered(): void
    {
        $recipient = $this->federatedMember($this->testTenantId);
        $namedSender = $this->federatedMember($this->testTenantId);

        $partnerName = 'F468 Bound Partner ' . bin2hex(random_bytes(3));
        $apiKey = $this->mintKey(
            ['messages:read', 'messages:write'],
            $this->externalPartner($this->testTenantId, $partnerName)
        );

        $this->useKey($apiKey, 'POST', '/api/v1/federation/messages');
        $sent = $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $namedSender->id,
            'recipient_id' => (int) $recipient->id,
            'sender_name' => 'F468 Remote Member',
            'subject' => 'F468 delivered subject',
            'body' => self::DELIVERED_BODY,
        ], ['X-API-Key' => $apiKey]);
        self::assertSame(201, $sent->status(), 'control: the partner can deliver. ' . (string) $sent->getContent());

        $this->useKey($apiKey, 'GET', '/api/v1/federation/messages');
        $read = $this->apiGet('/v1/federation/messages?per_page=100', ['X-API-Key' => $apiKey]);
        self::assertSame(200, $read->status(), (string) $read->getContent());

        self::assertContains(
            self::DELIVERED_BODY,
            array_column($read->json('data') ?? [], 'body'),
            'control: the partner that delivered the message can read it back. ' . (string) $read->getContent()
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — an unbound key still authenticates, is still
     * accepted on the route, and still gets a well-formed empty page rather
     * than an error. Nothing here rests on the credential breaking.
     */
    public function test_control_an_unbound_key_still_authenticates_and_gets_a_well_formed_page(): void
    {
        $apiKey = $this->mintKey(['messages:read'], null);

        $this->useKey($apiKey, 'GET', '/api/v1/federation/messages');
        $response = $this->apiGet('/v1/federation/messages?per_page=10', ['X-API-Key' => $apiKey]);

        self::assertSame(200, $response->status(), (string) $response->getContent());
        self::assertTrue((bool) $response->json('success'), (string) $response->getContent());
        self::assertIsArray($response->json('data'), (string) $response->getContent());
        self::assertSame(0, (int) ($response->json('pagination.total') ?? -1), (string) $response->getContent());
    }

    /**
     * CONTROL — the scope gate that already worked still works: a key without
     * `messages:read` is still refused outright.
     */
    public function test_control_a_key_without_messages_read_is_still_refused(): void
    {
        $apiKey = $this->mintKey(['members:read'], null);

        $this->useKey($apiKey, 'GET', '/api/v1/federation/messages');
        $response = $this->apiGet('/v1/federation/messages', ['X-API-Key' => $apiKey]);

        self::assertSame(403, $response->status(), (string) $response->getContent());
        $response->assertJsonPath('code', 'PERMISSION_DENIED');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @param array<int,string> $scopes */
    private function mintKey(array $scopes, ?int $externalPartnerId): string
    {
        $god = $this->god();
        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($god->id), ['*']);

        $payload = [
            'name' => 'E075 F468 key ' . bin2hex(random_bytes(3)),
            'scopes' => $scopes,
        ];
        if ($externalPartnerId !== null) {
            $payload['external_partner_id'] = $externalPartnerId;
        }

        $created = $this->apiPost('/v2/admin/federation/api-keys', $payload);
        self::assertSame(201, $created->getStatusCode(), 'the key was issued. ' . $created->getContent());

        $this->app['auth']->forgetGuards();

        return (string) $created->json('data.api_key');
    }

    private function externalPartner(int $tenantId, string $name): int
    {
        return (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => $name,
            'base_url' => 'https://e075-f468-' . bin2hex(random_bytes(5)) . '.invalid',
            'api_path' => '/api/v1/federation',
            'protocol_type' => 'nexus',
            'status' => 'active',
            'allow_member_search' => 1,
            'allow_messaging' => 1,
            'allow_transactions' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * @param array<int,array<string,mixed>> $rows
     * @return array<string,mixed>|null
     */
    private function rowFor(array $rows, int $id): ?array
    {
        foreach ($rows as $row) {
            if (is_array($row) && (int) ($row['id'] ?? 0) === $id) {
                return $row;
            }
        }

        return null;
    }

    private function makeTenant(int $id, string $slug): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => $id],
            [
                'name' => 'E075 F468 ' . $slug,
                'slug' => $slug,
                'domain' => null,
                'is_active' => 1,
                'depth' => 0,
                'path' => '/' . $id . '/',
                'allows_subtenants' => 0,
                'max_depth' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    private function federatedMember(int $tenantId): User
    {
        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $user->id)->update(['tenant_id' => $tenantId]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'show_location_federated' => 0,
                'show_skills_federated' => 0,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );

        return User::withoutGlobalScopes()->find($user->id);
    }

    private function federatedMessage(User $sender, User $receiver): int
    {
        return (int) DB::table('messages')->insertGetId([
            'tenant_id' => (int) $receiver->tenant_id,
            'sender_id' => (int) $sender->id,
            'receiver_id' => (int) $receiver->id,
            'subject' => self::SECRET_SUBJECT,
            'body' => self::SECRET_BODY,
            'is_federated' => 1,
            'created_at' => now(),
        ]);
    }

    private function god(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update([
            'tenant_id' => $this->testTenantId,
            'role' => 'admin',
            'is_admin' => 1,
            'is_super_admin' => 1,
            'is_god' => 1,
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function useKey(string $apiKey, string $method, string $uri): void
    {
        FederationApiMiddleware::reset();
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = $method;
        $_SERVER['REQUEST_URI'] = $uri;
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }

    private function allowSafeguarding(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateExternalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateCrossTenantContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateLocalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('assertLocalContactAllowed')->andReturnNull();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    private function allowDecision(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'e076-c',
        );
    }
}
