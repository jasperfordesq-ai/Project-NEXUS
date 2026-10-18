<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\TransactionCompleted;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use App\Services\NotificationDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Sends in-app + email notifications to the receiver when a time-credit
 * transaction completes. Respects the user's email_transactions preference.
 */
class NotifyTransactionCompleted implements ShouldQueue
{
    private const CHANNEL_BELL = 'bell';
    private const CHANNEL_EMAIL = 'email';
    private const STATUS_CLAIMED = 'claimed';
    private const STATUS_DELIVERED = 'delivered';
    private const STATUS_FAILED = 'failed';
    private const STATUS_SKIPPED = 'skipped';

    public function __construct()
    {
        //
    }

    /**
     * Handle the event.
     */
    public function handle(TransactionCompleted $event): void
    {
        $previousTenantId = TenantContext::currentId();

        try {
            // Ensure tenant context is set (required when running via async queue).
            if (!TenantContext::setById($event->tenantId)) {
                Log::warning('NotifyTransactionCompleted: tenant not found, skipping', [
                    'tenant_id' => $event->tenantId,
                    'transaction_id' => $event->transaction->id ?? null,
                ]);
                return;
            }

            $sender = $event->sender;
            $receiver = $event->receiver;
            $transaction = $event->transaction;

            $amount = (float) $transaction->amount;
            $description = $transaction->description ?? '';

            // 1. RECEIVER-side: bell notification + email (render in receiver's locale).
            LocaleContext::withLocale($receiver, function () use ($sender, $receiver, $transaction, $amount, $description) {
                $senderName = $sender->first_name ?? $sender->name ?? __('emails.common.fallback_someone');

                $content = __('notifications.credit_received', ['name' => $senderName, 'amount' => $amount]);
                if ($description !== '') {
                    $content .= ' ' . __('notifications.credit_received_for', ['description' => $description]);
                }

                self::deliverTransactionBell((int) $transaction->id, (int) $receiver->id, 'credit_received', function () use ($receiver, $content, $senderName, $amount): int {
                    $bellId = Notification::createNotification(
                        $receiver->id,
                        $content,
                        '/wallet',
                        'transaction'
                    );
                    // Lock-screen copy: "You received 1.5 hours from Alice" — the time
                    // credits and the sender, never the transaction description.
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($receiver->id), 'transaction', $content, '/wallet', false, [
                        'actor' => $senderName,
                        'hours' => $amount,
                    ]);
                    return $bellId;
                });

                $emailEnabled = true;
                try {
                    $prefs = User::getNotificationPreferences($receiver->id);
                    $emailEnabled = (bool) ($prefs['email_transactions'] ?? true);
                } catch (\Throwable $prefError) {
                    Log::debug('NotifyTransactionCompleted: could not read email_transactions pref', [
                        'user_id' => $receiver->id,
                        'error' => $prefError->getMessage(),
                    ]);
                }

                if ($emailEnabled) {
                    self::deliverTransactionEmail((int) $transaction->id, (int) $receiver->id, 'credit_received', function () use ($receiver, $senderName, $amount, $description): ?bool {
                        return NotificationDispatcher::sendCreditEmail(
                            $receiver->id,
                            $senderName,
                            $amount,
                            $description
                        );
                    });
                }
            });

            // 2. SENDER-side: confirmation email (render in sender's locale).
            LocaleContext::withLocale($sender, function () use ($sender, $receiver, $transaction, $amount, $description) {
                $senderEmailEnabled = true;
                try {
                    $senderPrefs = \App\Models\User::getNotificationPreferences($sender->id);
                    $senderEmailEnabled = (bool) ($senderPrefs['email_transactions'] ?? true);
                } catch (\Throwable $prefError) {
                    Log::debug('NotifyTransactionCompleted: could not read sender email_transactions pref', [
                        'user_id' => $sender->id,
                        'error' => $prefError->getMessage(),
                    ]);
                }

                if ($senderEmailEnabled) {
                    $recipientName = $receiver->first_name ?? $receiver->name ?? __('emails.common.fallback_someone');
                    self::deliverTransactionEmail((int) $transaction->id, (int) $sender->id, 'credit_sent', function () use ($sender, $recipientName, $amount, $description): ?bool {
                        return NotificationDispatcher::sendCreditSentEmail(
                            $sender->id,
                            $recipientName,
                            $amount,
                            $description
                        );
                    });
                }
            });

            // 3. Review requests — each party gets one in THEIR language.
            try {
                // Compute each fallback name INSIDE the recipient's locale closure so a
                // deleted-account 'someone' fallback renders in that recipient's language
                // rather than the queue worker's default locale.
                LocaleContext::withLocale($receiver, function () use ($receiver, $sender, $transaction) {
                    $senderName = $sender->first_name ?? $sender->name ?? __('emails.common.fallback_someone');
                    self::deliverTransactionEmail((int) $transaction->id, (int) $receiver->id, 'review_request', fn (): ?bool =>
                        NotificationDispatcher::sendReviewRequestEmail($receiver->id, $senderName, $transaction->id)
                    );
                });
                LocaleContext::withLocale($sender, function () use ($sender, $receiver, $transaction) {
                    $recipientNameForReview = $receiver->first_name ?? $receiver->name ?? __('emails.common.fallback_someone');
                    self::deliverTransactionEmail((int) $transaction->id, (int) $sender->id, 'review_request', fn (): ?bool =>
                        NotificationDispatcher::sendReviewRequestEmail($sender->id, $recipientNameForReview, $transaction->id)
                    );
                });
            } catch (\Throwable $reviewError) {
                Log::warning('NotifyTransactionCompleted: sendReviewRequestEmail failed', [
                    'transaction_id' => $transaction->id ?? null,
                    'error'          => $reviewError->getMessage(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::error('NotifyTransactionCompleted listener failed', [
                'transaction_id' => $event->transaction->id ?? null,
                'sender_id' => $event->sender->id ?? null,
                'receiver_id' => $event->receiver->id ?? null,
                'tenant_id' => $event->tenantId ?? null,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    /**
     * @param callable():int $createBell
     */
    private static function deliverTransactionBell(int $transactionId, int $userId, string $event, callable $createBell): void
    {
        if (!self::claimDelivery($transactionId, $userId, $event, self::CHANNEL_BELL)) {
            return;
        }

        try {
            $notificationId = $createBell();
            self::markDelivery($transactionId, $userId, $event, self::CHANNEL_BELL, self::STATUS_DELIVERED, (string) $notificationId);
        } catch (\Throwable $e) {
            self::markFailed($transactionId, $userId, $event, self::CHANNEL_BELL, $e->getMessage());
            throw $e;
        }
    }

    /**
     * @param callable():bool|null $sendEmail
     */
    private static function deliverTransactionEmail(int $transactionId, int $userId, string $event, callable $sendEmail): void
    {
        if (!self::claimDelivery($transactionId, $userId, $event, self::CHANNEL_EMAIL)) {
            return;
        }

        try {
            $result = $sendEmail();
            if ($result === null) {
                self::markDelivery($transactionId, $userId, $event, self::CHANNEL_EMAIL, self::STATUS_SKIPPED);
                return;
            }

            if ($result === false) {
                self::markFailed($transactionId, $userId, $event, self::CHANNEL_EMAIL, 'Email dispatch returned false');
                return;
            }

            self::markDelivery($transactionId, $userId, $event, self::CHANNEL_EMAIL, self::STATUS_DELIVERED);
        } catch (\Throwable $e) {
            self::markFailed($transactionId, $userId, $event, self::CHANNEL_EMAIL, $e->getMessage());
            throw $e;
        }
    }

    private static function claimDelivery(int $transactionId, int $userId, string $event, string $channel): bool
    {
        $tenantId = TenantContext::getId();
        if ($transactionId <= 0 || $userId <= 0 || $tenantId === null || !Schema::hasTable('transaction_notification_deliveries')) {
            return $userId > 0;
        }

        $tenantId = (int) $tenantId;
        $now = now();
        $staleBefore = $now->copy()->subMinutes(10);

        return DB::transaction(function () use ($tenantId, $transactionId, $userId, $event, $channel, $now, $staleBefore): bool {
            $record = DB::table('transaction_notification_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('transaction_id', $transactionId)
                ->where('event', $event)
                ->where('user_id', $userId)
                ->where('channel', $channel)
                ->lockForUpdate()
                ->first();

            if (!$record) {
                DB::table('transaction_notification_deliveries')->insert([
                    'tenant_id' => $tenantId,
                    'transaction_id' => $transactionId,
                    'event' => $event,
                    'user_id' => $userId,
                    'channel' => $channel,
                    'status' => self::STATUS_CLAIMED,
                    'attempts' => 1,
                    'claimed_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                return true;
            }

            if (in_array($record->status, [self::STATUS_DELIVERED, self::STATUS_SKIPPED], true)) {
                return false;
            }

            if ($record->status === self::STATUS_CLAIMED && $record->claimed_at !== null && Carbon::parse($record->claimed_at)->greaterThan($staleBefore)) {
                return false;
            }

            DB::table('transaction_notification_deliveries')
                ->where('id', $record->id)
                ->update([
                    'status' => self::STATUS_CLAIMED,
                    'attempts' => DB::raw('attempts + 1'),
                    'claimed_at' => $now,
                    'failed_at' => null,
                    'last_error' => null,
                    'updated_at' => $now,
                ]);

            return true;
        });
    }

    private static function markDelivery(int $transactionId, int $userId, string $event, string $channel, string $status, ?string $evidenceId = null): void
    {
        $tenantId = TenantContext::getId();
        if ($transactionId <= 0 || $userId <= 0 || $tenantId === null || !Schema::hasTable('transaction_notification_deliveries')) {
            return;
        }

        DB::table('transaction_notification_deliveries')
            ->where('tenant_id', (int) $tenantId)
            ->where('transaction_id', $transactionId)
            ->where('event', $event)
            ->where('user_id', $userId)
            ->where('channel', $channel)
            ->update([
                'status' => $status,
                'delivered_at' => $status === self::STATUS_DELIVERED ? now() : null,
                'failed_at' => null,
                'evidence_id' => $evidenceId,
                'last_error' => null,
                'updated_at' => now(),
            ]);
    }

    private static function markFailed(int $transactionId, int $userId, string $event, string $channel, string $error): void
    {
        $tenantId = TenantContext::getId();
        if ($transactionId <= 0 || $userId <= 0 || $tenantId === null || !Schema::hasTable('transaction_notification_deliveries')) {
            return;
        }

        DB::table('transaction_notification_deliveries')
            ->where('tenant_id', (int) $tenantId)
            ->where('transaction_id', $transactionId)
            ->where('event', $event)
            ->where('user_id', $userId)
            ->where('channel', $channel)
            ->update([
                'status' => self::STATUS_FAILED,
                'failed_at' => now(),
                'last_error' => mb_substr($error, 0, 2000),
                'updated_at' => now(),
            ]);
    }
}
