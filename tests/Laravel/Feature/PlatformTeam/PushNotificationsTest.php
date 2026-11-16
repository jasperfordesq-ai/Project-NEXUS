<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\PlatformTeam\PushNotificationsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Push notifications: per day (server time, UTC) and
 * per community, how many recorded pushes the push service accepted, partly
 * accepted, failed, or had nobody to send to. Counts only; nothing about a
 * person or a message leaves the server.
 */
class PushNotificationsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/push-notifications';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const TOP_KEYS = ['available', 'by_community', 'by_day', 'days', 'no_community'];

    private const DAY_KEYS = ['accepted', 'date', 'failed', 'nobody_to_send_to', 'partial'];

    private const COMMUNITY_KEYS = ['accepted', 'failed', 'id', 'name', 'partial'];

    /** @param array<string, mixed> $attributes */
    private function community(array $attributes = []): int
    {
        $suffix = Str::lower(Str::random(10));

        return (int) DB::table('tenants')->insertGetId(array_merge([
            'name' => 'Push Test ' . $suffix,
            'slug' => 'push-' . $suffix,
            'is_active' => 1,
        ], $attributes));
    }

    private function push(?int $tenantId, string $status, Carbon $at): void
    {
        DB::table('push_log')->insert([
            'tenant_id' => $tenantId,
            'user_id' => 987_654,
            'activity_type' => 'new_message',
            'title' => 'Planted push title',
            'web_ok' => 1,
            'fcm_sent' => 1,
            'fcm_failed' => 0,
            'status' => $status,
            'error' => 'planted-token-fragment-abc123',
            'created_at' => $at,
        ]);
    }

    /** @return array<string, mixed> */
    private function data(string $query = ''): array
    {
        return $this->apiGet(self::URI . $query)->assertStatus(200)->json('data');
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function communityRow(array $data, int $id): array
    {
        foreach ($data['by_community'] as $row) {
            if ((int) $row['id'] === $id) {
                return $row;
            }
        }
        $this->fail("community {$id} is not in the list");
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function dayRow(array $data, string $date): array
    {
        foreach ($data['by_day'] as $row) {
            if ($row['date'] === $date) {
                return $row;
            }
        }
        $this->fail("day {$date} is not in the list");
    }

    /**
     * @param array<string, mixed> $array
     * @return list<string>
     */
    private function sortedKeys(array $array): array
    {
        $keys = array_keys($array);
        sort($keys);

        return $keys;
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_sends_exactly_what_the_page_shows_and_nothing_about_a_person(): void
    {
        $id = $this->community();
        foreach (['delivered', 'partial', 'failed', 'no_targets'] as $status) {
            $this->push($id, $status, now()->subHour());
        }
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $data = $response->json('data');

        $this->assertSame(self::TOP_KEYS, $this->sortedKeys($data));
        $this->assertSame(self::DAY_KEYS, $this->sortedKeys($data['by_day'][0]));
        $this->assertSame(self::COMMUNITY_KEYS, $this->sortedKeys($this->communityRow($data, $id)));
        $this->assertSame(['accepted', 'failed', 'partial'], $this->sortedKeys($data['no_community']));

        // 🔴 Never the error text (it may hold token fragments), the title, or a user id.
        $body = (string) $response->getContent();
        foreach (['planted-token-fragment-abc123', 'Planted push title', '987654', 'new_message'] as $planted) {
            $this->assertStringNotContainsString($planted, $body);
        }
    }

    public function test_it_counts_each_day_by_outcome_and_lists_quiet_days_with_zeros(): void
    {
        $this->actAsPlatformTeam();
        $today = now()->startOfDay();
        $before = $this->data('?days=7');
        $todayBefore = $this->dayRow($before, $today->toDateString());

        $id = $this->community();
        foreach (['delivered', 'delivered', 'partial', 'failed', 'no_targets', 'no_targets', 'no_targets'] as $status) {
            $this->push($id, $status, $today->copy()->addMinutes(1));
        }
        $this->push(null, 'delivered', $today->copy()->addMinutes(2)); // no community: still counted in the day

        $data = $this->data('?days=7');
        $row = $this->dayRow($data, $today->toDateString());

        $this->assertSame($todayBefore['accepted'] + 3, $row['accepted']);
        $this->assertSame($todayBefore['partial'] + 1, $row['partial']);
        $this->assertSame($todayBefore['failed'] + 1, $row['failed']);
        $this->assertSame($todayBefore['nobody_to_send_to'] + 3, $row['nobody_to_send_to']);

        // Seven days, oldest first, ending today: every one listed even when nothing happened.
        $this->assertSame(7, $data['days']);
        $this->assertCount(7, $data['by_day']);
        $this->assertSame($today->copy()->subDays(6)->toDateString(), $data['by_day'][0]['date']);
        $this->assertSame($today->toDateString(), $data['by_day'][6]['date']);
    }

    public function test_a_push_just_before_the_window_is_not_counted(): void
    {
        $this->actAsPlatformTeam();
        $start = now()->startOfDay()->subDays(6);
        $before = $this->data('?days=7');
        $firstBefore = $before['by_day'][0];

        $this->push(null, 'failed', $start->copy()->subSecond()); // the day before the window
        $this->push(null, 'failed', $start->copy());              // the first moment of the window

        $after = $this->data('?days=7');
        $this->assertSame($start->toDateString(), $after['by_day'][0]['date']);
        $this->assertSame($firstBefore['failed'] + 1, $after['by_day'][0]['failed']);
    }

    public function test_it_counts_each_community_over_the_window(): void
    {
        $id = $this->community();
        $other = $this->community();
        $this->push($id, 'delivered', now()->subDays(3));
        $this->push($id, 'delivered', now()->subHour());
        $this->push($id, 'partial', now()->subHour());
        $this->push($id, 'failed', now()->subHour());
        $this->push($id, 'no_targets', now()->subHour());   // not one of the three community figures
        $this->push($id, 'failed', now()->subDays(20));     // outside a 14-day window
        $this->push($other, 'failed', now()->subHour());
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertSame(14, $data['days']);
        $row = $this->communityRow($data, $id);
        $this->assertSame(['accepted' => 2, 'partial' => 1, 'failed' => 1], [
            'accepted' => $row['accepted'], 'partial' => $row['partial'], 'failed' => $row['failed'],
        ]);
        $this->assertSame(1, $this->communityRow($data, $other)['failed']);

        // A longer window reaches the older failure.
        $this->assertSame(2, $this->communityRow($this->data('?days=30'), $id)['failed']);
    }

    public function test_a_community_with_nothing_recorded_is_listed_with_zeros(): void
    {
        $id = $this->community(['is_active' => 0]);
        $this->actAsPlatformTeam();

        $row = $this->communityRow($this->data(), $id);

        $this->assertSame(['accepted' => 0, 'partial' => 0, 'failed' => 0], [
            'accepted' => $row['accepted'], 'partial' => $row['partial'], 'failed' => $row['failed'],
        ]);
        $this->assertNotNull($row['name']);
    }

    public function test_pushes_with_no_community_are_their_own_figure(): void
    {
        $this->actAsPlatformTeam();
        $before = $this->data()['no_community'];

        $this->push(null, 'delivered', now()->subHour());
        $this->push(null, 'failed', now()->subHour());

        $after = $this->data()['no_community'];
        $this->assertSame($before['accepted'] + 1, $after['accepted']);
        $this->assertSame($before['failed'] + 1, $after['failed']);
        $this->assertSame($before['partial'], $after['partial']);
    }

    public function test_a_number_of_days_outside_one_to_thirty_is_refused(): void
    {
        $this->actAsPlatformTeam();

        foreach (['0', '31', '-1', 'seven', '7.5', '1e1', ''] as $days) {
            if ($days === '') {
                continue; // empty means the default, checked below
            }
            $response = $this->apiGet(self::URI . '?days=' . urlencode($days))->assertStatus(422);
            $this->assertStringContainsString(__('api.platform_push_days_invalid'), (string) $response->getContent());
        }

        $this->assertSame(1, $this->data('?days=1')['days']);
        $this->assertSame(30, $this->data('?days=30')['days']);
        $this->assertSame(14, $this->data('?days=')['days']);
    }

    /** A record that cannot be read is "not available", never a zero. */
    public function test_a_record_that_cannot_be_read_says_so_and_keeps_its_reason_on_the_server(): void
    {
        $result = (new PushNotificationsService())->guarded(static function (): array {
            throw new \RuntimeException('planted reason planted-token-fragment-abc123');
        });

        $this->assertSame(['available' => false], $result);
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, ['days' => 7])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
