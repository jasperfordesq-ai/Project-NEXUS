<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\AdminBadgeCountService;
use Illuminate\Support\Facades\DB;

class AdminBadgeCountServiceTest extends TestCase
{
    // Added with the pending_users tests below — they are the first in this
    // file to write real rows, so without this they would leak test users.
    use \Illuminate\Foundation\Testing\DatabaseTransactions;

    private AdminBadgeCountService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new AdminBadgeCountService();
    }

    public function test_getCounts_returns_expected_keys(): void
    {
        $this->markTestIncomplete('Requires integration test — many DB::table calls with different tables');
    }

    // ── Volunteering queues (sidebar badges + Overview "Needs your attention") ──

    private function volunteeringRows(): void
    {
        $tid = $this->testTenantId;
        $user = \App\Models\User::factory()->forTenant($tid)->create();
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tid, 'title' => 'Badge opp', 'description' => 'x', 'is_active' => 1, 'created_at' => now(),
        ]);
        foreach (['pending', 'pending', 'approved'] as $status) {
            DB::table('vol_applications')->insert([
                'tenant_id' => $tid, 'opportunity_id' => $oppId, 'user_id' => $user->id, 'status' => $status, 'created_at' => now(),
            ]);
        }
        foreach (['pending', 'approved', 'declined'] as $status) {
            DB::table('vol_logs')->insert([
                'tenant_id' => $tid, 'opportunity_id' => $oppId, 'user_id' => $user->id, 'hours' => 1, 'status' => $status,
                'date_logged' => now()->toDateString(), 'created_at' => now(),
            ]);
        }
        foreach (['pending', 'pending', 'pending', 'paid'] as $status) {
            DB::table('vol_expenses')->insert([
                'tenant_id' => $tid, 'user_id' => $user->id, 'expense_type' => 'travel', 'amount' => 5, 'status' => $status,
            ]);
        }
        foreach (['proposed', 'under_review', 'approved', 'rejected'] as $status) {
            DB::table('vol_community_projects')->insert([
                'tenant_id' => $tid, 'title' => 'Idea ' . $status, 'description' => 'x', 'proposed_by' => $user->id,
                'status' => $status, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    public function test_counts_the_volunteering_queues_an_admin_must_work_through(): void
    {
        \App\Core\TenantContext::setById($this->testTenantId);
        $this->volunteeringRows();

        $counts = $this->service->getVolunteeringAttention($this->testTenantId);

        $this->assertSame(2, $counts['pending_vol_applications']);
        $this->assertSame(1, $counts['pending_vol_hours']);
        $this->assertSame(3, $counts['pending_vol_expenses']);
        $this->assertSame(2, $counts['pending_vol_projects'], 'proposed and under review are both waiting for a decision');
    }

    /**
     * A swap request only waits for an admin when the community has switched
     * on "swaps need admin approval". With it off the page is always empty,
     * so the badge must be 0 too, whatever rows the table holds.
     */
    public function test_swap_requests_count_only_when_the_community_requires_admin_approval(): void
    {
        $tid = $this->testTenantId;
        \App\Core\TenantContext::setById($tid);
        $user = \App\Models\User::factory()->forTenant($tid)->create();
        $other = \App\Models\User::factory()->forTenant($tid)->create();
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tid, 'title' => 'Swap opp', 'description' => 'x', 'is_active' => 1, 'created_at' => now(),
        ]);
        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $tid, 'opportunity_id' => $oppId,
            'start_time' => now()->addDay()->format('Y-m-d H:i:s'), 'end_time' => now()->addDay()->addHours(2)->format('Y-m-d H:i:s'), 'capacity' => 5,
        ]);
        DB::table('vol_shift_swap_requests')->insert([
            'tenant_id' => $tid, 'from_shift_id' => $shiftId, 'to_shift_id' => $shiftId,
            'from_user_id' => $user->id, 'to_user_id' => $other->id,
            'status' => 'admin_pending', 'created_at' => now(), 'updated_at' => now(),
        ]);

        \App\Services\VolunteeringConfigurationService::set(\App\Services\VolunteeringConfigurationService::CONFIG_SWAP_REQUIRES_ADMIN, false);
        $this->assertSame(0, $this->service->getVolunteeringAttention($tid)['pending_vol_swaps']);

        \App\Services\VolunteeringConfigurationService::set(\App\Services\VolunteeringConfigurationService::CONFIG_SWAP_REQUIRES_ADMIN, true);
        $this->assertSame(1, $this->service->getVolunteeringAttention($tid)['pending_vol_swaps']);
    }

    public function test_badge_counts_carry_the_volunteering_queues(): void
    {
        \App\Core\TenantContext::setById($this->testTenantId);
        $this->volunteeringRows();

        $counts = $this->service->getCounts();

        $this->assertSame(2, $counts['pending_vol_applications']);
        $this->assertSame(3, $counts['pending_vol_expenses']);
        $this->assertArrayHasKey('pending_vol_swaps', $counts);
    }

    public function test_getCount_returns_zero_for_unknown_key(): void
    {
        // Force cached counts with an empty array
        $reflection = new \ReflectionClass($this->service);
        $prop = $reflection->getProperty('cachedCounts');
        $prop->setAccessible(true);
        $prop->setValue($this->service, ['pending_users' => 5]);

        $this->assertSame(0, $this->service->getCount('nonexistent'));
    }

    public function test_getCount_returns_cached_value(): void
    {
        $reflection = new \ReflectionClass($this->service);
        $prop = $reflection->getProperty('cachedCounts');
        $prop->setAccessible(true);
        $prop->setValue($this->service, ['pending_users' => 7]);

        $this->assertSame(7, $this->service->getCount('pending_users'));
    }

    public function test_clearCache_resets_cached_counts(): void
    {
        $reflection = new \ReflectionClass($this->service);
        $prop = $reflection->getProperty('cachedCounts');
        $prop->setAccessible(true);
        $prop->setValue($this->service, ['pending_users' => 5]);

        $this->service->clearCache();

        $this->assertNull($prop->getValue($this->service));
    }

    public function test_getCounts_caches_result_for_request_lifetime(): void
    {
        $reflection = new \ReflectionClass($this->service);
        $prop = $reflection->getProperty('cachedCounts');
        $prop->setAccessible(true);
        $prop->setValue($this->service, ['pending_users' => 3, 'fraud_alerts' => 1]);

        // Second call should return cached value without DB queries
        $counts = $this->service->getCounts();
        $this->assertSame(3, $counts['pending_users']);
        $this->assertSame(1, $counts['fraud_alerts']);
    }

    // -------------------------------------------------------------------------
    // pending_users must agree with the screen the badge links to
    // -------------------------------------------------------------------------
    //
    // 🔴 Every test above this line pokes the cache with reflection and never
    // touches a row, which is why nobody noticed the count was computed from a
    // different column than the list it points at. It counted
    // status = 'pending'; AdminUsersController's filter=pending selects on
    // is_approved = 0. Those drift apart — the same controller carries a repair
    // for approvals that left status stuck at 'pending' — and a badge reading
    // "1" that opens an empty screen is worse than no badge at all.

    public function test_pending_users_counts_unapproved_members_and_matches_the_list_filter(): void
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Badge Count Test', 'slug' => 'badge-count-' . uniqid('', true),
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Badge Count Other', 'slug' => 'badge-other-' . uniqid('', true),
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->seedUser($tenantId, ['is_approved' => 0]);                      // waiting
        $this->seedUser($tenantId, ['is_approved' => 0, 'status' => 'active']); // waiting, status already active
        $this->seedUser($tenantId, ['is_approved' => 1]);                      // approved, must not count
        $this->seedUser($otherTenantId, ['is_approved' => 0]);                 // other community

        \App\Core\TenantContext::setById($tenantId);
        $counts = (new AdminBadgeCountService())->getCounts();

        $this->assertSame(2, $counts['pending_users'], 'Both unapproved members in this community must be counted.');

        // The predicate the badge links to, run directly. If someone changes
        // one of these without the other, this fails.
        $listFilterCount = (int) DB::table('users')
            ->where('tenant_id', $tenantId)->where('is_approved', 0)->count();

        $this->assertSame(
            $listFilterCount,
            $counts['pending_users'],
            'The badge count must equal what AdminUsersController filter=pending shows, '
            . 'or the badge opens a screen that does not match it.'
        );
    }

    public function test_pending_users_is_scoped_to_the_current_community(): void
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Badge Scope Test', 'slug' => 'badge-scope-' . uniqid('', true),
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Badge Scope Other', 'slug' => 'badge-scope-other-' . uniqid('', true),
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->seedUser($otherTenantId, ['is_approved' => 0]);
        $this->seedUser($otherTenantId, ['is_approved' => 0]);

        \App\Core\TenantContext::setById($tenantId);

        $this->assertSame(
            0,
            (new AdminBadgeCountService())->getCounts()['pending_users'],
            'Another community\'s waiting members must never appear on this community\'s badge.'
        );
    }

    // -------------------------------------------------------------------------
    // unreviewed_messages must agree with the queue the badge links to
    // -------------------------------------------------------------------------
    //
    // 🔴 The "Messages to review" badge opens /broker/messages?status=unreviewed,
    // which AdminBrokerController::messages() serves with the F-436 rule: the
    // viewer's own conversations are not in their queue. The badge counted
    // every unreviewed copy, so an admin who was a party to copied messages saw
    // a number the list could never reach — on Timebank Ireland, 17 Oct 2026,
    // "7" over an empty queue, all seven being the admin's own conversations.

    public function test_unreviewed_messages_excludes_the_viewers_own_conversations(): void
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Badge Msg Test', 'slug' => 'badge-msg-' . uniqid('', true),
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Badge Msg Other', 'slug' => 'badge-msg-other-' . uniqid('', true),
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $admin = $this->seedUser($tenantId, ['role' => 'admin', 'is_approved' => 1, 'status' => 'active']);
        $alice = $this->seedUser($tenantId, ['is_approved' => 1, 'status' => 'active']);
        $bob = $this->seedUser($tenantId, ['is_approved' => 1, 'status' => 'active']);
        $outsider = $this->seedUser($otherTenantId, ['is_approved' => 1, 'status' => 'active']);

        $this->seedCopy($tenantId, $alice, $bob);                          // counts
        $this->seedCopy($tenantId, $bob, $alice);                          // counts
        $this->seedCopy($tenantId, $alice, $bob, ['reviewed_at' => now()]); // already reviewed
        $this->seedCopy($tenantId, $admin, $alice);                        // admin sent it
        $this->seedCopy($tenantId, $bob, $admin);                          // admin received it
        $this->seedCopy($otherTenantId, $outsider, $outsider);             // other community

        \App\Core\TenantContext::setById($tenantId);
        $counts = (new AdminBadgeCountService())->getCounts($admin);

        $this->assertSame(
            2,
            $counts['unreviewed_messages'],
            'Only unreviewed copies between other people may count — the admin cannot review their own.'
        );

        // The list the badge opens, run directly (AdminBrokerController::messages
        // with filter=unreviewed). If either side changes alone, this fails.
        $queueCount = (int) DB::table('broker_message_copies')
            ->where('tenant_id', $tenantId)
            ->whereNull('reviewed_at')
            ->where('sender_id', '<>', $admin)
            ->where('receiver_id', '<>', $admin)
            ->count();

        $this->assertSame($queueCount, $counts['unreviewed_messages']);
    }

    public function test_cached_counts_are_not_shared_between_viewers(): void
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Badge Cache Test', 'slug' => 'badge-cache-' . uniqid('', true),
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $first = $this->seedUser($tenantId, ['role' => 'admin', 'is_approved' => 1, 'status' => 'active']);
        $second = $this->seedUser($tenantId, ['role' => 'admin', 'is_approved' => 1, 'status' => 'active']);
        $this->seedCopy($tenantId, $first, $second);

        \App\Core\TenantContext::setById($tenantId);
        // The service is a container singleton, so one instance answers both.
        $service = new AdminBadgeCountService();

        $this->assertSame(0, $service->getCounts($first)['unreviewed_messages']);
        $this->assertSame(0, $service->getCounts($second)['unreviewed_messages']);

        $third = $this->seedUser($tenantId, ['role' => 'admin', 'is_approved' => 1, 'status' => 'active']);
        $this->assertSame(1, $service->getCounts($third)['unreviewed_messages']);
    }

    private function seedCopy(int $tenantId, int $senderId, int $receiverId, array $overrides = []): void
    {
        $messageId = (int) DB::table('messages')->insertGetId([
            'tenant_id' => $tenantId, 'sender_id' => $senderId, 'receiver_id' => $receiverId,
            'body' => 'badge test', 'created_at' => now(),
        ]);
        DB::table('broker_message_copies')->insert(array_merge([
            'tenant_id' => $tenantId,
            'original_message_id' => $messageId,
            'conversation_key' => 'badge-' . uniqid('', true),
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'message_body' => 'badge test',
            'sent_at' => now(),
            'copy_reason' => 'first_contact',
            'created_at' => now(),
        ], $overrides));
    }

    private function seedUser(int $tenantId, array $overrides = []): int
    {
        $unique = uniqid('badge_', true);
        return (int) DB::table('users')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'name' => 'Badge User ' . $unique,
            'first_name' => 'Badge', 'last_name' => 'User',
            'email' => $unique . '@example.com',
            'role' => 'member', 'status' => 'pending',
            'preferred_language' => 'en', 'is_approved' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ], $overrides));
    }
}
