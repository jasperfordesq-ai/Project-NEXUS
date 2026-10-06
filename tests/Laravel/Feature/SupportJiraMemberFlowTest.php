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
    private const WATCHER = '712020:watcher-account-id';
    private const SECOND_WATCHER = '712020:second-watcher-id';

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

    public function test_every_configured_watcher_is_added_to_each_new_ticket(): void
    {
        config(['support_jira.watcher_account_ids' => [self::WATCHER, self::SECOND_WATCHER]]);
        $reportId = $this->insertReport($this->member());
        $this->fakeJira();

        $this->runJob($reportId);

        // Jira's add-watcher call takes the account id as a bare JSON string.
        foreach ([self::WATCHER, self::SECOND_WATCHER] as $accountId) {
            Http::assertSent(fn (Request $r) => $r->method() === 'POST'
                && parse_url($r->url(), PHP_URL_PATH) === '/rest/api/3/issue/HELP-50/watchers'
                && $r->body() === json_encode($accountId));
        }
        $this->assertNull(DB::table('support_reports')->where('id', $reportId)->value('jira_last_error'));
    }

    public function test_no_watcher_is_added_when_none_is_configured(): void
    {
        config(['support_jira.watcher_account_ids' => []]);
        $reportId = $this->insertReport($this->member());
        $this->fakeJira();

        $this->runJob($reportId);

        Http::assertNotSent(fn (Request $r) => str_ends_with($r->url(), '/watchers'));
    }

    public function test_a_failed_watcher_keeps_the_ticket_and_records_a_warning(): void
    {
        config(['support_jira.watcher_account_ids' => [self::WATCHER]]);
        $reportId = $this->insertReport($this->member());
        $this->fakeJira(watchStatus: 400);

        $this->runJob($reportId);

        $row = DB::table('support_reports')->where('id', $reportId)->first();
        $this->assertSame('HELP-50', $row->jira_issue_key);
        $this->assertStringContainsString('watcher', (string) $row->jira_last_error);
    }

    public function test_watcher_ids_are_read_from_a_comma_separated_setting(): void
    {
        putenv('SUPPORT_JIRA_WATCHER_ACCOUNT_IDS= ' . self::WATCHER . ' ,, ' . self::SECOND_WATCHER . ' ,' . self::WATCHER);
        try {
            $config = require base_path('config/support_jira.php');
        } finally {
            putenv('SUPPORT_JIRA_WATCHER_ACCOUNT_IDS');
        }

        $this->assertSame([self::WATCHER, self::SECOND_WATCHER], $config['watcher_account_ids']);
    }

    public function test_with_member_email_on_the_ticket_names_the_member(): void
    {
        $member = $this->member(['first_name' => 'Aoife', 'last_name' => 'Byrne']);
        $reportId = $this->insertReport($member);
        $this->fakeJira();

        $this->runJob($reportId);

        $create = Http::recorded(fn (Request $r) => $r->method() === 'POST'
            && parse_url($r->url(), PHP_URL_PATH) === '/rest/servicedeskapi/request')->first()[0];
        $this->assertSame($member->email, $create->data()['raiseOnBehalfOf']);
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

    public function test_the_platform_receipt_is_always_sent_and_warns_about_jiras_confirmation_email(): void
    {
        Queue::fake();
        $member = $this->member();
        Sanctum::actingAs($member, ['*']);

        $this->apiPost('/v2/support/reports', [
            'request_type' => 'how_to',
            'summary' => 'Joining a group',
            'description' => 'Where do I ask to join a group on my phone?',
        ])->assertCreated();

        $receipts = $this->callsTo($member->email);
        $this->assertCount(1, $receipts, 'the platform receipt reaches the inbox; Jira first sends a confirm-your-email message that lands in junk');
        $this->assertStringContainsString('jira@helpdesk.example.test', $receipts[0]['body']);
        $this->assertStringContainsString('confirm your email address', $receipts[0]['body']);
        Queue::assertPushed(CreateSupportJiraTicket::class);
    }

    public function test_the_receipt_does_not_mention_jira_when_jira_will_not_email_the_member(): void
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

        $receipts = $this->callsTo($member->email);
        $this->assertCount(1, $receipts);
        $this->assertStringNotContainsString('jira@', $receipts[0]['body']);
    }

    public function test_a_configured_sender_address_overrides_the_default(): void
    {
        config(['support_jira.notification_sender' => 'help@timebank.example']);
        Queue::fake();
        $member = $this->member();
        Sanctum::actingAs($member, ['*']);

        $this->apiPost('/v2/support/reports', [
            'request_type' => 'suggestion',
            'summary' => 'An idea',
            'description' => 'A darker map for night-time would be nice.',
        ])->assertCreated();

        $this->assertStringContainsString('help@timebank.example', $this->callsTo($member->email)[0]['body']);
    }

    public function test_a_final_jira_failure_sends_no_second_receipt(): void
    {
        $member = $this->member();
        $reportId = $this->insertReport($member);

        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->failed(new \RuntimeException('Jira down'));

        $this->assertCount(0, $this->callsTo($member->email), 'the receipt went out when the request was saved');
    }

    private function runJob(int $reportId): void
    {
        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->handle();
    }

    private function fakeJira(bool $customerExists = false, int $assignStatus = 204, int $watchStatus = 204): void
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
            self::SITE . '/rest/api/3/issue/HELP-50/watchers' => Http::response(null, $watchStatus),
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
