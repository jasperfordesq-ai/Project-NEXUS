<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AchievementCampaignService;
use App\Services\BadgeDefinitionService;
use App\Services\GamificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-310 — a badge award must award something, or say it did not.
 *
 * Before the fix: `POST /v2/admin/users/{id}/badges` accepted any string,
 * `awardBadgeByKey()` silently did nothing for an unknown key, and the endpoint
 * still answered 201 `awarded: true`, wrote an audit line saying the award
 * happened, and pushed "You've been awarded the {raw string} badge!" to the
 * member. A badge campaign with an unrecognised key likewise reported
 * `total_awards = <audience size>` while granting nothing.
 */
final class BadgeAwardIntegrityTest extends TestCase
{
    use DatabaseTransactions;

    private const UNKNOWN_SLUG = 'f310_no_such_badge_<b>click</b>';

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    /** A badge this community has enabled, so every award path can see it. */
    private function realBadgeKey(): string
    {
        DB::table('badges')->insertOrIgnore([
            'tenant_id' => $this->testTenantId,
            'badge_key' => 'f310-helper',
            'name' => 'F-310 Helper',
            'description' => 'Synthetic fixture badge.',
            'icon' => 'fa-award',
            'is_active' => 1,
            'is_enabled' => 1,
            'badge_tier' => 'core',
            'badge_class' => 'special',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        BadgeDefinitionService::clearCache($this->testTenantId);
        $def = GamificationService::getBadgeByKey('f310-helper');
        $this->assertNotNull($def, 'fixture: the seeded badge must resolve');

        return (string) $def['key'];
    }

    protected function tearDown(): void
    {
        BadgeDefinitionService::clearCache($this->testTenantId);
        parent::tearDown();
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function actingAsAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function notificationCount(int $userId): int
    {
        return DB::table('notifications')->where('user_id', $userId)->count();
    }

    public function test_awarding_an_unknown_badge_is_refused_and_tells_the_member_nothing(): void
    {
        $member = $this->member();
        $this->actingAsAdmin();
        $before = $this->notificationCount((int) $member->id);

        $response = $this->apiPost("/v2/admin/users/{$member->id}/badges", ['badge_slug' => self::UNKNOWN_SLUG]);

        $this->assertSame(422, $response->status(), $response->getContent());
        $this->assertSame(0, DB::table('user_badges')->where('user_id', $member->id)->count());
        $this->assertSame($before, $this->notificationCount((int) $member->id), 'no notification for an award that did not happen');
        $this->assertSame(
            0,
            DB::table('activity_log')->where('action', 'admin_award_badge')->where('details', 'like', '%f310_no_such_badge%')->count(),
            'no audit line claiming an award that did not happen',
        );
    }

    public function test_control_awarding_a_real_badge_grants_it_and_notifies_once(): void
    {
        $member = $this->member();
        $this->actingAsAdmin();
        $key = $this->realBadgeKey();
        $before = $this->notificationCount((int) $member->id);

        $response = $this->apiPost("/v2/admin/users/{$member->id}/badges", ['badge_slug' => $key]);

        $this->assertSame(201, $response->status(), $response->getContent());
        $this->assertTrue((bool) $response->json('data.awarded'));
        $this->assertSame(1, DB::table('user_badges')->where('user_id', $member->id)->where('badge_key', $key)->count());
        // One bell notification, from the award itself (in the member's
        // language) — not a second hard-coded English one from the controller.
        $this->assertSame($before + 1, $this->notificationCount((int) $member->id));
    }

    public function test_awarding_a_badge_already_held_says_so(): void
    {
        $member = $this->member();
        $this->actingAsAdmin();
        $key = $this->realBadgeKey();
        $this->apiPost("/v2/admin/users/{$member->id}/badges", ['badge_slug' => $key])->assertStatus(201);
        $before = $this->notificationCount((int) $member->id);

        $again = $this->apiPost("/v2/admin/users/{$member->id}/badges", ['badge_slug' => $key]);

        $this->assertSame(200, $again->status(), $again->getContent());
        $this->assertFalse((bool) $again->json('data.awarded'));
        $this->assertSame($before, $this->notificationCount((int) $member->id));
    }

    public function test_bulk_award_counts_only_badges_actually_granted(): void
    {
        $holder = $this->member();
        $fresh = $this->member();
        $this->actingAsAdmin();
        $key = $this->realBadgeKey();
        GamificationService::awardBadgeByKey((int) $holder->id, $key);

        $response = $this->apiPost('/v2/admin/gamification/bulk-award', [
            'badge_slug' => $key,
            'user_ids' => [(int) $holder->id, (int) $fresh->id],
        ]);

        $this->assertSame(200, $response->status(), $response->getContent());
        $this->assertSame(1, (int) $response->json('data.awarded'), 'the member who already held it was not awarded again');
        $this->assertSame(2, (int) $response->json('data.total_requested'));
    }

    public function test_a_badge_campaign_with_an_unknown_badge_cannot_be_created(): void
    {
        $this->actingAsAdmin();

        $response = $this->apiPost('/v2/admin/gamification/campaigns', [
            'name' => 'F-310 campaign',
            'type' => 'one_time',
            'badge_key' => self::UNKNOWN_SLUG,
        ]);

        $this->assertSame(422, $response->status(), $response->getContent());
        $this->assertSame(0, DB::table('achievement_campaigns')->where('tenant_id', $this->testTenantId)->where('name', 'F-310 campaign')->count());
    }

    public function test_control_a_badge_campaign_with_a_real_badge_is_created(): void
    {
        $this->actingAsAdmin();

        $response = $this->apiPost('/v2/admin/gamification/campaigns', [
            'name' => 'F-310 control campaign',
            'type' => 'one_time',
            'badge_key' => $this->realBadgeKey(),
        ]);

        $this->assertSame(201, $response->status(), $response->getContent());
    }

    public function test_a_legacy_campaign_with_an_unknown_badge_reports_zero_awards(): void
    {
        $member = $this->member();
        $campaignId = (int) DB::table('achievement_campaigns')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F-310 legacy campaign',
            'campaign_type' => 'badge_award',
            'badge_key' => 'f310_unknown',
            'xp_amount' => 0,
            'target_audience' => 'custom',
            'audience_config' => json_encode(['user_ids' => [(int) $member->id]]),
            'status' => 'running',
            'created_at' => now(),
        ]);

        $results = app(AchievementCampaignService::class)->processRecurringCampaigns();

        $mine = array_values(array_filter($results, static fn ($r) => $r['campaign_id'] === $campaignId));
        $this->assertSame(0, $mine[0]['awarded'] ?? null);
        $this->assertSame(0, (int) DB::table('achievement_campaigns')->where('id', $campaignId)->value('total_awards'));
    }
}
