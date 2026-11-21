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

    /**
     * Was "switched off and warn only". Owner, 21 Nov 2026: the default for
     * going over the member number is to pause. Still switched off, so
     * nothing happens on deploy.
     */
    public function test_the_defaults_are_switched_off_and_pause_when_over(): void
    {
        DB::table('platform_billing_settings')->delete();
        BillingSettings::flush();

        $this->assertSame([
            'automation_enabled' => false,
            'reminder_days' => '30,14,7,1',
            'final_warning_days_late' => 7,
            'suspend_days_late' => 14,
            'card_retry_max_days_late' => 30,
            'limit_warning_percent' => 80,
            'over_limit_action' => 'pause',
            'over_limit_grace_days' => 30,
        ], BillingSettings::all());

        $this->assertFalse(BillingSettings::get('automation_enabled'));
        $this->assertSame(14, BillingSettings::get('suspend_days_late'));
    }

    /** @return array<string, array{0: string}> */
    public static function overLimitActions(): array
    {
        return ['warn only' => ['none'], 'stop new members' => ['block_joining'], 'pause' => ['pause'], 'move up' => ['upgrade']];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('overLimitActions')]
    public function test_each_of_the_four_over_limit_actions_is_accepted(string $action): void
    {
        BillingSettings::set('over_limit_action', $action, 42);
        BillingSettings::flush();

        $this->assertSame($action, BillingSettings::get('over_limit_action'));
    }

    public function test_a_stored_none_on_an_existing_installation_stays_none(): void
    {
        DB::table('platform_billing_settings')->delete();
        DB::table('platform_billing_settings')->insert([
            'setting_key' => 'over_limit_action', 'setting_value' => 'none', 'created_at' => now(), 'updated_at' => now(),
        ]);
        BillingSettings::flush();

        $this->assertSame('none', BillingSettings::get('over_limit_action'));
    }

    public function test_a_change_is_saved_typed_and_audited(): void
    {
        BillingSettings::set('automation_enabled', true, 42);
        BillingSettings::set('suspend_days_late', '21', 42);
        // `none`, not `pause`: pause became the default in hub plans Stage 4,
        // so setting it would change nothing and write no audit row.
        BillingSettings::set('over_limit_action', 'none', 42);

        $this->assertTrue(BillingSettings::get('automation_enabled'));
        $this->assertSame(21, BillingSettings::get('suspend_days_late'));
        $this->assertSame('none', BillingSettings::get('over_limit_action'));

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
        BillingSettings::set('reminder_days', '10,3', null);
        BillingSettings::set('card_retry_max_days_late', 12, null);
        BillingSettings::flush();

        $this->assertSame('10,3', BillingSettings::get('reminder_days'));
        $this->assertSame([10, 3], BillingSettings::reminderDays());
        $this->assertSame(12, BillingSettings::get('card_retry_max_days_late'));
    }

    public function test_the_default_reminder_days_are_a_month_a_fortnight_a_week_and_a_day_before(): void
    {
        DB::table('platform_billing_settings')->delete();
        BillingSettings::flush();

        $this->assertSame([30, 14, 7, 1], BillingSettings::reminderDays());
    }

    /** @return array<string, array{0: mixed, 1: string}> */
    public static function reminderDayInputs(): array
    {
        return [
            'spaces and any order' => ['7, 30,14', '30,14,7'],
            'a repeated day' => ['7,7,1', '7,1'],
            'one day' => ['5', '5'],
            'a list of whole numbers' => [[1, 30, 14], '30,14,1'],
            'numbers as strings in a list' => [['14', '2'], '14,2'],
            'empty means none' => ['', ''],
            'only spaces means none' => ['  ', ''],
            'an empty list means none' => [[], ''],
            // An empty text field reaches setMany() as null: Laravel turns
            // empty strings in a request into null before the controller.
            'null means none' => [null, ''],
            'the edges' => ['120,1', '120,1'],
            'eight days' => ['1,2,3,4,5,6,7,8', '8,7,6,5,4,3,2,1'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('reminderDayInputs')]
    public function test_reminder_days_are_normalised(mixed $input, string $stored): void
    {
        BillingSettings::set('reminder_days', $input, 42);
        BillingSettings::flush();

        $this->assertSame($stored, BillingSettings::get('reminder_days'));
        $this->assertSame(
            $stored === '' ? [] : array_map('intval', explode(',', $stored)),
            BillingSettings::reminderDays()
        );
    }

    public function test_no_reminder_days_means_no_reminders(): void
    {
        BillingSettings::set('reminder_days', '', 42);

        $this->assertSame([], BillingSettings::reminderDays());
    }

    public function test_a_stored_reminder_days_before_row_is_ignored(): void
    {
        DB::table('platform_billing_settings')->delete();
        DB::table('platform_billing_settings')->insert([
            'setting_key' => 'reminder_days_before',
            'setting_value' => '3',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        BillingSettings::flush();

        $this->assertArrayNotHasKey('reminder_days_before', BillingSettings::all());
        $this->assertSame([30, 14, 7, 1], BillingSettings::reminderDays());
    }

    /** @return array<string, array{0: string, 1: mixed}> */
    public static function badValues(): array
    {
        return [
            'unknown key' => ['no_such_setting', 1],
            'switch not a yes or no' => ['automation_enabled', 'maybe'],
            'the removed single reminder day' => ['reminder_days_before', 7],
            'reminder day zero' => ['reminder_days', '0'],
            'reminder day above range' => ['reminder_days', '121'],
            'reminder day negative' => ['reminder_days', '7,-1'],
            'reminder day a fraction' => ['reminder_days', '7.5'],
            'reminder day words' => ['reminder_days', 'a week'],
            'reminder days with an empty entry' => ['reminder_days', '7,,1'],
            'reminder days with a trailing comma' => ['reminder_days', '7,1,'],
            'reminder days separated by spaces only' => ['reminder_days', '7 1'],
            'nine reminder days' => ['reminder_days', '1,2,3,4,5,6,7,8,9'],
            'reminder days a number not a list' => ['reminder_days', 7],
            'reminder days a list with a fraction' => ['reminder_days', [7, 1.5]],
            'reminder days a list with a zero' => ['reminder_days', [7, 0]],
            'reminder days a list with a nested list' => ['reminder_days', [[7]]],
            'reminder days a list with a boolean' => ['reminder_days', [true]],
            'reminder days a list with a key' => ['reminder_days', ['a' => 7]],
            'reminder days a yes' => ['reminder_days', true],
            'longest card wait zero' => ['card_retry_max_days_late', 0],
            'longest card wait above range' => ['card_retry_max_days_late', 181],
            'longest card wait words' => ['card_retry_max_days_late', 'thirty'],
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
