<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-145 (found during the E-027 remediation): the legacy core list routes.
 *
 * GET /api/members returned up to 500 members per page with email address,
 * role, bio, location and last-active time to any signed-in member, ignoring
 * status, privacy_search, privacy_profile and blocks, and allowed searching by
 * email. GET /api/listings returned inactive and unmoderated listings, and
 * GET /api/groups listed private and secret groups. No client calls any of
 * them; the directory, listings and groups all have v2 endpoints that apply
 * the visibility rules. The legacy routes are retired.
 */
final class LegacyCoreListRoutesTest extends TestCase
{
    use DatabaseTransactions;

    public function test_legacy_member_list_is_retired_and_never_returns_member_emails(): void
    {
        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'legacy-members-' . bin2hex(random_bytes(4)) . '@example.test',
            'avatar_url' => '/uploads/test/legacy-avatar.png',
        ]);
        Sanctum::actingAs($this->member(), ['*']);

        $response = $this->apiGet('/members?q=' . urlencode(explode('@', $other->email)[0]));

        $response->assertStatus(404);
        $this->assertStringNotContainsString($other->email, (string) $response->getContent());
    }

    public function test_legacy_listing_and_group_lists_are_retired(): void
    {
        Sanctum::actingAs($this->member(), ['*']);

        $this->apiGet('/listings')->assertStatus(404);
        $this->apiGet('/groups')->assertStatus(404);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }
}
