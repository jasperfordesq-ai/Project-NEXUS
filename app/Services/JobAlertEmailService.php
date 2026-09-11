<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\I18n\FormattingLocale;
use App\Models\JobAlert;
use App\Models\JobVacancy;
use App\Models\User;
use Illuminate\Support\Facades\Log;

/**
 * JobAlertEmailService — sends email digests to job alert subscribers.
 *
 * Called by the NotifyJobAlertSubscribers listener and by a cron job
 * for daily/weekly digest mode. Uses Laravel Mail with the platform's
 * configured mail driver.
 */
class JobAlertEmailService
{
    /**
     * Send an immediate alert email for a newly posted vacancy.
     *
     * @param User       $recipient
     * @param JobVacancy $vacancy
     * @param JobAlert   $alert
     * @return bool
     */
    public static function sendImmediateAlert(User $recipient, JobVacancy $vacancy, JobAlert $alert): bool
    {
        try {
            $tenantId = (int) ($recipient->tenant_id ?: $vacancy->tenant_id);
            if ($tenantId <= 0) {
                Log::warning('JobAlertEmailService::sendImmediateAlert missing tenant evidence', [
                    'user_id'    => $recipient->id,
                    'vacancy_id' => $vacancy->id,
                    'alert_id'   => $alert->id,
                ]);
                return false;
            }

            return LocaleContext::withLocale($recipient, function () use ($recipient, $vacancy, $tenantId) {
                $subject = __('emails.job_alert.subject_single', ['title' => $vacancy->title]);
                $bodyHtml = self::buildAlertEmailHtml($recipient, [$vacancy]);

                return EmailDispatchService::sendRaw(
                    $recipient->email,
                    $subject,
                    $bodyHtml,
                    null,
                    null,
                    null,
                    'job_alert',
                    ['tenant_id' => $tenantId]
                );
            });
        } catch (\Throwable $e) {
            Log::warning('JobAlertEmailService::sendImmediateAlert failed', [
                'user_id'    => $recipient->id,
                'vacancy_id' => $vacancy->id,
                'error'      => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Build a simple responsive HTML email body for job alert notifications.
     *
     * @param User         $recipient
     * @param JobVacancy[] $vacancies
     * @return string
     */
    public static function buildAlertEmailHtml(User $recipient, array $vacancies): string
    {
        $name     = htmlspecialchars($recipient->first_name ?? __('emails.common.fallback_name'));
        $jobItems = '';

        foreach ($vacancies as $v) {
            $title       = htmlspecialchars($v->title ?? '');
            $location    = htmlspecialchars($v->location ?? ($v->is_remote ? __('emails.job_alert.remote') : __('emails.job_alert.location_not_specified')));
            $commitment  = htmlspecialchars(match ($v->commitment ?? '') {
                'full_time' => __('govuk_alpha.jobs_t2.commitment_full_time'),
                'part_time' => __('govuk_alpha.jobs_t2.commitment_part_time'),
                'flexible' => __('govuk_alpha.jobs_t2.commitment_flexible'),
                'one_off' => __('govuk_alpha.jobs_t2.commitment_one_off'),
                default => '',
            });
            $type        = htmlspecialchars(match ($v->type ?? '') {
                'paid' => __('govuk_alpha.jobs.type_paid'),
                'volunteer' => __('govuk_alpha.jobs.type_volunteer'),
                'timebank' => __('govuk_alpha.jobs.type_timebank'),
                default => '',
            });
            $deadlineDate = $v->deadline
                ? \Carbon\Carbon::parse($v->deadline)->locale(FormattingLocale::carbon())->isoFormat('ll')
                : null;
            $deadline    = $deadlineDate
                ? __('emails.job_alert.closes', ['date' => $deadlineDate])
                : __('emails.job_alert.deadline_open');
            $jobUrl      = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/jobs/' . $v->id;
            $viewJobText = __('emails.job_alert.view_job');

            $jobItems .= <<<HTML
            <tr>
              <td style="padding:16px;border-bottom:1px solid #e5e7eb;">
                <a href="{$jobUrl}" style="font-size:16px;font-weight:600;color:#4f46e5;text-decoration:none;">{$title}</a>
                <div style="margin-top:4px;font-size:13px;color:#6b7280;">
                  {$location} &bull; {$commitment} &bull; {$type} &bull; {$deadline}
                </div>
                <a href="{$jobUrl}" style="display:inline-block;margin-top:8px;padding:6px 14px;background:#4f46e5;color:#fff;border-radius:6px;font-size:13px;text-decoration:none;">{$viewJobText}</a>
              </td>
            </tr>
            HTML;
        }

        $count = count($vacancies);
        $plural = $count === 1 ? __('emails.job_alert.jobs_match_singular') : __('emails.job_alert.jobs_match_plural');
        $heading = __('emails.job_alert.subject_digest', ['count' => $count, 'plural' => $plural]);
        $greeting = __('emails.common.greeting', ['name' => $name]);
        $receivingNotice = __('emails.job_alert.receiving_notice');
        $manageAlertsLink = '<a href="' . TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/jobs/alerts" style="color:#4f46e5;">' . __('emails.job_alert.manage_alerts') . '</a>';
        $unsubscribeText = __('emails.job_alert.unsubscribe', ['link' => $manageAlertsLink]);

        return <<<HTML
        <!DOCTYPE html>
        <html>
        <body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:32px 16px;">
              <table width="600" style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
                <tr>
                  <td style="padding:24px;background:#4f46e5;border-radius:12px 12px 0 0;">
                    <h1 style="margin:0;font-size:20px;color:#fff;">{$heading}</h1>
                  </td>
                </tr>
                <tr><td style="padding:16px 24px;font-size:14px;color:#374151;">{$greeting}</td></tr>
                <tr><td>
                  <table width="100%">{$jobItems}</table>
                </td></tr>
                <tr>
                  <td style="padding:16px 24px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;">
                    {$receivingNotice}<br>
                    {$unsubscribeText}
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body>
        </html>
        HTML;
    }
}
