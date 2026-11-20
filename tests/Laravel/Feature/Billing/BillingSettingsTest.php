<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Support\Billing\BillingSettings;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The platform team's numbers for the daily billing check: defaults that are
 * safe to deploy (switched off), validation that saves nothing on a bad value,
 * and every change in the billing audit log.
 */
final class BillingSettingsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        BillingSettings::flush();
    }

    protected function tearDown(): void
    {
        try {
            BillingSettings::flush();
        } finally {
            parent::tearDown();
        }
    }

    public function test_the_defaults_are_switched_off_and_warn_only(): void
    {
        DB::table('platform_billing_settings')->delete();
        BillingSettings::flush();

        $this->assertSame([
            'automation_enabled' => false,
            'reminder_days_before' => 7,
            'final_warning_days_late' => 7,
            'suspend_days_late' => 14,
            'limit_warning_percent' => 80,
            'over_limit_action' => 'none',
            'over_limit_grace_days' => 30,
        ], BillingSettings::all());

        $this->assertFalse(BillingSettings::get('automation_enabled'));
        $this->assertSame(14, BillingSettings::get('suspend_days_late'));
    }

    public function test_a_change_is_saved_typed_and_audited(): void
    {
        BillingSettings::set('automation_enabled', true, 42);
        BillingSettings::set('suspend_days_late', '21', 42);
        BillingSettings::set('over_limit_action', 'pause', 42);

        $this->assertTrue(BillingSettings::get('automation_enabled'));
        $this->assertSame(21, BillingSettings::get('suspend_days_late'));
        $this->assertSame('pause', BillingSettings::get('over_limit_action'));

        $rows = DB::table('billing_audit_log')
            ->where('tenant_id', 0)
            ->where('action', 'billing_setting_changed')
            ->orderBy('id')
            ->get();
        $this->assertCount(3, $rows);
        $this->assertSame(42, (int) $rows[1]->acted_by_user_id);
        $this->assertSame(['suspend_days_late' => 14], json_decode((string) $rows[1]->old_value, true));
        $this->assertSame(['suspend_days_late' => 21], json_decode((string) $rows[1]->new_value, true));
    }

    public function test_setting_the_same_value_again_writes_no_audit_row(): void
    {
        BillingSettings::set('limit_warning_percent', 85, 42);
        BillingSettings::set('limit_warning_percent', 85, 42);

        $this->assertSame(1, DB::table('billing_audit_log')->where('tenant_id', 0)->where('action', 'billing_setting_changed')->count());
    }

    public function test_a_saved_value_is_read_back_after_the_cache_is_forgotten(): void
    {
        BillingSettings::set('reminder_days_before', 10, null);
        BillingSettings::flush();

        $this->assertSame(10, BillingSettings::get('reminder_days_before'));
    }

    /** @return array<string, array{0: string, 1: mixed}> */
    public static function badValues(): array
    {
        return [
            'unknown key' => ['no_such_setting', 1],
            'switch not a yes or no' => ['automation_enabled', 'maybe'],
            'reminder below range' => ['reminder_days_before', -1],
            'reminder above range' => ['reminder_days_before', 61],
            'final warning zero' => ['final_warning_days_late', 0],
            'final warning above range' => ['final_warning_days_late', 181],
            'suspend above range' => ['suspend_days_late', 366],
            'suspend not after the final warning' => ['suspend_days_late', 7],
            'final warning not before the pause' => ['final_warning_days_late', 14],
            'percent too low' => ['limit_warning_percent', 49],
            'percent 100' => ['limit_warning_percent', 100],
            'action unknown' => ['over_limit_action', 'delete'],
            'grace zero' => ['over_limit_grace_days', 0],
            'grace above range' => ['over_limit_grace_days', 366],
            'a fraction' => ['suspend_days_late', '14.5'],
            'words' => ['suspend_days_late', 'fourteen'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('badValues')]
    public function test_a_bad_value_is_refused_and_nothing_is_saved(string $key, mixed $value): void
    {
        $before = BillingSettings::all();

        try {
            BillingSettings::set($key, $value, 42);
            $this->fail("{$key} accepted " . var_export($value, true));
        } catch (\DomainException $e) {
            $this->assertSame('billing_setting_invalid', $e->getMessage());
        }

        BillingSettings::flush();
        $this->assertSame($before, BillingSettings::all());
        $this->assertSame(0, DB::table('billing_audit_log')->where('tenant_id', 0)->where('action', 'billing_setting_changed')->count());
    }

    public function test_several_values_are_checked_together(): void
    {
        // Raising both at once is fine even though the new final warning is
        // later than the old pause day.
        BillingSettings::setMany(['final_warning_days_late' => 20, 'suspend_days_late' => 30], 42);

        $this->assertSame(20, BillingSettings::get('final_warning_days_late'));
        $this->assertSame(30, BillingSettings::get('suspend_days_late'));

        try {
            BillingSettings::setMany(['automation_enabled' => true, 'suspend_days_late' => 5], 42);
            $this->fail('A pause before the final warning was accepted.');
        } catch (\DomainException $e) {
            $this->assertSame('billing_setting_invalid', $e->getMessage());
        }

        BillingSettings::flush();
        $this->assertFalse(BillingSettings::get('automation_enabled'), 'Nothing in a refused batch is saved.');
    }
}
