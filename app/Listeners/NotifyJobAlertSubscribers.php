<?php
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\JobVacancyCreated;
use App\I18n\LocaleContext;
use App\Models\JobAlert;
use App\Models\Notification;
use App\Services\RealtimeService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Notifies users who have active job alerts when a new matching vacancy is created.
 *
 * Checks keyword, type, commitment, location, and remote-only preferences.
 * Queued to avoid blocking the main request.
 */
class NotifyJobAlertSubscribers implements ShouldQueue
{
    /**
     * Fail fast rather than letting redis re-deliver mid-flight. The queue's
     * retry_after is 90s; a long alert fanout (bell + push + email per subscriber)
     * released back to another worker would re-send every matching alert email.
     * Killing at 60s and not retrying keeps one vacancy → one fanout.
     * Belt-and-braces with the Cache guard in handle() plus a per-recipient
     * sent marker inside the loop.
     */
    public int $tries = 1;
    public int $timeout = 60;

    public function __construct()
    {
        //
    }

    /**
     * Handle the event.
     */
    public function handle(JobVacancyCreated $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent re-deliveries for the
        // same vacancy so the alert fanout runs exactly once (regression guard
        // for the 2026-04-02 email-bombing class).
        $vacancyId = (int) ($event->vacancy->id ?? 0);
        $guardTenantId = (int) ($event->tenantId ?? 0);
        $handledKey = null;
        $claimKey = null;
        $claimAcquired = false;
        if ($vacancyId > 0) {
            $handledKey = 'notify_job_alert_subscribers:done:' . $guardTenantId . ':' . $vacancyId;
            $claimKey = 'notify_job_alert_subscribers:claim:' . $guardTenantId . ':' . $vacancyId;
            if (Cache::has($handledKey)) {
                Log::info('NotifyJobAlertSubscribers: duplicate delivery suppressed', ['vacancy_id' => $vacancyId, 'tenant_id' => $guardTenantId]);
                return;
            }
            $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
            if (!$claimAcquired) {
                Log::info('NotifyJobAlertSubscribers: concurrent delivery suppressed', ['vacancy_id' => $vacancyId, 'tenant_id' => $guardTenantId]);
                return;
            }
        }

        $previousTenantId = TenantContext::currentId();

        try {
            // Ensure tenant context is set (required when running via async queue)
            TenantContext::setById($event->tenantId);

            $vacancy = $event->vacancy;
            $tenantId = $event->tenantId;

            $alerts = JobAlert::where('tenant_id', $tenantId)
                ->where('is_active', 1)
                ->get();

            foreach ($alerts as $alert) {
                if (!$this->matchesAlert($vacancy, $alert)) {
                    continue;
                }

                try {
                    $alertUserId = (int) $alert->user_id;

                    // Per-recipient idempotency: each (tenant, vacancy, alert) is
                    // notified at most once even if a re-delivered copy slips past
                    // the vacancy-level claim mid-fanout.
                    $sentKey = 'notify_job_alert_subscribers:sent:' . $guardTenantId . ':' . $vacancyId . ':' . (int) $alert->id;
                    if (!Cache::add($sentKey, 1, now()->addHour())) {
                        continue;
                    }

                    $user = \App\Models\User::find($alert->user_id);
                    $emailSent = false;

                    // Bell + push + email all render in the subscriber's language.
                    LocaleContext::withLocale($user, function () use ($alertUserId, $vacancy, $user, $alert, &$emailSent) {
                        Notification::createNotification(
                            $alertUserId,
                            __('svc_notifications.job_alert.match_bell', ['title' => $vacancy->title]),
                            "/jobs/{$vacancy->id}",
                            'job_application'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($alertUserId), 'job_application', __('svc_notifications.job_alert.match_bell', ['title' => $vacancy->title]), "/jobs/{$vacancy->id}");
                        RealtimeService::broadcastOnly($alertUserId, __('svc_notifications.job_alert.match_push_title'), [
                            'type'      => 'job_alert_match',
                            'job_id'    => (int) $vacancy->id,
                            'job_title' => $vacancy->title,
                            'message'   => __('svc_notifications.job_alert.match_push_message', ['title' => $vacancy->title]),
                            'url'       => "/jobs/{$vacancy->id}",
                        ]);

                        // Send email alert
                        try {
                            if ($user && $user->email) {
                                $emailSent = \App\Services\JobAlertEmailService::sendImmediateAlert($user, $vacancy, $alert);
                            }
                        } catch (\Throwable $e) {
                            \Illuminate\Support\Facades\Log::warning('NotifyJobAlertSubscribers: email dispatch failed: ' . $e->getMessage());
                        }
                    });

                    if ($emailSent) {
                        $alert->update(['last_notified_at' => now()]);
                    } else {
                        Log::warning('NotifyJobAlertSubscribers: email returned false; alert not marked notified', [
                            'alert_id' => $alert->id,
                            'user_id' => $alertUserId,
                            'vacancy_id' => $vacancy->id,
                        ]);
                    }
                } catch (\Throwable $e) {
                    Log::warning('NotifyJobAlertSubscribers: failed for alert ' . $alert->id, [
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            // Mark handled only after the full fanout ran so a redis re-delivery
            // cannot re-run the alert loop.
            if ($handledKey !== null) {
                Cache::put($handledKey, 1, now()->addHour());
            }
        } catch (\Throwable $e) {
            Log::error('NotifyJobAlertSubscribers listener failed', [
                'vacancy_id' => $event->vacancy->id ?? null,
                'error'      => $e->getMessage(),
                'trace'      => $e->getTraceAsString(),
            ]);
        } finally {
            if ($claimAcquired && $claimKey !== null) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    /**
     * Check whether a vacancy matches the given job alert's criteria.
     */
    private function matchesAlert(\App\Models\JobVacancy $vacancy, JobAlert $alert): bool
    {
        // Keywords: vacancy title or description must contain at least one keyword
        if (!empty($alert->keywords)) {
            $keywords = array_filter(array_map('trim', explode(',', $alert->keywords)));
            if (!empty($keywords)) {
                $title = strtolower($vacancy->title ?? '');
                $description = strtolower($vacancy->description ?? '');
                $found = false;
                foreach ($keywords as $keyword) {
                    if (str_contains($title, strtolower($keyword)) ||
                        str_contains($description, strtolower($keyword))) {
                        $found = true;
                        break;
                    }
                }
                if (!$found) {
                    return false;
                }
            }
        }

        // Type: alert type must match vacancy type, or alert type is null/empty (any)
        if (!empty($alert->type) && $alert->type !== $vacancy->type) {
            return false;
        }

        // Commitment: alert commitment must match, or null/empty (any)
        if (!empty($alert->commitment) && $alert->commitment !== $vacancy->commitment) {
            return false;
        }

        // Location: alert location must match, or null/empty (any)
        if (!empty($alert->location) && !empty($vacancy->location)) {
            if (stripos($vacancy->location, $alert->location) === false) {
                return false;
            }
        }

        // Remote only: if alert requires remote, vacancy must be remote
        if (!empty($alert->is_remote_only) && empty($vacancy->is_remote)) {
            return false;
        }

        return true;
    }
}
