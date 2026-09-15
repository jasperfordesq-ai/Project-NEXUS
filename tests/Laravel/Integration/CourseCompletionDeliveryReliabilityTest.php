<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\CourseEnrollment;
use App\Services\CourseCompletionDeliveryService;
use App\Services\EmailDispatchService;
use App\Services\CourseProgressService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class CourseCompletionDeliveryReliabilityTest extends TestCase
{
    public function test_scheduled_delivery_repairs_a_failed_completion_and_replays_remain_idempotent(): void
    {
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        $tenantId = $this->testTenantId;
        $suffix = bin2hex(random_bytes(6));
        $trigger = 'test_course_cert_fail_' . substr($suffix, 0, 12);

        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Course completion learner ' . $suffix,
            'email' => 'course-completion-' . $suffix . '@example.test',
            'password_hash' => password_hash($suffix, PASSWORD_BCRYPT),
            'balance' => 0,
            'role' => 'member',
            'status' => 'active',
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $courseId = (int) DB::table('courses')->insertGetId([
            'tenant_id' => $tenantId,
            'author_user_id' => $userId,
            'title' => 'Completion reliability ' . $suffix,
            'slug' => 'completion-reliability-' . $suffix,
            'status' => 'published',
            'moderation_status' => 'approved',
            'level' => 'beginner',
            'visibility' => 'public',
            'enrollment_type' => 'self_paced',
            'enrollment_count' => 1,
            'completion_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $lessonId = (int) DB::table('course_lessons')->insertGetId([
            'tenant_id' => $tenantId,
            'course_id' => $courseId,
            'title' => 'Completion reliability lesson',
            'content_type' => 'text',
            'position' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $enrollmentId = (int) DB::table('course_enrollments')->insertGetId([
            'tenant_id' => $tenantId,
            'course_id' => $courseId,
            'user_id' => $userId,
            'status' => 'active',
            'progress_percent' => 0,
            'credits_paid' => 0,
            'credits_earned' => 0,
            'enrolled_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $email = new class extends EmailDispatchService {
            public int $calls = 0;

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls++;
                DB::table('email_log')->insert([
                    'tenant_id' => $options['tenant_id'] ?? null,
                    'user_id' => DB::table('users')->where('email', $to)->value('id'),
                    'recipient_email' => $to,
                    'category' => $options['category'] ?? null,
                    'source' => $options['source'] ?? null,
                    'idempotency_key' => $options['idempotency_key'] ?? null,
                    'dispatch_id' => $options['dispatch_id'] ?? null,
                    'subject' => $subject,
                    'provider' => 'smtp',
                    'status' => 'sent',
                    'sent_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $email);

        try {
            DB::unprepared(
                "CREATE TRIGGER `{$trigger}` BEFORE INSERT ON `course_certificates` FOR EACH ROW "
                . "BEGIN IF NEW.course_id = {$courseId} THEN "
                . "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced_course_certificate_failure'; "
                . 'END IF; END'
            );

            TenantContext::reset();
            TenantContext::setById($tenantId);
            $first = CourseProgressService::completeLesson(
                CourseEnrollment::findOrFail($enrollmentId),
                $lessonId,
                $userId,
                100,
            );
            self::assertTrue($first['course_completed']);
            self::assertSame('completed', DB::table('course_enrollments')->where('id', $enrollmentId)->value('status'));
            self::assertSame(1, (int) DB::table('courses')->where('id', $courseId)->value('completion_count'));
            self::assertSame(0, DB::table('course_certificates')->where('course_id', $courseId)->where('user_id', $userId)->count());

            $failedOutbox = DB::table('course_completion_delivery_outbox')
                ->where('tenant_id', $tenantId)
                ->where('enrollment_id', $enrollmentId)
                ->first();
            self::assertNotNull($failedOutbox);
            self::assertSame(1, (int) $failedOutbox->attempts);
            self::assertNull($failedOutbox->completed_at);
            self::assertNull($failedOutbox->dead_lettered_at);
            self::assertNotNull($failedOutbox->next_attempt_at);
            self::assertStringContainsString('forced_course_certificate_failure', (string) $failedOutbox->last_error);

            DB::unprepared("DROP TRIGGER IF EXISTS `{$trigger}`");

            DB::table('course_completion_delivery_outbox')
                ->where('id', $failedOutbox->id)
                ->update(['next_attempt_at' => now()->subMinute()]);
            $summary = app(CourseCompletionDeliveryService::class)->processBatch(10);
            $scheduledOutbox = DB::table('course_completion_delivery_outbox')->where('id', $failedOutbox->id)->first();
            self::assertSame(
                ['claimed' => 1, 'completed' => 1, 'retried' => 0, 'dead_lettered' => 0],
                $summary,
                (string) ($scheduledOutbox->last_error ?? ''),
            );

            $completedOutbox = $scheduledOutbox;
            self::assertNotNull($completedOutbox->completed_at);
            self::assertSame(2, (int) $completedOutbox->attempts);
            self::assertNull($completedOutbox->next_attempt_at);
            self::assertNull($completedOutbox->last_error);

            $idempotencyKey = "course-completed:{$tenantId}:{$courseId}:{$userId}";
            $xpReference = "course-completion:{$enrollmentId}";
            self::assertSame(1, DB::table('course_certificates')->where('course_id', $courseId)->where('user_id', $userId)->count());
            self::assertSame(1, DB::table('notifications')->where('tenant_id', $tenantId)->where('user_id', $userId)->where('idempotency_key', $idempotencyKey)->count());
            self::assertSame(1, DB::table('email_log')->where('tenant_id', $tenantId)->where('idempotency_key', $idempotencyKey)->whereIn('status', ['sent', 'delivered'])->count());
            self::assertSame(1, DB::table('user_xp_log')->where('tenant_id', $tenantId)->where('user_id', $userId)->where('action', 'course.completed')->where('source_reference', $xpReference)->count());
            self::assertSame(1, $email->calls);

            $replay = CourseProgressService::completeLesson(
                CourseEnrollment::findOrFail($enrollmentId),
                $lessonId,
                $userId,
                100,
            );
            self::assertFalse($replay['course_completed']);
            self::assertSame(1, (int) DB::table('courses')->where('id', $courseId)->value('completion_count'));
            self::assertSame(1, DB::table('course_certificates')->where('course_id', $courseId)->where('user_id', $userId)->count());
            self::assertSame(1, DB::table('notifications')->where('tenant_id', $tenantId)->where('user_id', $userId)->where('idempotency_key', $idempotencyKey)->count());
            self::assertSame(1, DB::table('email_log')->where('tenant_id', $tenantId)->where('idempotency_key', $idempotencyKey)->whereIn('status', ['sent', 'delivered'])->count());
            self::assertSame(1, DB::table('user_xp_log')->where('tenant_id', $tenantId)->where('user_id', $userId)->where('action', 'course.completed')->where('source_reference', $xpReference)->count());
            self::assertSame(2, (int) DB::table('course_completion_delivery_outbox')->where('id', $failedOutbox->id)->value('attempts'));
            self::assertSame(1, $email->calls);
        } finally {
            DB::unprepared("DROP TRIGGER IF EXISTS `{$trigger}`");
            DB::table('course_certificates')->where('course_id', $courseId)->where('user_id', $userId)->delete();
            DB::table('notifications')->where('user_id', $userId)->delete();
            DB::table('email_log')->where('tenant_id', $tenantId)->where('user_id', $userId)->delete();
            DB::table('user_badges')->where('user_id', $userId)->delete();
            DB::table('user_xp_log')->where('user_id', $userId)->delete();
            DB::table('course_lesson_progress')->where('enrollment_id', $enrollmentId)->delete();
            DB::table('course_enrollments')->where('id', $enrollmentId)->delete();
            DB::table('course_lessons')->where('id', $lessonId)->delete();
            DB::table('courses')->where('id', $courseId)->delete();
            DB::table('users')->where('id', $userId)->delete();
        }
    }
}
