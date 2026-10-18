<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Event;
use App\Models\Notification;
use App\Models\User;
use App\Support\Events\EventInvitationRecipientAuthorizer;
use App\Support\Events\EventNotificationOutboxHandleResult;
use App\Support\Events\EventRegistrationFoundationSupport;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

/** Authoritative invitation sender with per-channel terminal evidence. */
final class EventInvitationDeliveryConsumer
{
    private const ACTION = 'event.invitation.issued';
    private const TYPE = 'event_invitation';
    private const EMAIL_CATEGORY = 'event_invitation';
    private const TERMINAL = ['delivered', 'suppressed', 'failed_terminal'];

    private readonly EventInvitationRecipientAuthorizer $recipientAuthorizer;

    public function __construct(
        private readonly EventRegistrationFoundationSupport $support = new EventRegistrationFoundationSupport(),
        private readonly EventReminderChannelDeliveryService $deliveries = new EventReminderChannelDeliveryService(),
        ?EventInvitationRecipientAuthorizer $recipientAuthorizer = null,
    ) {
        $this->recipientAuthorizer = $recipientAuthorizer ?? new EventInvitationRecipientAuthorizer();
    }

    /** @param array<string,mixed> $outbox */
    public function handle(array $outbox): EventNotificationOutboxHandleResult
    {
        if (($outbox['action'] ?? null) !== self::ACTION) {
            throw new RuntimeException('event_invitation_delivery_action_invalid');
        }
        $tenantId = (int) ($outbox['tenant_id'] ?? 0);
        $eventId = (int) ($outbox['event_id'] ?? 0);
        $outboxId = (int) ($outbox['id'] ?? 0);
        $payload = is_array($outbox['payload'] ?? null)
            ? $outbox['payload']
            : json_decode((string) ($outbox['payload'] ?? ''), true);
        if ($tenantId <= 0 || $eventId <= 0 || $outboxId <= 0 || ! is_array($payload)) {
            throw new RuntimeException('event_invitation_delivery_payload_invalid');
        }
        $invitationId = (int) ($payload['invitation_id'] ?? 0);
        $campaignId = (int) ($payload['campaign_id'] ?? 0);
        $version = (int) ($payload['invitation_version'] ?? 0);
        $locale = trim((string) ($payload['recipient_locale'] ?? ''));
        if ($invitationId <= 0 || $campaignId <= 0 || $version <= 0 || $locale === '') {
            throw new RuntimeException('event_invitation_delivery_payload_invalid');
        }
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->first();
        $invitation = DB::table('event_invitations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('campaign_id', $campaignId)
            ->where('id', $invitationId)
            ->first();
        if ($event === null || $invitation === null) {
            throw new RuntimeException('event_invitation_delivery_subject_missing');
        }
        $rows = DB::table('event_notification_deliveries')
            ->where('tenant_id', $tenantId)
            ->where('outbox_id', $outboxId)
            ->orderBy('id')
            ->get();
        if ($rows->isEmpty()) {
            throw new RuntimeException('event_invitation_delivery_ledger_missing');
        }
        if (! TenantContext::hasFeature('events')) {
            foreach ($rows as $row) {
                if (! in_array((string) $row->status, self::TERMINAL, true)) {
                    $this->deliveries->markSuppressed(
                        $tenantId,
                        (int) $row->id,
                        'events_feature_disabled',
                    );
                }
            }

            return $this->complete($tenantId, $eventId, $campaignId, $invitationId, $rows);
        }
        // An invitation queued before the event was cancelled (or completed,
        // or archived) must not reach anyone afterwards. Recipient eligibility
        // below checks publication only, so the lifecycle is checked here.
        if (! EventInvitationService::eventAcceptsInvitations($event)) {
            $this->suppressPending($tenantId, $rows, 'event_unavailable');

            return $this->complete($tenantId, $eventId, $campaignId, $invitationId, $rows);
        }

        // Locale is immutable send-time evidence: queue() resolves the member's
        // preferred language and records the same value in every channel row.
        $evidenceLocales = DB::table('event_invitation_delivery_evidence')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('campaign_id', $campaignId)
            ->where('invitation_id', $invitationId)
            ->where('outbox_id', $outboxId)
            ->where('evidence_version', 1)
            ->pluck('recipient_locale')
            ->map(static fn (mixed $value): string => trim((string) $value))
            ->unique()
            ->values();
        if ($evidenceLocales->count() !== 1 || ! hash_equals((string) $evidenceLocales->first(), $locale)) {
            throw new RuntimeException('event_invitation_delivery_locale_evidence_invalid');
        }

        $memberId = $payload['recipient_user_id'] === null
            ? null
            : (int) $payload['recipient_user_id'];
        if (($memberId !== null
                && ((string) $invitation->target_type !== 'member'
                    || (int) $invitation->member_user_id !== $memberId))
            || ($memberId === null && (string) $invitation->target_type !== 'email')) {
            throw new RuntimeException('event_invitation_delivery_target_invalid');
        }
        $recipient = $memberId === null ? null : User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($memberId)
            ->first();
        $eligible = $memberId === null
            || ($recipient !== null
                && (string) $recipient->status === 'active'
                && $recipient->deleted_at === null);
        $active = (string) $invitation->status === 'issued'
            && (int) $invitation->invitation_version === $version
            && $invitation->token_used_at === null
            && now()->lt((string) $invitation->token_expires_at);
        if (! $eligible || ! $active) {
            $reason = ! $eligible ? 'recipient_ineligible' : 'invitation_not_active';
            $this->suppressPending($tenantId, $rows, $reason);

            return $this->complete($tenantId, $eventId, $campaignId, $invitationId, $rows);
        }

        $tokenCiphertext = $payload['token_ciphertext'] ?? null;
        if (! is_string($tokenCiphertext)) {
            throw new RuntimeException('event_invitation_delivery_token_missing');
        }
        $token = $this->support->decrypt($tokenCiphertext);
        if (! hash_equals(
            (string) $invitation->token_hash,
            $this->support->tokenHash($tenantId, $eventId, $token),
        )) {
            throw new RuntimeException('event_invitation_delivery_token_invalid');
        }
        $email = null;
        if ($memberId !== null) {
            $email = is_string($recipient?->email ?? null) ? trim((string) $recipient->email) : null;
        } else {
            $emailCiphertext = $payload['external_email_ciphertext'] ?? null;
            if (! is_string($emailCiphertext)) {
                throw new RuntimeException('event_invitation_delivery_email_missing');
            }
            $email = $this->support->normalizeEmail($this->support->decrypt($emailCiphertext));
            if (! hash_equals(
                (string) $invitation->email_blind_hash,
                $this->support->emailBlindHash($tenantId, $email),
            )) {
                throw new RuntimeException('event_invitation_delivery_email_invalid');
            }
        }
        $issuer = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey((int) $invitation->created_by)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first();
        if ($issuer === null) {
            $this->suppressPending($tenantId, $rows, 'invitation_actor_ineligible');

            return $this->complete($tenantId, $eventId, $campaignId, $invitationId, $rows);
        }
        $targetDecision = $this->recipientAuthorizer->deliveryDecision(
            $tenantId,
            $event,
            $issuer,
            [
                'type' => $memberId === null ? 'email' : 'member',
                'member_id' => $memberId,
                'email' => $memberId === null ? $email : null,
            ],
        );
        if ($targetDecision === EventInvitationRecipientAuthorizer::UNAVAILABLE) {
            throw new RuntimeException('event_invitation_target_policy_unavailable');
        }
        if ($targetDecision !== EventInvitationRecipientAuthorizer::ALLOWED) {
            $this->suppressPending($tenantId, $rows, 'invitation_target_ineligible');

            return $this->complete($tenantId, $eventId, $campaignId, $invitationId, $rows);
        }
        $path = '/events/' . $eventId . '?invitation=' . $invitationId;
        $emailUrl = TenantContext::getFrontendUrl()
            . TenantContext::getSlugPrefix()
            . '/events/' . $eventId
            . '?invitation_token=' . rawurlencode($token);
        $rendered = LocaleContext::withLocale($locale, function () use (
            $event,
            $recipient,
            $path,
            $emailUrl,
            $invitation,
            $issuer,
        ): array {
            $subject = __('emails.event_invitation.subject', ['event' => (string) $event->title]);
            $message = __('emails.event_invitation.message', ['event' => (string) $event->title]);
            $name = (string) ($recipient?->first_name ?? $recipient?->name ?? __('emails.common.fallback_name'));
            $html = EmailTemplateBuilder::make()
                ->theme('info')
                ->title($subject)
                ->greeting($name)
                ->paragraph(htmlspecialchars($message, ENT_QUOTES, 'UTF-8'))
                ->paragraph(htmlspecialchars(__('emails.event_invitation.expiry', [
                    'expiry' => (string) $invitation->token_expires_at,
                ]), ENT_QUOTES, 'UTF-8'))
                ->button(__('emails.event_invitation.accept_button'), $emailUrl)
                ->render();

            // Facts for the device push ("<inviter> invited you to <event>").
            $actor = trim((string) ($issuer->first_name ?? ''));
            if ($actor === '') {
                $actor = trim((string) ($issuer->name ?? ''));
            }

            return compact('subject', 'message', 'path', 'html')
                + ['actor' => $actor, 'event_title' => (string) $event->title];
        });

        $configured = is_array($payload['channels'] ?? null) ? $payload['channels'] : [];
        $preferences = $memberId === null
            ? null
            : EventNotificationPreferenceResolver::resolveForEvent($memberId, $tenantId, $eventId);
        foreach ($rows as $row) {
            $channel = (string) $row->channel;
            if (in_array((string) $row->status, self::TERMINAL, true)) {
                continue;
            }
            $allowed = (bool) ($configured[$channel] ?? false);
            if ($memberId !== null) {
                $allowed = $allowed && (bool) ($preferences['channels'][$channel] ?? false);
            }
            if (! $allowed) {
                $this->deliveries->markSuppressed(
                    $tenantId,
                    (int) $row->id,
                    'invitation_channel_disabled',
                    'event_notification_preferences',
                );
                continue;
            }

            match ($channel) {
                'email' => $this->email(
                    $tenantId,
                    $eventId,
                    $memberId,
                    (string) $email,
                    (array) $row,
                    $rendered,
                    $preferences,
                ),
                'in_app' => $this->inApp($tenantId, (int) $memberId, (array) $row, $rendered),
                'web_push' => $this->webPush($tenantId, (int) $memberId, (array) $row, $rendered),
                'fcm' => $this->fcm($tenantId, (int) $memberId, (array) $row, $rendered),
                'realtime' => $this->realtime($tenantId, (int) $memberId, (array) $row, $rendered),
                default => $this->deliveries->markSuppressed($tenantId, (int) $row->id, 'channel_unsupported'),
            };
        }

        return $this->complete($tenantId, $eventId, $campaignId, $invitationId, $rows);
    }

    /** @param array<string,mixed> $delivery @param array<string,string> $rendered */
    private function inApp(int $tenantId, int $userId, array $delivery, array $rendered): void
    {
        if ($userId <= 0) {
            $this->deliveries->markSuppressed($tenantId, (int) $delivery['id'], 'internal_recipient_required');
            return;
        }
        $this->withClaim($tenantId, $delivery, function (int $deliveryId, string $token) use (
            $tenantId,
            $userId,
            $rendered,
        ): void {
            DB::transaction(function () use ($tenantId, $userId, $rendered, $deliveryId, $token): void {
                Notification::createNotification(
                    $userId,
                    $rendered['message'],
                    $rendered['path'],
                    self::TYPE,
                    false,
                    $tenantId,
                );
                if (! $this->deliveries->markDelivered($tenantId, $deliveryId, $token, 'database')) {
                    throw new RuntimeException('event_invitation_in_app_ledger_completion_failed');
                }
            }, 3);
        });
    }

    /** @param array<string,mixed> $delivery @param array<string,string> $rendered @param array<string,mixed>|null $preferences */
    private function email(
        int $tenantId,
        int $eventId,
        ?int $userId,
        string $email,
        array $delivery,
        array $rendered,
        ?array $preferences,
    ): void {
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $this->deliveries->markSuppressed($tenantId, (int) $delivery['id'], 'email_address_missing');
            return;
        }
        // The community default cadence is not a member's choice (E-106): an
        // invitation goes to a member who never chose a digest. A member's own
        // 'off' or digest choice still holds; invitations are never digested.
        if ($userId !== null
            && EventBroadcastDeliveryConsumer::effectiveEmailCadence($preferences ?? []) !== 'instant') {
            $this->deliveries->markSuppressed(
                $tenantId,
                (int) $delivery['id'],
                'invitation_requires_instant_email',
                'cadence',
            );
            return;
        }
        if (Mailer::isSuppressed($email)) {
            $this->deliveries->markSuppressed($tenantId, (int) $delivery['id'], 'email_provider_suppressed');
            return;
        }
        if ($this->successfulEmailEvidence($tenantId, (string) $delivery['delivery_key'])) {
            $claim = $this->deliveries->claim($tenantId, (int) $delivery['id']);
            if ($claim !== null) {
                $this->deliveries->markDelivered(
                    $tenantId,
                    (int) $claim['id'],
                    (string) $claim['claim_token'],
                    'email_log',
                );
            }
            return;
        }
        $this->withClaim($tenantId, $delivery, function (int $deliveryId, string $token) use (
            $tenantId,
            $eventId,
            $userId,
            $email,
            $delivery,
            $rendered,
        ): void {
            $sent = EmailDispatchService::sendRaw(
                $email,
                $rendered['subject'],
                $rendered['html'],
                null,
                null,
                $userId === null ? null : EventNotificationPreferenceResolver::unsubscribeUrl($userId, $tenantId),
                self::EMAIL_CATEGORY,
                [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'idempotency_key' => (string) $delivery['delivery_key'],
                    'source' => self::class,
                ],
            );
            if (! $sent) {
                throw new RuntimeException('event_invitation_email_provider_rejected');
            }
            if (! $this->deliveries->markDelivered($tenantId, $deliveryId, $token, 'email')) {
                throw new RuntimeException('event_invitation_email_ledger_completion_failed');
            }
        });
    }

    /** @param array<string,mixed> $delivery @param array<string,string> $rendered */
    private function webPush(int $tenantId, int $userId, array $delivery, array $rendered): void
    {
        if ($userId <= 0 || ! Schema::hasTable('push_subscriptions')
            || ! DB::table('push_subscriptions')->where('tenant_id', $tenantId)->where('user_id', $userId)->exists()) {
            $this->deliveries->markSuppressed($tenantId, (int) $delivery['id'], 'web_push_destination_missing');
            return;
        }
        $this->withClaim($tenantId, $delivery, function (int $deliveryId, string $token) use (
            $tenantId,
            $userId,
            $rendered,
        ): void {
            if (! WebPushService::sendToUserStatic(
                $userId,
                $rendered['subject'],
                $rendered['message'],
                $rendered['path'],
                self::TYPE,
            )) {
                throw new RuntimeException('event_invitation_web_push_provider_rejected');
            }
            if (! $this->deliveries->markDelivered($tenantId, $deliveryId, $token, 'web_push')) {
                throw new RuntimeException('event_invitation_web_push_ledger_completion_failed');
            }
        });
    }

    /** @param array<string,mixed> $delivery @param array<string,string> $rendered */
    private function fcm(int $tenantId, int $userId, array $delivery, array $rendered): void
    {
        if ($userId <= 0 || ! Schema::hasTable('fcm_device_tokens')
            || ! DB::table('fcm_device_tokens')->where('tenant_id', $tenantId)->where('user_id', $userId)->exists()) {
            $this->deliveries->markSuppressed($tenantId, (int) $delivery['id'], 'fcm_destination_missing');
            return;
        }
        $this->withClaim($tenantId, $delivery, function (int $deliveryId, string $token) use (
            $tenantId,
            $userId,
            $rendered,
        ): void {
            $result = FCMPushService::sendToUser($userId, $rendered['subject'], $rendered['message'], [
                'link' => $rendered['path'],
                'type' => self::TYPE,
            ], ['actor' => $rendered['actor'] ?? '', 'subject' => $rendered['event_title'] ?? '']);
            if ((int) ($result['sent'] ?? 0) < 1) {
                throw new RuntimeException('event_invitation_fcm_provider_rejected');
            }
            if (! $this->deliveries->markDelivered($tenantId, $deliveryId, $token, 'fcm')) {
                throw new RuntimeException('event_invitation_fcm_ledger_completion_failed');
            }
        });
    }

    /** @param array<string,mixed> $delivery @param array<string,string> $rendered */
    private function realtime(int $tenantId, int $userId, array $delivery, array $rendered): void
    {
        if ($userId <= 0 || ! app(PusherService::class)->isConfigured()) {
            $this->deliveries->markSuppressed($tenantId, (int) $delivery['id'], 'realtime_provider_unconfigured');
            return;
        }
        $this->withClaim($tenantId, $delivery, function (int $deliveryId, string $token) use (
            $tenantId,
            $userId,
            $rendered,
        ): void {
            if (! PusherService::trigger(
                PusherService::getUserChannel($userId),
                'event-notification',
                ['type' => self::TYPE, 'message' => $rendered['message'], 'link' => $rendered['path']],
            )) {
                throw new RuntimeException('event_invitation_realtime_provider_rejected');
            }
            if (! $this->deliveries->markDelivered($tenantId, $deliveryId, $token, 'pusher')) {
                throw new RuntimeException('event_invitation_realtime_ledger_completion_failed');
            }
        });
    }

    /** @param array<string,mixed> $delivery @param callable(int,string):void $operation */
    private function withClaim(int $tenantId, array $delivery, callable $operation): void
    {
        $claim = $this->deliveries->claim($tenantId, (int) $delivery['id']);
        if ($claim === null) {
            return;
        }
        $deliveryId = (int) $claim['id'];
        $token = (string) $claim['claim_token'];
        try {
            $operation($deliveryId, $token);
        } catch (Throwable $exception) {
            $this->deliveries->markRetrying(
                $tenantId,
                $deliveryId,
                $token,
                EventNotificationErrorSanitizer::sanitize($exception->getMessage()),
            );
        }
    }

    private function complete(
        int $tenantId,
        int $eventId,
        int $campaignId,
        int $invitationId,
        iterable $originalRows,
    ): EventNotificationOutboxHandleResult {
        $delivered = 0;
        $suppressed = 0;
        $retry = false;
        foreach ($originalRows as $original) {
            $row = DB::table('event_notification_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $original->id)
                ->first();
            if ($row === null) {
                throw new RuntimeException('event_invitation_delivery_ledger_missing');
            }
            $status = (string) $row->status;
            $delivered += $status === 'delivered' ? 1 : 0;
            $suppressed += $status === 'suppressed' ? 1 : 0;
            if (! in_array($status, self::TERMINAL, true)) {
                $retry = true;
                continue;
            }
            $this->appendEvidence($tenantId, $eventId, $campaignId, $invitationId, $row);
        }
        if ($retry) {
            throw new RuntimeException('event_invitation_delivery_retry_required');
        }

        return new EventNotificationOutboxHandleResult(1, $delivered, $suppressed);
    }

    private function appendEvidence(
        int $tenantId,
        int $eventId,
        int $campaignId,
        int $invitationId,
        object $delivery,
    ): void {
        $latest = DB::table('event_invitation_delivery_evidence')
            ->where('tenant_id', $tenantId)
            ->where('invitation_id', $invitationId)
            ->where('channel', (string) $delivery->channel)
            ->orderByDesc('evidence_version')
            ->first();
        if ($latest === null || (string) $latest->status !== 'queued') {
            return;
        }
        $status = match ((string) $delivery->status) {
            'delivered' => 'delivered',
            'suppressed' => 'suppressed',
            default => 'failed',
        };
        $version = (int) $latest->evidence_version + 1;
        $key = hash('sha256', implode('|', [
            'event-invitation-delivery-evidence-v1',
            $tenantId,
            $invitationId,
            (string) $delivery->channel,
            $version,
            $status,
        ]));
        DB::table('event_invitation_delivery_evidence')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'campaign_id' => $campaignId,
            'invitation_id' => $invitationId,
            'outbox_id' => (int) $delivery->outbox_id,
            'notification_delivery_id' => (int) $delivery->id,
            'evidence_version' => $version,
            'channel' => (string) $delivery->channel,
            'recipient_locale' => (string) $latest->recipient_locale,
            'preference_decision' => (string) $latest->preference_decision,
            'preference_reason' => $latest->preference_reason,
            'status' => $status,
            'idempotency_hash' => $key,
            'provider_evidence_id' => $delivery->provider_evidence_id,
            'failure_code' => $status === 'failed'
                ? mb_substr((string) ($delivery->last_error ?? 'delivery_failed'), 0, 100)
                : null,
            'created_at' => now(),
        ]);
    }

    /** @param iterable<object> $rows */
    private function suppressPending(int $tenantId, iterable $rows, string $reason): void
    {
        foreach ($rows as $row) {
            if (! in_array((string) $row->status, self::TERMINAL, true)) {
                $this->deliveries->markSuppressed($tenantId, (int) $row->id, $reason);
            }
        }
    }

    private function successfulEmailEvidence(int $tenantId, string $deliveryKey): bool
    {
        return Schema::hasTable('email_log')
            && Schema::hasColumn('email_log', 'idempotency_key')
            && DB::table('email_log')
                ->where('tenant_id', $tenantId)
                ->where('category', self::EMAIL_CATEGORY)
                ->where('idempotency_key', $deliveryKey)
                ->whereIn('status', ['sent', 'delivered'])
                ->exists();
    }
}
