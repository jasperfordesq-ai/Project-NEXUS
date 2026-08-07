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
 * 🔴 The member's consent to a guardian arrangement must be real, recorded,
 * and the member's ALONE.
 *
 * History this file guards against: the original consent column
 * (`safeguarding_assignments.consent_given_at`) shipped with NO writer, so
 * the admin "consented" figure was structurally always zero while both
 * parties were emailed about arrangements the member could not even see.
 *
 * Phase 5: arrangements live in `account_relationships` (staff-proposed,
 * tier 0 — they grant nothing), and consent is `status='active'` +
 * `approved_at`. Same guarantees, walked through the same endpoints.
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

        $assignmentId = (int) DB::table('account_relationships')->insertGetId([
            'tenant_id'           => $tenantId,
            'parent_user_id'      => $guardian->id,
            'child_user_id'       => $ward->id,
            'relationship_type'   => 'guardian',
            'permissions'         => json_encode([
                'can_view_activity' => false, 'can_manage_listings' => false,
                'can_transact' => false, 'can_view_messages' => false,
                'tiers' => ['activity' => 'none', 'listings' => 'none', 'credits' => 'none'],
            ]),
            'status'              => 'pending',
            'proposed_by_user_id' => $staff->id,
            'staff_notes'         => 'Created by staff during onboarding.',
            'created_at'          => now(),
            'updated_at'          => now(),
        ]);

        return [$guardian, $ward, $assignmentId];
    }

    private function consentGivenAt(int $assignmentId): ?string
    {
        return DB::table('account_relationships')->where('id', $assignmentId)->value('approved_at');
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
        [, $ward, $assignmentId] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->assertNull($this->consentGivenAt($assignmentId));

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(200)
            ->assertJsonPath('data.consent_given', true)
            ->assertJsonPath('data.already_given', false);

        $this->assertNotNull(
            $this->consentGivenAt($assignmentId),
            'The ward consenting must record the agreement.'
        );
        $this->assertSame(
            'active',
            DB::table('account_relationships')->where('id', $assignmentId)->value('status'),
        );
    }

    public function test_consenting_twice_is_idempotent(): void
    {
        [, $ward, $assignmentId] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(200);
        $first = $this->consentGivenAt($assignmentId);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(200)
            ->assertJsonPath('data.already_given', true);

        $this->assertSame(
            $first,
            $this->consentGivenAt($assignmentId),
            'A second consent must not move the original timestamp.'
        );
    }

    public function test_the_guardian_cannot_consent_on_the_wards_behalf(): void
    {
        // The entire purpose of the record is the WARD's consent. A guardian
        // consenting for them would make the record worthless.
        [$guardian, , $assignmentId] = $this->makeAssignment();
        Sanctum::actingAs($guardian);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(404);

        $this->assertNull($this->consentGivenAt($assignmentId));
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

        $this->assertNull($this->consentGivenAt($assignmentId));
    }

    public function test_a_revoked_assignment_cannot_be_consented_to(): void
    {
        [, $ward, $assignmentId] = $this->makeAssignment();
        DB::table('account_relationships')->where('id', $assignmentId)
            ->update(['status' => 'revoked']);
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(404);

        // And it no longer appears in the ward's own list.
        $this->assertCount(0, $this->apiGet('/v2/safeguarding/my-guardians')->json('data.guardians'));
    }

    public function test_the_consented_wards_count_can_now_be_non_zero(): void
    {
        // The admin KPI that was once structurally always zero.
        [, $ward, $assignmentId] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $assignmentId])
            ->assertStatus(200);

        $consented = app(\App\Services\GuardianArrangementService::class)
            ->consentedCount($this->testTenantId);

        $this->assertGreaterThan(0, $consented, 'The consented-wards count must be able to reach a non-zero value.');
    }
}
