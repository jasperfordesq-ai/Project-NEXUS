<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\JobApplication;
use App\Models\JobVacancy;
use App\Models\User;
use App\Services\JobVacancyService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

final class JobApplicationDecisionConcurrencyTest extends TestCase
{
    public function test_conflicting_owner_decisions_have_one_winner_and_exact_replay_has_one_effect(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) self::markTestSkipped("{$function} is required for concurrent job-decision verification.");
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        Mail::fake();
        Http::fake();
        Queue::fake();
        $tenantId = $this->testTenantId;
        TenantContext::setById($tenantId);
        $owner = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true]);
        $applicant = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true]);
        $vacancy = JobVacancy::factory()->create([
            'tenant_id' => $tenantId,
            'user_id' => $owner->id,
            'status' => 'open',
            'moderation_status' => 'approved',
        ]);
        $application = JobApplication::factory()->create([
            'tenant_id' => $tenantId,
            'vacancy_id' => $vacancy->id,
            'user_id' => $applicant->id,
            'status' => 'pending',
            'stage' => 'pending',
        ]);
        $workers = [];

        try {
            DB::purge();
            foreach (['screening', 'shortlisted'] as $decision) {
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
                            $sql = strtolower($query);
                            if ($waiting && str_contains($sql, 'from `job_vacancies`') && str_contains($sql, 'for update')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') throw new \RuntimeException('Job-decision barrier timed out');
                            }
                        });
                        $service = app(JobVacancyService::class);
                        $result = $service->updateApplicationStatus(
                            (int) $application->id,
                            (int) $owner->id,
                            $decision,
                            null,
                            'pending',
                        );
                        fwrite($sockets[1], json_encode(['result' => $result, 'errors' => $service->getErrors()], JSON_THROW_ON_ERROR) . "\n");
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
                $workers[] = ['pid' => $pid, 'socket' => $sockets[0], 'decision' => $decision];
            }

            foreach ($workers as $worker) self::assertSame('ready', trim((string) fgets($worker['socket'])));
            foreach ($workers as $worker) fwrite($worker['socket'], "go\n");
            $results = [];
            foreach ($workers as $worker) {
                $raw = fgets($worker['socket']);
                $payload = json_decode((string) $raw, true);
                self::assertIsArray($payload, var_export($raw, true));
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                $results[$worker['decision']] = $payload;
            }

            DB::reconnect();
            self::assertSame(1, count(array_filter($results, static fn (array $result): bool => $result['result'] === true)));
            $winner = array_key_first(array_filter($results, static fn (array $result): bool => $result['result'] === true));
            $loser = array_values(array_filter($results, static fn (array $result): bool => $result['result'] === false))[0];
            self::assertSame('DECISION_CONFLICT', $loser['errors'][0]['code'] ?? null);
            self::assertSame($winner, DB::table('job_vacancy_applications')->where('id', $application->id)->value('stage'));
            self::assertSame(1, DB::table('job_application_history')->where('application_id', $application->id)->count());

            TenantContext::reset();
            TenantContext::setById($tenantId);
            $service = app(JobVacancyService::class);
            self::assertTrue($service->updateApplicationStatus((int) $application->id, (int) $owner->id, $winner, null, 'pending'));
            self::assertSame(1, DB::table('job_application_history')->where('application_id', $application->id)->count());
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
            DB::table('notifications')->where('user_id', $applicant->id)->delete();
            DB::table('job_application_history')->where('application_id', $application->id)->delete();
            DB::table('job_vacancy_applications')->where('id', $application->id)->delete();
            DB::table('job_vacancies')->where('id', $vacancy->id)->delete();
            DB::table('users')->whereIn('id', [$owner->id, $applicant->id])->delete();
        }
    }
}
