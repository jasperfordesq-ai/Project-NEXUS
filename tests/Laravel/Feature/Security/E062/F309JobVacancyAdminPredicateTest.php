<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E062;

use App\Models\JobVacancy;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-309 (E-062) — JobVacancyService::isAdminUser() re-implemented the admin
 * predicate and omitted the broker/coordinator exclusion that
 * App\Support\Authorization\AdminTier exists to enforce ("they fail closed
 * even when a stale legacy admin flag remains set"). A broker whose legacy
 * users.is_admin flag was still set could read any vacancy's applicant list
 * through the member-facing job routes. It must use AdminTier.
 */
class F309JobVacancyAdminPredicateTest extends TestCase
{
    use DatabaseTransactions;

    private function vacancyWithApplicant(): JobVacancy
    {
        $tid = $this->testTenantId;
        $owner = User::factory()->forTenant($tid)->create(['status' => 'active', 'is_approved' => true]);
        $candidate = User::factory()->forTenant($tid)->create(['status' => 'active', 'is_approved' => true]);
        $vacancy = JobVacancy::factory()->forTenant($tid)->create([
            'user_id' => $owner->id, 'status' => 'open', 'type' => 'volunteer',
        ]);
        DB::table('job_vacancy_applications')->insert([
            'tenant_id' => $tid, 'vacancy_id' => $vacancy->id, 'user_id' => $candidate->id,
            'status' => 'applied', 'stage' => 'applied', 'message' => 'F309 cover letter',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return $vacancy;
    }

    private function signInAs(string $role, bool $staleAdminFlag): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'role' => $role, 'status' => 'active', 'is_approved' => true,
        ]);
        DB::table('users')->where('id', $user->id)->update(['is_admin' => $staleAdminFlag ? 1 : 0]);
        $user->refresh();
        Sanctum::actingAs($user);
    }

    /** @return array<int,array{0:string}> */
    public static function operationalRoles(): array
    {
        return [['broker'], ['coordinator']];
    }

    /** @dataProvider operationalRoles */
    public function test_a_broker_with_a_stale_admin_flag_cannot_read_another_members_applicants(string $role): void
    {
        $vacancy = $this->vacancyWithApplicant();
        $this->signInAs($role, true);

        $this->apiGet("/v2/jobs/{$vacancy->id}/applications")->assertStatus(403);
        $this->apiGet("/v2/jobs/{$vacancy->id}/applications/export-csv")->assertStatus(403);
    }

    public function test_control_an_admin_can_still_read_the_applicants(): void
    {
        $vacancy = $this->vacancyWithApplicant();
        $this->signInAs('admin', false);

        $this->apiGet("/v2/jobs/{$vacancy->id}/applications")->assertStatus(200);
    }

    public function test_control_a_member_with_the_legacy_admin_flag_is_still_an_admin(): void
    {
        // AdminTier keeps honouring the legacy flag for non-operational roles.
        $vacancy = $this->vacancyWithApplicant();
        $this->signInAs('member', true);

        $this->apiGet("/v2/jobs/{$vacancy->id}/applications")->assertStatus(200);
    }
}
