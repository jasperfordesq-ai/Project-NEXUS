<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * 🔴 `safeguarding_assignments.consent_given_at` had NO WRITER.
 *
 * The only method that sets it — SafeguardingService::recordConsent() — had zero
 * callers anywhere in the codebase, so the column could never be populated. That
 * made the admin dashboard's "consented wards" figure
 * (AdminSafeguardingController, `whereNotNull('consent_given_at')`) structurally
 * always zero, while the assignment itself was created and both parties emailed.
 *
 * The ward also had no way to SEE the assignment: the notification deep-links to
 * `/settings?tab=safeguarding`, and that tab only ever fetched preferences and
 * vetting status.
 *
 * These tests cover both halves, and the authorisation boundary that matters most:
 * consent belongs to the WARD and nobody else.
 */
class GuardianConsentRecordingTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{0:User,1:User,2:int} [guardian, ward, assignmentId] */
    private function makeAssignment(?int $tenantId = null): array
    {
        $tenantId ??= $this->testTenantId;

        $guardian = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Grace', 'last_name' => 'Guardian', 'status' => 'active', 'is_approved' => true,
        ]);
        $ward = User::factory()->forTenant($tenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $staff = User::factory()->forTenant($tenantId)->admin()->create();

        $assignmentId = (int) DB::table('safeguarding_assignments')->insertGetId([
            'guardian_user_id' => $guardian->id,
            'ward_user_id'     => $ward->id,
            'tenant_id'        => $tenantId,
            'assigned_by'      => $staff->id,
            'assigned_at'      => now(),
            'notes'            => 'Created by staff during onboarding.',
        ]);

        return [$guardian, $ward, $assignmentId];
    }

    public function test_ward_can_see_the_guardian_assigned_to_them(): void
    {
        [$guardian, $ward, $assignmentId] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $response = $this->apiGet('/v2/safeguarding/my-guardians');

        $response->assertStatus(200);
        $guardians = $response->json('data.guardians');
        $this->assertCount(1, $guardians);
        $this->assertSame($assignmentId, (int) $guardians[0]['id']);
        $this->assertSame('Grace Guardian', $guardians[0]['guardian_name']);
        // Not yet consented.
        $this->assertFalse($guardians[0]['consent_given']);
        $this->assertNull($guardians[0]['consent_given_at']);
    }

    public function test_ward_consent_is_actually_recorded(): void
    {
        // The regression this whole file exists for: before the endpoint below
        // existed, consent_given_at could never be written by anything.
        [, $ward, $assignmentId] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->assertNull(
            DB::table('safeguarding_assignments')->where('id', $assignmentId)->value('consent_given_at')
        );

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(200)
            ->assertJsonPath('data.consent_given', true)
            ->assertJsonPath('data.already_given', false);

        $this->assertNotNull(
            DB::table('safeguarding_assignments')->where('id', $assignmentId)->value('consent_given_at'),
            'The ward consenting must populate consent_given_at.'
        );
    }

    public function test_consenting_twice_is_idempotent(): void
    {
        [, $ward, $assignmentId] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(200);
        $first = DB::table('safeguarding_assignments')->where('id', $assignmentId)->value('consent_given_at');

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(200)
            ->assertJsonPath('data.already_given', true);

        $this->assertSame(
            $first,
            DB::table('safeguarding_assignments')->where('id', $assignmentId)->value('consent_given_at'),
            'A second consent must not move the original timestamp.'
        );
    }

    public function test_the_guardian_cannot_consent_on_the_wards_behalf(): void
    {
        // The entire purpose of the column is the WARD's consent. A guardian
        // consenting for them would make the record worthless.
        [$guardian, , $assignmentId] = $this->makeAssignment();
        Sanctum::actingAs($guardian);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(404);

        $this->assertNull(
            DB::table('safeguarding_assignments')->where('id', $assignmentId)->value('consent_given_at')
        );
    }

    public function test_an_unrelated_member_cannot_consent(): void
    {
        [, , $assignmentId] = $this->makeAssignment();
        $stranger = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($stranger);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(404);

        $this->assertNull(
            DB::table('safeguarding_assignments')->where('id', $assignmentId)->value('consent_given_at')
        );
    }

    public function test_a_revoked_assignment_cannot_be_consented_to(): void
    {
        [, $ward, $assignmentId] = $this->makeAssignment();
        DB::table('safeguarding_assignments')->where('id', $assignmentId)
            ->update(['revoked_at' => now()]);
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(404);

        // And it no longer appears in the ward's own list.
        $this->assertCount(0, $this->apiGet('/v2/safeguarding/my-guardians')->json('data.guardians'));
    }

    public function test_the_consented_wards_count_can_now_be_non_zero(): void
    {
        // The admin KPI that was structurally always zero.
        [, $ward, $assignmentId] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(200);

        $consented = DB::table('safeguarding_assignments')
            ->where('tenant_id', $this->testTenantId)
            ->whereNull('revoked_at')
            ->whereNotNull('consent_given_at')
            ->count();

        $this->assertGreaterThan(0, $consented, 'The consented-wards count must be able to reach a non-zero value.');
    }
}
