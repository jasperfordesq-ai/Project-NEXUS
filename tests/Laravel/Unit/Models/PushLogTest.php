<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Models;

use App\Core\TenantContext;
use App\Models\PushLog;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * Tests for PushLog model — static helpers record() and stats().
 * Uses unique tenant id 99770 to avoid collisions.
 * PushLog does NOT use HasTenantScope; queries use tenant_id column directly.
 */
class PushLogTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99770;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();

        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'              => 'PushLog Test Tenant',
                'slug'              => 'push-test-99770',
                'domain'            => null,
                'is_active'         => true,
                'depth'             => 0,
                'allows_subtenants' => false,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]
        );

        TenantContext::setById(self::TENANT_ID);
    }

    // ─── structural / metadata ─────────────────────────────────────────────────

    public function test_table_name(): void
    {
        $model = new PushLog();
        $this->assertSame('push_log', $model->getTable());
    }

    public function test_updated_at_is_null(): void
    {
        // PushLog only tracks created_at; UPDATED_AT is null
        $this->assertNull(PushLog::UPDATED_AT);
    }

    public function test_fillable_contains_expected_fields(): void
    {
        $model = new PushLog();
        $expected = [
            'tenant_id', 'user_id', 'activity_type', 'title',
            'web_ok', 'fcm_sent', 'fcm_failed', 'status', 'error', 'created_at',
        ];
        $this->assertSame($expected, $model->getFillable());
    }

    public function test_casts_are_correct(): void
    {
        $casts = (new PushLog())->getCasts();
        $this->assertSame('boolean', $casts['web_ok']);
        $this->assertSame('integer', $casts['fcm_sent']);
        $this->assertSame('integer', $casts['fcm_failed']);
        $this->assertSame('datetime', $casts['created_at']);
    }

    // ─── record() — no-op paths ────────────────────────────────────────────────

    /**
     * 🔴 These two used to assert the OPPOSITE — that nothing is written when there was
     * nobody to send to — and that silence made the log unable to answer the only question
     * anyone asks of it. `NotificationDispatcher` describes the consequence in production:
     * "a `new_message` bell with no push_log line beside it. It reads as 'the send never
     * happened' when it was 'the send found no devices'."
     *
     * Measured on 2026-08-24: a real message produced a correct bell,
     * `fcm_device_tokens` held zero rows, `push_log` held zero rows, and nothing in the
     * data could tell those apart. Recording `no_targets` is what separates "nobody has
     * installed the app" from "delivery is broken".
     */
    public function test_record_writes_no_targets_when_there_was_nobody_to_send_to(): void
    {
        PushLog::record(self::TENANT_ID, 1, 'no_targets_event', 'Title', null, 0, 0, []);

        $row = DB::table('push_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('activity_type', 'no_targets_event')
            ->latest('id')
            ->first();

        $this->assertNotNull($row, 'a send that found no devices must still be recorded');
        $this->assertSame('no_targets', $row->status);
        $this->assertSame(0, (int) $row->fcm_sent);
        $this->assertSame(0, (int) $row->fcm_failed);
    }

    public function test_a_false_web_push_with_no_fcm_is_no_targets_not_a_failure(): void
    {
        // webOk=false means "no browser subscription", which is not a delivery failure —
        // but it is not nothing either, so it is recorded as having had no targets.
        PushLog::record(self::TENANT_ID, 1, 'web_false_event', null, false, 0, 0, []);

        $row = DB::table('push_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('activity_type', 'web_false_event')
            ->latest('id')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('no_targets', $row->status);
        $this->assertSame(0, (int) $row->web_ok);
    }

    // ─── record() — delivered paths ────────────────────────────────────────────

    public function test_record_inserts_row_with_status_delivered_when_web_push_ok(): void
    {
        PushLog::record(self::TENANT_ID, 42, 'listing_created', 'New Listing', true, 0, 0, []);

        $row = DB::table('push_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('activity_type', 'listing_created')
            ->latest('id')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('delivered', $row->status);
        $this->assertSame('New Listing', $row->title);
        $this->assertSame(1, (int) $row->web_ok);
    }

    public function test_record_inserts_row_with_status_delivered_when_fcm_sent(): void
    {
        PushLog::record(self::TENANT_ID, 43, 'message_received', null, null, 3, 0, []);

        $row = DB::table('push_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('activity_type', 'message_received')
            ->latest('id')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('delivered', $row->status);
        $this->assertSame(3, (int) $row->fcm_sent);
        $this->assertSame(0, (int) $row->fcm_failed);
    }

    // ─── record() — failed / partial paths ────────────────────────────────────

    public function test_record_inserts_row_with_status_failed_when_only_errors(): void
    {
        PushLog::record(self::TENANT_ID, 44, 'payment_confirmed', 'Payment', null, 0, 0, ['push error occurred']);

        $row = DB::table('push_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('activity_type', 'payment_confirmed')
            ->latest('id')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('failed', $row->status);
        $this->assertStringContainsString('push error occurred', $row->error);
    }

    public function test_record_inserts_row_with_status_partial_when_sent_and_failed(): void
    {
        PushLog::record(self::TENANT_ID, 45, 'event_reminder', 'Event', true, 2, 1, []);

        $row = DB::table('push_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('activity_type', 'event_reminder')
            ->latest('id')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('partial', $row->status);
    }

    public function test_record_inserts_row_with_status_failed_when_only_fcm_failed(): void
    {
        PushLog::record(self::TENANT_ID, 46, 'group_joined', null, null, 0, 2, []);

        $row = DB::table('push_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('activity_type', 'group_joined')
            ->latest('id')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('failed', $row->status);
    }

    public function test_record_stores_multiple_errors_joined_by_pipe(): void
    {
        PushLog::record(self::TENANT_ID, 47, 'vol_confirmed', null, null, 0, 0, ['err1', 'err2', 'err3']);

        $row = DB::table('push_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('activity_type', 'vol_confirmed')
            ->latest('id')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('err1 | err2 | err3', $row->error);
    }

    public function test_record_sets_user_id_null_when_zero_passed(): void
    {
        PushLog::record(self::TENANT_ID, 0, 'broadcast', null, true, 0, 0, []);

        $row = DB::table('push_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('activity_type', 'broadcast')
            ->latest('id')
            ->first();

        $this->assertNotNull($row);
        $this->assertNull($row->user_id);
    }

    // ─── stats() ───────────────────────────────────────────────────────────────

    public function test_stats_returns_zeros_for_tenant_with_no_rows(): void
    {
        $stats = PushLog::stats(self::TENANT_ID, 7);

        $this->assertSame(7, $stats['window_days']);
        $this->assertSame(0, $stats['total']);
        $this->assertSame(0, $stats['delivered']);
        $this->assertSame(0, $stats['partial']);
        $this->assertSame(0, $stats['failed']);
        $this->assertSame(0, $stats['fcm_sent']);
        $this->assertSame(0, $stats['fcm_failed']);
        $this->assertSame(0, $stats['web_delivered']);
    }

    public function test_stats_counts_delivered_and_partial_and_failed_rows(): void
    {
        $now = now();

        DB::table('push_log')->insert([
            ['tenant_id' => self::TENANT_ID, 'user_id' => 1, 'activity_type' => 'a', 'status' => 'delivered', 'fcm_sent' => 2, 'fcm_failed' => 0, 'web_ok' => 1, 'created_at' => $now],
            ['tenant_id' => self::TENANT_ID, 'user_id' => 1, 'activity_type' => 'b', 'status' => 'partial',   'fcm_sent' => 1, 'fcm_failed' => 1, 'web_ok' => 0, 'created_at' => $now],
            ['tenant_id' => self::TENANT_ID, 'user_id' => 1, 'activity_type' => 'c', 'status' => 'failed',    'fcm_sent' => 0, 'fcm_failed' => 2, 'web_ok' => 0, 'created_at' => $now],
        ]);

        $stats = PushLog::stats(self::TENANT_ID, 7);

        $this->assertSame(3, $stats['total']);
        $this->assertSame(1, $stats['delivered']);
        $this->assertSame(1, $stats['partial']);
        $this->assertSame(1, $stats['failed']);
        $this->assertSame(3, $stats['fcm_sent']);
        $this->assertSame(3, $stats['fcm_failed']);
        $this->assertSame(1, $stats['web_delivered']); // only the delivered row had web_ok=1
    }

    public function test_stats_excludes_rows_outside_the_window(): void
    {
        $old = now()->subDays(10);
        $recent = now()->subDays(2);

        DB::table('push_log')->insert([
            ['tenant_id' => self::TENANT_ID, 'user_id' => 1, 'activity_type' => 'old',    'status' => 'delivered', 'fcm_sent' => 0, 'fcm_failed' => 0, 'web_ok' => 0, 'created_at' => $old],
            ['tenant_id' => self::TENANT_ID, 'user_id' => 1, 'activity_type' => 'recent', 'status' => 'delivered', 'fcm_sent' => 0, 'fcm_failed' => 0, 'web_ok' => 0, 'created_at' => $recent],
        ]);

        $stats = PushLog::stats(self::TENANT_ID, 7);

        $this->assertSame(1, $stats['total']); // only the recent row
    }

    public function test_stats_does_not_include_other_tenants_rows(): void
    {
        $otherTenant = 99799;
        DB::table('tenants')->updateOrInsert(
            ['id' => $otherTenant],
            ['name' => 'Other', 'slug' => 'other-99799', 'domain' => null, 'is_active' => true, 'depth' => 0, 'allows_subtenants' => false, 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('push_log')->insert([
            ['tenant_id' => self::TENANT_ID, 'user_id' => 1, 'activity_type' => 'mine',  'status' => 'delivered', 'fcm_sent' => 0, 'fcm_failed' => 0, 'web_ok' => 0, 'created_at' => now()],
            ['tenant_id' => $otherTenant,    'user_id' => 1, 'activity_type' => 'theirs', 'status' => 'delivered', 'fcm_sent' => 0, 'fcm_failed' => 0, 'web_ok' => 0, 'created_at' => now()],
        ]);

        $stats = PushLog::stats(self::TENANT_ID, 7);
        $this->assertSame(1, $stats['total']);
    }

    public function test_stats_window_days_is_reflected_in_returned_array(): void
    {
        $stats = PushLog::stats(self::TENANT_ID, 30);
        $this->assertSame(30, $stats['window_days']);
    }
}
