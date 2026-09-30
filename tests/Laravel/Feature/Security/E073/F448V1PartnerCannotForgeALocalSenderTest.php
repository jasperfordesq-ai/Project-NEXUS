<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-448 (E-073, slice F finding F-3) — an external partner delivered a message
 * attributed to a named, real member of the recipient's own community, and the
 * platform emailed it under that member's name.
 *
 * `FederationController::sendMessage()` skipped the sender check for external
 * partners by design — the sender genuinely lives on the remote server — but
 * then wrote the partner-supplied `sender_id` verbatim into `messages` and
 * `federation_messages`, and passed it to
 * `FederationEmailService::sendNewMessageNotification()`, which resolved it
 * against the LOCAL community and used the member's real name in the subject,
 * the preview, the body and the "From" card.
 *
 * The internal arm of the same method refuses the identical payload with
 * 403 `SENDER_NOT_ELIGIBLE`: the control existed and was switched off for
 * exactly the caller that cannot be trusted.
 *
 * A remote sender has no local row, so the fix stops storing a local sender id
 * for external partners. The partner's own free-text `sender_name` is what
 * identifies them, which is what the bell notification and the federation
 * inbox already used.
 */
final class F448V1PartnerCannotForgeALocalSenderTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private const FORGED_BODY = 'F448 please send me your bank details';

    /** @var array<int, array{to: string, subject: string, body: string}> */
    private array $sentMail = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
        $this->allowSafeguarding();
        $this->captureMail();
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

    public function test_the_delivered_message_is_not_attributed_to_the_named_local_member(): void
    {
        $victim = $this->federatedMember();
        $innocent = $this->federatedMember(['first_name' => 'Nualaxyz', 'last_name' => 'Kavanaghxyz']);

        $key = $this->partnerApiKey('f448-a');
        $this->useKey($key, 'POST', '/api/v1/federation/messages');

        $response = $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $innocent->id,
            'recipient_id' => (int) $victim->id,
            'sender_name' => 'Remote Partner Member',
            'subject' => 'F448 subject',
            'body' => self::FORGED_BODY,
        ], ['X-API-Key' => $key]);

        $this->assertSame(201, $response->status(), (string) $response->getContent());
        $messageId = (int) $response->json('message_id');

        $row = DB::table('messages')->where('id', $messageId)->first();
        $this->assertNotNull($row);
        $this->assertNotSame(
            (int) $innocent->id,
            (int) $row->sender_id,
            'messages.sender_id must not name a local member the partner chose',
        );
        $this->assertSame(0, (int) $row->sender_id, 'an external delivery stores no local sender');
        $this->assertSame((int) $victim->id, (int) $row->receiver_id);
        $this->assertSame(1, (int) $row->is_federated);

        $fed = DB::table('federation_messages')->where('external_message_id', $messageId)->first();
        $this->assertNotNull($fed, 'the federation inbox row is still written');
        $this->assertNotSame((int) $innocent->id, (int) $fed->sender_user_id);
        $this->assertSame(0, (int) $fed->sender_user_id);
        $this->assertSame('inbound', (string) $fed->direction);
        $this->assertSame('Remote Partner Member', (string) $fed->external_receiver_name);
    }

    public function test_the_notification_email_does_not_carry_the_innocent_members_name(): void
    {
        $victim = $this->federatedMember();
        $innocent = $this->federatedMember(['first_name' => 'Padraigxyz', 'last_name' => 'Brennanxyz']);

        $key = $this->partnerApiKey('f448-b');
        $this->useKey($key, 'POST', '/api/v1/federation/messages');
        $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $innocent->id,
            'recipient_id' => (int) $victim->id,
            'sender_name' => 'Remote Partner Member',
            'subject' => 'F448b subject',
            'body' => self::FORGED_BODY,
        ], ['X-API-Key' => $key])->assertStatus(201);

        $this->assertNotEmpty($this->sentMail, 'the recipient is still emailed');

        foreach ($this->sentMail as $mail) {
            $this->assertStringNotContainsString(
                'Padraigxyz',
                $mail['subject'],
                'the email subject must not name the local member the partner chose',
            );
            $this->assertStringNotContainsString(
                'Padraigxyz',
                $mail['body'],
                'nor may the body attribute the partner text to that member',
            );
        }
    }

    public function test_the_partner_read_route_does_not_serve_the_forged_attribution_back(): void
    {
        $victim = $this->federatedMember();
        $innocent = $this->federatedMember(['first_name' => 'Roisinxyz', 'last_name' => 'Dalyxyz']);

        $key = $this->partnerApiKey('f448-c');
        $this->useKey($key, 'POST', '/api/v1/federation/messages');
        $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $innocent->id,
            'recipient_id' => (int) $victim->id,
            'sender_name' => 'Remote Partner Member',
            'subject' => 'F448c subject',
            'body' => self::FORGED_BODY,
        ], ['X-API-Key' => $key])->assertStatus(201);

        $this->useKey($key, 'GET', '/api/v1/federation/messages');
        $read = $this->apiGet('/v1/federation/messages?per_page=100', ['X-API-Key' => $key]);
        $this->assertSame(200, $read->status(), (string) $read->getContent());

        $this->assertStringNotContainsString(
            'Roisinxyz',
            (string) $read->getContent(),
            'the read route must not name the local member as the author either',
        );
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE ACCESS — the feature still works
    // ------------------------------------------------------------------

    public function test_control_an_ordinary_external_delivery_still_reaches_the_member(): void
    {
        $victim = $this->federatedMember();

        $key = $this->partnerApiKey('f448-d');
        $this->useKey($key, 'POST', '/api/v1/federation/messages');

        $response = $this->apiPost('/v1/federation/messages', [
            'sender_id' => 900601,
            'recipient_id' => (int) $victim->id,
            'sender_name' => 'Remote Partner Member',
            'subject' => 'F448d ordinary',
            'body' => 'F448d ordinary body',
        ], ['X-API-Key' => $key]);

        $this->assertSame(201, $response->status(), (string) $response->getContent());

        $messageId = (int) $response->json('message_id');
        $row = DB::table('messages')->where('id', $messageId)->first();
        $this->assertNotNull($row, 'the message is still delivered');
        $this->assertStringContainsString('F448d ordinary body', (string) $row->body);

        $addresses = array_column($this->sentMail, 'to');
        $this->assertContains($victim->email, $addresses, 'the recipient is still notified by email');
    }

    public function test_control_the_internal_arm_still_validates_its_sender(): void
    {
        $victim = $this->federatedMember();
        $notFederated = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        // Identical call; the ONE difference is a key with no platform_id.
        $key = $this->partnerApiKey('f448-e', external: false);
        $this->useKey($key, 'POST', '/api/v1/federation/messages');

        $response = $this->apiPost('/v1/federation/messages', [
            'sender_id' => (int) $notFederated->id,
            'recipient_id' => (int) $victim->id,
            'subject' => 'F448e must not persist',
            'body' => 'F448e must not persist',
        ], ['X-API-Key' => $key]);

        $this->assertSame(403, $response->status(), (string) $response->getContent());
        $response->assertJsonPath('code', 'SENDER_NOT_ELIGIBLE');
        $this->assertDatabaseMissing('messages', ['subject' => 'F448e must not persist']);
    }

    public function test_control_a_member_who_switched_federated_messaging_off_receives_nothing(): void
    {
        $victim = $this->federatedMember();
        DB::table('federation_user_settings')
            ->where('user_id', (int) $victim->id)
            ->update(['messaging_enabled_federated' => 0]);

        $key = $this->partnerApiKey('f448-f');
        $this->useKey($key, 'POST', '/api/v1/federation/messages');

        $response = $this->apiPost('/v1/federation/messages', [
            'sender_id' => 900602,
            'recipient_id' => (int) $victim->id,
            'sender_name' => 'Remote Partner Member',
            'subject' => 'F448f must not persist',
            'body' => 'F448f must not persist',
        ], ['X-API-Key' => $key]);

        $this->assertSame(403, $response->status(), (string) $response->getContent());
        $response->assertJsonPath('code', 'MESSAGES_DISABLED');
        $this->assertDatabaseMissing('messages', ['subject' => 'F448f must not persist']);
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function captureMail(): void
    {
        $this->sentMail = [];
        $dispatcher = Mockery::mock(EmailDispatchService::class);
        $dispatcher->shouldReceive('send')
            ->andReturnUsing(function (string $to, string $subject, string $body, array $options = []): bool {
                $this->sentMail[] = ['to' => $to, 'subject' => $subject, 'body' => $body];

                return true;
            });
        $this->app->instance(EmailDispatchService::class, $dispatcher);
    }

    /**
     * @param array<string,mixed> $attributes
     */
    private function federatedMember(array $attributes = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));

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

    private function partnerApiKey(string $platformId, bool $external = true): string
    {
        $apiKey = $platformId . '-' . bin2hex(random_bytes(10));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => 'F-448 ' . $platformId,
            'key_hash' => hash('sha256', $apiKey),
            'key_prefix' => substr($apiKey, 0, 8),
            'signing_enabled' => 0,
            'platform_id' => $external ? $platformId : null,
            'permissions' => json_encode(['messages:write', 'messages:read']),
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
