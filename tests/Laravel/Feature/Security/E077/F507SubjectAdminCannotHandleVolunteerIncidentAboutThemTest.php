<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E077;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-507 (E-077 re-attack, reviewer B's C2) — an administrator who is the SUBJECT
 * (or the involved person) of a volunteering safeguarding incident must not be
 * able to list it, open the investigators' record, rewrite it, assign it or
 * close it.
 *
 * `vol_safeguarding_incidents` is one of four parallel reporting systems, and the
 * only one without the platform's rule that nobody handles a safeguarding record
 * about themselves — concern notes (F-457/F-462) and caring-community reports
 * (F-213) already have it. `closed` is terminal, so the subject could close the
 * case for good.
 *
 * These tests assert the CORRECT behaviour and fail before the fix. Controls in
 * the same file: an unrelated administrator still sees and updates the incident;
 * the subject still sees other incidents.
 */
final class F507SubjectAdminCannotHandleVolunteerIncidentAboutThemTest extends TestCase
{
    use DatabaseTransactions;

    private User $subjectAdmin;

    private User $otherAdmin;

    private int $aboutSubject = 0;

    private int $aboutSomeoneElse = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        TenantContext::setById($this->testTenantId);
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        $features['volunteering'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        $reporter = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'role' => 'member']);
        $bystander = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'role' => 'member']);
        $this->subjectAdmin = $this->admin();
        $this->otherAdmin = $this->admin();

        $this->aboutSubject = $this->incident((int) $reporter->id, 'subject_user_id', (int) $this->subjectAdmin->id, 'F507-ABOUT-SUBJECT');
        $this->aboutSomeoneElse = $this->incident((int) $reporter->id, 'subject_user_id', (int) $bystander->id, 'F507-ABOUT-OTHER');
    }

    public function test_the_subject_does_not_see_the_incident_about_them_in_either_list(): void
    {
        Sanctum::actingAs($this->subjectAdmin, ['*']);

        foreach (['/v2/admin/volunteering/incidents', '/v2/volunteering/incidents'] as $uri) {
            $list = $this->apiGet($uri);
            $this->assertSame(200, $list->getStatusCode(), $uri . ' ' . $list->getContent());
            $this->assertStringNotContainsString('F507-ABOUT-SUBJECT', (string) $list->getContent(), "F-507: {$uri} lists the incident about the caller");
        }
        // Control: the same administrator still sees other incidents in the staff
        // list. (The member list holds only the caller's own reports since the
        // incident case record, 2026-10-05, so it has no control to offer.)
        $this->assertStringContainsString('F507-ABOUT-OTHER', (string) $this->apiGet('/v2/admin/volunteering/incidents')->getContent(), 'CONTROL: the staff list still lists other incidents');
    }

    public function test_the_subject_cannot_open_the_incident_about_them(): void
    {
        Sanctum::actingAs($this->subjectAdmin, ['*']);

        foreach (["/v2/volunteering/incidents/{$this->aboutSubject}", "/v2/admin/volunteering/incidents/{$this->aboutSubject}"] as $uri) {
            $res = $this->apiGet($uri);
            $this->assertSame(404, $res->getStatusCode(), "F-507 {$uri}: " . $res->getContent());
            $this->assertStringNotContainsString('F507-ABOUT-SUBJECT', (string) $res->getContent());
        }
    }

    public function test_the_subject_cannot_rewrite_reassign_or_close_the_incident_about_them(): void
    {
        Sanctum::actingAs($this->subjectAdmin, ['*']);

        $res = $this->apiPut("/v2/admin/volunteering/incidents/{$this->aboutSubject}", [
            'status' => 'closed',
            'action_taken' => 'F507-OVERWRITTEN',
            'assigned_to' => $this->subjectAdmin->id,
        ]);
        $this->assertSame(404, $res->getStatusCode(), 'F-507: ' . $res->getContent());

        $row = DB::table('vol_safeguarding_incidents')->where('id', $this->aboutSubject)->first();
        $this->assertSame('investigating', (string) $row->status);
        $this->assertSame('F507-ABOUT-SUBJECT', (string) $row->action_taken);
        $this->assertSame((int) $this->otherAdmin->id, (int) $row->assigned_to);
    }

    public function test_the_involved_person_is_kept_out_the_same_way(): void
    {
        $reporter = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'role' => 'member']);
        $id = $this->incident((int) $reporter->id, 'involved_user_id', (int) $this->subjectAdmin->id, 'F507-INVOLVED');

        Sanctum::actingAs($this->subjectAdmin, ['*']);
        $this->apiGet("/v2/volunteering/incidents/{$id}")->assertStatus(404);
        $this->apiPut("/v2/admin/volunteering/incidents/{$id}", ['status' => 'closed'])->assertStatus(404);
        $this->assertSame('investigating', (string) DB::table('vol_safeguarding_incidents')->where('id', $id)->value('status'));
    }

    public function test_nobody_may_assign_the_incident_to_the_person_it_is_about(): void
    {
        Sanctum::actingAs($this->otherAdmin, ['*']);

        $res = $this->apiPut("/v2/admin/volunteering/incidents/{$this->aboutSubject}", [
            'assigned_to' => $this->subjectAdmin->id,
        ]);
        $this->assertNotSame(200, $res->getStatusCode(), 'F-507: an incident was handed to its own subject. ' . $res->getContent());
        $this->assertSame((int) $this->otherAdmin->id, (int) DB::table('vol_safeguarding_incidents')->where('id', $this->aboutSubject)->value('assigned_to'));
    }

    public function test_control_an_unrelated_administrator_still_opens_and_updates_it(): void
    {
        Sanctum::actingAs($this->otherAdmin, ['*']);

        $this->apiGet("/v2/admin/volunteering/incidents/{$this->aboutSubject}")->assertStatus(200);
        // Escalating needs a reason since the incident timeline was added.
        $this->apiPut("/v2/admin/volunteering/incidents/{$this->aboutSubject}", ['status' => 'escalated', 'reason' => 'Referred to the statutory service.'])->assertStatus(200);
        $this->assertSame('escalated', (string) DB::table('vol_safeguarding_incidents')->where('id', $this->aboutSubject)->value('status'));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function incident(int $reporterId, string $personColumn, int $personId, string $marker): int
    {
        return (int) DB::table('vol_safeguarding_incidents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reported_by' => $reporterId,
            'title' => $marker . ' title',
            $personColumn => $personId,
            'incident_type' => 'allegation',
            'category' => 'general',
            'severity' => 'high',
            'description' => $marker . ' narrative',
            'action_taken' => $marker,
            'assigned_to' => $this->otherAdmin->id,
            'status' => 'investigating',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function admin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $u->id)->update(['role' => 'admin', 'is_admin' => 1]);

        return User::find($u->id);
    }
}
