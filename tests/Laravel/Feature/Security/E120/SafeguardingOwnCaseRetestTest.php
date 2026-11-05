<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E120;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * E-120 re-test of F-237 / GHSA-5377-75mw-q8rw, using the reporter's exact
 * scenario: a safeguarding manager who is the SUBJECT of a submitted report
 * sends a normal authenticated request to dismiss it.
 *
 * Every state-changing route on a case (status, assign, escalate, note) must
 * refuse the subject, exactly as the read routes hide the case from them, and
 * must leave no trace (status, assignee, escalation flag, action log).
 */
class SafeguardingOwnCaseRetestTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $mailer = Mockery::mock(EmailDispatchService::class);
        $mailer->shouldReceive('send')->andReturn(true);
        $mailer->shouldReceive('sendRaw')->andReturn(true);
        $this->app->instance(EmailDispatchService::class, $mailer);

        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function user(string $role = 'member', array $extra = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => $role,
        ], $extra));
    }

    private function grantManage(User $user): void
    {
        $permissionId = DB::table('permissions')->where('name', 'safeguarding.manage')->value('id');
        if (!$permissionId) {
            $permissionId = DB::table('permissions')->insertGetId([
                'name' => 'safeguarding.manage',
                'display_name' => 'Manage safeguarding reports',
                'description' => 'Manage safeguarding reports',
                'category' => 'safeguarding',
                'is_dangerous' => 0,
                'tenant_id' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        DB::table('user_permissions')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'permission_id' => $permissionId,
            'granted' => 1,
            'granted_at' => now(),
        ]);
    }

    private function reportAbout(User $subject): int
    {
        $reporter = $this->user();

        return (int) DB::table('safeguarding_reports')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reporter_user_id' => $reporter->id,
            'subject_user_id' => $subject->id,
            'category' => 'exploitation',
            'severity' => 'high',
            'description' => 'Synthetic E-120 own-case report.',
            'status' => 'submitted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string, User> the two manager shapes the advisory names */
    private function reportedManagers(): array
    {
        $officer = $this->user('member');
        $this->grantManage($officer);

        return [
            'admin' => $this->user('admin'),
            'safeguarding.manage holder' => $officer,
        ];
    }

    private function assertUntouched(int $reportId): void
    {
        $row = DB::table('safeguarding_reports')->where('id', $reportId)->first();
        $this->assertSame('submitted', (string) $row->status);
        $this->assertNull($row->resolved_at);
        $this->assertNull($row->resolution_notes);
        $this->assertNull($row->assigned_to_user_id);
        $this->assertSame(0, (int) $row->escalated);
        $this->assertSame(0, DB::table('safeguarding_report_actions')->where('report_id', $reportId)->count());
    }

    /** The reporter's literal payload, plus the other closing transition. */
    public function test_reported_manager_cannot_dismiss_or_resolve_their_own_case(): void
    {
        foreach ($this->reportedManagers() as $label => $manager) {
            foreach (['dismissed', 'resolved', 'triaged', 'investigating'] as $status) {
                $reportId = $this->reportAbout($manager);
                Sanctum::actingAs($manager);

                $response = $this->apiPost("/v2/admin/caring-community/safeguarding/reports/{$reportId}/status", [
                    'status' => $status,
                    'notes' => 'PoC self-dismissal',
                ]);

                $this->assertNotSame(200, $response->status(), "{$label} changed own case to {$status}");
                $this->assertUntouched($reportId);
            }
        }
    }

    public function test_reported_manager_cannot_assign_their_own_case_to_anyone(): void
    {
        $colleague = $this->user('coordinator');
        foreach ($this->reportedManagers() as $label => $manager) {
            foreach ([$manager->id, $colleague->id] as $assigneeId) {
                $reportId = $this->reportAbout($manager);
                Sanctum::actingAs($manager);

                $response = $this->apiPost("/v2/admin/caring-community/safeguarding/reports/{$reportId}/assign", [
                    'assignee_user_id' => $assigneeId,
                ]);

                $this->assertNotSame(200, $response->status(), "{$label} assigned own case");
                $this->assertUntouched($reportId);
            }
        }
    }

    public function test_reported_manager_cannot_escalate_or_annotate_their_own_case(): void
    {
        foreach ($this->reportedManagers() as $label => $manager) {
            $reportId = $this->reportAbout($manager);
            Sanctum::actingAs($manager);

            $escalate = $this->apiPost("/v2/admin/caring-community/safeguarding/reports/{$reportId}/escalate", ['note' => 'self']);
            $note = $this->apiPost("/v2/admin/caring-community/safeguarding/reports/{$reportId}/note", ['note' => 'self']);

            $this->assertNotSame(200, $escalate->status(), "{$label} escalated own case");
            $this->assertNotSame(200, $note->status(), "{$label} annotated own case");
            $this->assertUntouched($reportId);
        }
    }

    /** Control: an independent manager can still handle the same case. */
    public function test_an_independent_manager_can_still_close_the_case(): void
    {
        $subject = $this->user('admin');
        $independent = $this->user('admin');
        $reportId = $this->reportAbout($subject);
        Sanctum::actingAs($independent);

        $this->apiPost("/v2/admin/caring-community/safeguarding/reports/{$reportId}/status", [
            'status' => 'dismissed',
            'notes' => 'Reviewed independently.',
        ])->assertStatus(200);

        $this->assertSame('dismissed', (string) DB::table('safeguarding_reports')->where('id', $reportId)->value('status'));
    }
}
