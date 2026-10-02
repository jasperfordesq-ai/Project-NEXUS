<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Jobs\CreateSupportJiraTicket;
use App\Models\User;
use App\Services\SupportJiraTicketService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * Where the platform sends Jira calls. An Atlassian *service account* token is
 * scoped and only works through the platform gateway
 * (https://api.atlassian.com/ex/jira/{cloudId}); a classic user token works on
 * the site address. Links shown to admins always use the site address.
 */
class SupportJiraConnectionTest extends TestCase
{
    use DatabaseTransactions;

    private const SITE = 'https://helpdesk.example.test';
    private const CLOUD = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
    private const GATEWAY = 'https://api.atlassian.com/ex/jira/' . self::CLOUD;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'support_jira.enabled' => true,
            'support_jira.send_member_email' => false,
            'support_jira.site_url' => self::SITE,
            'support_jira.cloud_id' => self::CLOUD,
            'support_jira.service_desk_id' => '2',
            'support_jira.email' => 'bot@serviceaccount.atlassian.com',
            'support_jira.api_token' => 'scoped-token',
        ]);
    }

    public function test_a_service_account_token_goes_through_the_atlassian_gateway(): void
    {
        $reportId = $this->insertReport();
        Http::fake([
            self::GATEWAY . '/rest/servicedeskapi/request' => Http::response(['issueKey' => 'HELP-5'], 201),
            self::GATEWAY . '/rest/api/3/issue/HELP-5' => Http::response(null, 204),
        ]);

        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->handle();

        Http::assertSent(fn (Request $r) => $r->url() === self::GATEWAY . '/rest/servicedeskapi/request');
        Http::assertNotSent(fn (Request $r) => str_starts_with($r->url(), self::SITE));
        $this->assertSame('HELP-5', DB::table('support_reports')->where('id', $reportId)->value('jira_issue_key'));
    }

    public function test_the_status_check_also_goes_through_the_gateway(): void
    {
        DB::table('support_reports')->whereNotNull('jira_issue_key')->update(['jira_issue_key' => null]);
        $this->insertReport(['jira_issue_key' => 'HELP-6']);
        Http::fake([self::GATEWAY . '/rest/api/3/search/jql' => Http::response(['issues' => []], 200)]);

        app(SupportJiraTicketService::class)->syncStatuses();

        Http::assertSent(fn (Request $r) => $r->url() === self::GATEWAY . '/rest/api/3/search/jql');
    }

    public function test_without_a_cloud_id_calls_go_to_the_site_address(): void
    {
        config(['support_jira.cloud_id' => '']);
        $reportId = $this->insertReport();
        Http::fake([
            self::SITE . '/rest/servicedeskapi/request' => Http::response(['issueKey' => 'HELP-7'], 201),
            self::SITE . '/rest/api/3/issue/HELP-7' => Http::response(null, 204),
        ]);

        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->handle();

        Http::assertSent(fn (Request $r) => $r->url() === self::SITE . '/rest/servicedeskapi/request');
    }

    public function test_links_for_admins_use_the_site_address_not_the_gateway(): void
    {
        $this->assertSame(self::SITE . '/browse/HELP-8', app(SupportJiraTicketService::class)->issueUrl('HELP-8'));
    }

    public function test_a_cloud_id_that_is_not_a_uuid_is_refused_rather_than_built_into_a_url(): void
    {
        config(['support_jira.cloud_id' => '../../evil']);
        $reportId = $this->insertReport();
        Http::fake();

        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->handle();

        Http::assertNothingSent();
        $this->assertStringContainsString('SUPPORT_JIRA_CLOUD_ID', (string) DB::table('support_reports')->where('id', $reportId)->value('jira_last_error'));
    }

    public function test_the_site_address_is_still_required_for_admin_links(): void
    {
        config(['support_jira.site_url' => '']);
        $reportId = $this->insertReport();
        Http::fake();

        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->handle();

        Http::assertNothingSent();
        $this->assertStringContainsString('SUPPORT_JIRA_SITE_URL', (string) DB::table('support_reports')->where('id', $reportId)->value('jira_last_error'));
    }

    private function insertReport(array $overrides = []): int
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();

        return (int) DB::table('support_reports')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'reference' => 'NXR-C-' . strtoupper(bin2hex(random_bytes(4))),
            'source' => 'in_app',
            'request_type' => 'broken',
            'summary' => 'Gateway check',
            'description' => 'A report used to check where Jira calls are sent.',
            'impact' => 'minor',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }
}
