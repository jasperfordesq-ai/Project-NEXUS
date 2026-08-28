<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Core\TenantContext;
use App\Events\SafeguardingFlaggedEvent;
use App\Models\User;
use App\Services\SafeguardingJurisdictionService;
use App\Services\SafeguardingPreferenceService;
use App\Services\SafeguardingTriggerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class MemberVettingAttestationWorkflowTest extends TestCase
{
    use DatabaseTransactions;

    public function test_configuring_contact_policy_does_not_replay_existing_onboarding_alerts(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        // Recreate the production state: the England/Wales preset options
        // already existed, but the tenant contact policy had not yet been
        // explicitly configured.
        SafeguardingPreferenceService::replaceCountryPreset(
            $this->testTenantId,
            'england_wales',
        );
        $this->protectRecipientWithPreset($recipient);
        $this->assertDatabaseMissing('tenant_safeguarding_settings', [
            'tenant_id' => $this->testTenantId,
        ]);

        Event::fake([SafeguardingFlaggedEvent::class]);
        Sanctum::actingAs($admin);

        $this->apiPut('/v2/admin/vetting/policy', [
            'jurisdiction' => 'england_wales',
        ])->assertStatus(200)
            ->assertJsonPath('data.policy.attestation_code', 'dbs_enhanced');

        Event::assertNotDispatched(SafeguardingFlaggedEvent::class);
        $this->assertTrue(
            SafeguardingTriggerService::requiresVettedInteraction($recipient->id, $this->testTenantId),
            'Policy setup must still recompute and preserve the member protection.',
        );
    }

    public function test_member_preference_revoke_immediately_clears_the_direct_message_gate(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $this->configureEnglandAndWales($admin);
        [$optionId] = $this->protectRecipientWithPreset($recipient);

        Sanctum::actingAs($sender);
        $this->apiGet("/v2/messages/{$recipient->id}")
            ->assertStatus(200)
            ->assertJsonPath('meta.conversation.safeguarding.code', 'VETTING_REQUIRED');

        Sanctum::actingAs($recipient);
        $this->apiPost('/v2/safeguarding/revoke', ['option_id' => $optionId])
            ->assertStatus(200)
            ->assertJsonPath('data.revoked', true);

        Sanctum::actingAs($sender);
        $this->apiGet("/v2/messages/{$recipient->id}")
            ->assertStatus(200)
            ->assertJsonPath('meta.conversation.safeguarding', null);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'The preference change is effective immediately',
        ])->assertStatus(201);
    }

    public function test_united_kingdom_policy_records_multiple_schemes_encrypted_scope_and_expiry(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        Sanctum::actingAs($admin);
        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'united_kingdom'])
            ->assertStatus(200)
            ->assertJsonPath('data.policy.attestation_code', 'uk_safeguarding_clearance')
            ->assertJsonCount(3, 'data.policy.certification_options');

        $optionId = (int) DB::table('tenant_safeguarding_options')
            ->where('tenant_id', $this->testTenantId)
            ->where('option_key', 'requires_vetted_partners')
            ->where('preset_source', 'united_kingdom')
            ->value('id');
        $this->assertGreaterThan(0, $optionId);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $recipient->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($recipient->id, $this->testTenantId);

        Sanctum::actingAs($broker);
        $confirmed = $this->apiPost("/v2/admin/vetting/user/{$sender->id}/confirm", [
            'acknowledgement' => true,
            'certification_codes' => ['dbs_enhanced', 'pvg_scotland'],
            'scope_summary' => 'Adult workforce befriending and supervised activities with children',
            'private_notes' => 'Scope checked with the safeguarding lead.',
            'review_due_at' => now()->addDays(30)->toDateString(),
            'authority_expires_at' => now()->addYear()->toDateString(),
        ])->assertStatus(201)
            ->assertJsonPath('data.certification_codes.0', 'dbs_enhanced')
            ->assertJsonPath('data.certification_codes.1', 'pvg_scotland')
            ->assertJsonPath('data.scope_summary', 'Adult workforce befriending and supervised activities with children')
            ->assertJsonPath('data.private_notes', 'Scope checked with the safeguarding lead.');

        $attestationId = (int) $confirmed->json('data.id');
        $stored = DB::table('member_vetting_attestations')->where('id', $attestationId)->first();
        $this->assertNotSame('Adult workforce befriending and supervised activities with children', $stored->scope_summary_encrypted);
        $this->assertNotSame('Scope checked with the safeguarding lead.', $stored->private_notes_encrypted);

        Sanctum::actingAs($sender);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Current UK certification permits this contact',
        ])->assertStatus(201);

        DB::table('member_vetting_attestations')->where('id', $attestationId)->update([
            'review_due_at' => now()->subDay()->toDateString(),
        ]);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Expired UK certification must fail closed',
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');

        Sanctum::actingAs($broker);
        $this->apiGet('/v2/admin/vetting?status=expired&search=' . urlencode((string) $sender->email))
            ->assertStatus(200)
            ->assertJsonPath('data.0.user_id', $sender->id)
            ->assertJsonPath('data.0.is_expired', true);
    }

    public function test_broker_confirmation_without_evidence_clears_direct_message_gate_and_revocation_closes_it(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $this->configureEnglandAndWales($admin);
        $this->protectRecipient($recipient);

        Sanctum::actingAs($sender);
        $blocked = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Before confirmation',
        ]);
        $blocked->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');

        Sanctum::actingAs($broker);
        $confirmed = $this->apiPost("/v2/admin/vetting/user/{$sender->id}/confirm", [
            'acknowledgement' => true,
        ]);
        $confirmed->assertStatus(201)
            ->assertJsonPath('data.decision', 'confirmed')
            ->assertJsonPath('data.attestation_code', 'dbs_enhanced')
            ->assertJsonMissingPath('data.document_url')
            ->assertJsonMissingPath('data.reference_number');

        Sanctum::actingAs($sender);
        $allowed = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'After confirmation',
        ]);
        $allowed->assertStatus(201);

        Sanctum::actingAs($broker);
        $revoked = $this->apiPost("/v2/admin/vetting/user/{$sender->id}/revoke", [
            'reason_code' => 'community_decision_withdrawn',
        ]);
        $revoked->assertStatus(200)->assertJsonPath('data.decision', 'revoked');

        Sanctum::actingAs($sender);
        $blockedAgain = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'After revocation',
        ]);
        $blockedAgain->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');

        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'After revocation',
        ]);
    }

    public function test_definitive_message_check_ignores_a_repopulated_stale_policy_cache(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);
        $this->protectRecipient($recipient);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/user/{$sender->id}/confirm", [
            'acknowledgement' => true,
        ])->assertStatus(201);

        $jurisdictions = app(SafeguardingJurisdictionService::class);
        $stalePolicy = $jurisdictions->getPolicy($this->testTenantId);
        $newPolicyVersion = 'safeguarded-contact-v1:locked-message-regression';
        DB::table('tenant_safeguarding_settings')
            ->where('tenant_id', $this->testTenantId)
            ->update([
                'policy_version' => $newPolicyVersion,
                'updated_at' => now(),
            ]);

        // Emulate an already-running Cache::remember callback publishing the
        // pre-change policy after the writer's cache invalidation.
        Cache::put('safeguarding_jurisdiction:' . $this->testTenantId, $stalePolicy, 300);

        Sanctum::actingAs($sender);
        $response = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'A stale policy cache must not authorize this write',
        ]);
        Cache::forget('safeguarding_jurisdiction:' . $this->testTenantId);

        $response->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'A stale policy cache must not authorize this write',
        ]);
    }

    public function test_broker_confirm_and_revoke_ignore_a_repopulated_stale_policy_cache(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);

        $jurisdictions = app(SafeguardingJurisdictionService::class);
        $stalePolicy = $jurisdictions->getPolicy($this->testTenantId);
        $newPolicyVersion = 'safeguarded-contact-v1:locked-broker-regression';
        DB::table('tenant_safeguarding_settings')
            ->where('tenant_id', $this->testTenantId)
            ->update([
                'policy_version' => $newPolicyVersion,
                'updated_at' => now(),
            ]);
        Cache::put('safeguarding_jurisdiction:' . $this->testTenantId, $stalePolicy, 300);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/user/{$member->id}/confirm", [
            'acknowledgement' => true,
        ])->assertStatus(201)
            ->assertJsonPath('data.policy_version', $newPolicyVersion);

        Cache::put('safeguarding_jurisdiction:' . $this->testTenantId, $stalePolicy, 300);
        $this->apiPost("/v2/admin/vetting/user/{$member->id}/revoke", [
            'reason_code' => 'policy_changed',
        ])->assertStatus(200)
            ->assertJsonPath('data.decision', 'revoked')
            ->assertJsonPath('data.policy_version', $newPolicyVersion);
        Cache::forget('safeguarding_jurisdiction:' . $this->testTenantId);

        $this->assertDatabaseHas('member_vetting_attestation_events', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'event_type' => 'revoked',
            'policy_version' => $newPolicyVersion,
        ]);
    }

    public function test_reactivated_preference_cannot_slip_past_a_definitive_message_write_with_stale_triggers(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);

        $optionId = (int) DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'reactivation_lock_regression_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Reactivation lock regression',
            'sort_order' => 999,
            'is_active' => 1,
            'is_required' => 0,
            'triggers' => json_encode([
                'requires_vetted_interaction' => true,
                'vetting_type_required' => 'dbs_enhanced',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $recipient->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now()->subDay(),
            'consent_ip' => '127.0.0.1',
            'revoked_at' => now()->subHour(),
            'created_at' => now()->subDay(),
            'updated_at' => now()->subHour(),
        ]);

        $staleTriggers = SafeguardingTriggerService::getActiveTriggers($recipient->id, $this->testTenantId);
        $this->assertFalse((bool) ($staleTriggers['requires_vetted_interaction'] ?? false));

        TenantContext::setById($this->testTenantId);
        SafeguardingPreferenceService::saveUserPreferences($recipient->id, [[
            'option_id' => $optionId,
            'value' => '1',
        ]], '127.0.0.1');

        // Emulate a stale cache callback completing after reactivation. The
        // preflight may see this value, but the locked write check must not.
        $triggerCacheKey = "safeguarding_triggers:{$this->testTenantId}:{$recipient->id}";
        Cache::put($triggerCacheKey, $staleTriggers, 300);

        Sanctum::actingAs($sender);
        $response = $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Reactivation must be authoritative at persistence time',
        ]);
        Cache::forget($triggerCacheKey);

        $response->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $recipient->id)
            ->where('option_id', $optionId)
            ->value('revoked_at'));
        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Reactivation must be authoritative at persistence time',
        ]);
    }

    public function test_false_checkbox_preference_is_preserved_without_activating_contact_gate_or_readers(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $optionId = (int) DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'false_checkbox_regression_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'False checkbox regression',
            'description' => 'False checkbox regression',
            'sort_order' => 999,
            'is_active' => 1,
            'is_required' => 0,
            'triggers' => json_encode([
                'requires_vetted_interaction' => true,
                'vetting_type_required' => 'dbs_enhanced',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        TenantContext::setById($this->testTenantId);
        SafeguardingPreferenceService::saveUserPreferences($recipient->id, [[
            'option_id' => $optionId,
            'value' => false,
        ]], '127.0.0.1');

        $storedPreference = DB::table('user_safeguarding_preferences')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $recipient->id)
            ->where('option_id', $optionId)
            ->first();
        $this->assertNotNull($storedPreference);
        $this->assertSame('0', $storedPreference->selected_value);
        $this->assertNull($storedPreference->revoked_at);

        $triggers = SafeguardingTriggerService::getActiveTriggers($recipient->id, $this->testTenantId);
        $this->assertFalse((bool) ($triggers['requires_vetted_interaction'] ?? false));
        $this->assertSame([], SafeguardingTriggerService::getRequiredVettingTypes(
            $recipient->id,
            $this->testTenantId,
        ));
        $this->assertSame(
            [$recipient->id => []],
            SafeguardingTriggerService::getRequiredVettingTypesForUsers(
                [$recipient->id],
                $this->testTenantId,
            ),
        );

        $this->assertSame([], SafeguardingPreferenceService::getUserPreferences(
            $this->testTenantId,
            $recipient->id,
            $recipient->id,
            'member',
            'false_checkbox_regression',
        ));

        Sanctum::actingAs($recipient);
        $this->apiGet('/v2/safeguarding/my-preferences')
            ->assertOk()
            ->assertJsonPath('data.count', 0)
            ->assertJsonCount(0, 'data.preferences');

        Sanctum::actingAs($sender);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'A false safeguarding checkbox must not block contact',
        ])->assertStatus(201);
    }

    public function test_legacy_verified_dbs_row_does_not_clear_the_new_contact_gate_without_controlled_import_or_reconfirmation(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);
        $this->protectRecipient($recipient);

        DB::table('vetting_records')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $sender->id,
            'vetting_type' => 'dbs_enhanced',
            'status' => 'verified',
            'verified_by' => $admin->id,
            'verified_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($sender);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Legacy state is not current policy authority',
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');

        $this->assertDatabaseMissing('member_vetting_attestations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $sender->id,
        ]);
        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Legacy state is not current policy authority',
        ]);
    }

    public function test_confirm_revoke_reconfirm_preserves_append_only_decision_history(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/user/{$member->id}/confirm", ['acknowledgement' => true])->assertStatus(201);
        $this->apiPost("/v2/admin/vetting/user/{$member->id}/revoke", ['reason_code' => 'policy_changed'])->assertStatus(200);
        $this->apiPost("/v2/admin/vetting/user/{$member->id}/confirm", ['acknowledgement' => true])->assertStatus(201);

        $events = DB::table('member_vetting_attestation_events')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->orderBy('id')
            ->get();

        $this->assertSame(['confirmed', 'revoked', 'reconfirmed'], $events->pluck('event_type')->all());
        $this->assertSame('confirmed', $events[0]->decision_after);
        $this->assertSame('revoked', $events[1]->decision_after);
        $this->assertSame('confirmed', $events[2]->decision_after);
        $this->assertNull($events[0]->reason_code);
        $this->assertSame('policy_changed', $events[1]->reason_code);
    }

    public function test_member_review_request_is_empty_body_and_idempotent(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);

        Sanctum::actingAs($member);
        $first = $this->apiPost('/v2/safeguarding/vetting-review-request', []);
        $second = $this->apiPost('/v2/safeguarding/vetting-review-request', []);

        $first->assertStatus(201)->assertJsonPath('data.status', 'pending');
        $second->assertStatus(201)->assertJsonPath('data.id', $first->json('data.id'));
        $this->assertDatabaseCount('safeguarding_vetting_review_requests', 1);

        $rejected = $this->apiPost('/v2/safeguarding/vetting-review-request', [
            'reference_number' => 'must-not-be-stored',
        ]);
        $rejected->assertStatus(422)->assertJsonPath('errors.0.code', 'VETTING_EVIDENCE_PROHIBITED');
    }

    public function test_confirmation_rejects_every_evidence_shaped_field(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);

        Sanctum::actingAs($broker);
        foreach (['document_url', 'reference_number', 'issue_date', 'expiry_date', 'notes', 'result'] as $field) {
            $response = $this->apiPost("/v2/admin/vetting/user/{$member->id}/confirm", [
                'acknowledgement' => true,
                $field => 'prohibited',
            ]);
            $response->assertStatus(422)->assertJsonPath('errors.0.code', 'VETTING_EVIDENCE_PROHIBITED');
        }

        $this->assertDatabaseMissing('member_vetting_attestations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
        ]);
    }

    public function test_unconfigured_jurisdiction_fails_closed_and_cannot_confirm(): void
    {
        DB::table('tenant_safeguarding_settings')->where('tenant_id', $this->testTenantId)->delete();
        app(\App\Services\SafeguardingJurisdictionService::class)->forget($this->testTenantId);

        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        Sanctum::actingAs($broker);

        $response = $this->apiPost("/v2/admin/vetting/user/{$member->id}/confirm", [
            'acknowledgement' => true,
        ]);

        $response->assertStatus(409)->assertJsonPath('errors.0.code', 'SAFEGUARDING_JURISDICTION_REQUIRED');
    }

    public function test_jurisdiction_can_be_explicitly_reset_to_unconfigured(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->configureEnglandAndWales($admin);

        Sanctum::actingAs($admin);
        $response = $this->apiPut('/v2/admin/vetting/policy', [
            'jurisdiction' => 'unconfigured',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('data.policy.configured', false)
            ->assertJsonPath('data.policy.jurisdiction', 'unconfigured');
        $this->assertDatabaseMissing('tenant_safeguarding_settings', [
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function test_policy_transition_to_custom_deactivates_false_preset_checkbox_without_review(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);
        [$optionId, $preferenceId] = $this->protectRecipientWithPreset($recipient);
        DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->update(['selected_value' => '0']);

        Sanctum::actingAs($admin);
        $transition = $this->apiPut('/v2/admin/vetting/policy', [
            'jurisdiction' => 'custom',
        ]);
        $transition->assertStatus(200)
            ->assertJsonPath('data.policy.jurisdiction', 'custom')
            ->assertJsonPath('data.preference_transition.review_required_count', 0);

        $this->assertContains(
            'requires_vetted_partners',
            $transition->json('data.preference_transition.deactivated'),
        );
        $this->assertNotContains(
            'requires_vetted_partners',
            $transition->json('data.preference_transition.preserved'),
        );
        $this->assertSame(0, (int) DB::table('tenant_safeguarding_options')
            ->where('id', $optionId)
            ->value('is_active'));
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('revoked_at'));
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('policy_review_required_at'));
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('policy_review_reason_code'));
    }

    public function test_preset_replacement_does_not_request_review_for_false_checkbox_response(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);
        [, $preferenceId] = $this->protectRecipientWithPreset($recipient);
        DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->update(['selected_value' => '0']);

        $result = SafeguardingPreferenceService::replaceCountryPreset(
            $this->testTenantId,
            'scotland',
            true,
        );

        $this->assertSame(0, $result['review_required_count']);
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('policy_review_required_at'));
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('policy_review_reason_code'));
    }

    public function test_policy_transition_to_custom_preserves_selected_preset_protection_and_fails_closed(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);
        [$optionId, $preferenceId] = $this->protectRecipientWithPreset($recipient);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/user/{$sender->id}/confirm", [
            'acknowledgement' => true,
        ])->assertStatus(201);

        Sanctum::actingAs($sender);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Allowed before the policy becomes unavailable',
        ])->assertStatus(201);

        Sanctum::actingAs($admin);
        $transition = $this->apiPut('/v2/admin/vetting/policy', [
            'jurisdiction' => 'custom',
        ]);
        $transition->assertStatus(200)
            ->assertJsonPath('data.policy.jurisdiction', 'custom')
            ->assertJsonPath('data.policy.contact_policy_available', false)
            ->assertJsonPath('data.preference_transition.preserved.0', 'requires_vetted_partners')
            ->assertJsonPath('data.preference_transition.review_required_count', 1);

        $this->assertSame(1, (int) DB::table('tenant_safeguarding_options')
            ->where('id', $optionId)
            ->value('is_active'));
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('revoked_at'));
        $this->assertNotNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('policy_review_required_at'));
        $this->assertSame('jurisdiction_changed', DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('policy_review_reason_code'));
        $this->assertDatabaseHas('activity_log', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'action' => 'safeguarding_preset_transition_fail_closed',
            'entity_type' => 'tenant',
            'entity_id' => $this->testTenantId,
        ]);

        SafeguardingTriggerService::invalidateCache($recipient->id, $this->testTenantId);
        Sanctum::actingAs($sender);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Custom policy must not silently open the gate',
        ])->assertStatus(503)->assertJsonPath('errors.0.code', 'SAFEGUARDING_POLICY_UNAVAILABLE');
        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Custom policy must not silently open the gate',
        ]);
    }

    public function test_policy_reset_to_unconfigured_preserves_selected_preset_protection_and_fails_closed(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);
        [$optionId, $preferenceId] = $this->protectRecipientWithPreset($recipient);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/user/{$sender->id}/confirm", [
            'acknowledgement' => true,
        ])->assertStatus(201);

        Sanctum::actingAs($admin);
        $transition = $this->apiPut('/v2/admin/vetting/policy', [
            'jurisdiction' => 'unconfigured',
        ]);
        $transition->assertStatus(200)
            ->assertJsonPath('data.policy.configured', false)
            ->assertJsonPath('data.policy.jurisdiction', 'unconfigured')
            ->assertJsonPath('data.preference_transition.preserved.0', 'requires_vetted_partners')
            ->assertJsonPath('data.preference_transition.review_required_count', 1);

        $this->assertDatabaseMissing('tenant_safeguarding_settings', [
            'tenant_id' => $this->testTenantId,
        ]);
        $this->assertSame(1, (int) DB::table('tenant_safeguarding_options')
            ->where('id', $optionId)
            ->value('is_active'));
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('revoked_at'));
        $this->assertNotNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('policy_review_required_at'));

        SafeguardingTriggerService::invalidateCache($recipient->id, $this->testTenantId);
        Sanctum::actingAs($sender);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Unconfigured policy must not silently open the gate',
        ])->assertStatus(503)->assertJsonPath('errors.0.code', 'SAFEGUARDING_POLICY_UNAVAILABLE');
        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Unconfigured policy must not silently open the gate',
        ]);
    }

    public function test_preset_replacement_preserves_a_live_stale_protective_option_and_fails_closed(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);

        $optionKey = 'legacy_england_only_protection_' . uniqid();
        $optionId = (int) DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => $optionKey,
            'option_type' => 'checkbox',
            'label' => 'Legacy protected contact option',
            'sort_order' => 998,
            'is_active' => 1,
            'is_required' => 0,
            'triggers' => json_encode([
                'requires_vetted_interaction' => true,
                'vetting_type_required' => 'dbs_enhanced',
            ]),
            'preset_source' => 'england_wales',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $preferenceId = (int) DB::table('user_safeguarding_preferences')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $recipient->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);
        // Ireland became an AVAILABLE jurisdiction on 2026-08-28 (Garda
        // Vetting gating enabled). What this test protects is unchanged: the
        // live dbs_enhanced option is now a requirement/policy MISMATCH under
        // the Irish policy, so the member's protection must be preserved and
        // contact must still fail closed — not silently become contactable.
        $this->apiPut('/v2/admin/vetting/policy', [
            'jurisdiction' => 'ireland',
        ])->assertStatus(200)
            ->assertJsonPath('data.policy.jurisdiction', 'ireland')
            ->assertJsonPath('data.policy.contact_policy_available', true)
            ->assertJsonPath('data.preference_transition.preserved.0', $optionKey);

        $this->assertSame(1, (int) DB::table('tenant_safeguarding_options')
            ->where('id', $optionId)
            ->value('is_active'));
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('revoked_at'));
        $this->assertNotNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('policy_review_required_at'));

        SafeguardingTriggerService::invalidateCache($recipient->id, $this->testTenantId);
        Sanctum::actingAs($sender);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Stale preset protection must fail closed during replacement',
        ])->assertStatus(503)->assertJsonPath('errors.0.code', 'SAFEGUARDING_POLICY_UNAVAILABLE');
        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Stale preset protection must fail closed during replacement',
        ]);
    }

    public function test_coordinator_cannot_make_vetting_decisions_and_cross_tenant_target_is_hidden(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $coordinator = User::factory()->forTenant($this->testTenantId)->create(['role' => 'coordinator', 'status' => 'active']);
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $localMember = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $otherMember = User::factory()->forTenant(999)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);

        Sanctum::actingAs($coordinator);
        $this->apiPost("/v2/admin/vetting/user/{$localMember->id}/confirm", [
            'acknowledgement' => true,
        ])->assertStatus(403);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/user/{$otherMember->id}/confirm", [
            'acknowledgement' => true,
        ])->assertStatus(404);
    }

    public function test_policy_version_change_shows_old_confirmation_as_stale_until_broker_reconfirms(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);
        $this->protectRecipient($recipient);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/user/{$member->id}/confirm", ['acknowledgement' => true])
            ->assertStatus(201);
        $oldPolicyVersion = (string) DB::table('member_vetting_attestations')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->value('policy_version');

        Sanctum::actingAs($admin);
        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'unconfigured'])->assertStatus(200);
        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'england_wales'])->assertStatus(200);
        $newPolicyVersion = (string) DB::table('tenant_safeguarding_settings')
            ->where('tenant_id', $this->testTenantId)
            ->value('policy_version');
        $this->assertNotSame($oldPolicyVersion, $newPolicyVersion);

        Sanctum::actingAs($broker);
        $this->apiGet('/v2/admin/vetting?search=' . urlencode((string) $member->email))
            ->assertStatus(200)
            ->assertJsonPath('data.0.decision', 'not_confirmed');
        $this->apiGet('/v2/admin/vetting/stats')
            ->assertStatus(200)
            ->assertJsonPath('data.confirmed', 0);

        Sanctum::actingAs($member);
        $this->apiGet('/v2/safeguarding/my-vetting-status')
            ->assertStatus(200)
            ->assertJsonPath('data.decision', 'not_confirmed');
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Stale policy must not clear the gate',
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/user/{$member->id}/confirm", ['acknowledgement' => true])
            ->assertStatus(201)
            ->assertJsonPath('data.policy_version', $newPolicyVersion);

        Sanctum::actingAs($member);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Reconfirmation clears the exact current gate',
        ])->assertStatus(201);
    }

    public function test_controlled_policy_rotation_is_audited_and_invalidates_old_confirmation_atomically(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);
        $this->protectRecipient($recipient);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/user/{$member->id}/confirm", ['acknowledgement' => true])
            ->assertStatus(201);
        $previousVersion = (string) DB::table('member_vetting_attestations')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->value('policy_version');

        Sanctum::actingAs($admin);
        $rotation = $this->apiPost('/v2/admin/vetting/policy/rotate', [
            'acknowledgement' => true,
            'reason_code' => 'scheduled_review',
        ]);
        $rotation->assertStatus(200)
            ->assertJsonPath('data.reason_code', 'scheduled_review')
            ->assertJsonPath('data.affected_member_count', 1);
        $newVersion = (string) $rotation->json('data.policy.policy_version');
        $this->assertNotSame($previousVersion, $newVersion);

        $this->assertDatabaseHas('safeguarding_policy_rotation_events', [
            'tenant_id' => $this->testTenantId,
            'previous_policy_version' => $previousVersion,
            'new_policy_version' => $newVersion,
            'reason_code' => 'scheduled_review',
            'actor_user_id' => $admin->id,
            'affected_member_count' => 1,
        ]);
        $this->assertDatabaseHas('safeguarding_vetting_review_requests', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'policy_version' => $newVersion,
            'status' => 'pending',
            'request_source' => 'policy_rotation',
        ]);

        Sanctum::actingAs($member);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'The prior policy confirmation must no longer authorise contact',
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $member->id,
            'receiver_id' => $recipient->id,
            'body' => 'The prior policy confirmation must no longer authorise contact',
        ]);
    }

    public function test_policy_rotation_is_unavailable_outside_the_supported_contact_policy(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'custom'])
            ->assertStatus(200)
            ->assertJsonPath('data.policy.contact_policy_available', false);

        $this->apiPost('/v2/admin/vetting/policy/rotate', [
            'acknowledgement' => true,
            'reason_code' => 'policy_changed',
        ])->assertStatus(409)->assertJsonPath('errors.0.code', 'SAFEGUARDING_POLICY_UNAVAILABLE');

        $this->assertDatabaseMissing('safeguarding_policy_rotation_events', [
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function test_policy_endpoints_reject_unknown_evidence_fields_and_multipart_files(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiPut('/v2/admin/vetting/policy', [
            'jurisdiction' => 'england_wales',
            'notes' => 'must not be accepted',
        ])->assertStatus(422)->assertJsonPath('errors.0.code', 'VETTING_EVIDENCE_PROHIBITED');

        $this->apiPost('/v2/admin/vetting/policy/rotate', [
            'acknowledgement' => true,
            'reason_code' => 'policy_changed',
            'reference_number' => 'must not be accepted',
        ])->assertStatus(422)->assertJsonPath('errors.0.code', 'VETTING_EVIDENCE_PROHIBITED');

        $this->post('/api/v2/admin/vetting/policy/rotate', [
            'acknowledgement' => true,
            'reason_code' => 'policy_changed',
            'file' => UploadedFile::fake()->create('dbs-certificate.pdf', 1, 'application/pdf'),
        ], $this->withTenantHeader())->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VETTING_EVIDENCE_PROHIBITED');

        $this->assertDatabaseMissing('tenant_safeguarding_settings', [
            'tenant_id' => $this->testTenantId,
        ]);
        $this->assertDatabaseMissing('safeguarding_policy_rotation_events', [
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function test_generic_review_resolution_cannot_claim_confirmation_without_changing_gate(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->configureEnglandAndWales($admin);

        Sanctum::actingAs($member);
        $review = $this->apiPost('/v2/safeguarding/vetting-review-request', [])->assertStatus(201);

        Sanctum::actingAs($broker);
        $this->apiPost('/v2/admin/vetting/reviews/' . $review->json('data.id') . '/resolve', [
            'resolution_code' => 'confirmed',
        ])->assertStatus(422)->assertJsonPath('errors.0.code', 'INVALID_VETTING_REVIEW_RESOLUTION');

        $this->assertDatabaseHas('safeguarding_vetting_review_requests', [
            'id' => $review->json('data.id'),
            'status' => 'pending',
        ]);
        $this->assertDatabaseMissing('member_vetting_attestations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
        ]);
    }

    private function configureEnglandAndWales(User $admin): void
    {
        Sanctum::actingAs($admin);
        $this->apiPut('/v2/admin/vetting/policy', [
            'jurisdiction' => 'england_wales',
        ])->assertStatus(200)
            ->assertJsonPath('data.policy.jurisdiction', 'england_wales')
            ->assertJsonPath('data.policy.attestation_code', 'dbs_enhanced');
    }

    private function protectRecipient(User $recipient): void
    {
        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'test_vetted_contact_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Test safeguarded contact',
            'description' => 'Test safeguarded contact',
            'sort_order' => 999,
            'is_active' => 1,
            'is_required' => 0,
            'triggers' => json_encode([
                'requires_vetted_interaction' => true,
                'vetting_type_required' => 'dbs_enhanced',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $recipient->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($recipient->id, $this->testTenantId);
    }

    /** @return array{int, int} */
    private function protectRecipientWithPreset(User $recipient): array
    {
        $optionId = (int) DB::table('tenant_safeguarding_options')
            ->where('tenant_id', $this->testTenantId)
            ->where('option_key', 'requires_vetted_partners')
            ->where('preset_source', 'england_wales')
            ->where('is_active', true)
            ->value('id');
        $this->assertGreaterThan(0, $optionId);

        $preferenceId = (int) DB::table('user_safeguarding_preferences')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $recipient->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($recipient->id, $this->testTenantId);

        return [$optionId, $preferenceId];
    }
}
