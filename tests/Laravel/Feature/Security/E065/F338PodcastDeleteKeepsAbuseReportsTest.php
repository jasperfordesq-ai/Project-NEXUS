<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-065 F-338 — a podcast show owner must not be able to destroy the abuse
 * reports filed about their own episode, nor reset the auto-hide counter by
 * deleting a reported episode and re-uploading the same audio.
 *
 * Before the fix, PodcastService::deleteEpisodeRecords() deleted every
 * podcast_episode_reports row for the episode — open reports AND resolved ones
 * carrying the admin's reviewed_by / reviewed_at — from both member-reachable
 * routes (DELETE /v2/podcasts/{showId}/episodes/{episodeId} and
 * DELETE /v2/podcasts/{id}), with no activity_log entry. Because
 * maybeFlagEpisodeFromReports() auto-hides an episode on a distinct-reporter
 * count, the creator could delete a reported episode, re-upload the same audio
 * and start the count again at zero.
 *
 * The fix has two halves and this file pins both:
 *   1. Report rows are never deleted with the episode.
 *   2. A creator cannot hard-delete content with an OPEN complaint against it
 *      (they may archive it instead), so the counter cannot be reset.
 */
class F338PodcastDeleteKeepsAbuseReportsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $this->app['auth']->forgetGuards();
        foreach (['HTTP_X_TENANT_ID', 'HTTP_X_TENANT_SLUG', 'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $serverKey) {
            unset($_SERVER[$serverKey]);
        }
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['podcasts' => true])]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_show_owner_cannot_delete_an_episode_with_an_open_complaint(): void
    {
        $tenantId = $this->testTenantId;
        $owner = $this->member();
        $reporter = $this->member();

        $showId = $this->show($tenantId, (int) $owner->id);
        $episodeId = $this->episode($tenantId, $showId, (int) $owner->id);
        $reportId = $this->report($tenantId, $episodeId, (int) $reporter->id, ['status' => 'open']);

        Sanctum::actingAs($owner, ['*']);
        $response = $this->apiDelete("/v2/podcasts/{$showId}/episodes/{$episodeId}");

        $this->assertSame(
            409,
            $response->status(),
            'F-338: an episode with an open complaint must not be hard-deleted by its own creator'
        );
        $this->assertTrue(
            DB::table('podcast_episodes')->where('id', $episodeId)->exists(),
            'F-338: the reported episode must survive'
        );
        $this->assertTrue(
            DB::table('podcast_episode_reports')->where('id', $reportId)->where('status', 'open')->exists(),
            'F-338: the open complaint must survive'
        );
    }

    public function test_show_owner_cannot_delete_the_whole_show_while_an_episode_has_an_open_complaint(): void
    {
        $tenantId = $this->testTenantId;
        $owner = $this->member();
        $reporter = $this->member();

        $showId = $this->show($tenantId, (int) $owner->id);
        $episodeId = $this->episode($tenantId, $showId, (int) $owner->id);
        $reportId = $this->report($tenantId, $episodeId, (int) $reporter->id, ['status' => 'open']);

        Sanctum::actingAs($owner, ['*']);
        $response = $this->apiDelete("/v2/podcasts/{$showId}");

        $this->assertSame(
            409,
            $response->status(),
            'F-338: deleting the whole show must not be a way round the open-complaint guard'
        );
        $this->assertTrue(DB::table('podcast_shows')->where('id', $showId)->exists(), 'the show survives');
        $this->assertTrue(DB::table('podcast_episodes')->where('id', $episodeId)->exists(), 'the episode survives');
        $this->assertTrue(
            DB::table('podcast_episode_reports')->where('id', $reportId)->exists(),
            'F-338: the complaint survives'
        );
    }

    public function test_a_triaged_episode_may_still_be_deleted_but_the_moderator_decision_survives(): void
    {
        $tenantId = $this->testTenantId;
        $owner = $this->member();
        $reporter = $this->member();
        $moderator = $this->member();

        $showId = $this->show($tenantId, (int) $owner->id);
        $episodeId = $this->episode($tenantId, $showId, (int) $owner->id);
        $resolvedReportId = $this->report($tenantId, $episodeId, (int) $reporter->id, [
            'status' => 'resolved',
            'reviewed_by' => (int) $moderator->id,
            'reviewed_at' => now(),
        ]);

        Sanctum::actingAs($owner, ['*']);
        $this->apiDelete("/v2/podcasts/{$showId}/episodes/{$episodeId}")->assertStatus(200);

        $this->assertFalse(
            DB::table('podcast_episodes')->where('id', $episodeId)->exists(),
            'a fully triaged episode can still be removed'
        );

        $row = DB::table('podcast_episode_reports')->where('id', $resolvedReportId)->first();
        $this->assertNotNull($row, 'F-338: the resolved complaint must survive the deletion');
        $this->assertSame(
            (int) $moderator->id,
            (int) $row->reviewed_by,
            "F-338: the moderator's decision on the complaint must survive intact"
        );
    }

    public function test_deleting_a_reported_episode_is_recorded_and_names_the_actor(): void
    {
        $tenantId = $this->testTenantId;
        $owner = $this->member();
        $reporter = $this->member();

        $showId = $this->show($tenantId, (int) $owner->id);
        $episodeId = $this->episode($tenantId, $showId, (int) $owner->id);
        $this->report($tenantId, $episodeId, (int) $reporter->id, [
            'status' => 'dismissed',
            'reviewed_by' => (int) $reporter->id,
            'reviewed_at' => now(),
        ]);

        Sanctum::actingAs($owner, ['*']);
        $this->apiDelete("/v2/podcasts/{$showId}/episodes/{$episodeId}")->assertStatus(200);

        $row = DB::table('activity_log')
            ->where('tenant_id', $tenantId)
            ->where('entity_type', 'podcast_episode')
            ->where('entity_id', $episodeId)
            ->first();

        $this->assertNotNull($row, 'F-338: deleting a reported episode must be recorded');
        $this->assertSame(
            (int) $owner->id,
            (int) $row->user_id,
            'F-338: the record must name the member who deleted it'
        );
    }

    public function test_control_a_member_who_is_not_the_show_owner_is_still_refused(): void
    {
        $tenantId = $this->testTenantId;
        $owner = $this->member();
        $reporter = $this->member();
        $outsider = $this->member();

        $showId = $this->show($tenantId, (int) $owner->id);
        $episodeId = $this->episode($tenantId, $showId, (int) $owner->id);
        $reportId = $this->report($tenantId, $episodeId, (int) $reporter->id, ['status' => 'open']);

        Sanctum::actingAs($outsider, ['*']);
        $this->apiDelete("/v2/podcasts/{$showId}/episodes/{$episodeId}")->assertStatus(403);

        $this->assertTrue(DB::table('podcast_episode_reports')->where('id', $reportId)->exists());
        $this->assertTrue(DB::table('podcast_episodes')->where('id', $episodeId)->exists());
    }

    public function test_control_an_unreported_episode_deletes_exactly_as_before(): void
    {
        $tenantId = $this->testTenantId;
        $owner = $this->member();

        $showId = $this->show($tenantId, (int) $owner->id);
        $episodeId = $this->episode($tenantId, $showId, (int) $owner->id);

        Sanctum::actingAs($owner, ['*']);
        $this->apiDelete("/v2/podcasts/{$showId}/episodes/{$episodeId}")->assertStatus(200);

        $this->assertFalse(DB::table('podcast_episodes')->where('id', $episodeId)->exists());
    }

    // ---------------------------------------------------------------- helpers

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    /** @param array<string,mixed> $overrides */
    private function show(int $tenantId, int $ownerId, array $overrides = []): int
    {
        return (int) DB::table('podcast_shows')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'owner_user_id' => $ownerId,
            'title' => 'E065 F-338 show',
            'slug' => 'e066e-f338-show-' . uniqid(),
            'visibility' => 'public',
            'status' => 'published',
            'moderation_status' => 'approved',
            'episode_count' => 1,
            'subscriber_count' => 0,
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    /** @param array<string,mixed> $overrides */
    private function episode(int $tenantId, int $showId, int $authorId, array $overrides = []): int
    {
        return (int) DB::table('podcast_episodes')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'show_id' => $showId,
            'author_user_id' => $authorId,
            'title' => 'E065 F-338 episode',
            'slug' => 'e066e-f338-episode-' . uniqid(),
            'audio_url' => 'https://media.example.test/' . uniqid() . '.mp3',
            'media_processing_status' => 'complete',
            'media_scan_status' => 'clean',
            'visibility' => 'public',
            'status' => 'published',
            'moderation_status' => 'approved',
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    /** @param array<string,mixed> $overrides */
    private function report(int $tenantId, int $episodeId, int $reporterId, array $overrides = []): int
    {
        return (int) DB::table('podcast_episode_reports')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'episode_id' => $episodeId,
            'reporter_user_id' => $reporterId,
            'reason' => 'harassment',
            'details' => 'E065 F-338 synthetic complaint.',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }
}
