<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Contracts\EventBroadcastTransport;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\Enums\EventBroadcastChannel;
use App\Enums\EventBroadcastDeliveryStatus;
use App\Enums\EventBroadcastStatus;
use App\Exceptions\EventBroadcastException;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Support\Events\EventBroadcastFoundationSupport;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Throwable;

/** Bounded per-recipient delivery worker with independent retry evidence. */
final class EventBroadcastDeliveryConsumer
{
    public function __construct(
        private readonly EventBroadcastService $broadcasts,
        private readonly SafeguardingInteractionPolicy $safeguarding,
        private readonly EventBroadcastRenderer $renderer = new EventBroadcastRenderer(),
        private readonly ?EventBroadcastTransport $transport = null,
        private readonly EventBroadcastFoundationSupport $support = new EventBroadcastFoundationSupport(),
    ) {
    }

    /** @return array{claimed:int,delivered:int,suppressed:int,retrying:int,dead_lettered:int,stale_released:int} */
    public function processBatch(int $limit = 50, ?int $tenantId = null): array
    {
        $this->support->assertSchema();
        $summary = [
            'claimed' => 0,
            'delivered' => 0,
            'suppressed' => 0,
            'retrying' => 0,
            'dead_lettered' => 0,
            'stale_released' => $this->releaseStaleClaims($tenantId),
        ];
        $rows = $this->claimBatch($limit, $tenantId);
        $summary['claimed'] = count($rows);

        foreach ($rows as $row) {
            $rowTenantId = (int) $row['tenant_id'];
            $deliveryId = (int) $row['id'];
            $broadcastId = (int) $row['broadcast_id'];
            $claimToken = (string) $row['claim_token'];
            try {
                $outcome = TenantContext::runForTenant(
                    $rowTenantId,
                    fn (): string => $this->deliver($row),
                );
                $summary[$outcome]++;
            } catch (Throwable $exception) {
                $errorCode = $this->errorCode($exception);
                $status = $this->markFailure(
                    $rowTenantId,
                    $deliveryId,
                    $claimToken,
                    $errorCode,
                );
                $summary[$status === EventBroadcastDeliveryStatus::DeadLetter->value
                    ? 'dead_lettered'
                    : 'retrying']++;
                Log::warning('Event broadcast delivery failed', [
                    'tenant_id' => $rowTenantId,
                    'event_id' => (int) $row['event_id'],
                    'broadcast_id' => $broadcastId,
                    'delivery_id' => $deliveryId,
                    'recipient_reference_fingerprint' => hash(
                        'sha256',
                        $rowTenantId . ':' . (int) $row['recipient_user_id'],
                    ),
                    'channel' => (string) $row['channel'],
                    'attempt' => (int) $row['attempts'],
                    'status' => $status,
                    'exception' => $exception::class,
                    'reason_code' => $errorCode,
                ]);
            } finally {
                try {
                    $this->broadcasts->reconcileDeliveryState($rowTenantId, $broadcastId);
                } catch (Throwable $exception) {
                    Log::error('Event broadcast lifecycle reconciliation failed', [
                        'tenant_id' => $rowTenantId,
                        'event_id' => (int) $row['event_id'],
                        'broadcast_id' => $broadcastId,
                        'reason_code' => $this->errorCode($exception),
                        'exception' => $exception::class,
                    ]);
                }
            }
        }

        return $summary;
    }

    /** @return list<array<string,mixed>> */
    public function claimBatch(int $limit = 50, ?int $tenantId = null): array
    {
        $limit = max(1, min($limit, 100));
        if ($tenantId !== null && $tenantId <= 0) {
            return [];
        }
        $token = (string) Str::uuid();

        return DB::transaction(function () use ($limit, $tenantId, $token): array {
            $now = now();
            $ids = DB::table('event_broadcast_deliveries as delivery')
                ->join('event_broadcasts as broadcast', function ($join): void {
                    $join->on('broadcast.id', '=', 'delivery.broadcast_id')
                        ->on('broadcast.tenant_id', '=', 'delivery.tenant_id')
                        ->on('broadcast.event_id', '=', 'delivery.event_id');
                })
                ->whereIn('delivery.status', [
                    EventBroadcastDeliveryStatus::Pending->value,
                    EventBroadcastDeliveryStatus::Retry->value,
                ])
                ->whereIn('broadcast.status', [
                    EventBroadcastStatus::Scheduled->value,
                    EventBroadcastStatus::Sending->value,
                ])
                ->where('broadcast.scheduled_at', '<=', $now)
                ->where('delivery.available_at', '<=', $now)
                ->where(static function ($query) use ($now): void {
                    $query->whereNull('delivery.next_attempt_at')
                        ->orWhere('delivery.next_attempt_at', '<=', $now);
                })
                ->when($tenantId !== null, static fn ($query) => $query->where('delivery.tenant_id', $tenantId))
                ->orderBy('delivery.id')
                ->limit($limit)
                ->lockForUpdate()
                ->pluck('delivery.id')
                ->all();
            if ($ids === []) {
                return [];
            }

            DB::table('event_broadcast_deliveries')
                ->whereIn('id', $ids)
                ->whereIn('status', [
                    EventBroadcastDeliveryStatus::Pending->value,
                    EventBroadcastDeliveryStatus::Retry->value,
                ])
                ->update([
                    'status' => EventBroadcastDeliveryStatus::Processing->value,
                    'attempts' => DB::raw('attempts + 1'),
                    'claim_token' => $token,
                    'claimed_at' => $now,
                    'updated_at' => $now,
                ]);

            return DB::table('event_broadcast_deliveries')
                ->where('claim_token', $token)
                ->where('status', EventBroadcastDeliveryStatus::Processing->value)
                ->orderBy('id')
                ->get()
                ->map(static fn (object $row): array => (array) $row)
                ->all();
        }, 3);
    }

    public function releaseStaleClaims(?int $tenantId = null): int
    {
        if ($tenantId !== null && $tenantId <= 0) {
            return 0;
        }
        $minutes = max(1, (int) config('events.broadcast.stale_claim_minutes', 10));

        return DB::table('event_broadcast_deliveries')
            ->where('status', EventBroadcastDeliveryStatus::Processing->value)
            ->where('claimed_at', '<', now()->subMinutes($minutes))
            ->when($tenantId !== null, static fn ($query) => $query->where('tenant_id', $tenantId))
            ->update([
                'status' => EventBroadcastDeliveryStatus::Retry->value,
                'claim_token' => null,
                'claimed_at' => null,
                'next_attempt_at' => now(),
                'last_error_code' => 'event_broadcast_stale_claim_released',
                'updated_at' => now(),
            ]);
    }

    /** @param array<string,mixed> $delivery */
    private function deliver(array $delivery): string
    {
        $tenantId = (int) $delivery['tenant_id'];
        $eventId = (int) $delivery['event_id'];
        $broadcastId = (int) $delivery['broadcast_id'];
        $deliveryId = (int) $delivery['id'];
        $recipientId = (int) $delivery['recipient_user_id'];
        $claimToken = (string) $delivery['claim_token'];
        if (! $this->broadcasts->markSending($tenantId, $broadcastId)) {
            throw new EventBroadcastException('event_broadcast_not_sendable');
        }
        if (! EventNotificationPreferenceResolver::allowsBackgroundActivity(
            $tenantId,
            'event_broadcast',
        )) {
            $this->markSuppressed(
                $tenantId,
                $deliveryId,
                $claimToken,
                'events_feature_disabled',
                'tenant_feature',
            );
            return 'suppressed';
        }
        // Switching organiser broadcasts off cancels scheduled broadcasts in
        // the same save; this catches anything already claimed or sending
        // when that happened, so nothing goes out once the switch is off.
        if (! (bool) app(EventConfigurationService::class)->value(
            'organizer_broadcasts_enabled',
            true,
            $tenantId,
        )) {
            $this->markSuppressed(
                $tenantId,
                $deliveryId,
                $claimToken,
                'organizer_broadcasts_disabled',
                'tenant_setting',
            );
            return 'suppressed';
        }

        $broadcast = DB::table('event_broadcasts')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $broadcastId)
            ->where('status', EventBroadcastStatus::Sending->value)
            ->first(['id', 'event_id', 'variant', 'body', 'content_hash', 'status']);
        $event = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->first(['id', 'tenant_id', 'user_id', 'title']);
        $recipient = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $recipientId)
            ->first([
                'id',
                'tenant_id',
                'email',
                'name',
                'first_name',
                'preferred_language',
                'status',
                'deleted_at',
            ]);
        if ($broadcast === null || $event === null) {
            throw new EventBroadcastException('event_broadcast_delivery_contract_unavailable');
        }
        if ($recipient === null
            || (string) ($recipient->status ?? '') !== 'active'
            || ($recipient->deleted_at ?? null) !== null) {
            $this->markSuppressed(
                $tenantId,
                $deliveryId,
                $claimToken,
                'recipient_ineligible',
            );
            return 'suppressed';
        }
        if (! hash_equals((string) $broadcast->content_hash, hash('sha256', (string) $broadcast->body))) {
            throw new EventBroadcastException('event_broadcast_content_integrity_failed');
        }

        try {
            $this->safeguarding->assertLocalContactAllowed(
                (int) $event->user_id,
                $recipientId,
                $tenantId,
                'event_broadcast',
            );
        } catch (SafeguardingPolicyException $exception) {
            if ($exception->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE') {
                throw new EventBroadcastException('event_broadcast_safeguarding_unavailable');
            }
            $this->markSuppressed(
                $tenantId,
                $deliveryId,
                $claimToken,
                'safeguarding_contact_denied',
            );
            return 'suppressed';
        }

        $channel = EventBroadcastChannel::tryFrom((string) $delivery['channel']);
        if ($channel === null) {
            throw new EventBroadcastException('event_broadcast_channel_invalid');
        }
        $preferences = EventNotificationPreferenceResolver::resolveForEvent(
            $recipientId,
            $tenantId,
            $eventId,
        );
        $suppression = $this->channelSuppression(
            $channel,
            $tenantId,
            $recipient,
            $preferences,
        );
        if ($suppression !== null) {
            $this->markSuppressed(
                $tenantId,
                $deliveryId,
                $claimToken,
                $suppression['reason'],
                $suppression['preference'],
            );
            return 'suppressed';
        }

        $cadence = (string) ($preferences['cadence'] ?? 'off');
        $result = LocaleContext::withLocale($recipient, function () use (
            $channel,
            $tenantId,
            $eventId,
            $recipient,
            $broadcast,
            $event,
            $delivery,
            $cadence,
        ) {
            $message = $this->renderer->render($broadcast, $event, $recipient);

            return ($this->transport ?? new EventBroadcastChannelDispatcher())->send(
                $channel,
                $tenantId,
                $eventId,
                $recipient,
                $message,
                (string) $delivery['delivery_key'],
                $cadence,
            );
        });
        if (! $this->markDelivered(
            $tenantId,
            $deliveryId,
            $claimToken,
            $result->provider,
            $result->evidenceId,
        )) {
            throw new EventBroadcastException('event_broadcast_delivery_completion_lost_claim');
        }

        return 'delivered';
    }

    /**
     * @param array<string,mixed> $preferences
     * @return array{reason:string,preference:?string}|null
     */
    private function channelSuppression(
        EventBroadcastChannel $channel,
        int $tenantId,
        object $recipient,
        array $preferences,
    ): ?array {
        $sources = is_array($preferences['channel_sources'] ?? null)
            ? $preferences['channel_sources']
            : [];
        $channels = is_array($preferences['channels'] ?? null)
            ? $preferences['channels']
            : [];

        if ($channel === EventBroadcastChannel::Email) {
            if (! (bool) ($channels['email'] ?? false)) {
                return [
                    'reason' => 'email_channel_disabled',
                    'preference' => (string) ($sources['email'] ?? 'unknown'),
                ];
            }
            if ((string) ($preferences['cadence'] ?? 'off') === 'off') {
                return [
                    'reason' => 'email_cadence_off',
                    'preference' => (string) ($preferences['cadence_source'] ?? 'unknown'),
                ];
            }
            $email = trim((string) ($recipient->email ?? ''));
            if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                return ['reason' => 'email_destination_missing', 'preference' => null];
            }
            if (Mailer::isSuppressed($email)) {
                return ['reason' => 'email_provider_suppressed', 'preference' => null];
            }
            return null;
        }

        if ($channel === EventBroadcastChannel::InApp) {
            return (bool) ($channels['in_app'] ?? false)
                ? null
                : [
                    'reason' => 'in_app_channel_disabled',
                    'preference' => (string) ($sources['in_app'] ?? 'unknown'),
                ];
        }

        $webPush = (bool) ($channels['web_push'] ?? false);
        $fcm = (bool) ($channels['fcm'] ?? false);
        if (! $webPush && ! $fcm) {
            return [
                'reason' => 'push_channel_disabled',
                'preference' => (string) ($sources['web_push'] ?? $sources['fcm'] ?? 'unknown'),
            ];
        }
        $userId = (int) $recipient->id;
        $hasWebPush = $webPush
            && Schema::hasTable('push_subscriptions')
            && DB::table('push_subscriptions')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->exists();
        $hasFcm = $fcm
            && Schema::hasTable('fcm_device_tokens')
            && DB::table('fcm_device_tokens')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->exists();

        return $hasWebPush || $hasFcm
            ? null
            : ['reason' => 'push_destination_missing', 'preference' => null];
    }

    private function markDelivered(
        int $tenantId,
        int $deliveryId,
        string $claimToken,
        string $provider,
        ?string $evidenceId,
    ): bool {
        return DB::transaction(function () use (
            $tenantId,
            $deliveryId,
            $claimToken,
            $provider,
            $evidenceId,
        ): bool {
            $row = DB::table('event_broadcast_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('id', $deliveryId)
                ->where('status', EventBroadcastDeliveryStatus::Processing->value)
                ->where('claim_token', $claimToken)
                ->lockForUpdate()
                ->first();
            if ($row === null) {
                return false;
            }
            $now = now();
            DB::table('event_broadcast_deliveries')
                ->where('id', $deliveryId)
                ->where('tenant_id', $tenantId)
                ->where('claim_token', $claimToken)
                ->update([
                    'status' => EventBroadcastDeliveryStatus::Delivered->value,
                    'delivered_at' => $now,
                    'provider' => mb_substr($provider, 0, 50),
                    'provider_evidence_id' => $evidenceId !== null
                        ? mb_substr($evidenceId, 0, 255)
                        : null,
                    'claim_token' => null,
                    'claimed_at' => null,
                    'next_attempt_at' => null,
                    'last_error_code' => null,
                    'updated_at' => $now,
                ]);
            $this->insertAttempt(
                $row,
                EventBroadcastDeliveryStatus::Delivered->value,
                $provider,
                $evidenceId,
                null,
            );

            return true;
        }, 3);
    }

    private function markSuppressed(
        int $tenantId,
        int $deliveryId,
        string $claimToken,
        string $reason,
        ?string $preference = null,
    ): bool {
        return DB::transaction(function () use (
            $tenantId,
            $deliveryId,
            $claimToken,
            $reason,
            $preference,
        ): bool {
            $row = DB::table('event_broadcast_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('id', $deliveryId)
                ->where('status', EventBroadcastDeliveryStatus::Processing->value)
                ->where('claim_token', $claimToken)
                ->lockForUpdate()
                ->first();
            if ($row === null) {
                throw new EventBroadcastException('event_broadcast_suppression_lost_claim');
            }
            $now = now();
            DB::table('event_broadcast_deliveries')
                ->where('id', $deliveryId)
                ->where('tenant_id', $tenantId)
                ->where('claim_token', $claimToken)
                ->update([
                    'status' => EventBroadcastDeliveryStatus::Suppressed->value,
                    'suppressed_at' => $now,
                    'suppression_reason' => mb_substr($reason, 0, 100),
                    'preference_reason' => $preference !== null
                        ? mb_substr($preference, 0, 100)
                        : null,
                    'claim_token' => null,
                    'claimed_at' => null,
                    'next_attempt_at' => null,
                    'last_error_code' => null,
                    'updated_at' => $now,
                ]);
            $this->insertAttempt(
                $row,
                EventBroadcastDeliveryStatus::Suppressed->value,
                null,
                null,
                $reason,
            );

            return true;
        }, 3);
    }

    private function markFailure(
        int $tenantId,
        int $deliveryId,
        string $claimToken,
        string $errorCode,
    ): string {
        return DB::transaction(function () use (
            $tenantId,
            $deliveryId,
            $claimToken,
            $errorCode,
        ): string {
            $row = DB::table('event_broadcast_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('id', $deliveryId)
                ->where('status', EventBroadcastDeliveryStatus::Processing->value)
                ->where('claim_token', $claimToken)
                ->lockForUpdate()
                ->first();
            if ($row === null) {
                return EventBroadcastDeliveryStatus::Retry->value;
            }
            $attempts = (int) $row->attempts;
            $maxAttempts = max(1, (int) config('events.broadcast.max_attempts', 5));
            $terminal = $attempts >= $maxAttempts;
            $status = $terminal
                ? EventBroadcastDeliveryStatus::DeadLetter
                : EventBroadcastDeliveryStatus::Retry;
            $base = max(1, (int) config('events.broadcast.base_retry_seconds', 60));
            $cap = max($base, (int) config('events.broadcast.max_retry_seconds', 3600));
            $retrySeconds = min($cap, $base * (2 ** max(0, $attempts - 1)));
            $now = now();
            DB::table('event_broadcast_deliveries')
                ->where('id', $deliveryId)
                ->where('tenant_id', $tenantId)
                ->where('claim_token', $claimToken)
                ->update([
                    'status' => $status->value,
                    'next_attempt_at' => $terminal ? null : $now->copy()->addSeconds($retrySeconds),
                    'dead_lettered_at' => $terminal ? $now : null,
                    'claim_token' => null,
                    'claimed_at' => null,
                    'last_error_code' => mb_substr($errorCode, 0, 100),
                    'updated_at' => $now,
                ]);
            $this->insertAttempt($row, $status->value, null, null, $errorCode);

            return $status->value;
        }, 3);
    }

    private function insertAttempt(
        object $delivery,
        string $outcome,
        ?string $provider,
        ?string $evidenceId,
        ?string $reasonCode,
    ): void {
        DB::table('event_broadcast_delivery_attempts')->insert([
            'tenant_id' => (int) $delivery->tenant_id,
            'event_id' => (int) $delivery->event_id,
            'broadcast_id' => (int) $delivery->broadcast_id,
            'delivery_id' => (int) $delivery->id,
            'attempt_number' => (int) $delivery->attempts,
            'outcome' => $outcome,
            'provider' => $provider !== null ? mb_substr($provider, 0, 50) : null,
            'provider_evidence_id' => $evidenceId !== null
                ? mb_substr($evidenceId, 0, 255)
                : null,
            'reason_code' => $reasonCode !== null
                ? mb_substr($reasonCode, 0, 100)
                : null,
            'metadata' => json_encode(['contract_version' => 1], JSON_THROW_ON_ERROR),
            'created_at' => now(),
        ]);
    }

    private function errorCode(Throwable $exception): string
    {
        $candidate = $exception instanceof EventBroadcastException
            ? $exception->reasonCode
            : trim($exception->getMessage());
        if (preg_match('/^event_broadcast_[a-z0-9_]{1,84}$/', $candidate) === 1) {
            return $candidate;
        }

        return 'event_broadcast_provider_failure';
    }
}
