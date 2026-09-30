<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-067 slice B — working variant of the F-338 fix (commit e140e8c32), in the
 * erasure routine F-339 (commit 85dff28d7) just re-reviewed.
 *
 * F-338: a podcast creator could destroy the complaints other members filed
 * about their own episode. The fix keeps podcast_episode_reports and refuses a
 * creator's hard delete while a report is open.
 *
 * F-339 (owner decision, 30 Sep 2026): self-erasure must not take other
 * members' safeguarding/moderation records with it (vetting decisions, blocks
 * placed on the erased member).
 *
 * GdprService::executeAccountDeletion() (app/Services/Enterprise/GdprService.php
 * ~2121-2126 at HEAD 8752f4191) still runs
 *   DELETE FROM podcast_episode_reports WHERE tenant_id = ? AND episode_id IN (...)
 * for every episode the erased member authored or owns — open AND resolved
 * complaints filed by OTHER members. DELETE /api/v2/users/me runs that routine
 * immediately on the member's own password. The creator therefore destroys
 * every complaint about their content with one self-service call, and because
 * erasure frees the email address they can re-register and re-upload with the
 * distinct-reporter auto-hide counter back at zero — exactly the loop F-338
 * closed on the delete route.
 *
 * F-383 fix: the erasure routine no longer deletes podcast_episode_reports. The
 * episodes themselves are still erased; the complaint rows survive (the table
 * has no foreign key to podcast_episodes, and the staff queue reaches them
 * through a LEFT JOIN — the same arrangement the F-338 fix relies on).
 *
 * Adapted from `.local-docs-archive/security-log/E-067/repro/b/SelfErasureDestroysPodcastComplaintsTest.php`,
 * which asserted the bad outcome; the attack assertions are inverted.
 *
 * Control (same owner, same episode, same open report — only the route differs):
 * the per-episode DELETE is refused 409 and the complaint survives.
 */
final class F383ErasureKeepsPodcastComplaintsTest extends TestCase
{
    use DatabaseTransactions;

    private const PASSWORD = 'F383-Correct-Horse-9!';

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['podcasts' => true])]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_self_erasure_keeps_other_members_open_and_resolved_complaints(): void
    {
        $owner = $this->member();
        $reporterA = $this->member();
        $reporterB = $this->member();

        $showId = $this->show((int) $owner->id);
        $episodeId = $this->episode($showId, (int) $owner->id);
        $openReport = $this->report($episodeId, (int) $reporterA->id, 'open');
        $resolvedReport = $this->report($episodeId, (int) $reporterB->id, 'resolved');

        Sanctum::actingAs($owner, ['*']);
        $res = $this->deleteJson('/api/v2/users/me', ['password' => self::PASSWORD], $this->hdr());
        $this->assertContains($res->getStatusCode(), [200, 202, 204], 'precondition: self-erasure ran. ' . $res->getContent());

        // The erasure itself still happened: the creator's episode is gone.
        $this->assertFalse(
            DB::table('podcast_episodes')->where('id', $episodeId)->exists(),
            'the erased member\'s episode is still removed'
        );

        // The complaints filed by two OTHER members survive, with their status.
        $this->assertSame(
            'open',
            DB::table('podcast_episode_reports')->where('id', $openReport)->value('status'),
            'the open complaint survives the creator\'s self-erasure'
        );
        $this->assertSame(
            'resolved',
            DB::table('podcast_episode_reports')->where('id', $resolvedReport)->value('status'),
            'the resolved complaint (moderation record) survives too'
        );
        // The reporters' accounts are untouched — this is their data, not the erased member's.
        $this->assertSame('active', (string) DB::table('users')->where('id', $reporterA->id)->value('status'));
    }

    public function test_control_the_delete_route_refuses_and_keeps_the_complaint(): void
    {
        $owner = $this->member();
        $reporter = $this->member();
        $showId = $this->show((int) $owner->id);
        $episodeId = $this->episode($showId, (int) $owner->id);
        $openReport = $this->report($episodeId, (int) $reporter->id, 'open');

        Sanctum::actingAs($owner, ['*']);
        $res = $this->deleteJson("/api/v2/podcasts/{$showId}/episodes/{$episodeId}", [], $this->hdr());

        $this->assertSame(409, $res->getStatusCode(), 'CONTROL: F-338 refuses the creator\'s delete. ' . $res->getContent());
        $this->assertTrue(DB::table('podcast_episode_reports')->where('id', $openReport)->exists());
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return array<string,string> */
    private function hdr(): array
    {
        return ['X-Tenant-ID' => (string) $this->testTenantId];
    }

    private function member(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'password_hash' => password_hash(self::PASSWORD, PASSWORD_BCRYPT),
        ]);

        return User::find($u->id);
    }

    private function show(int $ownerId): int
    {
        return (int) DB::table('podcast_shows')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_user_id' => $ownerId,
            'title' => 'F383 show',
            'slug' => 'f383-show-' . uniqid(),
            'visibility' => 'public',
            'status' => 'published',
            'moderation_status' => 'approved',
            'episode_count' => 1,
            'subscriber_count' => 0,
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function episode(int $showId, int $authorId): int
    {
        return (int) DB::table('podcast_episodes')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'show_id' => $showId,
            'author_user_id' => $authorId,
            'title' => 'F383 episode',
            'slug' => 'f383-episode-' . uniqid(),
            'audio_url' => 'https://media.example.test/' . uniqid() . '.mp3',
            'media_processing_status' => 'complete',
            'media_scan_status' => 'clean',
            'visibility' => 'public',
            'status' => 'published',
            'moderation_status' => 'approved',
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function report(int $episodeId, int $reporterId, string $status): int
    {
        return (int) DB::table('podcast_episode_reports')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'episode_id' => $episodeId,
            'reporter_user_id' => $reporterId,
            'reason' => 'harassment',
            'details' => 'F383 synthetic complaint.',
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
