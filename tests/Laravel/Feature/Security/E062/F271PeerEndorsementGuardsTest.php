<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E062;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * F-271 (E-062) — POST /v2/members/{id}/peer-endorse is a second endorsement
 * path (it feeds the auto-granted `peer_endorsed` badge) and wrote a bare
 * INSERT IGNORE with none of the guards the canonical skill endorsement
 * (EndorsementService::endorse) applies:
 *
 *  - a block in either direction must stop it (F-070), with the same
 *    direction-neutral 403 BLOCKED;
 *  - the safeguarding contact policy must be consulted;
 *  - a connections-only profile is 404 PROFILE_PRIVATE to a stranger on the
 *    profile route, so endorsing it must be refused the same way (F-246).
 *
 * Controls: an unblocked member of a public profile, and a connected member of
 * a connections-only profile, may still endorse.
 */
class F271PeerEndorsementGuardsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    /** @return array<string, array{string}> */
    public static function blockDirections(): array
    {
        return [
            'the target blocked the endorser' => ['target_blocked_endorser'],
            'the endorser blocked the target' => ['endorser_blocked_target'],
        ];
    }

    #[DataProvider('blockDirections')]
    public function test_a_block_in_either_direction_stops_a_peer_endorsement(string $direction): void
    {
        $target = $this->member();
        $endorser = $this->member();

        TenantContext::setById($this->testTenantId);
        if ($direction === 'target_blocked_endorser') {
            BlockUserService::block((int) $target->id, (int) $endorser->id);
        } else {
            BlockUserService::block((int) $endorser->id, (int) $target->id);
        }

        $this->actAs($endorser);
        $response = $this->apiPost("/v2/members/{$target->id}/peer-endorse");

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'BLOCKED');
        $response->assertJsonPath('errors.0.message', __('safeguarding.errors.blocked_interaction'));
        $this->assertNull($response->json('data.endorsement_count'), 'the blocked member is not told the running count');
        $this->assertSame(0, $this->endorsementCount($endorser, $target));
    }

    public function test_the_safeguarding_contact_policy_is_consulted_and_a_denial_writes_nothing(): void
    {
        $target = $this->member();
        $endorser = $this->member();

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with((int) $endorser->id, (int) $target->id, $this->testTenantId, 'peer_endorsement')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $this->actAs($endorser);
        $response = $this->apiPost("/v2/members/{$target->id}/peer-endorse");

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertSame(0, $this->endorsementCount($endorser, $target));
    }

    public function test_a_stranger_cannot_endorse_a_connections_only_profile(): void
    {
        $target = $this->member(['privacy_profile' => 'connections']);
        $stranger = $this->member();

        $this->actAs($stranger);
        $response = $this->apiPost("/v2/members/{$target->id}/peer-endorse");

        $response->assertStatus(404);
        $response->assertJsonPath('errors.0.code', 'PROFILE_PRIVATE');
        $this->assertSame(0, $this->endorsementCount($stranger, $target));
    }

    public function test_control_an_unblocked_member_may_still_endorse_a_public_profile(): void
    {
        $target = $this->member();
        $endorser = $this->member();

        $this->actAs($endorser);
        $response = $this->apiPost("/v2/members/{$target->id}/peer-endorse");

        $response->assertOk();
        $response->assertJsonPath('data.endorsement_count', 1);
        $this->assertSame(1, $this->endorsementCount($endorser, $target));
    }

    public function test_control_a_connected_member_may_endorse_a_connections_only_profile(): void
    {
        $target = $this->member(['privacy_profile' => 'connections']);
        $friend = $this->member();
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => (int) $friend->id,
            'receiver_id' => (int) $target->id,
            'status' => 'accepted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actAs($friend);
        $response = $this->apiPost("/v2/members/{$target->id}/peer-endorse");

        $response->assertOk();
        $this->assertSame(1, $this->endorsementCount($friend, $target));
    }

    private function endorsementCount(User $endorser, User $target): int
    {
        return (int) DB::table('peer_endorsements')
            ->where('tenant_id', $this->testTenantId)
            ->where('endorser_id', (int) $endorser->id)
            ->where('endorsed_id', (int) $target->id)
            ->count();
    }

    private function actAs(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user, ['*']);
    }

    /** @param array<string, mixed> $attrs */
    private function member(array $attrs = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attrs));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
