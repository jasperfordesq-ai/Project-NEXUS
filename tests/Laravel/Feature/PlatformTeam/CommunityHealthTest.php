<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Community health: one row of counts per community
 * (members, active members, new members, exchanges, hours, new listings,
 * last sign-in) and whether it has gone quiet. Counts only, no names.
 *
 * The definitions are the community admin dashboard's
 * (AdminDashboardController::stats() / exchangeWhere()); one test pins the two
 * to the same numbers for the same community.
 */
class CommunityHealthTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/community-health';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const ROW_KEYS = [
        'id', 'name', 'slug', 'is_active', 'members', 'active_members', 'new_members_this_month',
        'exchanges_this_month', 'exchanges_last_month', 'hours_this_month', 'new_listings_this_month',
        'last_sign_in_at', 'quiet',
    ];

    private const TOP_KEYS = ['active_window_days', 'communities', 'generated_at', 'totals', 'unavailable'];

    private const TOTAL_KEYS = [
        'communities', 'quiet', 'members', 'active_members', 'new_members_this_month',
        'exchanges_this_month', 'exchanges_last_month', 'hours_this_month', 'new_listings_this_month',
    ];

    /** @param array<string, mixed> $attributes */
    private function community(array $attributes = []): int
    {
        $suffix = Str::lower(Str::random(10));

        return (int) DB::table('tenants')->insertGetId(array_merge([
            'name' => 'Health Test ' . $suffix,
            'slug' => 'health-' . $suffix,
            'is_active' => 1,
        ], $attributes));
    }

    /** @param array<string, mixed> $attributes */
    private function member(int $communityId, array $attributes = []): int
    {
        return (int) DB::table('users')->insertGetId(array_merge([
            'tenant_id' => $communityId,
            'name' => 'Health Member',
            'email' => 'health-' . Str::lower(Str::random(12)) . '@example.test',
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now()->subYear(),
        ], $attributes));
    }

    /** @param array<string, mixed> $attributes */
    private function exchange(int $communityId, int $from, int $to, array $attributes = []): void
    {
        DB::table('transactions')->insert(array_merge([
            'tenant_id' => $communityId,
            'sender_id' => $from,
            'receiver_id' => $to,
            'amount' => 1.5,
            'status' => 'completed',
            'transaction_type' => 'exchange',
            'created_at' => now(),
        ], $attributes));
    }

    private function listing(int $communityId, int $owner, mixed $createdAt): void
    {
        DB::table('listings')->insert([
            'tenant_id' => $communityId,
            'user_id' => $owner,
            'title' => 'Health test listing',
            'type' => 'offer',
            'created_at' => $createdAt,
        ]);
    }

    /** @return array<string, mixed> */
    private function data(): array
    {
        return $this->apiGet(self::URI)->assertStatus(200)->json('data');
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function row(array $data, int $communityId): array
    {
        foreach ($data['communities'] as $row) {
            if ((int) $row['id'] === $communityId) {
                return $row;
            }
        }
        $this->fail("community {$communityId} is not listed");
    }

    /** @return list<string> */
    private static function sorted(array $keys): array
    {
        sort($keys);

        return $keys;
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_carries_exactly_what_the_page_shows(): void
    {
        $id = $this->community();
        $this->member($id, ['first_name' => 'Healthfirst', 'last_name' => 'Healthsurname', 'last_login_at' => now()]);
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $data = $response->json('data');

        $this->assertSame(self::sorted(self::TOP_KEYS), self::sorted(array_keys($data)));
        $this->assertSame(self::sorted(self::TOTAL_KEYS), self::sorted(array_keys($data['totals'])));
        foreach ($data['communities'] as $row) {
            $this->assertSame(self::sorted(self::ROW_KEYS), self::sorted(array_keys($row)));
        }
        $this->assertSame(30, $data['active_window_days']);
        $this->assertSame([], $data['unavailable']);
        // Counts only: no member's name or address can ride along.
        $body = $response->getContent();
        foreach (['Healthfirst', 'Healthsurname', '@example.test', 'Health Member'] as $needle) {
            $this->assertStringNotContainsString($needle, (string) $body, $needle);
        }
    }

    public function test_it_lists_every_community_and_says_which_are_not_active(): void
    {
        $active = $this->community();
        $inactive = $this->community(['is_active' => 0]);
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertTrue($this->row($data, $active)['is_active']);
        $this->assertFalse($this->row($data, $inactive)['is_active']);
        $this->assertSame(DB::table('tenants')->count(), count($data['communities']));
        $this->assertSame(count($data['communities']), $data['totals']['communities']);
    }

    public function test_it_counts_members_the_way_the_admin_dashboard_does(): void
    {
        $id = $this->community();
        $this->member($id);                                                    // counted
        $this->member($id, ['created_at' => now()]);                           // counted, new this month
        $this->member($id, ['deleted_at' => now()]);                           // not a member
        $this->member($id, ['anonymized_at' => now()]);                        // not a member
        $this->member($id, ['status' => 'delegate', 'last_login_at' => now()]); // a manager's stand-in
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);

        $this->assertSame(2, $row['members']);
        $this->assertSame(1, $row['new_members_this_month']);
    }

    public function test_active_means_seen_in_the_last_30_days_and_not_suspended(): void
    {
        $id = $this->community();
        $this->member($id, ['last_login_at' => now()->subDays(3)]);                         // active
        $this->member($id, ['last_active_at' => now()->subDays(10), 'last_login_at' => null]); // active
        $this->member($id, ['last_login_at' => now()->subDays(45)]);                        // too long ago
        $this->member($id, ['status' => 'suspended', 'last_login_at' => now()]);            // suspended
        $this->member($id, ['status' => 'banned', 'last_login_at' => now()]);
        $this->member($id, ['status' => 'rejected', 'last_login_at' => now()]);
        $this->member($id, ['status' => 'delegate', 'last_active_at' => now()]);
        $this->member($id, ['deleted_at' => now(), 'last_login_at' => now()]);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);

        $this->assertSame(2, $row['active_members']);
    }

    public function test_it_counts_exchanges_hours_and_listings_by_month(): void
    {
        $id = $this->community();
        $other = $this->community();
        $a = $this->member($id);
        $b = $this->member($id);
        $monthStart = now()->startOfMonth();

        $this->exchange($id, $a, $b, ['amount' => 2.0, 'created_at' => now()]);
        $this->exchange($id, $b, $a, ['amount' => 1.5, 'created_at' => $monthStart->copy()->addMinute()]);
        $this->exchange($id, $a, $b, ['amount' => 4.0, 'created_at' => $monthStart->copy()->subDays(3)]); // last month
        $this->exchange($id, $a, $b, ['created_at' => $monthStart->copy()->subMonths(2)]);                 // older
        // Not exchanges:
        $this->exchange($id, $a, $b, ['status' => 'pending']);
        $this->exchange($id, $a, $b, ['transaction_type' => 'admin_grant']);
        $this->exchange($id, $a, $b, ['transaction_type' => 'exchange_reversal']);
        $this->exchange($id, $a, $a);                                    // to oneself
        $this->exchange($id, 0, $b, ['transaction_type' => 'transfer']); // system credit
        $this->exchange($id, $a, 0);
        DB::table('transactions')->insert(['tenant_id' => $id, 'sender_id' => null, 'receiver_id' => $b, 'amount' => 1, 'status' => 'completed', 'created_at' => now()]);
        // Another community's exchange counts there, not here.
        $c = $this->member($other);
        $d = $this->member($other);
        $this->exchange($other, $c, $d, ['amount' => 9.0]);

        $this->listing($id, $a, now());
        $this->listing($id, $a, $monthStart->copy()->subDay());
        $this->actAsPlatformTeam();

        $data = $this->data();
        $row = $this->row($data, $id);

        $this->assertSame(2, $row['exchanges_this_month']);
        $this->assertSame(1, $row['exchanges_last_month']);
        $this->assertEqualsWithDelta(3.5, $row['hours_this_month'], 0.001);
        $this->assertSame(1, $row['new_listings_this_month']);
        $otherRow = $this->row($data, $other);
        $this->assertSame(1, $otherRow['exchanges_this_month']);
        $this->assertEqualsWithDelta(9.0, $otherRow['hours_this_month'], 0.001);
    }

    public function test_it_gives_the_most_recent_sign_in_of_any_member(): void
    {
        $id = $this->community();
        $this->member($id, ['last_login_at' => '2026-10-01 08:00:00']);
        $this->member($id, ['last_login_at' => '2026-10-20 17:45:00']);
        // A stand-in's or an erased account's time is not a member signing in.
        $this->member($id, ['status' => 'delegate', 'last_login_at' => '2026-10-30 10:00:00']);
        $this->member($id, ['anonymized_at' => now(), 'last_login_at' => '2026-10-29 10:00:00']);
        $never = $this->community();
        $this->member($never, ['last_login_at' => null]);
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertStringStartsWith('2026-10-20T17:45:00', (string) $this->row($data, $id)['last_sign_in_at']);
        $this->assertNull($this->row($data, $never)['last_sign_in_at']);
    }

    /** Ruling: quiet = active community, and (no active member, or no exchange this month and none last month). */
    public function test_quiet_follows_the_written_rule(): void
    {
        $busy = $this->community();
        $a = $this->member($busy, ['last_login_at' => now()]);
        $b = $this->member($busy);
        $this->exchange($busy, $a, $b, ['created_at' => now()->startOfMonth()->subDays(2)]); // last month only

        $noExchanges = $this->community();
        $this->member($noExchanges, ['last_login_at' => now()]);

        $nobodyActive = $this->community();
        $c = $this->member($nobodyActive, ['last_login_at' => now()->subDays(60)]);
        $d = $this->member($nobodyActive);
        $this->exchange($nobodyActive, $c, $d);

        $switchedOff = $this->community(['is_active' => 0]);
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertFalse($this->row($data, $busy)['quiet']);
        $this->assertTrue($this->row($data, $noExchanges)['quiet']);
        $this->assertTrue($this->row($data, $nobodyActive)['quiet']);
        // A community that is switched off is not "quiet": it is off, and says so.
        $this->assertFalse($this->row($data, $switchedOff)['quiet']);
    }

    public function test_the_totals_add_up_the_rows(): void
    {
        $id = $this->community();
        $a = $this->member($id, ['last_login_at' => now(), 'created_at' => now()]);
        $b = $this->member($id);
        $this->exchange($id, $a, $b, ['amount' => 2.5]);
        $this->listing($id, $a, now());
        $this->actAsPlatformTeam();

        $data = $this->data();

        foreach (['members', 'active_members', 'new_members_this_month', 'exchanges_this_month', 'exchanges_last_month', 'new_listings_this_month'] as $figure) {
            $this->assertSame(array_sum(array_column($data['communities'], $figure)), $data['totals'][$figure], $figure);
        }
        $this->assertEqualsWithDelta(array_sum(array_column($data['communities'], 'hours_this_month')), $data['totals']['hours_this_month'], 0.05);
        $this->assertSame(count(array_filter(array_column($data['communities'], 'quiet'))), $data['totals']['quiet']);
    }

    /**
     * The same community, the same moment: this page and the community's own
     * admin dashboard must give the same numbers. If either definition
     * changes alone, this fails.
     */
    public function test_it_agrees_with_the_community_admin_dashboard(): void
    {
        $id = $this->community();
        $a = $this->member($id, ['last_login_at' => now(), 'created_at' => now()]);
        $b = $this->member($id, ['last_active_at' => now()->subDays(5)]);
        $this->member($id, ['status' => 'suspended', 'last_login_at' => now()]);
        $this->member($id, ['deleted_at' => now()]);
        $this->exchange($id, $a, $b, ['amount' => 2.0]);
        $this->exchange($id, $b, $a, ['amount' => 1.0, 'created_at' => now()->startOfMonth()->subDays(4)]);
        $this->exchange($id, $a, $b, ['transaction_type' => 'donation']);
        $this->exchange($id, 0, $a);
        $this->listing($id, $a, now());

        $original = $this->testTenantId;
        $this->withTenant($id);
        $admin = User::factory()->forTenant($id)->create(['role' => 'admin', 'status' => 'active', 'is_approved' => true, 'last_login_at' => now()]);
        Sanctum::actingAs($admin, ['*']);
        $stats = $this->apiGet('/v2/admin/dashboard/stats')->assertStatus(200)->json('data');
        $this->assertSame([], $stats['_failed_metrics']);

        $this->withTenant($original);
        $this->actAsPlatformTeam();
        $row = $this->row($this->data(), $id);

        $this->assertSame($stats['total_users'], $row['members']);
        $this->assertSame($stats['active_users'], $row['active_members']);
        $this->assertSame($stats['new_users_this_month'], $row['new_members_this_month']);
        $this->assertSame($stats['exchanges_this_month'], $row['exchanges_this_month']);
        $this->assertSame($stats['exchanges_last_month'], $row['exchanges_last_month']);
        $this->assertEqualsWithDelta((float) $stats['exchange_hours_this_month'], $row['hours_this_month'], 0.001);
        $this->assertSame($stats['new_listings_this_month'], $row['new_listings_this_month']);
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, ['is_active' => 0])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
