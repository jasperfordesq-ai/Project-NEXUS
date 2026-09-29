<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E062;

use App\Models\User;
use App\Services\Identity\RegistrationPolicyService;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-277 (E-062) — a broker/coordinator is deliberately not an admin
 * (AdminTier), yet approve, bulk-approve and reactivate all admitted a member
 * that identity verification was holding. Releasing an account from an
 * identity-verification hold is now an admin-tier decision. A broker still
 * clears the ordinary approval queue and lifts ordinary suspensions.
 */
class F277BrokerCannotReleaseVerificationHoldTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
    }

    private function setMode(string $mode): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.registration_mode'],
            ['setting_value' => 'open', 'setting_type' => 'string', 'updated_at' => now()]
        );
        RegistrationPolicyService::upsertPolicy($this->testTenantId, [
            'registration_mode' => $mode,
            'verification_level' => in_array($mode, ['verified_identity', 'government_id'], true) ? 'document_only' : 'none',
            'post_verification' => 'admin_approval',
            'fallback_mode' => 'none',
            'require_email_verify' => false,
        ]);
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        $this->assertSame(
            $mode,
            RegistrationPolicyService::getEffectivePolicy($this->testTenantId)['registration_mode'],
            'precondition: community registration mode'
        );
    }

    private function pendingMember(string $verificationStatus = 'none'): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => 'pending',
            'is_approved' => 0,
            'verification_status' => $verificationStatus,
            'email_verified_at' => now(),
        ]);
    }

    private function broker(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'broker', 'status' => 'active', 'is_approved' => 1,
        ]);
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin', 'status' => 'active', 'is_approved' => 1,
        ]);
    }

    /** @return array<string,mixed> */
    private function row(int $id): array
    {
        return (array) DB::table('users')->where('id', $id)->first(['status', 'is_approved', 'verification_status']);
    }

    private function assertStillHeld(int $id): void
    {
        $row = $this->row($id);
        $this->assertSame('pending', (string) $row['status'], 'account must stay pending');
        $this->assertSame(0, (int) $row['is_approved'], 'account must stay unapproved');
    }

    public function test_broker_cannot_approve_a_member_held_in_a_government_id_community(): void
    {
        $this->setMode('government_id');
        $held = $this->pendingMember();

        Sanctum::actingAs($this->broker());
        $res = $this->apiPost("/v2/admin/users/{$held->id}/approve");

        $res->assertStatus(403);
        $res->assertJsonPath('errors.0.code', 'AUTH_INSUFFICIENT_PERMISSIONS');
        $this->assertStillHeld((int) $held->id);
    }

    public function test_control_admin_can_still_approve_the_held_member(): void
    {
        $this->setMode('government_id');
        $held = $this->pendingMember();

        Sanctum::actingAs($this->admin());
        $this->apiPost("/v2/admin/users/{$held->id}/approve")->assertStatus(200);

        $row = $this->row((int) $held->id);
        $this->assertSame('active', (string) $row['status']);
        $this->assertSame(1, (int) $row['is_approved']);
    }

    public function test_broker_cannot_approve_a_member_whose_verification_is_pending_in_any_mode(): void
    {
        $this->setMode('open_with_approval');
        $held = $this->pendingMember('pending');

        Sanctum::actingAs($this->broker());
        $this->apiPost("/v2/admin/users/{$held->id}/approve")->assertStatus(403);
        $this->assertStillHeld((int) $held->id);
    }

    public function test_control_broker_still_approves_an_ordinary_pending_member(): void
    {
        $this->setMode('open_with_approval');
        $ordinary = $this->pendingMember();

        Sanctum::actingAs($this->broker());
        $this->apiPost("/v2/admin/users/{$ordinary->id}/approve")->assertStatus(200);

        $row = $this->row((int) $ordinary->id);
        $this->assertSame('active', (string) $row['status']);
        $this->assertSame(1, (int) $row['is_approved']);
    }

    public function test_broker_bulk_approve_skips_held_members_and_approves_ordinary_ones(): void
    {
        $this->setMode('open_with_approval');
        $held = $this->pendingMember('pending');
        $ordinary = $this->pendingMember();

        Sanctum::actingAs($this->broker());
        $res = $this->apiPost('/v2/admin/users/bulk-approve', [
            'user_ids' => [(int) $held->id, (int) $ordinary->id],
        ]);
        $res->assertStatus(200);

        $this->assertSame(1, (int) $res->json('data.success'));
        $this->assertSame(1, (int) $res->json('data.failed'));
        $this->assertContains((int) $held->id, array_map('intval', (array) $res->json('data.skipped_ids')));
        $this->assertStillHeld((int) $held->id);
        $this->assertSame(1, (int) $this->row((int) $ordinary->id)['is_approved']);
    }

    public function test_broker_bulk_approve_skips_every_member_of_a_government_id_community(): void
    {
        $this->setMode('government_id');
        $held = $this->pendingMember();

        Sanctum::actingAs($this->broker());
        $res = $this->apiPost('/v2/admin/users/bulk-approve', ['user_ids' => [(int) $held->id]]);
        $res->assertStatus(200);

        $this->assertSame(0, (int) $res->json('data.success'));
        $this->assertStillHeld((int) $held->id);
    }

    public function test_broker_cannot_release_a_held_member_through_reactivate(): void
    {
        $this->setMode('government_id');
        $held = $this->pendingMember();

        Sanctum::actingAs($this->broker());
        $this->apiPost("/v2/admin/users/{$held->id}/reactivate")->assertStatus(403);
        $this->assertStillHeld((int) $held->id);
    }

    public function test_control_broker_still_lifts_an_ordinary_suspension_in_a_government_id_community(): void
    {
        $this->setMode('government_id');
        // Admitted before the community required identity documents.
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member', 'status' => 'suspended', 'is_approved' => 1, 'verification_status' => 'none',
        ]);

        Sanctum::actingAs($this->broker());
        $this->apiPost("/v2/admin/users/{$member->id}/reactivate")->assertStatus(200);
        $this->assertSame('active', (string) $this->row((int) $member->id)['status']);
    }
}
