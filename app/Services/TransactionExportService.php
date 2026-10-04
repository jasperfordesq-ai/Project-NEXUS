<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Support\CsvExportSanitizer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * TransactionExportService — native DB query builder implementation.
 *
 * Generates personal transaction statements in CSV format for download.
 * Supports date-range and type filters.
 */
class TransactionExportService
{
    /**
     * Export a personal transaction statement as CSV.
     *
     * @param int   $userId  The user requesting the statement.
     * @param array $filters Optional filters: startDate, endDate, type.
     * @return array{success: bool, csv?: string, filename?: string, message?: string}
     */
    public function exportPersonalStatementCSV(int $userId, array $filters = []): array
    {
        $tenantId = TenantContext::getId();

        try {
            $query = "SELECT t.id, t.amount, t.description, t.status, t.transaction_type, t.created_at,
                             t.sender_id, t.receiver_id,
                             s.first_name AS sender_first, s.last_name AS sender_last,
                             r.first_name AS receiver_first, r.last_name AS receiver_last
                      FROM transactions t
                      LEFT JOIN users s ON s.id = t.sender_id
                      LEFT JOIN users r ON r.id = t.receiver_id
                      WHERE t.tenant_id = ?
                        AND (
                            (t.sender_id = ? AND t.deleted_for_sender = 0)
                            OR (t.receiver_id = ? AND t.deleted_for_receiver = 0)
                        )";

            $params = [$tenantId, $userId, $userId];

            // Apply date filters
            if (!empty($filters['startDate'])) {
                $query .= " AND t.created_at >= ?";
                $params[] = $filters['startDate'] . ' 00:00:00';
            }

            if (!empty($filters['endDate'])) {
                $query .= " AND t.created_at <= ?";
                $params[] = $filters['endDate'] . ' 23:59:59';
            }

            // Apply type filter
            if (!empty($filters['type'])) {
                $query .= " AND t.transaction_type = ?";
                $params[] = $filters['type'];
            }

            $query .= " ORDER BY t.created_at DESC";

            $rows = DB::select($query, $params);

            // Build CSV content
            $csv = $this->buildCSV($rows, $userId);

            // Generate filename
            $dateRange = '';
            if (!empty($filters['startDate']) || !empty($filters['endDate'])) {
                $start = $filters['startDate'] ?? 'start';
                $end = $filters['endDate'] ?? 'now';
                $dateRange = "_{$start}_to_{$end}";
            }

            $filename = "statement_{$userId}{$dateRange}_" . date('Ymd_His') . '.csv';

            return [
                'success' => true,
                'csv' => $csv,
                'filename' => $filename,
            ];
        } catch (\Throwable $e) {
            Log::error('[TransactionExportService] exportPersonalStatementCSV failed: ' . $e->getMessage());

            return [
                'success' => false,
                'message' => __('svc_notifications_2.transaction_export.failed'),
            ];
        }
    }

    /**
     * Send CSV content as a downloadable file response and exit.
     *
     * @param string $csv      CSV content string.
     * @param string $filename Download filename.
     */
    public function sendCSVDownload(string $csv, string $filename): void
    {
        // In test environments, throw instead of calling exit() so PHPUnit survives.
        if (($_ENV['APP_ENV'] ?? getenv('APP_ENV')) === 'testing' || (function_exists('app') && app()->environment('testing'))) {
            throw new \Symfony\Component\HttpKernel\Exception\HttpException(
                200,
                $csv,
                null,
                ['Content-Type' => 'text/csv; charset=utf-8', 'Content-Disposition' => 'attachment; filename="' . $filename . '"']
            );
        }
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($csv));
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        header('Expires: 0');

        echo $csv;
        exit;
    }

    /**
     * Build CSV string from transaction rows.
     *
     * @param array $rows   Transaction rows from DB.
     * @param int   $userId The user's ID (to determine debit/credit direction).
     * @return string CSV content with UTF-8 BOM for Excel compatibility.
     */
    private function buildCSV(array $rows, int $userId): string
    {
        // UTF-8 BOM for Excel compatibility
        $output = "\xEF\xBB\xBF";

        // Header row
        $headers = ['Date', 'Type', 'Description', 'Other Party', 'Debit', 'Credit', 'Status'];
        $output .= implode(',', $headers) . "\r\n";

        foreach ($rows as $row) {
            $isSender = ((int) $row->sender_id === $userId);

            $otherParty = $isSender
                ? trim(($row->receiver_first ?? '') . ' ' . ($row->receiver_last ?? ''))
                : trim(($row->sender_first ?? '') . ' ' . ($row->sender_last ?? ''));

            // System transactions (starting_balance, admin_grant) may not have an other party
            if (trim($otherParty) === '') {
                $otherParty = 'System';
            }

            $debit = $isSender ? number_format((float) $row->amount, 2) : '';
            $credit = !$isSender ? number_format((float) $row->amount, 2) : '';

            $date = date('Y-m-d H:i', strtotime($row->created_at));
            $type = ucfirst(str_replace('_', ' ', $row->transaction_type ?? 'transfer'));
            $description = $this->escapeCSV($row->description ?? '');
            $otherParty = $this->escapeCSV($otherParty);
            $status = ucfirst($row->status ?? 'completed');

            $output .= implode(',', [$date, $type, $description, $otherParty, $debit, $credit, $status]) . "\r\n";
        }

        return $output;
    }

    /**
     * Escape a value for CSV: quote it when it contains a separator, a quote or a
     * line break, and neutralise spreadsheet formulas first.
     *
     * F-565 (E-089): this used to apply its own rule that looked only at the very
     * first character, so a trigger behind leading whitespace or a control
     * character (" =1+1", "\x01+1+1") went through untouched. Every CSV the
     * platform writes now neutralises through the one shared CsvExportSanitizer.
     */
    private function escapeCSV(string $value): string
    {
        $value = CsvExportSanitizer::cell($value);

        if (str_contains($value, ',') || str_contains($value, '"') || str_contains($value, "\n") || str_contains($value, "\r")) {
            return '"' . str_replace('"', '""', $value) . '"';
        }

        return $value;
    }
}
