<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * VolunteerCertificateService — generates and verifies volunteer impact certificates.
 *
 * Backed by the `vol_certificates` table. All queries are tenant-scoped.
 */
class VolunteerCertificateService
{
    /** @var array Validation/business errors from the last operation */
    private static array $errors = [];

    public function __construct()
    {
    }

    /**
     * Get errors from the last operation.
     */
    public static function getErrors(): array
    {
        return self::$errors;
    }

    /**
     * Generate a volunteer impact certificate for a user.
     *
     * Summarises their approved volunteer hours across all organisations
     * within the tenant. Returns null with errors if the user has no approved hours.
     *
     * @param int   $userId
     * @param array $options  Optional filters: 'organization_id', 'date_from', 'date_to'
     * @return array|null  Certificate data or null on failure
     */
    public static function generate(int $userId, array $options = []): ?array
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        // Build the hours query with optional filters
        $query = DB::table('vol_logs')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved');

        if (!empty($options['organization_id'])) {
            $query->where('organization_id', (int) $options['organization_id']);
        }

        if (!empty($options['date_from'])) {
            $query->where('date_logged', '>=', $options['date_from']);
        }

        if (!empty($options['date_to'])) {
            $query->where('date_logged', '<=', $options['date_to']);
        }

        $totalHours = (float) $query->sum('hours');

        if ($totalHours <= 0) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_certificate_no_approved_hours')];
            return null;
        }

        // Minimum-hours threshold: admin-configurable (volunteering.min_hours_for_certificate).
        // Defaults to 0 (any positive hours qualifies = current behaviour) when
        // unset; a configured value gates certificate issuance.
        $minHours = (float) VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_MIN_HOURS_FOR_CERTIFICATE, 0);
        if ($minHours > 0 && $totalHours < $minHours) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_certificate_below_minimum', ['min' => rtrim(rtrim(number_format($minHours, 1), '0'), '.')])];
            return null;
        }

        // Determine date range from actual logged hours
        $dateRange = (clone $query)->selectRaw('MIN(date_logged) as start_date, MAX(date_logged) as end_date')->first();
        $dateRangeStart = $dateRange->start_date ?? now()->format('Y-m-d');
        $dateRangeEnd = $dateRange->end_date ?? now()->format('Y-m-d');

        // Aggregate hours per organisation
        $orgQuery = DB::table('vol_logs as vl')
            ->leftJoin('vol_organizations as vo', function ($join) {
                $join->on('vl.organization_id', '=', 'vo.id')
                    ->on('vl.tenant_id', '=', 'vo.tenant_id');
            })
            ->where('vl.user_id', $userId)
            ->where('vl.tenant_id', $tenantId)
            ->where('vl.status', 'approved');

        if (!empty($options['organization_id'])) {
            $orgQuery->where('vl.organization_id', (int) $options['organization_id']);
        }
        if (!empty($options['date_from'])) {
            $orgQuery->where('vl.date_logged', '>=', $options['date_from']);
        }
        if (!empty($options['date_to'])) {
            $orgQuery->where('vl.date_logged', '<=', $options['date_to']);
        }

        $orgs = $orgQuery
            ->selectRaw('vo.name as org_name, COALESCE(SUM(vl.hours), 0) as total_hours')
            ->groupBy('vl.organization_id', 'vo.name')
            ->get()
            ->map(fn ($row) => [
                'name' => $row->org_name ?? __('api.vol_certificate_independent'),
                'hours' => round((float) $row->total_hours, 2),
            ])
            ->all();

        // Generate a unique verification code. The lookup column
        // (vol_certificates.verification_code) collates utf8mb4_unicode_ci —
        // i.e. case-insensitive — so uppercasing a mixed-case string adds no
        // real entropy. Use 16 uppercase alphanumeric chars (~36^16 ≈ 8e24
        // combinations), which comfortably fits the varchar(32) column.
        $verificationCode = strtoupper(Str::random(16));

        // Prevent duplicate — ensure code is unique
        $attempts = 0;
        while (DB::table('vol_certificates')->where('verification_code', $verificationCode)->exists() && $attempts < 5) {
            $verificationCode = strtoupper(Str::random(16));
            $attempts++;
        }

        try {
            $id = DB::table('vol_certificates')->insertGetId([
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'verification_code' => $verificationCode,
                'total_hours' => round($totalHours, 2),
                'date_range_start' => $dateRangeStart,
                'date_range_end' => $dateRangeEnd,
                'organizations' => json_encode($orgs),
                'generated_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("VolunteerCertificateService::generate error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.vol_certificate_generate_failed')];
            return null;
        }

        // Fetch user name for the response
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select('first_name', 'last_name')
            ->first();

        $result = [
            'id' => (int) $id,
            'verification_code' => $verificationCode,
            'total_hours' => round($totalHours, 2),
            'date_range' => ['start' => $dateRangeStart, 'end' => $dateRangeEnd],
            'verification_url' => config('app.url', 'https://api.project-nexus.ie') . '/api/v2/volunteering/certificates/verify/' . $verificationCode,
            'organizations' => $orgs,
            'user_name' => $user ? trim($user->first_name . ' ' . $user->last_name) : __('api.vol_certificate_volunteer_fallback'),
            'generated_at' => now()->toIso8601String(),
        ];

        // Send confirmation email to volunteer
        try {
            $userRow = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->select(['email', 'first_name', 'name', 'preferred_language'])->first();
            if ($userRow && !empty($userRow->email)) {
                LocaleContext::withLocale($userRow, function () use ($userRow, $id, $totalHours, $userId, $tenantId) {
                    $firstName = $userRow->first_name ?? $userRow->name ?? __('emails.common.fallback_name');
                    $certUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/volunteering/certificates/' . $id;
                    $html = EmailTemplateBuilder::make()
                        ->title(__('emails_misc.vol_certificate.ready_title'))
                        ->greeting($firstName)
                        ->paragraph(__('emails_misc.vol_certificate.ready_body', ['hours' => round($totalHours, 2)]))
                        ->button(__('emails_misc.vol_certificate.ready_cta'), $certUrl)
                        ->render();
                    if (!\App\Services\EmailDispatchService::sendRaw($userRow->email, __('emails_misc.vol_certificate.ready_subject'), $html, null, null, null, 'volunteer_certificate', ['tenant_id' => $tenantId])) {
                        \Illuminate\Support\Facades\Log::warning('[VolunteerCertificateService] certificate ready email send returned false', ['user_id' => $userId]);
                    }
                });
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('[VolunteerCertificateService] certificate ready email failed: ' . $e->getMessage());
        }

        return $result;
    }

    /**
     * Verify a certificate by its unique verification code.
     *
     * @return array|null  Certificate data or null if not found
     */
    public static function verify(string $code): ?array
    {
        $code = trim($code);
        if ($code === '') {
            return null;
        }

        // Join on user id ONLY — deliberately not pairing tenant_id. The
        // certificate row stays scoped to its issuing tenant (below), but the
        // holder's name must still resolve after they move to another
        // community, or every certificate they ever shared with an employer
        // silently stops verifying.
        $query = DB::table('vol_certificates as vc')
            ->join('users as u', 'vc.user_id', '=', 'u.id')
            ->where('vc.verification_code', $code)
            ->select(
                'vc.id',
                'vc.verification_code',
                'vc.total_hours',
                'vc.date_range_start',
                'vc.date_range_end',
                'vc.organizations',
                'vc.generated_at',
                'u.first_name',
                'u.last_name'
            );

        $tenantId = TenantContext::getId();
        if ($tenantId) {
            $query->where('vc.tenant_id', $tenantId);
        }

        $cert = $query->first();

        if (!$cert) {
            return null;
        }

        return [
            'id' => (int) $cert->id,
            'verification_code' => $cert->verification_code,
            'total_hours' => round((float) $cert->total_hours, 2),
            'date_range' => ['start' => $cert->date_range_start, 'end' => $cert->date_range_end],
            'verification_url' => config('app.url', 'https://api.project-nexus.ie') . '/api/v2/volunteering/certificates/verify/' . $cert->verification_code,
            'organizations' => json_decode($cert->organizations, true) ?? [],
            'user_name' => trim($cert->first_name . ' ' . $cert->last_name),
            'generated_at' => $cert->generated_at,
            'verified' => true,
        ];
    }

    /**
     * Get all certificates for a user with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getUserCertificates(int $userId, array $filters = []): array
    {
        $tenantId = TenantContext::getId();
        $limit = min((int) ($filters['limit'] ?? 20), 50);
        $cursor = $filters['cursor'] ?? null;

        $query = DB::table('vol_certificates')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId);

        if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $mapped = $items->map(fn ($row) => [
            'id' => (int) $row->id,
            'verification_code' => $row->verification_code,
            'total_hours' => round((float) $row->total_hours, 2),
            'date_range' => ['start' => $row->date_range_start, 'end' => $row->date_range_end],
            'verification_url' => config('app.url', 'https://api.project-nexus.ie') . '/api/v2/volunteering/certificates/verify/' . $row->verification_code,
            'organizations' => json_decode($row->organizations, true) ?? [],
            'generated_at' => $row->generated_at,
            'downloaded_at' => $row->downloaded_at,
        ]);

        return [
            'items'    => $mapped->all(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Generate printable HTML for a certificate.
     *
     * @return string|null  HTML string or null if certificate not found
     */
    public static function generateHtml(string $code): ?string
    {
        $cert = self::verify($code);
        if (!$cert) {
            return null;
        }

        $userName = htmlspecialchars($cert['user_name'], ENT_QUOTES, 'UTF-8');
        $hours = $cert['total_hours'];
        $dateFrom = htmlspecialchars($cert['date_range']['start'], ENT_QUOTES, 'UTF-8');
        $dateTo = htmlspecialchars($cert['date_range']['end'], ENT_QUOTES, 'UTF-8');
        $verifyCode = htmlspecialchars($cert['verification_code'], ENT_QUOTES, 'UTF-8');
        $htmlTitle = htmlspecialchars(__('api.vol_certificate_html_title'), ENT_QUOTES, 'UTF-8');
        $platformName = htmlspecialchars(__('api.vol_certificate_html_platform'), ENT_QUOTES, 'UTF-8');
        $hoursLabel = htmlspecialchars(__('api.vol_certificate_html_total_hours'), ENT_QUOTES, 'UTF-8');
        $periodLabel = htmlspecialchars(__('api.vol_certificate_html_period'), ENT_QUOTES, 'UTF-8');
        $orgLabel = htmlspecialchars(__('api.vol_certificate_html_org'), ENT_QUOTES, 'UTF-8');
        $orgHoursLabel = htmlspecialchars(__('api.vol_certificate_html_org_hours'), ENT_QUOTES, 'UTF-8');
        $verificationLabel = htmlspecialchars(__('api.vol_certificate_html_verification_code'), ENT_QUOTES, 'UTF-8');
        $verificationNote = htmlspecialchars(__('api.vol_certificate_html_verification_note'), ENT_QUOTES, 'UTF-8');

        $orgRows = '';
        foreach ($cert['organizations'] as $org) {
            $orgName = htmlspecialchars($org['name'] ?? __('api.unknown_user'), ENT_QUOTES, 'UTF-8');
            $orgHours = round((float) ($org['hours'] ?? 0), 2);
            $orgRows .= "<tr><td style=\"padding:8px;border:1px solid #ddd;\">{$orgName}</td><td style=\"padding:8px;border:1px solid #ddd;text-align:center;\">{$orgHours}</td></tr>";
        }

        $lang = htmlspecialchars(app()->getLocale() ?: 'en', ENT_QUOTES, 'UTF-8');

        return <<<HTML
<!DOCTYPE html>
<html lang="{$lang}">
<head>
<meta charset="utf-8">
<title>{$htmlTitle}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 800px; margin: 40px auto; padding: 40px; border: 3px double #2563eb; }
  h1 { text-align: center; color: #1e40af; margin-bottom: 8px; }
  .subtitle { text-align: center; color: #6b7280; font-size: 14px; margin-bottom: 32px; }
  .name { text-align: center; font-size: 28px; font-weight: bold; margin: 24px 0; color: #111827; }
  .hours { text-align: center; font-size: 20px; color: #059669; margin-bottom: 16px; }
  .period { text-align: center; color: #6b7280; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  th { background: #eff6ff; padding: 8px; border: 1px solid #ddd; text-align: left; }
  .verify { text-align: center; margin-top: 32px; padding: 16px; background: #f9fafb; border-radius: 8px; }
  .verify code { font-size: 18px; font-weight: bold; color: #1e40af; }
  @media print { body { border: none; } }
</style>
</head>
<body>
  <h1>{$htmlTitle}</h1>
  <p class="subtitle">{$platformName}</p>
  <p class="name">{$userName}</p>
  <p class="hours">{$hours} {$hoursLabel}</p>
  <p class="period">{$periodLabel}: {$dateFrom} - {$dateTo}</p>
  <table>
    <thead><tr><th>{$orgLabel}</th><th style="text-align:center;">{$orgHoursLabel}</th></tr></thead>
    <tbody>{$orgRows}</tbody>
  </table>
  <div class="verify">
    <p>{$verificationLabel}: <code>{$verifyCode}</code></p>
    <p style="font-size:12px;color:#9ca3af;">{$verificationNote}</p>
  </div>
</body>
</html>
HTML;
    }

    /**
     * Mark a certificate as downloaded.
     */
    public static function markDownloaded(string $code): void
    {
        $code = trim($code);
        if ($code === '') {
            return;
        }

        try {
            $tenantId = TenantContext::getId();

            DB::table('vol_certificates')
                ->where('verification_code', $code)
                ->where('tenant_id', $tenantId)
                ->whereNull('downloaded_at')
                ->update(['downloaded_at' => now()]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("VolunteerCertificateService::markDownloaded error: " . $e->getMessage());
        }
    }
}
