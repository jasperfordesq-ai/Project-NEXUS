<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * AdminAuditLogController — tenant-wide audit log export.
 *
 * Streams the platform audit trail (activity_log) or the admin/organisation
 * audit trail (org_audit_log) as CSV so administrators can archive activity
 * for reporting and analysis (IT-Sec-03 style compliance requirement).
 * Always scoped to the requesting admin's tenant.
 */
class AdminAuditLogController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** Hard cap per export to keep memory/transfer bounded; filter by date to narrow. */
    private const MAX_ROWS = 100000;

    /** GET /api/v2/admin/audit-log/export.csv?log=activity|admin&date_from=&date_to=&user_id=&action= */
    public function exportCsv(): StreamedResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $log = request()->query('log', 'activity');
        if (!in_array($log, ['activity', 'admin'], true)) {
            $log = 'activity';
        }

        $filters = [
            'action' => request()->query('action'),
            'user_id' => request()->query('user_id'),
            'date_from' => request()->query('date_from'),
            'date_to' => request()->query('date_to'),
        ];

        $filename = sprintf('audit-log-%s-%s.csv', $log, now()->format('Ymd-His'));

        return response()->streamDownload(function () use ($log, $tenantId, $filters) {
            if ($log === 'admin') {
                $this->streamOrgAuditLog($tenantId, $filters);
            } else {
                $this->streamActivityLog($tenantId, $filters);
            }
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** @param array<string, mixed> $filters */
    private function streamActivityLog(int $tenantId, array $filters): void
    {
        $handle = fopen('php://output', 'w');
        // BOM so Excel reads UTF-8 names/details correctly.
        fwrite($handle, "\xEF\xBB\xBF");
        $this->putRow($handle, ['ID', 'User ID', 'User', 'Action', 'Action Type', 'Entity Type', 'Entity ID', 'Details', 'IP Address', 'Date']);

        [$where, $params] = $this->buildWhere('al', $tenantId, $filters);

        try {
            $rows = DB::cursor(
                "SELECT al.id, al.user_id, al.action, al.action_type, al.entity_type, al.entity_id,
                        al.details, al.ip_address, al.created_at,
                        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS user_name
                 FROM activity_log al
                 LEFT JOIN users u ON u.id = al.user_id AND u.tenant_id = al.tenant_id
                 WHERE {$where}
                 ORDER BY al.created_at DESC, al.id DESC
                 LIMIT " . self::MAX_ROWS,
                $params
            );

            foreach ($rows as $row) {
                $this->putRow($handle, [
                    $row->id,
                    $row->user_id ?? '',
                    trim($row->user_name ?? ''),
                    $row->action ?? '',
                    $row->action_type ?? '',
                    $row->entity_type ?? '',
                    $row->entity_id ?? '',
                    $row->details ?? '',
                    $row->ip_address ?? '',
                    $row->created_at ?? '',
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('[AdminAuditLog] activity export failed: ' . $e->getMessage(), ['tenant_id' => $tenantId]);
            $this->putRow($handle, [__('api.audit_export_failed'), '', '', '', '', '', '', '', '', '']);
        }

        fclose($handle);
    }

    /** @param array<string, mixed> $filters */
    private function streamOrgAuditLog(int $tenantId, array $filters): void
    {
        $handle = fopen('php://output', 'w');
        // BOM so Excel reads UTF-8 names/details correctly.
        fwrite($handle, "\xEF\xBB\xBF");
        $this->putRow($handle, ['ID', 'Organization ID', 'Actor User ID', 'Actor', 'Target User ID', 'Action', 'Details', 'IP Address', 'User Agent', 'Date']);

        [$where, $params] = $this->buildWhere('oal', $tenantId, $filters);

        try {
            $rows = DB::cursor(
                "SELECT oal.id, oal.organization_id, oal.user_id, oal.target_user_id, oal.action,
                        oal.details, oal.ip_address, oal.user_agent, oal.created_at,
                        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS user_name
                 FROM org_audit_log oal
                 LEFT JOIN users u ON u.id = oal.user_id AND u.tenant_id = oal.tenant_id
                 WHERE {$where}
                 ORDER BY oal.created_at DESC, oal.id DESC
                 LIMIT " . self::MAX_ROWS,
                $params
            );

            foreach ($rows as $row) {
                $this->putRow($handle, [
                    $row->id,
                    $row->organization_id ?? '',
                    $row->user_id ?? '',
                    trim($row->user_name ?? ''),
                    $row->target_user_id ?? '',
                    $row->action ?? '',
                    $row->details ?? '',
                    $row->ip_address ?? '',
                    $row->user_agent ?? '',
                    $row->created_at ?? '',
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('[AdminAuditLog] admin export failed: ' . $e->getMessage(), ['tenant_id' => $tenantId]);
            $this->putRow($handle, [__('api.audit_export_failed'), '', '', '', '', '', '', '', '', '']);
        }

        fclose($handle);
    }

    /**
     * Shared tenant + filter WHERE builder. All values bound as parameters.
     *
     * @param array<string, mixed> $filters
     * @return array{0: string, 1: array<int, mixed>}
     */
    private function buildWhere(string $alias, int $tenantId, array $filters): array
    {
        $where = "{$alias}.tenant_id = ?";
        $params = [$tenantId];

        if (!empty($filters['action'])) {
            $where .= " AND {$alias}.action = ?";
            $params[] = (string) $filters['action'];
        }

        if (!empty($filters['user_id']) && is_numeric($filters['user_id'])) {
            $where .= " AND {$alias}.user_id = ?";
            $params[] = (int) $filters['user_id'];
        }

        if (!empty($filters['date_from']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $filters['date_from'])) {
            $where .= " AND {$alias}.created_at >= ?";
            $params[] = $filters['date_from'] . ' 00:00:00';
        }

        if (!empty($filters['date_to']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $filters['date_to'])) {
            $where .= " AND {$alias}.created_at <= ?";
            $params[] = $filters['date_to'] . ' 23:59:59';
        }

        return [$where, $params];
    }

    /**
     * Write one CSV row with every cell sanitised against spreadsheet
     * formula injection. Audit rows carry attacker-influenced data — most
     * dangerously the raw User-Agent header in org_audit_log — and an
     * administrator opens this file in Excel, so a leading =/+/-/@/tab/CR
     * could execute. Prefix those with a single quote to neutralise them.
     *
     * @param resource $handle
     * @param array<int, mixed> $row
     */
    private function putRow($handle, array $row): void
    {
        \App\Support\CsvExportSanitizer::put($handle, array_map(static function ($value) {
            if (is_string($value) && $value !== '' && preg_match('/^[=+\-@\t\r]/', $value)) {
                return "'" . $value;
            }
            return $value;
        }, $row));
    }
}
