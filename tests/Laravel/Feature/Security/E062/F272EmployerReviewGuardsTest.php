<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E062;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * F-272 (E-062) — POST /v2/jobs/employer-reviews wrote an approved review with
 * Review::create() directly, skipping every guard the canonical review path
 * (ReviewService::create) applies: the F-070 block check, the safeguarding
 * contact policy and the 24-hour per-member throttle. Its own duplicate guard
 * matched `review_type = 'employer'`, a value `reviews.review_type`
 * (enum('local','federated')) cannot hold, so it never fired and one accepted
 * application allowed unlimited 1-star reviews.
 *
 * Controls: an eligible, unblocked applicant can still leave one review, and a
 * member with no accepted application is still refused.
 */
class F272EmployerReviewGuardsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    /** @return array<string, array{string}> */
    public static function blockDirections(): array
    {
        return [
            'the employer blocked the applicant' => ['employer_blocked_applicant'],
            'the applicant blocked the employer' => ['applicant_blocked_employer'],
        ];
    }

    #[DataProvider('blockDirections')]
    public function test_a_block_in_either_direction_stops_an_employer_review(string $direction): void
    {
        [$employer, $applicant] = $this->eligiblePair();

        TenantContext::setById($this->testTenantId);
        if ($direction === 'employer_blocked_applicant') {
            BlockUserService::block((int) $employer->id, (int) $applicant->id);
        } else {
            BlockUserService::block((int) $applicant->id, (int) $employer->id);
        }

        $this->actAs($applicant);
        $response = $this->review($employer, 'F272-BLOCKED');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'BLOCKED');
        $response->assertJsonPath('errors.0.message', __('safeguarding.errors.blocked_interaction'));
        $this->assertSame(0, $this->reviewCount($applicant, $employer));
    }

    public function test_the_safeguarding_contact_policy_is_consulted_and_a_denial_writes_nothing(): void
    {
        [$employer, $applicant] = $this->eligiblePair();

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with((int) $applicant->id, (int) $employer->id, $this->testTenantId, 'employer_review')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $this->actAs($applicant);
        $response = $this->review($employer, 'F272-SAFEGUARDING');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertSame(0, $this->reviewCount($applicant, $employer));
    }

    public function test_one_accepted_application_allows_one_employer_review_not_many(): void
    {
        [$employer, $applicant] = $this->eligiblePair();

        $this->actAs($applicant);
        $first = $this->review($employer, 'F272-FIRST');
        $first->assertOk();

        for ($i = 2; $i <= 3; $i++) {
            $this->actAs($applicant);
            $again = $this->review($employer, "F272-AGAIN-{$i}");
            $again->assertStatus(409);
            $again->assertJsonPath('errors.0.code', 'DUPLICATE');
        }

        $this->assertSame(1, $this->reviewCount($applicant, $employer), 'only the first review is stored');
    }

    public function test_the_review_route_and_the_employer_route_share_the_24_hour_throttle(): void
    {
        [$employer, $applicant] = $this->eligiblePair();

        $this->actAs($applicant);
        $this->apiPost('/v2/reviews', [
            'receiver_id' => (int) $employer->id,
            'rating' => 1,
            'comment' => 'F272-GENERAL',
        ])->assertStatus(201);

        $this->actAs($applicant);
        $response = $this->review($employer, 'F272-SECOND-ROUTE');

        $response->assertStatus(409);
        $this->assertSame(1, $this->reviewCount($applicant, $employer), 'switching routes does not reset the throttle');
    }

    public function test_control_an_eligible_unblocked_applicant_may_review_the_employer(): void
    {
        [$employer, $applicant] = $this->eligiblePair();

        $this->actAs($applicant);
        $response = $this->review($employer, 'F272-CONTROL');

        $response->assertOk();
        $row = DB::table('reviews')
            ->where('tenant_id', $this->testTenantId)
            ->where('reviewer_id', (int) $applicant->id)
            ->where('receiver_id', (int) $employer->id)
            ->first();
        $this->assertNotNull($row);
        $this->assertSame('approved', (string) $row->status);
        $this->assertSame('F272-CONTROL', (string) $row->comment);
    }

    public function test_control_a_member_with_no_accepted_application_is_still_refused(): void
    {
        $employer = $this->member();
        $outsider = $this->member();
        $this->vacancy($employer);

        $this->actAs($outsider);
        $response = $this->review($employer, 'F272-OUTSIDER');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'NOT_ELIGIBLE');
        $this->assertSame(0, $this->reviewCount($outsider, $employer));
    }

    /** @return array{User, User} [employer, applicant with an accepted application] */
    private function eligiblePair(): array
    {
        $employer = $this->member();
        $applicant = $this->member();
        $vacancyId = $this->vacancy($employer);

        DB::table('job_vacancy_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'vacancy_id' => $vacancyId,
            'user_id' => (int) $applicant->id,
            'status' => 'accepted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$employer, $applicant];
    }

    private function vacancy(User $employer): int
    {
        return (int) DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $employer->id,
            'title' => 'F272 vacancy',
            'description' => 'F272 vacancy description',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function review(User $employer, string $comment): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/v2/jobs/employer-reviews', [
            'employer_id' => (int) $employer->id,
            'rating' => 1,
            'comment' => $comment,
        ]);
    }

    private function reviewCount(User $reviewer, User $receiver): int
    {
        return (int) DB::table('reviews')
            ->where('tenant_id', $this->testTenantId)
            ->where('reviewer_id', (int) $reviewer->id)
            ->where('receiver_id', (int) $receiver->id)
            ->count();
    }

    private function actAs(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user, ['*']);
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
