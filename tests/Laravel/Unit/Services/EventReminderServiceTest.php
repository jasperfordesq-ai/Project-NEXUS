<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\EventReminderService;
use Illuminate\Support\Facades\DB;

class EventReminderServiceTest extends TestCase
{
    private EventReminderService $service;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('events.reminders.mode', 'legacy');
        $this->service = new EventReminderService();
    }

    private function expectTenantLookup(int $tenantId): void
    {
        $tenantQuery = \Mockery::mock();
        $tenantQuery->shouldReceive('where')
            ->once()
            ->with('id', $tenantId)
            ->andReturnSelf();
        $tenantQuery->shouldReceive('first')
            ->once()
            ->andReturn((object) [
                'id' => $tenantId,
                'slug' => 'tenant-' . $tenantId,
                'name' => 'Tenant ' . $tenantId,
            ]);

        DB::shouldReceive('table')
            ->once()
            ->with('tenants')
            ->andReturn($tenantQuery);
    }

    // =========================================================================
    // cancelReminder()
    // =========================================================================

    public function test_push_reminder_time_is_short_enough_for_a_lock_screen_title(): void
    {
        // The email/bell form is "Monday, 19 October 2026 10:00 (Europe/Dublin)",
        // which the push copy's 40-character cap would cut mid-word. The push
        // gets the short form in the event's timezone.
        $method = new \ReflectionMethod(EventReminderService::class, 'formatEventTimeForPush');
        $method->setAccessible(true);

        $short = $method->invoke(null, $this->testTenantId, '2026-10-19 09:00:00', 'Europe/Dublin');

        $this->assertLessThanOrEqual(40, mb_strlen($short), $short);
        $this->assertStringContainsString('10:00', $short);
        $this->assertStringContainsString('2026', $short);
        $this->assertStringNotContainsString('Europe/Dublin', $short);
        $this->assertSame('', $method->invoke(null, $this->testTenantId, null, 'Europe/Dublin'));
    }

    public function test_cancelReminder_returns_true_on_success(): void
    {
        DB::shouldReceive('delete')->once()->andReturn(1);

        $result = $this->service->cancelReminder(2, 1);
        $this->assertTrue($result);
    }

    public function test_cancelReminder_returns_false_on_exception(): void
    {
        DB::shouldReceive('delete')->andThrow(new \Exception('DB error'));

        $result = $this->service->cancelReminder(2, 1);
        $this->assertFalse($result);
    }

    // =========================================================================
    // sendDueReminders()
    // =========================================================================

    public function test_sendDueReminders_returns_zero_when_no_events(): void
    {
        $this->expectTenantLookup(2);
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->sendDueReminders(2);
        $this->assertEquals(0, $result);
    }

    public function test_sendDueReminders_processes_both_reminder_types(): void
    {
        // For both fixed reminder types plus configured-reminder scan, returns empty rows.
        $this->expectTenantLookup(2);
        DB::shouldReceive('select')->times(3)->andReturn([]);

        $result = $this->service->sendDueReminders(2);
        $this->assertEquals(0, $result);
    }

    public function test_sendDueReminders_sets_tenant_context_itself(): void
    {
        $source = file_get_contents(app_path('Services/EventReminderService.php'));

        $this->assertStringContainsString('TenantContext::runForTenant($tenantId', $source);
        $this->assertStringContainsString('TenantContext::getFrontendUrl()', $source);
        $this->assertStringContainsString('TenantContext::getSlugPrefix()', $source);
    }

}
