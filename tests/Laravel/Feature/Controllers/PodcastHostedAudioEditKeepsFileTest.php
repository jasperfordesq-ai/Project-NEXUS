<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Jobs\ProcessPodcastEpisodeMedia;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Editing an uploaded ("hosted") episode must not delete its audio.
 *
 * /v2/podcasts/mine hands hosted episodes back with audio_url set to the
 * platform's own media address. The accessible frontend's edit form echoed that
 * address back as `audio_url`, and the API treated any audio_url as a replacement
 * link: it cleared the stored file and deleted it, leaving the episode pointing
 * at its own now-empty media route.
 */
class PodcastHostedAudioEditKeepsFileTest extends TestCase
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

    /** @return array{0:int,1:int,2:string} show id, episode id, stored path */
    private function hostedEpisode(): array
    {
        Storage::fake('local');
        Queue::fake([ProcessPodcastEpisodeMedia::class]);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($owner, ['*']);

        $showId = (int) $this->apiPost('/v2/podcasts', ['title' => 'Hosted Edit Show', 'visibility' => 'public'])
            ->assertStatus(201)->json('data.id');
        $episodeId = (int) $this->post('/api/v2/podcasts/' . $showId . '/episodes', [
            'title' => 'Hosted Edit Episode',
            'audio' => UploadedFile::fake()->create('episode.mp3', 128, 'audio/mpeg'),
        ], $this->withTenantHeader())->assertStatus(201)->json('data.id');

        DB::table('podcast_episodes')->where('id', $episodeId)->update([
            'media_processing_status' => 'complete',
            'media_scan_status' => 'not_required',
        ]);
        $path = (string) DB::table('podcast_episodes')->where('id', $episodeId)->value('audio_storage_path');
        Storage::disk('local')->assertExists($path);

        return [$showId, $episodeId, $path];
    }

    public function test_echoing_the_platforms_own_audio_address_keeps_the_upload(): void
    {
        [$showId, $episodeId, $path] = $this->hostedEpisode();

        $mine = $this->apiGet('/v2/podcasts/mine')->assertStatus(200);
        $served = (string) collect($mine->json('data.0.episodes'))->firstWhere('id', $episodeId)['audio_url'];
        $this->assertStringContainsString("/api/v2/podcasts/media/{$this->testTenantId}/{$episodeId}/audio", $served);

        $this->apiPut("/v2/podcasts/{$showId}/episodes/{$episodeId}", [
            'title' => 'Renamed Episode',
            'audio_url' => $served,
        ])->assertStatus(200)->assertJsonPath('data.title', 'Renamed Episode');

        $row = DB::table('podcast_episodes')->where('id', $episodeId)->first();
        $this->assertSame($path, $row->audio_storage_path, 'The stored upload must still be attached.');
        Storage::disk('local')->assertExists($path);
    }

    public function test_a_genuinely_new_link_still_replaces_the_upload(): void
    {
        [$showId, $episodeId, $path] = $this->hostedEpisode();

        $this->apiPut("/v2/podcasts/{$showId}/episodes/{$episodeId}", [
            'audio_url' => 'https://cdn.example.test/replacement.mp3',
        ])->assertStatus(200);

        $row = DB::table('podcast_episodes')->where('id', $episodeId)->first();
        $this->assertNull($row->audio_storage_path);
        $this->assertSame('https://cdn.example.test/replacement.mp3', $row->audio_url);
    }
}
