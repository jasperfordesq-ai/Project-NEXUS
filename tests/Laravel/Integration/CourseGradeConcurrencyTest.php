<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\CourseQuizService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class CourseGradeConcurrencyTest extends TestCase
{
    public function test_conflicting_instructor_grades_have_one_consistent_winner(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent course-grading verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $tenantId = $this->testTenantId;
        $quizId = (int) DB::table('course_quizzes')->insertGetId([
            'tenant_id' => $tenantId,
            'course_id' => 900000000 + random_int(1, 999999),
            'lesson_id' => null,
            'title' => 'Concurrent grading fixture ' . bin2hex(random_bytes(5)),
            'description' => null,
            'pass_mark_percent' => 50,
            'max_attempts' => 0,
            'time_limit_minutes' => null,
            'shuffle_questions' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $attemptId = (int) DB::table('course_quiz_attempts')->insertGetId([
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'user_id' => 900000000 + random_int(1, 999999),
            'enrollment_id' => null,
            'answers' => '[]',
            'score_percent' => 0,
            'passed' => 0,
            'grading_status' => 'pending_review',
            'graded_by' => null,
            'feedback' => null,
            'submitted_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $grades = [
            ['score' => 88.5, 'passed' => true, 'feedback' => 'Strong answer', 'grader' => 910000001],
            ['score' => 42.0, 'passed' => false, 'feedback' => 'Needs revision', 'grader' => 910000002],
        ];
        $workers = [];

        try {
            DB::purge();
            foreach ($grades as $grade) {
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
                            if ($waiting && str_contains($normalized, 'course_quiz_attempts') && str_contains($normalized, 'for update')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Course-grading barrier timed out');
                                }
                            }
                        });
                        $result = CourseQuizService::gradeAttemptWithOutcome(
                            $attemptId,
                            $grade['score'],
                            $grade['passed'],
                            $grade['feedback'],
                            $grade['grader'],
                        );
                        fwrite($sockets[1], json_encode([
                            'outcome' => $result['outcome'],
                            'score' => (float) $result['attempt']?->score_percent,
                            'passed' => (bool) $result['attempt']?->passed,
                            'feedback' => $result['attempt']?->feedback,
                            'grader' => $result['attempt']?->graded_by,
                        ], JSON_THROW_ON_ERROR) . "\n");
                        fclose($sockets[1]);
                        exit(0);
                    } catch (\Throwable $error) {
                        fwrite($sockets[1], json_encode(['error' => $error->getMessage()]) . "\n");
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

            $results = [];
            foreach ($workers as $worker) {
                $raw = fgets($worker['socket']);
                $payload = json_decode((string) $raw, true);
                self::assertIsArray($payload, 'Worker returned no JSON: ' . var_export($raw, true));
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                $results[] = $payload;
            }

            DB::reconnect();
            $completed = array_values(array_filter($results, static fn (array $result): bool => $result['outcome'] === 'completed'));
            $conflicts = array_values(array_filter($results, static fn (array $result): bool => $result['outcome'] === 'conflict'));
            self::assertCount(1, $completed);
            self::assertCount(1, $conflicts);

            $stored = DB::table('course_quiz_attempts')->where('id', $attemptId)->first();
            self::assertNotNull($stored);
            self::assertSame('graded', $stored->grading_status);
            self::assertEquals($completed[0]['score'], (float) $stored->score_percent);
            self::assertSame($completed[0]['passed'], (bool) $stored->passed);
            self::assertSame($completed[0]['feedback'], $stored->feedback);
            self::assertSame($completed[0]['grader'], (int) $stored->graded_by);

            TenantContext::reset();
            TenantContext::setById($tenantId);
            $replay = CourseQuizService::gradeAttemptWithOutcome(
                $attemptId,
                $completed[0]['score'],
                $completed[0]['passed'],
                $completed[0]['feedback'],
                $completed[0]['grader'],
            );
            self::assertSame('replayed', $replay['outcome']);
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
            DB::table('course_quiz_attempts')->where('id', $attemptId)->delete();
            DB::table('course_quizzes')->where('id', $quizId)->delete();
        }
    }
}
