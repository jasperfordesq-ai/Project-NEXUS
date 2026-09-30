<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\BlockUserService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-335 (E-065) — regional-point transfers are the third money-plus-free-text
 * path that applied the safeguarding contact policy and no block check.
 *
 * CaringRegionalPointService::transferBetweenMembers trims the sender's
 * message to 500 characters and writes it as the `description` of BOTH ledger
 * rows, including the recipient's `credit` row, which the recipient's own
 * history endpoint reads. So a blocked member could leave a persistent,
 * attacker-authored line in the blocker's point history.
 *
 * E-065 rated this `suspected` because it was read end to end but not driven
 * (it needs two `tenant_settings` rows plus a funded point account). This test
 * drives the whole journey over the HTTP route, so the finding is reproduced
 * here rather than only reasoned about.
 */
class F335RegionalPointTransferBlockCheckTest extends TestCase
{
    use DatabaseTransactions;

    private const PREFIX = 'caring_community.regional_points.';

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
        $this->setFeature('caring_community', true);
        $this->setSetting('enabled', '1');
        $this->setSetting('member_transfers_enabled', '1');
    }

    /** @param array<string,mixed> $overrides */
    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
            'role' => 'member',
        ], $overrides));
    }

    private function setFeature(string $key, bool $enabled): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode($row->features ?? '{}', true) ?: [];
        $features[$key] = $enabled;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features, JSON_THROW_ON_ERROR)]);
        TenantContext::setById($this->testTenantId);
    }

    private function setSetting(string $key, string $value): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => self::PREFIX . $key],
            [
                'setting_value' => $value,
                'setting_type' => 'boolean',
                'category' => 'caring_community',
                'updated_at' => now(),
            ]
        );
    }

    private function fundAccount(int $userId, float $balance): void
    {
        DB::table('caring_regional_point_accounts')->insertOrIgnore([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'balance' => 0,
            'lifetime_earned' => 0,
            'lifetime_spent' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('caring_regional_point_accounts')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->update(['balance' => $balance, 'lifetime_earned' => $balance]);
    }

    public function test_a_blocked_member_cannot_write_free_text_into_the_blockers_point_history(): void
    {
        $attacker = $this->member();
        $victim = $this->member();
        $this->fundAccount((int) $attacker->id, 50.0);
        $this->fundAccount((int) $victim->id, 0.0);

        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F335 harassment');
        $this->assertTrue(
            BlockUserService::isBlockedEither((int) $attacker->id, (int) $victim->id),
            'precondition: the block is live'
        );

        $note = 'F335 unwanted line in the point history of the member who blocked me';

        Sanctum::actingAs($attacker, ['*']);
        $response = $this->apiPost('/v2/caring-community/regional-points/transfer', [
            'recipient_user_id' => (int) $victim->id,
            'points' => 5,
            'message' => $note,
        ]);

        $this->assertSame(403, $response->status(), 'the point transfer must be refused: ' . $response->getContent());
        $this->assertSame('BLOCKED', $response->json('errors.0.code'), $response->getContent());

        $this->assertFalse(
            DB::table('caring_regional_point_transactions')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $victim->id)
                ->where('description', 'like', '%F335 unwanted line%')
                ->exists(),
            'no attacker-authored line may be written into the blocker\'s point history'
        );

        $this->assertEquals(
            0.0,
            (float) DB::table('caring_regional_point_accounts')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $victim->id)
                ->value('balance'),
            'no points may move to the member who blocked the sender'
        );
        $this->assertEquals(
            50.0,
            (float) DB::table('caring_regional_point_accounts')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $attacker->id)
                ->value('balance'),
            'the refused transfer must not debit the sender either'
        );
    }

    public function test_the_block_is_real_and_an_unblocked_point_transfer_still_works(): void
    {
        // Control 1 — the same fixture block DOES stop the canonical check.
        $attacker = $this->member();
        $victim = $this->member();
        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F335 harassment');

        $refused = false;
        try {
            BlockUserService::assertNoBlockBetween((int) $attacker->id, (int) $victim->id);
        } catch (SafeguardingPolicyException $e) {
            $refused = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }
        $this->assertTrue($refused, 'CONTROL: the canonical block check refuses this pair');

        // Control 2 — no block, same route, same body shape.
        $sender = $this->member();
        $recipient = $this->member();
        $this->fundAccount((int) $sender->id, 50.0);
        $this->fundAccount((int) $recipient->id, 0.0);

        Sanctum::actingAs($sender, ['*']);
        $ok = $this->apiPost('/v2/caring-community/regional-points/transfer', [
            'recipient_user_id' => (int) $recipient->id,
            'points' => 5,
            'message' => 'F335 ordinary point transfer',
        ]);

        $this->assertSame(201, $ok->status(), 'CONTROL: an ordinary point transfer still works: ' . $ok->getContent());
        $this->assertEquals(
            5.0,
            (float) DB::table('caring_regional_point_accounts')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $recipient->id)
                ->value('balance'),
            'CONTROL: the rightful recipient is credited'
        );
    }
}
