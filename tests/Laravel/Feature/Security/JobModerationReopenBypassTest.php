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
 * F-211: with job moderation on, a job saved as a draft and then set to "open"
 * must go to review, not straight to the public list.
 *
 * `create()` only routes a job to review when it is created as `open`; a draft
 * is stored with no moderation status. `update()` then let the owner change the
 * status to `open` without review, and the public list admits a NULL moderation
 * status — so "save as draft, then publish" skipped moderation entirely.
 */
class JobModerationReopenBypassTest extends TestCase
{
    use DatabaseTransactions;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([JobVacancyCreated::class]);

        $config = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('configuration'), true) ?: [];
        $config['jobs'] = array_merge($config['jobs'] ?? [], ['moderation_enabled' => true]);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        TenantContext::setById($this->testTenantId);

        $this->member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'member',
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function draftJob(): int
    {
        $service = app(JobVacancyService::class);
        $id = $service->create($this->member->id, [
            'title' => 'F-211 moderation job ' . uniqid(),
            'description' => 'A volunteer role used by the moderation regression test.',
            'type' => 'volunteer',
            'commitment' => 'flexible',
            'status' => 'draft',
        ]);
        $this->assertGreaterThan(0, (int) $id, json_encode($service->getErrors()));

        return (int) $id;
    }

    public function test_publishing_a_draft_under_moderation_sends_it_to_review(): void
    {
        $id = $this->draftJob();

        $this->assertTrue(app(JobVacancyService::class)->update($id, $this->member->id, ['status' => 'open']));

        $row = DB::table('job_vacancies')->where('id', $id)->first();
        $this->assertSame('pending_review', $row->moderation_status);
        $this->assertNotSame('open', $row->status, 'the job must not be publicly open before review');
    }

    public function test_an_approved_job_can_be_reopened_without_a_second_review(): void
    {
        $id = $this->draftJob();
        DB::table('job_vacancies')->where('id', $id)->update(['status' => 'closed', 'moderation_status' => 'approved']);

        $this->assertTrue(app(JobVacancyService::class)->update($id, $this->member->id, ['status' => 'open']));

        $row = DB::table('job_vacancies')->where('id', $id)->first();
        $this->assertSame('open', $row->status);
        $this->assertSame('approved', $row->moderation_status);
    }
}
