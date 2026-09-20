<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\CourseLessonService;
use App\Services\CourseSectionService;
use App\Services\CourseService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class CourseSectionLessonConcurrencyTest extends TestCase
{
    /** @dataProvider operations */
    public function test_section_delete_preserves_a_concurrent_lesson_write(string $operation): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) self::markTestSkipped($function . ' required');
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        $tenantId = $this->testTenantId;
        $suffix = bin2hex(random_bytes(8));
        $userId = DB::table('users')->insertGetId([
            'tenant_id' => $tenantId, 'name' => 'Curriculum race fixture', 'email' => $suffix . '@example.test',
            'balance' => 0, 'role' => 'member', 'status' => 'active', 'is_approved' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $courseId = CourseService::create($userId, ['title' => 'Curriculum race ' . $suffix])->id;
        $sectionId = CourseSectionService::create($courseId, ['title' => 'Temporary section'])->id;
        $lessonId = $operation === 'assign' ? CourseLessonService::create($courseId, ['title' => 'Preserved lesson'])->id : null;
        $workers = [];
        try {
            DB::purge();
            foreach (['writer', 'deleter'] as $role) {
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
                        $held = false;
                        DB::connection()->beforeExecuting(function (string $query) use ($role, &$held, $sockets): void {
                            $sql = strtolower($query);
                            $lessonWrite = str_starts_with($sql, 'insert into `course_lessons`') || str_starts_with($sql, 'update `course_lessons`');
                            if (!$held && $role === 'writer' && $lessonWrite) {
                                $held = true;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') throw new \RuntimeException('Writer barrier timed out');
                            }
                            if (!$held && $role === 'deleter' && str_contains($sql, 'from `courses`') && str_contains($sql, 'for update')) {
                                $held = true;
                                fwrite($sockets[1], "ready\n");
                            }
                        });
                        if ($role === 'writer') {
                            $lesson = $operation === 'create'
                                ? CourseLessonService::create($courseId, ['title' => 'Preserved lesson', 'section_id' => $sectionId])
                                : CourseLessonService::update($lessonId, ['section_id' => $sectionId]);
                            $result = ['id' => $lesson->id];
                        } else {
                            $result = ['deleted' => CourseSectionService::delete($sectionId)];
                        }
                        fwrite($sockets[1], json_encode($result) . "\n");
                        fclose($sockets[1]);
                        exit(0);
                    } catch (\Throwable $error) {
                        fwrite($sockets[1], json_encode(['error' => $error->getMessage()]) . "\n");
                        exit(1);
                    }
                }
                fclose($sockets[1]);
                stream_set_timeout($sockets[0], 15);
                $workers[$role] = ['pid' => $pid, 'socket' => $sockets[0]];
                self::assertSame('ready', trim((string) fgets($sockets[0])));
            }
            // Allow an unprotected deletion to finish while the validated write is held.
            // The final persisted relationship, not elapsed time, determines success.
            $read = [$workers['deleter']['socket']]; $write = null; $except = null;
            stream_select($read, $write, $except, 0, 500000);
            fwrite($workers['writer']['socket'], "go\n");
            $results = [];
            foreach ($workers as $role => $worker) {
                $result = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($result);
                self::assertArrayNotHasKey('error', $result, json_encode($result));
                $results[$role] = $result;
            }
            self::assertTrue($results['deleter']['deleted']);
            DB::reconnect();
            self::assertNull(DB::table('course_sections')->where('id', $sectionId)->first());
            $lesson = DB::table('course_lessons')->where('id', $results['writer']['id'])->first();
            self::assertNotNull($lesson);
            self::assertNull($lesson->section_id, 'A concurrent write must not reference a deleted section');
        } finally {
            foreach ($workers as $worker) {
                if (pcntl_waitpid($worker['pid'], $status, WNOHANG) === 0) {
                    posix_kill($worker['pid'], 9);
                    pcntl_waitpid($worker['pid'], $status);
                }
                fclose($worker['socket']);
            }
            DB::purge(); DB::reconnect();
            DB::table('course_lessons')->where('course_id', $courseId)->delete();
            DB::table('course_sections')->where('course_id', $courseId)->delete();
            DB::table('courses')->where('id', $courseId)->delete();
            DB::table('users')->where('id', $userId)->delete();
        }
    }

    public static function operations(): array
    {
        return [['create'], ['assign']];
    }
}
