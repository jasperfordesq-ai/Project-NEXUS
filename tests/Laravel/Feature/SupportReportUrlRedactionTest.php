<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-281 — a "Report a problem" submission must never store the page address's
 * query string or fragment. Both routinely carry credentials (reset and sign-in
 * links, one-time partner links, `#access_token=`), and the report is stored and
 * read back by every community admin. The server strips them itself so that an
 * older app build, the accessible frontend, or a hand-made request is covered too.
 */
class SupportReportUrlRedactionTest extends TestCase
{
    use DatabaseTransactions;

    private const TOKEN = 'f281-synthetic-token-2f7a91c4d0';

    public function test_query_string_and_fragment_never_reach_the_stored_report_or_the_staff_view(): void
    {
        $admin = User::factory()->admin()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $this->fakeMailer();
        Sanctum::actingAs($member, ['*']);

        $route = '/partner-analytics?token=' . self::TOKEN . '#impersonate=' . self::TOKEN;
        $pageUrl = 'https://app.example.test' . $route;

        $response = $this->apiPost('/v2/support/reports', [
            'summary' => 'F-281 regression',
            'description' => 'Synthetic problem report for a security regression test.',
            'impact' => 'minor',
            'route' => $route,
            'page_url' => $pageUrl,
            'include_diagnostics' => true,
            'diagnostics' => [
                'page_url' => $pageUrl,
                'route' => $route,
                'entries' => [
                    ['kind' => 'api', 'endpoint' => '/v2/partner-analytics?t=' . self::TOKEN . '&page=2#x=' . self::TOKEN],
                    ['kind' => 'console', 'message' => 'Failed to load https://app.example.test/reset?code=' . self::TOKEN],
                ],
            ],
        ]);

        $response->assertCreated();
        $row = DB::table('support_reports')
            ->where('reference', (string) $response->json('data.report.reference'))
            ->first();
        $this->assertNotNull($row);

        $this->assertStringNotContainsString(self::TOKEN, (string) $row->route);
        $this->assertStringNotContainsString(self::TOKEN, (string) $row->page_url);
        $this->assertStringNotContainsString(self::TOKEN, (string) $row->diagnostics);

        // Control: the page is still identified, so staff can find it.
        $this->assertSame('/partner-analytics', $row->route);
        $this->assertSame('https://app.example.test/partner-analytics', $row->page_url);
        $diagnostics = json_decode((string) $row->diagnostics, true);
        $this->assertSame('/partner-analytics', $diagnostics['payload']['route']);
        // Control: a plainly non-secret API parameter survives for debugging.
        $this->assertSame('/v2/partner-analytics?t=[filtered]&page=2', $diagnostics['payload']['entries'][0]['endpoint']);
        $this->assertSame('Failed to load https://app.example.test/reset', $diagnostics['payload']['entries'][1]['message']);

        Sanctum::actingAs($admin, ['*']);
        $show = $this->apiGet('/v2/admin/support-reports/' . (int) $row->id);
        $show->assertOk();
        $this->assertStringNotContainsString(self::TOKEN, (string) $show->getContent());
        $show->assertJsonPath('data.route', '/partner-analytics');
    }

    public function test_a_clean_address_round_trips_unchanged(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $this->fakeMailer();
        Sanctum::actingAs($member, ['*']);

        $response = $this->apiPost('/v2/support/reports', [
            'summary' => 'Events page broken',
            'description' => 'The events page does not load for me at all.',
            'impact' => 'minor',
            'route' => '/hour-timebank/events/42',
            'page_url' => 'https://app.example.test/hour-timebank/events/42',
        ]);

        $response->assertCreated();
        $row = DB::table('support_reports')
            ->where('reference', (string) $response->json('data.report.reference'))
            ->first();
        $this->assertNotNull($row);
        $this->assertSame('/hour-timebank/events/42', $row->route);
        $this->assertSame('https://app.example.test/hour-timebank/events/42', $row->page_url);
    }

    public function test_a_page_url_that_is_not_a_web_address_is_not_stored(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $this->fakeMailer();
        Sanctum::actingAs($member, ['*']);

        // Staff open page_url in a new window; a script address must never be kept.
        $response = $this->apiPost('/v2/support/reports', [
            'summary' => 'Script address probe',
            'description' => 'Synthetic problem report for a security regression test.',
            'impact' => 'minor',
            'page_url' => 'javascript:alert(document.domain)',
        ]);

        $response->assertCreated();
        $row = DB::table('support_reports')
            ->where('reference', (string) $response->json('data.report.reference'))
            ->first();
        $this->assertNotNull($row);
        $this->assertNull($row->page_url);
    }

    private function fakeMailer(): void
    {
        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });
    }
}
