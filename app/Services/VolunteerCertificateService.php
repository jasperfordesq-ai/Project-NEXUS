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
use App\Support\UserDisplayName;

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

        $idempotencyKey = trim((string) ($options['idempotency_key'] ?? ''));
        $keyHash = null;
        $requestHash = null;
        if ($idempotencyKey !== '') {
            if (strlen($idempotencyKey) < 8 || strlen($idempotencyKey) > 191) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.validation_failed'), 'field' => 'idempotency_key'];
                return null;
            }
            $keyHash = hash('sha256', $idempotencyKey);
            $requestHash = hash('sha256', json_encode([
                'organization_id' => !empty($options['organization_id']) ? (int) $options['organization_id'] : null,
                'date_from' => $options['date_from'] ?? null,
                'date_to' => $options['date_to'] ?? null,
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            $replay = DB::table('vol_certificates')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('creation_idempotency_key_hash', $keyHash)
                ->first(['verification_code', 'creation_request_hash']);
            if ($replay) {
                if (!hash_equals((string) $replay->creation_request_hash, $requestHash)) {
                    self::$errors[] = ['code' => 'IDEMPOTENCY_CONFLICT', 'message' => __('event_registration.idempotency_conflict')];
                    return null;
                }
                return self::verify((string) $replay->verification_code);
            }
        }

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
                'creation_idempotency_key_hash' => $keyHash,
                'creation_request_hash' => $requestHash,
                'verification_code' => $verificationCode,
                'total_hours' => round($totalHours, 2),
                'date_range_start' => $dateRangeStart,
                'date_range_end' => $dateRangeEnd,
                'organizations' => json_encode($orgs),
                'generated_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            if ($keyHash !== null) {
                $winner = DB::table('vol_certificates')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->where('creation_idempotency_key_hash', $keyHash)
                    ->first(['verification_code', 'creation_request_hash']);
                if ($winner && hash_equals((string) $winner->creation_request_hash, (string) $requestHash)) {
                    return self::verify((string) $winner->verification_code);
                }
            }
            \Illuminate\Support\Facades\Log::warning("VolunteerCertificateService::generate error: " . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.vol_certificate_generate_failed')];
            return null;
        }

        // Fetch user name for the response
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select('first_name', 'last_name', 'profile_type', 'organization_name')
            ->first();

        $result = [
            'id' => (int) $id,
            'verification_code' => $verificationCode,
            'total_hours' => round($totalHours, 2),
            'date_range' => ['start' => $dateRangeStart, 'end' => $dateRangeEnd],
            'verification_url' => self::publicCheckUrl($verificationCode),
            'organizations' => $orgs,
            'user_name' => $user ? UserDisplayName::resolve($user) : __('api.vol_certificate_volunteer_fallback'),
            'generated_at' => now()->toIso8601String(),
        ];

        // Send confirmation email to volunteer
        try {
            $userRow = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->select(['email', 'first_name', 'name', 'preferred_language'])->first();
            if ($userRow && !empty($userRow->email)) {
                LocaleContext::withLocale($userRow, function () use ($userRow, $id, $totalHours, $userId, $tenantId) {
                    $firstName = $userRow->first_name ?? $userRow->name ?? __('emails.common.fallback_name');
                    $certUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/volunteering?tab=certificates';
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
                'vc.revoked_at',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name'
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
            'verification_url' => self::publicCheckUrl((string) $cert->verification_code),
            'organizations' => json_decode($cert->organizations, true) ?? [],
            'user_name' => UserDisplayName::resolve($cert),
            'generated_at' => $cert->generated_at,
            'revoked' => $cert->revoked_at !== null,
            'revoked_at' => $cert->revoked_at,
            // A revoked certificate (gap D8) is not a verified one.
            'verified' => $cert->revoked_at === null,
        ];
    }

    /**
     * Public check of a certificate by its code AND the name printed on it.
     *
     * Gap C1 (owner decision, 6 Oct 2026). Anyone holding a certificate — an
     * employer, a college — can confirm it is genuine without an account. It
     * only confirms what is already printed: the caller must supply the name,
     * and a wrong name returns exactly what an unknown code returns, so the
     * code alone discloses nothing about who holds it. The signed-in
     * {@see self::verify()} lookup is unchanged.
     *
     * @return array{valid: bool, name?: string, total_hours?: float, date_range?: array, organizations?: array, generated_at?: mixed}
     */
    public static function check(string $code, string $name): array
    {
        // The code is printed letter-spaced, so a typed copy may carry spaces.
        $cert = self::verify(strtoupper((string) preg_replace('/\s+/u', '', $code)));
        // A revoked certificate answers exactly as an unknown one (gap D8).
        if ($cert === null || $cert['revoked']) {
            return ['valid' => false];
        }

        $expected = self::normaliseName((string) $cert['user_name']);
        if ($expected === '' || !hash_equals($expected, self::normaliseName($name))) {
            return ['valid' => false];
        }

        return [
            'valid' => true,
            'name' => $cert['user_name'],
            'total_hours' => $cert['total_hours'],
            'date_range' => $cert['date_range'],
            'organizations' => $cert['organizations'],
            'generated_at' => $cert['generated_at'],
        ];
    }

    /** Case-, spacing- and accent-insensitive form of a name, for comparison only. */
    private static function normaliseName(string $name): string
    {
        $name = trim((string) preg_replace('/\s+/u', ' ', $name));
        if (class_exists(\Normalizer::class)) {
            $decomposed = \Normalizer::normalize($name, \Normalizer::FORM_D);
            if (is_string($decomposed)) {
                $name = (string) preg_replace('/\p{Mn}+/u', '', $decomposed);
            }
        }

        return mb_strtolower($name, 'UTF-8');
    }

    /**
     * The website page where anyone can check a certificate (code prefilled
     * when given). Printed on the certificate and returned as verification_url;
     * it used to be the signed-in API address, which no employer could open.
     */
    public static function publicCheckUrl(?string $code = null): string
    {
        $url = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/verify-certificate';

        return $code === null || $code === '' ? $url : $url . '/' . rawurlencode($code);
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
            'verification_url' => self::publicCheckUrl((string) $row->verification_code),
            'organizations' => json_decode($row->organizations, true) ?? [],
            'generated_at' => $row->generated_at,
            'downloaded_at' => $row->downloaded_at,
            'revoked_at' => $row->revoked_at ?? null,
        ]);

        return [
            'items'    => $mapped->all(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /** Organisations printed on the sheet; the rest are summarised so it stays one page. */
    private const HTML_MAX_ORGANISATIONS = 6;

    /** The brand colour used when the community has not chosen one (the app's default accent). */
    private const HTML_DEFAULT_BRAND = '#4f46e5';

    /**
     * The printable certificate (19 Oct 2026 redesign).
     *
     * One self-contained HTML document, A4 landscape, that the member saves and
     * prints or saves as a PDF from the browser: no scripts, no external fonts,
     * no external requests, so it renders identically from a file on disk, from
     * the accessible site's inline download and from the admin panel. It carries
     * the community's own name, logo and brand colour (never the platform's),
     * dates in the reader's language, a QR code for the public check page and
     * the certificate code. An admin's copy of a withdrawn certificate
     * ($includeRevoked) is watermarked so it can never be mistaken for a live one.
     *
     * @return string|null  HTML string or null if certificate not found
     */
    public static function generateHtml(string $code, bool $includeRevoked = false): ?string
    {
        $cert = self::verify($code);
        // A revoked certificate is no longer printed for its holder (gap D8); an
        // admin may still view it ($includeRevoked).
        if (!$cert || ($cert['revoked'] && !$includeRevoked)) {
            return null;
        }

        $e = static fn ($value): string => htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');

        $locale = app()->getLocale() ?: 'en';
        $lang = $e($locale);
        $dir = in_array(strtolower(substr($locale, 0, 2)), ['ar', 'he', 'fa', 'ur'], true) ? 'rtl' : 'ltr';

        $community = TenantContext::getName();
        $brand = self::htmlBrandColour();
        $logo = self::htmlLogoSrc();
        $checkUrl = self::publicCheckUrl();
        $qr = self::htmlQrSvg(self::publicCheckUrl((string) $cert['verification_code']));

        $hours = (float) $cert['total_hours'];
        $hoursUnit = abs($hours - 1.0) < 0.005
            ? __('api.vol_certificate_html_hour_one')
            : __('api.vol_certificate_html_hour_other');
        $start = (string) ($cert['date_range']['start'] ?? '');
        $end = (string) ($cert['date_range']['end'] ?? '');
        $when = ($start !== '' && $start === $end)
            ? __('api.vol_certificate_html_on_date', ['date' => self::htmlLongDate($start)])
            : __('api.vol_certificate_html_between', ['start' => self::htmlLongDate($start), 'end' => self::htmlLongDate($end)]);

        // Largest contribution first; a long list is summarised rather than
        // allowed to push the sheet onto a second page.
        $organisations = array_values(array_filter(
            is_array($cert['organizations']) ? $cert['organizations'] : [],
            static fn ($org) => is_array($org)
        ));
        usort($organisations, static fn (array $a, array $b) => ((float) ($b['hours'] ?? 0)) <=> ((float) ($a['hours'] ?? 0)));
        $shown = array_slice($organisations, 0, self::HTML_MAX_ORGANISATIONS);
        $hidden = count($organisations) - count($shown);

        $orgRows = '';
        foreach ($shown as $org) {
            $orgName = $e(trim((string) ($org['name'] ?? '')) !== '' ? $org['name'] : __('api.vol_certificate_independent'));
            $orgRows .= '<tr><td>' . $orgName . '</td><td>' . $e(self::formatHours((float) ($org['hours'] ?? 0))) . '</td></tr>';
        }
        $moreOrgs = $hidden > 0
            ? '<p class="more">' . $e(__('api.vol_certificate_html_more_orgs', ['count' => $hidden])) . '</p>'
            : '';

        $logoHtml = $logo !== null
            ? '<img src="' . $e($logo) . '" alt="">'
            : '';
        $qrHtml = $qr !== ''
            ? '<div class="qr" aria-hidden="true">' . $qr . '</div>'
            : '';

        $withdrawn = '';
        if ($cert['revoked']) {
            $withdrawn = '<div class="withdrawn" aria-hidden="true"><span>' . $e(__('api.vol_certificate_html_withdrawn')) . '</span></div>'
                . '<p class="withdrawn-note" role="note">' . $e(__('api.vol_certificate_html_withdrawn_note', ['date' => self::htmlLongDate((string) $cert['revoked_at'])])) . '</p>';
        }

        $title = $e(__('api.vol_certificate_html_title'));
        $name = $e($cert['user_name']);
        $communityHtml = $e($community);
        $certifies = $e(__('api.vol_certificate_html_certifies'));
        $hasGiven = $e(__('api.vol_certificate_html_has_given'));
        $hoursHtml = $e(self::formatHours($hours));
        $unitHtml = $e($hoursUnit);
        $toCommunity = $e(__('api.vol_certificate_html_to_community', ['community' => $community]));
        $whenHtml = $e($when);
        $codeLabel = $e(__('api.vol_certificate_html_verification_code'));
        $codeHtml = $e($cert['verification_code']);
        $breakdown = $e(__('api.vol_certificate_html_breakdown'));
        $orgLabel = $e(__('api.vol_certificate_html_org'));
        $orgHoursLabel = $e(__('api.vol_certificate_html_org_hours'));
        $issuedBy = $e(__('api.vol_certificate_html_issued_by'));
        $issuedOn = $e(__('api.vol_certificate_html_issued_on', ['date' => self::htmlLongDate((string) $cert['generated_at'])]));
        $checkTitle = $e(__('api.vol_certificate_html_check_title'));
        $checkHow = $e(__('api.vol_certificate_html_check_how', ['url' => $checkUrl]));
        $printHint = $e(__('api.vol_certificate_html_print_hint'));
        $brandCss = $e($brand);

        return <<<HTML
<!DOCTYPE html>
<html lang="{$lang}" dir="{$dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{$title} · {$name} · {$communityHtml}</title>
<style>
  :root {
    --brand: {$brandCss};
    --ink: #16213a;
    --muted: #5b6475;
    --rule: #d9dde6;
    --paper: #ffffff;
    --tint: #f4f5f9;
    --tint: color-mix(in srgb, var(--brand) 6%, white);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #e9ebf0;
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .hint {
    width: 297mm; max-width: calc(100% - 24px); margin: 16px auto 0; padding: 10px 14px;
    font-size: 13px; line-height: 1.4; color: #334155; background: #fff;
    border: 1px solid var(--rule); border-radius: 8px;
  }
  .sheet {
    position: relative; width: 297mm; height: 210mm; margin: 12px auto 28px;
    background: var(--paper); box-shadow: 0 12px 32px rgba(16, 24, 40, .14); overflow: hidden;
  }
  .frame { position: absolute; inset: 7mm; border: 0.6mm solid var(--brand); pointer-events: none; }
  .frame::after { content: ""; position: absolute; inset: 1.5mm; border: 0.2mm solid var(--brand); opacity: .5; }
  .corner { position: absolute; width: 10mm; height: 10mm; border: 0 solid var(--brand); pointer-events: none; }
  .corner.tl { top: 10mm; left: 10mm; border-top-width: 0.6mm; border-left-width: 0.6mm; }
  .corner.tr { top: 10mm; right: 10mm; border-top-width: 0.6mm; border-right-width: 0.6mm; }
  .corner.bl { bottom: 10mm; left: 10mm; border-bottom-width: 0.6mm; border-left-width: 0.6mm; }
  .corner.br { bottom: 10mm; right: 10mm; border-bottom-width: 0.6mm; border-right-width: 0.6mm; }
  .content { position: absolute; inset: 7mm; padding: 12mm 18mm 11mm; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 10mm; }
  .issuer { display: flex; align-items: center; gap: 4mm; min-width: 0; }
  .issuer img { display: block; height: 14mm; width: auto; max-width: 52mm; object-fit: contain; }
  .issuer .community { font-size: 15pt; font-weight: 600; letter-spacing: .005em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .serial { text-align: end; flex-shrink: 0; }
  .serial .label { margin-bottom: 1mm; }
  .serial code {
    font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 11pt; letter-spacing: .14em; color: var(--ink); direction: ltr; unicode-bidi: isolate;
  }
  main { flex: 1; display: flex; flex-direction: column; justify-content: center; text-align: center; padding: 0 12mm; }
  .kicker { margin: 0; font-size: 10pt; font-weight: 600; letter-spacing: .32em; text-transform: uppercase; color: var(--brand); }
  .lead { margin: 6mm 0 0; font-size: 11.5pt; color: var(--muted); }
  .name {
    margin: 2.5mm 0 0; font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Charter, Georgia, "Times New Roman", "Noto Serif", serif;
    font-size: 34pt; line-height: 1.12; font-weight: 400; overflow-wrap: anywhere;
  }
  .name::after { content: ""; display: block; width: 34mm; height: 0.5mm; margin: 3.5mm auto 0; background: var(--brand); }
  .given { margin: 3.5mm 0 0; font-size: 11.5pt; color: var(--muted); }
  .hours {
    margin: 1mm 0 0; font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Charter, Georgia, "Times New Roman", "Noto Serif", serif;
    font-size: 48pt; line-height: 1.05; font-weight: 600; color: var(--brand); letter-spacing: -.01em; font-variant-numeric: lining-nums;
  }
  .hours small { font-size: 18pt; font-weight: 400; letter-spacing: .01em; margin-inline-start: 2mm; }
  .to { margin: 3mm 0 0; font-size: 12.5pt; }
  .when { margin: 1.5mm 0 0; font-size: 11pt; color: var(--muted); }
  footer {
    display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) auto; gap: 10mm; align-items: end;
    padding-top: 5mm; border-top: 0.25mm solid var(--rule);
  }
  .label { margin: 0 0 2mm; font-size: 7.5pt; font-weight: 600; letter-spacing: .18em; text-transform: uppercase; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { text-align: start; font-size: 7.5pt; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); padding: 0 0 1.2mm; border-bottom: 0.25mm solid var(--rule); }
  th:last-child, td:last-child { text-align: end; white-space: nowrap; padding-inline-start: 4mm; }
  td { padding: 1.3mm 0; border-bottom: 0.2mm solid var(--rule); vertical-align: top; overflow-wrap: anywhere; }
  td:last-child { font-weight: 600; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: 0; }
  .more { margin: 1.5mm 0 0; font-size: 8.5pt; color: var(--muted); }
  .issue p { margin: 0; font-size: 9.5pt; line-height: 1.45; }
  .issue .by { font-weight: 600; }
  .issue .on { color: var(--muted); }
  .check { display: flex; align-items: flex-end; gap: 4mm; }
  .qr { width: 27mm; height: 27mm; flex-shrink: 0; padding: 1mm; background: #fff; border: 0.25mm solid var(--rule); }
  .qr svg { display: block; width: 100%; height: 100%; }
  .checktext { max-width: 48mm; }
  .checktext p { margin: 0; font-size: 8pt; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
  .withdrawn { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
  .withdrawn span {
    transform: rotate(-22deg); padding: 6mm 14mm; border: 2.5mm solid rgba(190, 24, 60, .22); border-radius: 5mm;
    font-size: 60pt; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; color: rgba(190, 24, 60, .22);
  }
  .withdrawn-note { position: absolute; left: 18mm; right: 18mm; bottom: 8.5mm; margin: 0; text-align: center; font-size: 9pt; font-weight: 600; color: #9f1239; }
  @page { size: A4 landscape; margin: 0; }
  @media print {
    body { background: none; }
    .hint { display: none; }
    .sheet { margin: 0; box-shadow: none; break-after: avoid; page-break-after: avoid; }
  }
  @media screen and (max-width: 1180px) { .sheet { zoom: .72; } }
  @media screen and (max-width: 860px) { .sheet { zoom: .52; } }
  @media screen and (max-width: 600px) { .sheet { zoom: .34; } }
</style>
</head>
<body>
  <p class="hint">{$printHint}</p>
  <div class="sheet">
    <div class="frame"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <div class="content">
      <header>
        <div class="issuer">{$logoHtml}<div class="community">{$communityHtml}</div></div>
        <div class="serial"><p class="label">{$codeLabel}</p><code>{$codeHtml}</code></div>
      </header>
      <main>
        <p class="kicker">{$title}</p>
        <p class="lead">{$certifies}</p>
        <h1 class="name">{$name}</h1>
        <p class="given">{$hasGiven}</p>
        <p class="hours">{$hoursHtml}<small>{$unitHtml}</small></p>
        <p class="to">{$toCommunity}</p>
        <p class="when">{$whenHtml}</p>
      </main>
      <footer>
        <section>
          <p class="label">{$breakdown}</p>
          <table>
            <thead><tr><th>{$orgLabel}</th><th>{$orgHoursLabel}</th></tr></thead>
            <tbody>{$orgRows}</tbody>
          </table>
          {$moreOrgs}
        </section>
        <section class="issue">
          <p class="label">{$issuedBy}</p>
          <p class="by">{$communityHtml}</p>
          <p class="on">{$issuedOn}</p>
        </section>
        <section class="check">
          {$qrHtml}
          <div class="checktext"><p class="label">{$checkTitle}</p><p>{$checkHow}</p></div>
        </section>
      </footer>
    </div>
    {$withdrawn}
  </div>
</body>
</html>
HTML;
    }

    /**
     * Hours as printed on the certificate: no trailing zeros, at most two
     * decimals, thousands and decimal marks in the reader's language when
     * the intl extension is present ("124", "12.5", "1,250.25").
     */
    public static function formatHours(float $hours): string
    {
        $hours = round($hours, 2);
        if (class_exists(\NumberFormatter::class)) {
            try {
                $formatter = new \NumberFormatter(str_replace('-', '_', \App\I18n\FormattingLocale::resolve()), \NumberFormatter::DECIMAL);
                $formatter->setAttribute(\NumberFormatter::MIN_FRACTION_DIGITS, 0);
                $formatter->setAttribute(\NumberFormatter::MAX_FRACTION_DIGITS, 2);
                $formatted = $formatter->format($hours);
                if (is_string($formatted) && $formatted !== '') {
                    return $formatted;
                }
            } catch (\Throwable) {
                // Fall through to the plain form below.
            }
        }

        $plain = number_format($hours, 2, '.', ',');

        return str_contains($plain, '.') ? rtrim(rtrim($plain, '0'), '.') : $plain;
    }

    /** A date in the reader's language, long form ("3 January 2026"); the raw value if unparseable. */
    private static function htmlLongDate(string $value): string
    {
        if (trim($value) === '') {
            return '';
        }
        try {
            return \Carbon\Carbon::parse($value)
                ->locale(\App\I18n\FormattingLocale::carbon())
                ->isoFormat('LL');
        } catch (\Throwable) {
            return $value;
        }
    }

    /** The community's chosen brand colour when it is a plain hex colour; the app default otherwise. */
    private static function htmlBrandColour(): string
    {
        $colour = trim((string) TenantContext::getSetting('primary_color', ''));

        return preg_match('/^#[0-9a-fA-F]{6}$/', $colour) === 1 ? strtolower($colour) : self::HTML_DEFAULT_BRAND;
    }

    /**
     * The community logo for the sheet. An uploaded logo is embedded as a data
     * URI so the saved file still shows it offline and from disk; anything
     * else that resolves to an https address is referenced; nothing is shown
     * when the community has no logo.
     */
    private static function htmlLogoSrc(): ?string
    {
        $logo = trim((string) TenantContext::getSetting('logo_url', ''));
        if ($logo === '') {
            return null;
        }

        if (str_starts_with($logo, '/uploads/')) {
            $uploads = realpath(base_path('httpdocs/uploads'));
            $file = $uploads !== false ? realpath(base_path('httpdocs') . $logo) : false;
            if (
                $uploads !== false && $file !== false
                && str_starts_with($file, $uploads . DIRECTORY_SEPARATOR)
                && is_file($file) && filesize($file) <= 1_500_000
            ) {
                $mime = match (strtolower((string) pathinfo($file, PATHINFO_EXTENSION))) {
                    'png' => 'image/png',
                    'jpg', 'jpeg' => 'image/jpeg',
                    'webp' => 'image/webp',
                    'gif' => 'image/gif',
                    'svg' => 'image/svg+xml',
                    default => null,
                };
                $bytes = $mime !== null ? @file_get_contents($file) : false;
                if ($mime !== null && is_string($bytes) && $bytes !== '') {
                    return 'data:' . $mime . ';base64,' . base64_encode($bytes);
                }
            }
        }

        $absolute = \App\Helpers\UrlHelper::absolute($logo);

        return is_string($absolute) && preg_match('#^https?://#i', $absolute) === 1 ? $absolute : null;
    }

    /** The public check address as an inline SVG QR code; empty when the library cannot draw it. */
    private static function htmlQrSvg(string $url): string
    {
        try {
            $builder = new \Endroid\QrCode\Builder\Builder(
                writer: new \Endroid\QrCode\Writer\SvgWriter(),
                data: $url,
                encoding: new \Endroid\QrCode\Encoding\Encoding('UTF-8'),
                errorCorrectionLevel: \Endroid\QrCode\ErrorCorrectionLevel::Medium,
                size: 240,
                margin: 0,
            );
            $svg = $builder->build()->getString();
            $svg = (string) preg_replace('/^<\?xml[^>]*\?>\s*/', '', $svg);

            return str_contains($svg, '<svg') ? trim($svg) : '';
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('VolunteerCertificateService: QR code unavailable: ' . $e->getMessage());

            return '';
        }
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

    /**
     * Every certificate issued in the community, for its admins (gap D8, 7 Oct 2026).
     * Searchable by holder name, email or code; filterable by active / revoked.
     *
     * @param array{q?: string|null, status?: string|null, page?: int, per_page?: int} $filters
     * @return array{items: list<array<string, mixed>>, total: int, counts: array{active: int, revoked: int}}
     */
    public static function listForAdmin(int $tenantId, array $filters = []): array
    {
        $perPage = max(1, min(100, (int) ($filters['per_page'] ?? 25)));
        $page = max(1, (int) ($filters['page'] ?? 1));
        $base = DB::table('vol_certificates as vc')
            ->join('users as u', 'vc.user_id', '=', 'u.id')
            ->where('vc.tenant_id', $tenantId);

        $counts = [
            'active' => (clone $base)->whereNull('vc.revoked_at')->count(),
            'revoked' => (clone $base)->whereNotNull('vc.revoked_at')->count(),
        ];

        $q = trim((string) ($filters['q'] ?? ''));
        if ($q !== '') {
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
            $base->where(function ($query) use ($like) {
                $query->where('u.first_name', 'like', $like)
                    ->orWhere('u.last_name', 'like', $like)
                    ->orWhere('u.name', 'like', $like)
                    ->orWhere('u.email', 'like', $like)
                    ->orWhere('vc.verification_code', 'like', $like);
            });
        }
        $status = (string) ($filters['status'] ?? '');
        if ($status === 'active') {
            $base->whereNull('vc.revoked_at');
        } elseif ($status === 'revoked') {
            $base->whereNotNull('vc.revoked_at');
        }

        $total = (clone $base)->count();
        $rows = $base
            ->select(
                'vc.id', 'vc.user_id', 'vc.verification_code', 'vc.total_hours', 'vc.date_range_start',
                'vc.date_range_end', 'vc.organizations', 'vc.generated_at', 'vc.downloaded_at',
                'vc.revoked_at', 'vc.revoked_by', 'vc.revoke_reason',
                'u.first_name', 'u.last_name', 'u.name', 'u.email', 'u.avatar_url', 'u.profile_type', 'u.organization_name'
            )
            ->orderByDesc('vc.id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        $items = $rows->map(fn ($row) => [
            'id' => (int) $row->id,
            'verification_code' => $row->verification_code,
            'total_hours' => round((float) $row->total_hours, 2),
            'date_range' => ['start' => $row->date_range_start, 'end' => $row->date_range_end],
            'organizations' => json_decode((string) $row->organizations, true) ?? [],
            'generated_at' => $row->generated_at,
            'downloaded_at' => $row->downloaded_at,
            'revoked_at' => $row->revoked_at,
            'revoke_reason' => $row->revoke_reason,
            'verification_url' => self::publicCheckUrl((string) $row->verification_code),
            'volunteer' => [
                'id' => (int) $row->user_id,
                'name' => UserDisplayName::resolve($row),
                'email' => $row->email,
                'avatar_url' => $row->avatar_url,
            ],
        ])->all();

        return ['items' => $items, 'total' => $total, 'counts' => $counts];
    }

    /** The certificate's code, when it exists in the community; null otherwise. */
    public static function codeForAdmin(int $tenantId, int $certificateId): ?string
    {
        $code = DB::table('vol_certificates')->where('id', $certificateId)->where('tenant_id', $tenantId)->value('verification_code');

        return $code === null ? null : (string) $code;
    }

    /**
     * Revoke a certificate issued in error (gap D8). It then fails the public
     * check and is no longer printed for its holder, who is told in their own
     * language. Returns false when it does not exist in the community or is
     * already revoked.
     */
    public static function revoke(int $tenantId, int $certificateId, int $adminId, string $reason): bool
    {
        $reason = mb_substr(trim($reason), 0, 500);
        $cert = DB::table('vol_certificates')
            ->where('id', $certificateId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'user_id', 'verification_code', 'revoked_at']);
        if (!$cert || $cert->revoked_at !== null) {
            return false;
        }

        $changed = DB::table('vol_certificates')
            ->where('id', $certificateId)
            ->where('tenant_id', $tenantId)
            ->whereNull('revoked_at')
            ->update([
                'revoked_at' => now(),
                'revoked_by' => $adminId,
                'revoke_reason' => $reason !== '' ? $reason : null,
                'updated_at' => now(),
            ]);
        if ($changed === 0) {
            return false;
        }

        try {
            $holder = DB::table('users')
                ->where('id', (int) $cert->user_id)
                ->where('tenant_id', $tenantId)
                ->first(['id', 'preferred_language']);
            if ($holder) {
                LocaleContext::withLocale($holder, function () use ($holder, $cert) {
                    \App\Models\Notification::createNotification(
                        (int) $holder->id,
                        __('api.vol_certificate_revoked_notification', ['code' => $cert->verification_code]),
                        '/volunteering?tab=certificates',
                        'volunteer_certificate'
                    );
                });
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('VolunteerCertificateService::revoke notification failed', ['error' => $e->getMessage()]);
        }

        return true;
    }
}
