<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Usage per community.
 *
 * For one calendar month (app timezone), per community:
 *
 *   emails            `email_log` rows created in the month, by status.
 *                     sent    = `sent` + `delivered`: handed to the mail
 *                               service (`delivered` is the same row after the
 *                               service confirmed it, PostmarkWebhookController).
 *                     failed  = `failed`: the platform could not hand it over.
 *                     bounced = `bounced`: handed over, then reported bounced
 *                               (the webhook rewrites the row's status).
 *                     `suppressed` (never attempted: address on the
 *                     suppression list) and `queued` are not counted in any
 *                     of the three. Mail with no community (`tenant_id` NULL)
 *                     is its own row, `platform_mail`.
 *   ai_chat           `ai_usage` rows created in the month: requests = rows,
 *                     tokens = input + output, cost_usd = sum as recorded.
 *   group_file_bytes  `group_files.file_size` + `group_media.file_size`, as
 *                     GroupFileService::assertQuotaAvailable() counts a
 *                     community's quota. 🔴 A total NOW, not a monthly figure:
 *                     the same whichever month is chosen.
 *
 * `not_recorded` names what the platform does not record anywhere (map
 * look-ups, automatic translation, every other stored file). The page lists
 * them in words; they must never be shown as zero.
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter, query builder only
 * (Eloquent models would scope to the caller's community). Correct only
 * because nothing below the platform team can call it. Counts and sums only:
 * no address, subject, error text, file name or user id is selected.
 *
 * Each source is read on its own, one grouped query per figure. One that
 * throws is reported as not available and its reason is logged, not sent: an
 * unreadable record must never look like "nothing was used".
 */
final class UsagePerCommunityService
{
    public const NOT_RECORDED = ['maps', 'translation', 'other_storage'];

    /** email_log statuses counted as "sent": handed to the mail service. */
    private const SENT_STATUSES = ['sent', 'delivered'];

    /**
     * The month asked for, or null when it is malformed, before 2000, or in
     * the future. Null input means this month.
     */
    public static function parseMonth(mixed $month): ?Carbon
    {
        if ($month === null || $month === '') {
            return now()->startOfMonth();
        }
        if (!is_string($month) || preg_match('/^(\d{4})-(0[1-9]|1[0-2])$/', $month, $m) !== 1) {
            return null;
        }
        $year = (int) $m[1];
        if ($year < 2000) {
            return null;
        }
        $start = Carbon::create($year, (int) $m[2], 1, 0, 0, 0, (string) config('app.timezone', 'UTC'));
        if ($start === null || $start->greaterThan(now()->startOfMonth())) {
            return null;
        }

        return $start;
    }

    /** @return array<string, mixed> */
    public function report(Carbon $monthStart): array
    {
        $from = $monthStart->copy()->startOfMonth();
        $until = $from->copy()->addMonthNoOverflow(); // exclusive

        $emails = $this->guarded('emails', fn (): array => $this->emails($from, $until));
        $ai = $this->guarded('ai_chat', fn (): array => $this->aiChat($from, $until));
        $files = $this->guarded('group_files', fn (): array => $this->groupFiles());

        $emailRows = $emails['available'] ? $emails['by_community'] : [];
        $aiRows = $ai['available'] ? $ai['by_community'] : [];
        $fileRows = $files['available'] ? $files['by_community'] : [];

        $communities = [];
        $seen = [];
        foreach (DB::table('tenants')->orderBy('name')->orderBy('id')->get(['id', 'name', 'slug', 'is_active']) as $tenant) {
            $id = (int) $tenant->id;
            $seen[$id] = true;
            $communities[] = $this->row($id, (string) $tenant->name, $tenant->slug !== null ? (string) $tenant->slug : null, !empty($tenant->is_active), $emails, $ai, $files);
        }
        // Records of a community that no longer exists: still listed, so the totals add up.
        $orphans = array_diff(array_unique(array_merge(array_keys($emailRows), array_keys($aiRows), array_keys($fileRows))), array_keys($seen));
        sort($orphans);
        foreach ($orphans as $id) {
            $communities[] = $this->row((int) $id, null, null, false, $emails, $ai, $files);
        }

        return [
            'month' => $from->format('Y-m'),
            'is_current_month' => $from->format('Y-m') === now()->format('Y-m'),
            'sources' => [
                'emails' => $emails['available'],
                'ai_chat' => $ai['available'],
                'group_files' => $files['available'],
            ],
            'communities' => $communities,
            'platform_mail' => $emails['available'] ? $emails['platform'] : null,
            'totals' => [
                'emails' => $emails['available'] ? self::sumEmails(array_merge(array_values($emailRows), [$emails['platform']])) : null,
                'ai_chat' => $ai['available'] ? self::sumAi(array_values($aiRows)) : null,
                'group_file_bytes' => $files['available'] ? array_sum($fileRows) : null,
            ],
            'not_recorded' => self::NOT_RECORDED,
        ];
    }

    /**
     * Run one source. One that cannot be read answers `['available' => false]`
     * and nothing else: the reason goes to the log, never to the browser.
     *
     * @param callable(): array<string, mixed> $read
     * @return array<string, mixed>
     */
    public function guarded(string $source, callable $read): array
    {
        try {
            return ['available' => true] + $read();
        } catch (\Throwable $e) {
            Log::error('Platform team usage page: a source could not be read', [
                'source' => $source,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            return ['available' => false];
        }
    }

    /**
     * @param array<string, mixed> $emails
     * @param array<string, mixed> $ai
     * @param array<string, mixed> $files
     * @return array<string, mixed>
     */
    private function row(int $id, ?string $name, ?string $slug, bool $active, array $emails, array $ai, array $files): array
    {
        return [
            'id' => $id,
            'name' => $name,
            'slug' => $slug,
            'is_active' => $active,
            'emails' => $emails['available'] ? ($emails['by_community'][$id] ?? self::noEmails()) : null,
            'ai_chat' => $ai['available'] ? ($ai['by_community'][$id] ?? ['requests' => 0, 'tokens' => 0, 'cost_usd' => 0.0]) : null,
            'group_file_bytes' => $files['available'] ? ($files['by_community'][$id] ?? 0) : null,
        ];
    }

    /** @return array{by_community: array<int, array{sent: int, failed: int, bounced: int}>, platform: array{sent: int, failed: int, bounced: int}} */
    private function emails(Carbon $from, Carbon $until): array
    {
        // 🔴 Cross-community on purpose (see the class comment).
        $rows = DB::table('email_log')
            ->where('created_at', '>=', $from)
            ->where('created_at', '<', $until)
            ->whereIn('status', array_merge(self::SENT_STATUSES, ['failed', 'bounced']))
            ->groupBy('tenant_id', 'status')
            ->get(['tenant_id', 'status', DB::raw('COUNT(*) as n')]);

        $byCommunity = [];
        $platform = self::noEmails();
        foreach ($rows as $row) {
            $key = in_array($row->status, self::SENT_STATUSES, true) ? 'sent' : (string) $row->status;
            if ($row->tenant_id === null) {
                $platform[$key] += (int) $row->n;
                continue;
            }
            $id = (int) $row->tenant_id;
            $byCommunity[$id] ??= self::noEmails();
            $byCommunity[$id][$key] += (int) $row->n;
        }

        return ['by_community' => $byCommunity, 'platform' => $platform];
    }

    /** @return array{by_community: array<int, array{requests: int, tokens: int, cost_usd: float}>} */
    private function aiChat(Carbon $from, Carbon $until): array
    {
        // 🔴 Cross-community on purpose (see the class comment).
        $rows = DB::table('ai_usage')
            ->where('created_at', '>=', $from)
            ->where('created_at', '<', $until)
            ->groupBy('tenant_id')
            ->get([
                'tenant_id',
                DB::raw('COUNT(*) as requests'),
                DB::raw('COALESCE(SUM(COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0)), 0) as tokens'),
                DB::raw('COALESCE(SUM(cost_usd), 0) as cost'),
            ]);

        $byCommunity = [];
        foreach ($rows as $row) {
            $byCommunity[(int) $row->tenant_id] = [
                'requests' => (int) $row->requests,
                'tokens' => (int) $row->tokens,
                'cost_usd' => round((float) $row->cost, 6),
            ];
        }

        return ['by_community' => $byCommunity];
    }

    /** @return array{by_community: array<int, int>} */
    private function groupFiles(): array
    {
        $byCommunity = [];
        // 🔴 Cross-community on purpose. The two tables GroupFileService counts towards a quota.
        foreach (['group_files', 'group_media'] as $table) {
            $sums = DB::table($table)
                ->groupBy('tenant_id')
                ->get(['tenant_id', DB::raw('COALESCE(SUM(file_size), 0) as bytes')]);
            foreach ($sums as $row) {
                $id = (int) $row->tenant_id;
                $byCommunity[$id] = ($byCommunity[$id] ?? 0) + (int) $row->bytes;
            }
        }

        return ['by_community' => $byCommunity];
    }

    /** @return array{sent: int, failed: int, bounced: int} */
    private static function noEmails(): array
    {
        return ['sent' => 0, 'failed' => 0, 'bounced' => 0];
    }

    /**
     * @param list<array{sent: int, failed: int, bounced: int}> $rows
     * @return array{sent: int, failed: int, bounced: int}
     */
    private static function sumEmails(array $rows): array
    {
        $total = self::noEmails();
        foreach ($rows as $row) {
            foreach ($total as $key => $value) {
                $total[$key] = $value + $row[$key];
            }
        }

        return $total;
    }

    /**
     * @param list<array{requests: int, tokens: int, cost_usd: float}> $rows
     * @return array{requests: int, tokens: int, cost_usd: float}
     */
    private static function sumAi(array $rows): array
    {
        $total = ['requests' => 0, 'tokens' => 0, 'cost_usd' => 0.0];
        foreach ($rows as $row) {
            $total['requests'] += $row['requests'];
            $total['tokens'] += $row['tokens'];
            $total['cost_usd'] += $row['cost_usd'];
        }
        $total['cost_usd'] = round($total['cost_usd'], 6);

        return $total;
    }
}
