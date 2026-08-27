<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AhvPensionExportService
{
    public const FORMAT_VERSION = '0.1-provisional';

    public function build(int $tenantId, int $userId, ?string $fromDate = null, ?string $toDate = null): array
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first(['id', 'slug', 'name']);
        $member = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->first(['id', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name']);

        $rows = $this->approvedContributionRows($tenantId, $userId, $fromDate, $toDate);
        $totalHours = array_reduce(
            $rows,
            fn (float $carry, array $row): float => $carry + (float) $row['hours'],
            0.0
        );

        return [
            'format_version' => self::FORMAT_VERSION,
            'generated_at' => now()->toIso8601String(),
            'official_interface' => [
                'status' => 'pending_official_ahv_specification',
                'official_submission_supported' => false,
                'export_type' => 'evidence_pack',
            ],
            'tenant' => [
                'id' => $tenant ? (int) $tenant->id : $tenantId,
                'slug' => $tenant->slug ?? null,
                'name' => $tenant->name ?? null,
            ],
            'member' => [
                'id' => $member ? (int) $member->id : $userId,
                'name' => $this->memberName($member),
            ],
            'period' => [
                'from' => $fromDate,
                'to' => $toDate,
            ],
            'summary' => [
                'approved_hours' => round($totalHours, 2),
                'row_count' => count($rows),
                'years' => $this->totalsByYear($rows),
            ],
            'contribution_rows' => $rows,
        ];
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private function approvedContributionRows(int $tenantId, int $userId, ?string $fromDate, ?string $toDate): array
    {
        if (!Schema::hasTable('vol_logs')) {
            return [];
        }

        $query = DB::table('vol_logs as vl')
            ->where('vl.tenant_id', $tenantId)
            ->where('vl.user_id', $userId)
            ->where('vl.status', 'approved')
            ->orderBy('vl.date_logged')
            ->orderBy('vl.id');

        if ($fromDate !== null && $fromDate !== '') {
            $query->whereDate('vl.date_logged', '>=', $fromDate);
        }
        if ($toDate !== null && $toDate !== '') {
            $query->whereDate('vl.date_logged', '<=', $toDate);
        }

        $rows = $query->get([
            'vl.id',
            'vl.date_logged',
            'vl.hours',
            'vl.organization_id',
            'vl.opportunity_id',
            'vl.caring_support_relationship_id',
            'vl.support_recipient_id',
            'vl.created_at',
            'vl.updated_at',
        ]);

        return $rows->map(fn ($row) => [
            'source' => 'vol_log',
            'record_id' => (int) $row->id,
            'date' => (string) $row->date_logged,
            'year' => (int) substr((string) $row->date_logged, 0, 4),
            'hours' => round((float) $row->hours, 2),
            'status' => 'approved',
            'organization_id' => $row->organization_id ? (int) $row->organization_id : null,
            'opportunity_id' => $row->opportunity_id ? (int) $row->opportunity_id : null,
            'caring_support_relationship_id' => $row->caring_support_relationship_id ? (int) $row->caring_support_relationship_id : null,
            'support_recipient_id' => $row->support_recipient_id ? (int) $row->support_recipient_id : null,
            'recorded_at' => $row->created_at,
            'verified_at' => $row->updated_at,
        ])->all();
    }

    /**
     * @param array<int,array<string,mixed>> $rows
     * @return array<int,array{year:int,approved_hours:float,row_count:int}>
     */
    private function totalsByYear(array $rows): array
    {
        $years = [];
        foreach ($rows as $row) {
            $year = (int) $row['year'];
            $years[$year] ??= ['year' => $year, 'approved_hours' => 0.0, 'row_count' => 0];
            $years[$year]['approved_hours'] = round($years[$year]['approved_hours'] + (float) $row['hours'], 2);
            $years[$year]['row_count']++;
        }

        ksort($years);
        return array_values($years);
    }

    private function memberName(?object $member): ?string
    {
        if (!$member) {
            return null;
        }

        $name = trim((string) ($member->name ?? ''));
        if ($name !== '') {
            return $name;
        }

        $parts = array_filter([
            trim((string) ($member->first_name ?? '')),
            trim((string) ($member->last_name ?? '')),
        ]);

        return $parts ? implode(' ', $parts) : null;
    }
}
