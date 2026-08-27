<?php
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Support\CsvExportSanitizer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * Builds KISS-style member statements from timebank and verified support activity.
 */
class CaringCommunityMemberStatementService
{
    public function __construct(
        private readonly CaringCommunityWorkflowPolicyService $policyService,
    ) {
    }

    public function statement(int $tenantId, int $userId, array $filters = []): ?array
    {
        $user = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->select(['id', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name', 'email', 'balance'])
            ->first();

        if (!$user) {
            return null;
        }

        $policy = $this->policyService->get($tenantId);
        $period = $this->period($filters, (int) $policy['monthly_statement_day']);
        $supportLogs = $this->supportLogs($tenantId, $userId, $period);
        $walletTransactions = $this->walletTransactions($tenantId, $userId, $period);
        $summary = $this->summary($supportLogs, $walletTransactions, (float) $user->balance, (int) $policy['default_hour_value_chf']);

        return [
            'user' => [
                'id' => (int) $user->id,
                'name' => $this->displayName($user),
                'email' => (string) $user->email,
                'current_balance' => round((float) $user->balance, 2),
            ],
            'period' => $period,
            'policy' => [
                'monthly_statement_day' => (int) $policy['monthly_statement_day'],
                'hour_value_chf' => (int) $policy['default_hour_value_chf'],
                'include_social_value_estimate' => (bool) $policy['include_social_value_estimate'],
            ],
            'summary' => $summary,
            'support_hours_by_organisation' => $this->supportHoursByOrganisation($supportLogs),
            'support_logs' => $supportLogs,
            'wallet_transactions' => $walletTransactions,
        ];
    }

    public function csv(int $tenantId, int $userId, array $filters = []): ?array
    {
        $statement = $this->statement($tenantId, $userId, $filters);
        if (!$statement) {
            return null;
        }

        $rows = [
            [
                __('api.caring_member_statement_csv_date'),
                __('api.caring_member_statement_csv_type'),
                __('api.caring_member_statement_csv_partner'),
                __('api.caring_member_statement_csv_description'),
                __('api.caring_member_statement_csv_hours'),
                __('api.caring_member_statement_csv_status'),
            ],
        ];

        foreach ($statement['support_logs'] as $log) {
            $rows[] = [
                $log['date'],
                __('api.caring_member_statement_csv_support_hours'),
                $log['organisation_name'],
                $log['description'],
                (string) $log['hours'],
                $log['status'],
            ];
        }

        foreach ($statement['wallet_transactions'] as $transaction) {
            $rows[] = [
                $transaction['date'],
                $transaction['direction'],
                $transaction['counterparty_name'],
                $transaction['description'],
                (string) $transaction['signed_amount'],
                $transaction['status'],
            ];
        }

        return [
            'filename' => sprintf(
                'caring-community-statement-%d-%s-%s.csv',
                $statement['user']['id'],
                $statement['period']['start'],
                $statement['period']['end'],
            ),
            'csv' => $this->toCsv($rows),
            'statement' => $statement,
        ];
    }

    /**
     * @return array{start: string, end: string, statement_day: int}
     */
    private function period(array $filters, int $statementDay): array
    {
        $end = $this->normaliseDate($filters['end_date'] ?? null) ?? date('Y-m-d');
        $start = $this->normaliseDate($filters['start_date'] ?? null);

        if ($start === null) {
            $anchor = date('Y-m-', strtotime($end)) . str_pad((string) $statementDay, 2, '0', STR_PAD_LEFT);
            if (strtotime($anchor) > strtotime($end)) {
                $anchor = date('Y-m-d', strtotime($anchor . ' -1 month'));
            }
            $start = $anchor;
        }

        if (strtotime($start) > strtotime($end)) {
            [$start, $end] = [$end, $start];
        }

        return [
            'start' => $start,
            'end' => $end,
            'statement_day' => $statementDay,
        ];
    }

    private function normaliseDate(mixed $date): ?string
    {
        if (!is_string($date) || trim($date) === '') {
            return null;
        }

        $timestamp = strtotime($date);
        return $timestamp === false ? null : date('Y-m-d', $timestamp);
    }

    private function supportLogs(int $tenantId, int $userId, array $period): array
    {
        if (!Schema::hasTable('vol_logs')) {
            return [];
        }

        $rows = DB::select(
            "SELECT
                vl.id,
                vl.date_logged,
                vl.hours,
                vl.status,
                vl.description,
                vl.created_at,
                vo.name AS organisation_name,
                opp.title AS opportunity_title
             FROM vol_logs vl
             LEFT JOIN vol_organizations vo ON vo.id = vl.organization_id AND vo.tenant_id = vl.tenant_id
             LEFT JOIN vol_opportunities opp ON opp.id = vl.opportunity_id AND opp.tenant_id = vl.tenant_id
             WHERE vl.tenant_id = ?
               AND vl.user_id = ?
               AND vl.date_logged BETWEEN ? AND ?
             ORDER BY vl.date_logged DESC, vl.id DESC",
            [$tenantId, $userId, $period['start'], $period['end']]
        );

        return array_map(fn (object $row): array => [
            'id' => (int) $row->id,
            'date' => (string) $row->date_logged,
            'hours' => round((float) $row->hours, 2),
            'status' => (string) $row->status,
            'description' => (string) ($row->description ?? ''),
            'organisation_name' => (string) ($row->organisation_name ?? ''),
            'opportunity_title' => (string) ($row->opportunity_title ?? ''),
            'created_at' => (string) $row->created_at,
        ], $rows);
    }

    private function walletTransactions(int $tenantId, int $userId, array $period): array
    {
        $rows = DB::select(
            "SELECT
                t.id,
                t.sender_id,
                t.receiver_id,
                t.amount,
                t.description,
                t.status,
                t.transaction_type,
                t.created_at,
                sender.name AS sender_name,
                receiver.name AS receiver_name
             FROM transactions t
             LEFT JOIN users sender ON sender.id = t.sender_id AND sender.tenant_id = t.tenant_id
             LEFT JOIN users receiver ON receiver.id = t.receiver_id AND receiver.tenant_id = t.tenant_id
             WHERE t.tenant_id = ?
               AND (t.sender_id = ? OR t.receiver_id = ?)
               AND DATE(t.created_at) BETWEEN ? AND ?
             ORDER BY t.created_at DESC, t.id DESC",
            [$tenantId, $userId, $userId, $period['start'], $period['end']]
        );

        return array_map(function (object $row) use ($userId): array {
            $earned = (int) $row->receiver_id === $userId;
            return [
                'id' => (int) $row->id,
                'date' => substr((string) $row->created_at, 0, 10),
                'direction' => $earned ? 'earned' : 'spent',
                'counterparty_name' => $earned ? (string) ($row->sender_name ?? '') : (string) ($row->receiver_name ?? ''),
                'amount' => (float) $row->amount,
                'signed_amount' => $earned ? (float) $row->amount : -(float) $row->amount,
                'description' => (string) ($row->description ?? ''),
                'status' => (string) $row->status,
                'transaction_type' => (string) $row->transaction_type,
                'created_at' => (string) $row->created_at,
            ];
        }, $rows);
    }

    private function summary(array $supportLogs, array $walletTransactions, float $currentBalance, int $hourValueChf): array
    {
        $approvedHours = 0.0;
        $pendingHours = 0.0;
        $declinedCount = 0;

        foreach ($supportLogs as $log) {
            if ($log['status'] === 'approved') {
                $approvedHours += (float) $log['hours'];
            } elseif ($log['status'] === 'pending') {
                $pendingHours += (float) $log['hours'];
            } elseif ($log['status'] === 'declined') {
                $declinedCount++;
            }
        }

        $earned = 0.0;
        $spent = 0.0;
        foreach ($walletTransactions as $transaction) {
            if ($transaction['direction'] === 'earned') {
                $earned += (float) $transaction['amount'];
            } else {
                $spent += (float) $transaction['amount'];
            }
        }

        return [
            'approved_support_hours' => round($approvedHours, 2),
            'pending_support_hours' => round($pendingHours, 2),
            'declined_support_logs' => $declinedCount,
            'wallet_hours_earned' => round($earned, 2),
            'wallet_hours_spent' => round($spent, 2),
            'wallet_net_change' => round($earned - $spent, 2),
            'current_balance' => round($currentBalance, 2),
            'estimated_social_value_chf' => round($approvedHours * $hourValueChf, 2),
        ];
    }

    private function supportHoursByOrganisation(array $supportLogs): array
    {
        $groups = [];
        foreach ($supportLogs as $log) {
            $name = $log['organisation_name'] !== '' ? $log['organisation_name'] : __('api.caring_member_statement_unknown_partner');
            $groups[$name] ??= [
                'organisation_name' => $name,
                'approved_hours' => 0.0,
                'pending_hours' => 0.0,
                'log_count' => 0,
            ];
            $groups[$name]['log_count']++;
            if ($log['status'] === 'approved') {
                $groups[$name]['approved_hours'] += (float) $log['hours'];
            } elseif ($log['status'] === 'pending') {
                $groups[$name]['pending_hours'] += (float) $log['hours'];
            }
        }

        return array_values(array_map(fn (array $group): array => [
            'organisation_name' => $group['organisation_name'],
            'approved_hours' => round((float) $group['approved_hours'], 2),
            'pending_hours' => round((float) $group['pending_hours'], 2),
            'log_count' => (int) $group['log_count'],
        ], $groups));
    }

    private function displayName(object $user): string
    {
        $fullName = UserDisplayName::resolve($user);
        return $fullName !== '' ? $fullName : (string) ($user->name ?? $user->email);
    }

    private function toCsv(array $rows): string
    {
        $lines = [];
        foreach ($rows as $row) {
            $lines[] = implode(',', array_map(
                fn (string $value): string => '"' . str_replace('"', '""', $value) . '"',
                CsvExportSanitizer::row($row),
            ));
        }

        return implode("\n", $lines) . "\n";
    }
}
