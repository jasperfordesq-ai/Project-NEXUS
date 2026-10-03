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
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * The queued copy of a support report into the Jira Service Management help
 * desk. Jira is always faked here — no test talks to the real service.
 */
class SupportReportJiraTicketTest extends TestCase
{
    use DatabaseTransactions;

    private const BASE = 'https://jira.example.test';
    private const TOKEN = 'jira-token-must-never-leak';

    protected function setUp(): void
    {
        parent::setUp();
        // A call the fake Jira does not answer must fail, never reach the network.
        Http::preventStrayRequests();
        config([
            'support_jira.enabled' => true,
            'support_jira.send_member_email' => false,
            'support_jira.site_url' => self::BASE,
            'support_jira.cloud_id' => '',
            'support_jira.service_desk_id' => '2',
            'support_jira.email' => 'service-account@example.test',
            'support_jira.api_token' => self::TOKEN,
        ]);
    }

    public function test_creates_a_ticket_under_the_service_account_without_member_identity(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'member-' . uniqid('', true) . '@example.test',
        ]);
        $reportId = $this->insertReport($member, [
            'impact' => 'blocked',
            'diagnostics' => json_encode(['captured_at' => '2026-10-02T10:00:00+00:00', 'payload' => ['console' => [['message' => 'Boom']]]]),
        ]);
        $this->fakeJira();

        $this->runJob($reportId);

        $create = $this->recorded('/rest/servicedeskapi/request', 'POST');
        $this->assertNotNull($create, 'no Jira request was created');
        $body = $create->data();
        $this->assertSame('2', (string) $body['serviceDeskId']);
        $this->assertSame('5', (string) $body['requestTypeId']);
        $this->assertSame('Wallet page will not load', $body['requestFieldValues']['summary']);
        $this->assertArrayNotHasKey('raiseOnBehalfOf', $body);

        $description = $body['requestFieldValues']['description'];
        $this->assertStringContainsString('NXR-T-JIRA01', $description);
        $this->assertStringContainsString('Platform user id: ' . $member->id, $description);
        $this->assertStringContainsString('/hour-timebank/wallet', $description);
        $this->assertStringContainsString('https://example.sentry.io/issues/1', $description);

        $everything = $this->allRecordedBodies();
        $this->assertStringNotContainsString($member->email, $everything);
        $this->assertStringNotContainsString('ip-hash-value', $everything);
        $this->assertStringNotContainsString('Boom', $description, 'diagnostics belong in the attachment, not the description');

        $row = DB::table('support_reports')->where('id', $reportId)->first();
        $this->assertSame('HELP-42', $row->jira_issue_key);
        $this->assertNotNull($row->jira_synced_at);
        $this->assertNull($row->jira_last_error);
    }

    public function test_sets_priority_and_community_label_on_the_ticket(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $reportId = $this->insertReport($member, ['impact' => 'blocked']);
        $this->fakeJira();

        $this->runJob($reportId);

        $edit = $this->recorded('/rest/api/3/issue/HELP-42', 'PUT');
        $this->assertNotNull($edit, 'priority and labels were not set');
        $this->assertSame('Highest', $edit->data()['fields']['priority']['name']);
        $labels = $edit->data()['fields']['labels'];
        $this->assertContains('nexus-in-app', $labels);
        $this->assertNotEmpty(array_filter($labels, fn ($l) => str_starts_with($l, 'tenant-')));
    }

    public function test_question_uses_its_own_request_type_and_no_priority(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $reportId = $this->insertReport($member, ['request_type' => 'how_to']);
        $this->fakeJira();

        $this->runJob($reportId);

        $this->assertSame('6', (string) $this->recorded('/rest/servicedeskapi/request', 'POST')->data()['requestTypeId']);
        $edit = $this->recorded('/rest/api/3/issue/HELP-42', 'PUT');
        $this->assertArrayNotHasKey('priority', $edit->data()['fields']);
    }

    public function test_attaches_diagnostics_as_a_json_file_only_when_present(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $withDiagnostics = $this->insertReport($member, [
            'diagnostics' => json_encode(['captured_at' => '2026-10-02T10:00:00+00:00', 'payload' => ['api' => []]]),
        ]);
        $this->fakeJira();
        $this->runJob($withDiagnostics);

        $this->assertNotNull($this->recorded('/rest/servicedeskapi/servicedesk/2/attachTemporaryFile', 'POST'));
        $attach = $this->recorded('/rest/servicedeskapi/request/HELP-42/attachment', 'POST');
        $this->assertNotNull($attach);
        $this->assertSame(['temp-1'], $attach->data()['temporaryAttachmentIds']);

        $without = $this->insertReport($member, ['reference' => 'NXR-T-JIRA02']);
        $this->fakeJira();
        $this->runJob($without);
        $this->assertNull($this->recorded('/rest/servicedeskapi/servicedesk/2/attachTemporaryFile', 'POST'));
    }

    public function test_raises_the_ticket_for_the_member_when_the_email_switch_is_on(): void
    {
        config(['support_jira.send_member_email' => true]);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'reply-to-me-' . uniqid('', true) . '@example.test',
        ]);
        $reportId = $this->insertReport($member);
        $this->fakeJira();

        $this->runJob($reportId);

        // Raised directly in the member's email address: Jira creates the
        // customer. The separate "create customer" API needs a Jira admin.
        $this->assertSame($member->email, $this->recorded('/rest/servicedeskapi/request', 'POST')->data()['raiseOnBehalfOf']);
        $this->assertNull($this->recorded('/rest/servicedeskapi/customer', 'POST'));
        $this->assertNull($this->recorded('/rest/servicedeskapi/servicedesk/2/customer', 'POST'));
    }

    public function test_if_jira_refuses_the_members_name_the_ticket_is_raised_by_the_platform_instead(): void
    {
        config(['support_jira.send_member_email' => true]);
        $mailer = new SupportReportJiraTicketRecordingMailer();
        app()->instance(EmailDispatchService::class, $mailer);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'refused-' . uniqid('', true) . '@example.test',
        ]);
        $reportId = $this->insertReport($member);
        Http::fake([
            self::BASE . '/rest/servicedeskapi/request' => Http::sequence()
                ->push(['errorMessage' => 'Cannot add customer accounts to Jira Service Management'], 400)
                ->push(['issueKey' => 'HELP-43'], 201),
            self::BASE . '/rest/api/3/issue/HELP-43' => Http::response(null, 204),
        ]);

        $this->runJob($reportId);

        $creates = Http::recorded(fn (Request $r) => $r->method() === 'POST' && parse_url($r->url(), PHP_URL_PATH) === '/rest/servicedeskapi/request');
        $this->assertCount(2, $creates);
        $this->assertSame($member->email, $creates->first()[0]->data()['raiseOnBehalfOf']);
        $this->assertArrayNotHasKey('raiseOnBehalfOf', $creates->last()[0]->data());

        $row = DB::table('support_reports')->where('id', $reportId)->first();
        $this->assertSame('HELP-43', $row->jira_issue_key);
        $this->assertStringContainsString('NOT in the member', (string) $row->jira_last_error);
        $this->assertStringContainsString('Cannot add customer accounts', (string) $row->jira_last_error);

        // The platform receipt was already sent when the request was saved;
        // the fallback must not send a second one.
        $this->assertCount(0, array_filter($mailer->calls, fn (array $c) => $c['to'] === $member->email));
    }

    public function test_a_jira_outage_records_the_error_and_rethrows_so_the_queue_retries(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $reportId = $this->insertReport($member);
        Http::fake([self::BASE . '/*' => Http::response(['errorMessage' => 'Service unavailable'], 503)]);

        try {
            $this->runJob($reportId);
            $this->fail('the job swallowed a Jira outage');
        } catch (\RuntimeException $e) {
            $this->assertStringNotContainsString(self::TOKEN, $e->getMessage());
        }

        $row = DB::table('support_reports')->where('id', $reportId)->first();
        $this->assertNull($row->jira_issue_key);
        $this->assertNotNull($row->jira_last_error);
        $this->assertStringContainsString('503', $row->jira_last_error);
        $this->assertStringNotContainsString(self::TOKEN, $row->jira_last_error);
    }

    public function test_a_report_already_copied_is_not_copied_again(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $reportId = $this->insertReport($member, ['jira_issue_key' => 'HELP-7']);
        Http::fake();

        $this->runJob($reportId);

        Http::assertNothingSent();
    }

    public function test_nothing_is_sent_when_the_connection_is_switched_off(): void
    {
        config(['support_jira.enabled' => false]);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $reportId = $this->insertReport($member);
        Http::fake();

        $this->runJob($reportId);

        Http::assertNothingSent();
        $this->assertNull(DB::table('support_reports')->where('id', $reportId)->value('jira_issue_key'));
    }

    public function test_missing_credentials_are_recorded_without_calling_jira(): void
    {
        config(['support_jira.api_token' => '']);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $reportId = $this->insertReport($member);
        Http::fake();

        $this->runJob($reportId);

        Http::assertNothingSent();
        $this->assertNotNull(DB::table('support_reports')->where('id', $reportId)->value('jira_last_error'));
    }

    public function test_the_job_only_finds_the_report_in_its_own_community(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $reportId = $this->insertReport($member);
        Http::fake();

        (new CreateSupportJiraTicket($reportId, $this->testTenantId + 999_999))->handle();

        Http::assertNothingSent();
    }

    public function test_admin_detail_shows_the_jira_ticket(): void
    {
        $admin = User::factory()->admin()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $reportId = $this->insertReport($member, ['jira_issue_key' => 'HELP-9', 'request_type' => 'account']);
        \Laravel\Sanctum\Sanctum::actingAs($admin, ['*']);

        $detail = $this->apiGet('/v2/admin/support-reports/' . $reportId);

        $detail->assertOk();
        $detail->assertJsonPath('data.jira_issue_key', 'HELP-9');
        $detail->assertJsonPath('data.jira_issue_url', self::BASE . '/browse/HELP-9');
        $detail->assertJsonPath('data.request_type', 'account');
    }

    private function runJob(int $reportId): void
    {
        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->handle();
    }

    private function fakeJira(bool $customerExists = false): void
    {
        Http::fake([
            self::BASE . '/rest/servicedeskapi/customer' => $customerExists
                ? Http::response(['errorMessage' => 'An account already exists for this email'], 400)
                : Http::response(['accountId' => 'acct-member'], 201),
            self::BASE . '/rest/api/3/user/search*' => Http::response([['accountId' => 'acct-existing']], 200),
            // GET: not yet a customer of this desk (so the user search is used);
            // POST: adding the customer to the desk.
            self::BASE . '/rest/servicedeskapi/servicedesk/2/customer*' => fn (Request $r) => $r->method() === 'GET'
                ? Http::response(['values' => []], 200)
                : Http::response(null, 204),
            self::BASE . '/rest/servicedeskapi/request' => Http::response(['issueKey' => 'HELP-42', 'issueId' => '10042'], 201),
            self::BASE . '/rest/api/3/issue/HELP-42' => Http::response(null, 204),
            self::BASE . '/rest/servicedeskapi/servicedesk/2/attachTemporaryFile' => Http::response(['temporaryAttachments' => [['temporaryAttachmentId' => 'temp-1']]], 201),
            self::BASE . '/rest/servicedeskapi/request/HELP-42/attachment' => Http::response([], 201),
        ]);
    }

    private function recorded(string $path, string $method): ?Request
    {
        $match = Http::recorded(fn (Request $r) => $r->method() === $method && parse_url($r->url(), PHP_URL_PATH) === $path);

        return $match->isEmpty() ? null : $match->last()[0];
    }

    private function allRecordedBodies(): string
    {
        return Http::recorded()->map(fn ($pair) => $pair[0]->url() . ' ' . $pair[0]->body())->implode("\n");
    }

    private function insertReport(User $member, array $overrides = []): int
    {
        return (int) DB::table('support_reports')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'reference' => 'NXR-T-JIRA01',
            'source' => 'in_app',
            'request_type' => 'broken',
            'summary' => 'Wallet page will not load',
            'description' => 'The wallet page shows a spinner for ever when I open it.',
            'impact' => 'major',
            'status' => 'open',
            'route' => '/hour-timebank/wallet',
            'page_url' => 'https://app.project-nexus.ie/hour-timebank/wallet',
            'sentry_issue_url' => 'https://example.sentry.io/issues/1',
            'ip_hash' => 'ip-hash-value',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }
}

class SupportReportJiraTicketRecordingMailer extends EmailDispatchService
{
    public array $calls = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->calls[] = compact('to', 'subject', 'body', 'options');

        return true;
    }
}
