<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering;

use App\Services\RetentionPolicyService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The fundraising history is the audit trail public-sector customers rely on:
 * the database itself must refuse to change or remove it, and the retention
 * job must never be able to prune it.
 */
class FundraisingTablesTest extends TestCase
{
    use DatabaseTransactions;

    private function event(): int
    {
        return (int) DB::table('vol_fundraising_events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'actor_kind' => 'system',
            'event' => 'campaign_created',
            'created_at' => now(),
        ]);
    }

    private function handover(): int
    {
        return (int) DB::table('vol_fundraising_handovers')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'giving_day_id' => 1,
            'organization_id' => 1,
            'amount' => 10,
            'currency' => 'EUR',
            'handed_over_on' => now()->toDateString(),
            'method' => 'bank_transfer',
            'reference' => 'REF-1',
            'recorded_by' => 1,
            'created_at' => now(),
        ]);
    }

    public function test_history_rows_cannot_be_updated(): void
    {
        $id = $this->event();
        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('vol_fundraising_events_append_only');
        DB::table('vol_fundraising_events')->where('id', $id)->update(['event' => 'campaign_ended']);
    }

    public function test_history_rows_cannot_be_deleted(): void
    {
        $id = $this->event();
        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('vol_fundraising_events_append_only');
        DB::table('vol_fundraising_events')->where('id', $id)->delete();
    }

    public function test_handover_cannot_be_deleted(): void
    {
        $id = $this->handover();
        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('vol_fundraising_handover_immutable');
        DB::table('vol_fundraising_handovers')->where('id', $id)->delete();
    }

    public function test_handover_amount_cannot_be_edited(): void
    {
        $id = $this->handover();
        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('vol_fundraising_handover_immutable');
        DB::table('vol_fundraising_handovers')->where('id', $id)->update(['amount' => 99]);
    }

    public function test_handover_can_be_confirmed_once_but_not_re_confirmed(): void
    {
        $id = $this->handover();
        DB::table('vol_fundraising_handovers')->where('id', $id)
            ->update(['confirmed_by' => 5, 'confirmed_at' => now()]);
        $this->assertSame(5, (int) DB::table('vol_fundraising_handovers')->where('id', $id)->value('confirmed_by'));

        $this->expectException(QueryException::class);
        DB::table('vol_fundraising_handovers')->where('id', $id)->update(['confirmed_by' => 6]);
    }

    public function test_retention_never_prunes_fundraising_tables(): void
    {
        $tables = array_column(RetentionPolicyService::DATA_TYPES, 'table');
        $this->assertNotContains('vol_fundraising_events', $tables);
        $this->assertNotContains('vol_fundraising_handovers', $tables);
    }

    public function test_campaigns_record_who_last_edited_them(): void
    {
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumns('vol_giving_days', ['updated_at', 'updated_by']));
    }
}
