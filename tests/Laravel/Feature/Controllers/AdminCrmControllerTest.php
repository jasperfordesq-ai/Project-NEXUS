<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminCrmController.
 *
 * Covers dashboard, funnel, admins, notes, tasks, tags, timeline, and exports.
 */
class AdminCrmControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // DASHBOARD — GET /v2/admin/crm/dashboard
    // ================================================================

    public function test_dashboard_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/dashboard');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_dashboard_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/crm/dashboard');

        $response->assertStatus(403);
    }

    public function test_dashboard_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/crm/dashboard');

        $response->assertStatus(401);
    }

    // ================================================================
    // FUNNEL — GET /v2/admin/crm/funnel
    // ================================================================

    public function test_funnel_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/funnel');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['stages' => ['*' => ['code', 'count', 'color']]]]);
        $this->assertSame('registered', $response->json('data.stages.0.code'));
        $this->assertArrayNotHasKey('name', $response->json('data.stages.0'));
    }

    public function test_funnel_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/crm/funnel');

        $response->assertStatus(403);
    }

    /**
     * Each stage counts members who reached it OR went further, so the counts
     * can only fall as the journey goes on. They used to be six unrelated
     * totals, which put "500%" and "150%" step rates on the admin page.
     */
    public function test_funnel_places_each_member_at_the_furthest_step_reached(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $before = $this->funnelCounts();

        $plain = ['email_verified_at' => null, 'bio' => null, 'location' => null];
        User::factory()->forTenant($this->testTenantId)->create($plain); // joined, nothing else
        $verified = User::factory()->forTenant($this->testTenantId)->create(['email_verified_at' => now()] + $plain);
        // Posted a listing without confirming email or finishing a profile:
        // still counted at every step up to "first listing".
        $lister = User::factory()->forTenant($this->testTenantId)->create($plain);
        DB::table('listings')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $lister->id,
            'title' => 'Funnel fixture listing', 'type' => 'offer',
        ]);
        // Two members who have exchanged with each other twice.
        $regularA = User::factory()->forTenant($this->testTenantId)->create($plain);
        $regularB = User::factory()->forTenant($this->testTenantId)->create($plain);
        $this->completedTransaction($regularA->id, $regularB->id);
        $this->completedTransaction($regularB->id, $regularA->id);
        // Credits with no counterpart are not exchanges. Two of them used to
        // make the empty counterpart itself count as a "repeat user".
        $this->completedTransaction(null, $verified->id, 'starting_balance');
        $this->completedTransaction(null, $verified->id, 'admin_grant');
        // Banned accounts are not part of anyone's onboarding.
        User::factory()->forTenant($this->testTenantId)->create(['status' => 'banned'] + $plain);

        $after = $this->funnelCounts();
        $delta = array_map(fn ($code) => $after[$code] - $before[$code], array_keys($after));

        // registered: joinedOnly, verified, lister, regularA, regularB.
        // verified and beyond: all but joinedOnly. Profile: lister + regulars
        // (they went further). Exchanges: the two regulars only.
        $this->assertSame([5, 4, 3, 3, 2, 2], $delta);

        $previous = PHP_INT_MAX;
        foreach ($after as $count) {
            $this->assertLessThanOrEqual($previous, $count);
            $previous = $count;
        }
    }

    public function test_funnel_names_the_members_waiting_at_each_step(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $stuck = User::factory()->forTenant($this->testTenantId)->create([
            'email_verified_at' => now(), 'bio' => null, 'location' => null,
            'created_at' => now()->addMinute(),
        ]);

        $stages = collect($this->apiGet('/v2/admin/crm/funnel')->assertOk()->json('data.stages'))->keyBy('code');

        $waitingIds = array_column($stages['email_verified']['waiting_members'], 'id');
        $this->assertContains($stuck->id, $waitingIds);
        $this->assertGreaterThanOrEqual(1, $stages['email_verified']['waiting']);
        $this->assertNotContains($stuck->id, array_column($stages['registered']['waiting_members'], 'id'));
        $this->assertSame(0, $stages['repeat_user']['waiting']);
    }

    public function test_funnel_monthly_registrations_include_empty_months(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $months = $this->apiGet('/v2/admin/crm/funnel')->assertOk()->json('data.monthly_registrations');

        $this->assertCount(6, $months);
        $this->assertSame(now()->format('Y-m'), end($months)['month']);
        $this->assertSame(now()->subMonths(5)->format('Y-m'), $months[0]['month']);
    }

    /** @return array<string, int> */
    private function funnelCounts(): array
    {
        $stages = $this->apiGet('/v2/admin/crm/funnel')->assertOk()->json('data.stages');

        return array_column($stages, 'count', 'code');
    }

    private function completedTransaction(?int $senderId, int $receiverId, string $type = 'exchange'): void
    {
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => $senderId, 'receiver_id' => $receiverId,
            'amount' => 1, 'status' => 'completed', 'transaction_type' => $type,
        ]);
    }

    // ================================================================
    // ADMINS LIST — GET /v2/admin/crm/admins
    // ================================================================

    public function test_list_admins_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/admins');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // NOTES — GET /v2/admin/crm/notes
    // ================================================================

    public function test_list_notes_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/notes');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_list_notes_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/crm/notes');

        $response->assertStatus(403);
    }

    // ================================================================
    // CREATE NOTE — POST /v2/admin/crm/notes
    // ================================================================

    public function test_create_note_returns_success_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $target = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/crm/notes', [
            'user_id' => $target->id,
            'content' => 'Test CRM note content',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // TASKS — GET /v2/admin/crm/tasks
    // ================================================================

    public function test_list_tasks_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/tasks');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_list_tasks_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/crm/tasks');

        $response->assertStatus(403);
    }

    // ================================================================
    // TAGS — GET /v2/admin/crm/tags
    // ================================================================

    public function test_list_tags_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/tags');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // TIMELINE — GET /v2/admin/crm/timeline
    // ================================================================

    public function test_timeline_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        // Disable the date window so this response-contract assertion does not
        // depend on a Carbon test clock leaked by an earlier test in the shard.
        $response = $this->apiGet('/v2/admin/crm/timeline?days=0');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['*' => [
            'activity_type', 'description_code', 'description_params', 'created_at',
        ]]]);

        $signup = collect($response->json('data'))->firstWhere('activity_type', 'signup');
        $this->assertNotNull($signup);
        $this->assertSame('signup', $signup['description_code']);
        $this->assertSame([], $signup['description_params']);
        $this->assertArrayNotHasKey('description', $signup);
    }

    // ================================================================
    // EXPORT NOTES — GET /v2/admin/crm/export/notes
    // ================================================================

    public function test_export_notes_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/export/notes');

        $response->assertStatus(200);
    }

    public function test_export_notes_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/crm/export/notes');

        $response->assertStatus(403);
    }
}
