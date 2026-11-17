<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Data requests: per community, how many data requests
 * (a copy of their data, erasure, a correction, ...) are open, how many are
 * overdue (open for more than 30 days), how many are nearly due (25 to 30
 * days), how old the oldest open one is, and how many were completed in the
 * last 90 days. Counts only: no names, no request ids, no addresses.
 *
 * The 30-day rule and its clock (`COALESCE(requested_at, created_at)`) are
 * GdprService::complianceScore()'s; the 25-day warning is
 * OverdueGdprRequestCheck's default.
 */
class DataRequestsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/data-requests';

    private const TYPES = ['access', 'erasure', 'rectification', 'restriction', 'portability', 'objection'];

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const TOP_KEYS = [
        'overdue_after_days', 'nearly_due_from_days', 'completed_window_days',
        'request_types', 'unavailable', 'totals', 'communities', 'generated_at',
    ];

    private const ROW_KEYS = [
        'id', 'name', 'slug', 'is_active', 'open', 'open_by_type', 'overdue', 'nearly_due',
        'oldest_open_days', 'completed_last_90_days',
    ];

    private const TOTAL_KEYS = [
        'communities', 'open', 'open_by_type', 'overdue', 'nearly_due',
        'oldest_open_days', 'completed_last_90_days', 'completed_without_date',
    ];

    /** @param array<string, mixed> $attributes */
    private function community(array $attributes = []): int
    {
        $suffix = Str::lower(Str::random(10));

        return (int) DB::table('tenants')->insertGetId(array_merge([
            'name' => 'Data Requests Test ' . $suffix,
            'slug' => 'dr-' . $suffix,
            'is_active' => 1,
        ], $attributes));
    }

    private function member(int $communityId): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $communityId,
            'first_name' => 'Requestfirst',
            'last_name' => 'Requestsurname',
            'name' => 'Requestfirst Requestsurname',
            'email' => 'dr-' . Str::lower(Str::random(12)) . '@example.test',
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now()->subYear(),
        ]);
    }

    /** @param array<string, mixed> $attributes */
    private function request(int $communityId, int $userId, array $attributes = []): int
    {
        return (int) DB::table('gdpr_requests')->insertGetId(array_merge([
            'tenant_id' => $communityId,
            'user_id' => $userId,
            'request_type' => 'access',
            'status' => 'pending',
            'requested_at' => now()->subDays(2),
            'created_at' => now()->subDays(2),
        ], $attributes));
    }

    /** @return array<string, mixed> */
    private function data(): array
    {
        // These tests are about the counting: drop the five-minute kept answer
        // (PlatformFiguresCacheTest covers keeping it).
        \Illuminate\Support\Facades\Cache::flush();

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

    public function test_it_carries_exactly_what_the_page_shows_and_nothing_personal(): void
    {
        $id = $this->community();
        $user = $this->member($id);
        $requestId = $this->request($id, $user, [
            'request_type' => 'erasure',
            'verification_token' => 'tok-Zq81PlantedSecret',
            'export_file_path' => '/exports/planted-export-path.zip',
            'notes' => 'Planted note about the member',
            'metadata' => json_encode(['planted' => 'metadata-value-x9']),
            'rejection_reason' => 'Planted rejection reason',
        ]);
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $data = $response->json('data');

        $this->assertSame(self::sorted(self::TOP_KEYS), self::sorted(array_keys($data)));
        $this->assertSame(self::sorted(self::TOTAL_KEYS), self::sorted(array_keys($data['totals'])));
        $this->assertSame(self::sorted(self::TYPES), self::sorted(array_keys($data['totals']['open_by_type'])));
        foreach ($data['communities'] as $row) {
            $this->assertSame(self::sorted(self::ROW_KEYS), self::sorted(array_keys($row)));
            $this->assertSame(self::sorted(self::TYPES), self::sorted(array_keys($row['open_by_type'])));
        }
        $this->assertSame(30, $data['overdue_after_days']);
        $this->assertSame(25, $data['nearly_due_from_days']);
        $this->assertSame(90, $data['completed_window_days']);
        $this->assertSame(self::TYPES, $data['request_types']);
        $this->assertSame([], $data['unavailable']);

        $body = (string) $response->getContent();
        foreach ([
            'Requestfirst', 'Requestsurname', '@example.test', 'tok-Zq81PlantedSecret',
            'planted-export-path', 'Planted note', 'metadata-value-x9', 'Planted rejection',
            '"user_id"', '"request_id"', '"verification_token"', '"notes"',
        ] as $needle) {
            $this->assertStringNotContainsString($needle, $body, $needle);
        }
        // Every "id" sent is a community's id, never a request's. (Comparing
        // with the request's own number would fail by chance whenever a
        // community happens to have the same number.)
        $communityIds = DB::table('tenants')->pluck('id')->map(static fn ($id): int => (int) $id)->all();
        $this->assertSame([], array_values(array_diff(array_column($data['communities'], 'id'), $communityIds)), 'an id that is not a community rode along');
        $this->assertGreaterThan(0, $requestId);
    }

    public function test_it_lists_every_community_including_those_with_nothing_open(): void
    {
        $empty = $this->community();
        $off = $this->community(['is_active' => 0]);
        $this->actAsPlatformTeam();

        $data = $this->data();
        $row = $this->row($data, $empty);

        $this->assertSame(DB::table('tenants')->count(), count($data['communities']));
        $this->assertSame(count($data['communities']), $data['totals']['communities']);
        $this->assertSame(0, $row['open']);
        $this->assertSame(0, $row['overdue']);
        $this->assertSame(0, $row['nearly_due']);
        $this->assertSame(0, $row['completed_last_90_days']);
        $this->assertNull($row['oldest_open_days']);
        $this->assertSame(array_fill_keys(self::TYPES, 0), $row['open_by_type']);
        $this->assertTrue($row['is_active']);
        $this->assertFalse($this->row($data, $off)['is_active']);
    }

    public function test_open_means_pending_or_processing_counted_by_kind(): void
    {
        $id = $this->community();
        $other = $this->community();
        $u = $this->member($id);

        $this->request($id, $u, ['request_type' => 'access', 'status' => 'pending']);
        $this->request($id, $u, ['request_type' => 'access', 'status' => 'processing']);
        $this->request($id, $u, ['request_type' => 'erasure', 'status' => 'pending']);
        $this->request($id, $u, ['request_type' => 'objection', 'status' => 'processing']);
        // Not open:
        $this->request($id, $u, ['request_type' => 'erasure', 'status' => 'completed', 'processed_at' => now()]);
        $this->request($id, $u, ['request_type' => 'portability', 'status' => 'rejected']);
        $this->request($id, $u, ['request_type' => 'rectification', 'status' => 'cancelled']);
        // Another community's request counts there, not here.
        $v = $this->member($other);
        $this->request($other, $v, ['request_type' => 'restriction']);
        $this->actAsPlatformTeam();

        $data = $this->data();
        $row = $this->row($data, $id);

        $this->assertSame(4, $row['open']);
        $this->assertSame(
            ['access' => 2, 'erasure' => 1, 'rectification' => 0, 'restriction' => 0, 'portability' => 0, 'objection' => 1],
            $row['open_by_type']
        );
        $this->assertSame(1, $this->row($data, $other)['open']);
        $this->assertSame(1, $this->row($data, $other)['open_by_type']['restriction']);
    }

    public function test_overdue_and_nearly_due_follow_the_30_day_rule_and_its_clock(): void
    {
        $id = $this->community();
        $u = $this->member($id);

        $this->request($id, $u, ['requested_at' => now()->subDays(45)]);                                       // overdue
        $this->request($id, $u, ['requested_at' => now()->subDays(31), 'status' => 'processing']);             // overdue
        $this->request($id, $u, ['requested_at' => null, 'created_at' => now()->subDays(40)]);                 // overdue: the clock falls back to created_at
        $this->request($id, $u, ['requested_at' => now()->subDays(27)]);                                       // nearly due
        $this->request($id, $u, ['requested_at' => now()->subDays(25)->subHour()]);                            // nearly due
        $this->request($id, $u, ['requested_at' => now()->subDays(24)]);                                       // neither
        $this->request($id, $u, ['requested_at' => now()->subDays(1)]);                                        // neither
        // A finished request is never overdue, however old.
        $this->request($id, $u, ['requested_at' => now()->subDays(90), 'status' => 'completed', 'processed_at' => now()->subDays(80)]);
        $this->request($id, $u, ['requested_at' => now()->subDays(90), 'status' => 'rejected']);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);

        $this->assertSame(7, $row['open']);
        $this->assertSame(3, $row['overdue']);
        $this->assertSame(2, $row['nearly_due']);
        $this->assertSame(45, $row['oldest_open_days']);
    }

    public function test_completed_in_the_last_90_days(): void
    {
        $id = $this->community();
        $u = $this->member($id);

        $this->request($id, $u, ['status' => 'completed', 'processed_at' => now()->subDays(3)]);
        $this->request($id, $u, ['status' => 'completed', 'processed_at' => now()->subDays(89)]);
        $this->request($id, $u, ['status' => 'completed', 'processed_at' => now()->subDays(120)]); // too long ago
        $this->request($id, $u, ['status' => 'rejected', 'processed_at' => now()->subDays(3)]);    // not completed
        $this->request($id, $u, ['status' => 'cancelled']);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);

        $this->assertSame(2, $row['completed_last_90_days']);
        $this->assertSame(0, $row['open']);
        $this->assertNull($row['oldest_open_days']);
    }

    /**
     * `updated_at` changes whenever the row is touched, so it cannot date a
     * completion. A completed request with no completion date is counted on
     * its own instead, platform-wide.
     */
    public function test_a_completed_request_with_no_completion_date_is_counted_apart_not_by_updated_at(): void
    {
        $id = $this->community();
        $u = $this->member($id);
        $this->actAsPlatformTeam();
        $before = $this->data()['totals']['completed_without_date'];

        // Completed long ago, touched yesterday: not "completed in the last 90 days".
        $this->request($id, $u, ['status' => 'completed', 'processed_at' => null, 'updated_at' => now()->subDay()]);
        $this->request($id, $u, ['status' => 'completed', 'processed_at' => null, 'updated_at' => now()->subYears(2)]);
        $this->request($id, $u, ['status' => 'rejected', 'processed_at' => null]); // not completed

        $data = $this->data();

        $this->assertSame(0, $this->row($data, $id)['completed_last_90_days']);
        $this->assertSame($before + 2, $data['totals']['completed_without_date']);
    }

    public function test_the_totals_add_up_the_rows(): void
    {
        $id = $this->community();
        $other = $this->community();
        $u = $this->member($id);
        $v = $this->member($other);
        $this->request($id, $u, ['requested_at' => now()->subDays(50), 'request_type' => 'erasure']);
        $this->request($id, $u, ['requested_at' => now()->subDays(26)]);
        $this->request($other, $v, ['requested_at' => now()->subDays(3), 'request_type' => 'portability']);
        $this->request($other, $v, ['status' => 'completed', 'processed_at' => now()->subDay()]);
        $this->actAsPlatformTeam();

        $data = $this->data();

        foreach (['open', 'overdue', 'nearly_due', 'completed_last_90_days'] as $figure) {
            $this->assertSame(array_sum(array_column($data['communities'], $figure)), $data['totals'][$figure], $figure);
        }
        foreach (self::TYPES as $type) {
            $this->assertSame(
                array_sum(array_map(static fn (array $r): int => $r['open_by_type'][$type], $data['communities'])),
                $data['totals']['open_by_type'][$type],
                $type
            );
        }
        $this->assertSame(
            max(array_map(static fn (array $r): int => (int) $r['oldest_open_days'], $data['communities'])),
            $data['totals']['oldest_open_days']
        );
        $this->assertGreaterThanOrEqual(50, $data['totals']['oldest_open_days']);
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, ['status' => 'completed'])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
