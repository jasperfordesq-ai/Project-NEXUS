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
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The normal ticketing flow: the owner is emailed by Jira (the ticket is
 * assigned to them), the member is emailed by Jira (the ticket is raised in
 * their name), and nobody gets two confirmations. Jira is always faked.
 */
class SupportJiraMemberFlowTest extends TestCase
{
    use DatabaseTransactions;

    private const SITE = 'https://helpdesk.example.test';
    private const OWNER = '712020:owner-account-id';

    private SupportJiraFlowRecordingMailer $mailer;

    protected function setUp(): void
    {
        parent::setUp();
        // A call the fake Jira does not answer must fail, never reach the network.
        Http::preventStrayRequests();
        config([
            'support_jira.enabled' => true,
            'support_jira.send_member_email' => true,
            'support_jira.site_url' => self::SITE,
            'support_jira.cloud_id' => '',
            'support_jira.service_desk_id' => '2',
            'support_jira.email' => 'bot@serviceaccount.atlassian.com',
            'support_jira.api_token' => 'token',
            'support_jira.assignee_account_id' => self::OWNER,
        ]);
        $this->mailer = new SupportJiraFlowRecordingMailer();
        app()->instance(EmailDispatchService::class, $this->mailer);
    }

    public function test_every_new_ticket_is_assigned_to_the_configured_person(): void
    {
        $reportId = $this->insertReport($this->member());
        $this->fakeJira();

        $this->runJob($reportId);

        Http::assertSent(fn (Request $r) => $r->method() === 'PUT'
            && parse_url($r->url(), PHP_URL_PATH) === '/rest/api/3/issue/HELP-50/assignee'
            && $r->data()['accountId'] === self::OWNER);
    }

    public function test_no_assignment_is_attempted_when_nobody_is_configured(): void
    {
        config(['support_jira.assignee_account_id' => '']);
        $reportId = $this->insertReport($this->member());
        $this->fakeJira();

        $this->runJob($reportId);

        Http::assertNotSent(fn (Request $r) => str_ends_with($r->url(), '/assignee'));
    }

    public function test_a_failed_assignment_keeps_the_ticket_and_records_a_warning(): void
    {
        $reportId = $this->insertReport($this->member());
        $this->fakeJira(assignStatus: 400);

        $this->runJob($reportId);

        $row = DB::table('support_reports')->where('id', $reportId)->first();
        $this->assertSame('HELP-50', $row->jira_issue_key);
        $this->assertStringContainsString('assign', (string) $row->jira_last_error);
    }

    public function test_with_member_email_on_the_ticket_names_the_member(): void
    {
        $member = $this->member(['first_name' => 'Aoife', 'last_name' => 'Byrne']);
        $reportId = $this->insertReport($member);
        $this->fakeJira();

        $this->runJob($reportId);

        $create = Http::recorded(fn (Request $r) => $r->method() === 'POST'
            && parse_url($r->url(), PHP_URL_PATH) === '/rest/servicedeskapi/request')->first()[0];
        $this->assertSame('acct-member', $create->data()['raiseOnBehalfOf']);
        $description = $create->data()['requestFieldValues']['description'];
        $this->assertStringContainsString('Aoife Byrne', $description);
        $this->assertStringContainsString($member->email, $description);
    }

    public function test_with_member_email_off_the_ticket_never_names_the_member(): void
    {
        config(['support_jira.send_member_email' => false]);
        $member = $this->member(['first_name' => 'Aoife', 'last_name' => 'Byrne']);
        $reportId = $this->insertReport($member);
        $this->fakeJira();

        $this->runJob($reportId);

        $everything = Http::recorded()->map(fn ($pair) => $pair[0]->body())->implode("\n");
        $this->assertStringNotContainsString('Aoife', $everything);
        $this->assertStringNotContainsString($member->email, $everything);
    }

    public function test_an_existing_help_desk_customer_is_found_in_the_desk_first(): void
    {
        $member = $this->member();
        $reportId = $this->insertReport($member);
        $this->fakeJira(customerExists: true);

        $this->runJob($reportId);

        Http::assertSent(fn (Request $r) => $r->method() === 'GET'
            && parse_url($r->url(), PHP_URL_PATH) === '/rest/servicedeskapi/servicedesk/2/customer');
        $create = Http::recorded(fn (Request $r) => $r->method() === 'POST'
            && parse_url($r->url(), PHP_URL_PATH) === '/rest/servicedeskapi/request')->first()[0];
        $this->assertSame('acct-in-desk', $create->data()['raiseOnBehalfOf']);
    }

    public function test_when_jira_will_email_the_member_the_platform_receipt_is_held_back(): void
    {
        Queue::fake();
        $member = $this->member();
        Sanctum::actingAs($member, ['*']);

        $this->apiPost('/v2/support/reports', [
            'request_type' => 'how_to',
            'summary' => 'Joining a group',
            'description' => 'Where do I ask to join a group on my phone?',
        ])->assertCreated();

        $this->assertCount(0, $this->callsTo($member->email), 'Jira sends the confirmation; the platform must not send a second one');
        Queue::assertPushed(CreateSupportJiraTicket::class);
    }

    public function test_when_jira_will_not_email_the_member_the_platform_receipt_is_sent(): void
    {
        config(['support_jira.send_member_email' => false]);
        Queue::fake();
        $member = $this->member();
        Sanctum::actingAs($member, ['*']);

        $this->apiPost('/v2/support/reports', [
            'request_type' => 'how_to',
            'summary' => 'Joining a group',
            'description' => 'Where do I ask to join a group on my phone?',
        ])->assertCreated();

        $this->assertCount(1, $this->callsTo($member->email));
    }

    public function test_if_the_ticket_finally_fails_the_member_gets_the_platform_receipt_instead(): void
    {
        $member = $this->member();
        $reportId = $this->insertReport($member);

        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->failed(new \RuntimeException('Jira down'));

        $receipts = $this->callsTo($member->email);
        $this->assertCount(1, $receipts);
        $this->assertStringContainsString('NXR-F-', $receipts[0]['subject']);
    }

    public function test_no_fallback_receipt_when_the_member_was_never_promised_a_jira_email(): void
    {
        config(['support_jira.send_member_email' => false]);
        $member = $this->member();
        $reportId = $this->insertReport($member);

        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->failed(new \RuntimeException('Jira down'));

        $this->assertCount(0, $this->callsTo($member->email), 'they already had the platform receipt at submit time');
    }

    private function runJob(int $reportId): void
    {
        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->handle();
    }

    private function fakeJira(bool $customerExists = false, int $assignStatus = 204): void
    {
        Http::fake([
            self::SITE . '/rest/servicedeskapi/customer' => $customerExists
                ? Http::response(['errorMessage' => 'An account already exists for this email'], 400)
                : Http::response(['accountId' => 'acct-member'], 201),
            self::SITE . '/rest/servicedeskapi/servicedesk/2/customer*' => function (Request $r) {
                return $r->method() === 'GET'
                    ? Http::response(['values' => [['accountId' => 'acct-in-desk']]], 200)
                    : Http::response(null, 204);
            },
            self::SITE . '/rest/api/3/user/search*' => Http::response([['accountId' => 'acct-from-search']], 200),
            self::SITE . '/rest/servicedeskapi/request' => Http::response(['issueKey' => 'HELP-50'], 201),
            self::SITE . '/rest/api/3/issue/HELP-50/assignee' => Http::response(null, $assignStatus),
            self::SITE . '/rest/api/3/issue/HELP-50' => Http::response(null, 204),
        ]);
    }

    private function member(array $attributes = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'email' => 'flow-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ], $attributes));
    }

    private function insertReport(User $member): int
    {
        return (int) DB::table('support_reports')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'reference' => 'NXR-F-' . strtoupper(bin2hex(random_bytes(4))),
            'source' => 'in_app',
            'request_type' => 'broken',
            'summary' => 'Wallet will not load',
            'description' => 'The wallet page spins for ever when I open it.',
            'impact' => 'minor',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return list<array{to: string, subject: string, body: string, options: array}> */
    private function callsTo(string $email): array
    {
        return array_values(array_filter($this->mailer->calls, fn (array $c) => $c['to'] === $email));
    }
}

class SupportJiraFlowRecordingMailer extends EmailDispatchService
{
    public array $calls = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->calls[] = compact('to', 'subject', 'body', 'options');

        return true;
    }
}
