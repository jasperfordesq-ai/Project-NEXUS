<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\Agent\AgentExecutor;
use App\Services\CaringCommunity\CaregiverService;
use App\Services\CaringSupportRelationshipService;
use App\Services\KiAgentService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Mockery;
use Tests\Laravel\TestCase;

class CaringRelationshipPlacementPolicyTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::setById($this->testTenantId);
    }

    public function test_admin_relationship_create_checks_both_directions_before_insert(): void
    {
        $this->requireTable('caring_support_relationships');

        $supporter = $this->member();
        $recipient = $this->member();
        $coordinator = $this->member(['role' => 'admin']);
        $this->denyReverseDirection(
            $supporter->id,
            $recipient->id,
            'caring_support_relationship_create',
        );

        try {
            app(CaringSupportRelationshipService::class)->create($this->testTenantId, [
                'supporter_id' => $supporter->id,
                'recipient_id' => $recipient->id,
            ], $coordinator->id);
            $this->fail('A reverse-direction safeguarding denial must stop relationship creation.');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $this->assertDatabaseMissing('caring_support_relationships', [
            'tenant_id' => $this->testTenantId,
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
        ]);
    }

    public function test_cover_assignment_checks_supporter_and_cared_for_both_directions_before_update(): void
    {
        $this->requireTable('caring_caregiver_links');
        $this->requireTable('caring_cover_requests');

        $caregiver = $this->member();
        $caredFor = $this->member();
        $supporter = $this->member([
            'trust_tier' => 3,
            'verification_status' => 'passed',
            'skills' => 'companionship',
        ]);

        $linkId = DB::table('caring_caregiver_links')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'caregiver_id' => $caregiver->id,
            'cared_for_id' => $caredFor->id,
            'relationship_type' => 'family',
            'is_primary' => 1,
            'start_date' => now()->toDateString(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $coverRequestId = DB::table('caring_cover_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'caregiver_link_id' => $linkId,
            'caregiver_id' => $caregiver->id,
            'cared_for_id' => $caredFor->id,
            'title' => 'Safeguarding cover test',
            'required_skills' => json_encode([]),
            'starts_at' => now()->addDays(20),
            'ends_at' => now()->addDays(21),
            'minimum_trust_tier' => 1,
            'urgency' => 'planned',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->denyReverseDirection($supporter->id, $caredFor->id, 'caring_cover_assignment');

        try {
            app(CaregiverService::class)->assignCoverCandidate(
                (int) $coverRequestId,
                $caregiver->id,
                $this->testTenantId,
                $supporter->id,
            );
            $this->fail('A reverse-direction safeguarding denial must stop cover assignment.');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $request = DB::table('caring_cover_requests')->where('id', $coverRequestId)->first();
        $this->assertSame('open', $request?->status);
        $this->assertNull($request?->matched_supporter_id);
        $this->assertNull($request?->matched_at);
    }

    public function test_caregiver_link_approval_checks_both_directions_and_remains_pending_on_denial(): void
    {
        $this->requireTable('caring_caregiver_links');

        $caregiver = $this->member();
        $recipient = $this->member();
        $admin = $this->member(['role' => 'admin']);
        $linkId = (int) DB::table('caring_caregiver_links')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'caregiver_id' => $caregiver->id,
            'cared_for_id' => $recipient->id,
            'relationship_type' => 'friend',
            'start_date' => now()->toDateString(),
            'status' => 'pending',
            'recipient_confirmed_at' => now(),
            'recipient_confirmed_by' => $recipient->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->denyReverseDirection($caregiver->id, $recipient->id, 'caring_caregiver_link_approval');

        try {
            app(CaregiverService::class)->approveLink(
                $linkId,
                $this->testTenantId,
                $admin->id,
                'Recipient confirmed consent in person.',
            );
            $this->fail('A safeguarding denial must stop caregiver-link activation.');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $this->assertDatabaseHas('caring_caregiver_links', [
            'id' => $linkId,
            'status' => 'pending',
            'approved_by' => null,
        ]);
    }

    public function test_agent_edit_approval_denial_leaves_proposal_and_relationship_untouched(): void
    {
        $this->requireAgentTables();

        $supporter = $this->member();
        $recipient = $this->member();
        $reviewer = $this->member(['role' => 'admin']);
        $runId = $this->agentRun();
        $originalPayload = [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'title' => 'Original proposal',
        ];
        $proposalId = $this->agentProposal($runId, $originalPayload);
        $this->denyReverseDirection($supporter->id, $recipient->id, 'agent_tandem_approval');

        try {
            AgentExecutor::editAndApprove(
                $proposalId,
                $this->testTenantId,
                $reviewer->id,
                [...$originalPayload, 'title' => 'Edited proposal'],
            );
            $this->fail('A reverse-direction safeguarding denial must stop edited tandem approval.');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $proposal = DB::table('agent_proposals')->where('id', $proposalId)->first();
        $this->assertSame('pending_review', $proposal?->status);
        $this->assertSame($originalPayload, json_decode((string) $proposal?->proposal_data, true));
        $this->assertNull($proposal?->reviewer_id);
        $this->assertSame(0, (int) DB::table('agent_runs')->where('id', $runId)->value('proposals_applied'));
        $this->assertDatabaseMissing('caring_support_relationships', [
            'tenant_id' => $this->testTenantId,
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
        ]);
        if (Schema::hasTable('agent_decisions')) {
            $this->assertDatabaseMissing('agent_decisions', ['proposal_id' => $proposalId]);
        }
    }

    public function test_ki_agent_approval_denial_leaves_proposal_pending_and_creates_no_tandem(): void
    {
        $this->requireAgentTables();

        $supporter = $this->member();
        $recipient = $this->member();
        $reviewer = $this->member(['role' => 'admin']);
        $runId = $this->agentRun();
        $proposalId = KiAgentService::createProposal(
            $this->testTenantId,
            $runId,
            'create_tandem',
            ['supporter_id' => $supporter->id, 'recipient_id' => $recipient->id],
            0.9,
            $supporter->id,
            $recipient->id,
        );
        $this->denyReverseDirection($supporter->id, $recipient->id, 'ki_agent_tandem_approval');

        try {
            KiAgentService::approveProposal($proposalId, $this->testTenantId, $reviewer->id);
            $this->fail('A reverse-direction safeguarding denial must stop KI tandem approval.');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $proposal = DB::table('agent_proposals')->where('id', $proposalId)->first();
        $this->assertSame('pending_review', $proposal?->status);
        $this->assertNull($proposal?->reviewer_id);
        $this->assertSame(0, (int) DB::table('agent_runs')->where('id', $runId)->value('proposals_applied'));
        $this->assertDatabaseMissing('caring_support_relationships', [
            'tenant_id' => $this->testTenantId,
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
        ]);
    }

    private function member(array $attributes = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
    }

    private function denyReverseDirection(int $firstId, int $secondId, string $channel): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->ordered()
            ->with($firstId, $secondId, $this->testTenantId, $channel)
            ->andReturnNull();
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->ordered()
            ->with($secondId, $firstId, $this->testTenantId, $channel)
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    private function requireTable(string $table): void
    {
        if (! Schema::hasTable($table)) {
            $this->markTestSkipped("{$table} table not present.");
        }
    }

    private function requireAgentTables(): void
    {
        foreach (['agent_runs', 'agent_proposals', 'caring_support_relationships'] as $table) {
            $this->requireTable($table);
        }
    }

    private function agentRun(): int
    {
        return (int) DB::table('agent_runs')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'agent_type' => 'tandem_matching',
            'status' => 'running',
            'triggered_by' => 'manual',
            'proposals_generated' => 1,
            'proposals_applied' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @param array<string,mixed> $payload */
    private function agentProposal(int $runId, array $payload): int
    {
        return (int) DB::table('agent_proposals')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'run_id' => $runId,
            'proposal_type' => 'create_tandem',
            'proposal_data' => json_encode($payload),
            'status' => 'pending_review',
            'confidence_score' => 0.9,
            'subject_user_id' => $payload['supporter_id'],
            'target_user_id' => $payload['recipient_id'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
