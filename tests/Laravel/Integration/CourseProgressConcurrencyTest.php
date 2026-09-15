<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\CourseEnrollment;
use App\Services\CourseProgressService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class CourseProgressConcurrencyTest extends TestCase
{
    public function test_simultaneous_first_lesson_completion_converges_on_one_progress_row(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent course-progress verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $tenantId = $this->testTenantId;
        $suffix = bin2hex(random_bytes(6));
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Course progress learner ' . $suffix,
            'email' => 'course-progress-' . $suffix . '@example.test',
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
            'title' => 'Concurrent progress ' . $suffix,
            'slug' => 'concurrent-progress-' . $suffix,
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
        $lessonIds = [];
        foreach ([0, 1] as $position) {
            $lessonIds[] = (int) DB::table('course_lessons')->insertGetId([
                'tenant_id' => $tenantId,
                'course_id' => $courseId,
                'title' => 'Concurrent lesson ' . $position,
                'content_type' => 'text',
                'position' => $position,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
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
        $workers = [];

        try {
            DB::purge();
            for ($workerNumber = 0; $workerNumber < 2; $workerNumber++) {
                $sockets = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
                self::assertNotFalse($sockets);
                $pid = pcntl_fork();
                self::assertNotSame(-1, $pid);
                if ($pid === 0) {
                    fclose($sockets[0]);
                    stream_set_timeout($sockets[1], 30);
                    try {
                        DB::reconnect();
                        DB::statement('SET SESSION innodb_lock_wait_timeout = 10');
                        TenantContext::reset();
                        TenantContext::setById($tenantId);
                        $waiting = true;
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets): void {
                            $normalized = strtolower($query);
                            if ($waiting && str_contains($normalized, 'course_lesson_progress') && str_starts_with(ltrim($normalized), 'select')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Course-progress barrier timed out');
                                }
                            }
                        });
                        $enrollment = CourseEnrollment::findOrFail($enrollmentId);
                        $result = CourseProgressService::completeLesson($enrollment, $lessonIds[0], $userId, 100);
                        fwrite($sockets[1], json_encode([
                            'progress_percent' => $result['progress_percent'],
                            'course_completed' => $result['course_completed'],
                        ], JSON_THROW_ON_ERROR) . "\n");
                        fclose($sockets[1]);
                        exit(0);
                    } catch (\Throwable $error) {
                        fwrite($sockets[1], json_encode([
                            'error' => $error::class . ': ' . $error->getMessage(),
                        ], JSON_THROW_ON_ERROR) . "\n");
                        fclose($sockets[1]);
                        exit(1);
                    }
                }
                fclose($sockets[1]);
                stream_set_timeout($sockets[0], 30);
                $workers[] = ['pid' => $pid, 'socket' => $sockets[0]];
            }

            foreach ($workers as $worker) {
                self::assertSame('ready', trim((string) fgets($worker['socket'])));
            }
            foreach ($workers as $worker) {
                fwrite($worker['socket'], "go\n");
            }

            foreach ($workers as $worker) {
                $raw = fgets($worker['socket']);
                $payload = json_decode((string) $raw, true);
                self::assertIsArray($payload, 'Worker returned no JSON: ' . var_export($raw, true));
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                self::assertEquals(50.0, $payload['progress_percent']);
                self::assertFalse($payload['course_completed']);
            }

            DB::reconnect();
            self::assertSame(1, DB::table('course_lesson_progress')
                ->where('enrollment_id', $enrollmentId)
                ->where('lesson_id', $lessonIds[0])
                ->count());
            self::assertSame(50.0, (float) DB::table('course_enrollments')
                ->where('id', $enrollmentId)
                ->value('progress_percent'));
            self::assertSame('active', DB::table('course_enrollments')->where('id', $enrollmentId)->value('status'));
            self::assertSame(0, (int) DB::table('courses')->where('id', $courseId)->value('completion_count'));
        } finally {
            foreach ($workers as $worker) {
                if (pcntl_waitpid($worker['pid'], $status, WNOHANG) === 0) {
                    posix_kill($worker['pid'], 9);
                    pcntl_waitpid($worker['pid'], $status);
                }
                fclose($worker['socket']);
            }
            DB::purge();
            DB::reconnect();
            DB::table('course_lesson_progress')->where('enrollment_id', $enrollmentId)->delete();
            DB::table('course_enrollments')->where('id', $enrollmentId)->delete();
            DB::table('course_lessons')->whereIn('id', $lessonIds)->delete();
            DB::table('courses')->where('id', $courseId)->delete();
            DB::table('users')->where('id', $userId)->delete();
        }
    }
}
