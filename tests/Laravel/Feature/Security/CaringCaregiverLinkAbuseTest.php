<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * F-130 — a caregiver-link request emails/pushes/notifies the target, so it is
 * a contact channel: it must respect blocks and the safeguarding contact
 * policy, must not be re-sendable straight after the target declined, and the
 * free-text note must be bounded.
 */
class CaringCaregiverLinkAbuseTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        if (! Schema::hasTable('caring_caregiver_links')) {
            $this->markTestSkipped('caring_caregiver_links table missing');
        }

        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    private function request(User $target, array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/v2/caring-community/caregiver/links', array_merge([
            'cared_for_id' => $target->id,
            'relationship_type' => 'friend',
            'start_date' => now()->toDateString(),
        ], $extra));
    }

    private function linkCount(User $caregiver, User $target): int
    {
        return DB::table('caring_caregiver_links')
            ->where('tenant_id', $this->testTenantId)
            ->where('caregiver_id', $caregiver->id)
            ->where('cared_for_id', $target->id)
            ->count();
    }

    private function notificationCount(User $target): int
    {
        return DB::table('notifications')
            ->where('user_id', $target->id)
            ->where('type', 'caring_caregiver_link_requested')
            ->count();
    }

    public function test_request_is_refused_when_either_member_blocked_the_other(): void
    {
        $caregiver = $this->member();
        $target = $this->member();
        $other = $this->member();

        BlockUserService::block($target->id, $caregiver->id);
        Sanctum::actingAs($caregiver);
        $blocked = $this->request($target);
        $this->assertContains($blocked->status(), [403, 409]);
        $this->assertSame(0, $this->linkCount($caregiver, $target));
        $this->assertSame(0, $this->notificationCount($target));

        // Reverse direction: the requester blocked the target.
        BlockUserService::block($caregiver->id, $other->id);
        $reverse = $this->request($other);
        $this->assertContains($reverse->status(), [403, 409]);
        $this->assertSame(0, $this->linkCount($caregiver, $other));

        // Control: an unblocked pair still works.
        $fine = $this->member();
        $this->request($fine)->assertStatus(202);
        $this->assertSame(1, $this->linkCount($caregiver, $fine));
    }

    public function test_request_is_refused_when_safeguarding_contact_policy_denies(): void
    {
        $caregiver = $this->member();
        $target = $this->member();

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->with($caregiver->id, $target->id, $this->testTenantId, Mockery::type('string'))
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        Sanctum::actingAs($caregiver);
        $response = $this->request($target);
        $response->assertStatus(403);
        $this->assertSame(0, $this->linkCount($caregiver, $target));
        $this->assertSame(0, $this->notificationCount($target));
    }

    public function test_request_cannot_be_resent_within_cooldown_after_rejection_or_withdrawal(): void
    {
        $caregiver = $this->member();
        $target = $this->member();
        Sanctum::actingAs($caregiver);

        $first = $this->request($target);
        $first->assertStatus(202);

        // Target declines.
        DB::table('caring_caregiver_links')->where('id', (int) $first->json('data.id'))->update([
            'status' => 'rejected',
            'rejected_at' => now(),
            'rejected_by' => $target->id,
            'rejection_reason' => 'No thank you.',
        ]);

        $again = $this->request($target);
        $again->assertStatus(409);
        $this->assertSame(1, $this->linkCount($caregiver, $target));

        // Withdraw-and-resend loop on a never-approved request is also held back.
        $second = $this->member();
        $pending = $this->request($second);
        $pending->assertStatus(202);
        $this->apiDelete('/v2/caring-community/caregiver/links/' . $pending->json('data.id'))->assertStatus(204);
        $this->request($second)->assertStatus(409);

        // Control: after the cooldown window the request can be made again.
        DB::table('caring_caregiver_links')->where('id', (int) $first->json('data.id'))->update([
            'rejected_at' => now()->subDays(8),
            'updated_at' => now()->subDays(8),
        ]);
        $third = $this->request($target);
        $third->assertStatus(202);

        // The recipient can always decline again (one rejected row per pair is
        // allowed by the unique key, so the older rejection is replaced).
        Sanctum::actingAs($target);
        $this->apiPost('/v2/caring-community/caregiver/incoming-links/' . $third->json('data.id') . '/reject', [
            'reason' => 'Still no, thank you.',
        ])->assertStatus(200);
        $this->assertDatabaseHas('caring_caregiver_links', [
            'id' => (int) $third->json('data.id'),
            'status' => 'rejected',
        ]);
    }

    public function test_notes_are_length_capped(): void
    {
        $caregiver = $this->member();
        $target = $this->member();
        Sanctum::actingAs($caregiver);

        $this->request($target, ['notes' => str_repeat('x', 1001)])->assertStatus(422);
        $this->assertSame(0, $this->linkCount($caregiver, $target));

        // Control: a note at the limit is accepted.
        $ok = $this->request($target, ['notes' => str_repeat('y', 1000)]);
        $ok->assertStatus(202);
    }
}
