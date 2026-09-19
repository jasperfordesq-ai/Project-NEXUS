<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\CourseQuiz;
use App\Services\CourseQuizService;
use App\Services\CourseService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class CourseQuizReplayConcurrencyTest extends TestCase
{
    public static function enrollmentPaths(): array
    {
        return ['service without enrollment' => [false], 'enrolled API path' => [true]];
    }

    /** @dataProvider enrollmentPaths */
    public function test_simultaneous_retries_create_one_attempt_even_at_the_limit(bool $withEnrollment): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) self::markTestSkipped("{$function} required for concurrent quiz verification");
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        $tenantId = $this->testTenantId;
        $suffix = bin2hex(random_bytes(8));
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId, 'name' => 'Quiz concurrency fixture',
            'email' => "quiz-concurrency-{$suffix}@example.test", 'balance' => 0,
            'role' => 'member', 'status' => 'active', 'is_approved' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $courseId = (int) CourseService::create($userId, ['title' => "Quiz concurrency {$suffix}"])->id;
        $quizId = (int) CourseQuiz::create(['course_id' => $courseId, 'title' => 'Retry', 'max_attempts' => 1])->id;
        $enrollmentId = $withEnrollment ? (int) DB::table('course_enrollments')->insertGetId([
            'tenant_id' => $tenantId, 'course_id' => $courseId, 'user_id' => $userId,
            'status' => 'active', 'enrolled_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]) : null;
        $workers = [];
        try {
            DB::purge();
            for ($index = 0; $index < 2; $index++) {
                $sockets = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
                self::assertNotFalse($sockets);
                $pid = pcntl_fork();
                self::assertNotSame(-1, $pid);
                if ($pid === 0) {
                    fclose($sockets[0]);
                    stream_set_timeout($sockets[1], 15);
                    try {
                        DB::reconnect();
                        DB::statement('SET SESSION innodb_lock_wait_timeout = 10');
                        TenantContext::reset();
                        TenantContext::setById($tenantId);
                        $waiting = true;
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets, $withEnrollment): void {
                            $sql = strtolower($query);
                            $table = $withEnrollment ? 'from `course_enrollments`' : 'from `course_quizzes`';
                            if ($waiting && str_contains($sql, $table) && str_contains($sql, 'for update')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') throw new \RuntimeException('Quiz barrier timed out');
                            }
                        });
                        $result = CourseQuizService::submitAttempt($quizId, $userId, [], $enrollmentId, 'simultaneous-quiz-retry');
                        fwrite($sockets[1], json_encode(['id' => $result['attempt']->id], JSON_THROW_ON_ERROR) . "\n");
                        fclose($sockets[1]);
                        exit(0);
                    } catch (\Throwable $error) {
                        fwrite($sockets[1], json_encode(['error' => $error->getMessage()]) . "\n");
                        fclose($sockets[1]);
                        exit(1);
                    }
                }
                fclose($sockets[1]);
                stream_set_timeout($sockets[0], 15);
                $workers[] = ['pid' => $pid, 'socket' => $sockets[0]];
            }
            foreach ($workers as $worker) self::assertSame('ready', trim((string) fgets($worker['socket'])));
            foreach ($workers as $worker) fwrite($worker['socket'], "go\n");
            $ids = [];
            foreach ($workers as $worker) {
                $result = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($result);
                self::assertArrayNotHasKey('error', $result, json_encode($result));
                $ids[] = (int) $result['id'];
            }
            self::assertSame($ids[0], $ids[1]);
            DB::reconnect();
            self::assertSame(1, DB::table('course_quiz_attempts')->where('quiz_id', $quizId)->count());
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
            DB::table('course_quiz_attempts')->where('quiz_id', $quizId)->delete();
            DB::table('course_quizzes')->where('id', $quizId)->delete();
            if ($enrollmentId !== null) DB::table('course_enrollments')->where('id', $enrollmentId)->delete();
            DB::table('courses')->where('id', $courseId)->delete();
            DB::table('users')->where('id', $userId)->delete();
        }
    }
}
