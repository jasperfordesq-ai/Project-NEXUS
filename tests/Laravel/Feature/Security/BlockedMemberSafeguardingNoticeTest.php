<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Events\SafeguardingCoordinationRequested;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * F-092 — a member with a block in either direction must not learn the other
 * member's safeguarding settings from the conversation page. Sending already
 * checks blocks before safeguarding; opening the conversation (and asking for
 * coordinator help) did not. The answer is the same as for a member with no
 * restriction, and nothing in it says a block exists.
 */
class BlockedMemberSafeguardingNoticeTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app->instance('tenant.id', $this->testTenantId);
        Event::fake([SafeguardingCoordinationRequested::class]);

        // The recipient's (confidential) safeguarding settings require vetting.
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')->andReturn(new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::DENY,
            code: 'VETTING_REQUIRED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'test-v1',
            requiredAttestationCodes: ['dbs_enhanced'],
            requiredAttestationLabels: ['Enhanced DBS'],
            canRequestCoordinator: true,
        ));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    /** @return array<string, array{string}> */
    public static function blockDirections(): array
    {
        return [
            'the protected member blocked the viewer' => ['target_blocked_actor'],
            'the viewer blocked the protected member' => ['actor_blocked_target'],
        ];
    }

    public function test_unblocked_member_still_sees_the_safeguarding_notice(): void
    {
        [$viewer, $protected] = [$this->member(), $this->member()];
        Sanctum::actingAs($viewer, ['*']);

        $this->apiGet("/v2/messages/{$protected->id}")
            ->assertOk()
            ->assertJsonPath('meta.conversation.safeguarding.code', 'VETTING_REQUIRED');
    }

    #[DataProvider('blockDirections')]
    public function test_blocked_pair_does_not_see_the_safeguarding_notice(string $direction): void
    {
        [$viewer, $protected] = [$this->member(), $this->member()];
        $this->applyBlock($direction, $viewer, $protected);
        Sanctum::actingAs($viewer, ['*']);

        $response = $this->apiGet("/v2/messages/{$protected->id}")->assertOk();

        $response->assertJsonPath('meta.conversation.safeguarding', null);
        $this->assertStringNotContainsString('dbs_enhanced', $response->getContent());
        $this->assertStringNotContainsString('Enhanced DBS', $response->getContent());
        $this->assertStringNotContainsString('BLOCKED', $response->getContent());
    }

    #[DataProvider('blockDirections')]
    public function test_blocked_pair_cannot_request_coordinator_help_or_learn_the_restriction(string $direction): void
    {
        [$viewer, $protected] = [$this->member(), $this->member()];
        $this->applyBlock($direction, $viewer, $protected);
        Sanctum::actingAs($viewer, ['*']);

        // Same answer as for a member whose contact is not restricted.
        $this->apiPost("/v2/messages/{$protected->id}/request-coordinator")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'SAFEGUARDING_NOT_RESTRICTED');
        Event::assertNotDispatched(SafeguardingCoordinationRequested::class);
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function applyBlock(string $direction, User $actor, User $target): void
    {
        [$blocker, $blocked] = $direction === 'target_blocked_actor' ? [$target, $actor] : [$actor, $target];
        DB::table('user_blocks')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $blocker->id,
            'blocked_user_id' => $blocked->id,
            'created_at' => now(),
        ]);
    }
}
