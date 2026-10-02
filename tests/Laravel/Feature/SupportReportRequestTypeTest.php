<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Jobs\CreateSupportJiraTicket;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * "Help & support": one entry point, four kinds of request, a per-member daily
 * cap, and — behind SUPPORT_JIRA_ENABLED — a queued copy to the Jira help desk.
 */
class SupportReportRequestTypeTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        app()->instance(EmailDispatchService::class, new SupportReportRequestTypeSilentMailer());
        Queue::fake();
        config(['support_jira.enabled' => false, 'support_jira.daily_member_limit' => 5]);
    }

    public function test_request_type_defaults_to_broken_for_existing_clients(): void
    {
        $member = $this->actingMember();

        $this->apiPost('/v2/support/reports', $this->brokenPayload())->assertCreated();

        $this->assertSame('broken', $this->latestRowFor($member)->request_type);
    }

    public function test_question_needs_no_impact_and_never_stores_diagnostics(): void
    {
        $member = $this->actingMember();

        $response = $this->apiPost('/v2/support/reports', [
            'request_type' => 'how_to',
            'summary' => 'How do I join a group?',
            'description' => 'I cannot see where to ask to join a group on my phone.',
            'include_diagnostics' => true,
            'diagnostics' => ['console' => [['message' => 'should not be stored']]],
        ]);

        $response->assertCreated();
        $row = $this->latestRowFor($member);
        $this->assertSame('how_to', $row->request_type);
        $this->assertNull($row->diagnostics);
    }

    public function test_broken_still_requires_an_impact(): void
    {
        $this->actingMember();
        $payload = $this->brokenPayload();
        unset($payload['impact']);

        $this->apiPost('/v2/support/reports', $payload)->assertStatus(422);
    }

    public function test_unknown_request_type_is_refused(): void
    {
        $this->actingMember();

        $this->apiPost('/v2/support/reports', $this->brokenPayload(['request_type' => 'complaint']))
            ->assertStatus(422);
    }

    public function test_member_is_limited_to_five_reports_a_day(): void
    {
        $member = $this->actingMember();
        for ($i = 0; $i < 5; $i++) {
            $this->insertReport($member, now()->subHours(2));
        }

        $response = $this->apiPost('/v2/support/reports', $this->brokenPayload());

        $response->assertStatus(429);
        $response->assertJsonPath('errors.0.code', 'SUPPORT_REPORT_DAILY_LIMIT');
        $this->assertSame(5, DB::table('support_reports')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->count());
    }

    public function test_reports_older_than_a_day_do_not_count_toward_the_limit(): void
    {
        $member = $this->actingMember();
        for ($i = 0; $i < 5; $i++) {
            $this->insertReport($member, now()->subHours(25));
        }

        $this->apiPost('/v2/support/reports', $this->brokenPayload())->assertCreated();
    }

    public function test_another_members_reports_do_not_count_toward_the_limit(): void
    {
        $other = User::factory()->forTenant($this->testTenantId)->create();
        for ($i = 0; $i < 5; $i++) {
            $this->insertReport($other, now()->subHour());
        }
        $this->actingMember();

        $this->apiPost('/v2/support/reports', $this->brokenPayload())->assertCreated();
    }

    public function test_no_jira_job_is_queued_while_the_connection_is_switched_off(): void
    {
        $this->actingMember();

        $this->apiPost('/v2/support/reports', $this->brokenPayload())->assertCreated();

        Queue::assertNotPushed(CreateSupportJiraTicket::class);
    }

    public function test_a_jira_job_is_queued_for_the_saved_report_when_switched_on(): void
    {
        config(['support_jira.enabled' => true]);
        $this->actingMember();

        $response = $this->apiPost('/v2/support/reports', $this->brokenPayload());

        $response->assertCreated();
        $reportId = (int) $response->json('data.report.id');
        Queue::assertPushed(
            CreateSupportJiraTicket::class,
            fn (CreateSupportJiraTicket $job) => $job->reportId === $reportId && $job->tenantId === $this->testTenantId,
        );
    }

    private function actingMember(): User
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member, ['*']);

        return $member;
    }

    private function brokenPayload(array $overrides = []): array
    {
        return array_merge([
            'summary' => 'Wallet page will not load',
            'description' => 'The wallet page shows a spinner for ever when I open it.',
            'impact' => 'major',
            'include_diagnostics' => false,
        ], $overrides);
    }

    private function latestRowFor(User $member): object
    {
        $row = DB::table('support_reports')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($row);

        return $row;
    }

    private function insertReport(User $member, \DateTimeInterface $createdAt): void
    {
        DB::table('support_reports')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'reference' => 'NXR-T-' . strtoupper(bin2hex(random_bytes(5))),
            'source' => 'in_app',
            'summary' => 'Earlier report',
            'description' => 'An earlier report from the same member.',
            'impact' => 'minor',
            'status' => 'open',
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);
    }
}

class SupportReportRequestTypeSilentMailer extends EmailDispatchService
{
    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        return true;
    }
}
