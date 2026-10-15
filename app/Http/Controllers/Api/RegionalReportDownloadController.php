<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\RegionalAnalytics\RegionalReportDownloadLink;
use App\Services\RegionalAnalytics\RegionalReportPdfGenerator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

/**
 * Streams a stored regional analytics report to the holder of a signed link.
 *
 * Public by design — the partner contact who receives the monthly email has
 * no account. The signature binds the address to one report row and one
 * expiry; the row must still belong to a live subscription in the same
 * community, so a report cannot be reached through another community's
 * subscription even with a valid signature.
 */
final class RegionalReportDownloadController
{
    public function download(int $reportId, int $expires, string $signature): Response
    {
        if (! RegionalReportDownloadLink::isValidSignature($reportId, $expires, $signature)) {
            abort(404);
        }
        if (RegionalReportDownloadLink::isExpired($expires)) {
            abort(410);
        }

        $report = DB::table('regional_analytics_reports as r')
            ->join('regional_analytics_subscriptions as s', function ($join) {
                $join->on('s.id', '=', 'r.subscription_id')
                    ->on('s.tenant_id', '=', 'r.tenant_id');
            })
            ->where('r.id', $reportId)
            ->where('s.status', '!=', 'cancelled')
            ->first(['r.file_url', 'r.period_start']);

        $path = is_string($report->file_url ?? null) ? ltrim($report->file_url, '/') : '';
        $disk = Storage::disk(RegionalReportPdfGenerator::DISK);
        if ($path === '' || ! str_starts_with($path, 'regional-analytics/') || ! $disk->exists($path)) {
            abort(404);
        }

        $name = 'regional-analytics-' . substr((string) $report->period_start, 0, 7) . '.pdf';

        return $disk->download($path, $name, [
            'Content-Type' => 'application/pdf',
            'Cache-Control' => 'private, no-store, no-cache, must-revalidate',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
