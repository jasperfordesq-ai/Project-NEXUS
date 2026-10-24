<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The accessible frontend (web-uk) routes podcasts by numeric id —
 * /podcasts/{showId} and /podcasts/{showId}/episodes/{episodeId} — and asks
 * GET /api/v2/podcasts/{showId}[/{episodeId}]. Those API routes looked up by
 * slug only, so every accessible podcast page answered "Page not found".
 */
class PodcastLookupByIdTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        foreach (['HTTP_X_TENANT_ID', 'HTTP_X_TENANT_SLUG', 'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $serverKey) {
            unset($_SERVER[$serverKey]);
        }
        \Illuminate\Support\Facades\Cache::flush();
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['podcasts' => true])]);
        TenantContext::reset();
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

    /** @return array{0:int,1:string,2:int,3:int} show id, show slug, public episode id, private episode id */
    private function publishedShowWithEpisodes(): array
    {
        $this->actingAsMember();
        $show = $this->apiPost('/v2/podcasts', [
            'title' => 'Lookup By Id Show',
            'summary' => 'Reached by number from the accessible site.',
            'visibility' => 'public',
        ])->assertStatus(201);
        $showId = (int) $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $ids = [];
        foreach (['public', 'private'] as $visibility) {
            $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
                'title' => ucfirst($visibility) . ' Episode',
                'audio_url' => "https://cdn.example.test/{$visibility}.mp3",
                'audio_bytes' => 1234,
                'visibility' => $visibility,
            ])->assertStatus(201);
            $episodeId = (int) $episode->json('data.id');
            $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertStatus(200);
            $ids[] = $episodeId;
        }

        // Read as a different member, as on the live site.
        $this->actingAsMember();
        TenantContext::setById($this->testTenantId);

        return [$showId, (string) $show->json('data.slug'), $ids[0], $ids[1]];
    }

    public function test_show_can_be_read_by_numeric_id(): void
    {
        [$showId, $showSlug] = $this->publishedShowWithEpisodes();

        $this->apiGet("/v2/podcasts/{$showId}")
            ->assertStatus(200)
            ->assertJsonPath('data.id', $showId)
            ->assertJsonPath('data.slug', $showSlug)
            ->assertJsonPath('data.episode_count', 1);

        // The slug route the website uses is unchanged.
        $this->apiGet("/v2/podcasts/{$showSlug}")->assertStatus(200)->assertJsonPath('data.id', $showId);
    }

    public function test_episode_can_be_read_by_numeric_ids(): void
    {
        [$showId, , $publicEpisodeId] = $this->publishedShowWithEpisodes();

        $this->apiGet("/v2/podcasts/{$showId}/{$publicEpisodeId}")
            ->assertStatus(200)
            ->assertJsonPath('data.id', $publicEpisodeId)
            ->assertJsonPath('data.title', 'Public Episode');
    }

    public function test_numeric_lookup_keeps_visibility_rules(): void
    {
        [$showId, , , $privateEpisodeId] = $this->publishedShowWithEpisodes();

        $this->apiGet("/v2/podcasts/{$showId}/{$privateEpisodeId}")->assertStatus(404);
    }

    public function test_numeric_lookup_does_not_reach_another_communitys_show(): void
    {
        [$showId] = $this->publishedShowWithEpisodes();

        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Podcast Lookup Other',
            'slug' => 'podcast-lookup-other-' . uniqid(),
            'is_active' => 1,
            'features' => json_encode(['podcasts' => true]),
            'created_at' => now(),
        ]);
        $other = User::factory()->forTenant($otherTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($other, ['*']);
        TenantContext::setById($otherTenantId);

        $this->getJson("/api/v2/podcasts/{$showId}", ['X-Tenant-ID' => (string) $otherTenantId])
            ->assertStatus(404);
    }
}
