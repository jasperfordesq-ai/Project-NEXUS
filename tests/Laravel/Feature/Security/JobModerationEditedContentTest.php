<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Events\JobVacancyCreated;
use App\Models\User;
use App\Services\JobVacancyService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Laravel\TestCase;

/**
 * F-214: an employer cannot retain an old approval after changing the job ad.
 */
class JobModerationEditedContentTest extends TestCase
{
    use DatabaseTransactions;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([JobVacancyCreated::class]);

        $config = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('configuration'), true) ?: [];
        $config['jobs'] = array_merge($config['jobs'] ?? [], [
            'moderation_enabled' => true,
            'spam_detection' => false,
        ]);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        TenantContext::setById($this->testTenantId);

        $this->member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'member',
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function approvedJob(string $status = 'open'): int
    {
        $service = app(JobVacancyService::class);
        $id = $service->create($this->member->id, [
            'title' => 'Reviewed volunteer role ' . uniqid(),
            'description' => 'The content that an administrator reviewed.',
            'type' => 'volunteer',
            'commitment' => 'flexible',
            'status' => 'draft',
        ]);
        $this->assertGreaterThan(0, (int) $id, json_encode($service->getErrors()));
        DB::table('job_vacancies')->where('id', $id)->update([
            'status' => $status,
            'moderation_status' => 'approved',
        ]);

        return (int) $id;
    }

    public function test_editing_approved_open_job_content_removes_it_from_publication(): void
    {
        $id = $this->approvedJob();

        $this->assertTrue(app(JobVacancyService::class)->update($id, $this->member->id, [
            'description' => 'Different content that has not been reviewed.',
        ]));

        $row = DB::table('job_vacancies')->where('id', $id)->first();
        $this->assertSame('draft', $row->status);
        $this->assertSame('pending_review', $row->moderation_status);
    }

    public function test_unchanged_content_does_not_invalidate_approval(): void
    {
        $id = $this->approvedJob();

        $this->assertTrue(app(JobVacancyService::class)->update($id, $this->member->id, [
            'description' => 'The content that an administrator reviewed.',
        ]));

        $row = DB::table('job_vacancies')->where('id', $id)->first();
        $this->assertSame('open', $row->status);
        $this->assertSame('approved', $row->moderation_status);
    }

    public function test_editing_a_closed_approved_job_requires_review_on_reopening(): void
    {
        $id = $this->approvedJob('closed');
        $service = app(JobVacancyService::class);

        $this->assertTrue($service->update($id, $this->member->id, [
            'description' => 'A changed description while the job is closed.',
        ]));
        $closed = DB::table('job_vacancies')->where('id', $id)->first();
        $this->assertSame('closed', $closed->status);
        $this->assertNull($closed->moderation_status);

        $this->assertTrue($service->update($id, $this->member->id, ['status' => 'open']));
        $reopened = DB::table('job_vacancies')->where('id', $id)->first();
        $this->assertSame('draft', $reopened->status);
        $this->assertSame('pending_review', $reopened->moderation_status);
    }
}
