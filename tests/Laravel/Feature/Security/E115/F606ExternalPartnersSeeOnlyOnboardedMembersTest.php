<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E115;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-606 (E-115), outbound half — the v1 federation API that other
 * installations read listed and served members who had not finished
 * onboarding. The same rule as the in-platform member directory now applies:
 * a member who has not onboarded does not exist to a partner.
 */
final class F606ExternalPartnersSeeOnlyOnboardedMembersTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    public function test_partner_member_list_and_profile_leave_out_members_who_have_not_onboarded(): void
    {
        $hidden = $this->federatedMember(onboarded: false);
        $shown = $this->federatedMember(onboarded: true);
        $key = $this->partnerApiKey('f606-a');

        $this->useKey($key, 'GET', '/api/v1/federation/members');
        $list = $this->apiGet('/v1/federation/members?per_page=200', ['X-API-Key' => $key]);
        $this->assertSame(200, $list->status(), (string) $list->getContent());
        $ids = array_map(fn ($r) => (int) ($r['id'] ?? 0), $list->json('data') ?? []);
        $this->assertNotContains((int) $hidden->id, $ids, 'a member who has not onboarded must not be listed to a partner');
        $this->assertContains((int) $shown->id, $ids, 'control: an onboarded member is still listed');

        $this->useKey($key, 'GET', '/api/v1/federation/members/' . $hidden->id);
        $this->assertSame(404, $this->apiGet('/v1/federation/members/' . $hidden->id, ['X-API-Key' => $key])->status());

        $this->useKey($key, 'GET', '/api/v1/federation/members/' . $shown->id);
        $this->assertSame(200, $this->apiGet('/v1/federation/members/' . $shown->id, ['X-API-Key' => $key])->status());
    }

    private function federatedMember(bool $onboarded): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => $onboarded,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'updated_at' => now(),
            ],
        );

        return $user;
    }

    private function partnerApiKey(string $platformId): string
    {
        $apiKey = $platformId . '-' . bin2hex(random_bytes(10));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => 'F-606 ' . $platformId,
            'key_hash' => hash('sha256', $apiKey),
            'key_prefix' => substr($apiKey, 0, 8),
            'signing_enabled' => 0,
            'platform_id' => $platformId,
            'permissions' => json_encode(['members:read']),
            'rate_limit' => 100000,
            'status' => 'active',
            'created_by' => 1,
            'created_at' => now(),
            'updated_at' => now(),
            'hourly_request_count' => 0,
        ]);

        return $apiKey;
    }

    private function useKey(string $apiKey, string $method, string $uri): void
    {
        FederationApiMiddleware::reset();
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = $method;
        $_SERVER['REQUEST_URI'] = $uri;
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }
}
