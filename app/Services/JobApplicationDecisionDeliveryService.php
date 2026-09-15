<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\JobApplication;
use App\Models\Notification;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Durable member-delivery boundary for committed job application decisions. */
class JobApplicationDecisionDeliveryService
{
    private const MAX_ATTEMPTS = 8;
    private const CLAIM_MINUTES = 5;

    /** Must be called in the same transaction that records the decision history. */
    public static function record(
        int $tenantId,
        int $historyId,
        int $applicationId,
        ?string $fromStatus,
        string $toStatus,
    ): void {
        DB::table('job_application_decision_delivery_outbox')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'history_id' => $historyId,
            'application_id' => $applicationId,
            'from_status' => $fromStatus,
            'to_status' => $toStatus,
            'attempts' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function dispatchForHistory(int $tenantId, int $historyId, bool $retryNow = false): bool
    {
        $id = DB::table('job_application_decision_delivery_outbox')
            ->where('tenant_id', $tenantId)
            ->where('history_id', $historyId)
            ->value('id');

        return $id !== null && $this->dispatchOutboxId((int) $id, $retryNow);
    }

    /** @return array{claimed:int,completed:int,retried:int,dead_lettered:int} */
    public function processBatch(int $limit = 100): array
    {
        $limit = max(1, min(500, $limit));
        $ids = DB::table('job_application_decision_delivery_outbox')
            ->whereNull('completed_at')
            ->whereNull('dead_lettered_at')
            ->where(function ($query): void {
                $query->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now());
            })
            ->where(function ($query): void {
                $query->whereNull('claim_until')->orWhere('claim_until', '<=', now());
            })
            ->orderBy('id')
            ->limit($limit)
            ->pluck('id')
            ->map(static fn ($id): int => (int) $id)
            ->all();

        $summary = ['claimed' => 0, 'completed' => 0, 'retried' => 0, 'dead_lettered' => 0];
        foreach ($ids as $id) {
            $before = DB::table('job_application_decision_delivery_outbox')->where('id', $id)->first();
            if ($before === null) continue;

            $completed = $this->dispatchOutboxId($id);
            $after = DB::table('job_application_decision_delivery_outbox')->where('id', $id)->first();
            if ($after === null || (int) $after->attempts <= (int) $before->attempts) continue;

            $summary['claimed']++;
            if ($completed) {
                $summary['completed']++;
            } else {
                $summary[$after->dead_lettered_at === null ? 'retried' : 'dead_lettered']++;
            }
        }

        return $summary;
    }

    private function dispatchOutboxId(int $id, bool $retryNow = false): bool
    {
        $now = now();
        $claimed = DB::table('job_application_decision_delivery_outbox')
            ->where('id', $id)
            ->whereNull('completed_at')
            ->whereNull('dead_lettered_at')
            ->when(!$retryNow, function ($query) use ($now): void {
                $query->where(function ($due) use ($now): void {
                    $due->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', $now);
                });
            })
            ->where(function ($query) use ($now): void {
                $query->whereNull('claim_until')->orWhere('claim_until', '<=', $now);
            })
            ->update([
                'attempts' => DB::raw('attempts + 1'),
                'claim_until' => $now->copy()->addMinutes(self::CLAIM_MINUTES),
                'updated_at' => $now,
            ]);

        if ($claimed !== 1) {
            return DB::table('job_application_decision_delivery_outbox')
                ->where('id', $id)
                ->whereNotNull('completed_at')
                ->exists();
        }

        $row = DB::table('job_application_decision_delivery_outbox')->where('id', $id)->first();
        if ($row === null) return false;

        try {
            TenantContext::runForTenant((int) $row->tenant_id, function () use ($id, $row): void {
                $application = JobApplication::withoutGlobalScopes()
                    ->with('vacancy')
                    ->whereKey((int) $row->application_id)
                    ->where('tenant_id', (int) $row->tenant_id)
                    ->first();
                $applicant = $application === null
                    ? null
                    : DB::table('users')
                        ->where('id', (int) $application->user_id)
                        ->where('tenant_id', (int) $row->tenant_id)
                        ->select(['id', 'preferred_language'])
                        ->first();
                if ($application === null || $application->vacancy === null || $applicant === null) {
                    throw new \RuntimeException('job_application_decision_delivery_source_missing');
                }

                LocaleContext::withLocale($applicant, function () use ($id, $row, $application): void {
                    $applicantId = (int) $application->user_id;
                    $link = "/jobs/{$application->vacancy_id}";
                    $jobTitle = $application->vacancy->title ?? __('emails.common.fallback_job');
                    $message = match ((string) $row->to_status) {
                        'shortlisted' => __('svc_notifications.job_application.shortlisted', ['title' => $jobTitle]),
                        'rejected' => __('svc_notifications.job_application.rejected', ['title' => $jobTitle]),
                        'hired', 'accepted' => __('svc_notifications.job_application.hired', ['title' => $jobTitle]),
                        default => __('svc_notifications.job_application.status_updated', [
                            'title' => $jobTitle,
                            'status' => (string) $row->to_status,
                        ]),
                    };

                    if ($row->bell_created_at === null) {
                        $this->createBell($applicantId, $message, $link, (int) $row->tenant_id, (int) $row->history_id);
                        $this->markStep($id, 'bell_created_at');
                    }
                    if ($row->push_dispatched_at === null) {
                        $this->dispatchPush($applicantId, $message, $link);
                        $this->markStep($id, 'push_dispatched_at');
                    }
                    if ($row->realtime_dispatched_at === null) {
                        $this->dispatchRealtime($applicantId, $message, $application, $row);
                        $this->markStep($id, 'realtime_dispatched_at');
                    }
                });
            });

            DB::table('job_application_decision_delivery_outbox')->where('id', $id)->update([
                'completed_at' => now(),
                'claim_until' => null,
                'next_attempt_at' => null,
                'last_error' => null,
                'updated_at' => now(),
            ]);
            return true;
        } catch (\Throwable $error) {
            $attempts = (int) $row->attempts;
            $dead = $attempts >= self::MAX_ATTEMPTS;
            $safeError = $this->safeError($error);
            DB::table('job_application_decision_delivery_outbox')->where('id', $id)->update([
                'claim_until' => null,
                'next_attempt_at' => $dead ? null : $this->nextAttemptAt($attempts),
                'dead_lettered_at' => $dead ? now() : null,
                'last_error' => $safeError,
                'updated_at' => now(),
            ]);
            Log::log($dead ? 'critical' : 'warning', 'Job application decision delivery failed', [
                'outbox_id' => $id,
                'history_id' => (int) $row->history_id,
                'application_id' => (int) $row->application_id,
                'tenant_id' => (int) $row->tenant_id,
                'attempt' => $attempts,
                'dead_lettered' => $dead,
                'error' => $safeError,
            ]);
            return false;
        }
    }

    protected function createBell(int $userId, string $message, string $link, int $tenantId, int $historyId): void
    {
        Notification::createNotification(
            $userId,
            $message,
            $link,
            'job_application',
            false,
            $tenantId,
            "job-application-decision:{$historyId}",
        );
    }

    protected function dispatchPush(int $userId, string $message, string $link): void
    {
        NotificationDispatcher::fanOutPush($userId, 'job_application', $message, $link);
    }

    protected function dispatchRealtime(int $userId, string $message, JobApplication $application, object $row): void
    {
        RealtimeService::broadcastOnly($userId, $message, [
            'type' => 'job_application_status',
            'job_id' => (int) $application->vacancy_id,
            'job_title' => $application->vacancy->title,
            'application_id' => (int) $application->id,
            'from_status' => $row->from_status,
            'to_status' => (string) $row->to_status,
            'message' => $message,
        ]);
    }

    private function markStep(int $id, string $column): void
    {
        DB::table('job_application_decision_delivery_outbox')->where('id', $id)->update([
            $column => now(),
            'updated_at' => now(),
        ]);
    }

    private function nextAttemptAt(int $attempt): Carbon
    {
        $minutes = [1, 2, 5, 15, 30, 60, 180][$attempt - 1] ?? 360;
        return now()->addMinutes($minutes);
    }

    private function safeError(\Throwable $error): string
    {
        $message = trim($error->getMessage()) ?: $error::class;
        $singleLine = preg_replace('/[\r\n\t]+/', ' ', $message) ?? 'job_application_decision_delivery_failed';
        return EventNotificationErrorSanitizer::sanitize($singleLine, 255);
    }
}
