<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-068 (E-027): a member must not be able to undo an administrator's
 * revocation of the "Peer Endorsed" verification badge.
 *
 * The endorse endpoint called the ADMIN grant method whenever the count was
 * 3 or more. That method re-grants a revoked badge, and it recorded the
 * endorsing member as the verifier.
 */
class PeerEndorsedBadgeRevocationTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function endorse(User $endorser, User $target): \Illuminate\Testing\TestResponse
    {
        Sanctum::actingAs($endorser, ['*']);
        return $this->apiPost("/v2/members/{$target->id}/peer-endorse");
    }

    private function badge(User $target): ?object
    {
        return DB::table('member_verification_badges')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $target->id)
            ->where('badge_type', 'peer_endorsed')
            ->first();
    }

    public function test_endorsement_does_not_regrant_a_revoked_badge(): void
    {
        $target = $this->member();
        $endorsers = [$this->member(), $this->member(), $this->member()];
        foreach ($endorsers as $endorser) {
            $this->endorse($endorser, $target)->assertStatus(200);
        }
        $this->assertNotNull($this->badge($target), 'Control: three endorsements grant the badge');

        // An administrator revokes it; the endorsement rows stay behind.
        DB::table('member_verification_badges')
            ->where('id', $this->badge($target)->id)
            ->update(['revoked_at' => now()]);

        // One of the original endorsers endorses again, and a fourth member joins in.
        $this->endorse($endorsers[0], $target)->assertStatus(200)->assertJsonPath('data.badge_granted', false);
        $this->endorse($this->member(), $target)->assertStatus(200)->assertJsonPath('data.badge_granted', false);

        $this->assertNotNull($this->badge($target)->revoked_at, 'A revoked badge must stay revoked');
    }

    public function test_auto_granted_badge_is_not_attributed_to_a_member(): void
    {
        $target = $this->member();
        $endorsers = [$this->member(), $this->member(), $this->member()];
        foreach ($endorsers as $endorser) {
            $this->endorse($endorser, $target)->assertStatus(200);
        }

        $badge = $this->badge($target);
        $this->assertNotNull($badge);
        $this->assertNull($badge->revoked_at);
        // verified_by is documented as "Admin user_id who granted"; an automatic
        // grant has no administrator and must not name the last endorser.
        $this->assertNull($badge->verified_by);
    }
}
