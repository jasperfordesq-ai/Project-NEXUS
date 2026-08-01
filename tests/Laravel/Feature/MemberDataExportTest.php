<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\MemberDataExportService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;
use ZipArchive;

/**
 * MemberDataExportTest — covers the GDPR/FADP personal-data export flow.
 */
class MemberDataExportTest extends TestCase
{
    use DatabaseTransactions;

    private const PRIMARY_TENANT_ID = 2;
    private int $secondaryTenantId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->secondaryTenantId = (int) DB::table('tenants')->insertGetId([
            'name'       => 'Other Coop',
            'slug'       => 'other-coop-' . uniqid(),
            'is_active'  => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        TenantContext::setById(self::PRIMARY_TENANT_ID);
    }

    private function makeUser(int $tenantId, ?string $email = null, float $balance = 0): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'first_name' => 'Test',
            'last_name'  => 'Member',
            'name'       => 'Test Member',
            'email'      => $email ?? ('export.' . uniqid() . '@example.com'),
            'username'   => 'mde_' . substr(md5((string) microtime(true)), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'balance'    => $balance,
            'status'     => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_export_returns_user_profile(): void
    {
        $userId = $this->makeUser(self::PRIMARY_TENANT_ID);
        $svc    = app(MemberDataExportService::class);

        $archive = $svc->buildArchive($userId);

        $this->assertSame('1.0', $archive['format_version']);
        $this->assertArrayHasKey('profile', $archive);
        $this->assertSame($userId, $archive['profile']['id']);
        $this->assertSame('Test Member', $archive['profile']['name']);
        $this->assertArrayHasKey('tenant', $archive);
        $this->assertNotEmpty($archive['tenant']['slug']);
    }

    public function test_export_includes_vol_logs_for_user(): void
    {
        $userId = $this->makeUser(self::PRIMARY_TENANT_ID);

        DB::table('vol_logs')->insert([
            'tenant_id'   => self::PRIMARY_TENANT_ID,
            'user_id'     => $userId,
            'date_logged' => now()->toDateString(),
            'hours'       => 2.5,
            'description' => 'Helped a neighbour',
            'status'      => 'approved',
            'created_at'  => now(),
        ]);

        $archive = app(MemberDataExportService::class)->buildArchive($userId);

        $this->assertNotEmpty($archive['vol_logs']['given']);
        $this->assertSame(2.5, $archive['vol_logs']['given'][0]['hours']);
    }

    /**
     * Partner venue visits are movement data recorded by venue staff on the
     * member's behalf — the member never entered it themselves, which is
     * exactly why it has to appear in a subject access request.
     */
    public function test_export_includes_partner_venue_visits_but_never_the_pass_token(): void
    {
        $userId = $this->makeUser(self::PRIMARY_TENANT_ID);

        $venueId = (int) DB::table('partner_venues')->insertGetId([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'name' => 'The Time Union Cafe',
            'slug' => 'time-union-cafe-' . uniqid(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('partner_venue_visits')->insert([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'venue_id' => $venueId,
            'user_id' => $userId,
            'source' => 'member_pass',
            'visited_on' => now()->toDateString(),
            'visited_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $passToken = str_repeat('a', 64);
        DB::table('partner_member_passes')->insert([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'user_id' => $userId,
            'token' => $passToken,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $archive = app(MemberDataExportService::class)->buildArchive($userId);

        $this->assertArrayHasKey('partner_venue_visits', $archive);
        $this->assertNotEmpty($archive['partner_venue_visits']);
        $this->assertSame('The Time Union Cafe', $archive['partner_venue_visits'][0]['venue_name']);

        // 🔴 The pass token is a live bearer credential. Exporting it would turn
        // a leaked archive into a usable membership pass, so it must never
        // appear anywhere in the export.
        $this->assertStringNotContainsString(
            $passToken,
            json_encode($archive, JSON_THROW_ON_ERROR),
            'The membership pass token must never be written into a data export.'
        );
    }

    public function test_export_excludes_other_users_visits(): void
    {
        $me = $this->makeUser(self::PRIMARY_TENANT_ID);
        $other = $this->makeUser(self::PRIMARY_TENANT_ID);

        $venueId = (int) DB::table('partner_venues')->insertGetId([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'name' => 'Someone Else Cafe',
            'slug' => 'someone-else-cafe-' . uniqid(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('partner_venue_visits')->insert([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'venue_id' => $venueId,
            'user_id' => $other,
            'source' => 'member_pass',
            'visited_on' => now()->toDateString(),
            'visited_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $archive = app(MemberDataExportService::class)->buildArchive($me);

        $this->assertEmpty($archive['partner_venue_visits']);
    }

    public function test_export_excludes_other_users_data(): void
    {
        $me     = $this->makeUser(self::PRIMARY_TENANT_ID);
        $other  = $this->makeUser(self::PRIMARY_TENANT_ID);

        DB::table('vol_logs')->insert([
            'tenant_id'   => self::PRIMARY_TENANT_ID,
            'user_id'     => $other,
            'date_logged' => now()->toDateString(),
            'hours'       => 9.0,
            'status'      => 'approved',
            'created_at'  => now(),
        ]);

        $archive = app(MemberDataExportService::class)->buildArchive($me);

        $this->assertEmpty($archive['vol_logs']['given']);
    }

    public function test_export_is_tenant_scoped(): void
    {
        $userInOther = $this->makeUser($this->secondaryTenantId, 'cross.' . uniqid() . '@example.com');

        // Log activity in the SECONDARY tenant for that user
        DB::table('vol_logs')->insert([
            'tenant_id'   => $this->secondaryTenantId,
            'user_id'     => $userInOther,
            'date_logged' => now()->toDateString(),
            'hours'       => 7.0,
            'status'      => 'approved',
            'created_at'  => now(),
        ]);

        // Export from PRIMARY tenant — must NOT see the user or their logs
        TenantContext::setById(self::PRIMARY_TENANT_ID);
        $archive = app(MemberDataExportService::class)->buildArchive($userInOther);

        // Profile is empty (user belongs to other tenant)
        $this->assertSame([], $archive['profile']);
        // vol_logs given empty (we filter by primary tenant)
        $this->assertEmpty($archive['vol_logs']['given']);
    }

    public function test_export_request_is_logged(): void
    {
        $userId = $this->makeUser(self::PRIMARY_TENANT_ID);
        $svc    = app(MemberDataExportService::class);

        $before = DB::table('member_data_exports')->count();
        $id     = $svc->recordExportRequest($userId, 'json');
        $after  = DB::table('member_data_exports')->count();

        $this->assertGreaterThan(0, $id);
        $this->assertSame($before + 1, $after);

        $row = DB::table('member_data_exports')->where('id', $id)->first();
        $this->assertSame((int) self::PRIMARY_TENANT_ID, (int) $row->tenant_id);
        $this->assertSame($userId, (int) $row->user_id);
        $this->assertSame('json', $row->format);
    }

    public function test_zip_export_contains_json_and_readme(): void
    {
        $userId = $this->makeUser(self::PRIMARY_TENANT_ID);
        $svc    = app(MemberDataExportService::class);

        $built = $svc->buildZipArchive($userId);
        $this->assertStringEndsWith('.zip', $built['filename']);
        $this->assertNotEmpty($built['content']);

        $tmp = tempnam(sys_get_temp_dir(), 'mdetest_');
        file_put_contents($tmp, $built['content']);

        $zip = new ZipArchive();
        $this->assertTrue($zip->open($tmp) === true, 'ZIP failed to open');
        $this->assertNotFalse($zip->locateName('data.json'), 'Missing data.json inside ZIP');
        $this->assertNotFalse($zip->locateName('README.md'), 'Missing README.md inside ZIP');

        $jsonContents = $zip->getFromName('data.json');
        $this->assertIsString($jsonContents);
        $decoded = json_decode((string) $jsonContents, true);
        $this->assertIsArray($decoded);
        $this->assertArrayHasKey('profile', $decoded);

        $zip->close();
        @unlink($tmp);
    }

    public function test_export_includes_only_the_members_podcast_data(): void
    {
        $userId = $this->makeUser(self::PRIMARY_TENANT_ID);
        $otherId = $this->makeUser(self::PRIMARY_TENANT_ID);
        $showId = (int) DB::table('podcast_shows')->insertGetId([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'owner_user_id' => $userId,
            'title' => 'My portable podcast',
            'slug' => 'portable-podcast-' . uniqid(),
            'owner_email' => 'podcaster@example.test',
            'status' => 'published',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $episodeId = (int) DB::table('podcast_episodes')->insertGetId([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'show_id' => $showId,
            'author_user_id' => $userId,
            'title' => 'My portable episode',
            'slug' => 'portable-episode-' . uniqid(),
            'audio_url' => 'https://media.example.test/portable.mp3',
            'transcript' => 'The member authored this transcript.',
            'status' => 'published',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('podcast_episode_chapters')->insert([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'episode_id' => $episodeId,
            'title' => 'Opening chapter',
            'starts_at_seconds' => 0,
            'position' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('podcast_episode_listens')->insert([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'episode_id' => $episodeId,
            'user_id' => $userId,
            'listened_seconds' => 42,
            'completed' => false,
            'created_at' => now(),
        ]);
        DB::table('podcast_episode_reactions')->insert([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'episode_id' => $episodeId,
            'user_id' => $userId,
            'reaction' => 'like',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('podcast_show_subscriptions')->insert([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'show_id' => $showId,
            'user_id' => $userId,
            'notify_new_episodes' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('podcast_episode_reports')->insert([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'episode_id' => $episodeId,
            'reporter_user_id' => $userId,
            'reason' => 'other',
            'details' => 'My report details',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('podcast_episode_listens')->insert([
            'tenant_id' => self::PRIMARY_TENANT_ID,
            'episode_id' => $episodeId,
            'user_id' => $otherId,
            'listened_seconds' => 99,
            'completed' => true,
            'created_at' => now(),
        ]);

        $archive = app(MemberDataExportService::class)->buildArchive($userId);

        $this->assertSame('My portable podcast', $archive['podcasts']['shows_owned'][0]['title']);
        $this->assertSame('The member authored this transcript.', $archive['podcasts']['episodes_authored'][0]['transcript']);
        $this->assertSame('Opening chapter', $archive['podcasts']['chapters_authored'][0]['title']);
        $this->assertCount(1, $archive['podcasts']['listens']);
        $this->assertSame($userId, (int) $archive['podcasts']['listens'][0]['user_id']);
        $this->assertCount(1, $archive['podcasts']['reactions']);
        $this->assertCount(1, $archive['podcasts']['subscriptions']);
        $this->assertSame('My report details', $archive['podcasts']['reports_filed'][0]['details']);
    }

    public function test_unauthenticated_request_returns_401(): void
    {
        // No Sanctum::actingAs — must be rejected
        $response = $this->apiPost('/v2/me/data-export', ['format' => 'json']);
        $response->assertStatus(401);
    }

    public function test_rate_limit_blocks_after_5_per_day(): void
    {
        $userId = $this->makeUser(self::PRIMARY_TENANT_ID);
        $svc    = app(MemberDataExportService::class);

        // Pre-seed 5 export rows in the last 24h
        for ($i = 0; $i < 5; $i++) {
            DB::table('member_data_exports')->insert([
                'tenant_id'    => self::PRIMARY_TENANT_ID,
                'user_id'      => $userId,
                'format'       => 'json',
                'requested_at' => now()->subHours($i),
                'completed_at' => now()->subHours($i),
                'created_at'   => now()->subHours($i),
                'updated_at'   => now()->subHours($i),
            ]);
        }

        $this->assertSame(5, $svc->countRecentRequests($userId));

        // Now hit the endpoint — must 429
        $userModel = User::find($userId);
        $this->assertNotNull($userModel);
        Sanctum::actingAs($userModel, ['*']);

        $response = $this->apiPost('/v2/me/data-export', ['format' => 'json']);
        $response->assertStatus(429);
    }
}
