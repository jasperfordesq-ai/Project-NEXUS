<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\JobInterviewService;
use App\Services\JobOfferService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\Laravel\TestCase;

final class JobCandidateDecisionConcurrencyTest extends TestCase
{
    public function test_conflicting_interview_decisions_have_one_winner(): void
    {
        $fixture = $this->fixture();
        $interviewId = (int) DB::table('job_interviews')->insertGetId([
            'tenant_id' => $fixture['tenant_id'],
            'vacancy_id' => $fixture['vacancy_id'],
            'application_id' => $fixture['application_id'],
            'proposed_by' => $fixture['employer_id'],
            'interview_type' => 'video',
            'scheduled_at' => now()->addWeek(),
            'duration_mins' => 30,
            'status' => 'proposed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            $results = $this->race(
                ['accept-interview', 'decline-interview'],
                'update `job_interviews`',
                fn (string $action): bool => $action === 'accept-interview'
                    ? JobInterviewService::accept($interviewId, $fixture['candidate_id'])
                    : JobInterviewService::decline($interviewId, $fixture['candidate_id']),
                $fixture['tenant_id'],
            );

            self::assertSame(1, count(array_filter($results)));
            $status = DB::table('job_interviews')->where('id', $interviewId)->value('status');
            self::assertContains($status, ['accepted', 'declined']);
            self::assertTrue($status === 'accepted'
                ? JobInterviewService::accept($interviewId, $fixture['candidate_id'])
                : JobInterviewService::decline($interviewId, $fixture['candidate_id']));
            self::assertFalse($status === 'accepted'
                ? JobInterviewService::decline($interviewId, $fixture['candidate_id'])
                : JobInterviewService::accept($interviewId, $fixture['candidate_id']));
        } finally {
            $this->cleanup($fixture);
        }
    }

    public function test_conflicting_offer_accept_and_reject_have_one_consistent_winner(): void
    {
        $fixture = $this->fixture();
        $offerId = (int) DB::table('job_offers')->insertGetId([
            'tenant_id' => $fixture['tenant_id'],
            'vacancy_id' => $fixture['vacancy_id'],
            'application_id' => $fixture['application_id'],
            'user_id' => $fixture['candidate_id'],
            'status' => 'pending',
            'expires_at' => now()->addWeek(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            $results = $this->race(
                ['accept-offer', 'reject-offer'],
                'from `job_offers`',
                fn (string $action): bool => $action === 'accept-offer'
                    ? JobOfferService::accept($offerId, $fixture['candidate_id'])
                    : JobOfferService::reject($offerId, $fixture['candidate_id']),
                $fixture['tenant_id'],
            );

            self::assertSame(1, count(array_filter($results)));
            $offerStatus = DB::table('job_offers')->where('id', $offerId)->value('status');
            if ($offerStatus === 'accepted') {
                self::assertSame('accepted', DB::table('job_vacancy_applications')->where('id', $fixture['application_id'])->value('status'));
                self::assertSame('filled', DB::table('job_vacancies')->where('id', $fixture['vacancy_id'])->value('status'));
                self::assertTrue(JobOfferService::accept($offerId, $fixture['candidate_id']));
                self::assertFalse(JobOfferService::reject($offerId, $fixture['candidate_id']));
            } else {
                self::assertSame('rejected', $offerStatus);
                self::assertSame('pending', DB::table('job_vacancy_applications')->where('id', $fixture['application_id'])->value('status'));
                self::assertSame('open', DB::table('job_vacancies')->where('id', $fixture['vacancy_id'])->value('status'));
                self::assertTrue(JobOfferService::reject($offerId, $fixture['candidate_id']));
                self::assertFalse(JobOfferService::accept($offerId, $fixture['candidate_id']));
            }
        } finally {
            $this->cleanup($fixture);
        }
    }

    /** @return list<bool> */
    private function race(array $actions, string $barrierQuery, callable $run, int $tenantId): array
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent candidate-decision verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        Mail::fake();
        Http::fake();
        $workers = [];
        DB::purge();

        try {
            foreach ($actions as $action) {
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
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets, $barrierQuery): void {
                            if ($waiting && str_contains(strtolower($query), $barrierQuery)) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Candidate decision barrier timed out');
                                }
                            }
                        });
                        $result = $run($action);
                        fwrite($sockets[1], json_encode(['result' => $result], JSON_THROW_ON_ERROR) . "\n");
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

            foreach ($workers as $worker) {
                self::assertSame('ready', trim((string) fgets($worker['socket'])));
            }
            foreach ($workers as $worker) {
                fwrite($worker['socket'], "go\n");
            }
            $results = [];
            foreach ($workers as $worker) {
                $payload = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($payload);
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                $results[] = (bool) $payload['result'];
            }
            DB::reconnect();
            return $results;
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
        }
    }

    /** @return array{tenant_id:int,employer_id:int,candidate_id:int,vacancy_id:int,application_id:int} */
    private function fixture(): array
    {
        $tenantId = $this->testTenantId;
        $employerId = $this->user('Decision employer', $tenantId);
        $candidateId = $this->user('Decision candidate', $tenantId);
        $vacancyId = (int) DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $employerId,
            'title' => 'Concurrent candidate decision',
            'description' => 'Race fixture',
            'type' => 'paid',
            'commitment' => 'flexible',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $applicationId = (int) DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id' => $tenantId,
            'vacancy_id' => $vacancyId,
            'user_id' => $candidateId,
            'message' => 'Concurrency fixture',
            'status' => 'pending',
            'stage' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return [
            'tenant_id' => $tenantId,
            'employer_id' => $employerId,
            'candidate_id' => $candidateId,
            'vacancy_id' => $vacancyId,
            'application_id' => $applicationId,
        ];
    }

    private function user(string $name, int $tenantId): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => $name,
            'email' => strtolower(str_replace(' ', '-', $name)) . '-' . bin2hex(random_bytes(8)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => 0,
            'role' => 'member',
            'status' => 'active',
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function cleanup(array $fixture): void
    {
        DB::table('notifications')->whereIn('user_id', [$fixture['employer_id'], $fixture['candidate_id']])->delete();
        DB::table('job_interviews')->where('application_id', $fixture['application_id'])->delete();
        DB::table('job_offers')->where('application_id', $fixture['application_id'])->delete();
        DB::table('job_vacancy_applications')->where('id', $fixture['application_id'])->delete();
        DB::table('job_vacancies')->where('id', $fixture['vacancy_id'])->delete();
        DB::table('users')->whereIn('id', [$fixture['employer_id'], $fixture['candidate_id']])->delete();
    }
}
