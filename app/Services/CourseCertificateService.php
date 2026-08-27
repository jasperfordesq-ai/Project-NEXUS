<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Course;
use App\Models\CourseCertificate;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use App\Support\UserDisplayName;

/**
 * CourseCertificateService — issues and renders course completion certificates.
 *
 * Mirrors VolunteerCertificateService: a certificate is a tenant-scoped record
 * with a unique verification serial; printable HTML is generated on demand
 * (the browser prints it to PDF). All queries are tenant-scoped via the
 * CourseCertificate model's HasTenantScope trait.
 */
class CourseCertificateService
{
    /**
     * Issue (or return the existing) certificate for a completed course.
     * Idempotent — one certificate per course + user.
     */
    public static function issue(int $courseId, int $userId): CourseCertificate
    {
        $existing = self::findForUser($courseId, $userId);
        if ($existing) {
            return $existing;
        }

        try {
            return CourseCertificate::create([
                'course_id' => $courseId,
                'user_id' => $userId,
                'serial' => self::uniqueSerial(),
                'issued_at' => Carbon::now(),
            ]);
        } catch (\Illuminate\Database\QueryException $e) {
            // Lost a race to a concurrent issue() — the unique
            // (tenant_id, course_id, user_id) index rejected the duplicate.
            // Return the certificate the winning path created.
            $winner = self::findForUser($courseId, $userId);
            if ($winner) {
                return $winner;
            }
            throw $e;
        }
    }

    public static function findForUser(int $courseId, int $userId): ?CourseCertificate
    {
        return CourseCertificate::where('course_id', $courseId)
            ->where('user_id', $userId)
            ->first();
    }

    /**
     * Build a printable HTML certificate document.
     */
    public static function generateHtml(CourseCertificate $cert): string
    {
        $tenantId = TenantContext::getId();

        $course = Course::find($cert->course_id);
        $courseTitle = $course?->title ?? '';

        $user = DB::table('users')
            ->where('id', $cert->user_id)
            ->where('tenant_id', $tenantId)
            ->select('first_name', 'last_name', 'profile_type', 'organization_name', 'name')
            ->first();
        $userName = $user
            ? UserDisplayName::resolve($user) ?: ($user->name ?? '')
            : '';

        $e = static fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');

        $title = $e(__('emails_misc.course_certificate.html_title'));
        $platform = $e(TenantContext::getName());
        $awardedTo = $e(__('emails_misc.course_certificate.html_awarded_to'));
        $completedLabel = $e(__('emails_misc.course_certificate.html_completed'));
        $dateLabel = $e(__('emails_misc.course_certificate.html_date'));
        $serialLabel = $e(__('emails_misc.course_certificate.html_serial'));
        $issuedDate = $e(optional($cert->issued_at)->format('Y-m-d') ?? Carbon::now()->format('Y-m-d'));

        $name = $e($userName);
        $courseName = $e($courseTitle);
        $serial = $e($cert->serial);
        $lang = $e(app()->getLocale() ?: 'en');

        return <<<HTML
<!DOCTYPE html>
<html lang="{$lang}">
<head>
<meta charset="utf-8">
<title>{$title}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 800px; margin: 40px auto; padding: 48px; border: 3px double #6366f1; }
  h1 { text-align: center; color: #4338ca; margin-bottom: 4px; letter-spacing: 1px; }
  .subtitle { text-align: center; color: #6b7280; font-size: 14px; margin-bottom: 36px; }
  .awarded { text-align: center; color: #6b7280; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; }
  .name { text-align: center; font-size: 30px; font-weight: bold; margin: 12px 0 24px; color: #111827; }
  .course { text-align: center; font-size: 20px; color: #4338ca; margin-bottom: 8px; }
  .date { text-align: center; color: #6b7280; margin-bottom: 28px; }
  .serial { text-align: center; margin-top: 32px; padding: 14px; background: #f9fafb; border-radius: 8px; }
  .serial code { font-size: 16px; font-weight: bold; color: #4338ca; }
  @media print { body { border: none; } }
</style>
</head>
<body>
  <h1>{$title}</h1>
  <p class="subtitle">{$platform}</p>
  <p class="awarded">{$awardedTo}</p>
  <p class="name">{$name}</p>
  <p class="course">{$completedLabel}: {$courseName}</p>
  <p class="date">{$dateLabel}: {$issuedDate}</p>
  <div class="serial">
    <p>{$serialLabel}: <code>{$serial}</code></p>
  </div>
</body>
</html>
HTML;
    }

    private static function uniqueSerial(): string
    {
        $serial = 'CRS-' . strtoupper(Str::random(12));
        $attempts = 0;
        while (CourseCertificate::where('serial', $serial)->exists() && $attempts < 5) {
            $serial = 'CRS-' . strtoupper(Str::random(12));
            $attempts++;
        }
        return $serial;
    }
}
