<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Services\SafeguardingPreferenceService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-434 (E-073 B-2) — a staff change to a community's safeguarding options must
 * record who made it.
 *
 * `SafeguardingPreferenceService::logActivity()` takes an actor, and the
 * member-initiated calls in the same service pass one. The four staff mutations
 * — `createOption`, `updateOption`, `deleteOption` and `replaceCountryPreset` —
 * passed `null`, so `activity_log.user_id` was empty. The IP address and user
 * agent were recorded; the acting account was not, and no controller or
 * middleware wrote a second trail. "Who changed this safeguarding setting"
 * could not be answered from the platform's own records — which is also what
 * would have made F-433 impossible to attribute after the fact.
 *
 * This test asserts the CORRECT behaviour: create, update, delete and the
 * jurisdiction preset each name their actor.
 *
 * Control: the member-initiated read in the same service still records its own
 * accessor id, proving the working path was not disturbed.
 */
final class F434SafeguardingOptionChangesRecordTheActorTest extends TestCase
{
    use DatabaseTransactions;

    public function test_create_update_and_delete_record_the_acting_staff_account(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $optionKey = 'f434_audit_actor_' . uniqid();
        $created = $this->apiPost('/v2/admin/safeguarding/options', [
            'option_key' => $optionKey,
            'label' => 'Needs broker check',
            'option_type' => 'checkbox',
            'triggers' => ['requires_broker_approval' => true],
        ]);
        $created->assertStatus(201);

        $optionId = (int) TenantSafeguardingOption::withoutGlobalScopes()
            ->where('tenant_id', $this->testTenantId)
            ->where('option_key', $optionKey)
            ->value('id');
        $this->assertGreaterThan(0, $optionId);

        $this->apiPut("/v2/admin/safeguarding/options/{$optionId}", [
            'label' => 'Needs a broker to check first',
        ])->assertStatus(200);

        $this->apiDelete("/v2/admin/safeguarding/options/{$optionId}")
            ->assertStatus(200);

        foreach ([
            'safeguarding_option_created',
            'safeguarding_option_updated',
            'safeguarding_option_deleted',
        ] as $action) {
            $rows = DB::table('activity_log')
                ->where('tenant_id', $this->testTenantId)
                ->where('action', $action)
                ->where('entity_type', 'safeguarding_option')
                ->where('entity_id', $optionId)
                ->get(['user_id']);

            $this->assertCount(1, $rows, "Expected exactly one {$action} row");
            $this->assertSame(
                (int) $admin->id,
                (int) $rows->first()->user_id,
                "{$action} must name the administrator who did it",
            );
        }
    }

    public function test_applying_a_jurisdiction_preset_records_the_acting_staff_account(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiPut('/v2/admin/vetting/policy', [
            'jurisdiction' => 'england_wales',
        ])->assertStatus(200);

        $row = DB::table('activity_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'safeguarding_preset_applied')
            ->where('entity_type', 'tenant')
            ->orderByDesc('id')
            ->first(['user_id']);

        $this->assertNotNull($row, 'Applying a jurisdiction preset must be audited');
        $this->assertSame(
            (int) $admin->id,
            (int) $row->user_id,
            'The preset change must name the administrator who applied it',
        );
    }

    /**
     * Control — the member-initiated path in the same service was already
     * recording its actor and must continue to. A fix that broke this would be
     * a regression in the audit trail, not an improvement.
     */
    public function test_the_member_initiated_read_still_records_its_accessor(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $accessor = User::factory()->forTenant($this->testTenantId)->admin()->create();

        SafeguardingPreferenceService::getUserPreferences(
            $this->testTenantId,
            (int) $member->id,
            (int) $accessor->id,
            'admin',
            'f434_control',
        );

        $row = DB::table('activity_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'safeguarding_preferences_viewed')
            ->where('entity_type', 'user')
            ->where('entity_id', (int) $member->id)
            ->orderByDesc('id')
            ->first(['user_id']);

        $this->assertNotNull($row);
        $this->assertSame((int) $accessor->id, (int) $row->user_id);
    }
}
