<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Other members see the start of the bio when someone has no tagline, but
 * the member's OWN profile feeds the settings form: filling the empty
 * tagline with the bio there meant one save wrote the bio into the tagline
 * for good (audit of warmth phase 5, 12 Nov 2026).
 */
class OwnProfileTaglineTest extends TestCase
{
    use DatabaseTransactions;

    public function test_me_returns_the_real_tagline_never_a_bio_excerpt(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'tagline' => null,
            'bio' => 'I love gardening and fixing bikes for neighbours.',
        ]);
        Sanctum::actingAs($user, ['*']);

        $this->apiGet('/v2/users/me')
            ->assertStatus(200)
            ->assertJsonPath('data.tagline', null)
            ->assertJsonPath('data.bio', 'I love gardening and fixing bikes for neighbours.');
    }

    public function test_a_tagline_the_member_wrote_is_returned_as_written(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'tagline' => 'Bike fixer',
            'bio' => 'I love gardening and fixing bikes for neighbours.',
        ]);
        Sanctum::actingAs($user, ['*']);

        $this->apiGet('/v2/users/me')->assertStatus(200)->assertJsonPath('data.tagline', 'Bike fixer');
    }
}
