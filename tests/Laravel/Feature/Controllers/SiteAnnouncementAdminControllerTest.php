<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\RedisCache;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * Feature tests for SiteAnnouncementAdminController — the community
 * announcement banner's admin endpoints, and the `announcement` field the
 * tenant bootstrap publishes from them.
 *
 *   GET    /v2/admin/announcements
 *   POST   /v2/admin/announcements
 *   PUT    /v2/admin/announcements/{id}
 *   DELETE /v2/admin/announcements/{id}
 */
class SiteAnnouncementAdminControllerTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT_ID = 990411;

    protected function setUp(): void
    {
        parent::setUp();
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
    }

    protected function tearDown(): void
    {
        // The bootstrap payload is cached in Redis, which the test transaction
        // does not roll back.
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
        parent::tearDown();
    }

    private function actAsAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    /** A second community with one announcement of its own. Returns the announcement id. */
    private function seedOtherTenantAnnouncement(): int
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => self::OTHER_TENANT_ID],
            [
                'name' => 'Other Announcement Timebank',
                'slug' => 'other-announcement-timebank-test',
                'parent_id' => null,
                'path' => '/' . self::OTHER_TENANT_ID . '/',
                'depth' => 0,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        return (int) DB::table('site_announcements')->insertGetId([
            'tenant_id' => self::OTHER_TENANT_ID,
            'message' => 'A notice from another community',
            'style' => 'info',
            'is_dismissible' => 1,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ================================================================
    // Who may use it
    // ================================================================

    public function test_every_endpoint_refuses_a_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $this->apiGet('/v2/admin/announcements')->assertStatus(403);
        $this->apiPost('/v2/admin/announcements', ['message' => 'Hello'])->assertStatus(403);
        $this->apiPut('/v2/admin/announcements/1', ['message' => 'Hello'])->assertStatus(403);
        $this->apiDelete('/v2/admin/announcements/1')->assertStatus(403);

        $this->assertSame(0, DB::table('site_announcements')->where('tenant_id', $this->testTenantId)->count());
    }

    public function test_index_refuses_a_signed_out_visitor(): void
    {
        $this->apiGet('/v2/admin/announcements')->assertStatus(401);
    }

    // ================================================================
    // Create, list, update, delete
    // ================================================================

    public function test_admin_can_create_list_update_and_delete(): void
    {
        $admin = $this->actAsAdmin();

        $created = $this->apiPost('/v2/admin/announcements', [
            'message' => 'Winter social on Friday',
            'style' => 'celebration',
            'link_url' => '/events',
            'link_label' => 'See events',
            'starts_at' => '2026-11-01T09:00:00Z',
            'ends_at' => '2099-01-01T00:00:00Z',
            'is_dismissible' => false,
        ]);

        $created->assertStatus(201);
        $created->assertJsonPath('data.announcement.message', 'Winter social on Friday');
        $created->assertJsonPath('data.announcement.style', 'celebration');
        $created->assertJsonPath('data.announcement.link_url', '/events');
        $created->assertJsonPath('data.announcement.link_label', 'See events');
        $created->assertJsonPath('data.announcement.is_dismissible', false);
        $created->assertJsonPath('data.announcement.is_active', true);
        $created->assertJsonPath('data.announcement.created_by', $admin->id);
        $created->assertJsonPath('data.announcement.starts_at', '2026-11-01T09:00:00+00:00');
        $id = (int) $created->json('data.announcement.id');
        $this->assertGreaterThan(0, $id);

        $this->assertSame(
            $this->testTenantId,
            (int) DB::table('site_announcements')->where('id', $id)->value('tenant_id')
        );

        $list = $this->apiGet('/v2/admin/announcements');
        $list->assertStatus(200);
        $this->assertContains($id, array_column($list->json('data.items'), 'id'));

        $updated = $this->apiPut("/v2/admin/announcements/{$id}", [
            'message' => 'Winter social moved to Saturday',
            'is_active' => false,
        ]);
        $updated->assertStatus(200);
        $updated->assertJsonPath('data.announcement.message', 'Winter social moved to Saturday');
        $updated->assertJsonPath('data.announcement.is_active', false);
        // Fields the update did not mention are left alone.
        $updated->assertJsonPath('data.announcement.style', 'celebration');
        $updated->assertJsonPath('data.announcement.link_url', '/events');

        $this->apiDelete("/v2/admin/announcements/{$id}")->assertStatus(200);
        $this->assertNull(DB::table('site_announcements')->where('id', $id)->first());

        $this->apiDelete("/v2/admin/announcements/{$id}")->assertStatus(404);
    }

    public function test_create_uses_defaults_for_everything_but_the_message(): void
    {
        $this->actAsAdmin();

        $created = $this->apiPost('/v2/admin/announcements', ['message' => 'Just a notice']);

        $created->assertStatus(201);
        $created->assertJsonPath('data.announcement.style', 'info');
        $created->assertJsonPath('data.announcement.link_url', null);
        $created->assertJsonPath('data.announcement.link_label', null);
        $created->assertJsonPath('data.announcement.starts_at', null);
        $created->assertJsonPath('data.announcement.ends_at', null);
        $created->assertJsonPath('data.announcement.is_dismissible', true);
        $created->assertJsonPath('data.announcement.is_active', true);
    }

    // ================================================================
    // Another community's announcement
    // ================================================================

    public function test_another_communitys_announcement_is_not_found_and_not_listed(): void
    {
        $otherId = $this->seedOtherTenantAnnouncement();
        $this->actAsAdmin();

        $list = $this->apiGet('/v2/admin/announcements');
        $list->assertStatus(200);
        $this->assertNotContains($otherId, array_column($list->json('data.items'), 'id'));

        $this->apiPut("/v2/admin/announcements/{$otherId}", ['message' => 'Taken over'])->assertStatus(404);
        $this->apiDelete("/v2/admin/announcements/{$otherId}")->assertStatus(404);

        $row = DB::table('site_announcements')->where('id', $otherId)->first();
        $this->assertNotNull($row);
        $this->assertSame('A notice from another community', $row->message);
        $this->assertSame(self::OTHER_TENANT_ID, (int) $row->tenant_id);
    }

    // ================================================================
    // What is saved
    // ================================================================

    public function test_html_is_stripped_from_the_message_and_the_link_label(): void
    {
        $this->actAsAdmin();

        $created = $this->apiPost('/v2/admin/announcements', [
            'message' => "  <b>Hi</b><script>x</script>   there\n\tfriends ",
            'link_url' => '/about',
            'link_label' => '<i>Read</i> more',
        ]);

        $created->assertStatus(201);
        $created->assertJsonPath('data.announcement.message', 'Hi there friends');
        $created->assertJsonPath('data.announcement.link_label', 'Read more');
    }

    public function test_a_message_that_is_empty_once_cleaned_is_rejected(): void
    {
        $this->actAsAdmin();

        foreach ([null, '', '   ', '<b></b>', '<script>alert(1)</script>', ['not', 'text']] as $message) {
            $response = $this->apiPost('/v2/admin/announcements', ['message' => $message]);
            $response->assertStatus(422);
            $response->assertJsonPath('errors.0.field', 'message');
        }

        $this->apiPost('/v2/admin/announcements', [])->assertStatus(422);
        $this->assertSame(0, DB::table('site_announcements')->where('tenant_id', $this->testTenantId)->count());
    }

    public function test_a_message_over_280_characters_is_rejected_and_280_is_accepted(): void
    {
        $this->actAsAdmin();

        // Multi-byte on purpose: the limit is characters, not bytes.
        $this->apiPost('/v2/admin/announcements', ['message' => str_repeat('é', 281)])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'message');

        $this->apiPost('/v2/admin/announcements', ['message' => str_repeat('é', 280)])
            ->assertStatus(201);
    }

    public function test_a_style_that_is_not_on_the_list_is_rejected(): void
    {
        $this->actAsAdmin();

        // (An empty style is not in this list: the framework turns '' into
        // null, which means "not sent" and falls back to the default.)
        foreach (['danger', 'INFO; DROP', 'info celebration', 5, ['info']] as $style) {
            $this->apiPost('/v2/admin/announcements', ['message' => 'Hello', 'style' => $style])
                ->assertStatus(422)
                ->assertJsonPath('errors.0.field', 'style');
        }

        foreach (['info', 'celebration', 'important'] as $style) {
            $this->apiPost('/v2/admin/announcements', ['message' => 'Hello', 'style' => $style])
                ->assertStatus(201)
                ->assertJsonPath('data.announcement.style', $style);
        }
    }

    /** @return array<string, array{0: mixed}> */
    public static function badLinks(): array
    {
        return [
            'javascript scheme' => ['javascript:alert(1)'],
            'javascript scheme, mixed case' => ['JaVaScRiPt:alert(1)'],
            'data scheme' => ['data:text/html,<script>alert(1)</script>'],
            'protocol-relative host' => ['//evil.example/path'],
            'plain http' => ['http://example.org/page'],
            'backslash after the slash' => ['/\\evil.example'],
            'backslash in an https url' => ['https://example.org\\@evil.example'],
            // In the middle: the framework already trims one off either end.
            'control character' => ["/eve\x00nts"],
            'newline' => ["/events\nSet-Cookie: x=1"],
            'tab inside a scheme' => ["java\tscript:alert(1)"],
            'relative path' => ['events/next'],
            'other scheme' => ['ftp://example.org/file'],
            'mailto' => ['mailto:someone@example.org'],
            'https with no host' => ['https://'],
            'https with sign-in details' => ['https://project-nexus.ie@evil.example/'],
            'space inside' => ['/events next'],
            'not text' => [['/events']],
            'too long' => ['/' . str_repeat('a', 500)],
        ];
    }

    #[DataProvider('badLinks')]
    public function test_a_bad_link_is_rejected(mixed $link): void
    {
        $this->actAsAdmin();

        $response = $this->apiPost('/v2/admin/announcements', ['message' => 'Hello', 'link_url' => $link]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.field', 'link_url');
        $this->assertSame(0, DB::table('site_announcements')->where('tenant_id', $this->testTenantId)->count());
    }

    public function test_an_internal_path_and_an_https_url_are_both_accepted(): void
    {
        $this->actAsAdmin();

        foreach (['/events/12?tab=details#top', 'https://example.org/page?x=1'] as $link) {
            // A link needs words to show (12 Nov 2026), so each one has them.
            $this->apiPost('/v2/admin/announcements', ['message' => 'Hello', 'link_url' => $link, 'link_label' => 'Details'])
                ->assertStatus(201)
                ->assertJsonPath('data.announcement.link_url', $link);
        }
    }

    public function test_an_end_that_is_not_after_the_start_is_rejected(): void
    {
        $this->actAsAdmin();

        $this->apiPost('/v2/admin/announcements', [
            'message' => 'Hello',
            'starts_at' => '2026-12-10T10:00:00Z',
            'ends_at' => '2026-12-01T10:00:00Z',
        ])->assertStatus(422)->assertJsonPath('errors.0.field', 'ends_at');

        $this->apiPost('/v2/admin/announcements', [
            'message' => 'Hello',
            'starts_at' => '2026-12-10T10:00:00Z',
            'ends_at' => '2026-12-10T10:00:00Z',
        ])->assertStatus(422)->assertJsonPath('errors.0.field', 'ends_at');

        $this->apiPost('/v2/admin/announcements', [
            'message' => 'Hello',
            'starts_at' => 'next sometime-ish',
        ])->assertStatus(422)->assertJsonPath('errors.0.field', 'starts_at');
    }

    public function test_an_update_cannot_move_the_end_before_the_saved_start(): void
    {
        $this->actAsAdmin();

        $id = (int) $this->apiPost('/v2/admin/announcements', [
            'message' => 'Hello',
            'starts_at' => '2026-12-10T10:00:00Z',
        ])->json('data.announcement.id');

        $this->apiPut("/v2/admin/announcements/{$id}", ['ends_at' => '2026-12-01T10:00:00Z'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'ends_at');

        $this->assertNull(DB::table('site_announcements')->where('id', $id)->value('ends_at'));
    }

    // ================================================================
    // The bootstrap publishes it
    // ================================================================

    public function test_bootstrap_publishes_the_announcement_after_create_and_null_after_delete(): void
    {
        // Prime the cache with "no announcement", as a real visitor would have.
        $before = $this->apiGet('/v2/tenant/bootstrap');
        $before->assertStatus(200);
        $this->assertArrayHasKey('announcement', $before->json('data'));
        $this->assertNull($before->json('data.announcement'));

        $this->actAsAdmin();
        $id = (int) $this->apiPost('/v2/admin/announcements', [
            'message' => 'Shown on the member website',
            'style' => 'important',
            'link_url' => 'https://example.org/more',
            'link_label' => 'More',
        ])->json('data.announcement.id');

        $shown = $this->apiGet('/v2/tenant/bootstrap');
        $shown->assertStatus(200);
        $shown->assertJsonPath('data.announcement.id', $id);
        $shown->assertJsonPath('data.announcement.message', 'Shown on the member website');
        $shown->assertJsonPath('data.announcement.style', 'important');
        $shown->assertJsonPath('data.announcement.link_url', 'https://example.org/more');
        $shown->assertJsonPath('data.announcement.link_label', 'More');
        $shown->assertJsonPath('data.announcement.is_dismissible', true);
        $this->assertSame(
            ['id', 'message', 'style', 'link_url', 'link_label', 'is_dismissible', 'starts_at', 'ends_at', 'updated_at'],
            array_keys($shown->json('data.announcement'))
        );

        $this->apiPut("/v2/admin/announcements/{$id}", ['message' => 'Edited'])->assertStatus(200);
        $this->apiGet('/v2/tenant/bootstrap')->assertJsonPath('data.announcement.message', 'Edited');

        $this->apiDelete("/v2/admin/announcements/{$id}")->assertStatus(200);

        $after = $this->apiGet('/v2/tenant/bootstrap');
        $after->assertStatus(200);
        $this->assertArrayHasKey('announcement', $after->json('data'));
        $this->assertNull($after->json('data.announcement'));
    }
}
