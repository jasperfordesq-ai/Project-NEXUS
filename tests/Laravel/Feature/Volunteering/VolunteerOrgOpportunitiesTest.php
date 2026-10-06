<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * An organisation's own list of its opportunities, for its dashboard.
 *
 * Gap A6 of the volunteering journey walk (6 Oct 2026): the dashboard had no
 * Opportunities tab, so an organiser had to browse the public list to find
 * their own — where closed and cancelled ones never appear. This list shows
 * all of them, with what needs attention on each, to the people who run the
 * organisation and nobody else.
 */
class VolunteerOrgOpportunitiesTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge(['status' => 'active', 'is_approved' => true], $overrides));
    }

    private function organisation(User $owner): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Dashboard fixture organisation',
            'slug' => 'dashboard-fixture-org-' . uniqid(),
            'status' => 'approved',
            'created_at' => now(),
        ]);
    }

    private function opportunity(int $orgId, User $creator, string $title, array $overrides = []): int
    {
        return (int) DB::table('vol_opportunities')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $creator->id,
            'title' => $title,
            'description' => $title . ' description',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function application(int $oppId, string $status): void
    {
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $this->member()->id,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function shift(int $oppId, string $when): void
    {
        $start = new \DateTimeImmutable($when);
        DB::table('vol_shifts')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => $start->format('Y-m-d H:i:s'),
            'end_time' => $start->modify('+2 hours')->format('Y-m-d H:i:s'),
            'capacity' => 3,
            'created_at' => now(),
        ]);
    }

    public function test_the_owner_sees_every_opportunity_including_closed_and_cancelled_with_counts(): void
    {
        $owner = $this->member();
        $orgId = $this->organisation($owner);
        $open = $this->opportunity($orgId, $owner, 'ORGOPP Open one');
        $closed = $this->opportunity($orgId, $owner, 'ORGOPP Closed one', ['status' => 'closed']);
        $cancelled = $this->opportunity($orgId, $owner, 'ORGOPP Cancelled one', ['is_active' => 0]);
        $this->application($open, 'pending');
        $this->application($open, 'pending');
        $this->application($open, 'approved');
        $this->application($open, 'declined');
        $this->shift($open, '+2 days');
        $this->shift($open, '+9 days');
        $this->shift($open, '-3 days');

        $otherOrg = $this->organisation($this->member());
        $this->opportunity($otherOrg, $owner, 'ORGOPP Someone else\'s');

        Sanctum::actingAs($owner, ['*']);
        $items = collect($this->apiGet("/v2/volunteering/organisations/{$orgId}/opportunities")->assertOk()->json('data.items'));

        $this->assertEqualsCanonicalizing([$open, $closed, $cancelled], $items->pluck('id')->all());
        $row = $items->firstWhere('id', $open);
        $this->assertSame('open', $row['state']);
        $this->assertSame(2, $row['pending_applications']);
        $this->assertSame(1, $row['approved_volunteers']);
        $this->assertSame(2, $row['upcoming_shifts']);
        $this->assertSame('closed', $items->firstWhere('id', $closed)['state']);
        $this->assertSame('cancelled', $items->firstWhere('id', $cancelled)['state']);
    }

    public function test_an_organisation_admin_can_see_the_list(): void
    {
        $owner = $this->member();
        $orgId = $this->organisation($owner);
        $this->opportunity($orgId, $owner, 'ORGOPP For the admin');
        $admin = $this->member();
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'org_type' => 'volunteer',
            'user_id' => $admin->id,
            'role' => 'admin',
            'status' => 'active',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($admin, ['*']);
        $this->assertCount(1, $this->apiGet("/v2/volunteering/organisations/{$orgId}/opportunities")->assertOk()->json('data.items'));
    }

    public function test_a_plain_member_is_refused(): void
    {
        $owner = $this->member();
        $orgId = $this->organisation($owner);
        $this->opportunity($orgId, $owner, 'ORGOPP Private list');

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiGet("/v2/volunteering/organisations/{$orgId}/opportunities")->assertForbidden();
    }

    public function test_another_communitys_organisation_is_refused(): void
    {
        $owner = $this->member();
        $orgId = $this->organisation($owner);
        DB::table('vol_organizations')->where('id', $orgId)->update(['tenant_id' => 999]);

        Sanctum::actingAs($owner, ['*']);
        $this->apiGet("/v2/volunteering/organisations/{$orgId}/opportunities")->assertForbidden();
    }
}
