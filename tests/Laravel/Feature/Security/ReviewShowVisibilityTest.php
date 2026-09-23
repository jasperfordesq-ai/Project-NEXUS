<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-073 (E-027) — `GET /v2/reviews/{id}` returned any review in the community
 * by id, including reviews a moderator rejected and reviews their author
 * deleted, and serialised the raw model with both members' surnames. The list
 * endpoints only ever show published reviews and a shaped member object.
 */
class ReviewShowVisibilityTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    public function test_rejected_review_is_hidden_from_other_members(): void
    {
        [$reviewer, $receiver] = [$this->member(), $this->member()];
        $review = $this->review($reviewer, $receiver, ['status' => 'rejected']);

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiGet("/v2/reviews/{$review->id}")->assertStatus(404);
    }

    public function test_author_deleted_review_is_hidden_from_other_members_and_the_receiver(): void
    {
        [$reviewer, $receiver] = [$this->member(), $this->member()];
        $review = $this->review($reviewer, $receiver, ['status' => 'rejected', 'deleted_by_author_at' => now()]);

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiGet("/v2/reviews/{$review->id}")->assertStatus(404);

        Sanctum::actingAs($receiver, ['*']);
        $this->apiGet("/v2/reviews/{$review->id}")->assertStatus(404);
    }

    public function test_pending_review_is_hidden_from_other_members(): void
    {
        [$reviewer, $receiver] = [$this->member(), $this->member()];
        $review = $this->review($reviewer, $receiver, ['status' => 'pending']);

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiGet("/v2/reviews/{$review->id}")->assertStatus(404);
    }

    public function test_parties_and_admins_still_see_an_unpublished_review(): void
    {
        [$reviewer, $receiver] = [$this->member(), $this->member()];
        $review = $this->review($reviewer, $receiver, ['status' => 'rejected']);

        foreach ([$reviewer, $receiver, $this->member(['role' => 'admin'])] as $viewer) {
            Sanctum::actingAs($viewer, ['*']);
            $this->apiGet("/v2/reviews/{$review->id}")->assertStatus(200)
                ->assertJsonPath('data.id', $review->id);
        }
    }

    public function test_published_review_is_shaped_without_surnames_for_other_members(): void
    {
        $reviewer = $this->member(['first_name' => 'Rita', 'last_name' => 'Reviewersurname']);
        $receiver = $this->member(['first_name' => 'Ray', 'last_name' => 'Receiversurname']);
        $review = $this->review($reviewer, $receiver, ['status' => 'approved', 'comment' => 'Lovely help.']);

        Sanctum::actingAs($this->member(), ['*']);
        $response = $this->apiGet("/v2/reviews/{$review->id}")->assertStatus(200);

        $data = $response->json('data');
        $this->assertSame('Lovely help.', $data['comment']);
        $this->assertSame($reviewer->id, $data['reviewer']['id']);
        $this->assertSame($receiver->id, $data['receiver']['id']);
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('Reviewersurname', $body);
        $this->assertStringNotContainsString('Receiversurname', $body);
        $this->assertArrayNotHasKey('reviewer_id', $data, 'The raw model must not be serialised.');
        $this->assertArrayNotHasKey('email_last_error', $data);
    }

    public function test_anonymous_review_does_not_reveal_the_reviewer_to_others(): void
    {
        $reviewer = $this->member(['first_name' => 'Hiddenfirst']);
        $receiver = $this->member();
        $review = $this->review($reviewer, $receiver, ['status' => 'approved', 'is_anonymous' => 1]);

        Sanctum::actingAs($receiver, ['*']);
        $response = $this->apiGet("/v2/reviews/{$review->id}")->assertStatus(200);

        $this->assertNull($response->json('data.reviewer.id'));
        $this->assertStringNotContainsString('Hiddenfirst', (string) $response->getContent());
    }

    public function test_review_of_connections_only_member_is_hidden_from_non_connections(): void
    {
        $reviewer = $this->member();
        $receiver = $this->member(['privacy_profile' => 'connections']);
        $review = $this->review($reviewer, $receiver, ['status' => 'approved']);

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiGet("/v2/reviews/{$review->id}")->assertStatus(404)
            ->assertJsonPath('errors.0.code', 'PROFILE_PRIVATE');
    }

    // ------------------------------------------------------------------

    /** @param array<string, mixed> $overrides */
    private function review(User $reviewer, User $receiver, array $overrides): Review
    {
        return Review::factory()->forTenant($this->testTenantId)->create(array_merge([
            'reviewer_id' => $reviewer->id,
            'receiver_id' => $receiver->id,
            'rating' => 5,
        ], $overrides));
    }

    /** @param array<string, mixed> $overrides */
    private function member(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'privacy_profile' => 'public',
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
