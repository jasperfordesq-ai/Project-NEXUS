<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\TestCase;

/**
 * F-156 — federation is symmetric. When partner community B disables its own
 * `federation` feature, community A must stop reaching B's members, listings,
 * events, messages and transactions, even though the partnership row is active.
 *
 * F-190 — federated group/event listings must respect group privacy: a secret
 * group and a private-group event must never be exposed cross-community.
 */
class FederationCrossCommunityExposureTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;

    private function seedPartnerTenant(): int
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'E035 Partner ' . substr(uniqid(), -6),
            'slug' => 'e035-partner-' . substr(uniqid(), -6),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->enableFederationForTenant($this->testTenantId);
        $this->enableFederationForTenant($tenantId);
        app(FederationFeatureService::class)->clearCache();
        TenantContext::setById($this->testTenantId);

        return $tenantId;
    }

    private function seedPartnership(int $partnerTenantId): int
    {
        $data = [
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
        ];
        if (Schema::hasColumn('federation_partnerships', 'canonical_pair')) {
            $data['canonical_pair'] = min($this->testTenantId, $partnerTenantId) . '-' . max($this->testTenantId, $partnerTenantId);
        }

        return (int) DB::table('federation_partnerships')->insertGetId($data);
    }

    private function seedFederatedUser(int $tenantId, array $userAttributes = []): User
    {
        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $userAttributes));

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'appear_in_federated_search' => 1,
                'show_skills_federated' => 1,
                'show_location_federated' => 1,
                'show_reviews_federated' => 1,
                'service_reach' => 'remote_ok',
                'updated_at' => now(),
            ]
        );

        return $user;
    }

    private function optInViewer(): User
    {
        $viewer = $this->seedFederatedUser($this->testTenantId);
        Sanctum::actingAs($viewer, ['*']);

        return $viewer;
    }

    private function disableFederationForTenant(int $tenantId): void
    {
        DB::table('federation_tenant_features')->updateOrInsert(
            ['tenant_id' => $tenantId, 'feature_key' => 'tenant_federation_enabled'],
            ['is_enabled' => 0, 'updated_at' => now()]
        );
        app(FederationFeatureService::class)->clearCache();
    }

    private function ids(\Illuminate\Testing\TestResponse $resp): array
    {
        return array_map(static fn ($r) => (int) ($r['id'] ?? 0), $resp->json('data') ?? []);
    }

    // ---------------------------------------------------------------- F-156

    public function test_members_hidden_when_partner_disables_federation(): void
    {
        $b = $this->seedPartnerTenant();
        $this->seedPartnership($b);
        $member = $this->seedFederatedUser($b);
        $this->optInViewer();

        $baseline = $this->apiGet('/v2/federation/members');
        $baseline->assertOk();
        $this->assertContains((int) $member->id, $this->ids($baseline), 'member should be visible while B is fully enabled');

        $this->disableFederationForTenant($b);

        $after = $this->apiGet('/v2/federation/members');
        $after->assertOk();
        $this->assertNotContains((int) $member->id, $this->ids($after), 'member must be hidden after B disables federation');
    }

    public function test_member_profile_hidden_when_partner_disables_federation(): void
    {
        $b = $this->seedPartnerTenant();
        $this->seedPartnership($b);
        $member = $this->seedFederatedUser($b);
        $this->optInViewer();

        $this->apiGet('/v2/federation/members/' . $member->id . '?tenant_id=' . $b)->assertOk();

        $this->disableFederationForTenant($b);

        $this->apiGet('/v2/federation/members/' . $member->id . '?tenant_id=' . $b)->assertStatus(404);
    }

    public function test_listings_hidden_when_partner_disables_federation(): void
    {
        $b = $this->seedPartnerTenant();
        $this->seedPartnership($b);
        $owner = $this->seedFederatedUser($b);
        $this->optInViewer();

        $listingId = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $b,
            'user_id' => $owner->id,
            'title' => 'Federated listing',
            'description' => 'Visible while enabled.',
            'type' => 'offer',
            'status' => 'active',
            'federated_visibility' => 'listed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $baseline = $this->apiGet('/v2/federation/listings');
        $baseline->assertOk();
        $this->assertContains($listingId, $this->ids($baseline));

        $this->disableFederationForTenant($b);

        $after = $this->apiGet('/v2/federation/listings');
        $after->assertOk();
        $this->assertNotContains($listingId, $this->ids($after));
    }

    public function test_events_hidden_when_partner_disables_federation(): void
    {
        $b = $this->seedPartnerTenant();
        $this->seedPartnership($b);
        $owner = $this->seedFederatedUser($b);
        $this->optInViewer();

        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $b,
            'user_id' => $owner->id,
            'title' => 'Federated event',
            'description' => 'Visible while enabled.',
            'start_time' => now()->addDays(3),
            'status' => 'active',
            'federated_visibility' => 'listed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $baseline = $this->apiGet('/v2/federation/events');
        $baseline->assertOk();
        $this->assertContains($eventId, $this->ids($baseline));

        $this->disableFederationForTenant($b);

        $after = $this->apiGet('/v2/federation/events');
        $after->assertOk();
        $this->assertNotContains($eventId, $this->ids($after));
    }

    public function test_message_refused_when_partner_disables_federation(): void
    {
        $b = $this->seedPartnerTenant();
        $this->seedPartnership($b);
        $receiver = $this->seedFederatedUser($b);
        $this->optInViewer();

        $this->disableFederationForTenant($b);

        $resp = $this->apiPost('/v2/federation/messages', [
            'receiver_id' => $receiver->id,
            'receiver_tenant_id' => $b,
            'subject' => 'Hi',
            'body' => 'Hello there',
        ]);

        $resp->assertStatus(403);
        $this->assertSame('MESSAGING_NOT_ALLOWED', $resp->json('errors.0.code'));
    }

    public function test_transaction_refused_when_partner_disables_federation(): void
    {
        $b = $this->seedPartnerTenant();
        $this->seedPartnership($b);
        $receiver = $this->seedFederatedUser($b);
        $this->optInViewer();

        $this->disableFederationForTenant($b);

        $resp = $this->apiPost('/v2/federation/transactions', [
            'receiver_id' => $receiver->id,
            'receiver_tenant_id' => $b,
            'amount' => 2,
            'description' => 'Thanks',
        ]);

        $resp->assertStatus(403);
        $this->assertSame('TRANSACTIONS_NOT_ALLOWED', $resp->json('errors.0.code'));
    }

    // ---------------------------------------------------------------- F-190

    public function test_secret_group_not_exposed_cross_community(): void
    {
        $b = $this->seedPartnerTenant();
        $this->seedPartnership($b);
        $owner = $this->seedFederatedUser($b);
        $this->optInViewer();

        $public = $this->seedGroup($b, $owner->id, 'public');
        $secret = $this->seedGroup($b, $owner->id, 'secret');

        $resp = $this->apiGet('/v2/federation/groups');
        $resp->assertOk();
        $ids = $this->ids($resp);

        $this->assertContains($public, $ids, 'public federated group should be visible');
        $this->assertNotContains($secret, $ids, 'secret group must never be exposed cross-community');
    }

    public function test_private_group_event_not_exposed_cross_community(): void
    {
        $b = $this->seedPartnerTenant();
        $this->seedPartnership($b);
        $owner = $this->seedFederatedUser($b);
        $this->optInViewer();

        $privateGroup = $this->seedGroup($b, $owner->id, 'private');

        $standaloneEvent = (int) DB::table('events')->insertGetId([
            'tenant_id' => $b, 'user_id' => $owner->id,
            'title' => 'Standalone event', 'description' => 'Public.',
            'start_time' => now()->addDays(2), 'status' => 'active',
            'federated_visibility' => 'listed', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $privateGroupEvent = (int) DB::table('events')->insertGetId([
            'tenant_id' => $b, 'user_id' => $owner->id, 'group_id' => $privateGroup,
            'title' => 'Private group event', 'description' => 'Should not leak.',
            'start_time' => now()->addDays(2), 'status' => 'active',
            'federated_visibility' => 'listed', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $resp = $this->apiGet('/v2/federation/events');
        $resp->assertOk();
        $ids = $this->ids($resp);

        $this->assertContains($standaloneEvent, $ids, 'standalone federated event should be visible');
        $this->assertNotContains($privateGroupEvent, $ids, 'private-group event must not be exposed cross-community');
    }

    private function seedGroup(int $tenantId, int $ownerId, string $visibility): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId,
            'owner_id' => $ownerId,
            'name' => ucfirst($visibility) . ' group ' . substr(uniqid(), -6),
            'description' => 'Test group.',
            'visibility' => $visibility,
            'status' => 'active',
            'federated_visibility' => 'listed',
            'allow_federated_members' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
