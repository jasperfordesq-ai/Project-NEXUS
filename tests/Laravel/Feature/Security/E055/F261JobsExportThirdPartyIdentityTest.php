<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Models\JobVacancy;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-261 (E-055 G-1). Owner decision "keep notes, drop reviewer ID": the
 * candidate's jobs GDPR export (GET /v2/jobs/gdpr-export) keeps what the
 * employer wrote about the candidate (reviewer_notes, interviewer_notes) but
 * must not disclose which staff member did it — reviewed_by on applications
 * and proposed_by on interviews are third parties' user ids.
 */
class F261JobsExportThirdPartyIdentityTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function application(int $vacancyId, int $userId, string $message): int
    {
        return (int) DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'vacancy_id' => $vacancyId,
            'user_id' => $userId,
            'message' => $message,
            'status' => 'applied',
            'stage' => 'applied',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_export_keeps_employer_notes_but_drops_staff_identity(): void
    {
        Mail::fake();
        Queue::fake();
        Http::fake();

        $owner = $this->member();
        $candidate = $this->member();
        $otherCandidate = $this->member();

        $vacancy = JobVacancy::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'status' => 'open',
            'moderation_status' => 'approved',
            'title' => 'F261 vacancy',
        ]);

        $applicationId = $this->application((int) $vacancy->id, (int) $candidate->id, 'F261 own application message');
        $otherApplicationId = $this->application((int) $vacancy->id, (int) $otherCandidate->id, 'F261 other candidate message');

        // The employer records a decision with a note, through the real endpoint.
        $note = 'F261 reviewer note about the candidate';
        Sanctum::actingAs($owner, ['*']);
        $this->apiPut('/v2/jobs/applications/' . $applicationId, [
            'status' => 'screening',
            'notes' => $note,
        ])->assertOk();
        $this->assertSame(
            (int) $owner->id,
            (int) DB::table('job_vacancy_applications')->where('id', $applicationId)->value('reviewed_by')
        );

        foreach ([[$applicationId, 'F261 interview panel note'], [$otherApplicationId, 'F261 other candidate panel note']] as [$appId, $panelNote]) {
            DB::table('job_interviews')->insert([
                'tenant_id' => $this->testTenantId,
                'vacancy_id' => $vacancy->id,
                'application_id' => $appId,
                'proposed_by' => $owner->id,
                'interview_type' => 'video',
                'scheduled_at' => now()->addWeek(),
                'duration_mins' => 30,
                'status' => 'proposed',
                'interviewer_notes' => $panelNote,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        Sanctum::actingAs($candidate, ['*']);
        $export = $this->apiGet('/v2/jobs/gdpr-export');
        $export->assertOk();

        $applications = $export->json('data.applications');
        $interviews = $export->json('data.interviews');
        $this->assertCount(1, $applications);
        $this->assertCount(1, $interviews);

        // Safe: no staff identity.
        $this->assertArrayNotHasKey('reviewed_by', $applications[0]);
        $this->assertArrayNotHasKey('proposed_by', $interviews[0]);

        // Kept (owner decision): the notes written about the candidate.
        $this->assertSame($note, $applications[0]['reviewer_notes']);
        $this->assertSame('F261 interview panel note', $interviews[0]['interviewer_notes']);

        // Control: the candidate's own application data is present.
        $this->assertSame($applicationId, (int) $applications[0]['id']);
        $this->assertSame((int) $candidate->id, (int) $applications[0]['user_id']);
        $this->assertSame('F261 own application message', $applications[0]['message']);
        $this->assertSame('screening', $applications[0]['status']);
        $this->assertSame('F261 vacancy', $applications[0]['vacancy']['title']);
        $this->assertSame($applicationId, (int) $interviews[0]['application_id']);

        // Control: another candidate's data never appears.
        $body = $export->getContent();
        $this->assertStringNotContainsString('F261 other candidate message', $body);
        $this->assertStringNotContainsString('F261 other candidate panel note', $body);
    }
}
