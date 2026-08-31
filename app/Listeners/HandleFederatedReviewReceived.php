<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\FederatedReviewReceived;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\NotificationDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * HandleFederatedReviewReceived — notify a local user when a partner federation
 * node delivers an inbound review about them.
 *
 * The webhook controller has already persisted the review into the local
 * `reviews` table with `review_type = 'federated'`. This listener handles
 * the post-persistence side effects:
 *   - in-app bell notification to the reviewee in their preferred locale
 *   - per-user-preference email via the same path the local-review flow uses
 *     (NotificationDispatcher::sendReviewEmail honours email_reviews pref and
 *      tenant locale)
 *   - structured audit log
 */
class HandleFederatedReviewReceived implements ShouldQueue
{
    public string $queue = 'federation';

    public int $tries = 3;

    public array $backoff = [30, 120, 300];

    private int $currentReviewId = 0;

    public function handle(FederatedReviewReceived $event): void
    {
        $previousTenantId = TenantContext::currentId();
        $this->currentReviewId = $event->localId;

        try {
            if (!TenantContext::setById($event->tenantId)) {
                Log::warning('[HandleFederatedReviewReceived] tenant not found, skipping', [
                    'tenant_id'  => $event->tenantId,
                    'partner_id' => $event->externalPartnerId,
                    'review_id'  => $event->localId,
                ]);
                return;
            }

            $receiverId = (int) ($event->shadowRow['receiver_id'] ?? 0);
            if ($receiverId <= 0) {
                return;
            }

            $receiver = DB::table('users')
                ->where('id', $receiverId)
                ->where('tenant_id', $event->tenantId)
                ->where('status', 'active')
                ->select(['id', 'email', 'first_name', 'name', 'preferred_language', 'federation_notifications_enabled'])
                ->first();
            if (! $receiver) {
                Log::info('[HandleFederatedReviewReceived] receiver not found locally', [
                    'tenant_id'   => $event->tenantId,
                    'partner_id'  => $event->externalPartnerId,
                    'receiver_id' => $receiverId,
                ]);
                return;
            }

            // Honour the receiver's federation-notifications preference. The
            // column defaults to 1; only members who explicitly opted out
            // (via Settings → Notifications) are skipped. The bell + email
            // are both suppressed because the whole notification is about
            // federated activity.
            if (isset($receiver->federation_notifications_enabled)
                && (int) $receiver->federation_notifications_enabled === 0) {
                Log::info('[HandleFederatedReviewReceived] receiver opted out of federation notifications', [
                    'tenant_id'   => $event->tenantId,
                    'receiver_id' => $receiverId,
                ]);
                return;
            }

            $rating  = (int) ($event->shadowRow['rating'] ?? 0);
            $comment = $event->shadowRow['comment'] ?? null;

            // Partner-side member is anonymous from our perspective — we know
            // the external user id but not their name. Use the locale-aware
            // "Someone" fallback in the email body via $isAnonymous = true.
            LocaleContext::withLocale($receiver, function () use ($receiver, $receiverId, $rating, $comment) {
                if ($this->claimReviewSideEffect('notification_sent_at', 'notification_claimed_at')) {
                    Notification::createNotification(
                        $receiverId,
                        __('notifications.review_received_in_app', [
                            'name'   => __('emails.notification.someone'),
                            'rating' => $rating,
                        ]),
                        '/reviews',
                        'federation_review'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($receiverId), 'federation_review', __('notifications.review_received_in_app', [
                        'name'   => __('emails.notification.someone'),
                        'rating' => $rating,
                    ]), '/reviews');
                    $this->markReviewSideEffectSent('notification_sent_at');
                }

                // Email honours $prefs['email_reviews']. Anonymous flag flips
                // the rendered name to a locale-aware "Someone".
                if ($this->claimReviewSideEffect('email_sent_at', 'email_claimed_at', 'email_skipped_at')) {
                    $emailSent = NotificationDispatcher::sendReviewEmail(
                        $receiverId,
                        '', // reviewer name unknown — sendReviewEmail handles anonymous
                        $rating,
                        is_string($comment) ? $comment : null,
                        true
                    );

                    if ($emailSent === true) {
                        $this->markReviewSideEffectSent('email_sent_at', [
                            'email_failed_at' => null,
                            'email_last_error' => null,
                        ]);
                    } elseif ($emailSent === null) {
                        $this->markReviewSideEffectSent('email_skipped_at', [
                            'email_failed_at' => null,
                            'email_last_error' => null,
                        ]);
                    } else {
                        // Best-effort email: the review is already recorded and the
                        // failure is persisted (email_failed_at / email_last_error) for
                        // retry and visibility. Do NOT throw — this is a ShouldQueue
                        // listener, so throwing would retry the job and re-fire the
                        // side-effects (duplicate-email risk), and when the queue runs
                        // sync it 500s the federated-review ingest. Fail gracefully,
                        // matching the federated message / transaction handlers.
                        $this->markReviewEmailFailed('Email dispatch returned false');
                    }
                }
            });

            Log::info('[HandleFederatedReviewReceived] notified reviewee', [
                'tenant_id'    => $event->tenantId,
                'partner_id'   => $event->externalPartnerId,
                'review_id'    => $event->localId,
                'receiver_id'  => $receiverId,
                'rating'       => $rating,
            ]);
        } catch (\Throwable $e) {
            Log::warning('HandleFederatedReviewReceived failed', [
                'tenant_id'  => $event->tenantId ?? null,
                'partner_id' => $event->externalPartnerId ?? null,
                'review_id'  => $event->localId ?? null,
                'error'      => $e->getMessage(),
            ]);
            throw $e;
        } finally {
            $this->currentReviewId = 0;
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    private function claimReviewSideEffect(string $sentColumn, string $claimColumn, ?string $skipColumn = null): bool
    {
        if (!Schema::hasColumn('reviews', $sentColumn) || !Schema::hasColumn('reviews', $claimColumn)) {
            return true;
        }

        $reviewId = $this->currentReviewId();
        if ($reviewId <= 0) {
            return true;
        }

        $query = DB::table('reviews')
            ->where('tenant_id', TenantContext::getId())
            ->where('id', $reviewId)
            ->whereNull($sentColumn)
            ->where(function ($claim) use ($claimColumn) {
                $claim->whereNull($claimColumn)
                    ->orWhere($claimColumn, '<', now()->subMinutes(10));
            });

        if ($skipColumn !== null && Schema::hasColumn('reviews', $skipColumn)) {
            $query->whereNull($skipColumn);
        }

        return $query->update([
            $claimColumn => now(),
            'updated_at' => now(),
        ]) === 1;
    }

    /**
     * @param array<string, mixed> $extra
     */
    private function markReviewSideEffectSent(string $sentColumn, array $extra = []): void
    {
        if (!Schema::hasColumn('reviews', $sentColumn)) {
            return;
        }

        $reviewId = $this->currentReviewId();
        if ($reviewId <= 0) {
            return;
        }

        DB::table('reviews')
            ->where('tenant_id', TenantContext::getId())
            ->where('id', $reviewId)
            ->update(array_merge($extra, [
                $sentColumn => now(),
                'updated_at' => now(),
            ]));
    }

    private function markReviewEmailFailed(string $error): void
    {
        $reviewId = $this->currentReviewId();
        if ($reviewId <= 0 || !Schema::hasColumn('reviews', 'email_failed_at')) {
            return;
        }

        DB::table('reviews')
            ->where('tenant_id', TenantContext::getId())
            ->where('id', $reviewId)
            ->update([
                'email_failed_at' => now(),
                'email_last_error' => mb_substr($error, 0, 2000),
                'email_claimed_at' => null,
                'updated_at' => now(),
            ]);
    }

    private function currentReviewId(): int
    {
        return $this->currentReviewId;
    }
}
