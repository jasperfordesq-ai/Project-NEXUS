<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\GamificationEmailService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class GamificationEmailServiceTest extends TestCase
{
    private GamificationEmailService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new GamificationEmailService();
    }

    public function test_sendWeeklyDigests_returns_expected_structure(): void
    {
        DB::shouldReceive('table->where->select->get')->andReturn(collect([]));

        $result = $this->service->sendWeeklyDigests();
        $this->assertArrayHasKey('sent', $result);
        $this->assertArrayHasKey('skipped', $result);
        $this->assertArrayHasKey('errors', $result);
        $this->assertEquals(0, $result['sent']);
    }

    public function test_sendWeeklyDigests_handles_tenant_query_failure(): void
    {
        DB::shouldReceive('table->where->select->get')->andThrow(new \Exception('DB error'));
        Log::shouldReceive('error')->once();

        $result = $this->service->sendWeeklyDigests();
        $this->assertEquals(1, $result['errors']);
    }

    public function test_gamification_email_fallback_copy_uses_translations(): void
    {
        $source = file_get_contents(app_path('Services/GamificationEmailService.php'));

        $this->assertStringContainsString("__('emails.common.fallback_name')", $source);
        $this->assertStringContainsString("__('emails.gamification_digest.badge_fallback')", $source);
        $this->assertStringContainsString("__('emails.gamification_milestone.badge_fallback')", $source);
        $this->assertStringNotContainsString("?: 'there'", $source);
        $this->assertStringNotContainsString("?? 'Badge'", $source);
        $this->assertStringNotContainsString("?? 'a new badge'", $source);
    }

    public function test_gamification_milestone_email_service_is_wired_to_badge_and_level_events(): void
    {
        $source = file_get_contents(app_path('Services/GamificationService.php'));

        $this->assertStringContainsString("sendMilestoneEmail(\$userId, 'badge_earned'", $source);
        $this->assertStringContainsString("sendMilestoneEmail(\$userId, 'level_up'", $source);
        $this->assertStringContainsString('GamificationService: badge milestone email failed', $source);
        $this->assertStringContainsString('GamificationService: level milestone email failed', $source);
    }

    // ── milestone email pacing ───────────────────────────────────────────────

    /**
     * Gamification awards arrive in clusters — one member got four emails in
     * three seconds on 2026-09-17. The slot is claimed with Cache::add, which
     * only writes when the key is absent, so a second award in the same window
     * cannot win it.
     */
    public function test_only_the_first_milestone_email_in_the_window_claims_the_slot(): void
    {
        config(['mail.gamification_milestone_min_interval_seconds' => 3600]);
        Cache::flush();

        $claim = new \ReflectionMethod(GamificationEmailService::class, 'claimMilestoneEmailSlot');
        $claim->setAccessible(true);

        $this->assertTrue($claim->invoke($this->service, 2, 4242), 'The first milestone in the window must send.');
        $this->assertFalse($claim->invoke($this->service, 2, 4242), 'The second must be held back.');
        $this->assertFalse($claim->invoke($this->service, 2, 4242), 'And the third.');
    }

    public function test_the_slot_is_per_member_and_per_tenant(): void
    {
        config(['mail.gamification_milestone_min_interval_seconds' => 3600]);
        Cache::flush();

        $claim = new \ReflectionMethod(GamificationEmailService::class, 'claimMilestoneEmailSlot');
        $claim->setAccessible(true);

        $this->assertTrue($claim->invoke($this->service, 2, 4242));

        // One member being paced must not pace anybody else, or the same
        // member in another community.
        $this->assertTrue($claim->invoke($this->service, 2, 9999), 'A different member has their own slot.');
        $this->assertTrue($claim->invoke($this->service, 3, 4242), 'A different tenant has its own slot.');
    }

    public function test_a_failed_send_hands_the_slot_back(): void
    {
        config(['mail.gamification_milestone_min_interval_seconds' => 3600]);
        Cache::flush();

        $claim = new \ReflectionMethod(GamificationEmailService::class, 'claimMilestoneEmailSlot');
        $claim->setAccessible(true);
        $release = new \ReflectionMethod(GamificationEmailService::class, 'releaseMilestoneEmailSlot');
        $release->setAccessible(true);

        $this->assertTrue($claim->invoke($this->service, 2, 4242));
        $this->assertFalse($claim->invoke($this->service, 2, 4242));

        // A send that never happened must not cost the member their next hour.
        $release->invoke($this->service, 2, 4242);

        $this->assertTrue($claim->invoke($this->service, 2, 4242));
    }

    public function test_the_limit_can_be_switched_off(): void
    {
        config(['mail.gamification_milestone_min_interval_seconds' => 0]);
        Cache::flush();

        $claim = new \ReflectionMethod(GamificationEmailService::class, 'claimMilestoneEmailSlot');
        $claim->setAccessible(true);

        $this->assertTrue($claim->invoke($this->service, 2, 4242));
        $this->assertTrue($claim->invoke($this->service, 2, 4242));
    }

    public function test_the_default_window_is_one_hour(): void
    {
        $this->assertSame(3600, GamificationEmailService::MILESTONE_EMAIL_MIN_INTERVAL_SECONDS);
        $this->assertSame(3600, (int) config('mail.gamification_milestone_min_interval_seconds'));
    }
}
