<?php
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Group;
use App\Models\User;
use App\Services\GroupNotificationPreferenceService;
use App\Services\GroupNotificationService;
use App\Services\NotificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class GroupNotificationReliabilityTest extends TestCase
{
    use DatabaseTransactions;

    public function test_notify_joined_resolves_recipient_locale_and_creates_tenant_scoped_bell(): void
    {
        TenantContext::setById($this->testTenantId);
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'preferred_language' => 'en',
        ]);
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'name' => 'Repair Circle',
            'visibility' => 'public',
        ]);

        TenantContext::setById($this->testTenantId);
        (new GroupNotificationService())->notifyJoined($group->id, $member->id);

        $expectedLink = "/groups/{$group->id}";
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'type' => 'group_join',
            'link' => $expectedLink,
        ]);
        $this->assertSame(0, DB::table('notifications')
            ->where('user_id', $member->id)
            ->where('tenant_id', '!=', $this->testTenantId)
            ->count());
    }

    public function test_muted_group_suppresses_bell_email_queue_and_push_fanout(): void
    {
        TenantContext::setById($this->testTenantId);
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $group = Group::factory()->forTenant($this->testTenantId)->create(['owner_id' => $owner->id]);
        // Factory observers dispatch synchronous search jobs in tests, and the
        // queue hygiene hook deliberately clears tenant state after each job.
        TenantContext::setById($this->testTenantId);
        GroupNotificationPreferenceService::set($member->id, $group->id, [
            'frequency' => 'muted',
            'email_enabled' => true,
            'push_enabled' => true,
        ]);

        (new GroupNotificationService())->notifyJoined($group->id, $member->id);

        self::assertSame(0, DB::table('notifications')->where('user_id', $member->id)->count());
        self::assertSame(0, DB::table('notification_queue')->where('user_id', $member->id)->count());
        self::assertSame(0, DB::table('push_log')->where('user_id', $member->id)->count());
    }

    public function test_digest_and_email_channel_preferences_drive_the_delivery_queue(): void
    {
        TenantContext::setById($this->testTenantId);
        $author = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $author->id,
            'name' => 'Digest Circle',
        ]);
        $this->insertMembership($group->id, $member->id);
        // Restore the request tenant after factory observers' synchronous jobs.
        TenantContext::setById($this->testTenantId);
        GroupNotificationPreferenceService::set($member->id, $group->id, [
            'frequency' => 'digest',
            'email_enabled' => true,
            'push_enabled' => false,
        ]);

        (new GroupNotificationService())->notifyNewDiscussion($group->id, 77, $author->id, 'Weekly plans');

        $expectedLink = "/groups/{$group->id}?tab=discussion";
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'type' => 'new_topic',
            'link' => $expectedLink,
        ]);
        $this->assertDatabaseHas('notification_queue', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'activity_type' => 'new_topic',
            'frequency' => 'daily',
            'link' => $expectedLink,
            'status' => 'pending',
        ]);
        self::assertNull(DB::table('notification_queue')
            ->where('user_id', $member->id)
            ->value('email_body'));
        self::assertSame(1, app(NotificationService::class)->getCounts($member->id)['groups']);
    }

    public function test_email_disabled_keeps_the_bell_without_queueing_email(): void
    {
        TenantContext::setById($this->testTenantId);
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $group = Group::factory()->forTenant($this->testTenantId)->create(['owner_id' => $owner->id]);
        // Restore the request tenant after factory observers' synchronous jobs.
        TenantContext::setById($this->testTenantId);
        GroupNotificationPreferenceService::set($member->id, $group->id, [
            'frequency' => 'instant',
            'email_enabled' => false,
            'push_enabled' => false,
        ]);

        (new GroupNotificationService())->notifyJoined($group->id, $member->id);

        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'type' => 'group_join',
        ]);
        self::assertSame(0, DB::table('notification_queue')->where('user_id', $member->id)->count());
    }

    public function test_recipient_locale_and_absolute_email_cta_use_the_tenant_canonical_route(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => null,
            'slug' => 'notification-contract',
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $author = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create(['preferred_language' => 'de']);
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $author->id,
            'name' => 'Repair Circle',
        ]);
        $this->insertMembership($group->id, $member->id);
        // Restore the request tenant after factory observers' synchronous jobs.
        TenantContext::setById($this->testTenantId);
        GroupNotificationPreferenceService::set($member->id, $group->id, [
            'frequency' => 'instant',
            'email_enabled' => true,
            'push_enabled' => false,
        ]);

        (new GroupNotificationService())->notifyNewAnnouncement($group->id, $author->id, 'Werkzeugabend');

        $relative = "/groups/{$group->id}?tab=announcements";
        $absolute = rtrim(TenantContext::getFrontendUrl(), '/')
            . '/notification-contract'
            . $relative;
        $expectedMessage = LocaleContext::withLocale('de', fn (): string => __('notifications.group_new_announcement', [
            'author' => trim($author->first_name . ' ' . $author->last_name),
            'title' => 'Werkzeugabend',
            'group' => 'Repair Circle',
        ]));
        $notification = DB::table('notifications')->where('user_id', $member->id)->first();
        self::assertNotNull($notification);
        self::assertSame($relative, $notification->link);
        self::assertSame($expectedMessage, $notification->message);

        $queued = DB::table('notification_queue')->where('user_id', $member->id)->first();
        self::assertNotNull($queued);
        self::assertSame('instant', $queued->frequency);
        self::assertStringContainsString(
            $absolute,
            (string) $queued->email_body,
        );
    }

    /**
     * A block (either direction) between the author and a member stops the
     * member's personal discussion/announcement notification. The post itself
     * stays in the shared group: blocking is not a group ban.
     */
    public function test_discussion_and_announcement_notifications_skip_blocked_pairs(): void
    {
        TenantContext::setById($this->testTenantId);
        $author = User::factory()->forTenant($this->testTenantId)->create();
        $blocker = User::factory()->forTenant($this->testTenantId)->create();
        $blockedByAuthor = User::factory()->forTenant($this->testTenantId)->create();
        $bystander = User::factory()->forTenant($this->testTenantId)->create();
        $group = Group::factory()->forTenant($this->testTenantId)->create(['owner_id' => $author->id]);
        foreach ([$blocker, $blockedByAuthor, $bystander] as $member) {
            $this->insertMembership($group->id, $member->id);
        }
        TenantContext::setById($this->testTenantId);
        DB::table('user_blocks')->insert([
            ['tenant_id' => $this->testTenantId, 'user_id' => $blocker->id, 'blocked_user_id' => $author->id, 'created_at' => now()],
            ['tenant_id' => $this->testTenantId, 'user_id' => $author->id, 'blocked_user_id' => $blockedByAuthor->id, 'created_at' => now()],
        ]);

        $service = new GroupNotificationService();
        $service->notifyNewDiscussion($group->id, 88, $author->id, 'Spring plans');
        $service->notifyNewAnnouncement($group->id, $author->id, 'Hall closed');

        foreach ([$blocker, $blockedByAuthor] as $excluded) {
            self::assertSame(0, DB::table('notifications')->where('user_id', $excluded->id)->count(), 'blocked pair notified');
            self::assertSame(0, DB::table('notification_queue')->where('user_id', $excluded->id)->count(), 'blocked pair queued');
        }
        self::assertSame(2, DB::table('notifications')->where('user_id', $bystander->id)->count());
    }

    private function insertMembership(int $groupId, int $userId): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $userId,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
