<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Onboarding;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\OnboardingConfigService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The optional "Protect your account" step of the welcome wizard (6 Nov 2026).
 *
 * New members are offered two-factor once they are approved and signed in —
 * never at registration, where the account cannot sign in or enrol. The step
 * is offered only to a member who could actually complete it: the community
 * allows two-factor, has not switched the step off, the member has a password
 * of their own (enrolment needs a fresh password confirmation, F-170), and
 * two-factor is not already on.
 */
class OnboardingSecurityStepTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        OnboardingConfigService::clearConfigCache($this->testTenantId);
    }

    private function member(array $attributes = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
            'password_hash' => Hash::make('test-password'),
        ], $attributes));
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    /** @return list<string> */
    private function memberStepSlugs(): array
    {
        $response = $this->apiGet('/v2/onboarding/config');
        $response->assertOk();

        return array_column($response->json('data.steps') ?? [], 'slug');
    }

    private function setOnboardingSetting(string $key, string $value): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.' . $key],
            ['setting_value' => $value, 'setting_type' => 'boolean']
        );
        OnboardingConfigService::clearConfigCache($this->testTenantId);
    }

    public function test_a_member_with_a_password_is_offered_the_step_just_before_confirm(): void
    {
        $this->member();

        $slugs = $this->memberStepSlugs();

        $this->assertContains('security', $slugs);
        $this->assertSame('confirm', $slugs[array_search('security', $slugs, true) + 1] ?? null);
    }

    public function test_the_step_is_optional(): void
    {
        $this->member();

        $steps = $this->apiGet('/v2/onboarding/config')->json('data.steps');
        $security = collect($steps)->firstWhere('slug', 'security');

        $this->assertNotNull($security);
        $this->assertFalse($security['required']);
    }

    public function test_no_step_when_the_community_has_switched_it_off(): void
    {
        $this->member();
        $this->setOnboardingSetting('step_security_enabled', '0');

        $this->assertNotContains('security', $this->memberStepSlugs());
    }

    public function test_no_step_when_the_community_does_not_offer_two_factor(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['two_factor_authentication' => false])]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        $this->member();

        $this->assertNotContains('security', $this->memberStepSlugs());
    }

    public function test_no_step_for_a_member_without_a_password_of_their_own(): void
    {
        // Social sign-up stores no password_hash. Such a member cannot pass the
        // fresh confirmation that enrolment requires, so offering the step
        // would lead them into a dead end.
        $this->member(['password_hash' => null]);

        $this->assertNotContains('security', $this->memberStepSlugs());
    }

    public function test_no_step_when_two_factor_is_already_on(): void
    {
        $user = $this->member();
        DB::table('user_totp_settings')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'totp_secret_encrypted' => 'not-used-by-this-test',
            'is_enabled' => 1,
            'created_at' => now(),
        ]);

        $this->assertNotContains('security', $this->memberStepSlugs());
    }

    public function test_the_other_steps_are_unchanged(): void
    {
        $this->member();

        $slugs = $this->memberStepSlugs();

        $this->assertSame(['welcome', 'profile', 'skills'], array_slice($slugs, 0, 3));
        $this->assertSame('confirm', end($slugs));
    }

    public function test_an_admin_can_switch_the_step_off_and_on(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin', 'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($admin, ['*']);

        $this->apiPut('/v2/admin/config/onboarding', ['step_security_enabled' => false])->assertOk();
        $this->assertFalse(OnboardingConfigService::getConfig($this->testTenantId)['step_security_enabled']);

        $this->apiPut('/v2/admin/config/onboarding', ['step_security_enabled' => true])->assertOk();
        $this->assertTrue(OnboardingConfigService::getConfig($this->testTenantId)['step_security_enabled']);
    }

    public function test_the_step_is_on_by_default(): void
    {
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'onboarding.step_security_enabled')
            ->delete();
        OnboardingConfigService::clearConfigCache($this->testTenantId);

        $this->assertTrue(OnboardingConfigService::getConfig($this->testTenantId)['step_security_enabled']);
    }
}
