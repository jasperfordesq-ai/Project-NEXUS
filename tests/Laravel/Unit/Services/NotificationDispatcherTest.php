<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\NotificationDispatcher;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Unit coverage for NotificationDispatcher::dispatch().
 *
 * dispatch() now resolves the recipient tenant, runs inside that tenant via
 * TenantContext::runForTenant(), creates the in-app "bell", consults the email
 * frequency hierarchy, fans out a device push, and only then conditionally
 * enqueues an email. We isolate the genuine side effects:
 *
 *  - Notification::createNotification() — the bell — is alias-mocked so no row
 *    is written and we can assert it always fires.
 *  - WebPushService / FCMPushService / PushLog — the device-push fan-out — are
 *    alias-mocked to no-ops (new_topic is a curated push type, so fanOutPush()
 *    always reaches them).
 *  - The real nexus_ci2 DB serves the tenants / users / notification_settings
 *    lookups; the email-queue insert is observed against the real
 *    notification_queue table inside a rolled-back transaction.
 *
 * Notification and the push services are concrete classes with static methods,
 * so each test runs in a separate process with `alias:` mocks — without process
 * isolation the alias would leak the real class definition into the rest of the
 * suite.
 */
class NotificationDispatcherTest extends TestCase
{
    private int $userId;

    protected function setUp(): void
    {
        parent::setUp();
        // Email-queue inserts hit the real table and notification_queue.user_id
        // has a FK to users(id); roll everything back per test.
        DB::beginTransaction();

        // Seed a real recipient in tenant 2. The User observer can reset the
        // TenantContext to tenant 1, so re-pin tenant 2 afterwards.
        $this->userId = (int) User::factory()->create(['tenant_id' => $this->testTenantId])->id;
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        DB::rollBack();
        parent::tearDown();
    }

    /**
     * Stub the device-push fan-out collaborators so dispatch() has no real
     * outbound side effects. new_topic resolves a curated push title, so
     * fanOutPush() always reaches these for the cases under test.
     */
    private function stubPushServices(): void
    {
        $web = Mockery::mock('alias:App\Services\WebPushService');
        $web->shouldReceive('sendToUserStatic')->andReturn(true)->byDefault();

        $fcm = Mockery::mock('alias:App\Services\FCMPushService');
        $fcm->shouldReceive('sendToUser')->andReturn(['sent' => 0, 'failed' => 0, 'errors' => []])->byDefault();

        $log = Mockery::mock('alias:App\Models\PushLog');
        $log->shouldReceive('record')->andReturnNull()->byDefault();
    }

    private function queueCountForUser(): int
    {
        return (int) DB::table('notification_queue')
            ->where('user_id', $this->userId)
            ->count();
    }

    /**
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_push_fanout_emits_the_versioned_actionable_mobile_contract(): void
    {
        $web = Mockery::mock('alias:App\Services\WebPushService');
        $web->shouldReceive('sendToUserStatic')
            ->once()
            ->with($this->userId, 'New Post', 'Private post content', '/groups/44');

        $fcm = Mockery::mock('alias:App\Services\FCMPushService');
        $fcm->shouldReceive('sendToUser')
            ->once()
            ->with($this->userId, 'New Post', 'Private post content', [
                'schema_version' => '1',
                'type' => 'new_topic',
                'link' => '/groups/44',
                'display_title_safe' => '1',
            ])
            ->andReturn(['sent' => 1, 'failed' => 0, 'errors' => []]);

        $log = Mockery::mock('alias:App\Models\PushLog');
        $log->shouldReceive('record')->once()->andReturnNull();

        NotificationDispatcher::fanOutPush(
            $this->userId,
            'new_topic',
            'Private post content',
            '/groups/44',
        );

        $this->addToAssertionCount(1);
    }

    public function test_explicit_pushes_get_translated_category_titles_instead_of_new_notification(): void
    {
        $method = new \ReflectionMethod(NotificationDispatcher::class, 'resolvePushTitle');
        $method->setAccessible(true);

        $this->assertSame('Credits', $method->invoke(null, 'transaction', false));
        $this->assertSame('Event', $method->invoke(null, 'event_update', false));
        $this->assertSame('Activity', $method->invoke(null, 'like', false));
        $this->assertSame('Opportunity', $method->invoke(null, 'job_application_status', false));
        $this->assertSame('Security', $method->invoke(null, 'passkey_removed', false));
        $this->assertSame('New Message', $method->invoke(null, 'new_message', false));
    }

    public function test_automatic_pushes_still_require_an_explicitly_curated_type(): void
    {
        $method = new \ReflectionMethod(NotificationDispatcher::class, 'resolvePushTitle');
        $method->setAccessible(true);

        $this->assertNull($method->invoke(null, 'event_update', true));
        $this->assertSame('New Message', $method->invoke(null, 'new_message', true));
    }

    /**
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_dispatch_always_creates_in_app_notification(): void
    {
        $this->stubPushServices();

        // The bell notification must always be created with the dispatch args.
        $notification = Mockery::mock('alias:App\Models\Notification');
        $notification->shouldReceive('createNotification')
            ->once()
            ->with($this->userId, 'Test message', '/test', 'new_topic')
            ->andReturn(123);

        $result = NotificationDispatcher::dispatch(
            $this->userId, 'global', null, 'new_topic', 'Test message', '/test', '<p>Test</p>'
        );

        $this->assertTrue($result);
    }

    /**
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_dispatch_off_frequency_skips_email(): void
    {
        $this->stubPushServices();

        $notification = Mockery::mock('alias:App\Models\Notification');
        $notification->shouldReceive('createNotification')->once()->andReturn(123);

        // No notification_settings row exists for this user → the global default
        // frequency is 'off' for a non-organizer new_reply, so nothing is queued.
        $before = $this->queueCountForUser();

        $result = NotificationDispatcher::dispatch(
            $this->userId, 'global', null, 'new_reply', 'Reply msg', '/reply', null
        );

        $this->assertTrue($result);
        $this->assertSame($before, $this->queueCountForUser(), 'off frequency must not enqueue an email');
    }

    /**
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_dispatch_organizer_rule_defaults_to_instant(): void
    {
        $this->stubPushServices();

        $notification = Mockery::mock('alias:App\Models\Notification');
        $notification->shouldReceive('createNotification')->once()->andReturn(123);

        // The organizer rule only applies when getFrequencySetting() returns
        // null. The 'global' context never returns null (it falls back to the
        // tenant default of 'off'); a 'thread' context with no per-thread/group
        // setting DOES return null, so an organizer's new_topic there is forced
        // to 'instant' and enqueues exactly one email. contextId 999999999 has
        // no group_discussions parent, so the group fallback is skipped.
        $before = $this->queueCountForUser();

        $result = NotificationDispatcher::dispatch(
            $this->userId, 'thread', 999999999, 'new_topic', 'Organizer msg', '/topic', '<p>HTML</p>', true
        );

        $this->assertTrue($result);
        $this->assertSame($before + 1, $this->queueCountForUser(), 'organizer new_topic must enqueue exactly one instant email');
    }

    /**
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_explicit_muted_policy_suppresses_every_channel(): void
    {
        $notification = Mockery::mock('alias:App\Models\Notification');
        $notification->shouldNotReceive('createNotification');
        $before = $this->queueCountForUser();

        $result = NotificationDispatcher::dispatch(
            $this->userId,
            'group',
            10,
            'new_topic',
            'Muted message',
            '/group',
            '<p>Muted</p>',
            false,
            null,
            ['frequency' => 'muted', 'email_enabled' => true, 'push_enabled' => true],
        );

        $this->assertTrue($result);
        $this->assertSame($before, $this->queueCountForUser());
    }

    /**
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_digest_policy_queues_daily_email_while_push_is_disabled(): void
    {
        $notification = Mockery::mock('alias:App\Models\Notification');
        $notification->shouldReceive('createNotification')->once()->andReturn(123);
        $before = $this->queueCountForUser();

        $result = NotificationDispatcher::dispatch(
            $this->userId,
            'group',
            10,
            'new_topic',
            'Digest message',
            '/group',
            '<p>Digest</p>',
            false,
            null,
            ['frequency' => 'digest', 'email_enabled' => true, 'push_enabled' => false],
        );

        $this->assertTrue($result);
        $this->assertSame($before + 1, $this->queueCountForUser());
        $this->assertDatabaseHas('notification_queue', [
            'user_id' => $this->userId,
            'frequency' => 'daily',
            'activity_type' => 'new_topic',
        ]);
    }
}
