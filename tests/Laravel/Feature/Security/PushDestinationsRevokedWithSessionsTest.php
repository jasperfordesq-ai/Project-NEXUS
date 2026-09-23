<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-117 (E-027): ending a member's sessions must also stop pushes to their
 * devices.
 *
 * Device registrations (fcm_device_tokens, push_subscriptions) were removed
 * only by GDPR deletion, dead-token pruning or an explicit client unregister.
 * After "sign out everywhere", a password reset, or suspension, a lost or
 * stolen phone kept receiving the member's notification text.
 */
class PushDestinationsRevokedWithSessionsTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function registerDevices(User $user): void
    {
        DB::table('fcm_device_tokens')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'token' => 'ExponentPushToken[' . uniqid('f117', true) . ']',
            'platform' => 'android',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('push_subscriptions')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'endpoint' => 'https://push.example.test/' . uniqid('f117', true),
            'p256dh_key' => 'key',
            'auth_key' => 'auth',
            'created_at' => now(),
        ]);
    }

    private function deviceCount(User $user): int
    {
        return DB::table('fcm_device_tokens')->where('user_id', $user->id)->count()
            + DB::table('push_subscriptions')->where('user_id', $user->id)->count();
    }

    public function test_revoking_all_sessions_removes_push_destinations(): void
    {
        $member = $this->member();
        $bystander = $this->member();
        $this->registerDevices($member);
        $this->registerDevices($bystander);

        $this->assertGreaterThan(0, app(TokenService::class)->revokeAllTokensForUser($member->id, 'password_reset'));

        $this->assertSame(0, $this->deviceCount($member));
        $this->assertSame(2, $this->deviceCount($bystander), 'Another member\'s devices are untouched');
    }

    public function test_suspending_or_banning_a_member_removes_push_destinations(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $suspended = $this->member();
        $banned = $this->member();
        $this->registerDevices($suspended);
        $this->registerDevices($banned);

        Sanctum::actingAs($admin, ['*']);
        $this->apiPost("/v2/admin/users/{$suspended->id}/suspend", ['reason' => 'Test'])->assertOk();
        $this->apiPost("/v2/admin/users/{$banned->id}/ban", ['reason' => 'Test'])->assertOk();

        $this->assertSame(0, $this->deviceCount($suspended));
        $this->assertSame(0, $this->deviceCount($banned));
    }
}
