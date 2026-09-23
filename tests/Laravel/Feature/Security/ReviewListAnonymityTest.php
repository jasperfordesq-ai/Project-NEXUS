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
 * F-084 residue (E-027) — the "reviews of member" list blanked an anonymous
 * reviewer's name and avatar but still returned `reviewer.id`, so anyone could
 * follow the id to the author's profile. The single-review endpoint
 * (ReviewService::getForViewer, commit 6201b0559) already hid it; the list
 * now applies the same rule: an anonymous review names its author only to the
 * author themself and to administrators.
 */
class ReviewListAnonymityTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    public function test_anonymous_reviewer_id_is_hidden_from_other_members(): void
    {
        $reviewer = $this->member(['first_name' => 'Anonfirst', 'last_name' => 'Anonsurname']);
        $receiver = $this->member();
        $review = $this->review($reviewer, $receiver);

        foreach ([$receiver, $this->member()] as $viewer) {
            Sanctum::actingAs($viewer, ['*']);
            $response = $this->apiGet("/v2/reviews/user/{$receiver->id}")->assertStatus(200);

            $row = collect($response->json('data') ?? [])->firstWhere('id', $review->id);
            $this->assertNotNull($row, 'The anonymous review is still listed.');
            $this->assertTrue($row['is_anonymous']);
            $this->assertNull($row['reviewer']['id'], 'An anonymous reviewer is not identified by id.');
            $this->assertNull($row['reviewer']['avatar_url']);
            $body = (string) $response->getContent();
            $this->assertStringNotContainsString('Anonfirst', $body);
            $this->assertStringNotContainsString('Anonsurname', $body);
        }
    }

    public function test_anonymous_reviewer_is_named_to_themself_and_to_admins(): void
    {
        $reviewer = $this->member(['first_name' => 'Ownerfirst', 'last_name' => 'Ownersurname']);
        $receiver = $this->member();
        $review = $this->review($reviewer, $receiver);

        Sanctum::actingAs($reviewer, ['*']);
        $own = collect($this->apiGet("/v2/reviews/user/{$receiver->id}")->assertStatus(200)->json('data') ?? [])
            ->firstWhere('id', $review->id);
        $this->assertSame($reviewer->id, $own['reviewer']['id']);

        Sanctum::actingAs($this->member(['role' => 'admin']), ['*']);
        $asAdmin = collect($this->apiGet("/v2/reviews/user/{$receiver->id}")->assertStatus(200)->json('data') ?? [])
            ->firstWhere('id', $review->id);
        $this->assertSame($reviewer->id, $asAdmin['reviewer']['id']);
        $this->assertSame('Ownerfirst Ownersurname', $asAdmin['reviewer']['name']);
    }

    // ------------------------------------------------------------------

    private function review(User $reviewer, User $receiver): Review
    {
        $review = Review::factory()->forTenant($this->testTenantId)->create([
            'reviewer_id' => $reviewer->id,
            'receiver_id' => $receiver->id,
            'rating' => 4,
            'status' => 'approved',
            'is_anonymous' => 1,
        ]);
        TenantContext::setById($this->testTenantId);

        return $review;
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
