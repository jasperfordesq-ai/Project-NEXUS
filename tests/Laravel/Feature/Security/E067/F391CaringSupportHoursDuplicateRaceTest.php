<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Services\CaringSupportRelationshipService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Security\E067\Concerns\ForksRace;
use Tests\Laravel\TestCase;

/**
 * F-391 (E-067) — caring-support hours: two concurrent submissions for the same
 * relationship and day both passed the "one log per relationship per day"
 * check and both paid, so one 3-hour visit minted 6 credits (a double-click or a
 * client retry). The check was a plain SELECT outside any transaction or lock,
 * and vol_logs has no unique key behind it.
 *
 * Now the check is repeated inside the transaction with the relationship row
 * locked, so the second submission waits for the first and then sees its log.
 *
 * The child process parks at its first `FOR UPDATE` inside logHours() — after
 * the unlocked duplicate check has answered "none", before any row is written
 * — while the parent completes a whole submission. Adapted from
 * `.local-docs-archive/security-log/E-067/repro/e/CaringSupportHoursMintTest.php`
 * (concurrent case), which asserted the double mint; inverted here.
 */
final class F391CaringSupportHoursDuplicateRaceTest extends TestCase
{
    use ForksRace;

    /** @var list<int> */
    private array $users = [];
    /** @var list<int> */
    private array $orgs = [];
    /** @var list<int> */
    private array $relationships = [];

    protected function tearDown(): void
    {
        DB::purge();
        DB::reconnect();
        if ($this->relationships !== []) {
            $logIds = DB::table('vol_logs')->whereIn('caring_support_relationship_id', $this->relationships)->pluck('id')->all();
            if ($logIds !== []) {
                DB::table('vol_org_transactions')->whereIn('vol_log_id', $logIds)->delete();
                DB::table('vol_logs')->whereIn('id', $logIds)->delete();
            }
            DB::table('caring_support_relationships')->whereIn('id', $this->relationships)->delete();
        }
        if ($this->orgs !== []) {
            DB::table('vol_org_transactions')->whereIn('vol_organization_id', $this->orgs)->delete();
            DB::table('vol_organizations')->whereIn('id', $this->orgs)->delete();
        }
        if ($this->users !== []) {
            DB::table('transactions')->whereIn('receiver_id', $this->users)->delete();
            DB::table('transactions')->whereIn('sender_id', $this->users)->delete();
            DB::table('notifications')->whereIn('user_id', $this->users)->delete();
            DB::table('users')->whereIn('id', $this->users)->delete();
        }
        parent::tearDown();
    }

    public function test_control_one_submission_mints_once_and_a_sequential_repeat_is_refused(): void
    {
        [$admin, $supporter, $rel] = $this->scenario();
        $date = now()->subDay()->toDateString();

        $first = $this->logHours($rel, $admin, $date);
        self::assertTrue($first['success'] ?? false, json_encode($first));
        self::assertSame('paid', $first['log']['payment_result']);

        $second = $this->logHours($rel, $admin, $date);
        self::assertSame('ALREADY_EXISTS', $second['code'] ?? null);
        self::assertSame(3.0, $this->balance($supporter));
    }

    public function test_two_simultaneous_submissions_record_and_pay_the_visit_once(): void
    {
        $this->requireForking();
        [$admin, $supporter, $rel] = $this->scenario();
        $date = now()->subDays(2)->toDateString();

        $parent = null;
        $report = $this->forkRace(
            $this->testTenantId,
            fn (): array => ['result' => $this->logHours($rel, $admin, $date)],
            static fn (string $q): bool => str_contains($q, 'for update'),
            function () use ($rel, $admin, $date, &$parent): void {
                $parent = $this->logHours($rel, $admin, $date);
            },
        );

        self::assertTrue($report['reached_barrier'] ?? false, json_encode($report));
        self::assertTrue($parent['success'] ?? false, 'the first submission to commit succeeds: ' . json_encode($parent));
        self::assertSame('ALREADY_EXISTS', $report['result']['code'] ?? null, 'the other is refused: ' . json_encode($report));

        self::assertSame(1, (int) DB::table('vol_logs')->where('caring_support_relationship_id', $rel)->where('date_logged', $date)->count(), 'one log for one visit');
        self::assertSame(3.0, $this->balance($supporter), 'one 3-hour visit mints 3, not 6');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return array{0:int,1:int,2:int} [admin, supporter, relationship] */
    private function scenario(): array
    {
        $admin = $this->makeUser('admin');
        $owner = $this->makeUser();
        $supporter = $this->makeUser();
        $recipient = $this->makeUser();
        $org = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner,
            'name' => 'F391 org ' . bin2hex(random_bytes(4)),
            'status' => 'approved',
            'balance' => 0.00,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->orgs[] = $org;
        $rel = (int) DB::table('caring_support_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'supporter_id' => $supporter,
            'recipient_id' => $recipient,
            'organization_id' => $org,
            'title' => 'F391 weekly visit',
            'frequency' => 'weekly',
            'expected_hours' => 2.00,
            'start_date' => now()->subDays(30)->toDateString(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->relationships[] = $rel;

        return [$admin, $supporter, $rel];
    }

    private function makeUser(string $role = 'member'): int
    {
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F391 fixture',
            'first_name' => 'F391',
            'last_name' => 'Fixture',
            'email' => 'f391-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => 0,
            'role' => $role,
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

    /** @return array<string,mixed> */
    private function logHours(int $relId, int $adminId, string $date): array
    {
        TenantContext::setById($this->testTenantId);

        return app(CaringSupportRelationshipService::class)->logHours(
            $this->testTenantId,
            $relId,
            ['date' => $date, 'hours' => 3.0, 'description' => 'F391 visit'],
            $adminId,
        );
    }

    private function balance(int $userId): float
    {
        return (float) DB::table('users')->where('id', $userId)->value('balance');
    }
}
