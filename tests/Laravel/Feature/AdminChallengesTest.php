<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Core\TenantContext;
use App\Models\Challenge;
use App\Models\User;
use App\Services\ChallengeService;
use App\Services\EngagementService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Challenges admin CRUD + the engagement wiring that makes challenges real.
 *
 * Challenges were member-visible (view + claim, both frontends) long before an
 * admin could create one anywhere except the database console. Two properties
 * matter beyond plain CRUD:
 *
 *  - action_type is restricted to ChallengeService::SUPPORTED_ACTION_TYPES.
 *    Only actions wired through EngagementService ever advance progress, so
 *    accepting any other value creates a challenge stuck at zero forever — a
 *    trap that looks like a working feature.
 *  - attend_event now flows through EngagementService, so an admin-created
 *    "attend events" challenge actually progresses on a going RSVP. Before,
 *    the RSVP awarded XP directly and no challenge ever moved.
 */
class AdminChallengesTest extends TestCase
{
    use DatabaseTransactions;

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function admin(): User
    {
        return $this->member(['role' => 'admin']);
    }

    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'title' => 'Visit five partner venues',
            'description' => 'Use your pass at five venues.',
            'challenge_type' => 'monthly',
            'action_type' => 'venue_visit',
            'target_count' => 5,
            'xp_reward' => 100,
            'start_date' => now()->toDateString(),
            'end_date' => now()->addMonth()->toDateString(),
        ], $overrides);
    }

    // ── Authorization ───────────────────────────────────────────────────

    public function test_challenge_crud_requires_an_admin(): void
    {
        $this->actingAs($this->member());

        $this->apiGet('/v2/admin/gamification/challenges')->assertStatus(403);
        $this->apiPost('/v2/admin/gamification/challenges', $this->validPayload())->assertStatus(403);
    }

    // ── Create + list ───────────────────────────────────────────────────

    public function test_an_admin_can_create_and_list_a_challenge(): void
    {
        $this->actingAs($this->admin());

        $create = $this->apiPost('/v2/admin/gamification/challenges', $this->validPayload());
        $create->assertStatus(201);
        $id = (int) $create->json('data.id');
        $this->assertGreaterThan(0, $id);

        $list = $this->apiGet('/v2/admin/gamification/challenges');
        $list->assertStatus(200);

        $ids = array_column($list->json('data.challenges'), 'id');
        $this->assertContains($id, $ids);

        // The form's vocabulary comes from the server, so the UI can never
        // drift from what the service actually validates.
        $this->assertSame(
            ChallengeService::SUPPORTED_ACTION_TYPES,
            $list->json('data.supported_action_types'),
        );
    }

    public function test_unsupported_action_types_are_rejected(): void
    {
        $this->actingAs($this->admin());

        // A real XP action that is NOT wired through EngagementService — the
        // exact stuck-at-zero trap the allowlist exists to prevent.
        $response = $this->apiPost(
            '/v2/admin/gamification/challenges',
            $this->validPayload(['action_type' => 'create_listing']),
        );

        $response->assertStatus(422);
        $this->assertSame(0, DB::table('challenges')
            ->where('tenant_id', $this->testTenantId)
            ->where('title', 'Visit five partner venues')
            ->count());
    }

    public function test_the_date_window_must_be_ordered(): void
    {
        $this->actingAs($this->admin());

        $this->apiPost('/v2/admin/gamification/challenges', $this->validPayload([
            'start_date' => now()->addMonth()->toDateString(),
            'end_date' => now()->toDateString(),
        ]))->assertStatus(422);
    }

    // ── Update + delete ─────────────────────────────────────────────────

    public function test_an_admin_can_update_and_deactivate_a_challenge(): void
    {
        $this->actingAs($this->admin());

        $id = (int) $this->apiPost('/v2/admin/gamification/challenges', $this->validPayload())->json('data.id');

        $update = $this->apiPut("/v2/admin/gamification/challenges/{$id}", [
            'title' => 'Visit three partner venues',
            'target_count' => 3,
            'is_active' => false,
        ]);
        $update->assertStatus(200);

        $row = DB::table('challenges')->where('id', $id)->first();
        $this->assertSame('Visit three partner venues', $row->title);
        $this->assertSame(3, (int) $row->target_count);
        $this->assertSame(0, (int) $row->is_active);
    }

    public function test_deleting_a_challenge_cascades_member_progress(): void
    {
        $this->actingAs($this->admin());

        $id = (int) $this->apiPost('/v2/admin/gamification/challenges', $this->validPayload())->json('data.id');

        $member = $this->member();
        DB::table('user_challenge_progress')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'challenge_id' => $id,
            'current_count' => 2,
        ]);

        $this->apiDelete("/v2/admin/gamification/challenges/{$id}")->assertStatus(200);

        $this->assertSame(0, DB::table('challenges')->where('id', $id)->count());
        // ON DELETE CASCADE — the admin UI warns about exactly this.
        $this->assertSame(0, DB::table('user_challenge_progress')->where('challenge_id', $id)->count());
    }

    public function test_challenges_are_tenant_isolated(): void
    {
        $this->actingAs($this->admin());

        $foreign = Challenge::factory()->forTenant($this->testTenantId + 1)->create();

        $this->apiPut("/v2/admin/gamification/challenges/{$foreign->id}", ['title' => 'Hijacked'])
            ->assertStatus(404);
        $this->apiDelete("/v2/admin/gamification/challenges/{$foreign->id}")
            ->assertStatus(404);

        $this->assertSame(1, Challenge::withoutGlobalScopes()->whereKey($foreign->id)->count());
    }

    // ── Engagement wiring ───────────────────────────────────────────────

    public function test_attend_event_engagement_advances_an_admin_created_challenge(): void
    {
        TenantContext::setById($this->testTenantId);

        $challengeId = (int) ChallengeService::create($this->testTenantId, [
            'title' => 'Attend three events',
            'action_type' => 'attend_event',
            'challenge_type' => 'monthly',
            'target_count' => 3,
            'start_date' => now()->subDay()->toDateString(),
            'end_date' => now()->addMonth()->toDateString(),
        ]);

        $member = $this->member();

        // The same call the RSVP controllers now make (React + accessible).
        EngagementService::record((int) $member->id, 'attend_event', 'event:123');

        $progress = DB::table('user_challenge_progress')
            ->where('challenge_id', $challengeId)
            ->where('user_id', $member->id)
            ->first();

        $this->assertNotNull($progress, 'attend_event must advance challenge progress via EngagementService.');
        $this->assertSame(1, (int) $progress->current_count);

        // XP flowed too — same action, same junction.
        $this->assertSame(1, DB::table('user_xp_log')
            ->where('user_id', $member->id)
            ->where('action', 'attend_event')
            ->count());
    }
}
