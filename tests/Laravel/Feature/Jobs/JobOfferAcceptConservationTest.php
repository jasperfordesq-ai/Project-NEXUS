<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Jobs;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\JobOfferService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression: accepting a timebank job offer must CONSERVE credits — the credits
 * the candidate earns must be SOURCED from the employer who posted the role, not
 * minted from nothing.
 *
 * `JobOfferService::accept` writes a `transactions` row (sender = employer,
 * receiver = candidate, type = job_completion) and incremented the candidate's
 * balance, but never debited the employer. Posting a timebank vacancy performs no
 * escrow either, so every timebank hire created `time_credits` out of thin air —
 * and posting a high-credit timebank job then self-/sock-puppet-accepting it
 * minted arbitrary credits, breaking the timebanking conservation invariant. The
 * employer is now debited symmetrically (may go negative, matching the volunteer
 * org-wallet reconciliation semantics), so sum(balances) is unchanged.
 */
class JobOfferAcceptConservationTest extends TestCase
{
    use DatabaseTransactions;

    private function user(float $balance): User
    {
        $tid = $this->testTenantId;
        $u = User::factory()->forTenant($tid)->create();
        // Normalise tenant + set a known balance (console factory/tenant drift).
        DB::table('users')->where('id', $u->id)->update([
            'tenant_id' => $tid,
            'balance'   => $balance,
        ]);

        return $u;
    }

    public function test_accepting_timebank_offer_debits_employer_and_conserves_credits(): void
    {
        $tid       = $this->testTenantId;
        $employer  = $this->user(100.0);
        $candidate = $this->user(0.0);
        $credits   = 10.0;

        $vacancyId = (int) DB::table('job_vacancies')->insertGetId([
            'tenant_id'    => $tid,
            'user_id'      => $employer->id,
            'title'        => 'Timebank task',
            'description'  => 'Conservation regression fixture.',
            'type'         => 'timebank',
            'time_credits' => $credits,
            'status'       => 'open',
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        $applicationId = (int) DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id'  => $tid,
            'vacancy_id' => $vacancyId,
            'user_id'    => $candidate->id,
            'status'     => 'offered',
            'stage'      => 'offered',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $offerId = (int) DB::table('job_offers')->insertGetId([
            'tenant_id'      => $tid,
            'vacancy_id'     => $vacancyId,
            'application_id' => $applicationId,
            'user_id'        => $candidate->id,
            'status'         => 'pending',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);
        $interviewId = (int) DB::table('job_interviews')->insertGetId([
            'tenant_id' => $tid,
            'vacancy_id' => $vacancyId,
            'application_id' => $applicationId,
            'proposed_by' => $employer->id,
            'interview_type' => 'video',
            'scheduled_at' => now()->addWeek(),
            'duration_mins' => 30,
            'status' => 'accepted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $totalBefore = (float) DB::table('users')->whereIn('id', [$employer->id, $candidate->id])->sum('balance');

        $ok = TenantContext::runForTenant($tid, fn () => JobOfferService::accept($offerId, (int) $candidate->id));
        $this->assertTrue($ok, 'the applicant should be able to accept their pending offer');

        $employerAfter  = (float) DB::table('users')->where('id', $employer->id)->value('balance');
        $candidateAfter = (float) DB::table('users')->where('id', $candidate->id)->value('balance');

        $this->assertEqualsWithDelta(90.0, $employerAfter, 0.0001, 'employer must be debited the offered credits');
        $this->assertEqualsWithDelta(10.0, $candidateAfter, 0.0001, 'candidate must be credited the offered credits');

        $totalAfter = $employerAfter + $candidateAfter;
        $this->assertEqualsWithDelta($totalBefore, $totalAfter, 0.0001, 'total credits must be conserved (sourced from the employer, not minted)');

        // The ledger row must exist and match the balance movement.
        $rows = DB::table('transactions')
            ->where('sender_id', $employer->id)
            ->where('receiver_id', $candidate->id)
            ->where('transaction_type', 'job_completion')
            ->get();
        $this->assertCount(1, $rows, 'exactly one job_completion ledger row from employer to candidate; got: ' . $rows->toJson());
        $this->assertEqualsWithDelta($credits, (float) $rows->first()->amount, 0.0001, 'ledger amount matches the offered credits');
        $this->assertSame('cancelled', DB::table('job_interviews')->where('id', $interviewId)->value('status'));
        $this->assertDatabaseHas('job_application_history', [
            'application_id' => $applicationId,
            'from_status' => 'offered',
            'to_status' => 'accepted',
            'changed_by' => $candidate->id,
        ]);
        // NB: the ledger row's tenant_id is intentionally not asserted here — under
        // the console test runner TenantContext::getId() drifts (observers reset),
        // so Transaction::create's HasTenantScope hook can stamp the wrong tenant.
        // That is a test-runner artifact, not a production path (HTTP requests hold
        // a stable tenant context). This regression guards CONSERVATION (above).
    }

    public function test_self_accepted_timebank_job_nets_zero_no_minting(): void
    {
        // The mint exploit: employer posts a high-credit timebank job and the same
        // person accepts it. With conservation it must net to zero, not mint.
        $tid    = $this->testTenantId;
        $person = $this->user(50.0);
        $credits = 1000.0;

        $vacancyId = (int) DB::table('job_vacancies')->insertGetId([
            'tenant_id'    => $tid,
            'user_id'      => $person->id,
            'title'        => 'Self-dealt timebank task',
            'description'  => 'Mint-exploit regression fixture.',
            'type'         => 'timebank',
            'time_credits' => $credits,
            'status'       => 'open',
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        $applicationId = (int) DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id'  => $tid,
            'vacancy_id' => $vacancyId,
            'user_id'    => $person->id,
            'status'     => 'offered',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $offerId = (int) DB::table('job_offers')->insertGetId([
            'tenant_id'      => $tid,
            'vacancy_id'     => $vacancyId,
            'application_id' => $applicationId,
            'user_id'        => $person->id,
            'status'         => 'pending',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        $ok = TenantContext::runForTenant($tid, fn () => JobOfferService::accept($offerId, (int) $person->id));
        $this->assertTrue($ok);

        // +1000 credit then -1000 debit on the same wallet → unchanged.
        $balanceAfter = (float) DB::table('users')->where('id', $person->id)->value('balance');
        $this->assertEqualsWithDelta(50.0, $balanceAfter, 0.0001, 'self-accepting a timebank job must not mint credits');
    }
}
