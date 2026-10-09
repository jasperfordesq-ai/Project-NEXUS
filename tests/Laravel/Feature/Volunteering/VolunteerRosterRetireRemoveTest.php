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
 * 9 Oct 2026: an organisation's volunteer roster had no way to retire a
 * volunteer or take them off it. Organisers can now retire (history kept,
 * reversible) and remove (off every opportunity, logged hours kept).
 */
class VolunteerRosterRetireRemoveTest extends TestCase
{
    use DatabaseTransactions;

    private User $creator;
    private User $volunteer;
    private User $outsider;
    private int $orgId;
    private int $oppA;
    private int $oppB;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);

        $this->creator = $this->member('Creator');
        $this->volunteer = $this->member('Volunteer');
        $this->outsider = $this->member('Outsider');

        $this->orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->creator->id, 'name' => 'Food Bank',
            'slug' => 'roster-org-' . uniqid(), 'status' => 'approved', 'created_at' => now(),
        ]);
        $this->oppA = $this->opportunity('Sorting');
        $this->oppB = $this->opportunity('Delivery');
    }

    private function member(string $first): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => $first, 'last_name' => 'Tester', 'name' => "$first Tester",
            'email' => strtolower($first) . '-' . uniqid('', true) . '@example.test',
            'status' => 'active', 'is_approved' => true, 'preferred_language' => 'en',
        ]);
    }

    private function opportunity(string $title): int
    {
        return (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId, 'organization_id' => $this->orgId, 'title' => $title,
            'description' => 'Test', 'status' => 'active', 'is_active' => 1,
            'created_by' => $this->creator->id, 'created_at' => now(),
        ]);
    }

    private function shift(int $oppId, bool $upcoming): int
    {
        $start = $upcoming ? now()->addDays(2) : now()->subDays(2);
        return (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId, 'opportunity_id' => $oppId,
            'start_time' => $start, 'end_time' => $start->copy()->addHours(2), 'capacity' => 1,
        ]);
    }

    private function approve(int $oppId, ?int $shiftId = null): int
    {
        return (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId, 'opportunity_id' => $oppId, 'shift_id' => $shiftId,
            'user_id' => $this->volunteer->id, 'status' => 'approved', 'created_at' => now(),
        ]);
    }

    private function url(string $suffix = ''): string
    {
        return "/v2/volunteering/organisations/{$this->orgId}/volunteers{$suffix}";
    }

    /** @return list<int> */
    private function rosterIds(string $status = 'active'): array
    {
        $query = $status === 'retired' ? '?status=retired' : '';
        return array_column($this->apiGet($this->url($query))->assertOk()->json('data'), 'id');
    }

    public function test_retiring_keeps_history_frees_upcoming_shifts_and_can_be_undone(): void
    {
        $pastShift = $this->shift($this->oppA, false);
        $upcomingShift = $this->shift($this->oppB, true);
        $pastApp = $this->approve($this->oppA, $pastShift);
        $upcomingApp = $this->approve($this->oppB, $upcomingShift);
        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->volunteer->id, 'organization_id' => $this->orgId,
            'date_logged' => now()->toDateString(), 'hours' => 3, 'status' => 'approved', 'created_at' => now(),
        ]);
        Sanctum::actingAs($this->creator);

        $this->assertSame([$this->volunteer->id], $this->rosterIds());

        $this->apiPost($this->url("/{$this->volunteer->id}/retire"))
            ->assertOk()
            ->assertJsonPath('data.released_shifts', 1);

        $this->assertSame([], $this->rosterIds());
        $retired = $this->apiGet($this->url('?status=retired'))->assertOk()->json('data');
        $this->assertSame([$this->volunteer->id], array_column($retired, 'id'));
        $this->assertSame(3.0, (float) $retired[0]['total_hours']);
        $this->assertSame(2, $retired[0]['applications_count']);
        $this->assertNotNull($retired[0]['retired_at']);
        $this->assertSame(0, $this->apiGet("/v2/volunteering/organisations/{$this->orgId}/stats")->json('data.total_volunteers'));

        // Both roles kept; only the place on the shift that has not started is released.
        $this->assertSame($pastShift, (int) DB::table('vol_applications')->where('id', $pastApp)->value('shift_id'));
        $this->assertNull(DB::table('vol_applications')->where('id', $upcomingApp)->value('shift_id'));
        $this->assertSame('approved', DB::table('vol_applications')->where('id', $upcomingApp)->value('status'));

        $this->apiPost($this->url("/{$this->volunteer->id}/retire"))->assertStatus(409);

        $this->apiPost($this->url("/{$this->volunteer->id}/reinstate"))->assertOk();
        $this->assertSame([$this->volunteer->id], $this->rosterIds());
        $this->assertSame([], $this->rosterIds('retired'));
        $this->apiPost($this->url("/{$this->volunteer->id}/reinstate"))->assertStatus(404);

        $this->assertSame(2, DB::table('notifications')->where('user_id', $this->volunteer->id)
            ->where('type', 'volunteer_roster')->count());
        $this->assertSame(['volunteer_reinstated', 'volunteer_retired'], DB::table('org_audit_log')
            ->where('organization_id', $this->orgId)->where('target_user_id', $this->volunteer->id)
            ->orderBy('action')->pluck('action')->all());
    }

    public function test_removing_takes_the_volunteer_off_every_role_but_keeps_logged_hours(): void
    {
        $this->approve($this->oppA);
        $this->approve($this->oppB, $this->shift($this->oppB, true));
        $logId = DB::table('vol_logs')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->volunteer->id, 'organization_id' => $this->orgId,
            'date_logged' => now()->toDateString(), 'hours' => 2, 'status' => 'approved', 'created_at' => now(),
        ]);
        // A pending application is a new request, not a role, and is left alone.
        $pending = (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId, 'opportunity_id' => $this->opportunity('Kitchen'),
            'user_id' => $this->volunteer->id, 'status' => 'pending', 'created_at' => now(),
        ]);
        Sanctum::actingAs($this->creator);

        $this->apiDelete($this->url("/{$this->volunteer->id}"))
            ->assertOk()
            ->assertJsonPath('data.removed_roles', 2)
            ->assertJsonPath('data.released_shifts', 1);

        $this->assertSame([], $this->rosterIds());
        $this->assertSame([], $this->rosterIds('retired'));
        $this->assertSame(0, DB::table('vol_applications')->where('user_id', $this->volunteer->id)
            ->where('status', 'approved')->count());
        $this->assertTrue(DB::table('vol_applications')->where('id', $pending)->exists());
        $this->assertTrue(DB::table('vol_logs')->where('id', $logId)->exists());
        $this->assertSame(1, DB::table('notifications')->where('user_id', $this->volunteer->id)
            ->where('type', 'vol_volunteer_removed')->count());
        $this->assertRemovalEmailQueued('Food Bank');

        $this->apiDelete($this->url("/{$this->volunteer->id}"))->assertStatus(404);
    }

    public function test_removing_a_volunteer_from_one_opportunity_emails_them(): void
    {
        $appId = $this->approve($this->oppA);
        Sanctum::actingAs($this->creator);

        $this->apiPost("/v2/volunteering/applications/{$appId}/remove")->assertOk();

        $this->assertFalse(DB::table('vol_applications')->where('id', $appId)->exists());
        $this->assertSame(1, DB::table('notifications')->where('user_id', $this->volunteer->id)
            ->where('type', 'vol_volunteer_removed')->count());
        $this->assertRemovalEmailQueued('Sorting');
    }

    /**
     * The volunteer has no digest setting (the default is 'off'), so this also
     * proves the removal email is sent at once rather than waiting for a digest.
     */
    private function assertRemovalEmailQueued(string $mustMention): void
    {
        $rows = DB::table('notification_queue')->where('user_id', $this->volunteer->id)
            ->where('activity_type', 'vol_volunteer_removed')->get();
        $this->assertCount(1, $rows);
        $this->assertSame('instant', $rows[0]->frequency);
        $this->assertStringContainsString($mustMention, (string) $rows[0]->email_body);
        $this->assertStringContainsString(
            __('emails_notifications.volunteering.heading_removed'),
            (string) $rows[0]->email_body
        );
    }

    public function test_a_retired_volunteer_can_be_removed_and_leaves_the_retired_list(): void
    {
        $this->approve($this->oppA);
        Sanctum::actingAs($this->creator);

        $this->apiPost($this->url("/{$this->volunteer->id}/retire"))->assertOk();
        $this->apiDelete($this->url("/{$this->volunteer->id}"))->assertOk();

        $this->assertSame([], $this->rosterIds('retired'));
        $this->assertFalse(DB::table('vol_org_retired_volunteers')->where('user_id', $this->volunteer->id)->exists());
    }

    public function test_only_people_who_run_the_organisation_can_change_the_roster(): void
    {
        $this->approve($this->oppA);

        Sanctum::actingAs($this->outsider);
        $this->apiPost($this->url("/{$this->volunteer->id}/retire"))->assertStatus(403);
        $this->apiDelete($this->url("/{$this->volunteer->id}"))->assertStatus(403);

        // The volunteer themselves does not run the organisation either.
        Sanctum::actingAs($this->volunteer);
        $this->apiDelete($this->url("/{$this->volunteer->id}"))->assertStatus(403);

        $this->assertSame(1, DB::table('vol_applications')->where('user_id', $this->volunteer->id)
            ->where('status', 'approved')->count());
        $this->assertFalse(DB::table('vol_org_retired_volunteers')->where('user_id', $this->volunteer->id)->exists());

        // An org admin can.
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId, 'organization_id' => $this->orgId, 'org_type' => 'volunteer',
            'user_id' => $this->outsider->id, 'role' => 'admin', 'status' => 'active', 'created_at' => now(),
        ]);
        Sanctum::actingAs($this->outsider);
        $this->apiPost($this->url("/{$this->volunteer->id}/retire"))->assertOk();
    }

    public function test_someone_who_is_not_on_this_roster_cannot_be_retired_or_removed(): void
    {
        // Approved for another organisation's opportunity only.
        $otherOrg = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->outsider->id, 'name' => 'Other',
            'slug' => 'other-org-' . uniqid(), 'status' => 'approved', 'created_at' => now(),
        ]);
        $otherOpp = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId, 'organization_id' => $otherOrg, 'title' => 'Elsewhere',
            'description' => 'Test', 'status' => 'active', 'is_active' => 1,
            'created_by' => $this->outsider->id, 'created_at' => now(),
        ]);
        $this->approve($otherOpp);
        Sanctum::actingAs($this->creator);

        $this->apiPost($this->url("/{$this->volunteer->id}/retire"))->assertStatus(404)
            ->assertJsonPath('errors.0.code', 'NOT_VOLUNTEER');
        $this->apiDelete($this->url("/{$this->volunteer->id}"))->assertStatus(404);
        $this->assertSame(1, DB::table('vol_applications')->where('opportunity_id', $otherOpp)
            ->where('status', 'approved')->count());
    }
}
