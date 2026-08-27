<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\JobVacancy;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * JobExpiryNotificationService — notifies job posters when their vacancy
 * is expiring soon (7 days) or has expired.
 *
 * Designed to be called from a scheduled command / cron job.
 */
class JobExpiryNotificationService
{
    /**
     * Send notifications for all vacancies expiring in the next 7 days
     * that haven't been notified yet. Run once daily via scheduler.
     *
     * Iterates over all active tenants to ensure TenantContext is set
     * correctly for each batch of notifications (required for tenant-scoped
     * Notification::createNotification).
     */
    public static function notifyExpiringSoon(): int
    {
        $notified = 0;

        try {
            // Iterate tenants so TenantContext is set for notifications
            $tenants = DB::select("SELECT id FROM tenants WHERE is_active = 1");

            foreach ($tenants as $tenant) {
                try {
                    TenantContext::setById($tenant->id);

                    DB::table('job_expiry_notifications')
                        ->where('tenant_id', $tenant->id)
                        ->where('notification_type', 'expiring_soon')
                        ->whereNull('sent_at')
                        ->where('created_at', '<', now()->subHour())
                        ->delete();

                    $vacancies = JobVacancy::with(['creator:id,first_name,last_name,profile_type,organization_name,email,preferred_language'])
                        ->where('status', 'open')
                        ->whereNotNull('deadline')
                        ->whereBetween('deadline', [now(), now()->addDays(7)])
                        ->whereNull('expired_at') // not yet expired
                        ->whereNotExists(function ($q) {
                            $q->select(DB::raw(1))
                                ->from('job_expiry_notifications')
                                ->whereColumn('job_expiry_notifications.vacancy_id', 'job_vacancies.id')
                                ->whereColumn('job_expiry_notifications.tenant_id', 'job_vacancies.tenant_id')
                                ->where('notification_type', 'expiring_soon');
                        })
                        ->get();

                    foreach ($vacancies as $vacancy) {
                        try {
                            $daysLeft = (int) now()->diffInDays($vacancy->deadline);
                            $claimTime = now();

                            $inserted = DB::table('job_expiry_notifications')->insertOrIgnore([
                                'tenant_id' => $vacancy->tenant_id,
                                'vacancy_id' => $vacancy->id,
                                'notification_type' => 'expiring_soon',
                                'sent_at' => null,
                                'created_at' => $claimTime,
                                'updated_at' => $claimTime,
                            ]);

                            if ((int) $inserted === 0) {
                                continue;
                            }

                            // Render notification + email in the RECIPIENT's language, not
                            // the cron worker's default (which is always 'en' in queue context).
                            $emailOk = LocaleContext::withLocale($vacancy->creator, function () use ($vacancy, $daysLeft): bool {
                                if ($vacancy->creator && $vacancy->creator->email) {
                                    return self::sendExpiryEmail($vacancy->creator, $vacancy, $daysLeft);
                                }

                                return true;
                            });

                            if (!$emailOk) {
                                DB::table('job_expiry_notifications')
                                    ->where('tenant_id', $vacancy->tenant_id)
                                    ->where('vacancy_id', $vacancy->id)
                                    ->where('notification_type', 'expiring_soon')
                                    ->whereNull('sent_at')
                                    ->delete();

                                continue;
                            }

                            DB::table('job_expiry_notifications')
                                ->where('tenant_id', $vacancy->tenant_id)
                                ->where('vacancy_id', $vacancy->id)
                                ->where('notification_type', 'expiring_soon')
                                ->update([
                                    'sent_at' => now(),
                                    'updated_at' => now(),
                                ]);

                            LocaleContext::withLocale($vacancy->creator, function () use ($vacancy, $daysLeft): void {
                                if ($vacancy->user_id) {
                                    Notification::createNotification(
                                        (int) $vacancy->user_id,
                                        __('notifications.job_expiring_soon', ['title' => $vacancy->title, 'days' => $daysLeft]),
                                        "/jobs/{$vacancy->id}",
                                        'job_expiry',
                                        false,
                                        (int) $vacancy->tenant_id
                                    );
                                    \App\Services\NotificationDispatcher::fanOutPush((int) $vacancy->user_id, 'job_expiry', __('notifications.job_expiring_soon', ['title' => $vacancy->title, 'days' => $daysLeft]), "/jobs/{$vacancy->id}");
                                }
                            });

                            $notified++;
                        } catch (\Throwable $e) {
                            Log::warning('JobExpiryNotificationService: vacancy failed', ['vacancy_id' => $vacancy->id, 'error' => $e->getMessage()]);
                        }
                    }
                } finally {
                    TenantContext::reset();
                }
            }
        } catch (\Throwable $e) {
            Log::error('JobExpiryNotificationService::notifyExpiringSoon failed', ['error' => $e->getMessage()]);
        }

        return $notified;
    }

    private static function sendExpiryEmail(User $user, object $vacancy, int $daysLeft): bool
    {
        $name      = htmlspecialchars($user->first_name ?? __('emails.common.fallback_name'));
        $title     = htmlspecialchars($vacancy->title);
        $renewUrl  = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/jobs/' . $vacancy->id;
        $deadline  = $vacancy->deadline?->format('d M Y') ?? 'soon';

        $greeting = __('emails_misc.jobs.expiry_greeting', ['name' => $name]);
        $heading = __('notifications.job_expiry_email_heading');
        $bodyText = __('notifications.job_expiry_email_body', ['title' => $title, 'deadline' => $deadline, 'days' => $daysLeft]);
        $ctaText = __('notifications.job_expiry_email_cta');
        $buttonText = __('notifications.job_expiry_email_button');
        $footerText = __('notifications.job_expiry_email_footer');

        $html = <<<HTML
        <!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 16px;">
        <table width="600" style="background:#fff;border-radius:12px;padding:32px;margin:0 auto;">
          <tr><td>
            <h2 style="color:#4f46e5;margin-top:0;">{$heading}</h2>
            <p>{$greeting}</p>
            <p>{$bodyText}</p>
            <p>{$ctaText}</p>
            <a href="{$renewUrl}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">{$buttonText}</a>
            <p style="margin-top:24px;font-size:12px;color:#9ca3af;">{$footerText}</p>
          </td></tr>
        </table>
        </body></html>
        HTML;

        $subject = __('notifications.job_expiry_email_subject', ['title' => $title]);
        if (!EmailDispatchService::sendRaw(
            $user->email,
            $subject,
            $html,
            null,
            null,
            null,
            'job_expiry',
            ['tenant_id' => (int) $vacancy->tenant_id]
        )) {
            Log::warning('JobExpiryNotificationService: failed to send expiry email', ['user_id' => $user->id, 'vacancy_id' => $vacancy->id]);
            return false;
        }

        return true;
    }
}
