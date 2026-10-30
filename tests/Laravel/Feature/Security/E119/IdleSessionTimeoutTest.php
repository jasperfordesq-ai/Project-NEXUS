<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E119;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\Laravel\TestCase;

/**
 * E-119 F-608 — the community "Inactivity timeout (minutes)" setting was
 * enforced only by a timer in the open browser tab. The server never looked at
 * inactivity: a sign-in left idle for any length of time kept renewing for its
 * full 30-day life, so closing the tab, reloading the page, or replaying the
 * stored credentials after the timeout all still worked.
 *
 * The tester's check this pins: sign in, stay idle longer than the community's
 * timeout, then present the old credentials. The server must refuse them.
 */
class IdleSessionTimeoutTest extends TestCase
{
    use DatabaseTransactions;

    private const PASSWORD = 'correct-password-123';

    protected function tearDown(): void
    {
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        parent::tearDown();
    }

    private function setTimeout(?string $minutes): void
    {
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'general.inactivity_timeout_minutes')
            ->delete();
        if ($minutes !== null) {
            DB::table('tenant_settings')->insert([
                'tenant_id' => $this->testTenantId,
                'setting_key' => 'general.inactivity_timeout_minutes',
                'setting_value' => $minutes,
            ]);
        }
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    /** @return array{access: string, refresh: string} */
    private function signIn(): array
    {
        $email = 'e119-idle-' . uniqid() . '@example.test';
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'password_hash' => Hash::make(self::PASSWORD),
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);

        $response = $this->apiPost('/auth/login', ['email' => $email, 'password' => self::PASSWORD]);
        $response->assertStatus(200);
        $access = (string) $response->json('access_token');
        $refresh = (string) $response->json('refresh_token');
        $this->assertNotSame('', $access);
        $this->assertNotSame('', $refresh);

        return ['access' => $access, 'refresh' => $refresh];
    }

    /** Pretend the member has done nothing for $minutes. */
    private function idleFor(int $minutes): void
    {
        $updated = DB::table('refresh_session_activity')
            ->where('tenant_id', $this->testTenantId)
            ->update(['last_activity_at' => now()->subMinutes($minutes)]);
        $this->assertGreaterThan(0, $updated, 'the sign-in must have an activity record');
    }

    private function refresh(string $refreshToken): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/auth/refresh-token', ['refresh_token' => $refreshToken]);
    }

    private function me(string $accessToken): \Illuminate\Testing\TestResponse
    {
        return $this->withHeaders(['Authorization' => 'Bearer ' . $accessToken])->apiGet('/v2/users/me');
    }

    public function test_renewal_is_refused_after_the_community_inactivity_timeout(): void
    {
        $this->setTimeout('30');
        $tokens = $this->signIn();
        $this->idleFor(31);

        $response = $this->refresh($tokens['refresh']);

        $response->assertStatus(401);
        $this->assertSame('AUTH_SESSION_IDLE', $response->json('errors.0.code'));
        // And it stays refused: the idle session is revoked, not just paused.
        $this->assertNotNull(DB::table('refresh_token_sessions')
            ->where('tenant_id', $this->testTenantId)
            ->where('revocation_reason', 'idle_timeout')
            ->value('id'));
    }

    public function test_an_unexpired_access_token_is_refused_once_the_session_is_idle(): void
    {
        // 5 minutes is shorter than the 15-minute access token, so the access
        // token alone must not outlive the community's timeout.
        $this->setTimeout('5');
        $tokens = $this->signIn();
        $this->me($tokens['access'])->assertStatus(200);
        $this->idleFor(6);

        $this->me($tokens['access'])->assertStatus(401);
    }

    public function test_a_member_who_keeps_using_the_site_stays_signed_in(): void
    {
        $this->setTimeout('30');
        $tokens = $this->signIn();
        $this->idleFor(25);
        // Any signed-in request is activity and restarts the clock.
        $this->me($tokens['access'])->assertStatus(200);

        $this->refresh($tokens['refresh'])->assertStatus(200);
    }

    public function test_the_activity_endpoint_keeps_a_reading_member_signed_in(): void
    {
        $this->setTimeout('30');
        $tokens = $this->signIn();
        $this->idleFor(25);

        $this->withHeaders(['Authorization' => 'Bearer ' . $tokens['access']])
            ->apiPost('/v2/auth/activity', [])
            ->assertStatus(204);

        $last = DB::table('refresh_session_activity')->where('tenant_id', $this->testTenantId)->value('last_activity_at');
        $this->assertTrue(now()->diffInSeconds($last, true) < 60, 'activity must be recorded now');
    }

    public function test_no_timeout_is_enforced_when_the_community_has_none_or_turned_it_off(): void
    {
        foreach ([null, '0'] as $setting) {
            $this->setTimeout($setting);
            $tokens = $this->signIn();
            $this->idleFor(600);

            $this->refresh($tokens['refresh'])->assertStatus(200);
        }
    }

    public function test_sign_ins_from_before_this_change_are_not_signed_out_at_deploy(): void
    {
        $this->setTimeout('30');
        $tokens = $this->signIn();
        // A family created before activity was recorded has no row at all.
        DB::table('refresh_session_activity')->where('tenant_id', $this->testTenantId)->delete();

        $this->refresh($tokens['refresh'])->assertStatus(200);
    }

    public function test_the_sign_in_access_token_belongs_to_its_session(): void
    {
        $tokens = $this->signIn();
        $payload = app(TokenService::class)->validateToken($tokens['access']);

        $this->assertIsArray($payload);
        $this->assertNotEmpty($payload['refresh_family_id'] ?? null,
            'a sign-in token must be tied to its session so its activity counts and a logout ends it');
    }
}
