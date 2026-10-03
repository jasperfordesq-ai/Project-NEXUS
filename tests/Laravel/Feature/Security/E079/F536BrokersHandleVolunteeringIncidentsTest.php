<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E079;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-536 (E-079) — volunteering safeguarding incidents alerted brokers and
 * coordinators, linked them to /broker/safeguarding and could be assigned to
 * them, yet the list and update routes were admin-only, so they could never open
 * one. Owner decision (2 October 2026): brokers and coordinators handle them.
 *
 * Asserts: broker and coordinator can list and update; F-507 (nobody handles an
 * incident about themselves) still holds for them; ordinary members are still
 * refused; assigning an organisation's DLP stays admin-only.
 */
final class F536BrokersHandleVolunteeringIncidentsTest extends TestCase
{
    use DatabaseTransactions;

    private int $incidentId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        $features['volunteering'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        $reporter = $this->user('member');
        $this->incidentId = $this->incident((int) $reporter->id, null, 'F536-INCIDENT');
    }

    public function test_a_broker_can_list_and_update_volunteering_incidents(): void
    {
        Sanctum::actingAs($this->user('broker'), ['*']);

        $list = $this->apiGet('/v2/admin/volunteering/incidents');
        $this->assertSame(200, $list->getStatusCode(), $list->getContent());
        $this->assertStringContainsString('F536-INCIDENT', (string) $list->getContent());

        $this->apiPut("/v2/admin/volunteering/incidents/{$this->incidentId}", [
            'status' => 'investigating',
            'action_taken' => 'F536-BROKER-ACTION',
        ])->assertStatus(200);
        $this->assertSame('investigating', DB::table('vol_safeguarding_incidents')->where('id', $this->incidentId)->value('status'));
    }

    public function test_the_incident_alert_opens_the_volunteering_incidents_page(): void
    {
        // Since October 2026 /broker/safeguarding is four pages, and its bare
        // address opens Members' support needs. The incident alert must open
        // the page that lists incidents.
        Mail::fake();
        $broker = $this->user('broker');
        $reporter = $this->user('member');

        $result = app(\App\Services\SafeguardingService::class)->reportIncident((int) $reporter->id, [
            'title' => 'F536-ALERT-LINK',
            'description' => 'F536 alert link narrative',
            'severity' => 'high',
            'incident_type' => 'concern',
        ], $this->testTenantId);
        $this->assertIsArray($result);

        $link = DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $broker->id)
            ->where('type', 'safeguarding_flag')
            ->orderByDesc('id')
            ->value('link');
        $this->assertSame('/broker/safeguarding/volunteering', $link);
    }

    public function test_a_coordinator_can_list_and_update_volunteering_incidents(): void
    {
        Sanctum::actingAs($this->user('coordinator'), ['*']);

        $this->apiGet('/v2/admin/volunteering/incidents')->assertStatus(200);
        $this->apiPut("/v2/admin/volunteering/incidents/{$this->incidentId}", ['status' => 'escalated'])->assertStatus(200);
        $this->assertSame('escalated', DB::table('vol_safeguarding_incidents')->where('id', $this->incidentId)->value('status'));
    }

    public function test_a_broker_who_is_the_subject_never_sees_or_handles_the_incident_about_them(): void
    {
        $broker = $this->user('broker');
        $aboutBroker = $this->incident((int) $this->user('member')->id, (int) $broker->id, 'F536-ABOUT-BROKER');
        Sanctum::actingAs($broker, ['*']);

        $list = $this->apiGet('/v2/admin/volunteering/incidents');
        $list->assertStatus(200);
        $this->assertStringNotContainsString('F536-ABOUT-BROKER', (string) $list->getContent());
        $this->assertStringContainsString('F536-INCIDENT', (string) $list->getContent(), 'CONTROL: other incidents still listed');

        $this->apiPut("/v2/admin/volunteering/incidents/{$aboutBroker}", ['status' => 'closed'])->assertStatus(404);
        $this->assertSame('open', DB::table('vol_safeguarding_incidents')->where('id', $aboutBroker)->value('status'));
    }

    public function test_an_ordinary_member_is_still_refused(): void
    {
        Sanctum::actingAs($this->user('member'), ['*']);

        $this->apiGet('/v2/admin/volunteering/incidents')->assertStatus(403);
        $this->apiPut("/v2/admin/volunteering/incidents/{$this->incidentId}", ['status' => 'closed'])->assertStatus(403);
        $this->assertSame('open', DB::table('vol_safeguarding_incidents')->where('id', $this->incidentId)->value('status'));
    }

    public function test_assigning_an_organisations_dlp_stays_admin_only(): void
    {
        Sanctum::actingAs($this->user('broker'), ['*']);

        $this->apiPut('/v2/admin/volunteering/organizations/1/dlp', ['dlp_user_id' => 1])->assertStatus(403);
    }

    public function test_control_an_administrator_still_lists_and_updates(): void
    {
        $admin = $this->user('member');
        DB::table('users')->where('id', $admin->id)->update(['role' => 'admin', 'is_admin' => 1]);
        Sanctum::actingAs(User::find($admin->id), ['*']);

        $this->apiGet('/v2/admin/volunteering/incidents')->assertStatus(200);
        $this->apiPut("/v2/admin/volunteering/incidents/{$this->incidentId}", ['status' => 'investigating'])->assertStatus(200);
    }

    private function incident(int $reporterId, ?int $subjectId, string $marker): int
    {
        return (int) DB::table('vol_safeguarding_incidents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reported_by' => $reporterId,
            'title' => $marker . ' title',
            'subject_user_id' => $subjectId,
            'incident_type' => 'concern',
            'category' => 'general',
            'severity' => 'high',
            'description' => $marker . ' narrative',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function user(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $u->id)->update(['role' => $role]);

        return User::find($u->id);
    }
}
