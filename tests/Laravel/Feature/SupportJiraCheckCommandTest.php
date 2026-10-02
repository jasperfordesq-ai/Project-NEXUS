<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * `php artisan support:jira-check` — proves the Jira connection works while
 * the member-facing switch (SUPPORT_JIRA_ENABLED) is still OFF. By default it
 * only reads; `--create-test-ticket` raises exactly one ticket marked TEST.
 * Jira is always faked here.
 */
class SupportJiraCheckCommandTest extends TestCase
{
    use DatabaseTransactions;

    private const SITE = 'https://helpdesk.example.test';
    private const CLOUD = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
    private const API = 'https://api.atlassian.com/ex/jira/' . self::CLOUD;
    private const TOKEN = 'secret-token-never-printed';

    protected function setUp(): void
    {
        parent::setUp();
        // A call the fake Jira does not answer must fail, never reach the network.
        Http::preventStrayRequests();
        config([
            // The whole point: the check works while the connection is OFF.
            'support_jira.enabled' => false,
            'support_jira.site_url' => self::SITE,
            'support_jira.cloud_id' => self::CLOUD,
            'support_jira.service_desk_id' => '2',
            'support_jira.email' => 'bot@serviceaccount.atlassian.com',
            'support_jira.api_token' => self::TOKEN,
            'support_jira.request_types' => ['broken' => '5', 'how_to' => '6', 'account' => '8', 'suggestion' => '9'],
        ]);
    }

    public function test_a_healthy_connection_is_reported_without_creating_anything(): void
    {
        $this->fakeHealthyJira();

        $this->artisan('support:jira-check')
            ->expectsOutputToContain('Help desk found: HELP')
            ->expectsOutputToContain('All four request types match')
            ->assertExitCode(0);

        Http::assertNotSent(fn (Request $r) => $r->method() !== 'GET');
    }

    public function test_a_request_type_id_jira_does_not_have_is_reported_and_fails(): void
    {
        config(['support_jira.request_types.suggestion' => '99']);
        $this->fakeHealthyJira();

        $this->artisan('support:jira-check')
            ->expectsOutputToContain('suggestion → request type 99: NOT FOUND')
            ->assertExitCode(1);
    }

    public function test_a_refused_key_says_so_in_plain_words(): void
    {
        Http::fake([self::API . '/*' => Http::response(['message' => 'Unauthorized'], 401)]);

        $this->artisan('support:jira-check')
            ->expectsOutputToContain('Jira refused the key')
            ->assertExitCode(1);
    }

    public function test_an_account_that_cannot_see_the_help_desk_gets_a_hint(): void
    {
        Http::fake([self::API . '/*' => Http::response(['errorMessage' => 'not found'], 404)]);

        $this->artisan('support:jira-check')
            ->expectsOutputToContain('cannot see help desk 2')
            ->assertExitCode(1);
    }

    public function test_missing_settings_are_listed_and_nothing_is_sent(): void
    {
        config(['support_jira.api_token' => '']);
        Http::fake();

        $this->artisan('support:jira-check')
            ->expectsOutputToContain('SUPPORT_JIRA_API_TOKEN')
            ->assertExitCode(1);

        Http::assertNothingSent();
    }

    public function test_create_test_ticket_raises_one_ticket_marked_test_and_stores_nothing(): void
    {
        $this->fakeHealthyJira();
        $before = DB::table('support_reports')->count();

        $this->artisan('support:jira-check', ['--create-test-ticket' => true])
            ->expectsOutputToContain('Test ticket HELP-77 created: ' . self::SITE . '/browse/HELP-77')
            ->assertExitCode(0);

        $creates = Http::recorded(fn (Request $r) => $r->method() === 'POST' && str_ends_with($r->url(), '/rest/servicedeskapi/request'));
        $this->assertCount(1, $creates);
        $body = $creates->first()[0]->data();
        $this->assertStringStartsWith('TEST', $body['requestFieldValues']['summary']);
        $this->assertSame('5', (string) $body['requestTypeId']);
        $this->assertArrayNotHasKey('raiseOnBehalfOf', $body);
        Http::assertSent(fn (Request $r) => $r->method() === 'PUT' && str_ends_with($r->url(), '/rest/api/3/issue/HELP-77')
            && in_array('nexus-test', $r->data()['fields']['labels'], true));
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/rest/servicedeskapi/request/HELP-77/attachment'));
        $this->assertSame($before, DB::table('support_reports')->count());
    }

    public function test_a_test_ticket_is_not_attempted_when_the_read_checks_fail(): void
    {
        Http::fake([self::API . '/*' => Http::response(['message' => 'Unauthorized'], 401)]);

        $this->artisan('support:jira-check', ['--create-test-ticket' => true])->assertExitCode(1);

        Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
    }

    public function test_the_key_never_appears_in_the_output(): void
    {
        Http::fake([self::API . '/*' => Http::response(['message' => 'bad token ' . self::TOKEN], 401)]);

        $this->artisan('support:jira-check')
            ->doesntExpectOutputToContain(self::TOKEN)
            ->assertExitCode(1);
    }

    private function fakeHealthyJira(): void
    {
        Http::fake([
            self::API . '/rest/servicedeskapi/servicedesk/2' => Http::response(['id' => '2', 'projectKey' => 'HELP', 'projectName' => 'Timebank Help Desk'], 200),
            self::API . '/rest/servicedeskapi/servicedesk/2/requesttype*' => Http::response(['values' => [
                ['id' => '5', 'name' => "Something isn't working"],
                ['id' => '6', 'name' => 'How do I…?'],
                ['id' => '8', 'name' => 'Account or sign-in problem'],
                ['id' => '9', 'name' => 'Suggest an improvement'],
            ], 'isLastPage' => true], 200),
            self::API . '/rest/servicedeskapi/request' => Http::response(['issueKey' => 'HELP-77'], 201),
            self::API . '/rest/api/3/issue/HELP-77' => Http::response(null, 204),
            self::API . '/rest/servicedeskapi/servicedesk/2/attachTemporaryFile' => Http::response(['temporaryAttachments' => [['temporaryAttachmentId' => 'tmp-9']]], 201),
            self::API . '/rest/servicedeskapi/request/HELP-77/attachment' => Http::response([], 201),
        ]);
    }
}
