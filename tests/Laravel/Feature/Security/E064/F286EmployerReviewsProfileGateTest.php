<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E064;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-286 (E-062 A-3): GET /v2/jobs/employer-reviews/{userId} returns each
 * review's free-text comment and the reviewer's name, but applied none of the
 * profile-privacy gate that GET /v2/reviews/user/{id} applies (F-081). A
 * member's reviews are part of their profile, so both surfaces must answer
 * the same viewer the same way.
 */
class F286EmployerReviewsProfileGateTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    private function member(array $attrs = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(
            array_merge(['status' => 'active', 'is_approved' => true], $attrs),
        );
    }

    private function actAs(User $viewer): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($viewer, ['*']);
    }

    public function test_a_viewer_the_review_list_refuses_is_refused_employer_reviews_too(): void
    {
        $employer = $this->member(['privacy_profile' => 'connections']);
        $stranger = $this->member();
        $this->actAs($stranger);

        // The canonical surface refuses this viewer…
        $this->apiGet("/v2/reviews/user/{$employer->id}")->assertStatus(404);

        // …and so must the employer-review surface, with the same code.
        $response = $this->apiGet("/v2/jobs/employer-reviews/{$employer->id}");
        $response->assertStatus(404);
        $this->assertSame('PROFILE_PRIVATE', (string) $response->json('errors.0.code'));
    }

    public function test_control_an_accepted_connection_may_read_employer_reviews(): void
    {
        $employer = $this->member(['privacy_profile' => 'connections']);
        $connection = $this->member();
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => (int) $connection->id,
            'receiver_id' => (int) $employer->id,
            'status' => 'accepted',
            'created_at' => now(),
        ]);
        $this->actAs($connection);

        $response = $this->apiGet("/v2/jobs/employer-reviews/{$employer->id}");
        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['reviews', 'stats']]);
    }

    public function test_control_a_public_profile_is_readable_by_any_member(): void
    {
        $employer = $this->member(['privacy_profile' => 'public']);
        $this->actAs($this->member());

        $this->apiGet("/v2/jobs/employer-reviews/{$employer->id}")->assertStatus(200);
    }
}
