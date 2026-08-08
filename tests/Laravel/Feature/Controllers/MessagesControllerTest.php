<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Events\SafeguardingContactAttemptBlocked;
use App\Events\SafeguardingCoordinationRequested;
use App\Models\User;
use App\Services\SafeguardingTriggerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for MessagesController.
 *
 * Covers conversations, send, mark read, unread count, archive, reactions, typing.
 */
class MessagesControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function createSafeguardingOption(array $triggers, string $optionKey): int
    {
        if (($triggers['vetting_type_required'] ?? null) === 'dbs_enhanced') {
            DB::table('tenant_safeguarding_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId],
                [
                    'jurisdiction' => 'england_wales',
                    'policy_version' => 'safeguarded-contact-v1:test',
                    'configured_by' => null,
                    'configured_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ],
            );
            app(\App\Services\SafeguardingJurisdictionService::class)->forget($this->testTenantId);
        }

        return DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => $optionKey . '_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Test safeguarding option',
            'description' => 'Test safeguarding option',
            'sort_order' => 0,
            'is_active' => 1,
            'is_required' => 0,
            'triggers' => json_encode($triggers),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function selectSafeguardingOptionForUser(User $user, int $optionId): void
    {
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        SafeguardingTriggerService::invalidateCache($user->id, $this->testTenantId);
    }

    // ================================================================
    // CONVERSATIONS — Happy path
    // ================================================================

    public function test_conversations_returns_collection(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/messages');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data',
            'meta' => ['per_page', 'has_more'],
        ]);
    }

    // ================================================================
    // CONVERSATIONS — Authentication required
    // ================================================================

    public function test_conversations_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/messages');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // SEND — Happy path
    // ================================================================

    public function test_send_message_creates_message(): void
    {
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $response = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Hello, how are you?',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    public function test_send_message_allows_provider_declaration_that_only_records_required_vetting(): void
    {
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $optionId = $this->createSafeguardingOption([
            'notify_admin_on_selection' => true,
            'vetting_type_required' => 'dbs_enhanced',
        ], 'provider_declaration');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $response = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Hello, can we arrange a time?',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $this->assertDatabaseHas('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Hello, can we arrange a time?',
        ]);
    }

    public function test_send_message_blocks_when_recipient_requires_vetted_interaction_and_sender_lacks_vetting(): void
    {
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $optionId = $this->createSafeguardingOption([
            'requires_vetted_interaction' => true,
            'vetting_type_required' => 'dbs_enhanced',
        ], 'vetted_interaction');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $response = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Hello, can we arrange a time?',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $response->assertJsonPath('errors.0.required_vetting_types.0', 'dbs_enhanced');
        $response->assertJsonPath('errors.0.required_vetting_labels.0', 'Enhanced DBS');
        $this->assertStringContainsString('community safeguarding rule', $response->json('errors.0.message'));
        $this->assertStringNotContainsString('safeguarding.errors.vetting_required', $response->json('errors.0.message'));
        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Hello, can we arrange a time?',
        ]);
    }

    public function test_send_message_dispatches_staff_alert_when_safeguarding_blocks_contact_attempt(): void
    {
        Event::fake([SafeguardingContactAttemptBlocked::class]);

        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $optionId = $this->createSafeguardingOption([
            'requires_vetted_interaction' => true,
            'vetting_type_required' => 'dbs_enhanced',
        ], 'vetted_interaction_alert');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $response = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Hello, can we arrange a time?',
        ]);

        $response->assertStatus(403);

        Event::assertDispatched(
            SafeguardingContactAttemptBlocked::class,
            fn (SafeguardingContactAttemptBlocked $event) =>
                $event->tenantId === $this->testTenantId
                && $event->senderId === $sender->id
                && $event->recipientId === $recipient->id
                && $event->reasonCode === 'VETTING_REQUIRED'
                && $event->requiredVettingTypes === ['dbs_enhanced']
        );
    }

    public function test_send_message_blocks_when_recipient_requires_coordinator_mediated_contact(): void
    {
        Event::fake([SafeguardingContactAttemptBlocked::class]);

        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $optionId = $this->createSafeguardingOption([
            'restricts_messaging' => true,
            'notify_admin_on_selection' => true,
        ], 'coordinator_contact');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $response = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Hello, can we arrange a time?',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'SAFEGUARDING_CONTACT_RESTRICTED');
        $this->assertStringContainsString('coordinator', $response->json('errors.0.message'));
        $this->assertStringNotContainsString('safeguarding.errors.contact_restricted', $response->json('errors.0.message'));
        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Hello, can we arrange a time?',
        ]);

        Event::assertDispatched(
            SafeguardingContactAttemptBlocked::class,
            fn (SafeguardingContactAttemptBlocked $event) =>
                $event->tenantId === $this->testTenantId
                && $event->senderId === $sender->id
                && $event->recipientId === $recipient->id
                && $event->reasonCode === 'SAFEGUARDING_CONTACT_RESTRICTED'
                && $event->requiredVettingTypes === []
        );
    }

    // ================================================================
    // SAFEGUARDING — Preflight (conversation open) must NOT alert staff
    // ================================================================

    public function test_conversation_preflight_returns_contact_restricted_state_without_alerting_staff(): void
    {
        Event::fake([SafeguardingContactAttemptBlocked::class, SafeguardingCoordinationRequested::class]);

        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $optionId = $this->createSafeguardingOption([
            'restricts_messaging' => true,
        ], 'preflight_restricted');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $response = $this->apiGet('/v2/messages/' . $recipient->id);

        $response->assertStatus(200);
        $response->assertJsonPath('meta.conversation.safeguarding.restricted', true);
        $response->assertJsonPath('meta.conversation.safeguarding.code', 'SAFEGUARDING_CONTACT_RESTRICTED');
        $response->assertJsonPath('meta.conversation.safeguarding.can_request_coordinator', true);

        // Opening the conversation must NEVER alert staff.
        Event::assertNotDispatched(SafeguardingContactAttemptBlocked::class);
        Event::assertNotDispatched(SafeguardingCoordinationRequested::class);
    }

    public function test_conversation_preflight_returns_vetting_required_state_without_alerting_staff(): void
    {
        Event::fake([SafeguardingContactAttemptBlocked::class, SafeguardingCoordinationRequested::class]);

        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $optionId = $this->createSafeguardingOption([
            'requires_vetted_interaction' => true,
            'vetting_type_required' => 'dbs_enhanced',
        ], 'preflight_vetting');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $response = $this->apiGet('/v2/messages/' . $recipient->id);

        $response->assertStatus(200);
        $response->assertJsonPath('meta.conversation.safeguarding.restricted', true);
        $response->assertJsonPath('meta.conversation.safeguarding.code', 'VETTING_REQUIRED');
        $response->assertJsonPath('meta.conversation.safeguarding.required_vetting_types.0', 'dbs_enhanced');
        $response->assertJsonPath('meta.conversation.safeguarding.required_vetting_labels.0', 'Enhanced DBS');

        Event::assertNotDispatched(SafeguardingContactAttemptBlocked::class);
        Event::assertNotDispatched(SafeguardingCoordinationRequested::class);
    }

    public function test_conversation_preflight_has_no_safeguarding_state_for_unrestricted_recipient(): void
    {
        Event::fake([SafeguardingContactAttemptBlocked::class, SafeguardingCoordinationRequested::class]);

        $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $response = $this->apiGet('/v2/messages/' . $recipient->id);

        $response->assertStatus(200);
        $response->assertJsonPath('meta.conversation.safeguarding', null);

        Event::assertNotDispatched(SafeguardingContactAttemptBlocked::class);
        Event::assertNotDispatched(SafeguardingCoordinationRequested::class);
    }

    // ================================================================
    // SAFEGUARDING — Explicit "request coordinator help" action
    // ================================================================

    public function test_request_coordinator_dispatches_alert_when_contact_is_restricted(): void
    {
        Event::fake([SafeguardingCoordinationRequested::class]);

        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $optionId = $this->createSafeguardingOption([
            'restricts_messaging' => true,
        ], 'coordinator_help_restricted');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $response = $this->apiPost('/v2/messages/' . $recipient->id . '/request-coordinator', []);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonPath('data.success', true);

        Event::assertDispatched(
            SafeguardingCoordinationRequested::class,
            fn (SafeguardingCoordinationRequested $event) =>
                $event->tenantId === $this->testTenantId
                && $event->senderId === $sender->id
                && $event->recipientId === $recipient->id
                && $event->reasonCode === 'SAFEGUARDING_CONTACT_RESTRICTED'
        );
    }

    public function test_request_coordinator_dispatches_alert_when_vetting_is_required(): void
    {
        Event::fake([SafeguardingCoordinationRequested::class]);

        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $optionId = $this->createSafeguardingOption([
            'requires_vetted_interaction' => true,
            'vetting_type_required' => 'dbs_enhanced',
        ], 'coordinator_help_vetting');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $response = $this->apiPost('/v2/messages/' . $recipient->id . '/request-coordinator', []);

        $this->assertContains($response->getStatusCode(), [200, 201]);

        Event::assertDispatched(
            SafeguardingCoordinationRequested::class,
            fn (SafeguardingCoordinationRequested $event) =>
                $event->reasonCode === 'VETTING_REQUIRED'
                && $event->requiredVettingTypes === ['dbs_enhanced']
        );
    }

    public function test_request_coordinator_does_not_alert_when_recipient_is_not_restricted(): void
    {
        Event::fake([SafeguardingCoordinationRequested::class]);

        $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $response = $this->apiPost('/v2/messages/' . $recipient->id . '/request-coordinator', []);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.code', 'SAFEGUARDING_NOT_RESTRICTED');

        Event::assertNotDispatched(SafeguardingCoordinationRequested::class);
    }

    public function test_send_message_allows_vetted_interaction_when_sender_holds_valid_required_vetting(): void
    {
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $optionId = $this->createSafeguardingOption([
            'requires_vetted_interaction' => true,
            'vetting_type_required' => 'dbs_enhanced',
        ], 'vetted_interaction_allowed');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $broker = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'broker',
            'status' => 'active',
        ]);
        DB::table('member_vetting_attestations')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $sender->id,
            'scheme_code' => 'dbs_england_wales',
            'attestation_code' => 'dbs_enhanced',
            'purpose_code' => 'safeguarded_member_contact',
            'scope_type' => 'tenant',
            'scope_identifier' => '',
            'decision' => 'confirmed',
            'confirmed_by' => $broker->id,
            'confirmed_at' => now(),
            'policy_version' => 'safeguarded-contact-v1:test',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Hello, can we arrange a time?',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    // ================================================================
    // SEND — Authentication required
    // ================================================================

    public function test_send_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/messages', [
            'recipient_id' => 1,
            'body' => 'Hello',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // SEND — Validation errors
    // ================================================================

    public function test_send_returns_422_without_recipient(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/messages', [
            'body' => 'No recipient specified.',
        ]);

        $response->assertStatus(422);
    }

    public function test_send_returns_422_without_body(): void
    {
        $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
        ]);

        $response->assertStatus(422);
    }

    public function test_generic_send_rejects_client_supplied_voice_pointers(): void
    {
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();

        foreach (['voice_url', 'audio_url'] as $field) {
            $body = 'Raw voice pointer attempt ' . $field;
            $response = $this->apiPost('/v2/messages', [
                'recipient_id' => $recipient->id,
                'body' => $body,
                $field => '/uploads/' . $this->testTenantId . '/voice_messages/../../../../.env',
            ]);

            $response
                ->assertStatus(422)
                ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
                ->assertJsonPath('errors.0.field', 'voice_message');
            $this->assertDatabaseMissing('messages', [
                'tenant_id' => $this->testTenantId,
                'sender_id' => $sender->id,
                'receiver_id' => $recipient->id,
                'body' => $body,
            ]);
        }
    }

    // ================================================================
    // SHOW CONVERSATION — Authentication required
    // ================================================================

    public function test_show_conversation_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/messages/1');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // SHOW CONVERSATION — Not found
    // ================================================================

    public function test_show_conversation_returns_404_for_nonexistent_user(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/messages/999999');

        $response->assertStatus(404);
    }

    public function test_show_conversation_normalizes_legacy_reactions_without_internal_metadata(): void
    {
        $viewer = $this->authenticatedUser();
        $otherUser = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);
        $thumbsUp = "\u{1F44D}";

        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $otherUser->id,
            'receiver_id' => $viewer->id,
            'body' => 'Legacy reaction payload',
            'reactions' => json_encode([
                $thumbsUp => 1,
                '_users' => ["{$viewer->id}_{$thumbsUp}" => true],
            ], JSON_UNESCAPED_UNICODE),
            'created_at' => now(),
        ]);

        $response = $this->apiGet('/v2/messages/' . $otherUser->id);

        $response->assertStatus(200);
        $this->assertSame([$thumbsUp => 1], $response->json('data.0.reactions'));
        $this->assertArrayNotHasKey('_users', $response->json('data.0.reactions'));
    }

    public function test_show_conversation_returns_only_counts_from_canonical_reactions(): void
    {
        $viewer = $this->authenticatedUser();
        $otherUser = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);
        $thumbsUp = "\u{1F44D}";

        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $otherUser->id,
            'receiver_id' => $viewer->id,
            'body' => 'Canonical reaction payload',
            'created_at' => now(),
        ]);
        DB::table('message_reactions')->insert([
            'tenant_id' => $this->testTenantId,
            'message_id' => $messageId,
            'user_id' => $viewer->id,
            'emoji' => $thumbsUp,
            'created_at' => now(),
        ]);

        $response = $this->apiGet('/v2/messages/' . $otherUser->id);

        $response->assertStatus(200);
        $this->assertSame([$thumbsUp => 1], $response->json('data.0.reactions'));
        $this->assertArrayNotHasKey('user_ids', $response->json('data.0.reactions'));
    }

    public function test_reactions_batch_returns_public_counts_without_reactor_ids(): void
    {
        $viewer = $this->authenticatedUser();
        $otherUser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $unrelatedSender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $unrelatedReceiver = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $thumbsUp = "\u{1F44D}";

        $visibleMessageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $otherUser->id,
            'receiver_id' => $viewer->id,
            'body' => 'Visible reaction counts',
            'created_at' => now(),
        ]);
        $unrelatedMessageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $unrelatedSender->id,
            'receiver_id' => $unrelatedReceiver->id,
            'body' => 'Unrelated reaction counts',
            'created_at' => now(),
        ]);

        DB::table('message_reactions')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'message_id' => $visibleMessageId,
                'user_id' => $viewer->id,
                'emoji' => $thumbsUp,
                'created_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'message_id' => $visibleMessageId,
                'user_id' => $otherUser->id,
                'emoji' => $thumbsUp,
                'created_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'message_id' => $unrelatedMessageId,
                'user_id' => $unrelatedSender->id,
                'emoji' => $thumbsUp,
                'created_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'message_id' => $visibleMessageId,
                'user_id' => $viewer->id,
                'emoji' => 'invalid',
                'created_at' => now(),
            ],
        ]);

        $response = $this->apiGet(
            "/v2/messages/reactions/batch?ids={$visibleMessageId},{$unrelatedMessageId}"
        );

        $response->assertStatus(200);
        $payload = $response->json('data.reactions');
        $this->assertIsArray($payload);
        $this->assertArrayHasKey($visibleMessageId, $payload);
        $this->assertArrayNotHasKey($unrelatedMessageId, $payload);
        $this->assertCount(1, $payload[$visibleMessageId]);
        $this->assertSame($thumbsUp, $payload[$visibleMessageId][0]['emoji']);
        $this->assertSame(2, $payload[$visibleMessageId][0]['count']);
        $this->assertArrayNotHasKey('user_ids', $payload[$visibleMessageId][0]);
    }

    // ================================================================
    // MARK READ — Authentication required
    // ================================================================

    public function test_mark_read_returns_401_without_auth(): void
    {
        $response = $this->apiPut('/v2/messages/1/read');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // UNREAD COUNT — Happy path
    // ================================================================

    public function test_unread_count_returns_count(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/messages/unread-count');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['count']]);
    }

    public function test_unread_count_excludes_federated_messages_from_direct_messages_badge(): void
    {
        $recipient = $this->authenticatedUser();
        $directSender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $directSender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Direct unread message',
            'is_read' => false,
            'is_federated' => 0,
            'created_at' => now(),
        ]);

        DB::table('federation_messages')->insert([
            'sender_user_id' => 999001,
            'sender_tenant_id' => 999,
            'receiver_user_id' => $recipient->id,
            'receiver_tenant_id' => $this->testTenantId,
            'subject' => 'Federated unread message',
            'body' => 'This belongs to the federation inbox, not /messages.',
            'direction' => 'inbound',
            'status' => 'unread',
            'created_at' => now(),
        ]);

        $response = $this->apiGet('/v2/messages/unread-count');

        $response->assertStatus(200);
        $response->assertJsonPath('data.count', 1);
    }

    public function test_unread_count_excludes_messages_hidden_from_receiver_inbox(): void
    {
        if (!Schema::hasColumn('messages', 'archived_by_receiver') || !Schema::hasColumn('messages', 'is_deleted_receiver')) {
            $this->markTestSkipped('Per-user message visibility columns are not available in this test database.');
        }

        $recipient = $this->authenticatedUser();
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Archived unread message',
            'is_read' => false,
            'is_federated' => 0,
            'archived_by_receiver' => now(),
            'created_at' => now(),
        ]);

        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Deleted-for-receiver unread message',
            'is_read' => false,
            'is_federated' => 0,
            'is_deleted_receiver' => true,
            'created_at' => now(),
        ]);

        $response = $this->apiGet('/v2/messages/unread-count');

        $response->assertStatus(200);
        $response->assertJsonPath('data.count', 0);
    }

    // ================================================================
    // UNREAD COUNT — Authentication required
    // ================================================================

    public function test_unread_count_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/messages/unread-count');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // ARCHIVE CONVERSATION — Authentication required
    // ================================================================

    public function test_archive_conversation_returns_401_without_auth(): void
    {
        $response = $this->apiDelete('/v2/messages/conversations/1');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // ARCHIVE CONVERSATION — Not found
    // ================================================================

    public function test_archive_conversation_returns_404_for_nonexistent(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/messages/conversations/999999');

        $response->assertStatus(404);
    }

    // ================================================================
    // EDIT MESSAGE — Validation
    // ================================================================

    public function test_edit_message_returns_400_without_body(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/messages/1', [
            'body' => '',
        ]);

        $response->assertStatus(400);
    }

    public function test_edit_message_returns_401_without_auth(): void
    {
        $response = $this->apiPut('/v2/messages/1', [
            'body' => 'Updated',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_edit_message_rechecks_vetting_gate_before_changing_existing_content(): void
    {
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Original text',
            'created_at' => now(),
        ]);

        $optionId = $this->createSafeguardingOption([
            'requires_vetted_interaction' => true,
            'vetting_type_required' => 'dbs_enhanced',
        ], 'edit_vetted_interaction');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $response = $this->apiPut("/v2/messages/{$messageId}", ['body' => 'Changed text']);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseHas('messages', [
            'id' => $messageId,
            'body' => 'Original text',
        ]);
    }

    // ================================================================
    // DELETE MESSAGE — Authentication required
    // ================================================================

    public function test_delete_message_returns_401_without_auth(): void
    {
        $response = $this->apiDelete('/v2/messages/1');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // REACTIONS — Validation
    // ================================================================

    public function test_toggle_reaction_returns_400_without_emoji(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/messages/1/reactions', []);

        $response->assertStatus(400);
    }

    public function test_toggle_reaction_returns_400_for_invalid_emoji(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/messages/1/reactions', [
            'emoji' => 'invalid',
        ]);

        $response->assertStatus(400);
    }

    public function test_toggle_reaction_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/messages/1/reactions', [
            'emoji' => "\xF0\x9F\x91\x8D", // thumbs up
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_toggle_reaction_blocks_a_new_contact_signal_when_vetting_is_missing(): void
    {
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Before safeguarding preference',
            'created_at' => now(),
        ]);

        $optionId = $this->createSafeguardingOption([
            'requires_vetted_interaction' => true,
            'vetting_type_required' => 'dbs_enhanced',
        ], 'reaction_vetted_interaction');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $response = $this->apiPost("/v2/messages/{$messageId}/reactions", ['emoji' => '👍']);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('message_reactions', [
            'tenant_id' => $this->testTenantId,
            'message_id' => $messageId,
            'user_id' => $sender->id,
            'emoji' => '👍',
        ]);
    }

    public function test_toggle_reaction_allows_withdrawing_an_existing_reaction_after_gate_closes(): void
    {
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Before safeguarding preference',
            'created_at' => now(),
        ]);
        DB::table('message_reactions')->insert([
            'tenant_id' => $this->testTenantId,
            'message_id' => $messageId,
            'user_id' => $sender->id,
            'emoji' => '👍',
            'created_at' => now(),
        ]);

        $optionId = $this->createSafeguardingOption([
            'requires_vetted_interaction' => true,
            'vetting_type_required' => 'dbs_enhanced',
        ], 'reaction_withdrawal');
        $this->selectSafeguardingOptionForUser($recipient, $optionId);

        $response = $this->apiPost("/v2/messages/{$messageId}/reactions", ['emoji' => '👍']);

        $response->assertStatus(200);
        $response->assertJsonPath('data.action', 'removed');
        $this->assertDatabaseMissing('message_reactions', [
            'message_id' => $messageId,
            'user_id' => $sender->id,
            'emoji' => '👍',
        ]);
    }

    // ================================================================
    // TYPING — Validation
    // ================================================================

    public function test_typing_returns_400_without_recipient(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/messages/typing', []);

        $response->assertStatus(400);
    }

    public function test_typing_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/messages/typing', [
            'recipient_id' => 1,
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // RESTRICTION STATUS — Happy path
    // ================================================================

    public function test_restriction_status_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/messages/restriction-status');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // RESTRICTION STATUS — Authentication required
    // ================================================================

    public function test_restriction_status_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/messages/restriction-status');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // RESTORE CONVERSATION — Not found
    // ================================================================

    public function test_restore_conversation_returns_404_for_nonexistent(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/messages/conversations/999999/restore');

        $response->assertStatus(404);
    }

    // ================================================================
    // TRANSLATE — Authentication required
    // ================================================================

    public function test_translate_returns_401_without_auth(): void
    {
        $this->disableMaintenanceMode();

        $response = $this->apiPost('/v2/messages/1/translate', [
            'target_language' => 'en',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // TRANSLATE — Validation errors
    // ================================================================

    public function test_translate_returns_400_without_target_language(): void
    {
        $this->disableMaintenanceMode();
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/messages/1/translate', []);

        $response->assertStatus(400);
    }

    public function test_translate_returns_404_for_nonexistent_message(): void
    {
        $this->disableMaintenanceMode();
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/messages/999999/translate', [
            'target_language' => 'fr',
        ]);

        $response->assertStatus(404);
    }

    // ================================================================
    // TRANSLATE — Authorization (only sender/receiver can translate)
    // ================================================================

    public function test_translate_returns_404_for_other_users_message(): void
    {
        $this->disableMaintenanceMode();
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $outsider = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        // Create a message between sender and recipient
        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Hello, this is a test message.',
            'created_at' => now(),
        ]);

        // Authenticate as the outsider (not sender or receiver)
        Sanctum::actingAs($outsider, ['*']);

        $response = $this->apiPost("/v2/messages/{$messageId}/translate", [
            'target_language' => 'fr',
        ]);

        // Should return 404 (message not found for this user)
        $response->assertStatus(404);
    }

    // ================================================================
    // TRANSLATE — helper: ensure maintenance mode is off
    // ================================================================

    private function disableMaintenanceMode(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.maintenance_mode'],
            ['setting_value' => 'false', 'updated_at' => now()]
        );
    }

    // ================================================================
    // TRANSLATE — Text message body (INT1 feature)
    // ================================================================

    public function test_translate_text_message_returns_translated_text(): void
    {
        $this->disableMaintenanceMode();
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Bonjour, comment allez-vous?',
            'created_at' => now(),
        ]);

        // Mock the OpenAI API response
        config(['services.openai.api_key' => 'test-key']);
        Http::fake([
            'api.openai.com/*' => Http::response([
                'choices' => [['message' => ['content' => 'Hello, how are you?']]],
            ]),
        ]);

        $response = $this->apiPost("/v2/messages/{$messageId}/translate", [
            'target_language' => 'en',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.translated_text', 'Hello, how are you?');
        $response->assertJsonPath('data.source_type', 'body');
    }

    // ================================================================
    // TRANSLATE — Voice transcript (existing INT2 feature, now generalized)
    // ================================================================

    public function test_translate_voice_transcript_returns_translated_text(): void
    {
        $this->disableMaintenanceMode();

        // Ensure transcript columns exist (migration may not have run on test DB)
        if (!DB::getSchemaBuilder()->hasColumn('messages', 'transcript')) {
            DB::statement('ALTER TABLE messages ADD COLUMN transcript TEXT NULL AFTER body');
            DB::statement('ALTER TABLE messages ADD COLUMN transcript_language VARCHAR(10) NULL AFTER transcript');
        }

        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => '',
            'audio_url' => '/uploads/audio/test.webm',
            'transcript' => 'Hola, como estas?',
            'transcript_language' => 'es',
            'created_at' => now(),
        ]);

        config(['services.openai.api_key' => 'test-key']);
        Http::fake([
            'api.openai.com/*' => Http::response([
                'choices' => [['message' => ['content' => 'Hello, how are you?']]],
            ]),
        ]);

        $response = $this->apiPost("/v2/messages/{$messageId}/translate", [
            'target_language' => 'en',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.translated_text', 'Hello, how are you?');
        $response->assertJsonPath('data.source_type', 'transcript');

        // Verify the correct source text was sent to OpenAI
        Http::assertSent(function ($request) {
            $body = $request->data();
            $systemPrompt = $body['messages'][0]['content'] ?? '';
            $userContent = $body['messages'][1]['content'] ?? '';
            // Should translate transcript (not body), with known source language 'es'
            return str_contains($systemPrompt, 'from es to en')
                && $userContent === 'Hola, como estas?';
        });
    }

    // ================================================================
    // TRANSLATE — Transcript takes priority over body
    // ================================================================

    public function test_translate_prefers_transcript_over_body(): void
    {
        $this->disableMaintenanceMode();

        if (!DB::getSchemaBuilder()->hasColumn('messages', 'transcript')) {
            DB::statement('ALTER TABLE messages ADD COLUMN transcript TEXT NULL AFTER body');
            DB::statement('ALTER TABLE messages ADD COLUMN transcript_language VARCHAR(10) NULL AFTER transcript');
        }

        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'This is the body text',
            'transcript' => 'This is the transcript text',
            'transcript_language' => 'en',
            'created_at' => now(),
        ]);

        config(['services.openai.api_key' => 'test-key']);
        Http::fake([
            'api.openai.com/*' => Http::response([
                'choices' => [['message' => ['content' => 'Translated transcript']]],
            ]),
        ]);

        $response = $this->apiPost("/v2/messages/{$messageId}/translate", [
            'target_language' => 'fr',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.source_type', 'transcript');

        // Verify transcript was sent, not body
        Http::assertSent(function ($request) {
            $userContent = $request->data()['messages'][1]['content'] ?? '';
            return $userContent === 'This is the transcript text';
        });
    }

    // ================================================================
    // TRANSLATE — Auto language detection for text messages
    // ================================================================

    public function test_translate_text_uses_auto_language_detection(): void
    {
        $this->disableMaintenanceMode();
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Guten Morgen!',
            'created_at' => now(),
        ]);

        config(['services.openai.api_key' => 'test-key']);
        Http::fake([
            'api.openai.com/*' => Http::response([
                'choices' => [['message' => ['content' => 'Good morning!']]],
            ]),
        ]);

        $response = $this->apiPost("/v2/messages/{$messageId}/translate", [
            'target_language' => 'en',
        ]);

        $response->assertStatus(200);

        // Text messages use 'auto' detection — prompt should say "Detect the language"
        Http::assertSent(function ($request) {
            $systemPrompt = $request->data()['messages'][0]['content'] ?? '';
            return str_contains($systemPrompt, 'Detect the language');
        });
    }

    // ================================================================
    // TRANSLATE — Empty message returns 422
    // ================================================================

    public function test_translate_returns_422_for_empty_message(): void
    {
        $this->disableMaintenanceMode();
        $sender = $this->authenticatedUser();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => '',
            'created_at' => now(),
        ]);

        $response = $this->apiPost("/v2/messages/{$messageId}/translate", [
            'target_language' => 'en',
        ]);

        $response->assertStatus(422);
    }

    // ================================================================
    // TRANSLATE — Receiver can also translate
    // ================================================================

    public function test_translate_works_for_receiver(): void
    {
        $this->disableMaintenanceMode();
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = $this->authenticatedUser();

        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Guten Morgen!',
            'created_at' => now(),
        ]);

        config(['services.openai.api_key' => 'test-key']);
        Http::fake([
            'api.openai.com/*' => Http::response([
                'choices' => [['message' => ['content' => 'Good morning!']]],
            ]),
        ]);

        $response = $this->apiPost("/v2/messages/{$messageId}/translate", [
            'target_language' => 'en',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.translated_text', 'Good morning!');
    }
}
