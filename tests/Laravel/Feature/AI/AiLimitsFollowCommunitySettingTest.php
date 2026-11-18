<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\AI;

use App\Models\AiUserLimit;
use App\Models\User;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Security register E-131 (deeper audit): the admin AI settings page's
 * "Default daily limit" and "Default monthly limit".
 *
 * - Each member's limit was copied into their own ai_user_limits row on first
 *   use and checked from that copy for ever, so a limit changed on the page
 *   never reached anyone who had used AI before. Nothing else writes those
 *   columns (no per-member screen exists).
 * - GET /ai/limits created the row with a fixed 50/1000, ignoring the page.
 * - The page accepted any text: a cleared box ('') or 'abc' was read as 0,
 *   which blocks all AI for new members.
 */
final class AiLimitsFollowCommunitySettingTest extends TestCase
{
    use DatabaseTransactions;

    private int $memberId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->memberId = (int) User::factory()->forTenant($this->testTenantId)->create()->id;
    }

    public function test_a_lower_limit_set_on_the_page_reaches_a_member_who_used_ai_before(): void
    {
        $this->saveLimits('50', '1000');
        AiUserLimit::admitRequest($this->memberId, $this->testTenantId); // row created with 50

        $this->actAsAdmin();
        $this->apiPut('/v2/admin/config/ai', ['default_daily_limit' => '2'])->assertOk();

        $this->assertTrue(AiUserLimit::admitRequest($this->memberId, $this->testTenantId)['allowed']);
        $third = AiUserLimit::admitRequest($this->memberId, $this->testTenantId);
        $this->assertFalse($third['allowed'], 'the old copied limit of 50 was used');
        $this->assertSame('daily_limit_reached', $third['reason']);
        $this->assertSame(2, $third['daily_limit']);
    }

    public function test_the_limits_a_member_is_shown_are_the_communitys(): void
    {
        $this->saveLimits('7', '70');

        $limits = AiUserLimit::canMakeRequest($this->memberId, $this->testTenantId);

        $this->assertSame(7, $limits['daily_limit']);
        $this->assertSame(70, $limits['monthly_limit']);
    }

    public function test_a_blank_or_unreadable_saved_limit_falls_back_to_the_standard_one_not_zero(): void
    {
        $this->saveLimits('', 'abc');

        $result = AiUserLimit::admitRequest($this->memberId, $this->testTenantId);

        $this->assertTrue($result['allowed']);
        $this->assertSame(50, $result['daily_limit']);
        $this->assertSame(1000, $result['monthly_limit']);
    }

    public function test_zero_still_means_no_ai(): void
    {
        $this->saveLimits('0', '1000');

        $this->assertFalse(AiUserLimit::admitRequest($this->memberId, $this->testTenantId)['allowed']);
    }

    public function test_the_page_refuses_a_limit_that_is_not_a_whole_number(): void
    {
        $this->actAsAdmin();

        foreach (['abc', '-5', '2.5', ''] as $bad) {
            $this->apiPut('/v2/admin/config/ai', ['default_daily_limit' => $bad])
                ->assertStatus(422);
        }
        $this->apiPut('/v2/admin/config/ai', ['default_monthly_limit' => '9999999'])->assertStatus(422);

        $this->apiPut('/v2/admin/config/ai', ['default_daily_limit' => '0', 'default_monthly_limit' => '300'])->assertOk();
        $this->assertSame('0', DB::table('ai_settings')->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'default_daily_limit')->value('setting_value'));
    }

    private function actAsAdmin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id,
            $admin->tenant_id,
            TwoFactorPolicy::claims('totp')
        )]);
    }

    private function saveLimits(string $daily, string $monthly): void
    {
        foreach (['default_daily_limit' => $daily, 'default_monthly_limit' => $monthly] as $key => $value) {
            DB::table('ai_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => $value, 'updated_at' => now()]
            );
        }
    }
}
