<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Models\TenantSafeguardingOption;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-075 F-495 — reordering a community's safeguarding options must record who
 * did it, like every other staff change to those options.
 *
 * `SafeguardingPreferenceService::reorderOptions()` was a bare `UPDATE` loop
 * with no `logActivity()` call of any kind, reached from
 * `AdminSafeguardingOptionsController::reorder()`
 * (`PUT /v2/admin/safeguarding/options/reorder`, broker-or-admin). It is the
 * fifth staff mutation in that service; F-434 (`6e647e249`) threaded an actor
 * through the other four and left this one out.
 *
 * Low severity — reordering changes display order only and cannot add or remove
 * a protection. It is fixed because "who changed this safeguarding setting, and
 * when" is precisely the question F-434 exists to answer, and a gap in the
 * answer is a gap in the answer.
 *
 * This test asserts the CORRECT behaviour and therefore fails before the fix.
 * The legitimate-access control is in the same file: an ordinary option UPDATE
 * by the same account on the same route group still records exactly one row
 * naming them, so the finding is the missing call and not a broken fixture.
 */
final class F495SafeguardingOptionReorderRecordsTheActorTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{0:int,1:int} the two option ids, in their starting order */
    private function createTwoOptions(string $suffix): array
    {
        $first = $this->createOption('f495_first_' . $suffix, 'First option', 1);
        $second = $this->createOption('f495_second_' . $suffix, 'Second option', 2);

        return [$first, $second];
    }

    private function createOption(string $key, string $label, int $sortOrder): int
    {
        $this->apiPost('/v2/admin/safeguarding/options', [
            'option_key' => $key,
            'label' => $label,
            'option_type' => 'checkbox',
            'sort_order' => $sortOrder,
            'triggers' => [],
        ])->assertStatus(201);

        return (int) TenantSafeguardingOption::withoutGlobalScopes()
            ->where('tenant_id', $this->testTenantId)
            ->where('option_key', $key)
            ->value('id');
    }

    /**
     * THE HARM: a staff account reorders the options and the platform keeps no
     * record of who did it.
     */
    public function test_reordering_safeguarding_options_records_the_acting_staff_account(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $suffix = uniqid();
        [$firstId, $secondId] = $this->createTwoOptions($suffix);

        DB::table('activity_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'safeguarding_options_reordered')
            ->delete();

        $this->apiPut('/v2/admin/safeguarding/options/reorder', [
            'order' => [
                (string) $firstId => 2,
                (string) $secondId => 1,
            ],
        ])->assertStatus(200);

        // The reorder really happened — otherwise a missing record proves nothing.
        $this->assertSame(
            2,
            (int) TenantSafeguardingOption::withoutGlobalScopes()->where('id', $firstId)->value('sort_order'),
            'the first option really was moved',
        );
        $this->assertSame(
            1,
            (int) TenantSafeguardingOption::withoutGlobalScopes()->where('id', $secondId)->value('sort_order'),
            'and the second option really was moved',
        );

        $rows = DB::table('activity_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'safeguarding_options_reordered')
            ->get(['user_id', 'entity_type', 'entity_id', 'details']);

        $this->assertCount(
            1,
            $rows,
            'A staff change to a community\'s safeguarding options must leave exactly one '
            . 'activity record (F-495: reorderOptions() logged nothing at all).',
        );
        $this->assertSame(
            (int) $admin->id,
            (int) $rows->first()->user_id,
            'and the record must name the staff account that did it',
        );

        $details = json_decode((string) $rows->first()->details, true);
        $this->assertSame(
            2,
            (int) ($details['option_count'] ?? 0),
            'the record must say how many options were reordered',
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL: the already-covered option UPDATE on the same
     * route group, by the same account, still records exactly one row naming
     * them. The reorder above differs from this only in which mutation it is.
     */
    public function test_control_an_ordinary_option_update_still_records_the_actor(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $optionKey = 'f495_control_' . uniqid();
        $optionId = $this->createOption($optionKey, 'Control option', 1);

        $this->apiPut("/v2/admin/safeguarding/options/{$optionId}", [
            'label' => 'Control option, renamed',
        ])->assertStatus(200);

        $rows = DB::table('activity_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'safeguarding_option_updated')
            ->where('entity_type', 'safeguarding_option')
            ->where('entity_id', $optionId)
            ->get(['user_id']);

        $this->assertCount(1, $rows, 'CONTROL: F-434\'s record on the update path is unchanged');
        $this->assertSame(
            (int) $admin->id,
            (int) $rows->first()->user_id,
            'CONTROL: and it still names the administrator',
        );
    }
}
