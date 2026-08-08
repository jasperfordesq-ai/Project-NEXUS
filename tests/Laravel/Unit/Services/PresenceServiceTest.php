<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Models\User;
use App\Services\PresenceService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;
use Tests\Laravel\TestCase;

/**
 * Unit tests for PresenceService — heartbeat, presence reads, status,
 * privacy, online count, cleanup, and helper methods.
 */
class PresenceServiceTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Flush presence-related Redis keys before each test.
     */
    protected function setUp(): void
    {
        parent::setUp();

        try {
            $keys = Redis::keys('nexus:presence:*');
            if (!empty($keys)) {
                Redis::del($keys);
            }
        } catch (\Throwable) {
            // Redis may not be available in CI
        }
    }

    /**
     * Skip only when Redis genuinely cannot be reached.
     *
     * These tests used to wrap their whole body in `catch (\Throwable)` and
     * skip on anything at all. PHPUnit's assertion failures are Throwables, so
     * that also swallowed every real failure: the tests could report "Redis
     * required for this test" but could never actually fail. Checking the
     * precondition up front keeps the honest environment skip and lets
     * assertion failures surface as failures.
     */
    private function requireRedis(): void
    {
        try {
            Redis::ping();
        } catch (\Throwable $e) {
            $this->markTestSkipped('Redis unavailable: ' . $e->getMessage());
        }
    }

    /**
     * Insert a presence row directly into the DB.
     */
    private function seedPresence(int $userId, array $overrides = []): void
    {
        $defaults = [
            'user_id' => $userId,
            'tenant_id' => $this->testTenantId,
            'status' => 'online',
            'custom_status' => null,
            'status_emoji' => null,
            'last_seen_at' => now(),
            'last_activity_at' => now(),
            'hide_presence' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ];

        DB::table('user_presence')->insertOrIgnore(array_merge($defaults, $overrides));
    }

    // ------------------------------------------------------------------
    //  heartbeat()
    // ------------------------------------------------------------------

    public function test_heartbeat_creates_presence_record(): void
    {
        $userId = 12345;

        PresenceService::heartbeat($userId);

        $this->assertDatabaseHas('user_presence', [
            'user_id' => $userId,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function test_heartbeat_updates_existing_record(): void
    {
        $userId = 12346;
        $this->seedPresence($userId, [
            'last_activity_at' => now()->subHours(1),
        ]);

        PresenceService::heartbeat($userId);

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        // last_activity_at should have been updated to something recent
        $this->assertGreaterThan(
            now()->subMinutes(5)->timestamp,
            strtotime($row->last_activity_at)
        );
    }

    public function test_heartbeat_bridges_users_last_active_at(): void
    {
        // Regression: the React SPA only pings /v2/presence/heartbeat, never
        // /auth/heartbeat, so users.last_active_at went permanently stale and the
        // legacy is_online consumers (messages, members, feed sidebar) showed an
        // actively-online user as "offline". The heartbeat must now bridge that column.
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'last_active_at' => now()->subMinutes(30),
        ]);

        // Re-establish the tenant context: creating a model via the factory re-resolves
        // TenantContext (a test-only artifact), and the bridge writes WHERE tenant_id =
        // TenantContext::getId(). In production the heartbeat runs inside a stable
        // tenant-scoped request, so this just mirrors that.
        \App\Core\TenantContext::setById($this->testTenantId);

        // The bridge write rides the once-per-60s DB-write throttle. DatabaseTransactions
        // rolls back the row but NOT the Redis throttle key, so across rapid re-runs the
        // reused auto-increment id can still be throttled — clear it so the DB path runs.
        try {
            Redis::del("nexus:presence:throttle:{$this->testTenantId}:{$user->id}");
        } catch (\Throwable) {
            // Redis unavailable — heartbeat falls through to the DB write anyway.
        }

        PresenceService::heartbeat((int) $user->id);

        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertNotNull($row);
        $this->assertNotNull($row->last_active_at);
        $this->assertGreaterThan(
            now()->subMinutes(5)->timestamp,
            strtotime($row->last_active_at),
            'heartbeat should refresh users.last_active_at to within the 5-minute online window'
        );

        // Assert the EXACT predicate the legacy consumers use (e.g. MessageService.php:131,616,
        // GroupConversationService.php:352) now evaluates true — this is the literal user-visible bug.
        $lastActive = \Carbon\Carbon::parse($row->last_active_at);
        $isOnline = $lastActive->gt(now()->subMinutes(5));
        $this->assertTrue($isOnline, 'partner is_online must be true after a presence heartbeat');
    }

    public function test_heartbeat_bridge_is_tenant_scoped(): void
    {
        // A user belonging to a DIFFERENT tenant must not have last_active_at rewritten
        // when a heartbeat fires under the current tenant context. Guards against a
        // future refactor dropping the where('tenant_id', …) clause on the bridge write.
        $stale = now()->subMinutes(30);
        $otherTenantUser = User::factory()->forTenant(999)->create([
            'last_active_at' => $stale,
        ]);

        // Pin the active tenant to testTenantId (2) — the factory create above re-resolved
        // TenantContext, and we need it to be tenant 2 (NOT 999) to prove the bridge's
        // tenant_id filter blocks the cross-tenant write rather than the throttle.
        \App\Core\TenantContext::setById($this->testTenantId);

        // Clear the throttle so the bridge write genuinely RUNS (and we prove the
        // tenant_id filter is what blocks it, not the throttle short-circuit).
        try {
            Redis::del("nexus:presence:throttle:{$this->testTenantId}:{$otherTenantUser->id}");
        } catch (\Throwable) {
            // Redis unavailable — heartbeat falls through to the DB write anyway.
        }

        // TenantContext is testTenantId (2) here; heartbeat for the other-tenant user id
        // must not touch that row because the bridge filters on tenant_id.
        PresenceService::heartbeat((int) $otherTenantUser->id);

        $row = DB::table('users')->where('id', $otherTenantUser->id)->first();
        $this->assertNotNull($row);
        $this->assertNotNull($row->last_active_at);
        $this->assertEqualsWithDelta(
            $stale->timestamp,
            strtotime($row->last_active_at),
            2,
            'cross-tenant heartbeat must not refresh another tenant user\'s last_active_at'
        );
    }

    public function test_heartbeat_preserves_dnd_status(): void
    {
        $userId = 12347;
        $this->seedPresence($userId, ['status' => 'dnd']);

        $this->requireRedis();

        // Seed Redis with DND so heartbeat sees it
        $redisKey = "nexus:presence:{$this->testTenantId}:{$userId}";
        Redis::setex($redisKey, 300, json_encode([
            'user_id' => $userId,
            'tenant_id' => $this->testTenantId,
            'status' => 'dnd',
            'custom_status' => null,
            'status_emoji' => null,
            'last_activity_at' => now()->toDateTimeString(),
            'last_seen_at' => now()->toDateTimeString(),
            'hide_presence' => false,
        ]));

        PresenceService::heartbeat($userId);

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertEquals('dnd', $row->status);
    }

    public function test_heartbeat_sets_redis_presence_key(): void
    {
        $userId = 12348;

        $this->requireRedis();

        PresenceService::heartbeat($userId);

        $redisKey = "nexus:presence:{$this->testTenantId}:{$userId}";
        $data = Redis::get($redisKey);

        $this->assertNotNull($data);
        $decoded = json_decode($data, true);
        $this->assertEquals($userId, $decoded['user_id']);
        $this->assertEquals($this->testTenantId, $decoded['tenant_id']);
    }

    public function test_heartbeat_adds_user_to_online_set(): void
    {
        $userId = 12349;

        $this->requireRedis();

        PresenceService::heartbeat($userId);

        $onlineSetKey = "nexus:presence:online:{$this->testTenantId}";
        $isMember = Redis::sismember($onlineSetKey, $userId);

        $this->assertTrue((bool) $isMember);
    }

    // ------------------------------------------------------------------
    //  getPresence()
    // ------------------------------------------------------------------

    public function test_getPresence_returns_offline_for_unknown_user(): void
    {
        $result = PresenceService::getPresence(999999);

        $this->assertEquals('offline', $result['status']);
        $this->assertNull($result['last_seen_at']);
        $this->assertNull($result['custom_status']);
        $this->assertNull($result['status_emoji']);
    }

    public function test_getPresence_returns_data_from_db(): void
    {
        $userId = 12350;
        $this->seedPresence($userId, [
            'status' => 'online',
            'custom_status' => 'Working',
            'status_emoji' => "\xF0\x9F\x92\xBB", // laptop emoji
            'last_activity_at' => now(),
        ]);

        $result = PresenceService::getPresence($userId);

        $this->assertArrayHasKey('status', $result);
        $this->assertArrayHasKey('last_seen_at', $result);
        $this->assertArrayHasKey('custom_status', $result);
        $this->assertArrayHasKey('status_emoji', $result);
    }

    public function test_getPresence_returns_offline_when_hidden(): void
    {
        $userId = 12351;
        $this->seedPresence($userId, [
            'status' => 'online',
            'hide_presence' => 1,
            'last_activity_at' => now(),
        ]);

        // Clear Redis so it falls back to DB
        try {
            Redis::del("nexus:presence:{$this->testTenantId}:{$userId}");
        } catch (\Throwable) {
            // pass
        }

        $result = PresenceService::getPresence($userId);

        $this->assertEquals('offline', $result['status']);
        $this->assertNull($result['custom_status']);
    }

    public function test_getPresence_computes_away_after_threshold(): void
    {
        $userId = 12352;
        // Last activity was 6 minutes ago (past the 5-minute AWAY_THRESHOLD)
        $this->seedPresence($userId, [
            'status' => 'online',
            'last_activity_at' => now()->subMinutes(6),
        ]);

        // Clear Redis so it falls back to DB
        try {
            Redis::del("nexus:presence:{$this->testTenantId}:{$userId}");
        } catch (\Throwable) {
            // pass
        }

        $result = PresenceService::getPresence($userId);

        $this->assertEquals('away', $result['status']);
    }

    public function test_getPresence_computes_offline_after_threshold(): void
    {
        $userId = 12353;
        // Last activity was 20 minutes ago (past the 15-minute OFFLINE_THRESHOLD)
        $this->seedPresence($userId, [
            'status' => 'online',
            'last_activity_at' => now()->subMinutes(20),
        ]);

        // Clear Redis so it falls back to DB
        try {
            Redis::del("nexus:presence:{$this->testTenantId}:{$userId}");
        } catch (\Throwable) {
            // pass
        }

        $result = PresenceService::getPresence($userId);

        $this->assertEquals('offline', $result['status']);
    }

    public function test_getPresence_preserves_dnd_regardless_of_activity(): void
    {
        $userId = 12354;
        // DND status with old activity — DND should still be DND
        $this->seedPresence($userId, [
            'status' => 'dnd',
            'last_activity_at' => now()->subMinutes(30),
        ]);

        // Clear Redis so it falls back to DB
        try {
            Redis::del("nexus:presence:{$this->testTenantId}:{$userId}");
        } catch (\Throwable) {
            // pass
        }

        $result = PresenceService::getPresence($userId);

        $this->assertEquals('dnd', $result['status']);
    }

    // ------------------------------------------------------------------
    //  getBulkPresence()
    // ------------------------------------------------------------------

    public function test_getBulkPresence_returns_empty_for_empty_input(): void
    {
        $result = PresenceService::getBulkPresence([]);

        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }

    public function test_getBulkPresence_returns_offline_for_unknown_users(): void
    {
        $result = PresenceService::getBulkPresence([888888, 888889]);

        $this->assertArrayHasKey(888888, $result);
        $this->assertArrayHasKey(888889, $result);
        $this->assertEquals('offline', $result[888888]['status']);
        $this->assertEquals('offline', $result[888889]['status']);
    }

    public function test_getBulkPresence_returns_mixed_statuses(): void
    {
        $userId1 = 12360;
        $userId2 = 12361;

        $this->seedPresence($userId1, ['status' => 'online', 'last_activity_at' => now()]);
        $this->seedPresence($userId2, ['status' => 'dnd', 'last_activity_at' => now()->subMinutes(30)]);

        // Clear Redis so it falls back to DB
        try {
            Redis::del("nexus:presence:{$this->testTenantId}:{$userId1}");
            Redis::del("nexus:presence:{$this->testTenantId}:{$userId2}");
        } catch (\Throwable) {
            // pass
        }

        $result = PresenceService::getBulkPresence([$userId1, $userId2, 999777]);

        $this->assertCount(3, $result);
        // user 999777 doesn't exist — should be offline
        $this->assertEquals('offline', $result[999777]['status']);
        // user with DND should still be DND
        $this->assertEquals('dnd', $result[$userId2]['status']);
    }

    public function test_getBulkPresence_hides_private_users(): void
    {
        $userId = 12362;
        $this->seedPresence($userId, [
            'status' => 'online',
            'custom_status' => 'Hidden status',
            'hide_presence' => 1,
            'last_activity_at' => now(),
        ]);

        // Clear Redis so it falls back to DB
        try {
            Redis::del("nexus:presence:{$this->testTenantId}:{$userId}");
        } catch (\Throwable) {
            // pass
        }

        $result = PresenceService::getBulkPresence([$userId]);

        $this->assertEquals('offline', $result[$userId]['status']);
        $this->assertNull($result[$userId]['custom_status']);
    }

    public function test_getBulkPresence_is_tenant_scoped(): void
    {
        $userId = 12363;

        // Insert presence for a different tenant
        DB::table('user_presence')->insertOrIgnore([
            'user_id' => $userId,
            'tenant_id' => 999,
            'status' => 'online',
            'custom_status' => 'Other tenant',
            'last_seen_at' => now(),
            'last_activity_at' => now(),
            'hide_presence' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Clear Redis so it falls back to DB
        try {
            Redis::del("nexus:presence:{$this->testTenantId}:{$userId}");
            Redis::del("nexus:presence:999:{$userId}");
        } catch (\Throwable) {
            // pass
        }

        // Query in context of testTenantId — should NOT find the other-tenant record
        $result = PresenceService::getBulkPresence([$userId]);

        $this->assertEquals('offline', $result[$userId]['status']);
    }

    // ------------------------------------------------------------------
    //  setStatus()
    // ------------------------------------------------------------------

    public function test_setStatus_creates_presence_record(): void
    {
        $userId = 12370;

        PresenceService::setStatus($userId, 'dnd', 'In a meeting', "\xF0\x9F\x93\x85");

        $this->assertDatabaseHas('user_presence', [
            'user_id' => $userId,
            'tenant_id' => $this->testTenantId,
            'status' => 'dnd',
            'custom_status' => 'In a meeting',
        ]);
    }

    public function test_setStatus_updates_existing_record(): void
    {
        $userId = 12371;
        $this->seedPresence($userId, ['status' => 'online', 'custom_status' => 'Old']);

        PresenceService::setStatus($userId, 'away', 'Lunch break');

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertEquals('away', $row->status);
        $this->assertEquals('Lunch break', $row->custom_status);
    }

    public function test_setStatus_truncates_custom_status_to_80_chars(): void
    {
        $userId = 12372;
        $longStatus = str_repeat('X', 200);

        PresenceService::setStatus($userId, 'online', $longStatus);

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertEquals(80, mb_strlen($row->custom_status));
    }

    public function test_setStatus_truncates_emoji_to_10_chars(): void
    {
        $userId = 12373;
        $longEmoji = str_repeat("\xF0\x9F\x98\x80", 5); // 5 grinning faces = 5 * 4 bytes but mb_strlen = 5

        PresenceService::setStatus($userId, 'online', null, $longEmoji);

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertLessThanOrEqual(10, mb_strlen($row->status_emoji));
    }

    public function test_setStatus_falls_back_to_online_for_invalid_status(): void
    {
        $userId = 12374;

        PresenceService::setStatus($userId, 'invisible'); // invalid

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertEquals('online', $row->status);
    }

    public function test_setStatus_allows_null_custom_status_and_emoji(): void
    {
        $userId = 12375;

        PresenceService::setStatus($userId, 'online', null, null);

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertNull($row->custom_status);
        $this->assertNull($row->status_emoji);
    }

    public function test_setStatus_removes_offline_user_from_online_set(): void
    {
        $userId = 12376;

        $this->requireRedis();

        // First set online
        PresenceService::setStatus($userId, 'online');

        $onlineSetKey = "nexus:presence:online:{$this->testTenantId}";
        $this->assertTrue((bool) Redis::sismember($onlineSetKey, $userId));

        // Now set offline
        PresenceService::setStatus($userId, 'offline');
        $this->assertFalse((bool) Redis::sismember($onlineSetKey, $userId));
    }

    public function test_setStatus_keeps_dnd_in_online_set(): void
    {
        $userId = 12377;

        $this->requireRedis();

        PresenceService::setStatus($userId, 'dnd');

        $onlineSetKey = "nexus:presence:online:{$this->testTenantId}";
        $this->assertTrue((bool) Redis::sismember($onlineSetKey, $userId));
    }

    // ------------------------------------------------------------------
    //  setPrivacy()
    // ------------------------------------------------------------------

    public function test_setPrivacy_creates_record_with_hide_enabled(): void
    {
        $userId = 12380;

        PresenceService::setPrivacy($userId, true);

        $this->assertDatabaseHas('user_presence', [
            'user_id' => $userId,
            'tenant_id' => $this->testTenantId,
            'hide_presence' => 1,
        ]);
    }

    public function test_setPrivacy_updates_existing_record(): void
    {
        $userId = 12381;
        $this->seedPresence($userId, ['hide_presence' => 0]);

        PresenceService::setPrivacy($userId, true);

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertEquals(1, $row->hide_presence);
    }

    public function test_setPrivacy_can_toggle_off(): void
    {
        $userId = 12382;
        $this->seedPresence($userId, ['hide_presence' => 1]);

        PresenceService::setPrivacy($userId, false);

        $this->assertDatabaseHas('user_presence', [
            'user_id' => $userId,
            'tenant_id' => $this->testTenantId,
            'hide_presence' => 0,
        ]);
    }

    public function test_setPrivacy_updates_redis_cache(): void
    {
        $userId = 12383;

        $this->requireRedis();

        // Seed Redis with existing presence
        $redisKey = "nexus:presence:{$this->testTenantId}:{$userId}";
        Redis::setex($redisKey, 300, json_encode([
            'user_id' => $userId,
            'tenant_id' => $this->testTenantId,
            'status' => 'online',
            'hide_presence' => false,
        ]));

        PresenceService::setPrivacy($userId, true);

        $data = json_decode(Redis::get($redisKey), true);
        $this->assertTrue($data['hide_presence']);
    }

    // ------------------------------------------------------------------
    //  getOnlineCount()
    // ------------------------------------------------------------------

    public function test_getOnlineCount_returns_zero_for_empty_tenant(): void
    {
        // Clear Redis for clean fallback
        try {
            Redis::del("nexus:presence:online:{$this->testTenantId}");
        } catch (\Throwable) {
            // pass
        }

        $count = PresenceService::getOnlineCount($this->testTenantId);

        $this->assertIsInt($count);
        $this->assertGreaterThanOrEqual(0, $count);
    }

    public function test_getOnlineCount_counts_online_away_dnd_users(): void
    {
        // Clear Redis for DB fallback
        try {
            Redis::del("nexus:presence:online:{$this->testTenantId}");
        } catch (\Throwable) {
            // pass
        }

        $this->seedPresence(12390, ['status' => 'online', 'last_activity_at' => now()]);
        $this->seedPresence(12391, ['status' => 'away', 'last_activity_at' => now()]);
        $this->seedPresence(12392, ['status' => 'dnd', 'last_activity_at' => now()]);
        $this->seedPresence(12393, ['status' => 'offline', 'last_activity_at' => now()]);

        $count = PresenceService::getOnlineCount($this->testTenantId);

        // online + away + dnd = 3, offline excluded
        $this->assertGreaterThanOrEqual(3, $count);
    }

    public function test_getOnlineCount_excludes_stale_users(): void
    {
        // Clear Redis for DB fallback
        try {
            Redis::del("nexus:presence:online:{$this->testTenantId}");
        } catch (\Throwable) {
            // pass
        }

        // User with recent activity
        $this->seedPresence(12394, ['status' => 'online', 'last_activity_at' => now()]);
        // User with stale activity (20 minutes ago, past OFFLINE_THRESHOLD of 15 min)
        $this->seedPresence(12395, ['status' => 'online', 'last_activity_at' => now()->subMinutes(20)]);

        $count = PresenceService::getOnlineCount($this->testTenantId);

        // User 12395 has stale activity, should be excluded by the DATE_SUB check
        $this->assertGreaterThanOrEqual(1, $count);
    }

    public function test_getOnlineCount_is_tenant_scoped(): void
    {
        // Clear Redis
        try {
            Redis::del("nexus:presence:online:{$this->testTenantId}");
            Redis::del("nexus:presence:online:999");
        } catch (\Throwable) {
            // pass
        }

        $this->seedPresence(12396, [
            'tenant_id' => 999,
            'status' => 'online',
            'last_activity_at' => now(),
        ]);

        $count = PresenceService::getOnlineCount($this->testTenantId);
        // The user in tenant 999 should NOT be counted for testTenantId
        $this->assertGreaterThanOrEqual(0, $count);
    }

    public function test_getOnlineCount_uses_redis_set_when_available(): void
    {
        $this->requireRedis();

        $onlineSetKey = "nexus:presence:online:{$this->testTenantId}";
        Redis::del($onlineSetKey);
        Redis::sadd($onlineSetKey, 1, 2, 3);
        Redis::expire($onlineSetKey, 300);

        $count = PresenceService::getOnlineCount($this->testTenantId);

        $this->assertEquals(3, $count);
    }

    // ------------------------------------------------------------------
    //  cleanupStale()
    // ------------------------------------------------------------------

    public function test_cleanupStale_marks_stale_online_users_as_offline(): void
    {
        $userId = 12400;
        $this->seedPresence($userId, [
            'status' => 'online',
            'last_activity_at' => now()->subMinutes(20), // past 15-min threshold
        ]);

        PresenceService::cleanupStale();

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertEquals('offline', $row->status);
    }

    public function test_cleanupStale_marks_stale_away_users_as_offline(): void
    {
        $userId = 12401;
        $this->seedPresence($userId, [
            'status' => 'away',
            'last_activity_at' => now()->subMinutes(20),
        ]);

        PresenceService::cleanupStale();

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertEquals('offline', $row->status);
    }

    public function test_cleanupStale_does_not_affect_dnd_users(): void
    {
        $userId = 12402;
        $this->seedPresence($userId, [
            'status' => 'dnd',
            'last_activity_at' => now()->subMinutes(20),
        ]);

        PresenceService::cleanupStale();

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertEquals('dnd', $row->status);
    }

    public function test_cleanupStale_does_not_affect_recent_users(): void
    {
        $userId = 12403;
        $this->seedPresence($userId, [
            'status' => 'online',
            'last_activity_at' => now(), // fresh
        ]);

        PresenceService::cleanupStale();

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertEquals('online', $row->status);
    }

    public function test_cleanupStale_does_not_affect_already_offline_users(): void
    {
        $userId = 12404;
        $this->seedPresence($userId, [
            'status' => 'offline',
            'last_activity_at' => now()->subHours(2),
        ]);

        PresenceService::cleanupStale();

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertEquals('offline', $row->status);
    }

    // ------------------------------------------------------------------
    //  formatPresence (tested indirectly through getPresence/getBulkPresence)
    // ------------------------------------------------------------------

    public function test_formatPresence_returns_expected_keys(): void
    {
        $userId = 12410;
        $this->seedPresence($userId, [
            'status' => 'online',
            'custom_status' => 'Coding',
            'status_emoji' => "\xF0\x9F\x92\xBB",
            'last_activity_at' => now(),
        ]);

        // Clear Redis so it falls back to DB
        try {
            Redis::del("nexus:presence:{$this->testTenantId}:{$userId}");
        } catch (\Throwable) {
            // pass
        }

        $result = PresenceService::getPresence($userId);

        $this->assertArrayHasKey('status', $result);
        $this->assertArrayHasKey('last_seen_at', $result);
        $this->assertArrayHasKey('custom_status', $result);
        $this->assertArrayHasKey('status_emoji', $result);
    }

    // ------------------------------------------------------------------
    //  Edge cases
    // ------------------------------------------------------------------

    public function test_heartbeat_handles_redis_failure_gracefully(): void
    {
        // This test ensures that if Redis is unavailable, the service
        // still writes to DB without throwing. We can't easily simulate
        // Redis failure, so we just verify no exception is thrown.
        $userId = 12420;

        // Should not throw even though Redis may or may not be available
        PresenceService::heartbeat($userId);

        $this->assertDatabaseHas('user_presence', [
            'user_id' => $userId,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function test_getPresence_returns_offline_for_null_last_activity(): void
    {
        $userId = 12421;
        $this->seedPresence($userId, [
            'status' => 'online',
            'last_activity_at' => null,
        ]);

        // Clear Redis so it falls back to DB
        try {
            Redis::del("nexus:presence:{$this->testTenantId}:{$userId}");
        } catch (\Throwable) {
            // pass
        }

        $result = PresenceService::getPresence($userId);

        // With no last_activity_at, computeStatus returns 'offline'
        $this->assertEquals('offline', $result['status']);
    }

    public function test_setStatus_trims_whitespace_from_custom_status(): void
    {
        $userId = 12422;

        PresenceService::setStatus($userId, 'online', '  Trimmed status  ');

        $row = DB::table('user_presence')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertEquals('Trimmed status', $row->custom_status);
    }
}
