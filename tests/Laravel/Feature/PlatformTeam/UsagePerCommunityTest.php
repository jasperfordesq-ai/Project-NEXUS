<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\PlatformTeam\UsagePerCommunityService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Usage per community: for one month, each
 * community's emails (sent, failed, bounced), AI chat (requests, tokens,
 * cost), and the space its groups' files take now. Counts only; nothing
 * about a person leaves the server.
 */
class UsagePerCommunityTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/usage';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const TOP_KEYS = [
        'communities', 'generated_at', 'is_current_month', 'month', 'not_recorded', 'platform_mail', 'source_notes', 'sources', 'totals',
    ];

    private const ROW_KEYS = ['ai_chat', 'emails', 'group_file_bytes', 'id', 'is_active', 'name', 'slug'];

    /** @param array<string, mixed> $attributes */
    private function community(array $attributes = []): int
    {
        $suffix = Str::lower(Str::random(10));

        return (int) DB::table('tenants')->insertGetId(array_merge([
            'name' => 'Usage Test ' . $suffix,
            'slug' => 'usage-' . $suffix,
            'is_active' => 1,
        ], $attributes));
    }

    private function email(?int $tenantId, string $status, Carbon $at, string $recipient = 'usage-planted@example.test'): void
    {
        DB::table('email_log')->insert([
            'tenant_id' => $tenantId,
            'recipient_email' => $recipient,
            'subject' => 'Planted subject line',
            'status' => $status,
            'error' => 'planted error text',
            'created_at' => $at,
            'updated_at' => $at,
        ]);
    }

    private function aiUse(int $tenantId, int $in, int $out, string $cost, Carbon $at): void
    {
        DB::table('ai_usage')->insert([
            'tenant_id' => $tenantId,
            'user_id' => 999_001,
            'provider' => 'openai',
            'feature' => 'chat',
            'tokens_input' => $in,
            'tokens_output' => $out,
            'cost_usd' => $cost,
            'created_at' => $at,
        ]);
    }

    private function groupFile(int $tenantId, int $bytes, Carbon $at): void
    {
        DB::table('group_files')->insert([
            'group_id' => 999_002,
            'tenant_id' => $tenantId,
            'file_name' => 'planted-file-name.pdf',
            'file_path' => 'planted/path.pdf',
            'file_type' => 'application/pdf',
            'file_size' => $bytes,
            'uploaded_by' => 999_001,
            'created_at' => $at,
        ]);
    }

    private function groupMedia(int $tenantId, int $bytes, Carbon $at): void
    {
        DB::table('group_media')->insert([
            'tenant_id' => $tenantId,
            'group_id' => 999_002,
            'uploaded_by' => 999_001,
            'original_name' => 'planted-photo.jpg',
            'file_path' => 'planted/photo.jpg',
            'file_size' => $bytes,
            'created_at' => $at,
        ]);
    }

    /** @return array<string, mixed> */
    private function data(string $query = ''): array
    {
        // These tests are about the counting: drop the five-minute kept answer
        // (PlatformFiguresCacheTest covers keeping it).
        \Illuminate\Support\Facades\Cache::flush();

        return $this->apiGet(self::URI . $query)->assertStatus(200)->json('data');
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
        $this->fail("community {$communityId} is not in the list");
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

    private function thisMonth(): Carbon
    {
        return now()->startOfMonth()->addHours(3);
    }

    private function lastMonth(): Carbon
    {
        return now()->startOfMonth()->subMonthNoOverflow()->addDays(2);
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_sends_exactly_what_the_page_shows(): void
    {
        $id = $this->community();
        $this->email($id, 'failed', $this->thisMonth());
        $this->aiUse($id, 10, 5, '0.010000', $this->thisMonth());
        $this->groupFile($id, 1000, $this->thisMonth());
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $data = $response->json('data');

        $this->assertSame(self::TOP_KEYS, $this->sortedKeys($data));
        $this->assertSame(self::ROW_KEYS, $this->sortedKeys($this->row($data, $id)));
        $this->assertSame(['bounced', 'failed', 'sent'], $this->sortedKeys($this->row($data, $id)['emails']));
        $this->assertSame(['cost_usd', 'requests', 'tokens'], $this->sortedKeys($this->row($data, $id)['ai_chat']));
        $this->assertSame(['ai_chat', 'emails', 'group_files'], $this->sortedKeys($data['sources']));
        $this->assertSame(['emails'], $this->sortedKeys($data['source_notes']));
        $this->assertSame(['ai_chat', 'emails', 'group_file_bytes'], $this->sortedKeys($data['totals']));

        // Nothing about a person or a message: no address, subject, error or file name.
        $body = (string) $response->getContent();
        foreach (['usage-planted@example.test', 'Planted subject line', 'planted error text', 'planted-file-name.pdf', 'planted-photo.jpg', '999001'] as $planted) {
            $this->assertStringNotContainsString($planted, $body);
        }
    }

    public function test_it_counts_each_communitys_emails_for_the_month(): void
    {
        $id = $this->community();
        $other = $this->community();
        foreach (['sent', 'sent', 'delivered', 'failed', 'bounced', 'bounced', 'bounced', 'suppressed', 'queued'] as $status) {
            $this->email($id, $status, $this->thisMonth());
        }
        $this->email($id, 'sent', $this->lastMonth());   // another month
        $this->email($other, 'failed', $this->thisMonth()); // another community
        $this->actAsPlatformTeam();

        $emails = $this->row($this->data(), $id)['emails'];

        // "Sent" = handed to the mail service: sent, plus the ones it later
        // confirmed delivered, plus the ones that later bounced (they were
        // handed over too). Bounced is also shown on its own.
        $this->assertSame(['sent' => 6, 'failed' => 1, 'bounced' => 3], $emails);
        $this->assertSame(['sent' => 0, 'failed' => 1, 'bounced' => 0], $this->row($this->data(), $other)['emails']);
    }

    public function test_mail_with_no_community_is_its_own_row(): void
    {
        $this->actAsPlatformTeam();
        $before = $this->data()['platform_mail'];

        $this->email(null, 'sent', $this->thisMonth());
        $this->email(null, 'failed', $this->thisMonth());
        $after = $this->data()['platform_mail'];

        $this->assertSame($before['sent'] + 1, $after['sent']);
        $this->assertSame($before['failed'] + 1, $after['failed']);
        $this->assertSame($before['bounced'], $after['bounced']);
    }

    public function test_it_counts_ai_chat_requests_tokens_and_cost_for_the_month(): void
    {
        $id = $this->community();
        $this->aiUse($id, 100, 50, '0.012500', $this->thisMonth());
        $this->aiUse($id, 20, 30, '0.002500', $this->thisMonth());
        $this->aiUse($id, 999, 999, '9.000000', $this->lastMonth());
        $this->actAsPlatformTeam();

        $ai = $this->row($this->data(), $id)['ai_chat'];

        $this->assertSame(2, $ai['requests']);
        $this->assertSame(200, $ai['tokens']);
        $this->assertEqualsWithDelta(0.015, $ai['cost_usd'], 0.0000001);
    }

    public function test_group_files_are_a_total_now_not_a_monthly_figure(): void
    {
        $id = $this->community();
        $this->groupFile($id, 1_500_000, now()->subYears(2));
        $this->groupMedia($id, 250_000, $this->thisMonth());
        $this->actAsPlatformTeam();

        $this->assertSame(1_750_000, $this->row($this->data(), $id)['group_file_bytes']);
        // The same total whichever month is chosen.
        $month = $this->lastMonth()->format('Y-m');
        $this->assertSame(1_750_000, $this->row($this->data('?month=' . $month), $id)['group_file_bytes']);
    }

    public function test_a_community_with_nothing_recorded_is_listed_with_zeros(): void
    {
        $id = $this->community(['is_active' => 0]);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);

        $this->assertFalse($row['is_active']);
        $this->assertSame(['sent' => 0, 'failed' => 0, 'bounced' => 0], $row['emails']);
        $this->assertSame(0, $row['ai_chat']['requests']);
        $this->assertSame(0, $row['ai_chat']['tokens']);
        // JSON writes 0.0 as 0: the value, not its PHP type, is what the page reads.
        $this->assertEquals(0, $row['ai_chat']['cost_usd']);
        $this->assertSame(0, $row['group_file_bytes']);
    }

    public function test_an_earlier_month_can_be_chosen(): void
    {
        $id = $this->community();
        $this->email($id, 'sent', $this->lastMonth());
        $this->email($id, 'sent', $this->thisMonth());
        $this->email($id, 'sent', $this->thisMonth());
        $this->actAsPlatformTeam();

        $month = $this->lastMonth()->format('Y-m');
        $data = $this->data('?month=' . $month);

        $this->assertSame($month, $data['month']);
        $this->assertFalse($data['is_current_month']);
        $this->assertSame(1, $this->row($data, $id)['emails']['sent']);

        $current = $this->data();
        $this->assertSame(now()->format('Y-m'), $current['month']);
        $this->assertTrue($current['is_current_month']);
        $this->assertSame(2, $this->row($current, $id)['emails']['sent']);
    }

    public function test_the_last_moment_of_a_month_belongs_to_it_and_the_first_of_the_next_does_not(): void
    {
        $id = $this->community();
        $month = now()->startOfMonth()->subMonthNoOverflow();
        $this->email($id, 'failed', $month->copy()->endOfMonth()->startOfSecond());
        $this->email($id, 'failed', $month->copy()->startOfMonth());
        $this->email($id, 'failed', $month->copy()->addMonthNoOverflow()->startOfMonth());
        $this->actAsPlatformTeam();

        $this->assertSame(2, $this->row($this->data('?month=' . $month->format('Y-m')), $id)['emails']['failed']);
    }

    public function test_a_malformed_or_future_month_is_refused(): void
    {
        $this->actAsPlatformTeam();

        foreach (['2026-13', '2026-1', 'november', '2026-11-01', '0000-01', now()->addMonthNoOverflow()->format('Y-m')] as $month) {
            $this->apiGet(self::URI . '?month=' . urlencode($month))->assertStatus(422);
        }
    }

    public function test_it_lists_what_is_not_recorded_instead_of_showing_zero(): void
    {
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertSame(['maps', 'translation', 'other_storage'], $data['not_recorded']);
        $this->assertSame(['emails' => true, 'ai_chat' => true, 'group_files' => true], $data['sources']);
    }

    /**
     * Email records are deleted after 90 days (CronJobRunner), so a month
     * that starts before then would show confident zeros. It says why
     * instead, and every email figure is null.
     */
    public function test_emails_for_a_month_older_than_the_90_day_record_are_not_available_with_the_reason(): void
    {
        $id = $this->community();
        $old = now()->startOfMonth()->subMonthsNoOverflow(4);
        $this->email($id, 'sent', $old->copy()->addDays(2));
        $this->aiUse($id, 10, 5, '0.010000', $old->copy()->addDays(2));
        $this->actAsPlatformTeam();

        $data = $this->data('?month=' . $old->format('Y-m'));

        $this->assertFalse($data['sources']['emails']);
        $this->assertSame(['emails' => 'kept_90_days'], $data['source_notes']);
        $this->assertNull($this->row($data, $id)['emails']);
        $this->assertNull($data['platform_mail']);
        $this->assertNull($data['totals']['emails']);
        // The other sources are not affected.
        $this->assertTrue($data['sources']['ai_chat']);
        $this->assertSame(1, $this->row($data, $id)['ai_chat']['requests']);

        // A recent month carries no note.
        $this->assertSame(['emails' => null], $this->data()['source_notes']);
        $this->assertTrue($this->data()['sources']['emails']);
    }

    public function test_totals_add_up_every_community(): void
    {
        $id = $this->community();
        $this->actAsPlatformTeam();
        $before = $this->data()['totals'];

        $this->email($id, 'bounced', $this->thisMonth());
        $this->aiUse($id, 7, 3, '0.500000', $this->thisMonth());
        $this->groupFile($id, 4096, $this->thisMonth());
        $after = $this->data()['totals'];

        $this->assertSame($before['emails']['bounced'] + 1, $after['emails']['bounced']);
        $this->assertSame($before['emails']['sent'] + 1, $after['emails']['sent'], 'a bounced email was handed over');
        $this->assertSame($before['ai_chat']['requests'] + 1, $after['ai_chat']['requests']);
        $this->assertSame($before['ai_chat']['tokens'] + 10, $after['ai_chat']['tokens']);
        $this->assertSame($before['group_file_bytes'] + 4096, $after['group_file_bytes']);
    }

    /** A record that cannot be read is "not available", never a zero. */
    public function test_a_part_that_cannot_be_read_says_so_and_keeps_its_reason_on_the_server(): void
    {
        $result = (new UsagePerCommunityService())->guarded('test', static function (): array {
            throw new \RuntimeException('planted reason usage-planted@example.test');
        });

        $this->assertSame(['available' => false], $result);
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, ['month' => '2026-01'])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
