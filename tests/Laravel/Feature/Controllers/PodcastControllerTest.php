<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\PodcastService;
use App\Jobs\ProcessPodcastEpisodeMedia;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

class PodcastControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        // Defensively reset auth + tenant state leaked by earlier tests in the full suite.
        //
        // Hypothesis for the polluted failure of
        // test_anonymous_public_listens_are_recorded_without_authentication:
        // the test exercises the anonymous-listen path and asserts the row is written under
        // tenant 2 with user_id NULL. TenantContext re-resolves from the request, reading
        // $_SERVER['HTTP_X_TENANT_ID'] / HTTP_AUTHORIZATION; a prior request can leave those set,
        // pinning the wrong tenant or making the "anonymous" listener resolve as an authenticated
        // user (so user_id is non-null / the listen is attributed elsewhere). The cache-backed
        // listen-dedup + feature flags can likewise carry counters across tests.
        //
        // Clearing the guards, the leaked tenant superglobals, and the (array) cache makes this
        // file behave in the full suite exactly as it does on its own.
        $this->app['auth']->forgetGuards();
        foreach (['HTTP_X_TENANT_ID', 'HTTP_X_TENANT_SLUG', 'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $serverKey) {
            unset($_SERVER[$serverKey]);
        }
        \Illuminate\Support\Facades\Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $this->ensurePodcastTables();
    }

    private function ensurePodcastTables(): void
    {
        if (Schema::hasTable('podcast_shows')) {
            foreach (['podcast_show_subscriptions', 'podcast_episode_reports'] as $table) {
                if (!Schema::hasTable($table)) {
                    $migration = require base_path('database/migrations/2026_06_03_000003_harden_podcast_media_and_moderation.php');
                    $migration->up();
                    break;
                }
            }
            if (Schema::hasTable('podcast_episodes') && !Schema::hasColumn('podcast_episodes', 'media_scan_status')) {
                $migration = require base_path('database/migrations/2026_06_03_000003_harden_podcast_media_and_moderation.php');
                $migration->up();
            }
            foreach (['author_name', 'owner_email', 'copyright', 'funding_url', 'explicit'] as $column) {
                if (!Schema::hasColumn('podcast_shows', $column)) {
                    $migration = require base_path('database/migrations/2026_06_03_000002_add_distribution_metadata_to_podcasts.php');
                    $migration->up();
                    break;
                }
            }
            if (Schema::hasTable('podcast_episodes') && !Schema::hasColumn('podcast_episodes', 'audio_storage_path')) {
                Schema::table('podcast_episodes', function ($table) {
                    $table->string('audio_storage_path', 1000)->nullable()->after('audio_url');
                    $table->string('audio_storage_disk', 50)->nullable()->after('audio_storage_path');
                });
            }
            return;
        }

        $migration = require base_path('database/migrations/2026_06_03_000001_create_podcast_module_tables.php');
        $migration->up();
    }

    private function enablePodcasts(bool $enabled = true): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['podcasts' => $enabled])]);
        TenantContext::setById($this->testTenantId);
    }

    private function actingAsMember(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function actingAsAdmin(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    /** Minimal valid PCM WAV (8kHz mono 16-bit). getID3 reports it as ~2s of genuine audio. */
    private static function tinyWavBytes(int $seconds = 2): string
    {
        $rate = 8000;
        $samples = $rate * $seconds;
        $data = '';
        for ($i = 0; $i < $samples; $i++) {
            $data .= pack('v', (($i >> 4) % 2) ? 8000 : 57536);
        }

        return 'RIFF' . pack('V', 36 + strlen($data)) . 'WAVE'
            . 'fmt ' . pack('V', 16) . pack('v', 1) . pack('v', 1) . pack('V', $rate) . pack('V', $rate * 2) . pack('v', 2) . pack('v', 16)
            . 'data' . pack('V', strlen($data)) . $data;
    }

    public function test_browse_returns_403_when_feature_disabled(): void
    {
        $this->actingAsMember();
        $this->enablePodcasts(false);

        $response = $this->apiGet('/v2/podcasts');

        $response->assertStatus(403);
    }

    public function test_ordinary_member_can_create_and_publish_show_by_default(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $create = $this->apiPost('/v2/podcasts', [
            'title' => 'Neighbourhood Voices',
            'summary' => 'Local stories from members.',
            'visibility' => 'public',
        ]);

        $create->assertStatus(201);
        $showId = $create->json('data.id');

        $publish = $this->apiPost("/v2/podcasts/{$showId}/publish");

        $publish->assertStatus(200);
        $publish->assertJsonPath('data.status', 'published');
        $publish->assertJsonPath('data.moderation_status', 'approved');
    }

    public function test_show_creation_replays_one_result_and_rejects_changed_content(): void
    {
        $this->enablePodcasts(true);
        $member = $this->actingAsMember();
        $headers = ['Idempotency-Key' => 'podcast-show-create-stable-1'];
        $payload = [
            'title' => 'One Durable Show',
            'summary' => 'Created once even if the first response is lost.',
            'idempotency_key' => 'podcast-show-create-stable-1',
        ];

        $first = $this->apiPost('/v2/podcasts', $payload, $headers)->assertCreated();
        $replay = $this->apiPost('/v2/podcasts', $payload, $headers)->assertOk();

        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame(1, DB::table('podcast_creation_receipts')
            ->where('actor_user_id', $member->id)
            ->where('operation_type', 'show')
            ->count());
        $this->assertSame(1, DB::table('podcast_shows')
            ->where('owner_user_id', $member->id)
            ->where('title', 'One Durable Show')
            ->count());

        $this->apiPost('/v2/podcasts', array_merge($payload, ['title' => 'Changed Show']), $headers)
            ->assertStatus(409)
            ->assertJsonPath('errors.0.field', 'idempotency_key');
    }

    public function test_episode_creation_replays_url_and_hosted_audio_without_duplicate_rows(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();
        $showId = $this->apiPost('/v2/podcasts', ['title' => 'Durable Episodes'])->assertCreated()->json('data.id');

        $urlPayload = [
            'title' => 'Durable URL Episode',
            'audio_url' => 'https://example.org/durable.mp3',
            'idempotency_key' => 'podcast-url-episode-stable-1',
        ];
        $urlHeaders = ['Idempotency-Key' => 'podcast-url-episode-stable-1'];
        $firstUrl = $this->apiPost("/v2/podcasts/{$showId}/episodes", $urlPayload, $urlHeaders)->assertCreated();
        $replayedUrl = $this->apiPost("/v2/podcasts/{$showId}/episodes", $urlPayload, $urlHeaders)->assertOk();
        $this->assertSame($firstUrl->json('data.id'), $replayedUrl->json('data.id'));

        Storage::fake('local');
        $audio = self::tinyWavBytes();
        $hostedHeaders = $this->withTenantHeader(['Idempotency-Key' => 'podcast-hosted-episode-stable-1']);
        $firstHosted = $this->post("/api/v2/podcasts/{$showId}/episodes", [
            'title' => 'Durable Hosted Episode',
            'idempotency_key' => 'podcast-hosted-episode-stable-1',
            'audio' => UploadedFile::fake()->createWithContent('durable.wav', $audio),
        ], $hostedHeaders)->assertCreated();
        $replayedHosted = $this->post("/api/v2/podcasts/{$showId}/episodes", [
            'title' => 'Durable Hosted Episode',
            'idempotency_key' => 'podcast-hosted-episode-stable-1',
            'audio' => UploadedFile::fake()->createWithContent('durable.wav', $audio),
        ], $hostedHeaders)->assertOk();

        $this->assertSame($firstHosted->json('data.id'), $replayedHosted->json('data.id'));
        $this->assertSame(2, DB::table('podcast_episodes')->where('show_id', $showId)->count());
        $this->assertSame(2, DB::table('podcast_creation_receipts')->where('operation_type', 'episode')->count());
    }

    public function test_show_title_validation_prevents_database_errors(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $this->apiPost('/v2/podcasts', [
            'title' => str_repeat('A', 201),
        ])->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'title');

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Valid Podcast Title',
        ])->assertStatus(201)->json('data.id');

        $this->apiPut("/v2/podcasts/{$showId}", [
            'title' => '',
        ])->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'title');
    }

    public function test_moderation_can_be_enabled_and_keeps_published_show_pending(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsAdmin();

        $settings = $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => [
                'podcasts.moderation_enabled' => true,
            ],
        ]);
        $settings->assertStatus(200);

        $member = $this->actingAsMember();

        $create = $this->apiPost('/v2/podcasts', [
            'title' => 'Pending Voices',
            'summary' => 'A show that needs review.',
            'visibility' => 'public',
        ]);
        $create->assertStatus(201);

        $showId = $create->json('data.id');
        $publish = $this->apiPost("/v2/podcasts/{$showId}/publish");

        $publish->assertStatus(200);
        $publish->assertJsonPath('data.status', 'published');
        $publish->assertJsonPath('data.moderation_status', 'pending');

        Sanctum::actingAs($member, ['*']);
        $browse = $this->apiGet('/v2/podcasts');
        $browse->assertStatus(200);
        $this->assertNotContains('Pending Voices', array_column($browse->json('data'), 'title'));
    }

    public function test_admin_podcast_config_exposes_moderation_default_off(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsAdmin();

        $response = $this->apiGet('/v2/admin/config/podcasts');

        $response->assertStatus(200);
        $defaults = $response->json('data.defaults');

        $this->assertSame(true, $defaults['podcasts.allow_member_show_creation']);
        $this->assertSame(false, $defaults['podcasts.moderation_enabled']);
    }

    public function test_disabling_member_creation_does_not_lock_existing_creator_studio(): void
    {
        $this->enablePodcasts(true);
        $member = $this->actingAsMember();
        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Existing Creator Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $this->actingAsAdmin();
        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => ['podcasts.allow_member_show_creation' => false],
        ])->assertStatus(200);

        Sanctum::actingAs($member, ['*']);
        $this->apiGet('/v2/podcasts/mine')
            ->assertStatus(200)
            ->assertJsonPath('meta.can_create_show', false)
            ->assertJsonPath('meta.can_manage_existing_shows', true);
        $this->apiPut("/v2/podcasts/{$showId}", ['title' => 'Still Manageable'])
            ->assertStatus(200);
        $this->apiPost('/v2/podcasts', ['title' => 'Blocked New Show'])
            ->assertStatus(403);
    }

    public function test_external_podcast_artwork_is_rejected(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $this->apiPost('/v2/podcasts', [
            'title' => 'No Tracking Pixels',
            'artwork_url' => 'https://attacker.example/tracker.png',
        ])->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VALIDATION_FAILED');
    }

    public function test_cross_tenant_and_traversal_podcast_artwork_paths_are_rejected(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();
        $tenant = TenantContext::get();
        $slug = (string) ($tenant['slug'] ?? 'default');
        $prefix = "/uploads/tenants/{$slug}/podcasts/";
        $paths = [
            '/uploads/tenants/another-tenant/podcasts/art.jpg',
            $prefix . '../art.jpg',
            $prefix . '%2e%2e%2fart.jpg',
            $prefix . 'folder\\art.jpg',
            '/storage/podcasts/art.jpg',
        ];

        foreach ($paths as $index => $path) {
            $this->apiPost('/v2/podcasts', [
                'title' => 'Unsafe Artwork ' . $index,
                'artwork_url' => $path,
            ])->assertStatus(422)
                ->assertJsonPath('errors.0.code', 'VALIDATION_FAILED');
        }
    }

    public function test_owner_uploads_high_resolution_local_artwork_and_delete_cleans_file(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();
        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Uploaded Artwork Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $upload = $this->post("/api/v2/podcasts/{$showId}/artwork", [
            'image' => UploadedFile::fake()->image('artwork.jpg', 1800, 1800),
        ], $this->withTenantHeader())->assertStatus(200);
        $url = (string) $upload->json('data.url');
        $this->assertStringStartsWith('/uploads/tenants/', $url);
        $this->assertStringContainsString('/podcasts/', $url);
        $path = base_path('httpdocs' . $url);
        $this->assertFileExists($path);
        $dimensions = getimagesize($path);
        $this->assertSame(1400, $dimensions[0]);
        $this->assertSame(1400, $dimensions[1]);

        $this->delete("/api/v2/podcasts/{$showId}", [], $this->withTenantHeader())
            ->assertStatus(200);
        $this->assertFileDoesNotExist($path);
    }

    public function test_owner_uploads_episode_cover_and_episode_delete_cleans_file(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();
        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Episode Cover Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $episodeId = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Covered Episode',
            'audio_url' => 'https://cdn.example.test/covered.mp3',
        ])->assertStatus(201)->json('data.id');

        $upload = $this->post("/api/v2/podcasts/{$showId}/episodes/{$episodeId}/cover", [
            'image' => UploadedFile::fake()->image('cover.png', 1600, 1600),
        ], $this->withTenantHeader())->assertStatus(200);
        $path = base_path('httpdocs' . (string) $upload->json('data.url'));
        $this->assertFileExists($path);

        $this->delete("/api/v2/podcasts/{$showId}/episodes/{$episodeId}", [], $this->withTenantHeader())
            ->assertStatus(200);
        $this->assertFileDoesNotExist($path);
    }

    public function test_approved_show_edit_returns_to_moderation_and_hides_feed_activity(): void
    {
        $this->enablePodcasts(true);
        $admin = $this->actingAsAdmin();
        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => ['podcasts.moderation_enabled' => true],
        ])->assertStatus(200);

        $member = $this->actingAsMember();
        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Moderated Original',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        Sanctum::actingAs($admin, ['*']);
        $this->apiPost("/v2/admin/podcasts/shows/{$showId}/moderate", [
            'action' => 'approve',
            'notes' => 'Initial review complete.',
        ])->assertStatus(200);

        Sanctum::actingAs($member, ['*']);
        $this->apiGet('/v2/podcasts/mine')
            ->assertJsonPath('data.0.moderation_feedback', 'Initial review complete.')
            ->assertJsonMissingPath('data.0.moderation_notes')
            ->assertJsonMissingPath('data.0.moderated_by');
        $this->apiPut("/v2/podcasts/{$showId}", ['title' => 'Unreviewed Replacement'])
            ->assertStatus(200)
            ->assertJsonPath('data.moderation_status', 'pending');

        $this->assertSame(0, (int) DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', 'podcast_show')
            ->where('source_id', $showId)
            ->value('is_visible'));

        Sanctum::actingAs($admin, ['*']);
        $this->apiPost("/v2/admin/podcasts/shows/{$showId}/moderate", ['action' => 'approve'])
            ->assertStatus(200);
        $activity = DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', 'podcast_show')
            ->where('source_id', $showId)
            ->first();
        $this->assertSame(1, (int) $activity->is_visible);
        $this->assertSame('Unreviewed Replacement', $activity->title);
    }

    public function test_approved_episode_material_edit_returns_to_moderation(): void
    {
        $this->enablePodcasts(true);
        $admin = $this->actingAsAdmin();
        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => ['podcasts.moderation_enabled' => true],
        ])->assertStatus(200);

        $member = $this->actingAsMember();
        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Moderated Episode Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);
        $episodeId = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Approved Audio',
            'audio_url' => 'https://cdn.example.test/approved.mp3',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        Sanctum::actingAs($admin, ['*']);
        $this->apiPost("/v2/admin/podcasts/shows/{$showId}/moderate", ['action' => 'approve'])
            ->assertStatus(200);
        $this->apiPost("/v2/admin/podcasts/episodes/{$episodeId}/moderate", [
            'action' => 'approve',
            'notes' => 'Audio reviewed.',
        ])->assertStatus(200);

        Sanctum::actingAs($member, ['*']);
        $this->apiPut("/v2/podcasts/{$showId}/episodes/{$episodeId}", [
            'audio_url' => 'https://cdn.example.test/unreviewed-replacement.mp3',
        ])->assertStatus(200)
            ->assertJsonPath('data.moderation_status', 'pending')
            ->assertJsonMissingPath('data.moderation_notes');

        $this->assertSame(0, (int) DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', 'podcast_episode')
            ->where('source_id', $episodeId)
            ->value('is_visible'));
    }

    public function test_browse_can_filter_by_category_and_sort_shows(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $health = $this->apiPost('/v2/podcasts', [
            'title' => 'Wellbeing Weekly',
            'summary' => 'Local wellbeing conversations.',
            'category' => 'Health',
            'visibility' => 'public',
        ]);
        $health->assertStatus(201);
        $healthId = $health->json('data.id');
        $this->apiPost("/v2/podcasts/{$healthId}/publish")->assertStatus(200);

        $arts = $this->apiPost('/v2/podcasts', [
            'title' => 'Arts Archive',
            'summary' => 'Creative community stories.',
            'category' => 'Arts',
            'visibility' => 'public',
        ]);
        $arts->assertStatus(201);
        $artsId = $arts->json('data.id');
        $this->apiPost("/v2/podcasts/{$artsId}/publish")->assertStatus(200);

        $browse = $this->apiGet('/v2/podcasts?category=Health&sort=title');
        $browse->assertStatus(200);
        $browse->assertJsonPath('data.0.title', 'Wellbeing Weekly');
        $this->assertNotContains('Arts Archive', array_column($browse->json('data'), 'title'));
        $this->assertEqualsCanonicalizing(['Arts', 'Health'], $browse->json('meta.categories'));
    }

    public function test_private_episode_is_not_exposed_on_public_show_or_rss(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Public Show',
            'summary' => 'A public show with mixed episodes.',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $showSlug = $show->json('data.slug');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $publicEpisode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Public Episode',
            'audio_url' => 'https://cdn.example.test/public.mp3',
            'audio_bytes' => 1234,
            'visibility' => 'public',
        ]);
        $publicEpisode->assertStatus(201);
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$publicEpisode->json('data.id')}/publish")->assertStatus(200);

        $privateEpisode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Private Episode',
            'audio_url' => 'https://cdn.example.test/private.mp3',
            'audio_bytes' => 1234,
            'visibility' => 'private',
        ]);
        $privateEpisode->assertStatus(201);
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$privateEpisode->json('data.id')}/publish")->assertStatus(200);

        $this->actingAsMember();
        TenantContext::setById($this->testTenantId);

        $publicShow = $this->apiGet("/v2/podcasts/{$showSlug}");
        $publicShow->assertStatus(200);
        $this->assertSame(['Public Episode'], array_column($publicShow->json('data.episodes'), 'title'));
        $publicShow->assertJsonPath('data.episode_count', 1);
        $browse = $this->apiGet('/v2/podcasts?q=Public%20Show');
        $browse->assertStatus(200)->assertJsonPath('data.0.episode_count', 1);


        $rss = $this->get("/api/v2/podcasts/{$showSlug}/feed.xml", $this->withTenantHeader());
        $rss->assertStatus(200);
        $rss->assertSee('Public Episode', false);
        $rss->assertDontSee('Private Episode', false);
        $rss->assertDontSee('private.mp3', false);
    }

    public function test_invalid_audio_url_is_rejected(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'URL Safety',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);

        $episode = $this->apiPost('/v2/podcasts/' . $show->json('data.id') . '/episodes', [
            'title' => 'Bad URL',
            'audio_url' => 'javascript:alert(1)',
        ]);

        $episode->assertStatus(422);

        $this->apiPost('/v2/podcasts/' . $show->json('data.id') . '/episodes', [
            'title' => 'Mixed Content URL',
            'audio_url' => 'http://cdn.example.test/insecure.mp3',
        ])->assertStatus(422);
    }

    public function test_transcripts_can_be_disabled_in_configuration(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsAdmin();
        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => [
                'podcasts.enable_transcripts' => false,
            ],
        ])->assertStatus(200);

        $member = $this->actingAsMember();
        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Transcript Controls',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $showSlug = $show->json('data.slug');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'No Transcript',
            'audio_url' => 'https://cdn.example.test/no-transcript.mp3',
            'transcript' => 'This should not be stored while transcripts are disabled.',
            'visibility' => 'public',
        ]);
        $episode->assertStatus(201);
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episode->json('data.id')}/publish")->assertStatus(200);

        Sanctum::actingAs($member, ['*']);
        $detail = $this->apiGet("/v2/podcasts/{$showSlug}/" . $episode->json('data.slug'));
        $detail->assertStatus(200);
        $this->assertNull($detail->json('data.transcript'));
    }

    public function test_episode_title_and_schedule_validation_prevents_parser_and_database_errors(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Episode Validation Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => str_repeat('B', 201),
            'audio_url' => 'https://cdn.example.test/too-long.mp3',
        ])->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'title');

        $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Bad Date',
            'audio_url' => 'https://cdn.example.test/bad-date.mp3',
            'scheduled_for' => 'not a real date',
        ])->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'scheduled_for');

        $episodeId = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Valid Episode Title',
            'audio_url' => 'https://cdn.example.test/valid.mp3',
        ])->assertStatus(201)->json('data.id');

        $this->apiPut("/v2/podcasts/{$showId}/episodes/{$episodeId}", [
            'title' => '',
        ])->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'title');
    }

    public function test_hosted_private_audio_is_served_only_with_signed_url(): void
    {
        Storage::fake('local');
        Queue::fake([ProcessPodcastEpisodeMedia::class]);
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Hosted Audio',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->post('/api/v2/podcasts/' . $showId . '/episodes', [
            'title' => 'Hosted Private Episode',
            'visibility' => 'private',
            'audio' => UploadedFile::fake()->create('episode.mp3', 128, 'audio/mpeg'),
        ], $this->withTenantHeader());

        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        $audioUrl = $episode->json('data.audio_url');

        $this->assertStringContainsString("/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio", $audioUrl);
        $this->assertStringNotContainsString('signature=', $audioUrl, 'Unready media must not receive a capability signature.');

        $row = DB::table('podcast_episodes')->where('id', $episodeId)->first();
        $this->assertNotNull($row->audio_storage_path);
        Storage::disk('local')->assertExists($row->audio_storage_path);
        DB::table('podcast_episodes')->where('id', $episodeId)->update([
            'media_processing_status' => 'complete',
            'media_scan_status' => 'not_required',
        ]);

        $mine = $this->apiGet('/v2/podcasts/mine')->assertStatus(200);
        $readyEpisode = collect($mine->json('data.0.episodes'))->firstWhere('id', $episodeId);
        $audioUrl = (string) ($readyEpisode['audio_url'] ?? '');
        $this->assertStringContainsString('signature=', $audioUrl, 'Ready restricted media must receive a capability signature.');

        $this->actingAsMember();
        TenantContext::setById($this->testTenantId);

        $unsigned = $this->get(
            "/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio",
            $this->withTenantHeader(),
        );
        $unsigned->assertStatus(404);

        $foreignAdmin = User::factory()->forTenant(1)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($foreignAdmin, ['*']);
        $this->get(
            "/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio",
            $this->withTenantHeader(),
        )->assertStatus(404);

        $foreignMember = User::factory()->forTenant(1)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ]);
        Sanctum::actingAs($foreignMember, ['*']);
        $this->get(
            "/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio",
            $this->withTenantHeader(),
        )->assertStatus(404);

        $signedPath = parse_url($audioUrl, PHP_URL_PATH) . '?' . parse_url($audioUrl, PHP_URL_QUERY);
        $signed = $this->get($signedPath, $this->withTenantHeader());
        $signed->assertStatus(200);
    }

    public function test_owner_email_is_private_in_catalogue_but_visible_to_creator_and_admin(): void
    {
        $this->enablePodcasts(true);
        $creator = $this->actingAsMember();
        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Private Feed Contact',
            'summary' => 'A published show with a private administration contact.',
            'owner_email' => 'feed-owner@example.test',
            'visibility' => 'public',
        ])->assertStatus(201);
        $showId = (int) $show->json('data.id');
        $showSlug = (string) $show->json('data.slug');
        $show->assertJsonPath('data.owner_email', 'feed-owner@example.test');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $viewer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ]);
        Sanctum::actingAs($viewer, ['*']);
        $this->apiGet("/v2/podcasts/{$showSlug}")
            ->assertStatus(200)
            ->assertJsonMissingPath('data.owner_email');
        $catalogue = $this->apiGet('/v2/podcasts')->assertStatus(200);
        $this->assertArrayNotHasKey('owner_email', $catalogue->json('data.0'));

        Sanctum::actingAs($creator, ['*']);
        $authored = $this->apiGet('/v2/podcasts/mine')->assertStatus(200);
        $this->assertSame('feed-owner@example.test', $authored->json('data.0.owner_email'));

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($admin, ['*']);
        $adminIndex = $this->apiGet('/v2/admin/podcasts')->assertStatus(200);
        $adminShow = collect($adminIndex->json('data.shows'))->firstWhere('id', $showId);
        $this->assertSame('feed-owner@example.test', $adminShow['owner_email'] ?? null);
    }

    public function test_member_rss_feed_can_be_fetched_with_tenant_in_url(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Portable Feed',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $showSlug = $show->json('data.slug');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Public Feed Episode',
            'audio_url' => 'https://cdn.example.test/feed.mp3',
            'audio_bytes' => 1234,
            'visibility' => 'public',
        ]);
        $episode->assertStatus(201);
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episode->json('data.id')}/publish")->assertStatus(200);

        $this->app['auth']->forgetGuards();
        TenantContext::reset();

        $rss = $this->get(
            "/api/v2/podcasts/feed/{$this->testTenantId}/{$showSlug}.xml",
            $this->withTenantHeader(),
        );
        $rss->assertStatus(200);
        $rss->assertSee('Public Feed Episode', false);
    }

    public function test_invalid_hosted_audio_upload_rolls_back_episode_creation(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Rollback Audio',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');

        $episode = $this->post('/api/v2/podcasts/' . $showId . '/episodes', [
            'title' => 'Invalid Hosted File',
            'visibility' => 'public',
            'audio' => UploadedFile::fake()->create('episode.txt', 4, 'text/plain'),
        ], $this->withTenantHeader());

        $episode->assertStatus(422);
        $this->assertDatabaseMissing('podcast_episodes', [
            'show_id' => $showId,
            'title' => 'Invalid Hosted File',
        ]);
    }

    public function test_owner_can_archive_episode_and_hide_it_from_public_show(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Archive Controls',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $showSlug = $show->json('data.slug');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Episode To Archive',
            'audio_url' => 'https://cdn.example.test/archive.mp3',
            'visibility' => 'public',
        ]);
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);
        $archive = $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/archive");
        $archive->assertStatus(200);
        $archive->assertJsonPath('data.status', 'archived');

        $this->actingAsMember();
        TenantContext::setById($this->testTenantId);

        $publicShow = $this->apiGet("/v2/podcasts/{$showSlug}");
        $publicShow->assertStatus(200);
        $this->assertSame([], array_column($publicShow->json('data.episodes'), 'title'));
    }

    public function test_hosted_audio_supports_byte_range_requests(): void
    {
        Storage::fake('local');
        Queue::fake([ProcessPodcastEpisodeMedia::class]);
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Range Audio',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->post('/api/v2/podcasts/' . $showId . '/episodes', [
            'title' => 'Seekable Episode',
            'visibility' => 'public',
            'audio' => UploadedFile::fake()->createWithContent('episode.mp3', str_repeat('a', 1024)),
        ], $this->withTenantHeader());
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        DB::table('podcast_episodes')->where('id', $episodeId)->update([
            'media_processing_status' => 'complete',
            'media_scan_status' => 'not_required',
        ]);
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $this->app['auth']->forgetGuards();
        TenantContext::reset();

        $range = $this->get(
            "/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio",
            array_merge($this->withTenantHeader(), ['Range' => 'bytes=0-99']),
        );

        $range->assertStatus(206);
        $this->assertSame('bytes 0-99/1024', $range->headers->get('Content-Range'));
        $this->assertSame('100', $range->headers->get('Content-Length'));
    }

    public function test_rss_exposes_portable_transcript_and_chapter_resources(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Accessible Feed',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $showSlug = $show->json('data.slug');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Transcript Episode',
            'audio_url' => 'https://cdn.example.test/transcript.mp3',
            'audio_bytes' => 1234,
            'visibility' => 'public',
            'transcript' => 'Hello from the transcript.',
            'transcript_language' => 'en',
            'chapters' => [
                ['title' => 'Intro', 'starts_at_seconds' => 0],
                ['title' => 'Interview', 'starts_at_seconds' => 60],
            ],
        ]);
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $this->actingAsMember();
        TenantContext::reset();

        $rss = $this->get(
            "/api/v2/podcasts/feed/{$this->testTenantId}/{$showSlug}.xml",
            $this->withTenantHeader(),
        );
        $rss->assertStatus(200);
        $rss->assertSee('/api/v2/podcasts/transcripts/' . $this->testTenantId . '/' . $episodeId . '.txt', false);
        $rss->assertSee('/api/v2/podcasts/chapters/' . $this->testTenantId . '/' . $episodeId . '.json', false);
        $rss->assertSee('podcast:transcript', false);
        $rss->assertSee('podcast:chapters', false);

        $transcript = $this->get(
            "/api/v2/podcasts/transcripts/{$this->testTenantId}/{$episodeId}.txt",
            $this->withTenantHeader(),
        );
        $transcript->assertStatus(200);
        $this->assertSame('text/plain; charset=UTF-8', $transcript->headers->get('Content-Type'));
        $transcript->assertSee('Hello from the transcript.', false);

        $chapters = $this->get(
            "/api/v2/podcasts/chapters/{$this->testTenantId}/{$episodeId}.json",
            $this->withTenantHeader(),
        );
        $chapters->assertStatus(200);
        $chapters->assertJsonPath('chapters.0.title', 'Intro');
        $chapters->assertJsonPath('chapters.1.startTime', 60);
    }

    public function test_public_chapter_resources_strip_non_http_urls(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Safe Chapters',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Chapter Links',
            'audio_url' => 'https://cdn.example.test/chapter-links.mp3',
            'audio_bytes' => 1234,
            'visibility' => 'public',
            'chapters' => [
                ['title' => 'Unsafe', 'starts_at_seconds' => 0, 'url' => 'javascript:alert(1)'],
                ['title' => 'Safe', 'starts_at_seconds' => 30, 'url' => 'https://example.test/context'],
            ],
        ]);
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);
        $updatedChapters = DB::table('podcast_episode_chapters')
            ->where('tenant_id', $this->testTenantId)
            ->where('episode_id', $episodeId)
            ->where('title', 'Unsafe')
            ->update(['url' => 'javascript:alert(1)']);
        $this->assertSame(1, $updatedChapters);
        $this->assertSame('javascript:alert(1)', DB::table('podcast_episode_chapters')
            ->where('tenant_id', $this->testTenantId)
            ->where('episode_id', $episodeId)
            ->where('title', 'Unsafe')
            ->value('url'));

        $this->actingAsMember();
        TenantContext::reset();

        $chapters = $this->get(
            "/api/v2/podcasts/chapters/{$this->testTenantId}/{$episodeId}.json",
            $this->withTenantHeader(),
        );

        $chapters->assertStatus(200);
        $chapters->assertDontSee('javascript:alert(1)', false);
        $chapters->assertJsonPath('chapters.0.url', null);
        $chapters->assertJsonPath('chapters.1.url', 'https://example.test/context');
    }

    public function test_rss_exposes_directory_metadata_and_sanitizes_funding_url(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Directory Ready',
            'summary' => 'A show configured for podcast directories.',
            'description' => 'Stories and practical advice from the community.',
            'visibility' => 'public',
            'category' => 'Society & Culture',
            'owner_email' => 'producer@example.test',
            'author_name' => 'NEXUS Producers',
            'copyright' => 'Copyright 2026 NEXUS Producers',
            'funding_url' => 'javascript:alert(1)',
            'explicit' => true,
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $showSlug = $show->json('data.slug');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Trailer',
            'audio_url' => 'https://cdn.example.test/trailer.mp3',
            'audio_mime' => 'audio/mpeg',
            'audio_bytes' => 4096,
            'duration_seconds' => 93,
            'episode_type' => 'trailer',
            'season_number' => 2,
            'episode_number' => 1,
            'visibility' => 'public',
        ]);
        $episode->assertStatus(201);
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episode->json('data.id')}/publish")->assertStatus(200);

        $this->actingAsMember();
        TenantContext::setById($this->testTenantId);

        $rss = $this->get("/api/v2/podcasts/{$showSlug}/feed.xml", $this->withTenantHeader());
        $rss->assertStatus(200);
        $rss->assertSee('<itunes:author>', false);
        $rss->assertDontSee('NEXUS Producers</itunes:author>', false);
        $rss->assertDontSee('<itunes:owner>', false);
        $rss->assertDontSee('producer@example.test', false);
        $rss->assertSee('<itunes:category text="Society &amp; Culture" />', false);
        $rss->assertSee('<copyright>Copyright 2026 NEXUS Producers</copyright>', false);
        $rss->assertSee('<itunes:explicit>true</itunes:explicit>', false);
        $rss->assertSee('<itunes:episodeType>trailer</itunes:episodeType>', false);
        $rss->assertSee('<itunes:season>2</itunes:season>', false);
        $rss->assertSee('<itunes:episode>1</itunes:episode>', false);
        $rss->assertDontSee('javascript:alert', false);
        $rss->assertDontSee('<podcast:funding', false);
    }

    public function test_admin_approval_records_podcast_feed_activity(): void
    {
        $this->enablePodcasts(true);
        $admin = $this->actingAsAdmin();
        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => [
                'podcasts.moderation_enabled' => true,
            ],
        ])->assertStatus(200);

        $this->actingAsMember();
        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Approval Feed Show',
            'summary' => 'A moderated show.',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        Sanctum::actingAs($admin, ['*']);
        $approve = $this->apiPost("/v2/admin/podcasts/shows/{$showId}/moderate", [
            'action' => 'approve',
        ]);
        $approve->assertStatus(200);

        $this->assertDatabaseHas('feed_activity', [
            'tenant_id' => $this->testTenantId,
            'source_type' => 'podcast_show',
            'source_id' => $showId,
        ]);
    }

    public function test_podcast_feed_activity_tracks_visibility_moderation_archive_and_delete_lifecycle(): void
    {
        $this->enablePodcasts(true);
        $owner = $this->actingAsMember();
        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Lifecycle Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);
        $episodeId = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Lifecycle Episode',
            'audio_url' => 'https://cdn.example.test/lifecycle.mp3',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $visibility = fn (string $type, int $id) => DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', $type)
            ->where('source_id', $id)
            ->value('is_visible');
        $this->assertSame(1, (int) $visibility('podcast_show', $showId));
        $this->assertSame(1, (int) $visibility('podcast_episode', $episodeId));

        $this->apiPut("/v2/podcasts/{$showId}", ['visibility' => 'private'])
            ->assertStatus(200);
        $this->assertSame(0, (int) $visibility('podcast_show', $showId));
        $this->assertSame(0, (int) $visibility('podcast_episode', $episodeId));
        $this->apiPut("/v2/podcasts/{$showId}", [
            'visibility' => 'public',
            'title' => 'Lifecycle Show Current',
        ])->assertStatus(200);
        $this->assertSame(1, (int) $visibility('podcast_show', $showId));
        $this->assertSame('Lifecycle Show Current', DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', 'podcast_show')
            ->where('source_id', $showId)
            ->value('title'));

        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/archive")->assertStatus(200);
        $this->assertSame(0, (int) $visibility('podcast_episode', $episodeId));
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);
        $this->assertSame(1, (int) $visibility('podcast_episode', $episodeId));
        $this->apiPost("/v2/podcasts/{$showId}/archive")->assertStatus(200);
        $this->assertSame(0, (int) $visibility('podcast_show', $showId));
        $this->assertSame(0, (int) $visibility('podcast_episode', $episodeId));
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $admin = $this->actingAsAdmin();
        $this->apiPost("/v2/admin/podcasts/shows/{$showId}/moderate", ['action' => 'flag'])->assertStatus(200);
        $this->assertSame(0, (int) $visibility('podcast_show', $showId));
        $this->assertSame(0, (int) $visibility('podcast_episode', $episodeId));
        $this->apiPost("/v2/admin/podcasts/shows/{$showId}/moderate", ['action' => 'approve'])->assertStatus(200);
        $this->apiPost("/v2/admin/podcasts/episodes/{$episodeId}/moderate", ['action' => 'flag'])->assertStatus(200);
        $this->assertSame(0, (int) $visibility('podcast_episode', $episodeId));
        $this->apiPost("/v2/admin/podcasts/episodes/{$episodeId}/moderate", ['action' => 'approve'])->assertStatus(200);
        $this->assertSame(1, (int) $visibility('podcast_episode', $episodeId));

        Sanctum::actingAs($owner, ['*']);
        $this->delete("/api/v2/podcasts/{$showId}", [], $this->withTenantHeader())->assertStatus(200);
        $this->assertDatabaseMissing('feed_activity', ['tenant_id' => $this->testTenantId, 'source_type' => 'podcast_show', 'source_id' => $showId]);
        $this->assertDatabaseMissing('feed_activity', ['tenant_id' => $this->testTenantId, 'source_type' => 'podcast_episode', 'source_id' => $episodeId]);
    }

    public function test_admin_index_includes_listen_completion_analytics(): void
    {
        $this->enablePodcasts(true);
        $admin = $this->actingAsAdmin();
        $member = $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Analytics Show',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Analytics Episode',
            'audio_url' => 'https://cdn.example.test/analytics.mp3',
            'visibility' => 'public',
            'duration_seconds' => 120,
        ]);
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        Sanctum::actingAs($member, ['*']);
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/listen", [
            'listened_seconds' => 30,
            'completed' => false,
            'session_id' => 'analytics-a',
        ])->assertStatus(200);
        $secondMember = $this->actingAsMember();
        Sanctum::actingAs($secondMember, ['*']);
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/listen", [
            'listened_seconds' => 120,
            'completed' => true,
            'session_id' => 'analytics-b',
        ])->assertStatus(200);

        Sanctum::actingAs($admin, ['*']);
        $adminIndex = $this->apiGet('/v2/admin/podcasts');
        $adminIndex->assertStatus(200);
        $adminIndex->assertJsonPath('data.stats.total_listens', 2);
        $adminIndex->assertJsonPath('data.stats.completed_listens', 1);
        $adminIndex->assertJsonPath('data.stats.completion_rate', 50);
        $adminIndex->assertJsonPath('data.top_episodes.0.id', $episodeId);
        $adminIndex->assertJsonPath('data.top_episodes.0.listen_count', 2);
    }

    public function test_repeated_listens_from_same_session_do_not_inflate_episode_count(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Deduped Analytics Show',
            'visibility' => 'public',
        ]);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Deduped Analytics Episode',
            'audio_url' => 'https://cdn.example.test/deduped.mp3',
            'visibility' => 'public',
            'duration_seconds' => 45,
        ]);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/listen", [
            'listened_seconds' => 15,
            'session_id' => 'repeat-session',
        ])->assertStatus(200);
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/listen", [
            'listened_seconds' => 45,
            'session_id' => 'repeat-session',
            'completed' => true,
        ])->assertStatus(200);

        $this->assertSame(1, (int) DB::table('podcast_episode_listens')->where('episode_id', $episodeId)->count());
        $this->assertSame(1, (int) DB::table('podcast_episodes')->where('id', $episodeId)->value('listen_count'));
        $this->assertDatabaseHas('podcast_episode_listens', [
            'tenant_id' => $this->testTenantId,
            'episode_id' => $episodeId,
            'listened_seconds' => 45,
            'completed' => 1,
        ]);
    }

    public function test_long_reaction_values_are_normalized_before_storage(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Reaction Normalization Show',
            'visibility' => 'public',
        ]);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Reaction Normalization Episode',
            'audio_url' => 'https://cdn.example.test/reaction.mp3',
            'visibility' => 'public',
        ]);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $reaction = str_repeat('celebrate-', 10);
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/reaction", [
            'reaction' => $reaction,
        ])->assertStatus(200)
            ->assertJsonPath('data.active', true);

        $stored = (string) DB::table('podcast_episode_reactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('episode_id', $episodeId)
            ->value('reaction');
        $this->assertSame(30, strlen($stored));

        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/reaction", [
            'reaction' => $reaction,
        ])->assertStatus(200)
            ->assertJsonPath('data.active', false);
    }

    public function test_episode_reaction_addition_is_gated_but_removal_remains_available(): void
    {
        $this->enablePodcasts(true);
        $author = $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Safeguarded Reaction Show',
            'visibility' => 'public',
        ]);
        $showId = (int) $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertOk();

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Safeguarded Reaction Episode',
            'audio_url' => 'https://cdn.example.test/safeguarded-reaction.mp3',
            'visibility' => 'public',
        ]);
        $episodeId = (int) $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertOk();

        $reactor = $this->actingAsMember();
        $blockedPolicy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $blockedPolicy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($reactor->id, $author->id, $this->testTenantId, 'podcast_episode_reaction')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $blockedPolicy);

        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/reaction", ['reaction' => 'like'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('podcast_episode_reactions', [
            'tenant_id' => $this->testTenantId,
            'episode_id' => $episodeId,
            'user_id' => $reactor->id,
            'reaction' => 'like',
        ]);

        $allowedPolicy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $allowedPolicy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($reactor->id, $author->id, $this->testTenantId, 'podcast_episode_reaction');
        $this->app->instance(SafeguardingInteractionPolicy::class, $allowedPolicy);
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/reaction", ['reaction' => 'like'])
            ->assertOk()
            ->assertJsonPath('data.active', true);

        $removalPolicy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $removalPolicy->shouldNotReceive('assertLocalContactAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $removalPolicy);
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/reaction", ['reaction' => 'like'])
            ->assertOk()
            ->assertJsonPath('data.active', false);
        $this->assertDatabaseMissing('podcast_episode_reactions', [
            'tenant_id' => $this->testTenantId,
            'episode_id' => $episodeId,
            'user_id' => $reactor->id,
            'reaction' => 'like',
        ]);
    }

    public function test_anonymous_public_listens_are_recorded_without_authentication(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Public Listen Analytics Show',
            'visibility' => 'public',
        ]);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Public Listen Analytics Episode',
            'audio_url' => 'https://cdn.example.test/public-listen.mp3',
            'visibility' => 'public',
            'duration_seconds' => 90,
        ]);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $this->app['auth']->forgetGuards();
        TenantContext::setById($this->testTenantId);

        $this->withHeader('User-Agent', 'Mozilla/5.0')->apiPost("/v2/podcasts/episodes/{$episodeId}/listen", [
            'listened_seconds' => 120,
            'session_id' => 'anonymous-public-listener',
            'completed' => true,
        ])->assertStatus(200);

        $this->assertDatabaseHas('podcast_episode_listens', [
            'tenant_id' => $this->testTenantId,
            'episode_id' => $episodeId,
            'user_id' => null,
            'listened_seconds' => 90,
            'completed' => 1,
            'client_family' => 'browser',
        ]);
        $this->assertSame(1, (int) DB::table('podcast_episodes')->where('id', $episodeId)->value('listen_count'));
    }

    public function test_anonymous_private_listens_are_not_recorded(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Private Listen Analytics Show',
            'visibility' => 'public',
        ]);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Private Listen Analytics Episode',
            'audio_url' => 'https://cdn.example.test/private-listen.mp3',
            'visibility' => 'private',
        ]);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $this->app['auth']->forgetGuards();
        TenantContext::setById($this->testTenantId);

        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/listen", [
            'listened_seconds' => 30,
            'session_id' => 'anonymous-private-listener',
        ])->assertStatus(404);

        $this->assertDatabaseMissing('podcast_episode_listens', [
            'tenant_id' => $this->testTenantId,
            'episode_id' => $episodeId,
        ]);
    }

    public function test_scheduled_episode_is_announced_only_once_when_due(): void
    {
        $this->enablePodcasts(true);

        // A subscriber distinct from the episode author (the author is never notified).
        $subscriber = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        // Author creates + publishes a public show.
        $author = $this->actingAsMember();
        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Scheduled Show',
            'summary' => 'Episodes published on a timer.',
            'visibility' => 'public',
        ])->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        // Subscriber opts in to new-episode notifications.
        Sanctum::actingAs($subscriber, ['*']);
        $this->apiPost("/v2/podcasts/{$showId}/subscribe", ['notify_new_episodes' => true])->assertStatus(200);

        // Author publishes an episode scheduled for the future.
        Sanctum::actingAs($author, ['*']);
        $episodeId = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Future Episode',
            'audio_url' => 'https://cdn.example.test/future.mp3',
            'audio_bytes' => 1234,
            'visibility' => 'public',
            'scheduled_for' => now()->addDay()->toIso8601String(),
        ])->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        // It must NOT be announced while still embargoed.
        $this->assertNull(DB::table('podcast_episodes')->where('id', $episodeId)->value('announced_at'));
        $this->assertDatabaseMissing('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $subscriber->id,
            'type' => 'podcast_episode',
        ]);

        // Its scheduled time arrives.
        DB::table('podcast_episodes')->where('id', $episodeId)->update([
            'scheduled_for' => now()->subMinute(),
            'published_at' => now()->subMinute(),
        ]);

        TenantContext::setById($this->testTenantId);
        PodcastService::releaseDueEpisodes();

        // Now it is announced exactly once.
        $this->assertNotNull(DB::table('podcast_episodes')->where('id', $episodeId)->value('announced_at'));
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $subscriber->id,
            'type' => 'podcast_episode',
        ]);

        // Re-running the scheduler must not produce a duplicate notification.
        PodcastService::releaseDueEpisodes();
        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $subscriber->id)
            ->where('type', 'podcast_episode')
            ->count());
    }

    public function test_release_due_episodes_restores_missing_tenant_context(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Tenant Context Release Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episodeId = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Due Episode Context Reset',
            'audio_url' => 'https://cdn.example.test/context-reset.mp3',
            'visibility' => 'public',
            'scheduled_for' => now()->subMinute()->toIso8601String(),
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        DB::table('podcast_episodes')->where('id', $episodeId)->update(['announced_at' => null]);

        TenantContext::reset();
        PodcastService::releaseDueEpisodes();

        $this->assertNull(TenantContext::currentId());
    }

    public function test_cloud_storage_can_be_selected_but_local_remains_default(): void
    {
        Storage::fake('local');
        Storage::fake('s3');
        Queue::fake([ProcessPodcastEpisodeMedia::class]);
        $this->enablePodcasts(true);
        $this->actingAsAdmin();

        $config = $this->apiGet('/v2/admin/config/podcasts');
        $config->assertStatus(200);
        $this->assertSame('local', $config->json('data.defaults')['podcasts.media_storage_driver']);

        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => [
                'podcasts.media_storage_driver' => 'cloud',
                'podcasts.cloud_storage_disk' => 's3',
                'podcasts.cloud_cdn_base_url' => 'https://media.example.test',
            ],
        ])->assertStatus(200);

        $this->actingAsMember();
        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Cloud Ready Show',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $showSlug = $show->json('data.slug');

        $episode = $this->post("/api/v2/podcasts/{$showId}/episodes", [
            'title' => 'Cloud Audio',
            'audio' => UploadedFile::fake()->create('cloud.mp3', 2, 'audio/mpeg'),
        ], $this->withTenantHeader());
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        $storagePath = DB::table('podcast_episodes')->where('id', $episodeId)->value('audio_storage_path');
        $this->assertSame('s3', DB::table('podcast_episodes')->where('id', $episodeId)->value('audio_storage_disk'));
        Storage::disk('s3')->assertExists($storagePath);
        $this->assertStringContainsString(
            "/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio",
            $episode->json('data.audio_url'),
        );
        $this->assertStringNotContainsString('media.example.test', $episode->json('data.audio_url'));

        DB::table('podcast_episodes')->where('id', $episodeId)->update([
            'media_processing_status' => 'complete',
            'media_scan_status' => 'not_required',
        ]);
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);
        $publicShow = $this->apiGet("/v2/podcasts/{$showSlug}")->assertStatus(200);
        $readyEpisode = collect($publicShow->json('data.episodes'))->firstWhere('id', $episodeId);
        $this->assertStringStartsWith('https://media.example.test/podcasts/', (string) ($readyEpisode['audio_url'] ?? ''));

        $this->apiDelete("/v2/podcasts/{$showId}/episodes/{$episodeId}")->assertStatus(200);
        Storage::disk('s3')->assertMissing($storagePath);
    }

    public function test_cloud_private_audio_uses_signed_proxy_instead_of_public_cdn_url(): void
    {
        Storage::fake('s3');
        Queue::fake([ProcessPodcastEpisodeMedia::class]);
        $this->enablePodcasts(true);
        $this->actingAsAdmin();

        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => [
                'podcasts.media_storage_driver' => 'cloud',
                'podcasts.cloud_storage_disk' => 's3',
                'podcasts.cloud_cdn_base_url' => 'https://media.example.test',
            ],
        ])->assertStatus(200);

        $this->actingAsMember();
        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Members Cloud Show',
            'visibility' => 'members',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');

        $episode = $this->post("/api/v2/podcasts/{$showId}/episodes", [
            'title' => 'Members Cloud Audio',
            'visibility' => 'members',
            'audio' => UploadedFile::fake()->create('members-cloud.mp3', 2, 'audio/mpeg'),
        ], $this->withTenantHeader());
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');

        $audioUrl = $episode->json('data.audio_url');
        $this->assertStringContainsString("/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio", $audioUrl);
        $this->assertStringNotContainsString('signature=', $audioUrl, 'Unready media must not receive a capability signature.');
        $this->assertStringNotContainsString('media.example.test', $audioUrl);

        DB::table('podcast_episodes')->where('id', $episodeId)->update([
            'audio_url' => 'https://media.example.test/podcasts/legacy-pending.mp3',
        ]);
        $pendingMine = $this->apiGet('/v2/podcasts/mine')->assertStatus(200);
        $pendingEpisode = collect($pendingMine->json('data.0.episodes'))->firstWhere('id', $episodeId);
        $pendingAudioUrl = (string) ($pendingEpisode['audio_url'] ?? '');
        $this->assertStringContainsString("/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio", $pendingAudioUrl);
        $this->assertStringNotContainsString('signature=', $pendingAudioUrl);
        $this->assertStringNotContainsString('media.example.test', $pendingAudioUrl);

        DB::table('podcast_episodes')->where('id', $episodeId)->update([
            'media_processing_status' => 'complete',
            'media_scan_status' => 'not_required',
        ]);
        $mine = $this->apiGet('/v2/podcasts/mine')->assertStatus(200);
        $readyEpisode = collect($mine->json('data.0.episodes'))->firstWhere('id', $episodeId);
        $audioUrl = (string) ($readyEpisode['audio_url'] ?? '');
        $this->assertStringContainsString("/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio", $audioUrl);
        $this->assertStringContainsString('signature=', $audioUrl);
        $this->assertStringNotContainsString('media.example.test', $audioUrl);
    }

    public function test_media_processing_job_does_not_mark_audio_clean_without_scanner(): void
    {
        Storage::fake('local');
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Scanner Honesty Show',
            'visibility' => 'public',
        ]);
        $showId = $show->json('data.id');

        // Real (tiny WAV) audio so getID3 content analysis recognises it.
        $episode = $this->post("/api/v2/podcasts/{$showId}/episodes", [
            'title' => 'Unscanned Audio',
            'audio' => UploadedFile::fake()->createWithContent('unscanned.wav', self::tinyWavBytes()),
        ], $this->withTenantHeader());
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        DB::table('podcast_episodes')->where('id', $episodeId)->update(['media_scan_status' => 'pending']);

        (new ProcessPodcastEpisodeMedia($this->testTenantId, $episodeId))->handle();

        // Without a configured scanner, media is never labelled clean —
        // but genuine audio still completes processing with detected duration.
        $this->assertSame('scan_unavailable', DB::table('podcast_episodes')->where('id', $episodeId)->value('media_scan_status'));
        $this->assertSame('complete', DB::table('podcast_episodes')->where('id', $episodeId)->value('media_processing_status'));
        $this->assertSame(2, (int) DB::table('podcast_episodes')->where('id', $episodeId)->value('duration_seconds'));
        $this->assertSame('detected', DB::table('podcast_episodes')->where('id', $episodeId)->value('media_duration_source'));
    }

    public function test_media_processing_job_restores_missing_tenant_context(): void
    {
        Storage::fake('local');
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Media Job Tenant Context Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $episodeId = $this->post("/api/v2/podcasts/{$showId}/episodes", [
            'title' => 'Context-clean Audio',
            'audio' => UploadedFile::fake()->create('context-clean.mp3', 2, 'audio/mpeg'),
        ], $this->withTenantHeader())->assertStatus(201)->json('data.id');

        TenantContext::reset();
        (new ProcessPodcastEpisodeMedia($this->testTenantId, $episodeId))->handle();

        $this->assertNull(TenantContext::currentId());
    }

    public function test_members_can_subscribe_and_report_episodes_for_moderation(): void
    {
        $this->enablePodcasts(true);
        $member = $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Subscribed Show',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Reportable Episode',
            'audio_url' => 'https://cdn.example.test/reportable.mp3',
            'visibility' => 'public',
        ]);
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $subscribe = $this->apiPost("/v2/podcasts/{$showId}/subscribe", [
            'notify_new_episodes' => true,
        ]);
        $subscribe->assertStatus(200);
        $subscribe->assertJsonPath('data.subscribed', true);
        $this->apiPost("/v2/podcasts/{$showId}/subscribe", [
            'notify_new_episodes' => true,
            'subscribed' => true,
        ])->assertJsonPath('data.subscribed', true);
        $this->assertSame(1, (int) DB::table('podcast_show_subscriptions')
            ->where('tenant_id', $this->testTenantId)
            ->where('show_id', $showId)
            ->where('user_id', $member->id)
            ->count());

        $report = $this->apiPost("/v2/podcasts/episodes/{$episodeId}/report", [
            'reason' => 'safety',
            'details' => 'Needs moderator review.',
        ]);
        $report->assertStatus(201);

        $this->assertDatabaseHas('podcast_show_subscriptions', [
            'tenant_id' => $this->testTenantId,
            'show_id' => $showId,
            'user_id' => $member->id,
            'notify_new_episodes' => 1,
        ]);
        $this->assertDatabaseHas('podcast_episode_reports', [
            'tenant_id' => $this->testTenantId,
            'episode_id' => $episodeId,
            'reporter_user_id' => $member->id,
            'status' => 'open',
        ]);

        $admin = $this->actingAsAdmin();
        Sanctum::actingAs($admin, ['*']);
        $adminIndex = $this->apiGet('/v2/admin/podcasts');
        $adminIndex->assertStatus(200);
        $adminIndex->assertJsonPath('data.stats.open_reports', 1);
        $adminIndex->assertJsonPath('data.reports.0.episode_id', $episodeId);
        $adminIndex->assertJsonPath('data.reports.0.episode_title', 'Reportable Episode');
        $adminIndex->assertJsonPath('data.reports.0.show_title', 'Subscribed Show');
        $adminIndex->assertJsonPath('data.reports.0.reporter_name', $member->name);
    }

    public function test_duplicate_open_reports_are_coalesced_per_member_and_episode(): void
    {
        $this->enablePodcasts(true);
        $member = $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Single Report Show',
            'visibility' => 'public',
        ]);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Single Report Episode',
            'audio_url' => 'https://cdn.example.test/single-report.mp3',
            'visibility' => 'public',
        ]);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $first = $this->apiPost("/v2/podcasts/episodes/{$episodeId}/report", [
            'reason' => 'safety',
            'details' => 'First report.',
        ]);
        $first->assertStatus(201);

        $second = $this->apiPost("/v2/podcasts/episodes/{$episodeId}/report", [
            'reason' => 'abuse',
            'details' => 'Additional context.',
        ]);
        $second->assertStatus(201);
        $second->assertJsonPath('data.id', $first->json('data.id'));

        $this->assertSame(1, (int) DB::table('podcast_episode_reports')
            ->where('tenant_id', $this->testTenantId)
            ->where('episode_id', $episodeId)
            ->where('reporter_user_id', $member->id)
            ->where('status', 'open')
            ->count());
        $this->assertDatabaseHas('podcast_episode_reports', [
            'id' => $first->json('data.id'),
            'reason' => 'abuse',
            'details' => 'Additional context.',
        ]);
    }

    public function test_admin_can_resolve_episode_reports(): void
    {
        $this->enablePodcasts(true);
        $member = $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Resolvable Reports Show',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Reported Episode',
            'audio_url' => 'https://cdn.example.test/reported.mp3',
            'visibility' => 'public',
            'chapters' => [['title' => 'Review context', 'starts_at_seconds' => 0]],
        ]);
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $report = $this->apiPost("/v2/podcasts/episodes/{$episodeId}/report", [
            'reason' => 'safety',
            'details' => 'Needs review.',
        ])->assertStatus(201);
        $reportId = (int) $report->json('data.id');

        $admin = $this->actingAsAdmin();
        Sanctum::actingAs($admin, ['*']);
        $adminIndex = $this->apiGet('/v2/admin/podcasts')->assertStatus(200);
        $adminEpisode = collect($adminIndex->json('data.episodes'))->firstWhere('id', $episodeId);
        $this->assertSame('Review context', $adminEpisode['chapters'][0]['title']);
        $this->assertSame($reportId, $adminEpisode['report_history'][0]['id']);
        $this->assertSame('open', $adminEpisode['report_history'][0]['status']);
        $resolve = $this->apiPost("/v2/admin/podcasts/reports/{$reportId}/resolve", [
            'status' => 'resolved',
            'notes' => 'Reviewed and closed.',
        ]);

        $resolve->assertStatus(200);
        $resolve->assertJsonPath('data.report_id', $reportId);
        $resolve->assertJsonPath('data.open_reports', 0);
        $this->assertDatabaseHas('podcast_episode_reports', [
            'tenant_id' => $this->testTenantId,
            'episode_id' => $episodeId,
            'reporter_user_id' => $member->id,
            'status' => 'resolved',
            'reviewed_by' => $admin->id,
        ]);
    }

    public function test_single_report_keeps_episode_visible_until_distinct_threshold(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Threshold Show',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $showSlug = $show->json('data.slug');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Threshold Episode',
            'audio_url' => 'https://cdn.example.test/threshold.mp3',
            'visibility' => 'public',
        ]);
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        $episodeSlug = $episode->json('data.slug');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        // A single member report must NOT hide the episode (anti-griefing).
        $this->actingAsMember();
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/report", ['reason' => 'safety'])->assertStatus(201);
        $this->assertDatabaseHas('podcast_episodes', [
            'id' => $episodeId,
            'moderation_status' => 'approved',
        ]);
        $this->apiGet("/v2/podcasts/{$showSlug}/{$episodeSlug}")->assertStatus(200);

        // Two more distinct reporters reach the threshold (3) → auto-flagged.
        $this->actingAsMember();
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/report", ['reason' => 'safety'])->assertStatus(201);
        $this->actingAsMember();
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/report", ['reason' => 'safety'])->assertStatus(201);

        $this->assertDatabaseHas('podcast_episodes', [
            'id' => $episodeId,
            'moderation_status' => 'flagged',
        ]);
    }

    public function test_episode_endpoint_exposes_viewer_reaction_state(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Reaction Show',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $showSlug = $show->json('data.slug');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Reaction Episode',
            'audio_url' => 'https://cdn.example.test/reaction.mp3',
            'visibility' => 'public',
        ]);
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        $episodeSlug = $episode->json('data.slug');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $before = $this->apiGet("/v2/podcasts/{$showSlug}/{$episodeSlug}");
        $before->assertStatus(200);
        $before->assertJsonPath('data.viewer_has_reacted', false);
        $before->assertJsonPath('data.reaction_count', 0);

        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/reaction", ['reaction' => 'like'])
            ->assertJsonPath('data.active', true);
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/reaction", [
            'reaction' => 'like',
            'active' => true,
        ])->assertJsonPath('data.active', true);
        $this->assertSame(1, (int) DB::table('podcast_episode_reactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('episode_id', $episodeId)
            ->count());

        $after = $this->apiGet("/v2/podcasts/{$showSlug}/{$episodeSlug}");
        $after->assertJsonPath('data.viewer_has_reacted', true);
        $after->assertJsonPath('data.reaction_count', 1);
    }

    public function test_subscribers_are_notified_when_episode_is_published(): void
    {
        $this->enablePodcasts(true);
        $creator = $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Subscriber Updates',
            'visibility' => 'public',
        ]);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $subscriber = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($subscriber, ['*']);
        $this->apiPost("/v2/podcasts/{$showId}/subscribe", [
            'notify_new_episodes' => true,
        ])->assertStatus(200);

        Sanctum::actingAs($creator, ['*']);
        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'New Subscriber Episode',
            'audio_url' => 'https://cdn.example.test/subscriber.mp3',
            'visibility' => 'public',
        ]);
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);
        // A response-loss retry is the same transition and must not fan out a
        // second subscriber notification.
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $subscriber->id,
            'type' => 'podcast_episode',
            'link' => "/podcasts/subscriber-updates/new-subscriber-episode",
        ]);
        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $subscriber->id)
            ->where('type', 'podcast_episode')
            ->where('link', '/podcasts/subscriber-updates/new-subscriber-episode')
            ->count());
    }

    public function test_listen_analytics_include_unique_listeners_and_client_breakdown(): void
    {
        $this->enablePodcasts(true);
        $admin = $this->actingAsAdmin();
        $member = $this->actingAsMember();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Breakdown Show',
            'visibility' => 'public',
        ]);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);
        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Breakdown Episode',
            'audio_url' => 'https://cdn.example.test/breakdown.mp3',
            'visibility' => 'public',
            'duration_seconds' => 100,
        ]);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        Sanctum::actingAs($member, ['*']);
        $this->withHeader('User-Agent', 'AppleCoreMedia/1.0')->apiPost("/v2/podcasts/episodes/{$episodeId}/listen", [
            'listened_seconds' => 20,
            'session_id' => 'same-user-a',
        ])->assertStatus(200);
        $this->withHeader('User-Agent', 'Spotify/9.0')->apiPost("/v2/podcasts/episodes/{$episodeId}/listen", [
            'listened_seconds' => 80,
            'session_id' => 'same-user-b',
            'completed' => true,
        ])->assertStatus(200);

        Sanctum::actingAs($admin, ['*']);
        $adminIndex = $this->apiGet('/v2/admin/podcasts');
        $adminIndex->assertStatus(200);
        $adminIndex->assertJsonPath('data.stats.unique_listeners', 1);
        $adminIndex->assertJsonPath('data.client_breakdown.0.client', 'apple');
        $adminIndex->assertJsonPath('data.retention.0.bucket', '75-100');
    }

    public function test_admin_can_validate_public_podcast_feed(): void
    {
        $this->enablePodcasts(true);
        $admin = $this->actingAsAdmin();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Validated Feed',
            'summary' => 'A directory ready show.',
            'visibility' => 'public',
            'owner_email' => 'owner@example.test',
        ]);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);
        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Valid Episode',
            'audio_url' => 'https://cdn.example.test/valid.mp3',
            'audio_mime' => 'audio/mpeg',
            'audio_bytes' => 123456,
            'visibility' => 'public',
        ]);
        $episodeId = $episode->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        Sanctum::actingAs($admin, ['*']);
        $validation = $this->apiGet("/v2/admin/podcasts/shows/{$showId}/validate-feed");
        $validation->assertStatus(200);
        $validation->assertJsonPath('data.valid', true);
        $validation->assertJsonPath('data.errors', []);
    }

    public function test_feed_validation_warns_when_directory_artwork_is_missing(): void
    {
        $this->enablePodcasts(true);
        $admin = $this->actingAsAdmin();

        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Artwork Warning Feed',
            'summary' => 'A feed with no artwork.',
            'visibility' => 'public',
            'owner_email' => 'owner@example.test',
        ]);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        Sanctum::actingAs($admin, ['*']);
        $validation = $this->apiGet("/v2/admin/podcasts/shows/{$showId}/validate-feed");
        $validation->assertStatus(200);
        $this->assertContains('missing_artwork', $validation->json('data.warnings'));
    }

    public function test_admin_storage_verify_round_trips_probe_on_faked_disk(): void
    {
        Storage::fake('s3');
        $this->enablePodcasts(true);
        $this->actingAsAdmin();

        $response = $this->apiPost('/v2/admin/podcasts/storage/verify', ['disk' => 's3']);
        $response->assertStatus(200);
        $response->assertJsonPath('data.ok', true);
        $response->assertJsonPath('data.disk', 's3');
        $response->assertJsonPath('data.checks.write', true);
        $response->assertJsonPath('data.checks.read', true);
        $response->assertJsonPath('data.checks.delete', true);

        // The probe object must not be left behind.
        $this->assertSame([], Storage::disk('s3')->allFiles('podcasts/.doctor'));
    }

    public function test_admin_storage_verify_defaults_to_configured_cloud_disk(): void
    {
        Storage::fake('s3');
        $this->enablePodcasts(true);
        $this->actingAsAdmin();

        $response = $this->apiPost('/v2/admin/podcasts/storage/verify');
        $response->assertStatus(200);
        $response->assertJsonPath('data.disk', 's3');
    }

    public function test_admin_storage_verify_reports_unknown_disk_as_structured_failure(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsAdmin();

        $response = $this->apiPost('/v2/admin/podcasts/storage/verify', ['disk' => 'does-not-exist']);
        $response->assertStatus(200);
        $response->assertJsonPath('data.ok', false);
        $response->assertJsonPath('data.checks.configured', false);
        $response->assertJsonPath('data.error', 'disk_not_configured');
    }

    public function test_storage_verify_is_admin_only(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $this->apiPost('/v2/admin/podcasts/storage/verify', ['disk' => 's3'])->assertStatus(403);
    }

    public function test_update_podcast_config_rejects_unknown_cloud_disk(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsAdmin();

        $response = $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => ['podcasts.cloud_storage_disk' => 'not-a-disk'],
        ]);
        $response->assertStatus(422);

        // Nothing may have been persisted by the rejected payload.
        $config = $this->apiGet('/v2/admin/config/podcasts');
        $this->assertSame('s3', $config->json('data.config')['podcasts.cloud_storage_disk']);
    }

    public function test_update_podcast_config_rejects_invalid_storage_driver(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsAdmin();

        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => ['podcasts.media_storage_driver' => 'ftp'],
        ])->assertStatus(422);
    }

    public function test_update_podcast_config_rejects_invalid_cdn_url(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsAdmin();

        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => ['podcasts.cloud_cdn_base_url' => 'ftp://cdn.example.test'],
        ])->assertStatus(422);
    }

    public function test_update_podcast_config_accepts_clearing_cdn_url(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsAdmin();

        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => ['podcasts.cloud_cdn_base_url' => ''],
        ])->assertStatus(200);
    }

    public function test_media_and_feed_routes_are_rate_limited(): void
    {
        $middleware = [];
        foreach (\Illuminate\Support\Facades\Route::getRoutes() as $route) {
            if (str_starts_with($route->uri(), 'api/v2/podcasts/')) {
                $middleware[$route->uri()] = $route->gatherMiddleware();
            }
        }

        $this->assertContains('throttle:podcast-media', $middleware['api/v2/podcasts/media/{tenantId}/{episodeId}/audio'] ?? []);
        $this->assertContains('throttle:nexus-route-60-per-1m', $middleware['api/v2/podcasts/transcripts/{tenantId}/{episodeId}.txt'] ?? []);
        $this->assertContains('throttle:nexus-route-60-per-1m', $middleware['api/v2/podcasts/chapters/{tenantId}/{episodeId}.json'] ?? []);
        $this->assertContains('throttle:nexus-route-30-per-1m', $middleware['api/v2/podcasts/feed/{tenantId}/{showSlug}.xml'] ?? []);
        $this->assertContains('throttle:nexus-route-30-per-1m', $middleware['api/v2/podcasts/{showSlug}/feed.xml'] ?? []);
        foreach ([
            'api/v2/podcasts/media/{tenantId}/{episodeId}/audio',
            'api/v2/podcasts/transcripts/{tenantId}/{episodeId}.txt',
            'api/v2/podcasts/chapters/{tenantId}/{episodeId}.json',
            'api/v2/podcasts/feed/{tenantId}/{showSlug}.xml',
            'api/v2/podcasts/{showSlug}/feed.xml',
        ] as $publicDistributionRoute) {
            $this->assertNotContains('auth:sanctum', $middleware[$publicDistributionRoute] ?? []);
        }
    }

    public function test_store_episode_rejects_more_than_200_chapters(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Chapter Cap Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $chapters = [];
        for ($i = 0; $i <= 200; $i++) {
            $chapters[] = ['title' => 'Chapter ' . $i, 'starts_at_seconds' => $i * 10];
        }

        $response = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Overchaptered Episode',
            'audio_url' => 'https://cdn.example.test/audio.mp3',
            'chapters' => $chapters,
        ]);
        $response->assertStatus(422);
    }

    public function test_chapters_are_sorted_and_reindexed_by_start_time(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Chapter Order Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $episodeId = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Out of Order Chapters',
            'audio_url' => 'https://cdn.example.test/audio.mp3',
            'chapters' => [
                ['title' => 'Late Chapter', 'starts_at_seconds' => 120],
                ['title' => 'Early Chapter', 'starts_at_seconds' => 5],
                ['title' => 'Middle Chapter', 'starts_at_seconds' => 60],
            ],
        ])->assertStatus(201)->json('data.id');

        $rows = DB::table('podcast_episode_chapters')
            ->where('episode_id', $episodeId)
            ->orderBy('position')
            ->get(['title', 'starts_at_seconds', 'position']);

        $this->assertSame(['Early Chapter', 'Middle Chapter', 'Late Chapter'], $rows->pluck('title')->all());
        $this->assertSame([5, 60, 120], $rows->pluck('starts_at_seconds')->map(fn ($s) => (int) $s)->all());
        $this->assertSame([0, 1, 2], $rows->pluck('position')->map(fn ($p) => (int) $p)->all());
    }

    public function test_disabling_chapters_hides_but_does_not_delete_existing_chapters(): void
    {
        $this->enablePodcasts(true);
        $member = $this->actingAsMember();
        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Preserved Chapters Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $episodeId = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Chaptered Episode',
            'audio_url' => 'https://cdn.example.test/chaptered.mp3',
            'chapters' => [['title' => 'Opening', 'starts_at_seconds' => 0]],
        ])->assertStatus(201)->json('data.id');

        $this->actingAsAdmin();
        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => ['podcasts.enable_chapters' => false],
        ])->assertStatus(200);

        Sanctum::actingAs($member, ['*']);
        $this->apiPut("/v2/podcasts/{$showId}/episodes/{$episodeId}", [
            'title' => 'Edited While Chapters Hidden',
        ])->assertStatus(200)
            ->assertJsonPath('data.chapters_enabled', false);

        $this->assertSame(1, (int) DB::table('podcast_episode_chapters')
            ->where('tenant_id', $this->testTenantId)
            ->where('episode_id', $episodeId)
            ->count());
    }

    public function test_private_show_creation_rejected_when_private_shows_disabled(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsAdmin();
        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => ['podcasts.enable_private_shows' => false],
        ])->assertStatus(200);

        $this->actingAsMember();
        $response = $this->apiPost('/v2/podcasts', [
            'title' => 'Secret Show',
            'visibility' => 'private',
        ]);
        $response->assertStatus(422);

        // Explicit public visibility is still fine.
        $this->apiPost('/v2/podcasts', [
            'title' => 'Open Show',
            'visibility' => 'public',
        ])->assertStatus(201);
    }

    public function test_private_episode_visibility_rejected_when_private_shows_disabled(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Episode Visibility Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $this->actingAsAdmin();
        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => ['podcasts.enable_private_shows' => false],
        ])->assertStatus(200);

        $this->actingAsMember();
        // New member context is not the show owner; recreate as this member.
        $ownShowId = $this->apiPost('/v2/podcasts', [
            'title' => 'My Own Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $this->apiPost("/v2/podcasts/{$ownShowId}/episodes", [
            'title' => 'Members Only Episode',
            'audio_url' => 'https://cdn.example.test/audio.mp3',
            'visibility' => 'members',
        ])->assertStatus(422);

        // Default (inherit) visibility still works with the flag off.
        $this->apiPost("/v2/podcasts/{$ownShowId}/episodes", [
            'title' => 'Inherit Episode',
            'audio_url' => 'https://cdn.example.test/audio.mp3',
        ])->assertStatus(201);

        $this->assertGreaterThan(0, $showId);
    }

    public function test_owner_can_validate_own_feed_and_sees_skipped_count(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Owner Feed Check',
            'summary' => 'Validating my own feed.',
            'visibility' => 'public',
            'owner_email' => 'owner@example.test',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episodeId = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Feedworthy Episode',
            'audio_url' => 'https://cdn.example.test/audio.mp3',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $validation = $this->apiGet("/v2/podcasts/{$showId}/validate-feed");
        $validation->assertStatus(200);
        $validation->assertJsonPath('data.valid', true);
        $validation->assertJsonPath('data.skipped_episode_count', 0);

        // Break one episode's audio URL the way legacy rows can be broken —
        // validation must surface it as an error AND a skipped-count.
        DB::table('podcast_episodes')->where('id', $episodeId)->update([
            'audio_url' => 'podcast-hosted://pending',
            'audio_storage_path' => null,
        ]);

        $broken = $this->apiGet("/v2/podcasts/{$showId}/validate-feed");
        $broken->assertStatus(200);
        $broken->assertJsonPath('data.valid', false);
        $broken->assertJsonPath('data.skipped_episode_count', 1);
    }

    public function test_non_owner_cannot_validate_feed(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Someone Elses Feed',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        // A different (non-admin) member must be refused.
        $this->actingAsMember();
        $this->apiGet("/v2/podcasts/{$showId}/validate-feed")->assertStatus(403);
    }

    public function test_owner_stats_return_totals_and_series(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Stats Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episodeId = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Stats Episode',
            'audio_url' => 'https://cdn.example.test/audio.mp3',
            'duration_seconds' => 600,
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/listen", [
            'listened_seconds' => 300,
            'session_id' => 'stats-session-1',
        ])->assertStatus(200);

        $stats = $this->apiGet("/v2/podcasts/{$showId}/stats?days=7");
        $stats->assertStatus(200);
        $stats->assertJsonPath('data.enabled', true);
        $stats->assertJsonPath('data.days', 7);
        $stats->assertJsonPath('data.totals.listens', 1);
        $this->assertNotEmpty($stats->json('data.listens_over_time'));
        $this->assertSame(1, $stats->json('data.listens_over_time.0.listens'));
        $this->assertNotEmpty($stats->json('data.top_episodes'));
    }

    public function test_owner_stats_hidden_when_analytics_disabled(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsAdmin();
        $this->apiPut('/v2/admin/config/podcasts/bulk', [
            'settings' => ['podcasts.enable_listen_analytics' => false],
        ])->assertStatus(200);

        $this->actingAsMember();
        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'No Analytics Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $stats = $this->apiGet("/v2/podcasts/{$showId}/stats");
        $stats->assertStatus(200);
        $stats->assertJsonPath('data.enabled', false);
        $this->assertNull($stats->json('data.totals'));
    }

    public function test_stats_are_owner_or_admin_only(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Private Stats Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $this->actingAsMember();
        $this->apiGet("/v2/podcasts/{$showId}/stats")->assertStatus(403);
    }

    public function test_authored_response_includes_upload_constraints_meta(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $response = $this->apiGet('/v2/podcasts/mine');
        $response->assertStatus(200);
        $this->assertSame(250, $response->json('meta.max_audio_size_mb'));
        $this->assertContains('audio/mpeg', $response->json('meta.allowed_audio_mimes'));
    }

    public function test_admin_index_supports_independent_pagination(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();
        foreach (['Page Show One', 'Page Show Two', 'Page Show Three'] as $title) {
            $this->apiPost('/v2/podcasts', ['title' => $title, 'visibility' => 'public'])->assertStatus(201);
        }

        $this->actingAsAdmin();
        $response = $this->apiGet('/v2/admin/podcasts?per_page=2&shows_page=2');
        $response->assertStatus(200);

        $this->assertSame(3, $response->json('meta.shows_total'));
        $this->assertSame(2, $response->json('meta.shows_page'));
        $this->assertSame(2, $response->json('meta.per_page'));
        $this->assertCount(1, $response->json('data.shows'));

        // Default request keeps the historical shape (all rows, page 1).
        $default = $this->apiGet('/v2/admin/podcasts');
        $default->assertStatus(200);
        $this->assertCount(3, $default->json('data.shows'));
        $this->assertIsArray($default->json('data.stats'));
        $this->assertIsArray($default->json('data.top_episodes'));
    }

    public function test_admin_index_search_filters_shows_and_episodes_on_the_server(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $matchingShowId = $this->apiPost('/v2/podcasts', [
            'title' => 'Needle Community Audio',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $otherShowId = $this->apiPost('/v2/podcasts', [
            'title' => 'Unrelated Community Audio',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $this->apiPost("/v2/podcasts/{$matchingShowId}/episodes", [
            'title' => 'Episode found through its show',
            'audio_url' => 'https://cdn.example.test/needle.mp3',
        ])->assertStatus(201);
        $this->apiPost("/v2/podcasts/{$otherShowId}/episodes", [
            'title' => 'Unrelated episode',
            'audio_url' => 'https://cdn.example.test/other.mp3',
        ])->assertStatus(201);

        $this->actingAsAdmin();
        $response = $this->apiGet('/v2/admin/podcasts?q=Needle');
        $response->assertStatus(200);
        $response->assertJsonPath('meta.shows_total', 1);
        $response->assertJsonPath('meta.episodes_total', 1);
        $response->assertJsonPath('data.shows.0.id', $matchingShowId);
        $response->assertJsonPath('data.episodes.0.show_id', $matchingShowId);
    }

    public function test_admin_rss_readiness_counts_only_feed_eligible_shows(): void
    {
        $this->enablePodcasts(true);
        $this->actingAsMember();
        $emptyShowId = $this->apiPost('/v2/podcasts', [
            'title' => 'No Eligible Episodes',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$emptyShowId}/publish")->assertStatus(200);

        $readyShowId = $this->apiPost('/v2/podcasts', [
            'title' => 'Ready Feed',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$readyShowId}/publish")->assertStatus(200);
        $episodeId = $this->apiPost("/v2/podcasts/{$readyShowId}/episodes", [
            'title' => 'Feed Eligible',
            'audio_url' => 'https://cdn.example.test/eligible.mp3',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $this->apiPost("/v2/podcasts/{$readyShowId}/episodes/{$episodeId}/publish")->assertStatus(200);

        $this->actingAsAdmin();
        $this->apiGet('/v2/admin/podcasts')
            ->assertStatus(200)
            ->assertJsonPath('data.stats.published_shows', 2)
            ->assertJsonPath('data.stats.rss_ready_shows', 1);
    }

    public function test_unready_hosted_media_statuses_cannot_be_published_or_streamed(): void
    {
        Storage::fake('local');
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Pending Safety Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');
        $episode = $this->post("/api/v2/podcasts/{$showId}/episodes", [
            'title' => 'Still Processing',
            'audio' => UploadedFile::fake()->createWithContent('pending.wav', self::tinyWavBytes()),
        ], $this->withTenantHeader())->assertStatus(201);

        $audioUrl = (string) $episode->json('data.audio_url');
        $signedPath = parse_url($audioUrl, PHP_URL_PATH) . '?' . parse_url($audioUrl, PHP_URL_QUERY);
        $episodeId = (int) $episode->json('data.id');
        foreach ([
            ['pending', 'not_required', null],
            ['complete', 'scan_unavailable', null],
            ['failed', 'not_required', 'not_audio'],
            ['failed', 'clean', 'processing_error'],
        ] as [$processing, $scan, $reason]) {
            DB::table('podcast_episodes')->where('id', $episodeId)->update([
                'media_processing_status' => $processing,
                'media_scan_status' => $scan,
                'media_failure_reason' => $reason,
            ]);
            $this->get($signedPath, $this->withTenantHeader())->assertStatus(404);
            $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")
                ->assertStatus(409)
                ->assertJsonPath('errors.0.code', 'MEDIA_NOT_READY');
        }
    }

    public function test_unready_hosted_episode_is_hidden_from_members_listen_transcript_and_chapters(): void
    {
        Storage::fake('local');
        $this->enablePodcasts(true);
        $this->actingAsMember();
        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Fail Closed Projection',
            'visibility' => 'public',
        ])->assertStatus(201);
        $showId = (int) $show->json('data.id');
        $showSlug = (string) $show->json('data.slug');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);
        $episode = $this->post("/api/v2/podcasts/{$showId}/episodes", [
            'title' => 'Unsafe Legacy Episode',
            'audio' => UploadedFile::fake()->createWithContent('unsafe.wav', self::tinyWavBytes()),
            'transcript' => 'This must remain hidden.',
            'chapters' => json_encode([['title' => 'Hidden chapter', 'starts_at_seconds' => 0]]),
        ], $this->withTenantHeader())->assertStatus(201);
        $episodeId = (int) $episode->json('data.id');
        $episodeSlug = (string) $episode->json('data.slug');
        DB::table('podcast_episodes')->where('id', $episodeId)->update([
            'status' => 'published',
            'moderation_status' => 'approved',
            'published_at' => now(),
            'media_processing_status' => 'complete',
            'media_scan_status' => 'scan_unavailable',
        ]);

        $this->actingAsMember();
        $this->apiGet("/v2/podcasts/{$showSlug}")
            ->assertStatus(200)
            ->assertJsonCount(0, 'data.episodes');
        $this->apiGet("/v2/podcasts/{$showSlug}/{$episodeSlug}")->assertStatus(404);
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/listen", ['listened_seconds' => 10])
            ->assertStatus(404);

        $this->app['auth']->forgetGuards();
        $this->get("/api/v2/podcasts/transcripts/{$this->testTenantId}/{$episodeId}.txt", $this->withTenantHeader())
            ->assertStatus(404);
        $this->get("/api/v2/podcasts/chapters/{$this->testTenantId}/{$episodeId}.json", $this->withTenantHeader())
            ->assertStatus(404);
    }

    public function test_infected_media_is_never_served(): void
    {
        Storage::fake('local');
        $this->enablePodcasts(true);
        $this->actingAsMember();

        $showId = $this->apiPost('/v2/podcasts', [
            'title' => 'Quarantine Show',
            'visibility' => 'public',
        ])->assertStatus(201)->json('data.id');

        $episode = $this->post("/api/v2/podcasts/{$showId}/episodes", [
            'title' => 'Quarantined Audio',
            'audio' => UploadedFile::fake()->createWithContent('quarantine.wav', self::tinyWavBytes()),
        ], $this->withTenantHeader());
        $episode->assertStatus(201);
        $episodeId = $episode->json('data.id');
        DB::table('podcast_episodes')->where('id', $episodeId)->update([
            'media_processing_status' => 'complete',
            'media_scan_status' => 'not_required',
        ]);
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);

        // Media is streamable before quarantine…
        $this->get("/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio", $this->withTenantHeader())
            ->assertStatus(200);

        // …and refused outright once flagged infected, even though the file exists.
        DB::table('podcast_episodes')->where('id', $episodeId)->update(['media_scan_status' => 'infected']);

        $this->get("/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio", $this->withTenantHeader())
            ->assertStatus(404);
    }
}
