<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\CourseNotificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * CourseNotificationServiceTest
 *
 * Verifies that CourseNotificationService writes in-app notification rows
 * to the `notifications` table for the enrolled() and completed() events.
 *
 * External side-effects that are out of scope here:
 *  - Pusher / FCM device push (fanOutPush) — fire-and-forget; may fail if
 *    PUSHER_APP_ID is not set in the test env; this is expected and harmless.
 *  - SendGrid / email (EmailDispatchService::sendRaw) — MAIL_DRIVER is set
 *    to 'array' in .env.testing so nothing hits the wire.
 *
 * All fixtures use a private high-range tenant (99403) to avoid collision.
 */
class CourseNotificationServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99403;

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('tenants')->insertOrIgnore([
            'id'                => self::TENANT_ID,
            'name'              => 'Notif Test Tenant',
            'slug'              => 'test-99403',
            'is_active'         => true,
            'depth'             => 0,
            'allows_subtenants' => false,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        TenantContext::setById(self::TENANT_ID);

        // Suppress outbound HTTP so Pusher / FCM calls don't fail the test.
        Http::fake([]);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function insertUser(bool $withEmail = true): int
    {
        $uid = uniqid('notif', true);
        return DB::table('users')->insertGetId([
            'tenant_id'          => self::TENANT_ID,
            'name'               => 'Notif User ' . $uid,
            'first_name'         => 'Notif',
            'last_name'          => 'User',
            'email'              => $withEmail ? $uid . '@notif.test' : null,
            'status'             => 'active',
            'balance'            => 0,
            'role'               => 'member',
            'is_approved'        => 1,
            'preferred_language' => 'en',
            'created_at'         => now(),
            'updated_at'         => now(),
        ]);
    }

    private function insertCourse(int $authorId, string $title = 'Test Course'): int
    {
        return DB::table('courses')->insertGetId([
            'tenant_id'        => self::TENANT_ID,
            'author_user_id'   => $authorId,
            'title'            => $title,
            'slug'             => 'notif-course-' . uniqid(),
            'status'           => 'published',
            'moderation_status'=> 'approved',
            'level'            => 'beginner',
            'visibility'       => 'members',
            'enrollment_type'  => 'self_paced',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);
    }

    /**
     * Count in-app notification rows for a given user + type created since the
     * start of the test.  Uses `id >=` on the insertGetId baseline.
     */
    private function notificationCount(int $userId, string $type): int
    {
        return DB::table('notifications')
            ->where('user_id', $userId)
            ->where('type', $type)
            ->whereNull('deleted_at')
            ->count();
    }

    // ── enrolled() ───────────────────────────────────────────────────────────

    public function test_enrolled_creates_in_app_notification_row(): void
    {
        $authorId = $this->insertUser();
        $userId   = $this->insertUser();
        $courseId = $this->insertCourse($authorId, 'Timebanking 101');

        CourseNotificationService::enrolled($courseId, $userId);

        $count = $this->notificationCount($userId, 'course');
        $this->assertGreaterThanOrEqual(1, $count, 'enrolled() must create at least one notification row');
    }

    public function test_enrolled_notification_contains_course_title(): void
    {
        $authorId = $this->insertUser();
        $userId   = $this->insertUser();
        $courseId = $this->insertCourse($authorId, 'Community Skills');

        CourseNotificationService::enrolled($courseId, $userId);

        $notification = DB::table('notifications')
            ->where('user_id', $userId)
            ->where('type', 'course')
            ->whereNull('deleted_at')
            ->orderBy('id', 'desc')
            ->first();

        $this->assertNotNull($notification);
        $this->assertStringContainsString('Community Skills', $notification->message);
    }

    public function test_enrolled_notification_is_unread_by_default(): void
    {
        $authorId = $this->insertUser();
        $userId   = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        CourseNotificationService::enrolled($courseId, $userId);

        $notification = DB::table('notifications')
            ->where('user_id', $userId)
            ->where('type', 'course')
            ->whereNull('deleted_at')
            ->orderBy('id', 'desc')
            ->first();

        $this->assertNotNull($notification);
        $this->assertEquals(0, $notification->is_read);
    }

    public function test_enrolled_does_nothing_when_course_does_not_exist(): void
    {
        $userId = $this->insertUser();

        // Should not throw — failure is swallowed with a Log::warning.
        CourseNotificationService::enrolled(999999999, $userId);

        $count = $this->notificationCount($userId, 'course');
        $this->assertSame(0, $count);
    }

    public function test_enrolled_does_nothing_when_user_does_not_exist(): void
    {
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        // Should not throw — failure is swallowed with a Log::warning.
        CourseNotificationService::enrolled($courseId, 999999999);

        // No notification for the nonexistent user.
        $count = DB::table('notifications')
            ->where('user_id', 999999999)
            ->where('type', 'course')
            ->count();
        $this->assertSame(0, $count);
    }

    // ── completed() ──────────────────────────────────────────────────────────

    public function test_completed_creates_in_app_notification_row(): void
    {
        $authorId = $this->insertUser();
        $userId   = $this->insertUser();
        $courseId = $this->insertCourse($authorId, 'Advanced Exchanges');

        CourseNotificationService::completed($courseId, $userId);

        $count = $this->notificationCount($userId, 'course');
        $this->assertGreaterThanOrEqual(1, $count, 'completed() must create at least one notification row');
    }

    public function test_completed_notification_contains_course_title(): void
    {
        $authorId = $this->insertUser();
        $userId   = $this->insertUser();
        $courseId = $this->insertCourse($authorId, 'Deep Dive Timebanking');

        CourseNotificationService::completed($courseId, $userId);

        $notification = DB::table('notifications')
            ->where('user_id', $userId)
            ->where('type', 'course')
            ->whereNull('deleted_at')
            ->orderBy('id', 'desc')
            ->first();

        $this->assertNotNull($notification);
        $this->assertStringContainsString('Deep Dive Timebanking', $notification->message);
    }

    public function test_completed_does_nothing_when_course_does_not_exist(): void
    {
        $userId = $this->insertUser();

        CourseNotificationService::completed(999999999, $userId);

        $count = $this->notificationCount($userId, 'course');
        $this->assertSame(0, $count);
    }

    public function test_completed_does_nothing_when_user_does_not_exist(): void
    {
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        CourseNotificationService::completed($courseId, 999999999);

        $count = DB::table('notifications')
            ->where('user_id', 999999999)
            ->where('type', 'course')
            ->count();
        $this->assertSame(0, $count);
    }

    public function test_enrolled_creates_notification_with_type_course(): void
    {
        $authorId = $this->insertUser();
        $userId   = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        CourseNotificationService::enrolled($courseId, $userId);

        $notification = DB::table('notifications')
            ->where('user_id', $userId)
            ->whereNull('deleted_at')
            ->orderBy('id', 'desc')
            ->first();

        $this->assertNotNull($notification);
        $this->assertSame('course', $notification->type);
    }

    public function test_completed_creates_notification_with_type_course(): void
    {
        $authorId = $this->insertUser();
        $userId   = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        CourseNotificationService::completed($courseId, $userId);

        $notification = DB::table('notifications')
            ->where('user_id', $userId)
            ->whereNull('deleted_at')
            ->orderBy('id', 'desc')
            ->first();

        $this->assertNotNull($notification);
        $this->assertSame('course', $notification->type);
    }

    public function test_enrolled_and_completed_each_produce_separate_notification_rows(): void
    {
        $authorId = $this->insertUser();
        $userId   = $this->insertUser();
        $courseId = $this->insertCourse($authorId, 'Full Journey Course');

        CourseNotificationService::enrolled($courseId, $userId);
        CourseNotificationService::completed($courseId, $userId);

        $count = $this->notificationCount($userId, 'course');
        $this->assertGreaterThanOrEqual(2, $count, 'Each event must produce its own notification row');
    }

    /**
     * The bell and the phone push must carry the same site-relative link every other
     * producer stores (`/messages/5`, `/events/44`). An absolute URL with the community's
     * host was downgraded to `/notifications` by the native push sanitiser on any
     * custom-domain community, and the web dropdown would prefix it with the slug again
     * (push audit, 2026-10-18).
     */
    public function test_enrolled_stores_a_relative_course_link(): void
    {
        $authorId = $this->insertUser();
        $userId   = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $slug     = DB::table('courses')->where('id', $courseId)->value('slug');

        CourseNotificationService::enrolled($courseId, $userId);

        $link = DB::table('notifications')
            ->where('user_id', $userId)->where('type', 'course')
            ->orderByDesc('id')->value('link');
        $this->assertSame('/courses/' . $slug, $link);
    }

    public function test_completed_stores_a_relative_course_link(): void
    {
        $authorId = $this->insertUser();
        $userId   = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $slug     = DB::table('courses')->where('id', $courseId)->value('slug');

        CourseNotificationService::completed($courseId, $userId);

        $link = DB::table('notifications')
            ->where('user_id', $userId)->where('type', 'course')
            ->orderByDesc('id')->value('link');
        $this->assertSame('/courses/' . $slug, $link);
    }
}
