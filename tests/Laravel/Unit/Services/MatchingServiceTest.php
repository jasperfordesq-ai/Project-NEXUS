<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\MatchingService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

class MatchingServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // These tests fake the database; the safeguarding match-approval gate
        // is exercised for real in Feature/Matching/MatchApprovalGateTest.
        $this->app->instance(\App\Services\Matching\MatchApprovalGate::class, new class extends \App\Services\Matching\MatchApprovalGate {
            public function membersNeedingApproval(array $userIds, int $tenantId): array
            {
                return [];
            }
        });
    }

    public function test_getSuggestionsForUser_returns_results(): void
    {
        DB::shouldReceive('select')->once()->andReturn([
            (object) ['id' => 2, 'first_name' => 'Alice', 'last_name' => 'S', 'avatar_url' => null, 'location' => 'Dublin', 'skills' => 'cooking'],
        ]);
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')->twice()->andReturn($this->allowed());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $result = MatchingService::getSuggestionsForUser(1, 5);
        $this->assertCount(1, $result);
    }

    public function test_getSuggestionsForUser_excludes_candidate_when_either_direction_is_restricted(): void
    {
        DB::shouldReceive('select')->once()->andReturn([
            (object) ['id' => 2, 'first_name' => 'Protected', 'last_name' => 'Member', 'avatar_url' => null, 'location' => null, 'skills' => null],
        ]);
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')
            ->twice()
            ->andReturn($this->allowed(), $this->denied());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $this->assertSame([], MatchingService::getSuggestionsForUser(1, 5));
    }

    public function test_getSuggestionsForUser_handles_error(): void
    {
        DB::shouldReceive('select')->andThrow(new \Exception('Error'));

        $result = MatchingService::getSuggestionsForUser(1);
        $this->assertSame([], $result);
    }

    public function test_getHotMatches_delegates(): void
    {
        DB::shouldReceive('select')->andReturn([]);

        $result = MatchingService::getHotMatches(1);
        $this->assertSame([], $result);
    }

    public function test_getMutualMatches_returns_empty(): void
    {
        $this->assertSame([], MatchingService::getMutualMatches(1));
    }

    public function test_getMatchesByType_returns_structure(): void
    {
        DB::shouldReceive('select')->andReturn([]);

        $result = MatchingService::getMatchesByType(1);

        $this->assertArrayHasKey('hot', $result);
        $this->assertArrayHasKey('good', $result);
        $this->assertArrayHasKey('mutual', $result);
        $this->assertArrayHasKey('all', $result);
    }

    private function allowed(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
        );
    }

    private function denied(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::DENY,
            code: 'VETTING_REQUIRED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
        );
    }
}
