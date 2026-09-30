<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-065 F-361 — deleting a job vacancy must take the applicants' uploaded CVs
 * with it.
 *
 * Before the fix, JobVacancyService::delete() hard-deleted every
 * job_vacancy_applications row inside one transaction and never looked at
 * cv_path. The CV — typically home address, date of birth and employment
 * history — stayed at storage/app/job-applications/{tenant}/… with NO database
 * row pointing at it, invisible to any retention or erasure process that works
 * from the database. The data destroyed belongs to the applicants, not to the
 * person doing the deleting.
 *
 * The correct pattern is two files away: JobGdprService::eraseUserData()
 * collects cv_path BEFORE the transaction and removes the bytes afterwards.
 */
class F361JobVacancyDeleteRemovesApplicantCvFilesTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $this->app['auth']->forgetGuards();
        foreach (['HTTP_X_TENANT_ID', 'HTTP_X_TENANT_SLUG', 'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $serverKey) {
            unset($_SERVER[$serverKey]);
        }
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['job_vacancies' => true])]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_deleting_a_vacancy_removes_every_applicant_cv_from_disk(): void
    {
        Storage::fake('local');
        $tenantId = $this->testTenantId;
        $employer = $this->member();
        $applicantOne = $this->member();
        $applicantTwo = $this->member();

        $vacancyId = $this->vacancy($tenantId, (int) $employer->id);

        $cvOne = "job-applications/{$tenantId}/e066e-f361-" . uniqid() . '.pdf';
        $cvTwo = "job-applications/{$tenantId}/e066e-f361-" . uniqid() . '.pdf';
        Storage::disk('local')->put($cvOne, 'SYNTHETIC CV: name, home address, employment history');
        Storage::disk('local')->put($cvTwo, 'SYNTHETIC CV: second applicant');
        $applicationOne = $this->application($tenantId, $vacancyId, (int) $applicantOne->id, $cvOne);
        $this->application($tenantId, $vacancyId, (int) $applicantTwo->id, $cvTwo);

        $this->assertTrue(Storage::disk('local')->exists($cvOne), 'fixture: the CV was written');

        Sanctum::actingAs($employer, ['*']);
        $this->apiDelete("/v2/jobs/{$vacancyId}")->assertStatus(204);

        $this->assertDatabaseMissing('job_vacancy_applications', ['id' => $applicationOne]);
        $this->assertFalse(
            Storage::disk('local')->exists($cvOne),
            "F-361: the applicant's CV must not outlive the row that named it"
        );
        $this->assertFalse(
            Storage::disk('local')->exists($cvTwo),
            "F-361: every applicant's CV must go, not just the first"
        );
    }

    public function test_a_refused_delete_leaves_the_applicant_cv_alone(): void
    {
        Storage::fake('local');
        $tenantId = $this->testTenantId;
        $employer = $this->member();
        $applicant = $this->member();
        $outsider = $this->member();

        $vacancyId = $this->vacancy($tenantId, (int) $employer->id);
        $cvPath = "job-applications/{$tenantId}/e066e-f361-" . uniqid() . '.pdf';
        Storage::disk('local')->put($cvPath, 'SYNTHETIC CV: name, home address, employment history');
        $applicationId = $this->application($tenantId, $vacancyId, (int) $applicant->id, $cvPath);

        Sanctum::actingAs($outsider, ['*']);
        $this->apiDelete("/v2/jobs/{$vacancyId}")->assertStatus(403);

        $this->assertTrue(
            Storage::disk('local')->exists($cvPath),
            'CONTROL: a refused delete must not touch the applicant CV'
        );
        $this->assertDatabaseHas('job_vacancy_applications', ['id' => $applicationId]);
    }

    public function test_control_the_applicants_own_erasure_still_removes_the_same_cv(): void
    {
        Storage::fake('local');
        $tenantId = $this->testTenantId;
        $employer = $this->member();
        $applicant = $this->member();

        $vacancyId = $this->vacancy($tenantId, (int) $employer->id);
        $cvPath = "job-applications/{$tenantId}/e066e-f361-" . uniqid() . '.pdf';
        Storage::disk('local')->put($cvPath, 'SYNTHETIC CV: name, home address, employment history');
        $applicationId = $this->application($tenantId, $vacancyId, (int) $applicant->id, $cvPath);

        Sanctum::actingAs($applicant, ['*']);
        $this->apiDelete('/v2/jobs/gdpr-erase-me')->assertStatus(200);

        $this->assertFalse(Storage::disk('local')->exists($cvPath), 'CONTROL: the documented erasure path still works');
        $this->assertDatabaseHas('job_vacancy_applications', ['id' => $applicationId, 'cv_path' => null]);
    }

    // ---------------------------------------------------------------- helpers

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function vacancy(int $tenantId, int $ownerId): int
    {
        return (int) DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $ownerId,
            'title' => 'E065 F-361 vacancy',
            'description' => 'Synthetic vacancy for the E-066 F-361 regression test.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function application(int $tenantId, int $vacancyId, int $applicantId, string $cvPath): int
    {
        return (int) DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id' => $tenantId,
            'vacancy_id' => $vacancyId,
            'user_id' => $applicantId,
            'message' => 'Synthetic cover message.',
            'cv_path' => $cvPath,
            'cv_filename' => 'synthetic-cv.pdf',
            'cv_size' => 64,
            'status' => 'applied',
            'stage' => 'applied',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
