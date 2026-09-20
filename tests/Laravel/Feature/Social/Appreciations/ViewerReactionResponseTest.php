<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Social\Appreciations;

use App\Models\Social\Appreciation;
use App\Models\Social\AppreciationReaction;
use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

class ViewerReactionResponseTest extends TestCase
{
    use DatabaseTransactions;

    public static function viewers(): array
    {
        return [['heart'], ['star'], [null]];
    }

    /** @dataProvider viewers */
    public function test_public_wall_returns_only_the_authenticated_viewers_reaction(?string $reaction): void
    {
        $receiver = User::factory()->forTenant($this->testTenantId)->create();
        $heartViewer = User::factory()->forTenant($this->testTenantId)->create();
        $starViewer = User::factory()->forTenant($this->testTenantId)->create();
        $note = Appreciation::create([
            'sender_id' => $heartViewer->id, 'receiver_id' => $receiver->id,
            'tenant_id' => $this->testTenantId, 'message' => 'Read-only controller fixture',
            'is_public' => true, 'reactions_count' => 2,
        ]);
        foreach ([[$heartViewer, 'heart'], [$starViewer, 'star']] as [$viewer, $type]) {
            AppreciationReaction::create([
                'appreciation_id' => $note->id, 'user_id' => $viewer->id,
                'tenant_id' => $this->testTenantId, 'reaction_type' => $type, 'created_at' => now(),
            ]);
        }
        $headers = [];
        if ($reaction !== null) {
            $viewer = $reaction === 'heart' ? $heartViewer : $starViewer;
            $headers['Authorization'] = 'Bearer ' . app(TokenService::class)->generateToken((int) $viewer->id, $this->testTenantId);
        }
        if ($reaction === null) {
            // This wall is public to members, but its route still requires sign-in.
            $this->apiGet('/v2/users/' . $receiver->id . '/appreciations')->assertUnauthorized();
            return;
        }
        $this->apiGet('/v2/users/' . $receiver->id . '/appreciations', $headers)
            ->assertOk()
            ->assertJsonPath('data.0.id', $note->id)
            ->assertJsonPath('data.0.my_reaction', $reaction)
            ->assertJsonPath('data.0.reactions_count', 2);
    }
}
