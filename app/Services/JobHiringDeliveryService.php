<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\JobInterview;
use App\Models\JobOffer;
use App\Models\Notification;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Durable member-delivery boundary for committed job offer and interview events. */
class JobHiringDeliveryService
{
    private const MAX_ATTEMPTS = 8;
    private const CLAIM_MINUTES = 5;

    /** Must be called in the same transaction that commits the hiring action. */
    public static function record(int $tenantId, string $eventType, int $sourceId, int $recipientId): int
    {
        DB::table('job_hiring_delivery_outbox')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'event_type' => $eventType,
            'source_id' => $sourceId,
            'recipient_id' => $recipientId,
            'attempts' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (int) DB::table('job_hiring_delivery_outbox')
            ->where('tenant_id', $tenantId)
            ->where('event_type', $eventType)
            ->where('source_id', $sourceId)
            ->where('recipient_id', $recipientId)
            ->value('id');
    }

    public function dispatchForEvent(
        int $tenantId,
        string $eventType,
        int $sourceId,
        int $recipientId,
        bool $retryNow = false,
    ): bool {
        $id = DB::table('job_hiring_delivery_outbox')
            ->where('tenant_id', $tenantId)
            ->where('event_type', $eventType)
            ->where('source_id', $sourceId)
            ->where('recipient_id', $recipientId)
            ->value('id');

        return $id !== null && $this->dispatchOutboxId((int) $id, $retryNow);
    }

    /** @return array{claimed:int,completed:int,retried:int,dead_lettered:int} */
    public function processBatch(int $limit = 100): array
    {
        $limit = max(1, min(500, $limit));
        $ids = DB::table('job_hiring_delivery_outbox')
            ->whereNull('completed_at')
            ->whereNull('dead_lettered_at')
            ->where(fn ($query) => $query->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now()))
            ->where(fn ($query) => $query->whereNull('claim_until')->orWhere('claim_until', '<=', now()))
            ->orderBy('id')
            ->limit($limit)
            ->pluck('id')
            ->map(static fn ($id): int => (int) $id)
            ->all();

        $summary = ['claimed' => 0, 'completed' => 0, 'retried' => 0, 'dead_lettered' => 0];
        foreach ($ids as $id) {
            $before = DB::table('job_hiring_delivery_outbox')->where('id', $id)->first();
            if ($before === null) continue;

            $completed = $this->dispatchOutboxId($id);
            $after = DB::table('job_hiring_delivery_outbox')->where('id', $id)->first();
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
        $claimed = DB::table('job_hiring_delivery_outbox')
            ->where('id', $id)
            ->whereNull('completed_at')
            ->whereNull('dead_lettered_at')
            ->when(!$retryNow, function ($query) use ($now): void {
                $query->where(fn ($due) => $due->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', $now));
            })
            ->where(fn ($query) => $query->whereNull('claim_until')->orWhere('claim_until', '<=', $now))
            ->update([
                'attempts' => DB::raw('attempts + 1'),
                'claim_until' => $now->copy()->addMinutes(self::CLAIM_MINUTES),
                'updated_at' => $now,
            ]);

        if ($claimed !== 1) {
            return DB::table('job_hiring_delivery_outbox')
                ->where('id', $id)
                ->whereNotNull('completed_at')
                ->exists();
        }

        $row = DB::table('job_hiring_delivery_outbox')->where('id', $id)->first();
        if ($row === null) return false;

        try {
            TenantContext::runForTenant((int) $row->tenant_id, function () use ($id, $row): void {
                $context = $this->loadContext($row);
                LocaleContext::withLocale($context['recipient'], function () use ($id, $row, $context): void {
                    $spec = $this->eventSpec((string) $row->event_type, $context);
                    $key = "job-hiring:{$row->event_type}:{$row->source_id}:{$row->recipient_id}";

                    if ($row->bell_created_at === null) {
                        $this->createBell((int) $row->recipient_id, $spec['message'], $spec['link'], $spec['category'], (int) $row->tenant_id, $key);
                        $this->markStep($id, 'bell_created_at');
                    }
                    if ($row->push_dispatched_at === null) {
                        $this->dispatchPush((int) $row->recipient_id, $spec['category'], $spec['message'], $spec['link']);
                        $this->markStep($id, 'push_dispatched_at');
                    }
                    if ($row->realtime_dispatched_at === null) {
                        $this->dispatchRealtime((int) $row->recipient_id, $spec['title'], $spec['realtime']);
                        $this->markStep($id, 'realtime_dispatched_at');
                    }
                    if ($row->email_dispatched_at === null) {
                        if ($spec['email'] !== null) {
                            $this->dispatchEmail($context['recipient'], $spec['email'], $key, (int) $row->tenant_id);
                        }
                        $this->markStep($id, 'email_dispatched_at');
                    }
                });
            });

            DB::table('job_hiring_delivery_outbox')->where('id', $id)->update([
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
            DB::table('job_hiring_delivery_outbox')->where('id', $id)->update([
                'claim_until' => null,
                'next_attempt_at' => $dead ? null : $this->nextAttemptAt($attempts),
                'dead_lettered_at' => $dead ? now() : null,
                'last_error' => $safeError,
                'updated_at' => now(),
            ]);
            Log::log($dead ? 'critical' : 'warning', 'Job hiring member delivery failed', [
                'outbox_id' => $id,
                'event_type' => (string) $row->event_type,
                'source_id' => (int) $row->source_id,
                'recipient_id' => (int) $row->recipient_id,
                'tenant_id' => (int) $row->tenant_id,
                'attempt' => $attempts,
                'dead_lettered' => $dead,
                'error' => $safeError,
            ]);
            return false;
        }
    }

    /** @return array{recipient:object,source:JobOffer|JobInterview,vacancy:object} */
    private function loadContext(object $row): array
    {
        $event = (string) $row->event_type;
        if (str_starts_with($event, 'offer_')) {
            $source = JobOffer::withoutGlobalScopes()
                ->with(['application' => fn ($query) => $query->withoutGlobalScopes()->with(['vacancy' => fn ($vacancy) => $vacancy->withoutGlobalScopes()])])
                ->whereKey((int) $row->source_id)
                ->where('tenant_id', (int) $row->tenant_id)
                ->first();
        } elseif (str_starts_with($event, 'interview_')) {
            $source = JobInterview::withoutGlobalScopes()
                ->with(['application' => fn ($query) => $query->withoutGlobalScopes()->with(['vacancy' => fn ($vacancy) => $vacancy->withoutGlobalScopes()])])
                ->whereKey((int) $row->source_id)
                ->where('tenant_id', (int) $row->tenant_id)
                ->first();
        } else {
            throw new \RuntimeException('job_hiring_delivery_event_unknown');
        }

        $vacancy = $source?->application?->vacancy;
        $candidateId = (int) ($source?->application?->user_id ?? 0);
        $posterId = (int) ($vacancy?->user_id ?? 0);
        $expectedRecipient = in_array($event, ['offer_received', 'offer_withdrawn', 'offer_credits_earned', 'interview_proposed', 'interview_cancelled'], true)
            ? $candidateId
            : $posterId;
        $recipient = DB::table('users')
            ->where('id', (int) $row->recipient_id)
            ->where('tenant_id', (int) $row->tenant_id)
            ->select(['id', 'email', 'first_name', 'name', 'preferred_language'])
            ->first();

        if ($source === null || $vacancy === null || $recipient === null || $expectedRecipient <= 0 || $expectedRecipient !== (int) $row->recipient_id) {
            throw new \RuntimeException('job_hiring_delivery_source_missing');
        }

        return ['recipient' => $recipient, 'source' => $source, 'vacancy' => $vacancy];
    }

    /** @return array{message:string,title:string,link:string,category:string,realtime:array<string,mixed>,email:?array<string,string>} */
    private function eventSpec(string $event, array $context): array
    {
        $source = $context['source'];
        $vacancy = $context['vacancy'];
        $title = $vacancy->title ?? __('emails.common.fallback_job');
        $jobId = (int) $source->vacancy_id;
        $posterLink = "/jobs/{$jobId}#applications";
        $candidateLink = "/jobs/{$jobId}";
        $email = null;

        [$message, $pushTitle, $link, $category, $realtimeType] = match ($event) {
            'offer_received' => [__('svc_notifications.job_offer.received_bell', ['title' => $title]), __('svc_notifications.job_offer.received_push_title'), $candidateLink, 'job_application_status', 'job_offer_received'],
            'offer_accepted' => [__('svc_notifications.job_offer.accepted_bell', ['title' => $title]), __('svc_notifications.job_offer.accepted_push_title', ['title' => $title]), $posterLink, 'job_application_status', 'job_offer_accepted'],
            'offer_rejected' => [__('svc_notifications.job_offer.rejected_bell', ['title' => $title]), __('svc_notifications.job_offer.rejected_push_title', ['title' => $title]), $posterLink, 'job_application_status', 'job_offer_rejected'],
            'offer_withdrawn' => [__('svc_notifications.job_offer.withdrawn_bell', ['title' => $title]), __('svc_notifications.job_offer.withdrawn_push_title', ['title' => $title]), $candidateLink, 'job_application_status', 'job_offer_withdrawn'],
            'offer_credits_earned' => [__('svc_notifications.job_offer.credits_earned_bell', ['amount' => (float) $vacancy->time_credits, 'title' => $title]), __('svc_notifications.job_offer.credits_earned_push_title'), '/wallet', 'transaction', 'job_completion_credits'],
            'interview_proposed' => [__('emails_misc.jobs.interview_requested', ['title' => $title]), __('emails_misc.jobs.interview_requested', ['title' => $title]), $candidateLink, 'job_application', 'job_interview_proposed'],
            'interview_accepted' => [__('emails_misc.jobs.interview_accepted', ['title' => $title]), __('emails_misc.jobs.interview_accepted', ['title' => $title]), $posterLink, 'job_application_status', 'job_interview_accepted'],
            'interview_declined' => [__('emails_misc.jobs.interview_declined', ['title' => $title]), __('emails_misc.jobs.interview_declined', ['title' => $title]), $posterLink, 'job_application_status', 'job_interview_declined'],
            'interview_cancelled' => [__('emails_misc.jobs.interview_cancelled', ['title' => $title]), __('emails_misc.jobs.interview_cancelled', ['title' => $title]), $candidateLink, 'job_application_status', 'job_interview_cancelled'],
            default => throw new \RuntimeException('job_hiring_delivery_event_unknown'),
        };

        $emailSubjectKey = match ($event) {
            'interview_proposed' => 'emails_misc.jobs.interview_email_subject_proposed',
            'interview_accepted' => 'emails_misc.jobs.interview_email_subject_accepted',
            'interview_declined' => 'emails_misc.jobs.interview_email_subject_declined',
            'interview_cancelled' => 'emails_misc.jobs.interview_email_subject_cancelled',
            default => null,
        };
        if ($emailSubjectKey !== null) {
            $email = [
                'subject' => __($emailSubjectKey, ['title' => $title]),
                'body' => $message,
                'link' => $link,
            ];
        }

        $realtimeMessage = match ($event) {
            'offer_received' => __('svc_notifications.job_offer.received_push_message', ['title' => $title]),
            'offer_accepted' => __('svc_notifications.job_offer.accepted_push_message', ['title' => $title]),
            'offer_rejected' => __('svc_notifications.job_offer.rejected_push_message', ['title' => $title]),
            'offer_withdrawn' => __('svc_notifications.job_offer.withdrawn_push_message', ['title' => $title]),
            'offer_credits_earned' => __('svc_notifications.job_offer.credits_earned_push_message', [
                'amount' => (float) $vacancy->time_credits,
                'title' => $title,
            ]),
            default => $message,
        };

        $realtime = [
            'type' => $realtimeType,
            'job_id' => $jobId,
            'job_title' => $title,
            'message' => $realtimeMessage,
            'url' => $link,
        ];
        if ($event === 'offer_credits_earned') {
            $realtime['amount'] = (float) $vacancy->time_credits;
        }

        return [
            'message' => $message,
            'title' => $pushTitle,
            'link' => $link,
            'category' => $category,
            'realtime' => $realtime,
            'email' => $email,
        ];
    }

    protected function createBell(int $userId, string $message, string $link, string $category, int $tenantId, string $key): void
    {
        Notification::createNotification($userId, $message, $link, $category, false, $tenantId, $key);
    }

    protected function dispatchPush(int $userId, string $category, string $message, string $link): void
    {
        NotificationDispatcher::fanOutPush($userId, $category, $message, $link);
    }

    /** @param array<string,mixed> $payload */
    protected function dispatchRealtime(int $userId, string $title, array $payload): void
    {
        RealtimeService::broadcastOnly($userId, $title, $payload);
    }

    /** @param array<string,string> $email */
    protected function dispatchEmail(object $recipient, array $email, string $key, int $tenantId): void
    {
        if (empty($recipient->email)) return;

        $firstName = $recipient->first_name ?? $recipient->name ?? __('emails.common.fallback_name');
        $fullUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $email['link'];
        $html = EmailTemplateBuilder::make()
            ->title(__('emails_misc.jobs.interview_email_title'))
            ->previewText($email['body'])
            ->greeting($firstName)
            ->paragraph($email['body'])
            ->button(__('emails_misc.jobs.interview_email_cta'), $fullUrl)
            ->render();

        if (!EmailDispatchService::sendRaw($recipient->email, $email['subject'], $html, null, null, null, 'job_interview', [
            'tenant_id' => $tenantId,
            'source' => self::class,
            'idempotency_key' => $key,
        ])) {
            throw new \RuntimeException('job_hiring_delivery_email_refused');
        }
    }

    private function markStep(int $id, string $column): void
    {
        DB::table('job_hiring_delivery_outbox')->where('id', $id)->update([$column => now(), 'updated_at' => now()]);
    }

    private function nextAttemptAt(int $attempt): Carbon
    {
        $minutes = [1, 2, 5, 15, 30, 60, 180][$attempt - 1] ?? 360;
        return now()->addMinutes($minutes);
    }

    private function safeError(\Throwable $error): string
    {
        $message = trim($error->getMessage()) ?: $error::class;
        $singleLine = preg_replace('/[\r\n\t]+/', ' ', $message) ?? 'job_hiring_delivery_failed';
        return EventNotificationErrorSanitizer::sanitize($singleLine, 255);
    }
}
