<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Models\User;
use App\Services\SupportJiraTicketService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * Jira → platform status mirror. Jira is the one place a copied report is
 * answered; the platform reads ticket status back and never writes to Jira.
 */
class SupportReportJiraStatusSyncTest extends TestCase
{
    use DatabaseTransactions;

    private const BASE = 'https://jira.example.test';

    protected function setUp(): void
    {
        parent::setUp();
        // A call the fake Jira does not answer must fail, never reach the network.
        Http::preventStrayRequests();
        config([
            'support_jira.enabled' => true,
            'support_jira.site_url' => self::BASE,
            'support_jira.cloud_id' => '',
            'support_jira.service_desk_id' => '2',
            'support_jira.email' => 'service-account@example.test',
            'support_jira.api_token' => 'token',
        ]);
        // Only this test's rows are considered: earlier fixtures may hold keys.
        DB::table('support_reports')->whereNotNull('jira_issue_key')->update(['jira_issue_key' => null]);
    }

    public function test_a_ticket_done_in_jira_resolves_the_platform_report(): void
    {
        $id = $this->insertLinkedReport('HELP-101', 'open');
        $this->fakeSearch(['HELP-101' => ['Resolved', 'done']]);

        $result = app(SupportJiraTicketService::class)->syncStatuses();

        $row = DB::table('support_reports')->where('id', $id)->first();
        $this->assertSame('resolved', $row->status);
        $this->assertNotNull($row->resolved_at);
        $this->assertSame('Resolved', $row->jira_status);
        $this->assertNotNull($row->jira_status_checked_at);
        $this->assertSame(1, $result['updated']);
    }

    public function test_a_ticket_still_open_in_jira_records_its_status_without_changing_the_report(): void
    {
        $id = $this->insertLinkedReport('HELP-102', 'open');
        $this->fakeSearch(['HELP-102' => ['In Progress', 'indeterminate']]);

        app(SupportJiraTicketService::class)->syncStatuses();

        $row = DB::table('support_reports')->where('id', $id)->first();
        $this->assertSame('open', $row->status);
        $this->assertSame('In Progress', $row->jira_status);
    }

    public function test_a_ticket_reopened_in_jira_moves_the_report_back_to_triaged(): void
    {
        $id = $this->insertLinkedReport('HELP-103', 'resolved', ['resolved_at' => now()->subDay()]);
        $this->fakeSearch(['HELP-103' => ['Waiting for support', 'indeterminate']]);

        app(SupportJiraTicketService::class)->syncStatuses();

        $row = DB::table('support_reports')->where('id', $id)->first();
        $this->assertSame('triaged', $row->status);
        $this->assertNull($row->resolved_at);
    }

    public function test_a_report_closed_on_the_platform_is_left_alone(): void
    {
        $id = $this->insertLinkedReport('HELP-104', 'closed');
        $this->fakeSearch(['HELP-104' => ['Open', 'new']]);

        app(SupportJiraTicketService::class)->syncStatuses();

        $this->assertSame('closed', DB::table('support_reports')->where('id', $id)->value('status'));
        Http::assertNothingSent();
    }

    public function test_the_platform_only_reads_from_jira_and_never_writes(): void
    {
        $this->insertLinkedReport('HELP-105', 'open');
        $this->fakeSearch(['HELP-105' => ['Resolved', 'done']]);

        app(SupportJiraTicketService::class)->syncStatuses();

        Http::assertSentCount(1);
        Http::assertSent(function (Request $r) {
            return $r->method() === 'POST'
                && parse_url($r->url(), PHP_URL_PATH) === '/rest/api/3/search/jql'
                && str_contains($r->data()['jql'], 'HELP-105');
        });
    }

    public function test_reports_in_every_community_are_checked_and_each_keeps_its_own_tenant(): void
    {
        $otherTenant = random_int(20000, 90000);
        DB::table('tenants')->insertOrIgnore([
            'id' => $otherTenant, 'name' => 'Sync Test ' . $otherTenant, 'slug' => 'sync-test-' . $otherTenant,
            'domain' => null, 'is_active' => true, 'depth' => 0, 'allows_subtenants' => false,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $own = $this->insertLinkedReport('HELP-106', 'open');
        $other = $this->insertLinkedReport('HELP-107', 'open', [], $otherTenant);
        $this->fakeSearch(['HELP-106' => ['Resolved', 'done'], 'HELP-107' => ['Resolved', 'done']]);

        app(SupportJiraTicketService::class)->syncStatuses();

        $this->assertSame('resolved', DB::table('support_reports')->where('id', $own)->value('status'));
        $this->assertSame('resolved', DB::table('support_reports')->where('id', $other)->value('status'));
        $this->assertSame($otherTenant, (int) DB::table('support_reports')->where('id', $other)->value('tenant_id'));
    }

    public function test_nothing_is_asked_while_the_connection_is_switched_off(): void
    {
        config(['support_jira.enabled' => false]);
        $this->insertLinkedReport('HELP-108', 'open');
        Http::fake();

        $result = app(SupportJiraTicketService::class)->syncStatuses();

        Http::assertNothingSent();
        $this->assertSame(0, $result['checked']);
    }

    public function test_a_jira_outage_changes_nothing_and_is_reported(): void
    {
        $id = $this->insertLinkedReport('HELP-109', 'open');
        Http::fake([self::BASE . '/*' => Http::response(['errorMessages' => ['down']], 503)]);

        $result = app(SupportJiraTicketService::class)->syncStatuses();

        $this->assertSame('open', DB::table('support_reports')->where('id', $id)->value('status'));
        $this->assertSame(1, $result['failed_batches']);
    }

    public function test_the_scheduled_command_runs_the_sync(): void
    {
        $id = $this->insertLinkedReport('HELP-110', 'open');
        $this->fakeSearch(['HELP-110' => ['Resolved', 'done']]);

        $this->artisan('support:jira-sync-status')->assertExitCode(0);

        $this->assertSame('resolved', DB::table('support_reports')->where('id', $id)->value('status'));
    }

    public function test_admin_view_shows_the_jira_status(): void
    {
        $admin = User::factory()->admin()->forTenant($this->testTenantId)->create();
        $id = $this->insertLinkedReport('HELP-111', 'open', ['jira_status' => 'Waiting for customer']);
        \Laravel\Sanctum\Sanctum::actingAs($admin, ['*']);

        $this->apiGet('/v2/admin/support-reports/' . $id)
            ->assertOk()
            ->assertJsonPath('data.jira_status', 'Waiting for customer');
    }

    public function test_admin_cannot_change_the_status_of_a_report_handled_in_jira_but_can_close_it(): void
    {
        $admin = User::factory()->admin()->forTenant($this->testTenantId)->create();
        $id = $this->insertLinkedReport('HELP-112', 'open');
        \Laravel\Sanctum\Sanctum::actingAs($admin, ['*']);

        $this->apiPut('/v2/admin/support-reports/' . $id, ['status' => 'resolved'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'SUPPORT_REPORT_HANDLED_IN_JIRA');
        $this->assertSame('open', DB::table('support_reports')->where('id', $id)->value('status'));

        $this->apiPut('/v2/admin/support-reports/' . $id, ['triage_notes' => 'Chased by phone.'])->assertOk();
        $this->apiPut('/v2/admin/support-reports/' . $id, ['status' => 'closed'])->assertOk();
        $this->assertSame('closed', DB::table('support_reports')->where('id', $id)->value('status'));
    }

    /**
     * @param array<string, array{0:string,1:string}> $statuses key => [name, category key]
     */
    private function fakeSearch(array $statuses): void
    {
        $issues = [];
        foreach ($statuses as $key => [$name, $category]) {
            $issues[] = ['key' => $key, 'fields' => ['status' => ['name' => $name, 'statusCategory' => ['key' => $category]]]];
        }

        Http::fake([self::BASE . '/rest/api/3/search/jql' => Http::response(['issues' => $issues, 'isLast' => true], 200)]);
    }

    private function insertLinkedReport(string $key, string $status, array $overrides = [], ?int $tenantId = null): int
    {
        $tenantId ??= $this->testTenantId;
        $member = User::factory()->forTenant($tenantId)->create();

        return (int) DB::table('support_reports')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'user_id' => $member->id,
            'reference' => 'NXR-S-' . $key,
            'source' => 'in_app',
            'request_type' => 'broken',
            'summary' => 'Synced report',
            'description' => 'A report already copied to the Jira help desk.',
            'impact' => 'minor',
            'status' => $status,
            'jira_issue_key' => $key,
            'jira_synced_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }
}
