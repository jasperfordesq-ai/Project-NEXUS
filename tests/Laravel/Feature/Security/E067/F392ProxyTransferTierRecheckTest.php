<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Services\SubAccountService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Security\E067\Concerns\ForksRace;
use Tests\Laravel\TestCase;

/**
 * F-392 (E-067) — a residual of F-342. The F-342 fix (47c8caf63) re-checks the
 * carer relationship inside WalletService::transfer() with the row locked, but
 * tested only `status`. A member who kept the relationship but withdrew — or
 * lowered — the carer's credits permission
 * (PUT /v2/users/me/parent-accounts/{id}/permissions) did not stop a carer's
 * transfer already in flight: transferForChild() had checked the permission on
 * an unlocked read before the transaction.
 *
 * Now each caller states the credits tier it needs (an immediate carer
 * transfer: `represent`; the co-decide confirmation: `co_decide`) and that
 * tier is re-checked under the same lock.
 *
 * The child parks before its first `users … FOR UPDATE` inside transfer(),
 * i.e. after transferForChild()'s unlocked permission check, while the parent
 * commits the member's change. Adapted from
 * `.local-docs-archive/security-log/E-067/repro/e/ProxyTransferTierDowngradeRaceTest.php`,
 * which asserted the spend; inverted here, plus a lowering-to-co_decide race.
 */
final class F392ProxyTransferTierRecheckTest extends TestCase
{
    use ForksRace;

    /** @var list<int> */
    private array $users = [];
    /** @var list<int> */
    private array $rels = [];

    protected function tearDown(): void
    {
        DB::purge();
        DB::reconnect();
        if ($this->rels !== []) {
            DB::table('account_relationships')->whereIn('id', $this->rels)->delete();
        }
        if ($this->users !== []) {
            DB::table('org_audit_log')->whereIn('user_id', $this->users)->delete();
            DB::table('transactions')->whereIn('sender_id', $this->users)->delete();
            DB::table('transactions')->whereIn('receiver_id', $this->users)->delete();
            DB::table('notifications')->whereIn('user_id', $this->users)->delete();
            DB::table('user_xp_log')->whereIn('user_id', $this->users)->delete();
            DB::table('users')->whereIn('id', $this->users)->delete();
        }
        parent::tearDown();
    }

    public function test_control_an_uncontested_carer_transfer_still_works(): void
    {
        [$member, $carer, $payee] = [$this->makeUser(10), $this->makeUser(0), $this->makeUser(0)];
        $this->makeRelationship($carer, $member);

        self::assertTrue($this->transfer($carer, $member, $payee)['transferred']);
        self::assertSame(6.0, $this->balance($member));
    }

    public function test_withdrawing_the_credits_permission_mid_transfer_stops_it(): void
    {
        $this->assertRaceStops('none');
    }

    public function test_lowering_the_credits_permission_to_co_decide_mid_transfer_stops_an_immediate_transfer(): void
    {
        $this->assertRaceStops('co_decide');
    }

    private function assertRaceStops(string $newCreditsTier): void
    {
        $this->requireForking();
        [$member, $carer, $payee] = [$this->makeUser(10), $this->makeUser(0), $this->makeUser(0)];
        $rel = $this->makeRelationship($carer, $member);

        $report = $this->forkRace(
            $this->testTenantId,
            fn (): array => $this->transfer($carer, $member, $payee),
            static fn (string $q): bool => str_contains($q, '`users`') && str_contains($q, 'for update'),
            function () use ($member, $rel, $newCreditsTier): void {
                TenantContext::setById($this->testTenantId);
                self::assertTrue(
                    app(SubAccountService::class)->updatePermissionsByMember($member, $rel, ['credits' => $newCreditsTier]),
                    'the member can change the carer\'s credits permission'
                );
                self::assertFalse($this->canTransact($rel), 'the change must commit before any credit moves');
            },
        );

        self::assertTrue($report['reached_barrier'] ?? false, json_encode($report));
        self::assertSame('active', (string) DB::table('account_relationships')->where('id', $rel)->value('status'), 'the relationship itself stays active');
        self::assertFalse($report['transferred'] ?? true, 'the in-flight transfer is refused: ' . json_encode($report));
        self::assertSame(10.0, $this->balance($member), 'no credits are spent');
        self::assertSame(0.0, $this->balance($payee));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function makeUser(float $balance): int
    {
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F392 proxy fixture',
            'email' => 'f392-proxy-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => $balance,
            'role' => 'member',
            'status' => 'active',
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->users[] = $id;

        return $id;
    }

    private function makeRelationship(int $carerId, int $memberId): int
    {
        $id = (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $carerId,
            'child_user_id' => $memberId,
            'relationship_type' => 'carer',
            'permissions' => json_encode(['can_view_activity' => true, 'can_manage_listings' => false, 'can_transact' => true]),
            'status' => 'active',
            'proposed_by_user_id' => null,
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->rels[] = $id;

        return $id;
    }

    /** @return array{transferred:bool, errors:array<mixed>} */
    private function transfer(int $carer, int $member, int $payee): array
    {
        TenantContext::setById($this->testTenantId);
        $svc = app(SubAccountService::class);
        $r = $svc->transferForChild($carer, $member, ['recipient' => $payee, 'amount' => 4.0, 'description' => 'F392 proxy']);

        return ['transferred' => is_array($r), 'errors' => $svc->getErrors()];
    }

    private function canTransact(int $rel): bool
    {
        $p = json_decode((string) DB::table('account_relationships')->where('id', $rel)->value('permissions'), true);

        return (bool) ($p['can_transact'] ?? false);
    }

    private function balance(int $id): float
    {
        return (float) DB::table('users')->where('id', $id)->value('balance');
    }
}
