<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\RegionalAnalytics;

use Illuminate\Support\Carbon;

/**
 * Signed, expiring download address for a stored regional analytics report.
 *
 * The PDF lives on the private local disk, so nothing can serve it by path:
 * the recipient of the monthly email is not signed in, and in production an
 * Apache alias shadows Laravel's own /storage route. The email therefore
 * carries an API address whose signature is an HMAC of the report id and the
 * expiry over the application key, in the same way
 * LegalPublicationDeliveryService::trackingUrl() signs its links.
 */
final class RegionalReportDownloadLink
{
    /** How long after sending a report email its link keeps working. */
    public const VALID_DAYS = 30;

    public static function forReport(int $reportId, ?Carbon $expiresAt = null): string
    {
        $expires = ($expiresAt ?? Carbon::now()->addDays(self::VALID_DAYS))->getTimestamp();

        return rtrim((string) config('app.url'), '/')
            . "/api/v2/regional-analytics/reports/{$reportId}/{$expires}/" . self::signature($reportId, $expires);
    }

    public static function isValidSignature(int $reportId, int $expires, string $signature): bool
    {
        return hash_equals(self::signature($reportId, $expires), $signature);
    }

    public static function isExpired(int $expires): bool
    {
        return $expires < Carbon::now()->getTimestamp();
    }

    private static function signature(int $reportId, int $expires): string
    {
        return hash_hmac('sha256', "regional-report:{$reportId}:{$expires}", (string) config('app.key'));
    }
}
