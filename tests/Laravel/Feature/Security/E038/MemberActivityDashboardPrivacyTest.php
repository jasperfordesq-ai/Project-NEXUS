<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E038;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-002 (E-003, owner decision 26 Sep 2026, fixed in E-038): any signed-in
 * member could read another member's exchange history from
 * GET /v2/users/{id}/activity/dashboard — every completed exchange with the
 * other party's name and hours, hours given/received per month, and a net
 * balance. The accessible site shows this timeline on every member page.
 *
 * Decision: only the member themselves and that community's admins and
 * brokers see exchange partners, per-exchange hours and the net balance.
 * Other members still get the rest of the dashboard (public posts, skills,
 * connection and engagement counts).
 */
class MemberActivityDashboardPrivacyTest extends TestCase
{
    use DatabaseTransactions;

    private User $member;
    private User $partner;
    private string $partnerMarker;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);

        $this->partnerMarker = 'Partnermarker' . substr(md5(uniqid('', true)), 0, 8);
        $this->member = $this->makeUser();
        $this->partner = $this->makeUser(['first_name' => $this->partnerMarker]);

        foreach ([[$this->member->id, $this->partner->id, 3.0], [$this->partner->id, $this->member->id, 1.5]] as [$from, $to, $amount]) {
            DB::table('transactions')->insert([
                'tenant_id' => $this->testTenantId,
                'sender_id' => $from,
                'receiver_id' => $to,
                'amount' => $amount,
                'description' => 'F-002 exchange',
                'status' => 'completed',
                'created_at' => now(),
            ]);
        }
    }

    private function makeUser(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function dashboardAs(User $viewer): \Illuminate\Testing\TestResponse
    {
        Sanctum::actingAs($viewer, ['*']);

        return $this->apiGet("/v2/users/{$this->member->id}/activity/dashboard")->assertOk();
    }

    public function test_another_member_cannot_see_exchange_partners_hours_or_net_balance(): void
    {
        $response = $this->dashboardAs($this->makeUser());

        $response->assertJsonMissingPath('data.hours_summary');
        $response->assertJsonMissingPath('data.monthly_hours');

        $types = array_column((array) $response->json('data.timeline'), 'activity_type');
        $this->assertNotContains('gave_hours', $types);
        $this->assertNotContains('received_hours', $types);

        $this->assertStringNotContainsString($this->partnerMarker, $response->getContent());
        $this->assertStringNotContainsString('net_balance', $response->getContent());

        // The non-sensitive sections remain so the member page still renders.
        $response->assertJsonStructure(['data' => ['timeline', 'skills_breakdown', 'connection_stats', 'engagement']]);
    }

    public function test_the_member_sees_their_own_partners_hours_and_balance(): void
    {
        $response = $this->dashboardAs($this->member);

        $response->assertJsonPath('data.hours_summary.net_balance', -1.5);
        $response->assertJsonStructure(['data' => ['monthly_hours']]);
        $this->assertStringContainsString($this->partnerMarker, $response->getContent());
    }

    public function test_community_admin_sees_the_full_dashboard(): void
    {
        $response = $this->dashboardAs($this->makeUser(['role' => 'admin']));

        $response->assertJsonPath('data.hours_summary.net_balance', -1.5);
        $this->assertStringContainsString($this->partnerMarker, $response->getContent());
    }

    public function test_community_broker_sees_the_full_dashboard(): void
    {
        $response = $this->dashboardAs($this->makeUser(['role' => 'broker']));

        $response->assertJsonPath('data.hours_summary.net_balance', -1.5);
        $this->assertStringContainsString($this->partnerMarker, $response->getContent());
    }

    public function test_coordinator_sees_the_full_dashboard_like_a_broker(): void
    {
        $response = $this->dashboardAs($this->makeUser(['role' => 'coordinator']));

        $response->assertJsonPath('data.hours_summary.net_balance', -1.5);
    }
}
