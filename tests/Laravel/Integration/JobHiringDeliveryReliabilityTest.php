<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\JobApplication;
use App\Models\JobInterview;
use App\Models\JobOffer;
use App\Models\JobVacancy;
use App\Models\User;
use App\Services\JobHiringDeliveryService;
use App\Services\JobInterviewService;
use App\Services\JobOfferService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

final class JobHiringDeliveryReliabilityTest extends TestCase
{
    use DatabaseTransactions;

    public function test_recovery_command_is_scheduled_and_rejects_an_invalid_limit(): void
    {
        $this->artisan('schedule:list')
            ->expectsOutputToContain('jobs:process-hiring-delivery-outbox --limit=100')
            ->assertExitCode(0);

        $this->artisan('jobs:process-hiring-delivery-outbox', ['--limit' => 0])
            ->expectsOutput('The --limit option must be an integer between 1 and 500.')
            ->assertExitCode(2);
    }

    public function test_interview_accept_commits_a_retryable_delivery_and_exact_replay_retries_it(): void
    {
        [$tenantId, $owner, $candidate, $vacancy, $application] = $this->fixture();
        $interview = JobInterview::create([
            'tenant_id' => $tenantId,
            'vacancy_id' => $vacancy->id,
            'application_id' => $application->id,
            'proposed_by' => $owner->id,
            'interview_type' => 'video',
            'scheduled_at' => now()->addDay(),
            'duration_mins' => 30,
            'status' => 'proposed',
        ]);

        $unavailable = Mockery::mock(JobHiringDeliveryService::class);
        $unavailable->shouldReceive('dispatchForEvent')
            ->twice()
            ->with($tenantId, 'interview_accepted', (int) $interview->id, (int) $owner->id, true)
            ->andReturnFalse();
        $this->app->instance(JobHiringDeliveryService::class, $unavailable);

        self::assertTrue(JobInterviewService::accept((int) $interview->id, (int) $candidate->id));
        self::assertSame('accepted', $interview->fresh()->status);

        $outbox = DB::table('job_hiring_delivery_outbox')
            ->where('event_type', 'interview_accepted')
            ->where('source_id', $interview->id)
            ->first();
        self::assertNotNull($outbox);
        self::assertSame((int) $owner->id, (int) $outbox->recipient_id);
        self::assertNull($outbox->completed_at);

        self::assertTrue(JobInterviewService::accept((int) $interview->id, (int) $candidate->id));
        self::assertSame(1, DB::table('job_hiring_delivery_outbox')
            ->where('event_type', 'interview_accepted')
            ->where('source_id', $interview->id)
            ->count());
    }

    public function test_new_offer_and_interview_commit_their_candidate_delivery_facts(): void
    {
        [$tenantId, $owner, $candidate, $vacancy, $application] = $this->fixture();
        $unavailable = Mockery::mock(JobHiringDeliveryService::class);
        $unavailable->shouldReceive('dispatchForEvent')->twice()->andReturnFalse();
        $this->app->instance(JobHiringDeliveryService::class, $unavailable);

        $offer = JobOfferService::create((int) $application->id, (int) $owner->id, ['message' => 'Welcome']);
        self::assertIsArray($offer);
        $interview = JobInterviewService::propose((int) $application->id, (int) $owner->id, [
            'scheduled_at' => now()->addDay()->toDateTimeString(),
            'duration_mins' => 30,
        ]);
        self::assertIsArray($interview);

        self::assertDatabaseHas('job_hiring_delivery_outbox', [
            'tenant_id' => $tenantId,
            'event_type' => 'offer_received',
            'source_id' => (int) $offer['id'],
            'recipient_id' => (int) $candidate->id,
        ]);
        self::assertDatabaseHas('job_hiring_delivery_outbox', [
            'tenant_id' => $tenantId,
            'event_type' => 'interview_proposed',
            'source_id' => (int) $interview['id'],
            'recipient_id' => (int) $candidate->id,
        ]);
    }

    public function test_offer_rejection_exact_replay_retries_one_delivery_fact(): void
    {
        [$tenantId, $owner, $candidate, $vacancy, $application] = $this->fixture();
        $offer = JobOffer::create([
            'tenant_id' => $tenantId,
            'vacancy_id' => $vacancy->id,
            'application_id' => $application->id,
            'user_id' => $candidate->id,
            'status' => 'pending',
        ]);
        $unavailable = Mockery::mock(JobHiringDeliveryService::class);
        $unavailable->shouldReceive('dispatchForEvent')
            ->twice()
            ->with($tenantId, 'offer_rejected', (int) $offer->id, (int) $owner->id, true)
            ->andReturnFalse();
        $this->app->instance(JobHiringDeliveryService::class, $unavailable);

        self::assertTrue(JobOfferService::reject((int) $offer->id, (int) $candidate->id));
        self::assertTrue(JobOfferService::reject((int) $offer->id, (int) $candidate->id));
        self::assertSame('rejected', $offer->fresh()->status);
        self::assertSame(1, DB::table('job_hiring_delivery_outbox')
            ->where('event_type', 'offer_rejected')
            ->where('source_id', $offer->id)
            ->count());
    }

    public function test_delivery_record_failure_rolls_back_the_interview_decision(): void
    {
        [$tenantId, $owner, $candidate, $vacancy, $application] = $this->fixture();
        $interview = JobInterview::create([
            'tenant_id' => $tenantId,
            'vacancy_id' => $vacancy->id,
            'application_id' => $application->id,
            'proposed_by' => $owner->id,
            'interview_type' => 'video',
            'scheduled_at' => now()->addDay(),
            'duration_mins' => 30,
            'status' => 'proposed',
        ]);

        $armed = true;
        DB::listen(static function (QueryExecuted $query) use (&$armed): void {
            if ($armed && str_contains($query->sql, 'job_hiring_delivery_outbox')) {
                $armed = false;
                throw new \RuntimeException('simulated_hiring_outbox_failure');
            }
        });

        self::assertFalse(JobInterviewService::accept((int) $interview->id, (int) $candidate->id));
        self::assertSame('proposed', $interview->fresh()->status);
        self::assertSame(0, DB::table('job_hiring_delivery_outbox')
            ->where('event_type', 'interview_accepted')
            ->where('source_id', $interview->id)
            ->count());
    }

    public function test_partial_interview_delivery_resumes_without_recreating_the_bell(): void
    {
        [$tenantId, $owner, $candidate, $vacancy, $application] = $this->fixture();
        $interview = JobInterview::create([
            'tenant_id' => $tenantId,
            'vacancy_id' => $vacancy->id,
            'application_id' => $application->id,
            'proposed_by' => $owner->id,
            'interview_type' => 'video',
            'scheduled_at' => now()->addDay(),
            'duration_mins' => 30,
            'status' => 'proposed',
        ]);
        $outboxId = JobHiringDeliveryService::record($tenantId, 'interview_proposed', (int) $interview->id, (int) $candidate->id);

        $recovery = new class extends JobHiringDeliveryService {
            public int $bellCalls = 0;
            public int $pushCalls = 0;
            public int $realtimeCalls = 0;
            public int $emailCalls = 0;

            protected function createBell(int $userId, string $message, string $link, string $category, int $tenantId, string $key): void
            {
                $this->bellCalls++;
                parent::createBell($userId, $message, $link, $category, $tenantId, $key);
            }

            protected function dispatchPush(int $userId, string $category, string $message, string $link): void
            {
                $this->pushCalls++;
                if ($this->pushCalls === 1) throw new \RuntimeException("provider\nprivate detail");
            }

            protected function dispatchRealtime(int $userId, string $title, array $payload): void
            {
                $this->realtimeCalls++;
            }

            protected function dispatchEmail(object $recipient, array $email, string $key, int $tenantId): void
            {
                $this->emailCalls++;
            }
        };

        self::assertFalse($recovery->dispatchForEvent(
            $tenantId,
            'interview_proposed',
            (int) $interview->id,
            (int) $candidate->id,
            true,
        ));
        $failed = DB::table('job_hiring_delivery_outbox')->where('id', $outboxId)->first();
        self::assertNotNull($failed->bell_created_at);
        self::assertNull($failed->push_dispatched_at);
        self::assertNull($failed->realtime_dispatched_at);
        self::assertNull($failed->email_dispatched_at);
        self::assertSame('provider private detail', $failed->last_error);
        self::assertSame(1, DB::table('notifications')
            ->where('idempotency_key', "job-hiring:interview_proposed:{$interview->id}:{$candidate->id}")
            ->count());

        DB::table('job_hiring_delivery_outbox')->where('id', $outboxId)->update(['next_attempt_at' => now()->subSecond()]);
        self::assertTrue($recovery->dispatchForEvent(
            $tenantId,
            'interview_proposed',
            (int) $interview->id,
            (int) $candidate->id,
        ));
        $completed = DB::table('job_hiring_delivery_outbox')->where('id', $outboxId)->first();
        self::assertNotNull($completed->completed_at);
        self::assertSame(1, $recovery->bellCalls);
        self::assertSame(2, $recovery->pushCalls);
        self::assertSame(1, $recovery->realtimeCalls);
        self::assertSame(1, $recovery->emailCalls);
        self::assertSame(1, DB::table('notifications')
            ->where('idempotency_key', "job-hiring:interview_proposed:{$interview->id}:{$candidate->id}")
            ->count());
    }

    /** @return array{int,User,User,JobVacancy,JobApplication} */
    private function fixture(): array
    {
        $tenantId = $this->testTenantId;
        TenantContext::setById($tenantId);
        $owner = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true]);
        $candidate = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
        ]);
        $vacancy = JobVacancy::factory()->create([
            'tenant_id' => $tenantId,
            'user_id' => $owner->id,
            'title' => 'Reliable hiring delivery',
            'status' => 'open',
            'moderation_status' => 'approved',
        ]);
        $application = JobApplication::factory()->create([
            'tenant_id' => $tenantId,
            'vacancy_id' => $vacancy->id,
            'user_id' => $candidate->id,
            'status' => 'pending',
            'stage' => 'pending',
        ]);

        return [$tenantId, $owner, $candidate, $vacancy, $application];
    }
}
