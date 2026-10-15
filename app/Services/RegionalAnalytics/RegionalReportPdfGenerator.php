<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\RegionalAnalytics;

use Illuminate\Support\Facades\Storage;

/**
 * AG59 — PDF generator for regional analytics reports.
 *
 * Produces minimal valid PDFs without an external dependency, mirroring
 * the approach used in App\Services\ReportExportService (no dompdf available).
 * Renders only bucketed values — no individual data ever appears in output.
 */
class RegionalReportPdfGenerator
{
    /** The private disk the reports are written to and served from. */
    public const DISK = 'local';

    /**
     * Render a payload to a PDF and store it on the private disk.
     *
     * Returns the stored path, not an address: the file is private, so the
     * only way to reach it is the signed, expiring link that
     * RegionalReportDownloadLink builds from the report row's id.
     */
    public function generateAndStore(array $payload, int $subscriptionId, string $periodLabel): string
    {
        $text = $this->renderText($payload, $periodLabel);
        $pdfBytes = $this->buildMinimalPdf($text);

        $filename = sprintf(
            'regional-analytics/%d/%s_%s.pdf',
            $subscriptionId,
            $periodLabel,
            substr(bin2hex(random_bytes(4)), 0, 8)
        );

        Storage::disk(self::DISK)->put($filename, $pdfBytes);

        return $filename;
    }

    /**
     * Build the human-readable text body. Bucketed values only — no PII.
     */
    private function renderText(array $payload, string $periodLabel): string
    {
        $dash = '—';
        $lines = [];
        $lines[] = 'PROJECT NEXUS — REGIONAL ANALYTICS REPORT';
        $lines[] = 'Period: ' . $periodLabel;
        $lines[] = 'Generated: ' . ($payload['generated_at'] ?? now()->toIso8601String());
        $lines[] = str_repeat('=', 70);
        $lines[] = '';

        if (! empty($payload['engagement'])) {
            $e = $payload['engagement'];
            $lines[] = '[1] REGIONAL ENGAGEMENT';
            $lines[] = '  Active members:        ' . ($e['active_members_bucket'] ?? $dash);
            $lines[] = '  Active categories:     ' . ($e['categories_active_bucket'] ?? $dash);
            $lines[] = '  Partner organisations: ' . ($e['partner_orgs_bucket'] ?? $dash);
            $vh = $e['volunteer_hours_rounded'] ?? null;
            $lines[] = '  Volunteer hours:       ' . ($vh === null ? $dash : ('~' . $vh . ' h'));
            $lines[] = '  Event participation:   ' . ($e['event_participation_bucket'] ?? $dash);
            $lines[] = '';
        }

        if (! empty($payload['demand_supply']['cells'])) {
            $lines[] = '[2] DEMAND vs SUPPLY (by category x postcode-3)';
            $lines[] = '  Cells reported: ' . count($payload['demand_supply']['cells']);
            foreach (array_slice($payload['demand_supply']['cells'], 0, 30) as $cell) {
                $lines[] = sprintf(
                    '  cat=%d pc=%s offers=%s requests=%s match=%s',
                    $cell['category_id'],
                    $cell['postcode_3'] ?: $dash,
                    $cell['offers_bucket'] ?? $dash,
                    $cell['requests_bucket'] ?? $dash,
                    $cell['match_rate_bucket'] === null ? $dash : ($cell['match_rate_bucket'] . '%')
                );
            }
            $lines[] = '';
        }

        if (! empty($payload['demographics'])) {
            $d = $payload['demographics'];
            $lines[] = '[3] DEMOGRAPHICS';
            $lines[] = '  Age <25:        ' . ($d['age_buckets']['<25'] ?? $dash);
            $lines[] = '  Age 25-44:      ' . ($d['age_buckets']['25-44'] ?? $dash);
            $lines[] = '  Age 45-64:      ' . ($d['age_buckets']['45-64'] ?? $dash);
            $lines[] = '  Age 65+:        ' . ($d['age_buckets']['65+'] ?? $dash);
            $lines[] = '  Gender M:       ' . ($d['gender_buckets']['M'] ?? $dash);
            $lines[] = '  Gender F:       ' . ($d['gender_buckets']['F'] ?? $dash);
            $lines[] = '  Gender Other:   ' . ($d['gender_buckets']['Other'] ?? $dash);
            $lines[] = '  Unspecified:    ' . ($d['gender_buckets']['Unspecified'] ?? $dash);
            $lines[] = '';
        }

        if (! empty($payload['footfall']['areas'])) {
            $lines[] = '[4] FOOTFALL';
            foreach ($payload['footfall']['areas'] as $area => $stats) {
                $lines[] = sprintf(
                    '  %-12s page-views=%s distinct=%s',
                    $area,
                    $stats['page_views_bucket'] ?? $dash,
                    $stats['distinct_visitors_bucket'] ?? $dash
                );
            }
            $lines[] = '';
        }

        $lines[] = str_repeat('-', 70);
        $lines[] = 'PRIVACY: All values are bucketed (<50, 50-200, 200-1000, >1000).';
        $lines[] = 'Hours rounded to nearest 10. Segments below N=10 shown as "—".';
        $lines[] = 'No individual user data appears in this report.';

        return implode("\n", $lines);
    }

    /**
     * Build a minimal valid PDF (Type-1 Courier, single page) — same approach
     * as ReportExportService::buildMinimalPdf. Avoids new dependencies.
     */
    private function buildMinimalPdf(string $text): string
    {
        $escaped = str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $text);
        $linesArr = explode("\n", $escaped);
        $textOps = '';
        foreach ($linesArr as $line) {
            $textOps .= "({$line}) Tj T* \n";
        }

        $stream = "BT\n/F1 9 Tf\n50 760 Td\n12 TL\n{$textOps}ET";
        $streamLength = strlen($stream);

        $objects = [
            1 => "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
            2 => "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
            3 => "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj",
            4 => "4 0 obj\n<< /Length {$streamLength} >>\nstream\n{$stream}\nendstream\nendobj",
            5 => "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj",
        ];

        $pdf = "%PDF-1.4\n";
        $offsets = [];
        foreach ($objects as $num => $obj) {
            $offsets[$num] = strlen($pdf);
            $pdf .= $obj . "\n";
        }
        $xrefOffset = strlen($pdf);
        $pdf .= "xref\n0 " . (count($objects) + 1) . "\n";
        $pdf .= "0000000000 65535 f \n";
        for ($i = 1; $i <= count($objects); $i++) {
            $pdf .= sprintf("%010d 00000 n \n", $offsets[$i]);
        }
        $pdf .= "trailer\n<< /Size " . (count($objects) + 1) . " /Root 1 0 R >>\nstartxref\n{$xrefOffset}\n%%EOF";

        return $pdf;
    }
}
