<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Http\Controllers\Api\AdminNewsletterController;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminNewsletterController.
 *
 * Covers index, subscribers, segments, templates, analytics, bounces,
 * suppression list. The controller gracefully returns empty data if
 * newsletter tables don't exist.
 */
class AdminNewsletterControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_controller_has_no_constructor_dependencies_before_auth_middleware(): void
    {
        $constructor = (new \ReflectionClass(AdminNewsletterController::class))->getConstructor();

        $this->assertNull($constructor, 'Newsletter admin routes must not resolve service dependencies before auth middleware.');
    }

    // ================================================================
    // INDEX — GET /v2/admin/newsletters
    // ================================================================

    public function test_index_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/newsletters');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_index_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/newsletters');

        $response->assertStatus(403);
    }

    public function test_index_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/newsletters');

        $response->assertStatus(401);
    }

    public function test_support_endpoints_return_401_for_unauthenticated(): void
    {
        $this->apiGet('/v2/admin/newsletters/segments')->assertStatus(401);
        $this->apiGet('/v2/admin/newsletters/templates')->assertStatus(401);
        $this->apiPost('/v2/admin/newsletters/recipient-count', [
            'target_audience' => 'all_members',
        ])->assertStatus(401);
    }

    // ================================================================
    // SUBSCRIBERS — GET /v2/admin/newsletters/subscribers
    // ================================================================

    public function test_subscribers_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/newsletters/subscribers');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_subscribers_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/newsletters/subscribers');

        $response->assertStatus(403);
    }

    // ================================================================
    // SEGMENTS — GET /v2/admin/newsletters/segments
    // ================================================================

    public function test_segments_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/newsletters/segments');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // TEMPLATES — GET /v2/admin/newsletters/templates
    // ================================================================

    public function test_templates_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/newsletters/templates');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // ANALYTICS — GET /v2/admin/newsletters/analytics
    // ================================================================

    public function test_analytics_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/newsletters/analytics');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_analytics_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/newsletters/analytics');

        $response->assertStatus(403);
    }

    // ================================================================
    // PER-CAMPAIGN REPORTING - stats/openers/clickers
    // ================================================================

    public function test_campaign_stats_report_recorded_opens_and_clicks(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $newsletterId = DB::table('newsletters')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Stats regression test',
            'subject' => 'Stats regression test',
            'content' => '<p>Hello</p>',
            'status' => 'sent',
            'total_recipients' => 3,
            'total_sent' => 3,
            'target_audience' => 'all_members',
            'created_by' => $admin->id,
            'sent_at' => now()->subHour(),
            'created_at' => now()->subHours(2),
            'updated_at' => now()->subHour(),
        ]);

        DB::table('newsletter_opens')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'newsletter_id' => $newsletterId,
                'email' => 'one@example.test',
                'user_agent' => 'GoogleImageProxy',
                'ip_address' => '127.0.0.1',
                'opened_at' => now()->subMinutes(40),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'newsletter_id' => $newsletterId,
                'email' => 'one@example.test',
                'user_agent' => 'GoogleImageProxy',
                'ip_address' => '127.0.0.1',
                'opened_at' => now()->subMinutes(39),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'newsletter_id' => $newsletterId,
                'email' => 'two@example.test',
                'user_agent' => 'YahooMailProxy',
                'ip_address' => '127.0.0.2',
                'opened_at' => now()->subMinutes(30),
            ],
        ]);

        DB::table('newsletter_clicks')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'newsletter_id' => $newsletterId,
                'email' => 'one@example.test',
                'url' => 'https://hour-timebank.ie/',
                'link_id' => hash('sha256', 'https://hour-timebank.ie/'),
                'user_agent' => 'Mozilla',
                'ip_address' => '127.0.0.1',
                'clicked_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'newsletter_id' => $newsletterId,
                'email' => 'two@example.test',
                'url' => 'https://hour-timebank.ie/',
                'link_id' => hash('sha256', 'https://hour-timebank.ie/'),
                'user_agent' => 'Mozilla',
                'ip_address' => '127.0.0.2',
                'clicked_at' => now()->subMinutes(10),
            ],
        ]);

        $response = $this->apiGet("/v2/admin/newsletters/{$newsletterId}/stats");

        $response->assertOk()
            ->assertJsonPath('data.engagement.total_opens', 3)
            ->assertJsonPath('data.engagement.unique_opens', 2)
            ->assertJsonPath('data.engagement.total_clicks', 2)
            ->assertJsonPath('data.engagement.unique_clicks', 2)
            ->assertJsonPath('data.top_links.0.url', 'https://hour-timebank.ie/')
            ->assertJsonPath('data.top_links.0.clicks', 2);
    }

    public function test_openers_and_clickers_lists_report_recorded_people(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $newsletterId = DB::table('newsletters')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Activity regression test',
            'subject' => 'Activity regression test',
            'content' => '<p>Hello</p>',
            'status' => 'sent',
            'total_recipients' => 2,
            'total_sent' => 2,
            'target_audience' => 'all_members',
            'created_by' => $admin->id,
            'sent_at' => now()->subHour(),
            'created_at' => now()->subHours(2),
            'updated_at' => now()->subHour(),
        ]);

        DB::table('newsletter_opens')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'newsletter_id' => $newsletterId,
                'email' => 'opened@example.test',
                'opened_at' => now()->subMinutes(20),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'newsletter_id' => $newsletterId,
                'email' => 'opened@example.test',
                'opened_at' => now()->subMinutes(10),
            ],
        ]);

        DB::table('newsletter_clicks')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'newsletter_id' => $newsletterId,
                'email' => 'clicked@example.test',
                'url' => 'https://hour-timebank.ie/',
                'link_id' => hash('sha256', 'https://hour-timebank.ie/'),
                'clicked_at' => now()->subMinutes(5),
            ],
        ]);

        // Each list row must carry a stable `id` (= email here) so the admin UI's
        // dynamic table can key it — mirrors the id guarantee the activity endpoint
        // makes. A missing id crashes the "Who Opened"/"Who Clicked" tabs.
        $this->apiGet("/v2/admin/newsletters/{$newsletterId}/openers")
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', 'opened@example.test')
            ->assertJsonPath('data.0.email', 'opened@example.test')
            ->assertJsonPath('data.0.open_count', 2);

        $this->apiGet("/v2/admin/newsletters/{$newsletterId}/clickers")
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', 'clicked@example.test')
            ->assertJsonPath('data.0.email', 'clicked@example.test')
            ->assertJsonPath('data.0.click_count', 1);
    }

    public function test_subscriber_lists_exclude_blank_emails_before_counting_and_pagination(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $newsletterId = DB::table('newsletters')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Malformed activity rows',
            'subject' => 'Malformed activity rows',
            'content' => '<p>Hello</p>',
            'status' => 'sent',
            'total_recipients' => 2,
            'total_sent' => 2,
            'target_audience' => 'all_members',
            'created_by' => $admin->id,
            'sent_at' => now()->subHour(),
            'created_at' => now()->subHours(2),
            'updated_at' => now()->subHour(),
        ]);

        DB::table('newsletter_opens')->insert([
            ['tenant_id' => $this->testTenantId, 'newsletter_id' => $newsletterId,
                'email' => ' ', 'opened_at' => now()],
            ['tenant_id' => $this->testTenantId, 'newsletter_id' => $newsletterId,
                'email' => 'opened@example.test', 'opened_at' => now()->subMinute()],
        ]);
        DB::table('newsletter_clicks')->insert([
            ['tenant_id' => $this->testTenantId, 'newsletter_id' => $newsletterId,
                'email' => ' ', 'url' => 'https://example.test/',
                'link_id' => hash('sha256', 'https://example.test/'), 'clicked_at' => now()],
            ['tenant_id' => $this->testTenantId, 'newsletter_id' => $newsletterId,
                'email' => 'clicked@example.test', 'url' => 'https://example.test/',
                'link_id' => hash('sha256', 'https://example.test/'), 'clicked_at' => now()->subMinute()],
        ]);

        $this->apiGet("/v2/admin/newsletters/{$newsletterId}/openers")
            ->assertOk()->assertJsonPath('meta.total', 1)
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.email', 'opened@example.test');
        $this->apiGet("/v2/admin/newsletters/{$newsletterId}/clickers")
            ->assertOk()->assertJsonPath('meta.total', 1)
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.email', 'clicked@example.test');

        // Without a blank click, the blank open must still be excluded from this list.
        DB::table('newsletter_clicks')->where('newsletter_id', $newsletterId)->where('email', ' ')->delete();
        $this->apiGet("/v2/admin/newsletters/{$newsletterId}/openers-no-click")
            ->assertOk()->assertJsonPath('meta.total', 1)
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.email', 'opened@example.test');

        // An empty opens table leaves both queue rows eligible before filtering.
        DB::table('newsletter_opens')->where('newsletter_id', $newsletterId)->delete();
        DB::table('newsletter_queue')->insert([
            ['tenant_id' => $this->testTenantId, 'newsletter_id' => $newsletterId,
                'email' => ' ', 'status' => 'sent', 'sent_at' => now()],
            ['tenant_id' => $this->testTenantId, 'newsletter_id' => $newsletterId,
                'email' => 'nonopener@example.test', 'status' => 'sent', 'sent_at' => now()->subMinute()],
        ]);
        $this->apiGet("/v2/admin/newsletters/{$newsletterId}/non-openers")
            ->assertOk()->assertJsonPath('meta.total', 1)
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.email', 'nonopener@example.test');
    }

    // ================================================================
    // BOUNCES - GET /v2/admin/newsletters/bounces
    // ================================================================

    public function test_bounces_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/newsletters/bounces');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // SUPPRESSION LIST — GET /v2/admin/newsletters/suppression-list
    // ================================================================

    public function test_suppression_list_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/newsletters/suppression-list');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // TARGETING — group/geo targeting fix (2026-07-03)
    // ================================================================

    public function test_recipient_count_reflects_group_targeting(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $inGroup = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
        ]);
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $inGroup->id,
            'name' => 'Recipient count targeting group',
            'slug' => 'recipient-count-targeting-' . uniqid('', true),
            'visibility' => 'public',
            'created_at' => now(),
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $inGroup->id,
            'status' => 'active',
            'role' => 'member',
            'joined_at' => now(),
            'created_at' => now(),
        ]);

        $unfiltered = $this->apiPost('/v2/admin/newsletters/recipient-count', [
            'target_audience' => 'all_members',
        ])->assertOk()->json('data.count');

        $filtered = $this->apiPost('/v2/admin/newsletters/recipient-count', [
            'target_audience' => 'all_members',
            'target_groups' => [$groupId],
        ])->assertOk()->json('data.count');

        // Group targeting must narrow the audience, never mirror it.
        $this->assertSame(1, $filtered);
        $this->assertGreaterThan($filtered, $unfiltered);
    }

    public function test_send_rejects_segment_audience_without_segment(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $newsletterId = DB::table('newsletters')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Segment send guard',
            'subject' => 'Segment send guard',
            'content' => '<p>Hello</p>',
            'status' => 'draft',
            'target_audience' => 'segment',
            'segment_id' => null,
            'created_by' => $admin->id,
            'created_at' => now(),
        ]);

        $response = $this->apiPost("/v2/admin/newsletters/{$newsletterId}/send", []);

        // Must refuse with a validation error — never fall through to all_members.
        $response->assertStatus(400);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
        $this->assertSame('draft', DB::table('newsletters')->where('id', $newsletterId)->value('status'));
    }

    // ================================================================
    // MULTI-FORMAT — content_format persistence + preview endpoint
    // ================================================================

    public function test_create_persists_content_format_and_sanitizes_html(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/newsletters', [
            'subject' => 'Designed send',
            'content' => '<table><tr><td>Body</td></tr></table><script>alert(1)</script>',
            'content_format' => 'html',
            'status' => 'draft',
            'target_audience' => 'all_members',
        ]);

        $response->assertStatus(201);
        $id = $response->json('data.id');

        $row = DB::table('newsletters')->where('id', $id)->first();
        $this->assertSame('html', $row->content_format);
        // Table markup preserved, script stripped.
        $this->assertStringContainsString('<table>', $row->content);
        $this->assertStringNotContainsString('<script', $row->content);
    }

    public function test_create_rejects_invalid_content_format(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiPost('/v2/admin/newsletters', [
            'subject' => 'Bad format',
            'content' => 'x',
            'content_format' => 'wysiwyg',
            'status' => 'draft',
            'target_audience' => 'all_members',
        ])->assertStatus(400)->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_preview_renders_html_with_unsubscribe_and_no_script(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/newsletters/preview', [
            'content' => '<p>Hi {{first_name}}</p><script>alert(1)</script>',
            'content_format' => 'html',
            'subject' => 'Preview me',
        ]);

        $response->assertOk()
            ->assertJsonStructure(['data' => ['html', 'text', 'subject']]);

        $html = $response->json('data.html');
        $this->assertStringNotContainsString('<script>alert(1)</script>', $html);
        $this->assertStringContainsString('/newsletter/unsubscribe', $html);
    }

    public function test_preview_requires_admin(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $this->apiPost('/v2/admin/newsletters/preview', [
            'content' => 'x',
            'content_format' => 'plaintext',
        ])->assertStatus(403);
    }
}
