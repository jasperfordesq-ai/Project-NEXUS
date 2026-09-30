<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-446 (E-073, slice F finding F-1) — a partner API key read the full body of
 * every federated message in the community, including messages it neither sent
 * nor received.
 *
 * `FederationController::getMessages()` filtered on the calling key's tenant
 * alone, and for an EXTERNAL key that tenant is the local community — so the
 * filter matched every federated message there. It was the only v1 read with
 * no `$isExternal` branch at all: its siblings `members()` and `listings()`
 * each join `federation_partnerships` and require an active partnership with
 * the matching switch, and `getReviews()` checks the subject's own consent.
 *
 * The recipient's own member API will not return these rows to them —
 * `MessageService` filters `is_federated = 0` on every conversation read — so
 * the partner credential saw content the member it belongs to could not
 * retrieve.
 *
 * The fix gives the external arm a participation filter: a partner may read
 * only the messages recorded against its own partner record in
 * `federation_messages`.
 */
final class F446V1PartnerMessagesRequireParticipationTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private const SECRET_BODY = 'F446 CONFIDENTIAL BODY alpha-to-victim';
    private const BETA_BODY = 'F446 beta own message body';

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
        $this->allowSafeguarding();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  THE HARM
    // ------------------------------------------------------------------

    public function test_a_second_partner_cannot_read_another_partners_private_message(): void
    {
        $victim = $this->federatedMember();
        $namedSender = $this->federatedMember();

        $alphaKey = $this->partnerApiKey('f446-alpha', ['messages:write', 'messages:read']);
        $this->useKey($alphaKey, 'POST', '/api/v1/federation/messages');
        $sent = $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $namedSender->id,
            'recipient_id' => (int) $victim->id,
            'sender_name' => 'Alpha Remote Member',
            'subject' => 'F446 subject alpha',
            'body' => self::SECRET_BODY,
        ], ['X-API-Key' => $alphaKey]);
        $this->assertSame(201, $sent->status(), (string) $sent->getContent());

        // A completely different credential on the same community, never a
        // party to that message.
        $betaKey = $this->partnerApiKey('f446-beta', ['messages:read']);
        $this->useKey($betaKey, 'GET', '/api/v1/federation/messages');
        $read = $this->apiGet('/v1/federation/messages?per_page=100', ['X-API-Key' => $betaKey]);

        $this->assertSame(200, $read->status(), (string) $read->getContent());
        $this->assertNotContains(
            self::SECRET_BODY,
            array_column($read->json('data') ?? [], 'body'),
            'a partner must not read the body of a message it was never a party to',
        );
        $this->assertStringNotContainsString(self::SECRET_BODY, (string) $read->getContent());
    }

    public function test_the_direction_parameter_does_not_reopen_the_leak(): void
    {
        $victim = $this->federatedMember();
        $namedSender = $this->federatedMember();

        $alphaKey = $this->partnerApiKey('f446b-alpha', ['messages:write', 'messages:read']);
        $this->useKey($alphaKey, 'POST', '/api/v1/federation/messages');
        $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $namedSender->id,
            'recipient_id' => (int) $victim->id,
            'sender_name' => 'Alpha Remote Member',
            'subject' => 'F446b subject alpha',
            'body' => self::SECRET_BODY,
        ], ['X-API-Key' => $alphaKey])->assertStatus(201);

        $betaKey = $this->partnerApiKey('f446b-beta', ['messages:read']);

        foreach (['inbound', 'outbound', 'all'] as $direction) {
            $this->useKey($betaKey, 'GET', '/api/v1/federation/messages');
            $read = $this->apiGet(
                '/v1/federation/messages?per_page=100&direction=' . $direction,
                ['X-API-Key' => $betaKey],
            );
            $this->assertSame(200, $read->status(), (string) $read->getContent());
            $this->assertStringNotContainsString(
                self::SECRET_BODY,
                (string) $read->getContent(),
                'direction=' . $direction . ' must not widen what the partner may read',
            );
        }
    }

    public function test_the_partner_still_cannot_read_what_the_member_themselves_cannot(): void
    {
        $victim = $this->federatedMember();
        $namedSender = $this->federatedMember();

        $alphaKey = $this->partnerApiKey('f446c-alpha', ['messages:write', 'messages:read']);
        $this->useKey($alphaKey, 'POST', '/api/v1/federation/messages');
        $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $namedSender->id,
            'recipient_id' => (int) $victim->id,
            'sender_name' => 'Alpha Remote Member',
            'subject' => 'F446c subject',
            'body' => self::SECRET_BODY,
        ], ['X-API-Key' => $alphaKey])->assertStatus(201);

        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        \Laravel\Sanctum\Sanctum::actingAs($victim, ['*']);
        $mine = $this->apiGet('/v2/messages');
        $this->assertSame(200, $mine->status(), (string) $mine->getContent());
        $this->assertStringNotContainsString(self::SECRET_BODY, (string) $mine->getContent());

        $betaKey = $this->partnerApiKey('f446c-beta', ['messages:read']);
        $this->useKey($betaKey, 'GET', '/api/v1/federation/messages');
        $read = $this->apiGet('/v1/federation/messages?per_page=100', ['X-API-Key' => $betaKey]);
        $this->assertSame(200, $read->status());
        $this->assertStringNotContainsString(
            self::SECRET_BODY,
            (string) $read->getContent(),
            'an uninvolved partner must not see what the recipient cannot retrieve either',
        );
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE ACCESS — a partner reads back its own correspondence
    // ------------------------------------------------------------------

    public function test_control_a_partner_reads_back_the_message_it_delivered(): void
    {
        $counterparty = $this->federatedMember();
        $namedSender = $this->federatedMember();

        $betaKey = $this->partnerApiKey('f446d-beta', ['messages:write', 'messages:read']);
        $this->useKey($betaKey, 'POST', '/api/v1/federation/messages');
        $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $namedSender->id,
            'recipient_id' => (int) $counterparty->id,
            'sender_name' => 'Beta Remote Member',
            'subject' => 'F446d beta subject',
            'body' => self::BETA_BODY,
        ], ['X-API-Key' => $betaKey])->assertStatus(201);

        $this->useKey($betaKey, 'GET', '/api/v1/federation/messages');
        $read = $this->apiGet('/v1/federation/messages?per_page=100', ['X-API-Key' => $betaKey]);

        $this->assertSame(200, $read->status(), (string) $read->getContent());
        $this->assertContains(
            self::BETA_BODY,
            array_column($read->json('data') ?? [], 'body'),
            'the partner that delivered the message can of course read it back',
        );
    }

    // ------------------------------------------------------------------
    //  The gates that already worked must still work
    // ------------------------------------------------------------------

    public function test_control_a_key_without_messages_read_is_still_refused(): void
    {
        $victim = $this->federatedMember();
        $namedSender = $this->federatedMember();

        $alphaKey = $this->partnerApiKey('f446e-alpha', ['messages:write']);
        $this->useKey($alphaKey, 'POST', '/api/v1/federation/messages');
        $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $namedSender->id,
            'recipient_id' => (int) $victim->id,
            'sender_name' => 'Alpha Remote Member',
            'subject' => 'F446e subject',
            'body' => self::SECRET_BODY,
        ], ['X-API-Key' => $alphaKey])->assertStatus(201);

        $this->useKey($alphaKey, 'GET', '/api/v1/federation/messages');
        $read = $this->apiGet('/v1/federation/messages', ['X-API-Key' => $alphaKey]);

        $this->assertSame(403, $read->status(), (string) $read->getContent());
        $read->assertJsonPath('code', 'PERMISSION_DENIED');
    }

    public function test_control_a_key_belonging_to_another_community_reads_nothing(): void
    {
        $victim = $this->federatedMember();
        $namedSender = $this->federatedMember();

        $alphaKey = $this->partnerApiKey('f446f-alpha', ['messages:write', 'messages:read']);
        $this->useKey($alphaKey, 'POST', '/api/v1/federation/messages');
        $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $namedSender->id,
            'recipient_id' => (int) $victim->id,
            'sender_name' => 'Alpha Remote Member',
            'subject' => 'F446f subject',
            'body' => self::SECRET_BODY,
        ], ['X-API-Key' => $alphaKey])->assertStatus(201);

        $foreignKey = $this->partnerApiKey('f446f-foreign', ['messages:read'], $this->otherTenantId());
        $this->useKey($foreignKey, 'GET', '/api/v1/federation/messages');
        $read = $this->apiGet('/v1/federation/messages?per_page=100', ['X-API-Key' => $foreignKey]);

        $this->assertSame(200, $read->status(), (string) $read->getContent());
        $this->assertStringNotContainsString(self::SECRET_BODY, (string) $read->getContent());
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function federatedMember(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );

        return $user;
    }

    private function otherTenantId(): int
    {
        $row = DB::table('tenants')->where('id', '!=', $this->testTenantId)->first(['id']);
        if ($row) {
            return (int) $row->id;
        }

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'F446 other community',
            'slug' => 'f446-other-' . bin2hex(random_bytes(4)),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * A partner that is actually configured on the community: the API key plus
     * the `federation_external_partners` record the platform matches it to.
     *
     * @param array<int,string> $permissions
     */
    private function partnerApiKey(string $platformId, array $permissions, ?int $tenantId = null): string
    {
        $tenantId ??= $this->testTenantId;

        DB::table('federation_external_partners')->insert([
            'tenant_id' => $tenantId,
            'name' => $platformId,
            'base_url' => 'https://' . $platformId . '.example.test',
            'protocol_type' => 'nexus',
            'status' => 'active',
            'allow_messaging' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $apiKey = $platformId . '-' . bin2hex(random_bytes(10));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $tenantId,
            'name' => 'F-446 ' . $platformId,
            'key_hash' => hash('sha256', $apiKey),
            'key_prefix' => substr($apiKey, 0, 8),
            'signing_enabled' => 0,
            'platform_id' => $platformId,
            'permissions' => json_encode($permissions),
            'rate_limit' => 100000,
            'status' => 'active',
            'created_by' => 1,
            'created_at' => now(),
            'updated_at' => now(),
            'hourly_request_count' => 0,
        ]);

        return $apiKey;
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
            policyVersion: 'e074-e',
        );
    }
}
