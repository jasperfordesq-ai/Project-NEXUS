<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Services\FederationFeatureService;
use App\Services\FederatedConnectionService;
use Tests\Laravel\TestCase;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Config;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for FederationV2Controller — user-facing federation endpoints.
 */
class FederationV2ControllerTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;

    private function seedPartnerTenant(string $name = 'Partner Timebank'): int
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)) . '-' . substr(uniqid(), -6),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->enableFederationForTenant($this->testTenantId);
        $this->enableFederationForTenant($tenantId);
        $this->app->make(FederationFeatureService::class)->clearCache();
        TenantContext::setById($this->testTenantId);

        return $tenantId;
    }

    private function seedPartnership(int $partnerTenantId, array $overrides = []): int
    {
        $data = array_merge([
            'tenant_id' => $this->testTenantId,
            'partner_tenant_id' => $partnerTenantId,
            'status' => 'active',
            'federation_level' => 4,
            'profiles_enabled' => 1,
            'messaging_enabled' => 1,
            'transactions_enabled' => 1,
            'listings_enabled' => 1,
            'events_enabled' => 1,
            'groups_enabled' => 1,
            'requested_at' => now(),
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides);

        if ($this->columnExists('federation_partnerships', 'canonical_pair')) {
            $data['canonical_pair'] = min($this->testTenantId, $partnerTenantId) . '-' . max($this->testTenantId, $partnerTenantId);
        }

        return (int) DB::table('federation_partnerships')->insertGetId($data);
    }

    private function seedFederatedUser(int $tenantId, array $userAttributes = [], array $settings = []): User
    {
        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $userAttributes));

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $user->id],
            array_merge([
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'appear_in_federated_search' => 1,
                'show_skills_federated' => 1,
                'show_location_federated' => 1,
                'show_reviews_federated' => 1,
                'service_reach' => 'remote_ok',
                'travel_radius_km' => 50,
                'email_notifications' => 1,
                'updated_at' => now(),
            ], $settings)
        );

        return $user;
    }

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function enableMessageTranslationForTenant(int $tenantId): void
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        $features = json_decode($tenant->features ?? '{}', true) ?: [];
        $features['federation'] = true;
        $features['message_translation'] = true;

        DB::table('tenants')->where('id', $tenantId)->update([
            'features' => json_encode($features),
            'updated_at' => now(),
        ]);

        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => 'translation.context_aware'],
            ['setting_value' => 'true', 'setting_type' => 'boolean', 'updated_at' => now()]
        );
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => 'translation.context_messages'],
            ['setting_value' => '5', 'setting_type' => 'integer', 'updated_at' => now()]
        );

        TenantContext::setById($tenantId);
    }

    // ------------------------------------------------------------------
    //  GET /v2/federation/status
    // ------------------------------------------------------------------

    public function test_federation_status_requires_auth(): void
    {
        $response = $this->apiGet('/v2/federation/status');

        $response->assertStatus(401);
    }

    public function test_federation_status_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/federation/status');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /v2/federation/opt-in
    // ------------------------------------------------------------------

    public function test_opt_in_requires_auth(): void
    {
        $response = $this->apiPost('/v2/federation/opt-in');

        $response->assertStatus(401);
    }

    public function test_opt_in_defaults_location_sharing_off(): void
    {
        $this->enableFederationForTenant($this->testTenantId);
        $user = $this->authenticatedUser();

        $response = $this->apiPost('/v2/federation/opt-in');

        $response->assertOk();
        $settings = DB::table('federation_user_settings')->where('user_id', $user->id)->first();
        $this->assertNotNull($settings);
        $this->assertSame(0, (int) $settings->show_location_federated);
    }

    public function test_update_settings_normalizes_string_false_values(): void
    {
        $this->enableFederationForTenant($this->testTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        Sanctum::actingAs($viewer, ['*']);

        $response = $this->apiPut('/v2/federation/settings', [
            'profile_visible_federated' => 'false',
            'appear_in_federated_search' => 'false',
            'show_skills_federated' => 'false',
            'show_location_federated' => 'false',
            'show_reviews_federated' => 'false',
            'messaging_enabled_federated' => 'false',
            'transactions_enabled_federated' => 'false',
            'email_notifications' => 'false',
        ]);

        $response->assertOk();
        $settings = DB::table('federation_user_settings')->where('user_id', $viewer->id)->first();
        $this->assertSame(0, (int) $settings->profile_visible_federated);
        $this->assertSame(0, (int) $settings->appear_in_federated_search);
        $this->assertSame(0, (int) $settings->show_skills_federated);
        $this->assertSame(0, (int) $settings->show_location_federated);
        $this->assertSame(0, (int) $settings->show_reviews_federated);
        $this->assertSame(0, (int) $settings->messaging_enabled_federated);
        $this->assertSame(0, (int) $settings->transactions_enabled_federated);
        $this->assertSame(0, (int) $settings->email_notifications);
    }

    // ------------------------------------------------------------------
    //  POST /v2/federation/opt-out
    // ------------------------------------------------------------------

    public function test_opt_out_requires_auth(): void
    {
        $response = $this->apiPost('/v2/federation/opt-out');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/federation/partners
    // ------------------------------------------------------------------

    public function test_partners_requires_auth(): void
    {
        $response = $this->apiGet('/v2/federation/partners');

        $response->assertStatus(401);
    }

    public function test_partners_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/federation/partners');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/federation/activity
    // ------------------------------------------------------------------

    public function test_activity_requires_auth(): void
    {
        $response = $this->apiGet('/v2/federation/activity');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/federation/settings
    // ------------------------------------------------------------------

    public function test_get_settings_requires_auth(): void
    {
        $response = $this->apiGet('/v2/federation/settings');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/federation/connections
    // ------------------------------------------------------------------

    public function test_connections_requires_auth(): void
    {
        $response = $this->apiGet('/v2/federation/connections');

        $response->assertStatus(401);
    }

    public function test_pending_cancellation_cannot_remove_an_accepted_federation_connection(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Federation State Partner');
        $this->seedPartnership($partnerTenantId);
        $requester = $this->seedFederatedUser($this->testTenantId);
        $receiver = $this->seedFederatedUser($partnerTenantId);
        $connectionId = (int) DB::table('federation_connections')->insertGetId([
            'requester_user_id' => $requester->id,
            'requester_tenant_id' => $this->testTenantId,
            'receiver_user_id' => $receiver->id,
            'receiver_tenant_id' => $partnerTenantId,
            'status' => 'accepted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($requester, ['*']);

        $this->apiDelete("/v2/federation/connections/{$connectionId}", [
            'expected_status' => 'pending',
        ])->assertConflict()->assertJsonPath('errors.0.code', 'CONNECTION_STATE_CHANGED');

        $this->assertDatabaseHas('federation_connections', [
            'id' => $connectionId,
            'status' => 'accepted',
        ]);
    }

    public function test_federation_removal_contract_enforces_pending_authority_and_accepted_state(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Federation Removal Partner');
        $this->seedPartnership($partnerTenantId);
        $requester = $this->seedFederatedUser($this->testTenantId);
        $receiver = $this->seedFederatedUser($partnerTenantId);

        $create = function (string $status) use ($requester, $receiver, $partnerTenantId): int {
            return (int) DB::table('federation_connections')->insertGetId([
                'requester_user_id' => $requester->id,
                'requester_tenant_id' => $this->testTenantId,
                'receiver_user_id' => $receiver->id,
                'receiver_tenant_id' => $partnerTenantId,
                'status' => $status,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        };

        Sanctum::actingAs($requester, ['*']);
        $cancelledId = $create('pending');
        $this->apiDelete("/v2/federation/connections/{$cancelledId}", [
            'expected_status' => 'pending',
        ])->assertOk();
        $this->assertDatabaseMissing('federation_connections', ['id' => $cancelledId]);

        $pendingId = $create('pending');
        TenantContext::setById($partnerTenantId);
        $receiverCancellation = app(FederatedConnectionService::class)->removeConnection(
            $pendingId,
            (int) $receiver->id,
            'pending',
        );
        $this->assertFalse($receiverCancellation['success']);
        $this->assertSame('CONNECTION_STATE_CHANGED', $receiverCancellation['error_code']);
        $this->assertDatabaseHas('federation_connections', ['id' => $pendingId, 'status' => 'pending']);

        TenantContext::setById($this->testTenantId);
        Sanctum::actingAs($requester, ['*']);
        $this->apiDelete("/v2/federation/connections/{$pendingId}", [
            'expected_status' => 'accepted',
        ])->assertConflict()->assertJsonPath('errors.0.code', 'CONNECTION_STATE_CHANGED');

        $this->apiDelete("/v2/federation/connections/{$pendingId}", [
            'expected_status' => 'anything',
        ])->assertUnprocessable()->assertJsonPath('errors.0.field', 'expected_status');
        $this->assertDatabaseHas('federation_connections', ['id' => $pendingId, 'status' => 'pending']);
    }

    // ------------------------------------------------------------------
    //  GET /v2/federation/members
    // ------------------------------------------------------------------

    public function test_federation_members_requires_auth(): void
    {
        $response = $this->apiGet('/v2/federation/members');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/federation/members/{id} — safeguarding advisory
    //
    //  sendMessage() and sendTransaction() refuse a restricted recipient with
    //  403 SAFEGUARDING_CONTACT_RESTRICTED, but the profile payload carried no
    //  safeguarding information, so the UI offered Message and Send Credits and
    //  the member only found out after composing a transfer. The payload must
    //  report the decision. It stays advisory — the write paths re-evaluate.
    // ------------------------------------------------------------------

    /**
     * Create a safeguarding option owned by the given tenant. Options and
     * preferences are both tenant-scoped, and the RECIPIENT's tenant is
     * authoritative for a cross-tenant decision — so this must not be seeded
     * against $this->testTenantId, which is the sender's.
     */
    private function seedSafeguardingOptionForTenant(int $tenantId, array $triggers): int
    {
        return (int) DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $tenantId,
            'option_key' => 'coordinator_contact_' . uniqid(),
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

    private function selectSafeguardingOption(int $tenantId, int $userId, int $optionId): void
    {
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        \App\Services\SafeguardingTriggerService::invalidateCache($userId, $tenantId);
    }

    public function test_member_profile_reports_safeguarding_contact_restriction(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Safeguarding Partner');
        $this->seedPartnership($partnerTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $member = $this->seedFederatedUser($partnerTenantId);

        $optionId = $this->seedSafeguardingOptionForTenant($partnerTenantId, [
            'restricts_messaging' => true,
        ]);
        $this->selectSafeguardingOption($partnerTenantId, (int) $member->id, $optionId);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/members/' . $member->id . '?tenant_id=' . $partnerTenantId);

        $response->assertOk();
        $response->assertJsonPath('data.safeguarding.contact_allowed', false);
        $response->assertJsonPath('data.safeguarding.code', 'SAFEGUARDING_CONTACT_RESTRICTED');
        $response->assertJsonPath('data.safeguarding.status', 'deny');
        $response->assertJsonPath('data.safeguarding.can_request_coordinator', true);
        $response->assertJsonPath('data.safeguarding.retryable', false);

        // The advisory carries a member-readable sentence, not a raw lang key —
        // the UI shows this text verbatim in the tooltip and mobile helper line.
        $detail = $response->json('data.safeguarding.detail');
        $this->assertIsString($detail);
        $this->assertNotSame('', $detail);
        $this->assertStringNotContainsString('safeguarding.errors.', $detail);

        // The settings-derived flags are unchanged: this member HAS federated
        // messaging and transactions enabled. Only the policy refuses, which is
        // exactly the case the old payload could not express.
        $response->assertJsonPath('data.messaging_enabled', true);
        $response->assertJsonPath('data.transactions_enabled', true);
    }

    public function test_member_profile_safeguarding_advisory_matches_the_transaction_refusal(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Safeguarding Parity Partner');
        $this->seedPartnership($partnerTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $member = $this->seedFederatedUser($partnerTenantId);

        $optionId = $this->seedSafeguardingOptionForTenant($partnerTenantId, [
            'restricts_messaging' => true,
        ]);
        $this->selectSafeguardingOption($partnerTenantId, (int) $member->id, $optionId);

        Sanctum::actingAs($viewer, ['*']);

        $profile = $this->apiGet('/v2/federation/members/' . $member->id . '?tenant_id=' . $partnerTenantId);
        $profile->assertOk();

        // The advisory is only worth anything if it predicts the real refusal.
        $transfer = $this->apiPost('/v2/federation/transactions', [
            'receiver_id' => $member->id,
            'receiver_tenant_id' => $partnerTenantId,
            'amount' => 1,
            'description' => 'Thanks for the help',
        ]);

        $transfer->assertStatus(403);
        $this->assertSame(
            $profile->json('data.safeguarding.code'),
            $transfer->json('errors.0.code'),
            'The profile advisory must name the same refusal the transfer endpoint gives.',
        );
    }

    public function test_member_profile_allows_contact_when_no_safeguarding_restriction_applies(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Unrestricted Partner');
        $this->seedPartnership($partnerTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $member = $this->seedFederatedUser($partnerTenantId);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/members/' . $member->id . '?tenant_id=' . $partnerTenantId);

        $response->assertOk();
        $response->assertJsonPath('data.safeguarding.contact_allowed', true);
        $response->assertJsonPath('data.safeguarding.code', null);
        $response->assertJsonPath('data.safeguarding.detail', null);
    }

    /**
     * A safeguarding option belonging to the SENDER's tenant must not travel to
     * a member in another tenant. Preferences and options are both scoped to
     * the recipient's tenant; reading them against the wrong one would either
     * restrict an unrestricted member or miss a real restriction.
     */
    public function test_member_profile_safeguarding_advisory_is_scoped_to_the_recipient_tenant(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Scoping Partner');
        $this->seedPartnership($partnerTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $member = $this->seedFederatedUser($partnerTenantId);

        // Restriction recorded in the SENDER's tenant against the same user id.
        $foreignOptionId = $this->seedSafeguardingOptionForTenant($this->testTenantId, [
            'restricts_messaging' => true,
        ]);
        $this->selectSafeguardingOption($this->testTenantId, (int) $member->id, $foreignOptionId);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/members/' . $member->id . '?tenant_id=' . $partnerTenantId);

        $response->assertOk();
        $response->assertJsonPath('data.safeguarding.contact_allowed', true);
    }

    // ------------------------------------------------------------------
    //  GET /v2/federation/listings
    // ------------------------------------------------------------------

    public function test_federation_listings_requires_auth(): void
    {
        $response = $this->apiGet('/v2/federation/listings');

        $response->assertStatus(401);
    }

    public function test_direct_external_member_search_requires_partner_allow_flag(): void
    {
        $this->enableFederationForTenant($this->testTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $partner = $this->setupPartner('nexus', $this->testTenantId);
        DB::table('federation_external_partners')
            ->where('id', $partner->id)
            ->update(['allow_member_search' => 0]);
        Http::fake();

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/members?partner_id=ext-' . $partner->id);

        $response->assertStatus(403);
        Http::assertNothingSent();
    }

    public function test_direct_external_listing_search_requires_partner_allow_flag(): void
    {
        $this->enableFederationForTenant($this->testTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $partner = $this->setupPartner('nexus', $this->testTenantId);
        DB::table('federation_external_partners')
            ->where('id', $partner->id)
            ->update(['allow_listing_search' => 0]);
        Http::fake();

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/listings?partner_id=ext-' . $partner->id);

        $response->assertStatus(403);
        Http::assertNothingSent();
    }

    public function test_direct_external_member_search_returns_source_metadata(): void
    {
        $this->enableFederationForTenant($this->testTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $partner = $this->setupPartner('nexus', $this->testTenantId);

        Http::fake(fn () => Http::response([
                'success' => true,
                'data' => [
                    [
                        'id' => 'remote-member-1',
                        'name' => 'Remote Member',
                        'skills' => ['translation'],
                        'accepts_messages' => true,
                        'accepts_transactions' => false,
                        'timebank' => ['name' => 'Remote Timebank'],
                    ],
                ],
            ], 200));

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/members?partner_id=ext-' . $partner->id);

        $response->assertOk();
        $response->assertJsonPath('meta.pagination_scope', 'external_partner');
        $response->assertJsonPath('meta.cursor_scope', 'external_partner');
        $response->assertJsonPath('meta.load_more_scope', 'none');
        $response->assertJsonPath('meta.external_pagination_scope', 'single_partner_result_set');
        $response->assertJsonPath('meta.external_results_paginated', false);
        $response->assertJsonPath('meta.total_items', 1);
        $response->assertJsonPath('meta.source_counts.internal_returned', 0);
        $response->assertJsonPath('meta.source_counts.internal_total_items', 0);
        $response->assertJsonPath('meta.source_counts.external_returned', 1);
        $response->assertJsonPath('meta.source_counts.returned_total', 1);
        $response->assertJsonPath('data.0.id', 'ext-' . $partner->id . '-remote-member-1');
        $response->assertJsonPath('data.0.tenant_id', 'ext-' . $partner->id);
        $response->assertJsonPath('data.0.timebank.id', 'ext-' . $partner->id);
    }

    public function test_first_page_external_member_merge_keeps_internal_total_separate(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Source Metadata Members');
        $this->seedPartnership($partnerTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $this->seedFederatedUser($partnerTenantId, [
            'first_name' => 'Internal',
            'last_name' => 'Partner',
        ]);
        $externalPartner = $this->setupPartner('nexus', $this->testTenantId);

        Http::fake([
            rtrim($externalPartner->base_url, '/') . '/api/v1/members*' => Http::response([
                'success' => true,
                'data' => [
                    [
                        'id' => 'remote-member-2',
                        'name' => 'External merged member',
                        'timebank' => ['name' => 'Remote Timebank'],
                    ],
                ],
            ], 200),
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/members');

        $response->assertOk();
        $response->assertJsonPath('meta.total_items', 1);
        $response->assertJsonPath('meta.pagination_scope', 'internal_partners');
        $response->assertJsonPath('meta.cursor_scope', 'internal_partners');
        $response->assertJsonPath('meta.load_more_scope', 'none');
        $response->assertJsonPath('meta.external_pagination_scope', 'first_page_enrichment');
        $response->assertJsonPath('meta.external_results_paginated', false);
        $response->assertJsonPath('meta.external_results_included', true);
        $response->assertJsonPath('meta.source_counts.internal_returned', 1);
        $response->assertJsonPath('meta.source_counts.internal_total_items', 1);
        $response->assertJsonPath('meta.source_counts.external_returned', 1);
        $response->assertJsonPath('meta.source_counts.returned_total', 2);

        $external = collect($response->json('data'))->firstWhere('is_external', true);
        $this->assertNotNull($external);
        $this->assertSame('ext-' . $externalPartner->id, $external['timebank']['id']);
    }

    public function test_external_member_detail_route_returns_normalized_remote_profile(): void
    {
        $this->enableFederationForTenant($this->testTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $partner = $this->setupPartner('nexus', $this->testTenantId);

        Http::fake([
            rtrim($partner->base_url, '/') . '/api/v1/members/remote-member-1' => Http::response([
                'success' => true,
                'data' => [
                    'id' => 'remote-member-1',
                    'name' => 'Remote Detail Member',
                    'skills' => ['translation', 'repairs'],
                    'accepts_messages' => true,
                    'accepts_transactions' => true,
                    'timebank' => ['name' => 'Remote Timebank'],
                ],
            ], 200),
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/members/ext-' . $partner->id . '-remote-member-1');

        $response->assertOk();
        $response->assertJsonPath('data.id', 'ext-' . $partner->id . '-remote-member-1');
        $response->assertJsonPath('data.external_id', 'remote-member-1');
        $response->assertJsonPath('data.external_partner_id', $partner->id);
        $response->assertJsonPath('data.tenant_id', 'ext-' . $partner->id);
        $response->assertJsonPath('data.timebank.id', 'ext-' . $partner->id);
        $response->assertJsonPath('data.is_external', true);
    }

    public function test_external_member_detail_requires_partner_member_search_allow_flag(): void
    {
        $this->enableFederationForTenant($this->testTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $partner = $this->setupPartner('nexus', $this->testTenantId);
        DB::table('federation_external_partners')
            ->where('id', $partner->id)
            ->update(['allow_member_search' => 0]);
        Http::fake();

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/members/ext-' . $partner->id . '-remote-member-1');

        $response->assertStatus(403);
        Http::assertNothingSent();
    }

    public function test_direct_external_listing_search_returns_ext_timebank_contract(): void
    {
        $this->enableFederationForTenant($this->testTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $partner = $this->setupPartner('nexus', $this->testTenantId);

        Http::fake([
            rtrim($partner->base_url, '/') . '/api/v1/listings*' => Http::response([
                'success' => true,
                'data' => [
                    [
                        'id' => 'remote-listing-1',
                        'title' => 'Remote Listing',
                        'description' => 'Visible external listing.',
                        'type' => 'offer',
                        'estimated_hours' => 2,
                        'owner' => [
                            'id' => 'remote-owner-1',
                            'name' => 'Remote Owner',
                        ],
                        'timebank' => ['name' => 'Remote Timebank'],
                    ],
                ],
            ], 200),
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/listings?partner_id=ext-' . $partner->id);

        $response->assertOk();
        $response->assertJsonPath('meta.pagination_scope', 'external_partner');
        $response->assertJsonPath('meta.cursor_scope', 'external_partner');
        $response->assertJsonPath('meta.load_more_scope', 'none');
        $response->assertJsonPath('meta.external_pagination_scope', 'single_partner_result_set');
        $response->assertJsonPath('meta.external_results_paginated', false);
        $response->assertJsonPath('meta.total_items', 1);
        $response->assertJsonPath('meta.source_counts.internal_returned', 0);
        $response->assertJsonPath('meta.source_counts.internal_total_items', 0);
        $response->assertJsonPath('meta.source_counts.external_returned', 1);
        $response->assertJsonPath('meta.source_counts.returned_total', 1);
        $response->assertJsonPath('data.0.id', 'ext-' . $partner->id . '-remote-listing-1');
        $response->assertJsonPath('data.0.timebank.id', 'ext-' . $partner->id);
        $response->assertJsonPath('data.0.external_partner_id', $partner->id);
    }

    public function test_first_page_external_listing_merge_returns_source_counts_and_ext_timebank_id(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Source Metadata Partner');
        $this->seedPartnership($partnerTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $owner = $this->seedFederatedUser($partnerTenantId);
        $externalPartner = $this->setupPartner('nexus', $this->testTenantId);

        DB::table('listings')->insert([
            'tenant_id' => $partnerTenantId,
            'user_id' => $owner->id,
            'title' => 'Internal federated listing',
            'description' => 'Visible internal partner listing.',
            'type' => 'offer',
            'status' => 'active',
            'federated_visibility' => 'listed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            rtrim($externalPartner->base_url, '/') . '/api/v1/listings*' => Http::response([
                'success' => true,
                'data' => [
                    [
                        'id' => 'remote-listing-2',
                        'title' => 'External merged listing',
                        'description' => 'Visible external merged listing.',
                        'type' => 'request',
                        'owner' => [
                            'id' => 'remote-owner-2',
                            'name' => 'Remote Owner',
                        ],
                        'timebank' => ['name' => 'Remote Timebank'],
                    ],
                ],
            ], 200),
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/listings');

        $response->assertOk();
        $response->assertJsonPath('meta.pagination_scope', 'internal_partners');
        $response->assertJsonPath('meta.cursor_scope', 'internal_partners');
        $response->assertJsonPath('meta.load_more_scope', 'none');
        $response->assertJsonPath('meta.external_pagination_scope', 'first_page_enrichment');
        $response->assertJsonPath('meta.external_results_paginated', false);
        $response->assertJsonPath('meta.total_items', 1);
        $response->assertJsonPath('meta.external_results_included', true);
        $response->assertJsonPath('meta.source_counts.internal_returned', 1);
        $response->assertJsonPath('meta.source_counts.internal_total_items', 1);
        $response->assertJsonPath('meta.source_counts.external_returned', 1);
        $response->assertJsonPath('meta.source_counts.returned_total', 2);

        $external = collect($response->json('data'))->firstWhere('is_external', true);
        $this->assertNotNull($external);
        $this->assertSame('ext-' . $externalPartner->id, $external['timebank']['id']);
        $this->assertSame((int) $externalPartner->id, (int) $external['external_partner_id']);
    }

    // ------------------------------------------------------------------
    //  GET /v2/federation/events
    // ------------------------------------------------------------------

    public function test_federation_events_requires_auth(): void
    {
        $response = $this->apiGet('/v2/federation/events');

        $response->assertStatus(401);
    }

    public function test_send_message_records_delivery_evidence_on_receiver_copy(): void
    {
        $source = file_get_contents(app_path('Http/Controllers/Api/FederationV2Controller.php'));

        $this->assertStringContainsString('$inboundId = (int)DB::getPdo()->lastInsertId();', $source);
        $this->assertStringContainsString('$emailSent = $this->federationEmailService->sendNewMessageNotification(', $source);
        $this->assertStringContainsString('SET email_sent_at = ?', $source);
        $this->assertStringContainsString('email_failed_at = ?', $source);
        $this->assertStringContainsString('WHERE id = ? AND receiver_tenant_id = ?', $source);
        $this->assertStringContainsString('SET notification_sent_at = NOW()', $source);
    }

    public function test_messages_endpoint_only_returns_the_viewers_copy_of_internal_messages(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Message Partner');
        $this->seedPartnership($partnerTenantId);
        $sender = $this->seedFederatedUser($this->testTenantId, ['first_name' => 'Sender']);
        $receiver = $this->seedFederatedUser($partnerTenantId, ['first_name' => 'Receiver']);

        $outboundId = (int) DB::table('federation_messages')->insertGetId([
            'sender_tenant_id' => $this->testTenantId,
            'sender_user_id' => $sender->id,
            'receiver_tenant_id' => $partnerTenantId,
            'receiver_user_id' => $receiver->id,
            'subject' => 'Hello & welcome',
            'body' => 'Plain & readable',
            'direction' => 'outbound',
            'status' => 'delivered',
            'created_at' => now(),
        ]);
        $inboundId = (int) DB::table('federation_messages')->insertGetId([
            'sender_tenant_id' => $this->testTenantId,
            'sender_user_id' => $sender->id,
            'receiver_tenant_id' => $partnerTenantId,
            'receiver_user_id' => $receiver->id,
            'subject' => 'Hello & welcome',
            'body' => 'Plain & readable',
            'direction' => 'inbound',
            'status' => 'unread',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($sender, ['*']);
        $senderResponse = $this->apiGet('/v2/federation/messages');
        $senderResponse->assertOk();
        $senderIds = array_column($senderResponse->json('data'), 'id');
        $this->assertContains($outboundId, $senderIds);
        $this->assertNotContains($inboundId, $senderIds);
        $this->assertSame('Plain & readable', $senderResponse->json('data.0.body'));

        Sanctum::actingAs($receiver, ['*']);
        $receiverResponse = $this->getJson('/api/v2/federation/messages', [
            'X-Tenant-ID' => (string) $partnerTenantId,
            'Accept' => 'application/json',
        ]);
        $receiverResponse->assertOk();
        $receiverIds = array_column($receiverResponse->json('data'), 'id');
        $this->assertContains($inboundId, $receiverIds);
        $this->assertNotContains($outboundId, $receiverIds);
    }

    public function test_batch_mark_read_mirrors_single_message_realtime_receipt_path(): void
    {
        $source = file_get_contents(app_path('Http/Controllers/Api/FederationV2Controller.php'));
        $methodStart = strpos($source, 'public function markMessagesReadBatch');
        $methodEnd = strpos($source, 'public function translateMessage', $methodStart);
        $methodSource = substr($source, $methodStart, $methodEnd - $methodStart);

        $this->assertStringContainsString('SELECT id, sender_user_id, sender_tenant_id', $methodSource);
        $this->assertStringContainsString('FederationRealtimeService::broadcastMessageRead', $methodSource);
    }

    public function test_external_message_translation_context_is_scoped_to_external_partner(): void
    {
        $this->enableFederationForTenant($this->testTenantId);
        $this->enableMessageTranslationForTenant($this->testTenantId);
        Config::set('services.openai.api_key', 'test-openai-key');

        $viewer = $this->seedFederatedUser($this->testTenantId);
        $partnerA = $this->setupPartner('nexus', $this->testTenantId);
        $partnerB = $this->setupPartner('timeoverflow', $this->testTenantId);
        $remoteUserId = 90123;

        DB::table('federation_messages')->insert([
            [
                'sender_tenant_id' => $this->testTenantId,
                'sender_user_id' => $viewer->id,
                'receiver_tenant_id' => 0,
                'receiver_user_id' => $remoteUserId,
                'external_partner_id' => $partnerA->id,
                'subject' => 'Context',
                'body' => 'same-partner-context-token',
                'direction' => 'outbound',
                'status' => 'delivered',
                'created_at' => now()->subMinutes(3),
            ],
            [
                'sender_tenant_id' => $this->testTenantId,
                'sender_user_id' => $viewer->id,
                'receiver_tenant_id' => 0,
                'receiver_user_id' => $remoteUserId,
                'external_partner_id' => $partnerB->id,
                'subject' => 'Context',
                'body' => 'other-partner-leak-token',
                'direction' => 'outbound',
                'status' => 'delivered',
                'created_at' => now()->subMinutes(2),
            ],
        ]);

        $targetId = (int) DB::table('federation_messages')->insertGetId([
            'sender_tenant_id' => $this->testTenantId,
            'sender_user_id' => $viewer->id,
            'receiver_tenant_id' => 0,
            'receiver_user_id' => $remoteUserId,
            'external_partner_id' => $partnerA->id,
            'subject' => 'Translate',
            'body' => 'Message to translate',
            'direction' => 'outbound',
            'status' => 'delivered',
            'created_at' => now(),
        ]);

        Http::fake([
            'https://api.openai.com/v1/chat/completions' => Http::response([
                'choices' => [
                    ['message' => ['content' => 'Mensaje traducido']],
                ],
            ], 200),
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->postJson("/api/v2/federation/messages/{$targetId}/translate", [
            'target_language' => 'es',
        ], [
            'X-Tenant-ID' => (string) $this->testTenantId,
            'Accept' => 'application/json',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.translated_text', 'Mensaje traducido');
        Http::assertSent(function ($request): bool {
            $messages = $request->data()['messages'] ?? [];
            $userPrompt = (string) ($messages[1]['content'] ?? '');

            return str_contains($userPrompt, 'same-partner-context-token')
                && !str_contains($userPrompt, 'other-partner-leak-token')
                && str_contains($userPrompt, 'Message to translate');
        });
    }

    public function test_members_endpoint_hides_searchable_profiles_when_profile_visibility_is_disabled(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Hidden Profile Partner');
        $this->seedPartnership($partnerTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $hidden = $this->seedFederatedUser(
            $partnerTenantId,
            ['first_name' => 'Hidden', 'last_name' => 'Member'],
            ['profile_visible_federated' => 0, 'appear_in_federated_search' => 1]
        );

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/members');

        $response->assertOk();
        $ids = array_column($response->json('data'), 'id');
        $this->assertNotContains($hidden->id, $ids);
    }

    public function test_listings_and_events_require_item_level_federated_visibility(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Visibility Partner');
        $this->seedPartnership($partnerTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $owner = $this->seedFederatedUser($partnerTenantId);

        DB::table('listings')->insert([
            [
                'tenant_id' => $partnerTenantId,
                'user_id' => $owner->id,
                'title' => 'Local-only listing',
                'description' => 'Should stay local.',
                'type' => 'offer',
                'status' => 'active',
                'federated_visibility' => 'none',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $partnerTenantId,
                'user_id' => $owner->id,
                'title' => 'Federated listing',
                'description' => 'Should be visible.',
                'type' => 'offer',
                'status' => 'active',
                'federated_visibility' => 'listed',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);
        DB::table('events')->insert([
            [
                'tenant_id' => $partnerTenantId,
                'user_id' => $owner->id,
                'title' => 'Local-only event',
                'description' => 'Should stay local.',
                'location' => 'Online',
                'start_time' => now()->addDay(),
                'end_time' => now()->addDay()->addHour(),
                'status' => 'active',
                'federated_visibility' => 'none',
                'created_at' => now(),
            ],
            [
                'tenant_id' => $partnerTenantId,
                'user_id' => $owner->id,
                'title' => 'Federated event',
                'description' => 'Should be visible.',
                'location' => 'Online',
                'start_time' => now()->addDays(2),
                'end_time' => now()->addDays(2)->addHour(),
                'status' => 'active',
                'federated_visibility' => 'listed',
                'created_at' => now(),
            ],
        ]);

        Sanctum::actingAs($viewer, ['*']);

        $listingResponse = $this->apiGet('/v2/federation/listings');
        $listingResponse->assertOk();
        $listingTitles = array_column($listingResponse->json('data'), 'title');
        $this->assertContains('Federated listing', $listingTitles);
        $this->assertNotContains('Local-only listing', $listingTitles);

        $eventResponse = $this->apiGet('/v2/federation/events');
        $eventResponse->assertOk();
        $eventTitles = array_column($eventResponse->json('data'), 'title');
        $this->assertContains('Federated event', $eventTitles);
        $this->assertNotContains('Local-only event', $eventTitles);
    }

    public function test_partner_stats_count_only_federated_visible_listings(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Listing Count Partner');
        $this->seedPartnership($partnerTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $visibleOwner = $this->seedFederatedUser($partnerTenantId);
        $hiddenOwner = $this->seedFederatedUser($partnerTenantId, [], ['appear_in_federated_search' => 0]);

        DB::table('listings')->insert([
            [
                'tenant_id' => $partnerTenantId,
                'user_id' => $visibleOwner->id,
                'title' => 'Federated visible listing',
                'description' => 'Visible.',
                'type' => 'offer',
                'status' => 'active',
                'federated_visibility' => 'listed',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $partnerTenantId,
                'user_id' => $visibleOwner->id,
                'title' => 'Local-only listing',
                'description' => 'Not counted.',
                'type' => 'offer',
                'status' => 'active',
                'federated_visibility' => 'none',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $partnerTenantId,
                'user_id' => $hiddenOwner->id,
                'title' => 'Hidden owner listing',
                'description' => 'Not counted.',
                'type' => 'offer',
                'status' => 'active',
                'federated_visibility' => 'listed',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/partners');

        $response->assertOk();
        $partner = collect($response->json('data'))->firstWhere('id', $partnerTenantId);
        $this->assertNotNull($partner);
        $this->assertSame(1, (int) $partner['listing_count']);
    }

    public function test_activity_feed_requires_opt_in_and_only_returns_user_relevant_activity(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Activity Partner');
        $this->seedPartnership($partnerTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $other = $this->seedFederatedUser($this->testTenantId);

        DB::table('federation_audit_log')->insert([
            [
                'action_type' => 'member_search',
                'category' => 'profiles',
                'level' => 'info',
                'source_tenant_id' => $this->testTenantId,
                'target_tenant_id' => $partnerTenantId,
                'actor_user_id' => $viewer->id,
                'actor_name' => 'Viewer',
                'data' => json_encode(['description' => 'Viewer activity']),
                'created_at' => now(),
            ],
            [
                'action_type' => 'member_search',
                'category' => 'profiles',
                'level' => 'info',
                'source_tenant_id' => $this->testTenantId,
                'target_tenant_id' => $partnerTenantId,
                'actor_user_id' => $other->id,
                'actor_name' => 'Other',
                'data' => json_encode(['description' => 'Other member activity']),
                'created_at' => now(),
            ],
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/activity');

        $response->assertOk();
        $descriptions = array_column($response->json('data'), 'description');
        $this->assertContains('Viewer activity', $descriptions);
        $this->assertNotContains('Other member activity', $descriptions);

        DB::table('federation_user_settings')->where('user_id', $viewer->id)->update(['federation_optin' => 0]);
        $this->apiGet('/v2/federation/activity')->assertStatus(403);
    }

    public function test_federation_browse_and_read_endpoints_require_caller_opt_in(): void
    {
        $this->enableFederationForTenant($this->testTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        DB::table('federation_user_settings')
            ->where('user_id', $viewer->id)
            ->update(['federation_optin' => 0]);

        Sanctum::actingAs($viewer, ['*']);

        foreach ([
            '/v2/federation/members',
            '/v2/federation/listings',
            '/v2/federation/events',
            '/v2/federation/groups',
            '/v2/federation/messages',
            '/v2/federation/connections',
            '/v2/federation/members/1',
            '/v2/federation/members/1/reviews',
        ] as $endpoint) {
            $this->apiGet($endpoint)->assertStatus(403);
        }
    }

    public function test_groups_endpoint_respects_group_owner_federation_privacy(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Group Privacy Partner');
        $this->seedPartnership($partnerTenantId);
        $viewer = $this->seedFederatedUser($this->testTenantId);
        $visibleOwner = $this->seedFederatedUser($partnerTenantId);
        $hiddenOwner = $this->seedFederatedUser($partnerTenantId, [], ['profile_visible_federated' => 0]);

        DB::table('groups')->insert([
            [
                'tenant_id' => $partnerTenantId,
                'owner_id' => $visibleOwner->id,
                'name' => 'Visible federated group',
                'description' => 'Visible.',
                'status' => 'active',
                'federated_visibility' => 'listed',
                'created_at' => now(),
            ],
            [
                'tenant_id' => $partnerTenantId,
                'owner_id' => $hiddenOwner->id,
                'name' => 'Hidden owner group',
                'description' => 'Hidden.',
                'status' => 'active',
                'federated_visibility' => 'listed',
                'created_at' => now(),
            ],
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/federation/groups');

        $response->assertOk();
        $names = array_column($response->json('data'), 'name');
        $this->assertContains('Visible federated group', $names);
        $this->assertNotContains('Hidden owner group', $names);
    }

    public function test_admin_partnership_stats_count_logical_messages_and_internal_transactions(): void
    {
        $partnerTenantId = $this->seedPartnerTenant('Stats Partner');
        $partnershipId = $this->seedPartnership($partnerTenantId);
        $admin = $this->seedFederatedUser($this->testTenantId, ['role' => 'admin']);
        $receiver = $this->seedFederatedUser($partnerTenantId);

        DB::table('federation_messages')->insert([
            [
                'sender_tenant_id' => $this->testTenantId,
                'sender_user_id' => $admin->id,
                'receiver_tenant_id' => $partnerTenantId,
                'receiver_user_id' => $receiver->id,
                'subject' => 'Stats',
                'body' => 'One logical message',
                'direction' => 'outbound',
                'status' => 'delivered',
                'created_at' => now(),
            ],
            [
                'sender_tenant_id' => $this->testTenantId,
                'sender_user_id' => $admin->id,
                'receiver_tenant_id' => $partnerTenantId,
                'receiver_user_id' => $receiver->id,
                'subject' => 'Stats',
                'body' => 'One logical message',
                'direction' => 'inbound',
                'status' => 'unread',
                'created_at' => now(),
            ],
        ]);
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $admin->id,
            'receiver_id' => $receiver->id,
            'amount' => 3,
            'description' => 'Internal federation stats transfer',
            'status' => 'completed',
            'is_federated' => 1,
            'sender_tenant_id' => $this->testTenantId,
            'receiver_tenant_id' => $partnerTenantId,
            'created_at' => now(),
        ]);

        Sanctum::actingAs($admin, ['*']);
        $response = $this->apiGet("/v2/admin/federation/partnerships/{$partnershipId}/stats");

        $response->assertOk();
        $this->assertSame(1, (int) $response->json('data.messages_exchanged'));
        $this->assertSame(1, (int) $response->json('data.transactions_completed'));
    }
}
