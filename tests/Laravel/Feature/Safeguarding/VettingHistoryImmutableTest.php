<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The history behind every vetting decision cannot be changed or removed with
 * ordinary SQL (gap found 26 Oct 2026: it was append-only by convention only).
 * Removing the member or the community still removes it through the foreign
 * keys, which database triggers do not intercept.
 */
class VettingHistoryImmutableTest extends TestCase
{
    use DatabaseTransactions;

    public function test_a_vetting_history_row_cannot_be_edited(): void
    {
        $eventId = $this->event();

        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('member_vetting_attestation_events_immutable');

        DB::table('member_vetting_attestation_events')->where('id', $eventId)->update(['decision_after' => 'confirmed']);
    }

    public function test_a_vetting_history_row_cannot_be_deleted(): void
    {
        $eventId = $this->event();

        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('member_vetting_attestation_events_immutable');

        DB::table('member_vetting_attestation_events')->where('id', $eventId)->delete();
    }

    public function test_deleting_the_staff_member_who_decided_still_works(): void
    {
        $staff = User::factory()->forTenant($this->testTenantId)->create();
        $eventId = $this->event($staff->id);

        DB::table('users')->where('id', $staff->id)->delete();

        $this->assertNull(DB::table('member_vetting_attestation_events')->where('id', $eventId)->value('actor_user_id'));
    }

    private function event(?int $staffId = null): int
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $staffId ??= (int) User::factory()->forTenant($this->testTenantId)->create()->id;

        $attestationId = (int) DB::table('member_vetting_attestations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'scheme_code' => 'immutable_test_scheme',
            'attestation_code' => 'immutable_test',
            'purpose_code' => 'immutable_test_purpose',
            'scope_type' => 'tenant',
            'scope_identifier' => '',
            'decision' => 'refused',
            'confirmed_by' => $staffId,
            'confirmed_at' => now(),
            'policy_version' => '1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (int) DB::table('member_vetting_attestation_events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'attestation_id' => $attestationId,
            'user_id' => $member->id,
            'scheme_code' => 'immutable_test_scheme',
            'attestation_code' => 'immutable_test',
            'purpose_code' => 'immutable_test_purpose',
            'scope_type' => 'tenant',
            'scope_identifier' => '',
            'event_type' => 'decided',
            'decision_before' => null,
            'decision_after' => 'refused',
            'reason_code' => 'immutable_test_reason',
            'actor_user_id' => $staffId,
            'policy_version' => '1',
            'created_at' => now(),
        ]);
    }
}
