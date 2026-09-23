<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\JobVacancy;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-100 — accepting a timebank job offer must never mint time credits.
 *
 * Previously the employer was debited with no balance check ("may go
 * negative") and `time_credits` was uncapped at create/update, so two
 * accounts could post a huge timebank job, apply/offer/accept, and create
 * unlimited spendable credits.
 */
class JobOfferCreditIntegrityTest extends TestCase
{
    use DatabaseTransactions;

    private function member(float $balance = 0.0): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $user->id)->update([
            'tenant_id' => $this->testTenantId,
            'balance' => $balance,
        ]);

        return $user;
    }

    /** @return array{vacancy_id:int, application_id:int, offer_id:int} */
    private function pendingTimebankOffer(User $employer, User $candidate, float $credits): array
    {
        $tid = $this->testTenantId;
        $vacancyId = (int) DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $tid,
            'user_id' => $employer->id,
            'title' => 'Timebank task',
            'description' => 'F-100 fixture.',
            'type' => 'timebank',
            'time_credits' => $credits,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $applicationId = (int) DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id' => $tid,
            'vacancy_id' => $vacancyId,
            'user_id' => $candidate->id,
            'status' => 'offered',
            'stage' => 'offered',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $offerId = (int) DB::table('job_offers')->insertGetId([
            'tenant_id' => $tid,
            'vacancy_id' => $vacancyId,
            'application_id' => $applicationId,
            'user_id' => $candidate->id,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return ['vacancy_id' => $vacancyId, 'application_id' => $applicationId, 'offer_id' => $offerId];
    }

    private function balance(User $user): float
    {
        return (float) DB::table('users')->where('id', $user->id)->value('balance');
    }

    public function test_accept_is_refused_when_employer_cannot_cover_the_credits(): void
    {
        $employer = $this->member(5.0);
        $candidate = $this->member(0.0);
        $ids = $this->pendingTimebankOffer($employer, $candidate, 10.0);

        Sanctum::actingAs($candidate, ['*']);
        $response = $this->apiPut("/v2/jobs/offers/{$ids['offer_id']}/accept", []);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.code', 'INSUFFICIENT_BALANCE');
        $response->assertJsonPath('errors.0.message', __('api.job_offer_employer_insufficient_balance'));

        $this->assertEqualsWithDelta(5.0, $this->balance($employer), 0.0001, 'employer must not be debited into the negative');
        $this->assertEqualsWithDelta(0.0, $this->balance($candidate), 0.0001, 'candidate must not receive unbacked credits');
        $this->assertSame(0, DB::table('transactions')
            ->where('sender_id', $employer->id)
            ->where('receiver_id', $candidate->id)
            ->count());
        $this->assertSame('pending', DB::table('job_offers')->where('id', $ids['offer_id'])->value('status'));
        $this->assertSame('open', DB::table('job_vacancies')->where('id', $ids['vacancy_id'])->value('status'));
        $this->assertSame('offered', DB::table('job_vacancy_applications')->where('id', $ids['application_id'])->value('status'));
    }

    public function test_accept_succeeds_and_conserves_credits_when_employer_has_the_balance(): void
    {
        $employer = $this->member(25.0);
        $candidate = $this->member(1.0);
        $ids = $this->pendingTimebankOffer($employer, $candidate, 10.0);

        Sanctum::actingAs($candidate, ['*']);
        $this->apiPut("/v2/jobs/offers/{$ids['offer_id']}/accept", [])->assertOk();

        $this->assertEqualsWithDelta(15.0, $this->balance($employer), 0.0001);
        $this->assertEqualsWithDelta(11.0, $this->balance($candidate), 0.0001);
        $row = DB::table('transactions')
            ->where('sender_id', $employer->id)
            ->where('receiver_id', $candidate->id)
            ->where('transaction_type', 'job_completion')
            ->first();
        $this->assertNotNull($row);
        $this->assertEqualsWithDelta(10.0, (float) $row->amount, 0.0001);
        $this->assertSame('accepted', DB::table('job_offers')->where('id', $ids['offer_id'])->value('status'));
    }

    public function test_create_rejects_timebank_credits_above_the_transfer_cap(): void
    {
        $poster = $this->member(0.0);
        Sanctum::actingAs($poster, ['*']);

        $response = $this->apiPost('/v2/jobs', [
            'title' => 'Mint attempt',
            'description' => 'Posting an absurd credit amount.',
            'type' => 'timebank',
            'time_credits' => 1000000,
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_INVALID_VALUE');
        $this->assertSame(0, JobVacancy::withoutGlobalScopes()->where('user_id', $poster->id)->count());
    }

    public function test_create_rejects_non_positive_or_over_precise_timebank_credits(): void
    {
        $poster = $this->member(0.0);
        Sanctum::actingAs($poster, ['*']);

        foreach ([0, -5, 1.234, 'abc'] as $bad) {
            $this->apiPost('/v2/jobs', [
                'title' => 'Bad credits',
                'description' => 'Invalid credit amount.',
                'type' => 'timebank',
                'time_credits' => $bad,
            ])->assertStatus(422);
        }

        $this->assertSame(0, JobVacancy::withoutGlobalScopes()->where('user_id', $poster->id)->count());
    }

    public function test_create_accepts_a_reasonable_timebank_amount(): void
    {
        $poster = $this->member(0.0);
        Sanctum::actingAs($poster, ['*']);

        $this->apiPost('/v2/jobs', [
            'title' => 'Garden help',
            'description' => 'Two hours of weeding.',
            'type' => 'timebank',
            'time_credits' => 2.5,
        ])->assertStatus(201);

        $this->assertEqualsWithDelta(2.5, (float) JobVacancy::withoutGlobalScopes()
            ->where('user_id', $poster->id)->value('time_credits'), 0.0001);
    }

    public function test_update_rejects_raising_timebank_credits_above_the_cap(): void
    {
        $poster = $this->member(0.0);
        $vacancy = JobVacancy::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $poster->id,
            'type' => 'timebank',
            'time_credits' => 3,
            'status' => 'open',
        ]);
        Sanctum::actingAs($poster, ['*']);

        $this->apiPut("/v2/jobs/{$vacancy->id}", ['time_credits' => 999999])->assertStatus(422);
        $this->apiPut("/v2/jobs/{$vacancy->id}", ['time_credits' => 1.005])->assertStatus(422);
        $this->assertEqualsWithDelta(3.0, (float) $vacancy->fresh()->time_credits, 0.0001);

        // Legitimate edit still works.
        $this->apiPut("/v2/jobs/{$vacancy->id}", ['time_credits' => 4])->assertOk();
        $this->assertEqualsWithDelta(4.0, (float) $vacancy->fresh()->time_credits, 0.0001);
    }

    public function test_update_rejects_switching_a_huge_credit_job_to_timebank(): void
    {
        $poster = $this->member(0.0);
        $vacancy = JobVacancy::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $poster->id,
            'type' => 'volunteer',
            'time_credits' => 50000,
            'status' => 'open',
        ]);
        Sanctum::actingAs($poster, ['*']);

        $this->apiPut("/v2/jobs/{$vacancy->id}", ['type' => 'timebank'])->assertStatus(422);
        $this->assertSame('volunteer', $vacancy->fresh()->type);
    }
}
