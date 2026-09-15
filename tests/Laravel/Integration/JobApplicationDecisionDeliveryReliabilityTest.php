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
use App\Services\JobApplicationDecisionDeliveryService;
use App\Services\JobVacancyService;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

final class JobApplicationDecisionDeliveryReliabilityTest extends TestCase
{
    use DatabaseTransactions;

    public function test_recovery_command_is_scheduled_and_rejects_an_invalid_limit_without_processing(): void
    {
        $this->artisan('schedule:list')
            ->expectsOutputToContain('jobs:process-application-decision-outbox --limit=100')
            ->assertExitCode(0);

        $this->artisan('jobs:process-application-decision-outbox', ['--limit' => 0])
            ->expectsOutput('The --limit option must be an integer between 1 and 500.')
            ->assertExitCode(2);
    }

    public function test_outbox_record_failure_rolls_back_the_application_and_history_together(): void
    {
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

        $armed = true;
        DB::listen(static function (QueryExecuted $query) use (&$armed): void {
            if ($armed && str_contains($query->sql, 'job_application_decision_delivery_outbox')) {
                $armed = false;
                throw new \RuntimeException('simulated_outbox_insert_failure');
            }
        });

        $service = app(JobVacancyService::class);
        self::assertFalse($service->updateApplicationStatus(
            (int) $application->id,
            (int) $owner->id,
            'shortlisted',
            null,
            'pending',
        ));
        self::assertSame('SERVER_INTERNAL_ERROR', $service->getErrors()[0]['code'] ?? null);
        self::assertSame('pending', $application->fresh()->stage);
        self::assertSame(0, DB::table('job_application_history')->where('application_id', $application->id)->count());
        self::assertSame(0, DB::table('job_application_decision_delivery_outbox')->where('application_id', $application->id)->count());
    }

    public function test_committed_decision_keeps_a_retryable_delivery_and_resumes_after_the_completed_bell_step(): void
    {
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        $tenantId = $this->testTenantId;
        TenantContext::setById($tenantId);
        $owner = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true]);
        $applicant = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
        ]);
        $vacancy = JobVacancy::factory()->create([
            'tenant_id' => $tenantId,
            'user_id' => $owner->id,
            'title' => 'Reliable decision delivery',
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

        $unavailable = Mockery::mock(JobApplicationDecisionDeliveryService::class);
        $unavailable->shouldReceive('dispatchForHistory')->once()->andReturnFalse();
        $this->app->instance(JobApplicationDecisionDeliveryService::class, $unavailable);

        $service = app(JobVacancyService::class);
        self::assertTrue($service->updateApplicationStatus(
            (int) $application->id,
            (int) $owner->id,
            'shortlisted',
            null,
            'pending',
        ));
        self::assertSame('shortlisted', $application->fresh()->stage);
        self::assertSame(1, DB::table('job_application_history')->where('application_id', $application->id)->count());

        $outbox = DB::table('job_application_decision_delivery_outbox')
            ->where('application_id', $application->id)
            ->first();
        self::assertNotNull($outbox);
        self::assertNull($outbox->completed_at);
        self::assertSame(0, (int) $outbox->attempts);

        $recovery = new class extends JobApplicationDecisionDeliveryService {
            public int $bellCalls = 0;
            public int $pushCalls = 0;
            public int $realtimeCalls = 0;

            protected function createBell(int $userId, string $message, string $link, int $tenantId, int $historyId): void
            {
                $this->bellCalls++;
                parent::createBell($userId, $message, $link, $tenantId, $historyId);
            }

            protected function dispatchPush(int $userId, string $message, string $link): void
            {
                $this->pushCalls++;
                if ($this->pushCalls === 1) throw new \RuntimeException("provider\nsecret detail");
            }

            protected function dispatchRealtime(int $userId, string $message, JobApplication $application, object $row): void
            {
                $this->realtimeCalls++;
            }
        };

        self::assertSame(
            ['claimed' => 1, 'completed' => 0, 'retried' => 1, 'dead_lettered' => 0],
            $recovery->processBatch(),
        );
        $afterFailure = DB::table('job_application_decision_delivery_outbox')->where('id', $outbox->id)->first();
        self::assertNotNull($afterFailure->bell_created_at);
        self::assertNull($afterFailure->push_dispatched_at);
        self::assertNull($afterFailure->realtime_dispatched_at);
        self::assertNull($afterFailure->completed_at);
        self::assertSame('provider secret detail', $afterFailure->last_error);
        self::assertSame(1, DB::table('notifications')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $applicant->id)
            ->where('idempotency_key', 'job-application-decision:' . $outbox->history_id)
            ->count());

        DB::table('job_application_decision_delivery_outbox')->where('id', $outbox->id)->update([
            'next_attempt_at' => now()->subSecond(),
        ]);
        self::assertSame(
            ['claimed' => 1, 'completed' => 1, 'retried' => 0, 'dead_lettered' => 0],
            $recovery->processBatch(),
        );
        $completed = DB::table('job_application_decision_delivery_outbox')->where('id', $outbox->id)->first();
        self::assertNotNull($completed->bell_created_at);
        self::assertNotNull($completed->push_dispatched_at);
        self::assertNotNull($completed->realtime_dispatched_at);
        self::assertNotNull($completed->completed_at);
        self::assertSame(2, (int) $completed->attempts);
        self::assertSame(1, $recovery->bellCalls);
        self::assertSame(2, $recovery->pushCalls);
        self::assertSame(1, $recovery->realtimeCalls);
        self::assertSame(1, DB::table('notifications')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $applicant->id)
            ->where('idempotency_key', 'job-application-decision:' . $outbox->history_id)
            ->count());

        $this->app->instance(JobApplicationDecisionDeliveryService::class, $recovery);
        self::assertTrue($service->updateApplicationStatus(
            (int) $application->id,
            (int) $owner->id,
            'shortlisted',
            null,
            'pending',
        ));
        self::assertSame(1, DB::table('job_application_history')->where('application_id', $application->id)->count());
        self::assertSame(1, DB::table('notifications')
            ->where('idempotency_key', 'job-application-decision:' . $outbox->history_id)
            ->count());
    }
}
