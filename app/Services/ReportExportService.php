<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * ReportExportService — Native Eloquent implementation for CSV/PDF/XLSX report exports.
 *
 * Generates downloadable reports for admin analytics. Each report type queries
 * tenant-scoped data and returns CSV, PDF, or XLSX content with metadata.
 */
class ReportExportService
{
    private ?MunicipalImpactReportService $municipalImpactReportService;

    /**
     * Hard ceiling on exported rows.
     *
     * NOTE: the row-based exports below still carry their own `LIMIT 10000`
     * literals rather than referencing this constant, and none of them tells the
     * operator when truncation has occurred — an export that silently stops at
     * 10,000 rows reads as a complete data set. Both are worth fixing; this
     * constant exists so new code has one place to reference.
     */
    private const MAX_EXPORT_ROWS = 10000;

    /**
     * Supported export report types.
     */
    private const SUPPORTED_TYPES = [
        'transactions'    => 'Transaction History',
        'members'         => 'Member Directory',
        'hours_summary'   => 'Hours Summary',
        'hours_category'  => 'Hours by Category',
        // hours_member / hours_period exist so that every tab of the Hours report
        // can export the data it is actually displaying. Before they existed the
        // UI sent 'hours_category' for all three tabs, so "By Member" and
        // "Monthly Trend" silently downloaded category totals under a filename
        // naming the tab the operator had been looking at.
        'hours_member'    => 'Hours by Member',
        'hours_period'    => 'Hours by Period',
        'events'          => 'Events Report',
        'listings'        => 'Listings Report',
        'inactive'        => 'Inactive Members',
        'social_value'    => 'Social Value (SROI)',
        'municipal_impact' => 'Municipal Impact Pack',
    ];

    public function __construct(?MunicipalImpactReportService $municipalImpactReportService = null)
    {
        $this->municipalImpactReportService = $municipalImpactReportService;
    }

    /**
     * Export a report as CSV.
     *
     * @param string $type     Report type key
     * @param int    $tenantId
     * @param array  $filters  ['date_from', 'date_to', 'status', 'days']
     * @return array ['success' => bool, 'csv' => string, 'filename' => string, 'message' => ?string]
     */
    public function export(string $type, int $tenantId, array $filters = []): array
    {
        $data = $this->getReportData($type, $tenantId, $filters);

        if (empty($data['rows'])) {
            return [
                'success'  => false,
                'message'  => __('svc_notifications_2.report_export.no_data'),
                'csv'      => '',
                'filename' => '',
            ];
        }

        $csv = $this->arrayToCsv($data['headers'], $data['rows']);
        $date = now()->format('Y-m-d');
        $filename = "{$type}_report_{$date}.csv";

        return [
            'success'  => true,
            'csv'      => $csv,
            'filename' => $filename,
            'rows'     => count($data['rows']),
        ];
    }

    /**
     * Export a report as XLSX (Excel workbook, via OpenSpout).
     *
     * @param string $type     Report type key
     * @param int    $tenantId
     * @param array  $filters  ['date_from', 'date_to', 'status', 'days']
     * @return array ['success' => bool, 'xlsx' => string, 'filename' => string, 'message' => ?string]
     */
    public function exportXlsx(string $type, int $tenantId, array $filters = []): array
    {
        $data = $this->getReportData($type, $tenantId, $filters);

        if (empty($data['rows'])) {
            return [
                'success'  => false,
                'message'  => __('svc_notifications_2.report_export.no_data'),
                'xlsx'     => '',
                'filename' => '',
            ];
        }

        $xlsx = $this->arrayToXlsx($data['headers'], $data['rows'], self::SUPPORTED_TYPES[$type] ?? $type);
        $date = now()->format('Y-m-d');
        $filename = "{$type}_report_{$date}.xlsx";

        return [
            'success'  => true,
            'xlsx'     => $xlsx,
            'filename' => $filename,
            'rows'     => count($data['rows']),
        ];
    }

    /**
     * Build an XLSX workbook from headers + rows and return its binary content.
     * OpenSpout streams to a temp file (constant memory even for large reports).
     *
     * @param array<int, string> $headers
     * @param array<int, array<int, mixed>> $rows
     */
    private function arrayToXlsx(array $headers, array $rows, string $sheetName): string
    {
        $tmpPath = tempnam(sys_get_temp_dir(), 'nexus_xlsx_');
        if ($tmpPath === false) {
            throw new \RuntimeException('Unable to create temp file for XLSX export');
        }

        try {
            $writer = new \OpenSpout\Writer\XLSX\Writer();
            $writer->openToFile($tmpPath);

            // Sheet names are capped at 31 chars by the XLSX spec
            $writer->getCurrentSheet()->setName(mb_substr($sheetName, 0, 31));

            $headerStyle = (new \OpenSpout\Common\Entity\Style\Style())->setFontBold();
            $writer->addRow(\OpenSpout\Common\Entity\Row::fromValues($headers, $headerStyle));

            foreach ($rows as $row) {
                $cells = array_map(
                    function ($value) {
                        $scalar = is_scalar($value) || $value === null ? $value : (string) json_encode($value);
                        // OpenSpout turns any string beginning with '=' into a
                        // live formula cell; neutralise it (and the other
                        // spreadsheet formula triggers) the same way the CSV
                        // path does, since report rows carry user-controlled
                        // names/titles/descriptions.
                        return $this->sanitizeCsvCell($scalar);
                    },
                    array_values($row)
                );
                $writer->addRow(\OpenSpout\Common\Entity\Row::fromValues($cells));
            }

            $writer->close();

            $content = file_get_contents($tmpPath);
            if ($content === false) {
                throw new \RuntimeException('Unable to read generated XLSX export');
            }

            return $content;
        } finally {
            @unlink($tmpPath);
        }
    }

    /**
     * Send a CSV download response (used when called directly, not via controller).
     */
    public function sendCSVDownload(string $csv, string $filename): void
    {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        header('Expires: 0');
        echo $csv;
    }

    /**
     * Get supported report types.
     *
     * @return array<string, string>  type_key => label
     */
    public function getSupportedTypes(): array
    {
        return self::SUPPORTED_TYPES;
    }

    /**
     * Export a report as PDF (simple text-based PDF).
     *
     * @param string $type
     * @param int    $tenantId
     * @param array  $filters
     * @return array ['success' => bool, 'pdf' => string, 'filename' => string, 'message' => ?string]
     */
    public function exportPdf(string $type, int $tenantId, array $filters = []): array
    {
        if ($type === 'municipal_impact') {
            return $this->exportMunicipalImpactPdf($tenantId, $filters);
        }

        $data = $this->getReportData($type, $tenantId, $filters);

        if (empty($data['rows'])) {
            return [
                'success'  => false,
                'message'  => __('svc_notifications_2.report_export.no_data'),
                'pdf'      => '',
                'filename' => '',
            ];
        }

        $pdf = $this->generateSimplePdf($type, $data['headers'], $data['rows']);
        $date = now()->format('Y-m-d');
        $filename = "{$type}_report_{$date}.pdf";

        return [
            'success'  => true,
            'pdf'      => $pdf,
            'filename' => $filename,
            'rows'     => count($data['rows']),
        ];
    }

    private function exportMunicipalImpactPdf(int $tenantId, array $filters): array
    {
        $summary = $this->municipalImpactReportService()->summary($tenantId, $filters);
        if (empty($summary['stats'])) {
            return [
                'success' => false,
                'message' => __('svc_notifications_2.report_export.no_data'),
                'pdf' => '',
                'filename' => '',
            ];
        }

        $pdf = $this->generateMunicipalImpactPdf($summary);
        $date = now()->format('Y-m-d');

        return [
            'success' => true,
            'pdf' => $pdf,
            'filename' => "municipal_impact_pack_{$date}.pdf",
            'rows' => count($summary['categories']) + count($summary['trends']) + count($summary['readiness_signals']),
        ];
    }

    /**
     * Send a PDF download response.
     */
    public function sendPdfDownload(string $pdf, string $filename): void
    {
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        header('Expires: 0');
        header('Content-Length: ' . strlen($pdf));
        echo $pdf;
    }

    // =========================================================================
    // DATA FETCHERS
    // =========================================================================

    /**
     * Get report data (headers + rows) for a given report type.
     */
    private function getReportData(string $type, int $tenantId, array $filters): array
    {
        return match ($type) {
            'transactions'   => $this->getTransactionData($tenantId, $filters),
            'members'        => $this->getMemberData($tenantId, $filters),
            'hours_summary'  => $this->getHoursSummaryData($tenantId, $filters),
            'hours_category' => $this->getHoursCategoryData($tenantId, $filters),
            'hours_member'   => $this->getHoursMemberData($tenantId, $filters),
            'hours_period'   => $this->getHoursPeriodData($tenantId, $filters),
            'events'         => $this->getEventData($tenantId, $filters),
            'listings'       => $this->getListingData($tenantId, $filters),
            'inactive'       => $this->getInactiveData($tenantId, $filters),
            'social_value'   => $this->getSocialValueData($tenantId, $filters),
            'municipal_impact' => $this->municipalImpactReportService()->exportData($tenantId, $filters),
            default          => ['headers' => [], 'rows' => []],
        };
    }

    private function municipalImpactReportService(): MunicipalImpactReportService
    {
        if (!$this->municipalImpactReportService) {
            $this->municipalImpactReportService = app(MunicipalImpactReportService::class);
        }

        return $this->municipalImpactReportService;
    }

    private function getTransactionData(int $tenantId, array $filters): array
    {
        $dateConditions = $this->buildDateConditions($filters, 't.created_at');
        $dateBindings = $this->buildDateBindings($filters);

        $query = "SELECT
                t.id, t.created_at, t.amount, t.description, t.status, t.transaction_type,
                s.name AS sender_name, s.email AS sender_email,
                r.name AS receiver_name, r.email AS receiver_email,
                c.name AS category_name
            FROM transactions t
            LEFT JOIN users s ON s.id = t.sender_id AND s.tenant_id = t.tenant_id
            LEFT JOIN users r ON r.id = t.receiver_id AND r.tenant_id = t.tenant_id
            LEFT JOIN listings l ON l.id = t.listing_id AND l.tenant_id = t.tenant_id
            LEFT JOIN categories c ON c.id = l.category_id AND c.tenant_id = t.tenant_id
            WHERE t.tenant_id = ?
            {$dateConditions}
            ORDER BY t.created_at DESC
            LIMIT 10000";

        $rows = DB::select($query, array_merge([$tenantId], $dateBindings));

        return [
            'headers' => ['ID', 'Date', 'Hours', 'Description', 'Status', 'Type', 'Provider', 'Provider Email', 'Receiver', 'Receiver Email', 'Category'],
            'rows' => array_map(fn($r) => [
                $r->id,
                $r->created_at,
                $r->amount,
                $r->description ?? '',
                $r->status,
                $r->transaction_type ?? 'transfer',
                $r->sender_name ?? '',
                $r->sender_email ?? '',
                $r->receiver_name ?? '',
                $r->receiver_email ?? '',
                $r->category_name ?? 'Uncategorized',
            ], $rows),
        ];
    }

    private function getMemberData(int $tenantId, array $filters): array
    {
        $statusCondition = '';
        $bindings = [$tenantId];

        if (!empty($filters['status'])) {
            $statusCondition = ' AND u.status = ?';
            $bindings[] = $filters['status'];
        }

        $query = "SELECT
                u.id, u.name, u.email, u.phone, u.location, u.role, u.status,
                u.is_approved, u.created_at, u.last_login_at, u.balance, u.xp, u.level
            FROM users u
            WHERE u.tenant_id = ? {$statusCondition}
            ORDER BY u.created_at DESC
            LIMIT 10000";

        $rows = DB::select($query, $bindings);

        return [
            'headers' => ['ID', 'Name', 'Email', 'Phone', 'Location', 'Role', 'Status', 'Approved', 'Joined', 'Last Login', 'Balance', 'XP', 'Level'],
            'rows' => array_map(fn($r) => [
                $r->id,
                $r->name ?? '',
                $r->email ?? '',
                $r->phone ?? '',
                $r->location ?? '',
                $r->role ?? 'member',
                $r->status ?? 'active',
                $r->is_approved ? 'Yes' : 'No',
                $r->created_at,
                $r->last_login_at ?? 'Never',
                $r->balance ?? 0,
                $r->xp ?? 0,
                $r->level ?? 1,
            ], $rows),
        ];
    }

    private function getHoursSummaryData(int $tenantId, array $filters): array
    {
        $dateConditions = $this->buildDateConditions($filters);
        $dateBindings = $this->buildDateBindings($filters);

        $query = "SELECT
                DATE_FORMAT(created_at, '%Y-%m') AS period,
                COALESCE(SUM(amount), 0) AS total_hours,
                COUNT(*) AS transaction_count,
                COUNT(DISTINCT sender_id) AS unique_providers,
                COUNT(DISTINCT receiver_id) AS unique_receivers
            FROM transactions
            WHERE tenant_id = ? AND status = 'completed'
            {$dateConditions}
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY period ASC";

        $rows = DB::select($query, array_merge([$tenantId], $dateBindings));

        return [
            'headers' => ['Period', 'Total Hours', 'Transactions', 'Unique Providers', 'Unique Receivers'],
            'rows' => array_map(fn($r) => [
                $r->period,
                round((float) $r->total_hours, 2),
                $r->transaction_count,
                $r->unique_providers,
                $r->unique_receivers,
            ], $rows),
        ];
    }

    private function getHoursCategoryData(int $tenantId, array $filters): array
    {
        $dateConditions = $this->buildDateConditions($filters, 't.created_at');
        $dateBindings = $this->buildDateBindings($filters);

        $query = "SELECT
                c.name AS category_name,
                COALESCE(SUM(t.amount), 0) AS total_hours,
                COUNT(*) AS transaction_count,
                COUNT(DISTINCT t.sender_id) AS unique_providers,
                COUNT(DISTINCT t.receiver_id) AS unique_receivers
            FROM transactions t
            LEFT JOIN listings l ON l.id = t.listing_id AND l.tenant_id = t.tenant_id
            LEFT JOIN categories c ON c.id = l.category_id AND c.tenant_id = t.tenant_id
            WHERE t.tenant_id = ? AND t.status = 'completed'
            {$dateConditions}
            GROUP BY c.name
            ORDER BY total_hours DESC";

        $rows = DB::select($query, array_merge([$tenantId], $dateBindings));

        return [
            'headers' => ['Category', 'Total Hours', 'Transactions', 'Unique Providers', 'Unique Receivers'],
            'rows' => array_map(fn($r) => [
                $r->category_name ?? 'Uncategorized',
                round((float) $r->total_hours, 2),
                $r->transaction_count,
                $r->unique_providers,
                $r->unique_receivers,
            ], $rows),
        ];
    }

    /**
     * Hours by member, for the Hours report's "By Member" tab.
     *
     * Deliberately delegates to HoursReportService — the SAME service that
     * renders the screen — rather than re-implementing the query here. The
     * category export below has its own copy of the SQL and has already drifted
     * from the screen once (it groups by c.name where the screen groups by
     * c.id, c.name, c.color, so two categories sharing a name merge in the
     * export but not on screen). Reuse removes that whole class of bug: if the
     * figures on screen are right, the export's are right too.
     *
     * No limit/offset is passed: an export should contain the whole range, not
     * whichever page the operator happened to be viewing.
     */
    private function getHoursMemberData(int $tenantId, array $filters): array
    {
        $service = app(HoursReportService::class);
        $result = $service->getHoursByMember(
            $tenantId,
            $this->toHoursDateRange($filters),
            'total',
            self::MAX_EXPORT_ROWS,
            0
        );

        return [
            'headers' => ['Member', 'Hours Given', 'Hours Received', 'Total Hours', 'Given Count', 'Received Count', 'Transactions'],
            'rows' => array_map(fn(array $r) => [
                $r['name'],
                $r['hours_given'],
                $r['hours_received'],
                $r['total_hours'],
                $r['given_count'],
                $r['received_count'],
                $r['total_transactions'],
            ], $result['data'] ?? []),
        ];
    }

    /**
     * Hours by period, for the Hours report's "Monthly Trend" tab.
     * Delegates to HoursReportService for the same reason as above.
     */
    private function getHoursPeriodData(int $tenantId, array $filters): array
    {
        $service = app(HoursReportService::class);
        $rows = $service->getHoursByPeriod($tenantId, $this->toHoursDateRange($filters));

        return [
            'headers' => ['Period', 'Total Hours', 'Transactions', 'Unique Providers', 'Unique Receivers', 'Unique Participants'],
            'rows' => array_map(fn(array $r) => [
                $r['period_label'] ?? $r['period'],
                $r['total_hours'],
                $r['transaction_count'],
                $r['unique_providers'],
                $r['unique_receivers'],
                $r['unique_participants'],
            ], $rows),
        ];
    }

    /**
     * Translate this service's `date_from`/`date_to` filter names into the
     * `from`/`to` shape HoursReportService expects.
     */
    private function toHoursDateRange(array $filters): array
    {
        $range = [];
        if (!empty($filters['date_from'])) {
            $range['from'] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $range['to'] = $filters['date_to'];
        }
        return $range;
    }

    private function getEventData(int $tenantId, array $filters): array
    {
        $dateConditions = $this->buildDateConditions($filters, 'e.start_time');
        $dateBindings = $this->buildDateBindings($filters);

        $query = "SELECT
                e.id, e.title, e.location, e.start_time, e.end_time,
                e.max_attendees, e.status,
                u.name AS organizer_name,
                (SELECT COUNT(*) FROM event_attendees ea WHERE ea.event_id = e.id) AS attendee_count
            FROM events e
            LEFT JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
            WHERE e.tenant_id = ?
            {$dateConditions}
            ORDER BY e.start_time DESC
            LIMIT 10000";

        $rows = DB::select($query, array_merge([$tenantId], $dateBindings));

        return [
            'headers' => ['ID', 'Title', 'Location', 'Start Time', 'End Time', 'Max Attendees', 'Attendees', 'Status', 'Organizer'],
            'rows' => array_map(fn($r) => [
                $r->id,
                $r->title ?? '',
                $r->location ?? '',
                $r->start_time,
                $r->end_time ?? '',
                $r->max_attendees ?? 'Unlimited',
                $r->attendee_count ?? 0,
                $r->status ?? 'active',
                $r->organizer_name ?? '',
            ], $rows),
        ];
    }

    private function getListingData(int $tenantId, array $filters): array
    {
        $dateConditions = $this->buildDateConditions($filters, 'l.created_at');
        $dateBindings = $this->buildDateBindings($filters);

        $statusCondition = '';
        $statusBindings = [];
        if (!empty($filters['status'])) {
            $statusCondition = ' AND l.status = ?';
            $statusBindings[] = $filters['status'];
        }

        $query = "SELECT
                l.id, l.title, l.type, l.status, l.location, l.created_at,
                l.price, l.view_count, l.contact_count,
                u.name AS owner_name,
                c.name AS category_name
            FROM listings l
            LEFT JOIN users u ON u.id = l.user_id AND u.tenant_id = l.tenant_id
            LEFT JOIN categories c ON c.id = l.category_id AND c.tenant_id = l.tenant_id
            WHERE l.tenant_id = ?
            {$dateConditions}
            {$statusCondition}
            ORDER BY l.created_at DESC
            LIMIT 10000";

        $rows = DB::select($query, array_merge([$tenantId], $dateBindings, $statusBindings));

        return [
            'headers' => ['ID', 'Title', 'Type', 'Status', 'Category', 'Location', 'Hours Estimate', 'Views', 'Contacts', 'Owner', 'Created'],
            'rows' => array_map(fn($r) => [
                $r->id,
                $r->title ?? '',
                $r->type ?? '',
                $r->status ?? '',
                $r->category_name ?? 'Uncategorized',
                $r->location ?? '',
                $r->price ?? 0,
                $r->view_count ?? 0,
                $r->contact_count ?? 0,
                $r->owner_name ?? '',
                $r->created_at,
            ], $rows),
        ];
    }

    private function getInactiveData(int $tenantId, array $filters): array
    {
        $days = (int) ($filters['days'] ?? 90);

        $query = "SELECT
                u.id, u.name, u.email, u.phone, u.location, u.role,
                u.created_at, u.last_login_at, u.last_active_at, u.balance,
                f.flag_type, f.flagged_at, f.last_activity_at AS flag_last_activity
            FROM users u
            LEFT JOIN member_activity_flags f ON f.user_id = u.id AND f.tenant_id = u.tenant_id AND f.resolved_at IS NULL
            WHERE u.tenant_id = ? AND u.is_approved = 1
                AND (u.last_active_at IS NULL OR u.last_active_at < DATE_SUB(NOW(), INTERVAL ? DAY))
            ORDER BY u.last_active_at ASC
            LIMIT 10000";

        $rows = DB::select($query, [$tenantId, $days]);

        return [
            'headers' => ['ID', 'Name', 'Email', 'Phone', 'Location', 'Role', 'Joined', 'Last Login', 'Last Active', 'Balance', 'Flag Type', 'Flagged At'],
            'rows' => array_map(fn($r) => [
                $r->id,
                $r->name ?? '',
                $r->email ?? '',
                $r->phone ?? '',
                $r->location ?? '',
                $r->role ?? 'member',
                $r->created_at,
                $r->last_login_at ?? 'Never',
                $r->last_active_at ?? 'Never',
                $r->balance ?? 0,
                $r->flag_type ?? 'None',
                $r->flagged_at ?? '',
            ], $rows),
        ];
    }

    private function getSocialValueData(int $tenantId, array $filters): array
    {
        $dateConditions = $this->buildDateConditions($filters, 't.created_at');
        $dateBindings = $this->buildDateBindings($filters);

        // Get SROI config
        $config = DB::table('social_value_config')
            ->where('tenant_id', $tenantId)
            ->first();

        $hourValue = (float) ($config->hour_value_amount ?? 15.00);
        $multiplier = (float) ($config->social_multiplier ?? 3.50);
        $currency = $config->hour_value_currency ?? 'GBP';

        $typeExclusion = SocialValueService::transactionTypeExclusionSql('t.');

        $query = "SELECT
                DATE_FORMAT(t.created_at, '%Y-%m') AS period,
                COALESCE(SUM(t.amount), 0) AS total_hours,
                COUNT(*) AS transaction_count,
                COUNT(DISTINCT t.sender_id) AS unique_members
            FROM transactions t
            WHERE t.tenant_id = ? AND t.status = 'completed' {$typeExclusion}
            {$dateConditions}
            GROUP BY DATE_FORMAT(t.created_at, '%Y-%m')
            ORDER BY period ASC";

        $rows = DB::select($query, array_merge([$tenantId], $dateBindings));

        return [
            'headers' => ['Period', 'Total Hours', 'Transactions', 'Unique Givers', "Direct Value ({$currency})", "Additional Social Value ({$currency})", "Combined Value ({$currency})"],
            'rows' => array_map(function ($r) use ($hourValue, $multiplier) {
                $hours = (float) $r->total_hours;
                $direct = round($hours * $hourValue, 2);
                $social = round($direct * $multiplier, 2);
                return [
                    $r->period,
                    round($hours, 2),
                    $r->transaction_count,
                    $r->unique_members,
                    $direct,
                    $social,
                    round($direct + $social, 2),
                ];
            }, $rows),
        ];
    }

    // =========================================================================
    // CSV / PDF GENERATION
    // =========================================================================

    /**
     * Convert headers + rows into a CSV string.
     */
    private function arrayToCsv(array $headers, array $rows): string
    {
        $output = fopen('php://temp', 'r+');

        // BOM for Excel UTF-8 compatibility
        fwrite($output, "\xEF\xBB\xBF");

        fputcsv($output, $headers);

        foreach ($rows as $row) {
            // CSV injection prevention: sanitize each cell value
            $sanitized = array_map([$this, 'sanitizeCsvCell'], $row);
            fputcsv($output, $sanitized);
        }

        rewind($output);
        $csv = stream_get_contents($output);
        fclose($output);

        return $csv;
    }

    /**
     * Sanitize a CSV cell value to prevent formula injection.
     * Prefixes formula-trigger characters (=, +, -, @, tab, CR) with a single quote.
     */
    private function sanitizeCsvCell(mixed $value): mixed
    {
        if (!is_string($value)) {
            return $value;
        }
        if (preg_match('/^[=+\-@\t\r]/', $value)) {
            return "'" . $value;
        }
        return $value;
    }

    /**
     * Generate a simple text-based PDF.
     *
     * Produces a minimal valid PDF without external dependencies.
     * For production use, a library like DOMPDF or TCPDF would be preferred.
     */
    private function generateSimplePdf(string $type, array $headers, array $rows): string
    {
        $title = self::SUPPORTED_TYPES[$type] ?? 'Report';
        $date = now()->format('Y-m-d H:i');
        $rowCount = count($rows);

        // Build text content
        $lines = [];
        $lines[] = $title . ' Report';
        $lines[] = 'Generated: ' . $date;
        $lines[] = 'Total Records: ' . $rowCount;
        $lines[] = str_repeat('-', 80);
        $lines[] = implode(' | ', $headers);
        $lines[] = str_repeat('-', 80);

        foreach (array_slice($rows, 0, 500) as $row) {
            $lines[] = implode(' | ', array_map(fn($v) => (string) $v, $row));
        }

        if ($rowCount > 500) {
            $lines[] = '';
            $lines[] = "... and " . ($rowCount - 500) . " more rows (use CSV export for full data)";
        }

        $text = implode("\n", $lines);

        // Generate minimal PDF
        return $this->buildMinimalPdf($text);
    }

    private function generateMunicipalImpactPdf(array $summary): string
    {
        $stats = $summary['stats'];
        $context = $summary['report_context'] ?? [];
        $audience = (string) ($context['audience'] ?? 'municipality');
        $templateName = (string) ($context['template_name'] ?? __('api.municipal_pdf_default_template'));
        $sections = implode(', ', $context['sections'] ?? []);
        $period = $summary['period']['from'] . ' to ' . $summary['period']['to'];
        $currency = (string) ($summary['currency'] ?? 'CHF');
        $tenantName = $this->resolveTenantName();

        $rule = str_repeat('=', 92);
        $thinRule = str_repeat('-', 92);

        $lines = [];

        // -- Header band -------------------------------------------------------
        $lines[] = $rule;
        $lines[] = strtoupper(__('api.municipal_pdf_title'));
        if ($tenantName !== '') {
            $lines[] = $tenantName;
        }
        $lines[] = __('api.municipal_pdf_period', ['period' => $period]);
        $lines[] = __('api.municipal_pdf_audience', ['audience' => $audience]);
        $lines[] = __('api.municipal_pdf_template', ['template' => $templateName]);
        $lines[] = __('api.municipal_pdf_generated', ['date' => now()->format('Y-m-d H:i')]);
        $lines[] = $rule;
        $lines[] = '';

        // -- Two-column metrics summary ---------------------------------------
        $lines[] = strtoupper(__('api.municipal_pdf_executive_summary'));
        $lines[] = $thinRule;
        $left = [
            [__('api.municipal_pdf_metric_verified_hours_label'), number_format((float) ($stats['verified_hours'] ?? 0), 1)],
            [__('api.municipal_pdf_metric_volunteer_hours_label'), number_format((float) ($stats['volunteer_hours'] ?? 0), 1)],
            [__('api.municipal_pdf_metric_timebank_hours_label'), number_format((float) ($stats['timebank_hours'] ?? 0), 1)],
            [__('api.municipal_pdf_metric_pending_hours_label'), number_format((float) ($stats['pending_hours'] ?? 0), 1)],
            [__('api.municipal_pdf_metric_active_members_label'), number_format((int) ($stats['active_members'] ?? 0))],
        ];
        $right = [
            [__('api.municipal_pdf_metric_new_members_label'), number_format((int) ($stats['new_members'] ?? 0))],
            [__('api.municipal_pdf_metric_participating_members_label'), number_format((int) ($stats['participating_members'] ?? 0))],
            [__('api.municipal_pdf_metric_trusted_organisations_label'), number_format((int) ($stats['trusted_organisations'] ?? 0))],
            [__('api.municipal_pdf_metric_direct_value_label'), $currency . ' ' . number_format((float) ($stats['direct_value'] ?? 0), 0)],
            [__('api.municipal_pdf_metric_total_value_label'), $currency . ' ' . number_format((float) ($stats['total_value'] ?? 0), 0)],
        ];
        $rowCount = max(count($left), count($right));
        for ($i = 0; $i < $rowCount; $i++) {
            $l = $left[$i] ?? ['', ''];
            $r = $right[$i] ?? ['', ''];
            $lines[] = sprintf('  %-28s %12s    |    %-28s %12s', $l[0], $l[1], $r[0], $r[1]);
        }
        $lines[] = $thinRule;
        $lines[] = '';

        // -- Audience-specific narrative section ------------------------------
        $audienceLabel = __('api.municipal_pdf_audience_section_' . $audience);
        // Fallback if no specific translation key.
        if (str_starts_with($audienceLabel, 'api.')) {
            $audienceLabel = __('api.municipal_pdf_audience', ['audience' => $audience]);
        }
        $lines[] = strtoupper($audienceLabel);
        $lines[] = $thinRule;

        if ($audience === 'canton' && isset($summary['canton_variant'])) {
            $variant = $summary['canton_variant'];
            $lines[] = '  ' . __('api.municipal_pdf_canton_municipalities', ['count' => (int) ($variant['aggregate_municipalities_count'] ?? 0)]);
            $lines[] = '  ' . __('api.municipal_pdf_canton_total_hours', ['value' => number_format((float) ($variant['multi_node_total_hours'] ?? 0), 1)]);
            $lines[] = '  ' . __('api.municipal_pdf_canton_cost_avoidance', ['value' => $currency . ' ' . number_format((float) ($variant['est_cost_avoidance_chf'] ?? 0), 0)]);
            $yoy = $variant['yoy_change_percent'];
            $lines[] = '  ' . __('api.municipal_pdf_canton_yoy', [
                'value' => $yoy === null ? __('api.municipal_pdf_value_na') : number_format((float) $yoy, 1) . '%',
                'prior' => number_format((float) ($variant['yoy_prior_hours'] ?? 0), 1),
            ]);
        } elseif ($audience === 'cooperative' && isset($summary['cooperative_variant'])) {
            $variant = $summary['cooperative_variant'];
            $lines[] = '  ' . __('api.municipal_pdf_coop_retention', [
                'rate' => number_format(((float) ($variant['member_retention_rate'] ?? 0)) * 100, 1) . '%',
                'count' => (int) ($variant['retained_members_count'] ?? 0),
            ]);
            $lines[] = '  ' . __('api.municipal_pdf_coop_reciprocity', [
                'rate' => number_format(((float) ($variant['reciprocity_rate'] ?? 0)) * 100, 1) . '%',
                'count' => (int) ($variant['reciprocal_members_count'] ?? 0),
            ]);
            $lines[] = '  ' . __('api.municipal_pdf_coop_tandems', ['count' => (int) ($variant['tandem_count'] ?? 0)]);
            $lines[] = '  ' . __('api.municipal_pdf_coop_load', [
                'avg' => number_format((float) ($variant['coordinator_load_avg'] ?? 0), 1),
                'pending' => (int) ($variant['pending_reviews_total'] ?? 0),
                'coordinators' => (int) ($variant['coordinator_count'] ?? 0),
            ]);
            $lines[] = '  ' . __('api.municipal_pdf_coop_pool', [
                'value' => number_format((float) ($variant['future_care_credit_pool'] ?? 0), 1),
            ]);
        } elseif (isset($summary['municipality_variant'])) {
            $variant = $summary['municipality_variant'];
            $lines[] = '  ' . __('api.municipal_pdf_muni_partners', ['count' => (int) ($variant['partner_organisations_count'] ?? 0)]);
            foreach (array_slice($variant['partner_organisations'] ?? [], 0, 8) as $org) {
                $lines[] = sprintf(
                    '    - %-50s %8s h   (%d)',
                    mb_substr((string) $org['name'], 0, 50),
                    number_format((float) $org['hours'], 1),
                    (int) $org['log_count']
                );
            }
            $lines[] = '  ' . __('api.municipal_pdf_muni_recipients', ['count' => (int) ($variant['recipients_reached_count'] ?? 0)]);
            $lines[] = '  ' . __('api.municipal_pdf_muni_geographic');
            foreach ($variant['geographic_distribution'] ?? [] as $cat) {
                $lines[] = sprintf(
                    '    - %-50s %8s h',
                    mb_substr((string) $cat['name'], 0, 50),
                    number_format((float) $cat['hours'], 1)
                );
            }
        }
        $lines[] = $thinRule;
        $lines[] = '';

        // -- Readiness signals ------------------------------------------------
        $lines[] = strtoupper(__('api.municipal_pdf_readiness'));
        $lines[] = $thinRule;
        foreach ($summary['readiness_signals'] ?? [] as $signal) {
            $lines[] = '  ' . __('api.municipal_pdf_readiness_line', [
                'label' => __('api.municipal_pdf_signal_' . $signal['key']),
                'status' => __('api.municipal_pdf_status_' . $signal['status']),
                'value' => number_format((float) ($signal['value'] ?? 0), 1),
            ]);
        }
        $lines[] = $thinRule;
        $lines[] = '';

        // -- Categories -------------------------------------------------------
        $lines[] = strtoupper(__('api.municipal_pdf_categories'));
        $lines[] = $thinRule;
        foreach (array_slice($summary['categories'] ?? [], 0, 8) as $category) {
            $lines[] = '  ' . __('api.municipal_pdf_category_line', [
                'name' => (string) $category['name'],
                'hours' => number_format((float) $category['hours'], 1),
                'count' => number_format((int) $category['count']),
            ]);
        }
        $lines[] = $thinRule;
        $lines[] = '';

        // -- Trends -----------------------------------------------------------
        $lines[] = strtoupper(__('api.municipal_pdf_trends'));
        $lines[] = $thinRule;
        foreach (array_slice($summary['trends'] ?? [], -8) as $trend) {
            $lines[] = '  ' . __('api.municipal_pdf_trend_line', [
                'period' => (string) $trend['period'],
                'hours' => number_format((float) $trend['verified_hours'], 1),
                'participants' => number_format((int) $trend['participants']),
                'activities' => number_format((int) $trend['activities']),
            ]);
        }
        $lines[] = $thinRule;
        $lines[] = '';

        // -- Footer -----------------------------------------------------------
        $lines[] = $rule;
        $lines[] = '  ' . __('api.municipal_pdf_footer', [
            'date' => now()->format('Y-m-d'),
            'sections' => $sections,
        ]);
        $lines[] = $rule;

        return $this->buildMinimalPdf(implode("\n", $this->wrapPdfLines($lines)));
    }

    private function resolveTenantName(): string
    {
        try {
            $tenantId = \App\Core\TenantContext::getId();
            if (!$tenantId) {
                return '';
            }
            $row = DB::selectOne("SELECT name FROM tenants WHERE id = ? LIMIT 1", [$tenantId]);
            return (string) ($row->name ?? '');
        } catch (\Throwable) {
            return '';
        }
    }

    private function wrapPdfLines(array $lines, int $width = 92): array
    {
        $wrapped = [];
        foreach ($lines as $line) {
            $parts = explode("\n", wordwrap((string) $line, $width, "\n", false));
            foreach ($parts as $part) {
                $wrapped[] = $part;
            }
        }

        return $wrapped;
    }

    /**
     * Build a minimal valid PDF 1.4 document containing the given text.
     */
    private function buildMinimalPdf(string $text): string
    {
        // Escape special PDF characters in text
        $escapedText = str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $text);

        // Split text into lines for Tj operators
        $lines = explode("\n", $escapedText);
        $textOps = '';
        foreach ($lines as $line) {
            $textOps .= "({$line}) Tj T* \n";
        }

        $stream = "BT\n/F1 9 Tf\n50 750 Td\n12 TL\n{$textOps}ET";
        $streamLength = strlen($stream);

        $objects = [];

        // Object 1: Catalog
        $objects[1] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj";

        // Object 2: Pages
        $objects[2] = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj";

        // Object 3: Page
        $objects[3] = "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj";

        // Object 4: Content stream
        $objects[4] = "4 0 obj\n<< /Length {$streamLength} >>\nstream\n{$stream}\nendstream\nendobj";

        // Object 5: Font
        $objects[5] = "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj";

        // Build PDF
        $pdf = "%PDF-1.4\n";
        $offsets = [];

        foreach ($objects as $num => $obj) {
            $offsets[$num] = strlen($pdf);
            $pdf .= $obj . "\n";
        }

        // Xref
        $xrefOffset = strlen($pdf);
        $pdf .= "xref\n0 " . (count($objects) + 1) . "\n";
        $pdf .= "0000000000 65535 f \n";
        for ($i = 1; $i <= count($objects); $i++) {
            $pdf .= sprintf("%010d 00000 n \n", $offsets[$i]);
        }

        // Trailer
        $pdf .= "trailer\n<< /Size " . (count($objects) + 1) . " /Root 1 0 R >>\nstartxref\n{$xrefOffset}\n%%EOF";

        return $pdf;
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    /**
     * Build SQL date condition fragment.
     */
    private function buildDateConditions(array $filters, string $column = 'created_at'): string
    {
        $conditions = '';
        if (!empty($filters['date_from'])) {
            $conditions .= " AND {$column} >= ?";
        }
        if (!empty($filters['date_to'])) {
            // See HoursReportService::buildDateConditions() — `<= 'YYYY-MM-DD'`
            // against a DATETIME column excludes the entire final day. Keep these
            // two builders in step; an export whose range differs from the screen
            // by one day is exactly the kind of thing that destroys trust in a
            // report.
            $conditions .= " AND {$column} < DATE_ADD(?, INTERVAL 1 DAY)";
        }
        return $conditions;
    }

    /**
     * Build bindings array for date conditions.
     */
    private function buildDateBindings(array $filters): array
    {
        $bindings = [];
        if (!empty($filters['date_from'])) {
            $bindings[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $bindings[] = $filters['date_to'];
        }
        return $bindings;
    }
}
