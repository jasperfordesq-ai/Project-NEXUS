<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Federation;

use App\Core\TenantContext;
use App\Http\Controllers\Api\FederationExternalWebhookController;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\TestCase;

/**
 * H7 regression lock — the federation members.list webhook must NOT leak wallet
 * balances to a partner instance by default, and must honour allow_member_search.
 *
 * The directory response previously always included every opted-in member's
 * wallet balance with no gate. Balance is financial data: it is now omitted
 * unless the partner is explicitly granted richer member sync (allow_member_sync),
 * and the whole list is gated on allow_member_search like the listings handler.
 */
class FederationExternalWebhookMembersListTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;

    /**
     * @return array{members: array<int, array<string,mixed>>, count: int}
     */
    private function callHandle(object $partner): array
    {
        $controller = app(FederationExternalWebhookController::class);
        $method = new \ReflectionMethod($controller, 'handleMembersList');
        $method->setAccessible(true);

        /** @var array{members: array<int, array<string,mixed>>, count: int} $result */
        $result = $method->invoke($controller, [], $partner);

        return $result;
    }

    private function seedVisibleMember(float $balance = 7): int
    {
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'first_name' => 'Dir',
            'last_name'  => 'Ectory',
            'email'      => 'dir.' . uniqid('', true) . '@example.com',
            'username'   => 'u_' . substr(md5(uniqid('', true)), 0, 12),
            'balance'    => $balance,
            'status'     => 'active',
            'onboarding_completed' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->optInUserToFederation($userId);

        return $userId;
    }

    private function findMember(array $result, int $userId): ?array
    {
        foreach ($result['members'] as $member) {
            if ((int) ($member['id'] ?? 0) === $userId) {
                return $member;
            }
        }

        return null;
    }

    public function test_members_list_omits_balance_by_default(): void
    {
        TenantContext::setById($this->testTenantId);
        $userId = $this->seedVisibleMember(7);

        TenantContext::setById($this->testTenantId);
        $result = $this->callHandle((object) ['allow_member_search' => 1, 'allow_member_sync' => 0]);

        $member = $this->findMember($result, $userId);
        $this->assertNotNull($member, 'an opted-in active member must appear in the directory');
        $this->assertArrayNotHasKey('balance', $member, 'wallet balance must NOT leak to a partner by default');
    }

    public function test_members_list_is_empty_when_member_search_not_allowed(): void
    {
        TenantContext::setById($this->testTenantId);
        $this->seedVisibleMember(7);

        TenantContext::setById($this->testTenantId);
        $result = $this->callHandle((object) ['allow_member_search' => 0, 'allow_member_sync' => 1]);

        $this->assertSame(0, $result['count']);
        $this->assertSame([], $result['members']);
    }

    public function test_members_list_includes_balance_only_when_member_sync_allowed(): void
    {
        TenantContext::setById($this->testTenantId);
        $userId = $this->seedVisibleMember(7);

        TenantContext::setById($this->testTenantId);
        $result = $this->callHandle((object) ['allow_member_search' => 1, 'allow_member_sync' => 1]);

        $member = $this->findMember($result, $userId);
        $this->assertNotNull($member);
        $this->assertArrayHasKey('balance', $member, 'balance is exposed only when allow_member_sync is explicitly on');
    }
}
