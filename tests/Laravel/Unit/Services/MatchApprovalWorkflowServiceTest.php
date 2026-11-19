<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\MatchApprovalWorkflowService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * MatchApprovalWorkflowService unit tests.
 *
 * These tests mock the DB + Log facades and exercise the service's static
 * methods. The service grew substantially since the original tests were
 * written — submit now runs a safeguarding-restriction check and a broker
 * notification fan-out, and approve/reject now read the row before updating
 * and dispatch a notification. The mocks below cover the full current happy
 * path: any unmocked DB terminal would fall through to the catch block and
 * trip Log::error, so the stubs deliberately satisfy every facade call the
 * current code makes. NotificationDispatcher fan-out is suppressed by
 * returning an empty broker collection from the users `get()` query.
 *
 * Vetting gating (SafeguardingTriggerService) uses Eloquent, which bypasses
 * the DB facade mock and reads the clean nexus_ci DB directly, returning no
 * required vetting types — so that gate is a no-op here.
 */
class MatchApprovalWorkflowServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->bindPolicy(SafeguardingInteractionDecision::ALLOW);
        Cache::shouldReceive('remember')->zeroOrMoreTimes()->andReturn([
            'requires_vetted_interaction' => false,
            'requires_broker_approval' => false,
            'restricts_messaging' => false,
            'restricts_matching' => false,
            'notify_admin_on_selection' => false,
        ]);
    }

    private function bindPolicy(string $status): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')->zeroOrMoreTimes()->andReturn(
            new SafeguardingInteractionDecision(
                status: $status,
                code: $status === SafeguardingInteractionDecision::ALLOW
                    ? 'SAFEGUARDING_ALLOWED'
                    : ($status === SafeguardingInteractionDecision::UNAVAILABLE
                        ? 'SAFEGUARDING_POLICY_UNAVAILABLE'
                        : 'VETTING_REQUIRED'),
                recipientTenantId: 1,
                purposeCode: 'safeguarded_member_contact',
                scopeType: 'tenant',
                scopeIdentifier: '',
            )
        );
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    public function test_submitForApproval_returns_id_on_success(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereIn')->andReturnSelf();
        DB::shouldReceive('whereNull')->andReturnSelf();
        DB::shouldReceive('orWhere')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('raw')->andReturn('');
        // Listing owner lookup
        DB::shouldReceive('first')->andReturn((object) ['user_id' => 20]);
        // Safeguarding restriction check
        DB::shouldReceive('exists')->andReturn(false);
        // Insert the pending approval
        DB::shouldReceive('insertGetId')->once()->andReturn(42);
        // Name lookups for notifications
        DB::shouldReceive('value')->andReturn('Listing Title');
        // Broker fan-out — empty so dispatch loop is skipped
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = MatchApprovalWorkflowService::submitForApproval(10, 1, ['match_score' => 80]);
        $this->assertSame(42, $result);
    }

    public function test_submitForApproval_returns_null_for_self_match(): void
    {
        DB::shouldReceive('table')->with('listings')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn((object) ['user_id' => 10]);

        $result = MatchApprovalWorkflowService::submitForApproval(10, 1, []);
        $this->assertNull($result);
    }

    public function test_submitForApproval_writes_nothing_when_contact_policy_denies(): void
    {
        $this->bindPolicy(SafeguardingInteractionDecision::DENY);
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereIn')->andReturnSelf();
        DB::shouldReceive('whereNull')->andReturnSelf();
        DB::shouldReceive('orWhere')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn((object) ['user_id' => 20]);
        DB::shouldReceive('exists')->andReturn(false);
        DB::shouldReceive('insertGetId')->never();
        Log::shouldReceive('info')->once();

        $this->assertNull(MatchApprovalWorkflowService::submitForApproval(10, 1, []));
    }

    public function test_submitForApproval_returns_null_when_listing_not_found(): void
    {
        DB::shouldReceive('table')->with('listings')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        Log::shouldReceive('warning')->once();

        $result = MatchApprovalWorkflowService::submitForApproval(10, 999, []);
        $this->assertNull($result);
    }

    public function test_submitForApproval_handles_duplicate(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereIn')->andReturnSelf();
        DB::shouldReceive('whereNull')->andReturnSelf();
        DB::shouldReceive('orWhere')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn((object) ['user_id' => 20]);
        DB::shouldReceive('exists')->andReturn(false);
        DB::shouldReceive('insertGetId')->andThrow(new \Exception('Duplicate entry'));

        Log::shouldReceive('info')->once();

        $result = MatchApprovalWorkflowService::submitForApproval(10, 1, []);
        $this->assertNull($result);
    }

    public function test_approveMatch_returns_true_on_success(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        // The listing is still live and both members still active
        DB::shouldReceive('selectOne')->andReturn((object) ['ok' => 1]);
        // Row lookup before update
        DB::shouldReceive('first')->andReturn((object) [
            'id' => 1, 'user_id' => 20, 'listing_owner_id' => 30, 'listing_id' => 5, 'match_score' => 80,
            'status' => 'pending',
        ]);
        DB::shouldReceive('update')->andReturn(1);
        // Listing title lookup for the approval notification
        DB::shouldReceive('value')->andReturn('Listing Title');

        Log::shouldReceive('info')->once();
        // Notification dispatch runs real code paths; any failure there is
        // swallowed by the service's inner try/catch as a warning and must
        // NOT fail this unit test of the approval state transition.
        Log::shouldReceive('warning')->zeroOrMoreTimes();

        $this->assertTrue(MatchApprovalWorkflowService::approveMatch(1, 5));
    }

    public function test_approveMatch_returns_false_when_not_found(): void
    {
        DB::shouldReceive('table')->with('match_approvals')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        $this->assertFalse(MatchApprovalWorkflowService::approveMatch(999, 5));
    }

    public function test_approveMatchOutcome_says_not_found_when_there_is_no_row(): void
    {
        DB::shouldReceive('table')->with('match_approvals')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);
        DB::shouldReceive('update')->never();

        $this->assertSame(
            MatchApprovalWorkflowService::OUTCOME_NOT_FOUND,
            MatchApprovalWorkflowService::approveMatchOutcome(999, 5)
        );
    }

    public function test_outcome_says_already_reviewed_for_a_decided_row(): void
    {
        DB::shouldReceive('table')->with('match_approvals')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        // The listing is still live and both members still active
        DB::shouldReceive('selectOne')->andReturn((object) ['ok' => 1]);
        DB::shouldReceive('first')->andReturn((object) [
            'id' => 1, 'user_id' => 20, 'listing_owner_id' => 30, 'listing_id' => 5, 'match_score' => 80,
            'status' => 'rejected',
        ]);
        DB::shouldReceive('update')->never();

        $this->assertSame(
            MatchApprovalWorkflowService::OUTCOME_ALREADY_REVIEWED,
            MatchApprovalWorkflowService::approveMatchOutcome(1, 5)
        );
        $this->assertSame(
            MatchApprovalWorkflowService::OUTCOME_ALREADY_REVIEWED,
            MatchApprovalWorkflowService::rejectMatchOutcome(1, 5, 'Too late')
        );
    }

    public function test_approveMatchOutcome_says_contact_blocked_and_does_not_update(): void
    {
        $this->bindPolicy(SafeguardingInteractionDecision::DENY);
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        // The listing is still live and both members still active
        DB::shouldReceive('selectOne')->andReturn((object) ['ok' => 1]);
        DB::shouldReceive('first')->andReturn((object) [
            'id' => 1, 'user_id' => 20, 'listing_owner_id' => 30, 'listing_id' => 5, 'match_score' => 80,
            'status' => 'pending',
        ]);
        DB::shouldReceive('update')->never();
        Log::shouldReceive('info')->once();

        $this->assertSame(
            MatchApprovalWorkflowService::OUTCOME_CONTACT_BLOCKED,
            MatchApprovalWorkflowService::approveMatchOutcome(1, 5)
        );
    }

    public function test_approveMatchOutcome_says_failed_when_the_write_throws(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        // The listing is still live and both members still active
        DB::shouldReceive('selectOne')->andReturn((object) ['ok' => 1]);
        DB::shouldReceive('first')->andReturn((object) [
            'id' => 1, 'user_id' => 20, 'listing_owner_id' => 30, 'listing_id' => 5, 'match_score' => 80,
            'status' => 'pending',
        ]);
        DB::shouldReceive('update')->andThrow(new \RuntimeException('deadlock'));
        Log::shouldReceive('error')->once();

        $this->assertSame(
            MatchApprovalWorkflowService::OUTCOME_FAILED,
            MatchApprovalWorkflowService::approveMatchOutcome(1, 5)
        );
    }

    public function test_approveMatch_does_not_update_when_policy_is_unavailable(): void
    {
        $this->bindPolicy(SafeguardingInteractionDecision::UNAVAILABLE);
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        // The listing is still live and both members still active
        DB::shouldReceive('selectOne')->andReturn((object) ['ok' => 1]);
        DB::shouldReceive('first')->andReturn((object) [
            'id' => 1,
            'user_id' => 20,
            'listing_owner_id' => 30,
            'listing_id' => 5,
            'match_score' => 80,
            'status' => 'pending',
        ]);
        DB::shouldReceive('update')->never();
        Log::shouldReceive('info')->once();

        $this->assertFalse(MatchApprovalWorkflowService::approveMatch(1, 5));
    }

    public function test_rejectMatch_returns_true_on_success(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        // The listing is still live and both members still active
        DB::shouldReceive('selectOne')->andReturn((object) ['ok' => 1]);
        DB::shouldReceive('first')->andReturn((object) [
            'id' => 1, 'user_id' => 20, 'listing_id' => 5, 'match_score' => 80,
            'status' => 'pending',
        ]);
        DB::shouldReceive('update')->andReturn(1);
        DB::shouldReceive('value')->andReturn('Listing Title');

        Log::shouldReceive('info')->once();
        Log::shouldReceive('warning')->zeroOrMoreTimes();

        $this->assertTrue(MatchApprovalWorkflowService::rejectMatch(1, 5, 'Not relevant'));
    }

    public function test_bulkApprove_empty_ids_returns_zero(): void
    {
        $this->assertSame(0, MatchApprovalWorkflowService::bulkApprove([], 5));
    }

    public function test_bulkApprove_returns_affected_count(): void
    {
        // Pending-rows lookup, then the bulk UPDATE
        DB::shouldReceive('select')->once()->andReturn([]);
        DB::shouldReceive('update')->once()->andReturn(3);
        Log::shouldReceive('info')->once();

        $result = MatchApprovalWorkflowService::bulkApprove([1, 2, 3], 5);
        $this->assertSame(3, $result);
    }

    public function test_bulkReject_empty_ids_returns_zero(): void
    {
        $this->assertSame(0, MatchApprovalWorkflowService::bulkReject([], 5));
    }

    public function test_getStatistics_returns_structure(): void
    {
        // Both select() calls (status counts + top reviewers) return empty;
        // the method only needs to assemble the result structure without error.
        DB::shouldReceive('select')->andReturn([]);
        DB::shouldReceive('selectOne')->andReturn((object) ['avg_hours' => 2.5]);

        $result = MatchApprovalWorkflowService::getStatistics(30);

        $this->assertArrayHasKey('total', $result);
        $this->assertArrayHasKey('pending', $result);
        $this->assertArrayHasKey('approval_rate', $result);
        $this->assertArrayHasKey('avg_review_hours', $result);
    }

    public function test_getStatistics_counts_every_status_all_time(): void
    {
        $statusSql = null;
        $statusBindings = null;
        DB::shouldReceive('select')->andReturnUsing(function (string $sql, array $bindings = []) use (&$statusSql, &$statusBindings) {
            if (str_contains($sql, 'GROUP BY status')) {
                $statusSql = $sql;
                $statusBindings = $bindings;

                return [
                    (object) ['status' => 'pending', 'cnt' => 2],
                    (object) ['status' => 'approved', 'cnt' => 30],
                    (object) ['status' => 'rejected', 'cnt' => 10],
                ];
            }

            return [];
        });
        DB::shouldReceive('selectOne')->andReturn((object) ['avg_hours' => 2.5]);

        $result = MatchApprovalWorkflowService::getStatistics(30);

        // The tab counts must describe the same rows the tabs list, which are
        // not limited to the last 30 days.
        $this->assertNotNull($statusSql);
        $this->assertStringNotContainsString('submitted_at', $statusSql);
        $this->assertCount(1, $statusBindings, 'Only the tenant id is bound: no time window');
        $this->assertSame(2, $result['pending_count']);
        $this->assertSame(30, $result['approved_count']);
        $this->assertSame(10, $result['rejected_count']);
        $this->assertSame(42, $result['total']);
        $this->assertSame(75.0, $result['approval_rate']);
    }

    public function test_getStatistics_handles_error(): void
    {
        DB::shouldReceive('select')->andThrow(new \Exception('Error'));
        Log::shouldReceive('error')->once();

        $result = MatchApprovalWorkflowService::getStatistics();
        $this->assertSame(0, $result['total']);
    }
}
