<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Federation;

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
 * Partner-community events were listed by database id, so an event created
 * later but happening sooner appeared further down (29 Oct 2026). Upcoming
 * events now run soonest first; the full list runs newest first; the cursor
 * carries the date so paging stays in that order.
 */
final class FederatedEventsOrderTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;

    public function test_partner_events_are_ordered_by_date_across_pages(): void
    {
        $partner = (int) DB::table('tenants')->insertGetId([
            'name' => 'Order Partner ' . substr(uniqid(), -6),
            'slug' => 'order-partner-' . substr(uniqid(), -6),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->enableFederationForTenant($this->testTenantId);
        $this->enableFederationForTenant($partner);
        app(FederationFeatureService::class)->clearCache();
        TenantContext::setById($this->testTenantId);

        $pair = [
            'tenant_id' => $this->testTenantId, 'partner_tenant_id' => $partner, 'status' => 'active',
            'federation_level' => 4, 'profiles_enabled' => 1, 'messaging_enabled' => 1, 'transactions_enabled' => 1,
            'listings_enabled' => 1, 'events_enabled' => 1, 'groups_enabled' => 1,
            'requested_at' => now(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ];
        if (Schema::hasColumn('federation_partnerships', 'canonical_pair')) {
            $pair['canonical_pair'] = min($this->testTenantId, $partner) . '-' . max($this->testTenantId, $partner);
        }
        DB::table('federation_partnerships')->insert($pair);

        $optIn = function (int $tenantId): User {
            $user = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true, 'onboarding_completed' => 1]);
            DB::table('federation_user_settings')->updateOrInsert(['user_id' => $user->id], [
                'federation_optin' => 1, 'profile_visible_federated' => 1, 'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1, 'appear_in_federated_search' => 1, 'show_skills_federated' => 1,
                'show_location_federated' => 1, 'show_reviews_federated' => 1, 'service_reach' => 'remote_ok', 'updated_at' => now(),
            ]);
            return $user;
        };
        $owner = $optIn($partner);
        Sanctum::actingAs($optIn($this->testTenantId), ['*']);

        // Created in this order (ascending id), happening in a different order.
        $event = fn (int $days) => (int) DB::table('events')->insertGetId([
            'tenant_id' => $partner, 'user_id' => $owner->id, 'title' => "In {$days} days", 'description' => 'Order test.',
            'start_time' => now()->addDays($days), 'status' => 'active', 'federated_visibility' => 'listed',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $in10 = $event(10);
        $in2 = $event(2);
        $in30 = $event(30);
        $in5 = $event(5);

        $first = $this->apiGet('/v2/federation/events?upcoming=1&per_page=2&partner_id=' . $partner);
        $first->assertOk();
        $this->assertSame([$in2, $in5], array_map('intval', array_column($first->json('data'), 'id')));
        $cursor = $first->json('meta.cursor');
        $this->assertNotEmpty($cursor);

        $second = $this->apiGet('/v2/federation/events?upcoming=1&per_page=2&partner_id=' . $partner . '&cursor=' . urlencode($cursor));
        $this->assertSame([$in10, $in30], array_map('intval', array_column($second->json('data'), 'id')));

        $all = $this->apiGet('/v2/federation/events?per_page=10&partner_id=' . $partner);
        $this->assertSame([$in30, $in10, $in5, $in2], array_map('intval', array_column($all->json('data'), 'id')));
    }
}
