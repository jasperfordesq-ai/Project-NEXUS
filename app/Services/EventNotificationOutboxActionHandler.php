<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Contracts\EventNotificationOutboxHandler;
use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use App\Support\Authorization\AdminTier;
use App\Support\Events\EventSafetyFoundationSupport;
use App\Support\Events\EventNotificationOutboxHandleResult;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterval;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;
use App\Support\UserDisplayName;

/** Recipient, locale, preference, and channel dispatcher for authoritative Event facts. */
final class EventNotificationOutboxActionHandler implements EventNotificationOutboxHandler
{
    private const TERMINAL = ['delivered', 'suppressed'];
    private const EMAIL_CATEGORY = 'event_outbox';

    public function __construct(
        private readonly ?EventDomainOutboxService $outbox = null,
        private readonly ?EventReminderChannelDeliveryService $deliveries = null,
        private readonly ?EventWaitlistOfferDeliveryEnvelope $offerEnvelope = null,
        private readonly ?EventGuardianConsentDeliveryEnvelope $guardianEnvelope = null,
        private readonly ?Closure $guardianSender = null,
        private readonly ?EventInvitationDeliveryConsumer $invitationConsumer = null,
        private readonly ?EventRegistrationGuestNotificationConsumer $guestNotificationConsumer = null,
    ) {}

    /** @param array<string,mixed> $outbox */
    public function handle(array $outbox): EventNotificationOutboxHandleResult
    {
        if ((string) ($outbox['action'] ?? '') === 'event.invitation.issued') {
            return ($this->invitationConsumer ?? new EventInvitationDeliveryConsumer())->handle($outbox);
        }
        if ((string) ($outbox['action'] ?? '') === 'event.registration_guest.withdrawn') {
            return ($this->guestNotificationConsumer ?? new EventRegistrationGuestNotificationConsumer())
                ->handle($outbox);
        }
        [$tenantId, $eventId, $payload] = $this->validatedPayload($outbox);
        $payload['outbox_id'] = (int) $outbox['id'];
        if ((string) $outbox['action'] === 'event.safety.guardian_consent.requested') {
            return $this->handleGuardianConsentDelivery(
                $outbox,
                $tenantId,
                $eventId,
                $payload,
            );
        }
        $descriptor = $this->descriptor((string) $outbox['action'], $payload);
        if ($descriptor === null) {
            return new EventNotificationOutboxHandleResult(0, 0, 0, true);
        }
        $channels = $descriptor['kind'] === 'reminder'
            ? ['email', 'in_app', 'web_push', 'fcm', 'realtime']
            : EventNotificationChannelConfiguration::resolve();
        $superseded = $this->participantFactSuperseded($tenantId, $eventId, $descriptor, $payload);

        $aggregateEvent = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->first([
                'id',
                'tenant_id',
                'user_id',
                'title',
                'start_time',
                'timezone',
                'all_day',
                'calendar_sequence',
                'status',
                'publication_status',
                'operational_status',
                'parent_event_id',
                'is_recurring_template',
            ]);
        if ($aggregateEvent === null) {
            throw new RuntimeException('event_notification_event_not_found');
        }
        $event = $this->presentationEvent($tenantId, $aggregateEvent, $descriptor, $payload);
        $payload['presentation_event_id'] = (int) $event->id;

        $plans = $this->recipientPlans(
            $tenantId,
            $eventId,
            (int) $aggregateEvent->user_id,
            $descriptor,
            $payload,
        );
        if ($plans === []) {
            return new EventNotificationOutboxHandleResult(0, 0, 0, true);
        }
        $seriesMetadata = is_array($payload['metadata']['series'] ?? null)
            ? $payload['metadata']['series']
            : [];
        $recipientContextIds = $this->recipientEventContexts(
            $tenantId,
            $eventId,
            $plans,
            $seriesMetadata,
        );
        $contextEvents = collect([(int) $event->id => $event]);
        $requestedContextIds = array_values(array_unique(array_diff(
            array_values($recipientContextIds),
            [(int) $event->id],
        )));
        if ($requestedContextIds !== []) {
            $resolvedContexts = DB::table('events')
                ->where('tenant_id', $tenantId)
                ->where('parent_event_id', $eventId)
                ->where('is_recurring_template', 0)
                ->whereIn('id', $requestedContextIds)
                ->get([
                    'id',
                    'tenant_id',
                    'user_id',
                    'title',
                    'start_time',
                    'timezone',
                    'all_day',
                    'calendar_sequence',
                    'status',
                    'publication_status',
                    'operational_status',
                    'parent_event_id',
                    'is_recurring_template',
                ])
                ->keyBy('id');
            if ($resolvedContexts->count() !== count($requestedContextIds)) {
                throw new RuntimeException('event_notification_recipient_context_invalid');
            }
            $contextEvents = $contextEvents->union($resolvedContexts);
        }

        $users = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', array_keys($plans))
            ->get(['id', 'tenant_id', 'email', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language', 'status', 'deleted_at'])
            ->keyBy('id');

        $delivered = 0;
        $suppressed = 0;
        $retryRequired = false;
        $retryReason = 'event_notification_channel_retry_required';
        foreach ($plans as $userId => $audience) {
            $recipient = $users->get($userId);
            if ($recipient === null) {
                if ($superseded) {
                    continue;
                }
                $retryRequired = true;
                $retryReason = 'event_notification_recipient_missing';
                Log::error('[EventNotificationOutbox] Recipient reference is missing', [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'outbox_id' => (int) $outbox['id'],
                    'recipient_reference_fingerprint' => hash('sha256', $tenantId . ':' . $userId),
                    'reason_code' => 'event_notification_recipient_missing',
                ]);
                continue;
            }

            try {
                $recipientEvent = $contextEvents->get($recipientContextIds[$userId] ?? (int) $event->id);
                if ($recipientEvent === null) {
                    throw new RuntimeException('event_notification_recipient_context_invalid');
                }
                $statuses = LocaleContext::withLocale(
                    $recipient,
                    fn (): array => $this->deliverRecipient(
                        $outbox,
                        $payload,
                        $descriptor,
                        $recipientEvent,
                        $recipient,
                        $audience,
                        $channels,
                        $superseded,
                    ),
                );
                foreach ($statuses as $status) {
                    $delivered += $status === 'delivered' ? 1 : 0;
                    $suppressed += $status === 'suppressed' ? 1 : 0;
                    // failed_terminal is deliberately not a successful terminal
                    // state: it escalates the parent fact to dead-letter so the
                    // operator sees a durable alert instead of silent data loss.
                    if (! in_array($status, self::TERMINAL, true)) {
                        $retryRequired = true;
                    }
                }
            } catch (Throwable $exception) {
                $retryRequired = true;
                Log::warning('[EventNotificationOutbox] Recipient dispatch failed', [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'outbox_id' => (int) $outbox['id'],
                    'recipient_user_id' => (int) $userId,
                    'exception' => $exception::class,
                    'reason_code' => EventNotificationErrorSanitizer::sanitize($exception->getMessage(), 191),
                ]);
            }
        }

        if ($retryRequired) {
            throw new RuntimeException($retryReason);
        }

        if ($descriptor['kind'] === 'reminder') {
            $this->completeReminderSchedule(
                $tenantId,
                (int) $outbox['id'],
                (int) ($payload['schedule_id'] ?? 0),
                $delivered > 0,
            );
        }

        return new EventNotificationOutboxHandleResult($users->count(), $delivered, $suppressed);
    }

    /**
     * External guardians are not tenant users. Their address and one-use token
     * are recovered only after the hashed delivery row has been claimed.
     *
     * @param array<string,mixed> $outbox
     * @param array<string,mixed> $payload
     */
    private function handleGuardianConsentDelivery(
        array $outbox,
        int $tenantId,
        int $eventId,
        array $payload,
    ): EventNotificationOutboxHandleResult {
        $consentId = (int) ($payload['consent_id'] ?? 0);
        $consentVersion = (int) ($payload['consent_version'] ?? 0);
        $minorUserId = (int) ($payload['minor_user_id'] ?? 0);
        if ($consentId <= 0 || $consentVersion <= 0 || $minorUserId <= 0
            || (int) ($outbox['aggregate_version'] ?? 0) !== $consentVersion
            || ! Schema::hasTable('event_guardian_consent_delivery_envelopes')
            || ! Schema::hasTable('event_guardian_consent_delivery_access')
            || ! Schema::hasColumn('event_notification_deliveries', 'external_recipient_hash')) {
            throw new RuntimeException('event_guardian_delivery_payload_invalid');
        }
        $consent = DB::table('event_guardian_consents')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $consentId)
            ->where('minor_user_id', $minorUserId)
            ->where('status', 'pending')
            ->where('consent_version', $consentVersion)
            ->where('expires_at', '>', now())
            ->first();
        $event = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->first(['id', 'tenant_id', 'title']);
        $minor = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $minorUserId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first(['id', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language']);
        if ($consent === null || $event === null || $minor === null) {
            throw new RuntimeException('event_guardian_delivery_scope_invalid');
        }
        $externalHash = strtolower(trim((string) $consent->guardian_email_blind_hash));
        if (preg_match('/^[0-9a-f]{64}$/', $externalHash) !== 1) {
            throw new RuntimeException('event_guardian_delivery_scope_invalid');
        }
        $locale = ($this->guardianLocaleResolver())->assertStored(
            (string) $consent->guardian_locale,
        );
        $deliveryKey = EventDomainOutboxService::externalDeliveryKey(
            $tenantId,
            $eventId,
            (string) $outbox['action'],
            $externalHash,
            'email',
            $consentVersion,
        );
        $delivery = DB::table('event_notification_deliveries')
            ->where('tenant_id', $tenantId)
            ->where('delivery_key', $deliveryKey)
            ->first();
        $delivery = $delivery === null
            ? ($this->outbox ?? new EventDomainOutboxService())->ensureExternalDelivery(
                (int) $outbox['id'],
                $externalHash,
                'email',
                $deliveryKey,
            )
            : (array) $delivery;
        if ((string) ($delivery['status'] ?? '') === 'delivered') {
            ($this->guardianEnvelope ?? new EventGuardianConsentDeliveryEnvelope())
                ->completeAfterDelivery((int) $outbox['id'], $deliveryKey);

            return new EventNotificationOutboxHandleResult(1, 1, 0);
        }
        if ((string) ($delivery['status'] ?? '') === 'failed_terminal') {
            throw new RuntimeException('event_guardian_delivery_terminal_failure');
        }

        $deliveryService = $this->deliveries ?? new EventReminderChannelDeliveryService();
        $claim = $deliveryService->claim($tenantId, (int) $delivery['id']);
        if ($claim === null) {
            throw new RuntimeException('event_guardian_delivery_claim_unavailable');
        }
        $claimToken = (string) $claim['claim_token'];
        if ($this->successfulSensitiveExternalEmailEvidenceExists(
            $tenantId,
            $deliveryKey,
            $externalHash,
        )) {
            if (! $deliveryService->markDelivered(
                $tenantId,
                (int) $delivery['id'],
                $claimToken,
                'email_log',
            )) {
                throw new RuntimeException('event_guardian_delivery_evidence_completion_failed');
            }
            ($this->guardianEnvelope ?? new EventGuardianConsentDeliveryEnvelope())
                ->completeAfterDelivery((int) $outbox['id'], $deliveryKey);

            return new EventNotificationOutboxHandleResult(1, 1, 0);
        }

        try {
            $support = new EventSafetyFoundationSupport();
            $guardianEmail = $support->decrypt((string) $consent->guardian_email_ciphertext);
            if (! hash_equals(
                $externalHash,
                $support->privacyHash($tenantId, 'guardian-email', $guardianEmail),
            )) {
                throw new RuntimeException('event_guardian_delivery_scope_invalid');
            }
            $identity = json_decode(
                $support->decrypt((string) $consent->guardian_identity_ciphertext),
                true,
                8,
                JSON_THROW_ON_ERROR,
            );
            $guardianName = is_array($identity) && is_string($identity['guardian_name'] ?? null)
                ? trim($identity['guardian_name'])
                : '';
            if ($guardianName === '' || Mailer::isSuppressed($guardianEmail)) {
                throw new RuntimeException('event_guardian_delivery_recipient_unavailable');
            }
            $envelopeClaim = ($this->guardianEnvelope ?? new EventGuardianConsentDeliveryEnvelope())
                ->claimOrResume((int) $outbox['id'], $deliveryKey);
            $minorName = UserDisplayName::resolve($minor)
                ?: trim((string) ($minor->name ?? ''));
            $grantUrl = TenantContext::getFrontendUrl()
                . TenantContext::getSlugPrefix()
                . '/events/' . $eventId . '/guardian-consent?token='
                . rawurlencode($envelopeClaim->guardianToken);

            $sent = LocaleContext::withLocale($locale, function () use (
                $tenantId,
                $eventId,
                $guardianEmail,
                $guardianName,
                $minorName,
                $event,
                $grantUrl,
                $deliveryKey,
                $externalHash,
            ): bool {
                $localizedMinorName = $minorName !== ''
                    ? $minorName
                    : __('emails.common.fallback_member_name');
                $subject = __('emails.event_guardian_consent.subject', [
                    'event' => (string) $event->title,
                ]);
                $html = EmailTemplateBuilder::make()
                    ->theme('info')
                    ->title(__('emails.event_guardian_consent.title'))
                    ->greeting(__('emails.event_guardian_consent.greeting', [
                        'name' => $guardianName,
                    ]))
                    ->paragraph(__('emails.event_guardian_consent.introduction', [
                        'minor' => $localizedMinorName,
                        'event' => (string) $event->title,
                    ]))
                    ->paragraph(__('emails.event_guardian_consent.security_notice'))
                    ->button(__('emails.event_guardian_consent.review_button'), $grantUrl)
                    ->paragraph(__('emails.event_guardian_consent.expiry_notice'))
                    ->render();

                if ($this->guardianSender !== null) {
                    return (bool) ($this->guardianSender)(
                        $guardianEmail,
                        $subject,
                        $html,
                        (string) app()->getLocale(),
                        $deliveryKey,
                        $externalHash,
                    );
                }

                return EmailDispatchService::sendRaw(
                    $guardianEmail,
                    $subject,
                    $html,
                    null,
                    null,
                    null,
                    Mailer::CATEGORY_SAFEGUARDING,
                    [
                        'tenant_id' => $tenantId,
                        'event_id' => $eventId,
                        'idempotency_key' => $deliveryKey,
                        'source' => self::class,
                        'sensitive_external' => true,
                        'recipient_hash' => $externalHash,
                    ],
                );
            });
            if (! $sent) {
                throw new RuntimeException('event_guardian_delivery_provider_rejected');
            }
            if (! $deliveryService->markDelivered(
                $tenantId,
                (int) $delivery['id'],
                $claimToken,
                'email',
            )) {
                throw new RuntimeException('event_guardian_delivery_ledger_completion_failed');
            }
            ($this->guardianEnvelope ?? new EventGuardianConsentDeliveryEnvelope())
                ->complete($envelopeClaim, $deliveryKey);
        } catch (Throwable $exception) {
            $deliveryService->markRetrying(
                $tenantId,
                (int) $delivery['id'],
                $claimToken,
                EventNotificationErrorSanitizer::sanitize($exception->getMessage()),
            );
            throw new RuntimeException('event_guardian_delivery_retry_required', 0, $exception);
        }

        return new EventNotificationOutboxHandleResult(1, 1, 0);
    }

    private function guardianLocaleResolver(): EventGuardianLocaleResolver
    {
        return new EventGuardianLocaleResolver();
    }

    /** @param array<string,mixed> $outbox @return array{int,int,array<string,mixed>} */
    private function validatedPayload(array $outbox): array
    {
        $tenantId = (int) ($outbox['tenant_id'] ?? 0);
        $eventId = (int) ($outbox['event_id'] ?? 0);
        if ($tenantId <= 0 || $eventId <= 0
            || (string) ($outbox['production_mode'] ?? '') !== 'outbox_authoritative') {
            throw new RuntimeException('event_notification_outbox_scope_invalid');
        }

        $payload = is_array($outbox['payload'] ?? null)
            ? $outbox['payload']
            : json_decode((string) ($outbox['payload'] ?? ''), true, 64, JSON_THROW_ON_ERROR);
        if (! is_array($payload)
            || (int) ($payload['schema_version'] ?? 0) !== 1
            || (int) ($payload['tenant_id'] ?? $tenantId) !== $tenantId
            || (int) ($payload['event_id'] ?? 0) !== $eventId) {
            throw new RuntimeException('event_notification_outbox_payload_invalid');
        }

        return [$tenantId, $eventId, $payload];
    }

    /**
     * Series facts retain the template as their aggregate identity, but every
     * member-facing decision must use a concrete occurrence for preferences,
     * rendering, and links.
     *
     * @param array{kind:string,state:string,notification_type:string,offer_secret:bool} $descriptor
     * @param array<string,mixed> $payload
     */
    private function presentationEvent(
        int $tenantId,
        object $aggregateEvent,
        array $descriptor,
        array $payload,
    ): object {
        if (! (bool) ($aggregateEvent->is_recurring_template ?? false)) {
            return $aggregateEvent;
        }
        if (! in_array($descriptor['kind'], ['update', 'lifecycle'], true)) {
            throw new RuntimeException('event_notification_recurring_template_subject_invalid');
        }

        $series = is_array($payload['metadata']['series'] ?? null)
            ? $payload['metadata']['series']
            : [];
        $explicit = max(0, (int) ($payload['presentation_event_id']
            ?? $series['presentation_event_id']
            ?? 0));
        $candidateIds = [];
        if ($explicit > 0) {
            $candidateIds[] = $explicit;
        } else {
            foreach ([
                $series['effective_from_event_id'] ?? null,
                $payload['effective_from_event_id'] ?? null,
            ] as $candidate) {
                $candidate = max(0, (int) $candidate);
                if ($candidate > 0) {
                    $candidateIds[] = $candidate;
                }
            }
            foreach ((array) ($series['affected_event_ids'] ?? []) as $candidate) {
                $candidate = max(0, (int) $candidate);
                if ($candidate > 0 && $candidate !== (int) $aggregateEvent->id) {
                    $candidateIds[] = $candidate;
                }
            }
        }
        $candidateIds = array_values(array_unique($candidateIds));
        $candidates = $candidateIds === []
            ? collect()
            : DB::table('events')
                ->where('tenant_id', $tenantId)
                ->where('parent_event_id', (int) $aggregateEvent->id)
                ->where('is_recurring_template', 0)
                ->whereIn('id', $candidateIds)
                ->get([
                'id',
                'tenant_id',
                'user_id',
                'title',
                'start_time',
                'timezone',
                'all_day',
                'calendar_sequence',
                'status',
                'publication_status',
                'operational_status',
                'parent_event_id',
                'is_recurring_template',
                ])
                ->keyBy('id');
        if ($explicit > 0) {
            $presentation = $candidates->get($explicit);
            if ($presentation === null) {
                throw new RuntimeException('event_notification_presentation_event_invalid');
            }

            return $presentation;
        }
        foreach ($candidateIds as $candidateId) {
            $presentation = $candidates->get($candidateId);
            if ($presentation !== null) {
                return $presentation;
            }
        }
        $fallback = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('parent_event_id', (int) $aggregateEvent->id)
            ->where('is_recurring_template', 0)
            ->orderByRaw('CASE WHEN start_time >= ? THEN 0 ELSE 1 END', [now()])
            ->orderBy('start_time')
            ->orderBy('id')
            ->first([
                'id',
                'tenant_id',
                'user_id',
                'title',
                'start_time',
                'timezone',
                'all_day',
                'calendar_sequence',
                'status',
                'publication_status',
                'operational_status',
                'parent_event_id',
                'is_recurring_template',
            ]);
        if ($fallback === null) {
            throw new RuntimeException('event_notification_presentation_event_missing');
        }

        return $fallback;
    }

    /**
     * Older series aggregate producers did not persist a recipient-to-
     * occurrence map. Derive only the missing entries from the bounded set of
     * affected concrete IDs so event-level opt-outs and links remain exact.
     *
     * @param array<int,string> $plans
     * @param array<string,mixed> $series
     * @return array<int,int>
     */
    private function recipientEventContexts(
        int $tenantId,
        int $rootEventId,
        array $plans,
        array $series,
    ): array {
        $contexts = [];
        foreach ((array) ($series['recipient_event_ids'] ?? []) as $recipientId => $contextEventId) {
            $recipientId = (int) $recipientId;
            $contextEventId = (int) $contextEventId;
            if (isset($plans[$recipientId]) && $contextEventId > 0) {
                $contexts[$recipientId] = $contextEventId;
            }
        }

        $recipientIds = array_values(array_filter(
            array_map(static fn (int|string $id): int => (int) $id, array_keys($plans)),
            static fn (int $id): bool => $id > 0 && ! isset($contexts[$id]),
        ));
        $affectedIds = array_values(array_unique(array_filter(
            array_map(
                static fn (mixed $id): int => (int) $id,
                (array) ($series['affected_event_ids'] ?? []),
            ),
            static fn (int $id): bool => $id > 0 && $id !== $rootEventId,
        )));
        if ($recipientIds === [] || $affectedIds === []) {
            ksort($contexts, SORT_NUMERIC);
            return $contexts;
        }

        $concreteRows = collect();
        foreach (array_chunk($affectedIds, 250) as $eventChunk) {
            $concreteRows = $concreteRows->merge(DB::table('events')
                ->where('tenant_id', $tenantId)
                ->where('parent_event_id', $rootEventId)
                ->where('is_recurring_template', 0)
                ->whereIn('id', $eventChunk)
                ->get(['id', 'start_time']));
        }
        $threshold = now()->format('Y-m-d H:i:s');
        $orderedEventRows = $concreteRows
            ->unique('id')
            ->sort(static function (object $left, object $right) use ($threshold): int {
                $leftFuture = (string) $left->start_time >= $threshold ? 0 : 1;
                $rightFuture = (string) $right->start_time >= $threshold ? 0 : 1;
                if ($leftFuture !== $rightFuture) {
                    return $leftFuture <=> $rightFuture;
                }
                $timeOrder = strcmp((string) $left->start_time, (string) $right->start_time);

                return $timeOrder !== 0 ? $timeOrder : ((int) $left->id <=> (int) $right->id);
            })
            ->values();
        $orderedEventIds = $orderedEventRows
            ->map(static fn (object $row): int => (int) $row->id)
            ->all();
        if ($orderedEventIds === []) {
            ksort($contexts, SORT_NUMERIC);
            return $contexts;
        }

        $candidateSets = [];
        $record = static function ($baseQuery) use (
            $tenantId,
            $orderedEventIds,
            $recipientIds,
            &$candidateSets,
        ): void {
            foreach (array_chunk($orderedEventIds, 250) as $eventChunk) {
                foreach (array_chunk($recipientIds, 250) as $recipientChunk) {
                    $rows = (clone $baseQuery)
                        ->where('tenant_id', $tenantId)
                        ->whereIn('event_id', $eventChunk)
                        ->whereIn('user_id', $recipientChunk)
                        ->get(['event_id', 'user_id']);
                    foreach ($rows as $row) {
                        $eventId = (int) $row->event_id;
                        $userId = (int) $row->user_id;
                        if ($eventId > 0 && $userId > 0) {
                            $candidateSets[$userId][$eventId] = true;
                        }
                    }
                }
            }
        };

        if (Schema::hasTable('event_registrations')) {
            $record(DB::table('event_registrations')
                ->whereIn('registration_state', ['invited', 'pending', 'confirmed']));
        }
        if (Schema::hasTable('event_waitlist_entries')) {
            $record(DB::table('event_waitlist_entries')
                ->whereIn('queue_state', ['waiting', 'offered']));
        }
        if (Schema::hasTable('event_rsvps')) {
            $record(DB::table('event_rsvps')
                ->whereIn('status', ['going', 'interested', 'maybe', 'invited', 'waitlisted']));
        }
        if (Schema::hasTable('event_staff_assignments')) {
            $record(DB::table('event_staff_assignments')
                ->where('status', 'active')
                ->where(static fn ($expiry) => $expiry
                    ->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now())));
        }
        if (Schema::hasTable('event_waitlist')) {
            $record(DB::table('event_waitlist')->where('status', 'waiting'));
        }

        foreach ($candidateSets as $recipientId => $eventSet) {
            foreach ($orderedEventIds as $candidateId) {
                if (isset($eventSet[$candidateId])) {
                    $contexts[(int) $recipientId] = $candidateId;
                    break;
                }
            }
        }
        ksort($contexts, SORT_NUMERIC);

        return $contexts;
    }

    /**
     * @param array<string,mixed> $payload
     * @return array{kind:string,state:string,notification_type:string,offer_secret:bool}|null
     */
    private function descriptor(string $action, array $payload): ?array
    {
        if ($action === 'event.reminder.due') {
            if ((int) ($payload['schedule_id'] ?? 0) <= 0
                || (int) ($payload['schedule_version'] ?? 0) <= 0
                || (int) ($payload['recipient_user_id'] ?? 0) <= 0) {
                throw new RuntimeException('event_notification_reminder_identity_invalid');
            }

            return [
                'kind' => 'reminder',
                'state' => 'due',
                'notification_type' => 'event_reminder',
                'offer_secret' => false,
            ];
        }

        if ($action === 'event.updated') {
            if (($payload['metadata']['notifications_suppressed'] ?? false) === true) {
                return null;
            }
            $changed = $payload['changed_fields'] ?? null;
            if (! is_array($changed) || $changed === [] || ! array_is_list($changed)) {
                throw new RuntimeException('event_notification_update_fields_invalid');
            }

            return [
                'kind' => 'update',
                'state' => 'changed',
                'notification_type' => 'event_update',
                'offer_secret' => false,
            ];
        }

        if ($action === 'event.lifecycle.transitioned') {
            if (($payload['metadata']['notifications_suppressed'] ?? false) === true) {
                return null;
            }
            $publicationFrom = (string) ($payload['publication']['from'] ?? '');
            $publicationTo = (string) ($payload['publication']['to'] ?? '');
            $operationalFrom = (string) ($payload['operational']['from'] ?? '');
            $operationalTo = (string) ($payload['operational']['to'] ?? '');
            $seriesAction = (string) ($payload['metadata']['series']['action'] ?? '');

            $state = match (true) {
                $seriesAction === 'reject'
                    && $publicationFrom === $publicationTo
                    && $operationalFrom === $operationalTo => 'rejected',
                $seriesAction === 'restore'
                    && $publicationFrom === $publicationTo
                    && $operationalFrom === $operationalTo
                    && $publicationTo === 'draft' => 'restored_private',
                $seriesAction === 'restore'
                    && $publicationFrom === $publicationTo
                    && $operationalFrom === $operationalTo => 'restored',
                $publicationTo === 'archived' => 'archived',
                $publicationFrom === 'pending_review' && $publicationTo === 'draft' => 'rejected',
                $publicationFrom === 'archived' && $publicationTo === 'draft' => 'restored_private',
                $publicationFrom === 'archived' => 'restored',
                $operationalTo === 'cancelled' => 'cancelled',
                $operationalTo === 'postponed' => 'postponed',
                $operationalTo === 'completed' => 'completed',
                in_array($operationalFrom, ['cancelled', 'postponed'], true)
                    && $operationalTo === 'scheduled' => 'restored',
                $publicationTo === 'pending_review' => 'pending_review',
                $publicationTo === 'published' => 'published',
                default => null,
            };
            if ($state === null) {
                return null;
            }

            return [
                'kind' => 'lifecycle',
                'state' => $state,
                'notification_type' => match ($state) {
                    'cancelled' => 'event_cancellation',
                    'pending_review', 'rejected' => 'event_moderation',
                    default => 'event_lifecycle',
                },
                'offer_secret' => false,
            ];
        }

        if (in_array($action, [
            'event.safety.guardian_consent.granted',
            'event.safety.guardian_consent.withdrawn',
        ], true)) {
            $expectedKeys = [
                'consent_id',
                'consent_version',
                'event_id',
                'occurred_at',
                'recipient_user_id',
                'schema_version',
                'tenant_id',
                'to_status',
            ];
            $actualKeys = array_keys($payload);
            sort($actualKeys);
            if ($actualKeys !== $expectedKeys
                || (int) ($payload['consent_id'] ?? 0) <= 0
                || (int) ($payload['consent_version'] ?? 0) <= 0
                || (int) ($payload['recipient_user_id'] ?? 0) <= 0
                || ! is_string($payload['occurred_at'] ?? null)
                || trim((string) $payload['occurred_at']) === '') {
                throw new RuntimeException('event_notification_guardian_consent_payload_invalid');
            }
            $state = str_ends_with($action, '.granted') ? 'granted' : 'withdrawn';
            $expectedStatus = $state === 'granted' ? 'active' : 'withdrawn';
            if ((string) ($payload['to_status'] ?? '') !== $expectedStatus) {
                throw new RuntimeException('event_notification_guardian_consent_state_invalid');
            }

            return [
                'kind' => 'guardian_consent',
                'state' => $state,
                'notification_type' => 'event_guardian_consent_status',
                'offer_secret' => false,
            ];
        }

        if (str_starts_with($action, 'event.registration.')) {
            $state = (string) ($payload['to_state'] ?? substr($action, strlen('event.registration.')));
            if ($state === 'canonicalized') {
                return null;
            }
            if (! in_array($state, ['invited', 'pending', 'confirmed', 'declined', 'cancelled'], true)) {
                throw new RuntimeException('event_notification_registration_state_unsupported');
            }

            return ['kind' => 'registration', 'state' => $state, 'notification_type' => 'event_registration', 'offer_secret' => false];
        }

        if (str_starts_with($action, 'event.waitlist.')) {
            $state = (string) ($payload['to_state'] ?? substr($action, strlen('event.waitlist.')));
            if (! in_array($state, ['waiting', 'offered', 'accepted', 'expired', 'cancelled'], true)) {
                throw new RuntimeException('event_notification_waitlist_state_unsupported');
            }

            return [
                'kind' => 'waitlist',
                'state' => $state,
                'notification_type' => 'event_waitlist',
                'offer_secret' => $state === 'offered',
            ];
        }

        if (str_starts_with($action, 'event.staff_role.')) {
            $state = substr($action, strlen('event.staff_role.'));
            if (! in_array($state, ['granted', 'revoked'], true)) {
                throw new RuntimeException('event_notification_staff_state_unsupported');
            }

            return ['kind' => 'staff_role', 'state' => $state, 'notification_type' => 'event_staff_role', 'offer_secret' => false];
        }

        throw new RuntimeException('event_notification_action_unsupported');
    }

    /**
     * Coalesce participant facts only after the canonical row has advanced.
     * A future fact never sends against a lagging row; offered places fail
     * closed when their canonical identity cannot be verified.
     *
     * @param array{kind:string,state:string,notification_type:string,offer_secret:bool} $descriptor
     * @param array<string,mixed> $payload
     */
    private function participantFactSuperseded(
        int $tenantId,
        int $eventId,
        array $descriptor,
        array $payload,
    ): bool {
        if ($descriptor['kind'] === 'reminder') {
            return $this->reminderFactSuperseded($tenantId, $eventId, $payload);
        }

        $identity = match ($descriptor['kind']) {
            'waitlist' => ['event_waitlist_entries', 'waitlist_entry_id', 'queue_version', 'queue_state', 'to_state'],
            'registration' => ['event_registrations', 'registration_id', 'registration_version', 'registration_state', 'to_state'],
            'staff_role' => ['event_staff_assignments', 'assignment_id', 'assignment_version', 'status', 'to_status'],
            'guardian_consent' => ['event_guardian_consents', 'consent_id', 'consent_version', 'status', 'to_status'],
            default => null,
        };
        if ($identity === null) {
            return false;
        }
        if (! Schema::hasTable($identity[0])) {
            throw new RuntimeException('event_notification_participant_schema_unavailable');
        }

        [$table, $idKey, $versionKey, $stateColumn, $payloadStateKey] = $identity;
        $canonicalId = (int) ($payload[$idKey] ?? 0);
        $factVersion = (int) ($payload[$versionKey] ?? 0);
        if ($canonicalId <= 0 || $factVersion <= 0) {
            throw new RuntimeException('event_notification_participant_identity_invalid');
        }
        $canonical = DB::table($table)
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $canonicalId)
            ->first([$versionKey, $stateColumn]);
        if ($canonical === null) {
            throw new RuntimeException('event_notification_participant_canonical_state_unavailable');
        }

        $canonicalVersion = (int) $canonical->{$versionKey};
        if ($canonicalVersion > $factVersion) {
            return true;
        }
        if ($canonicalVersion < $factVersion) {
            throw new RuntimeException('event_notification_participant_canonical_version_lag');
        }

        $expectedState = (string) ($payload[$payloadStateKey] ?? '');
        if ($descriptor['kind'] === 'staff_role' && $expectedState === '') {
            $expectedState = $descriptor['state'] === 'granted' ? 'active' : 'revoked';
        }
        if ($expectedState === '') {
            throw new RuntimeException('event_notification_participant_state_invalid');
        }

        return (string) $canonical->{$stateColumn} !== $expectedState;
    }

    /** @param array<string,mixed> $payload */
    private function reminderFactSuperseded(int $tenantId, int $eventId, array $payload): bool
    {
        $scheduleId = (int) ($payload['schedule_id'] ?? 0);
        $schedule = DB::table('event_reminder_schedules')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $scheduleId)
            ->first();
        if ($schedule === null) {
            throw new RuntimeException('event_notification_reminder_schedule_missing');
        }
        if ((int) $schedule->user_id !== (int) ($payload['recipient_user_id'] ?? 0)
            || (int) $schedule->schedule_version !== (int) ($payload['schedule_version'] ?? 0)) {
            throw new RuntimeException('event_notification_reminder_schedule_identity_mismatch');
        }
        if (in_array((string) $schedule->status, [
            'delivered',
            'cancelled',
            'superseded',
            'suppressed',
        ], true)) {
            return true;
        }
        if ((string) $schedule->status !== 'queued') {
            throw new RuntimeException('event_notification_reminder_schedule_not_queued');
        }
        if ((int) ($schedule->outbox_id ?? 0) !== (int) ($payload['outbox_id'] ?? 0)) {
            throw new RuntimeException('event_notification_reminder_outbox_mismatch');
        }

        $now = now();
        if ($schedule->deliver_until !== null && $now->greaterThan((string) $schedule->deliver_until)) {
            $this->closeQueuedReminder($tenantId, $scheduleId, 'suppressed', 'outside_recovery_horizon');
            return true;
        }
        $event = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->first(['calendar_sequence', 'status', 'publication_status', 'operational_status', 'start_time']);
        $deliverable = $event !== null
            && (int) $event->calendar_sequence === (int) $schedule->event_calendar_sequence
            && ((string) ($event->publication_status ?? '') === 'published'
                || ((string) ($event->publication_status ?? '') === ''
                    && (string) ($event->status ?? '') === 'active'))
            && in_array((string) ($event->operational_status ?? ''), ['', 'scheduled'], true)
            && now()->lessThan((string) $event->start_time);
        if (! $deliverable) {
            $this->closeQueuedReminder($tenantId, $scheduleId, 'superseded', 'event_schedule_changed');
            return true;
        }

        $registration = DB::table('event_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', (int) ($schedule->registration_id ?? 0))
            ->where('user_id', (int) $schedule->user_id)
            ->first(['registration_state', 'registration_version']);
        if ($registration === null
            || (string) $registration->registration_state !== 'confirmed'
            || (int) $registration->registration_version !== (int) $schedule->registration_version) {
            $this->closeQueuedReminder($tenantId, $scheduleId, 'cancelled', 'registration_inactive');
            return true;
        }

        if ($schedule->rule_id !== null) {
            $rule = DB::table('event_reminder_rules')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', (int) $schedule->user_id)
                ->where('id', (int) $schedule->rule_id)
                ->first(['enabled', 'rule_version']);
            if ($rule === null || ! (bool) $rule->enabled
                || (int) $rule->rule_version !== (int) $schedule->rule_version) {
                $this->closeQueuedReminder($tenantId, $scheduleId, 'superseded', 'reminder_rule_changed');
                return true;
            }
        }

        return false;
    }

    /**
     * @param array{kind:string,state:string,notification_type:string,offer_secret:bool} $descriptor
     * @param array<string,mixed> $payload
     * @return array<int,string>
     */
    private function recipientPlans(
        int $tenantId,
        int $eventId,
        int $organizerId,
        array $descriptor,
        array $payload,
    ): array {
        $plans = [];
        $add = static function (array &$target, int $userId, string $audience): void {
            if ($userId > 0 && (! isset($target[$userId]) || $audience === 'admin')) {
                $target[$userId] = $audience;
            }
        };

        if ($descriptor['kind'] === 'lifecycle') {
            $add($plans, $organizerId, 'member');
            if ($descriptor['state'] === 'published') {
                $admins = DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where(static function ($admin): void {
                        $admin->whereIn('role', ['super_admin', 'admin', 'tenant_admin', 'broker', 'coordinator'])
                            ->orWhere('is_admin', 1)
                            ->orWhere('is_super_admin', 1)
                            ->orWhere('is_tenant_super_admin', 1)
                            ->orWhere('is_god', 1);
                    })
                    ->where('status', 'active')
                    ->whereNull('deleted_at')
                    ->get([
                        'id',
                        'role',
                        'is_admin',
                        'is_super_admin',
                        'is_tenant_super_admin',
                        'is_god',
                    ]);
                foreach ($admins as $admin) {
                    if (AdminTier::allows($admin)) {
                        $add($plans, (int) $admin->id, 'admin');
                    }
                }
            } elseif ($descriptor['state'] === 'pending_review') {
                $admins = DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where(static function ($admin): void {
                        $admin->whereIn('role', ['super_admin', 'admin', 'tenant_admin', 'god'])
                            ->orWhere('is_admin', 1)
                            ->orWhere('is_super_admin', 1)
                            ->orWhere('is_tenant_super_admin', 1)
                            ->orWhere('is_god', 1);
                    })
                    ->where('status', 'active')
                    ->whereNull('deleted_at')
                    ->get([
                        'id',
                        'role',
                        'is_admin',
                        'is_super_admin',
                        'is_tenant_super_admin',
                        'is_god',
                    ]);
                foreach ($admins as $admin) {
                    if (AdminTier::allows($admin)) {
                        $add($plans, (int) $admin->id, 'admin');
                    }
                }
            } elseif (in_array($descriptor['state'], ['rejected', 'restored_private'], true)) {
                // These states are private. The organizer was added above;
                // prior participants must not receive an inaccessible link.
            } else {
                foreach ($this->participantIds($tenantId, $eventId) as $participantId) {
                    $add($plans, $participantId, 'member');
                }
                foreach ((array) ($payload['affected_recipient_user_ids'] ?? []) as $recipientId) {
                    $add($plans, (int) $recipientId, 'member');
                }
            }

            return $plans;
        }

        if ($descriptor['kind'] === 'reminder') {
            $add($plans, (int) ($payload['recipient_user_id'] ?? 0), 'member');
            return $plans;
        }

        if ($descriptor['kind'] === 'update') {
            foreach ($this->participantIds($tenantId, $eventId) as $participantId) {
                if ($participantId !== $organizerId) {
                    $add($plans, $participantId, 'member');
                }
            }
            foreach ((array) ($payload['affected_recipient_user_ids'] ?? []) as $recipientId) {
                if ((int) $recipientId !== $organizerId) {
                    $add($plans, (int) $recipientId, 'member');
                }
            }
            return $plans;
        }

        if ($descriptor['kind'] === 'guardian_consent') {
            $add($plans, (int) ($payload['recipient_user_id'] ?? 0), 'member');
            return $plans;
        }

        $subjectId = (int) ($payload['user_id'] ?? 0);
        $add($plans, $subjectId, 'member');
        if (in_array($descriptor['kind'], ['registration', 'waitlist'], true)
            && $organizerId !== $subjectId) {
            $add($plans, $organizerId, 'organizer');
        }

        return $plans;
    }

    /** @return list<int> */
    private function participantIds(int $tenantId, int $eventId): array
    {
        $ids = collect();
        if (Schema::hasTable('event_registrations')) {
            $ids = $ids->merge(DB::table('event_registrations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereIn('registration_state', ['invited', 'pending', 'confirmed'])
                ->pluck('user_id'));
        }
        if (Schema::hasTable('event_waitlist_entries')) {
            $ids = $ids->merge(DB::table('event_waitlist_entries')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereIn('queue_state', ['waiting', 'offered'])
                ->pluck('user_id'));
        }
        if (Schema::hasTable('event_rsvps')) {
            $ids = $ids->merge(DB::table('event_rsvps')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereIn('status', ['going', 'interested', 'maybe', 'invited', 'waitlisted'])
                ->pluck('user_id'));
        }
        if (Schema::hasTable('event_staff_assignments')) {
            $ids = $ids->merge(DB::table('event_staff_assignments')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('status', 'active')
                ->where(static fn ($query) => $query->whereNull('expires_at')->orWhere('expires_at', '>', now()))
                ->pluck('user_id'));
        }

        return $ids->map(static fn (mixed $id): int => (int) $id)
            ->filter(static fn (int $id): bool => $id > 0)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param array<string,mixed> $outbox
     * @param array<string,mixed> $payload
     * @param array{kind:string,state:string,notification_type:string,offer_secret:bool} $descriptor
     * @param non-empty-list<string> $channels
     * @return array<string,string>
     */
    private function deliverRecipient(
        array $outbox,
        array $payload,
        array $descriptor,
        object $event,
        object $recipient,
        string $audience,
        array $channels,
        bool $superseded,
    ): array {
        $tenantId = (int) $outbox['tenant_id'];
        $eventId = (int) $outbox['event_id'];
        $preferenceEventId = (int) $event->id;
        $userId = (int) $recipient->id;
        $rendered = $this->render($descriptor, $payload, $event, $recipient, $audience);
        $deliveryService = $this->deliveries ?? new EventReminderChannelDeliveryService();
        $rows = [];
        $eligible = (string) ($recipient->status ?? '') === 'active'
            && ($recipient->deleted_at ?? null) === null;
        $recipientDescriptor = $descriptor;
        $recipientDescriptor['preference_event_id'] = $preferenceEventId;
        $recipientDescriptor['audience'] = $audience;
        $recipientDescriptor['offer_secret'] = $descriptor['offer_secret']
            && $audience === 'member'
            && $userId === (int) ($payload['user_id'] ?? 0);

        foreach ($channels as $channel) {
            [$deliveryAction, $deliveryVersion] = $this->deliveryIdentity($outbox, $descriptor, $audience);
            $deliveryKey = EventDomainOutboxService::deliveryKey(
                $tenantId,
                $eventId,
                $deliveryAction,
                $userId,
                $channel,
                $deliveryVersion,
            );
            $row = DB::table('event_notification_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('delivery_key', $deliveryKey)
                ->first();
            $delivery = $row === null
                ? ($this->outbox ?? new EventDomainOutboxService())->ensureDelivery(
                    (int) $outbox['id'],
                    $userId,
                    $channel,
                    $deliveryKey,
                    ! $eligible,
                )
                : (array) $row;
            $rows[$channel] = $delivery;

            if ($superseded) {
                if (! in_array((string) ($delivery['status'] ?? ''), ['delivered', 'suppressed'], true)) {
                    $deliveryService->markSuperseded($tenantId, (int) $delivery['id']);
                }
                continue;
            }

            if ($recipientDescriptor['offer_secret'] && $channel === 'email'
                && (string) ($delivery['status'] ?? '') === 'delivered') {
                $this->completeOfferEnvelopeAfterDelivery((int) $outbox['id'], $deliveryKey);
            }
            if (in_array((string) ($delivery['status'] ?? ''), ['delivered', 'suppressed', 'failed_terminal'], true)) {
                continue;
            }

            if (! $eligible) {
                $deliveryService->markSuppressed($tenantId, (int) $delivery['id'], 'recipient_ineligible');
                continue;
            }

            if ($descriptor['kind'] === 'reminder') {
                $preferenceReason = $this->reminderChannelSuppression(
                    $tenantId,
                    $eventId,
                    $userId,
                    (int) ($payload['rule_id'] ?? 0),
                    $channel,
                );
                if ($preferenceReason !== null) {
                    $deliveryService->markSuppressed(
                        $tenantId,
                        (int) $delivery['id'],
                        $preferenceReason,
                        'event_reminder_preferences',
                    );
                    continue;
                }
            }

            if ($descriptor['kind'] !== 'reminder') {
                $preferenceReason = $this->guardianStatusChannelSuppression(
                    $tenantId,
                    $preferenceEventId,
                    $userId,
                    $channel,
                    false,
                );
                if ($preferenceReason !== null) {
                    $deliveryService->markSuppressed(
                        $tenantId,
                        (int) $delivery['id'],
                        $preferenceReason,
                        'event_notification_preferences',
                    );
                    continue;
                }
            }

            if (! EventNotificationPreferenceResolver::allowsBackgroundActivity(
                $tenantId,
                $descriptor['notification_type'],
            )) {
                $deliveryService->markSuppressed($tenantId, (int) $delivery['id'], 'event_feature_disabled');
                continue;
            }

            match ($channel) {
                'in_app' => $this->deliverInApp($deliveryService, $tenantId, $userId, $delivery, $rendered['message'], $rendered['path'], $descriptor['notification_type']),
                'push' => $this->deliverPush($deliveryService, $tenantId, $userId, $delivery, $rendered['message'], $rendered['path'], $descriptor['notification_type']),
                'web_push' => $this->deliverWebPush($deliveryService, $tenantId, $userId, $delivery, $rendered['subject'], $rendered['message'], $rendered['path'], $descriptor['notification_type']),
                'fcm' => $this->deliverFcm($deliveryService, $tenantId, $userId, $delivery, $rendered['subject'], $rendered['message'], $rendered['path'], $descriptor['notification_type']),
                'realtime' => $this->deliverRealtime($deliveryService, $tenantId, $userId, $delivery, $rendered['message'], $rendered['path'], $descriptor['notification_type']),
                'email' => $this->deliverEmail($deliveryService, $outbox, $recipientDescriptor, $recipient, $delivery, $rendered),
                default => null,
            };
        }

        return $deliveryService->statuses($tenantId, $rows);
    }

    /**
     * @param array<string,mixed> $outbox
     * @param array{kind:string,state:string,notification_type:string,offer_secret:bool} $descriptor
     * @return array{string,int}
     */
    private function deliveryIdentity(array $outbox, array $descriptor, string $audience): array
    {
        if ($descriptor['kind'] === 'reminder') {
            $payload = is_array($outbox['payload'] ?? null)
                ? $outbox['payload']
                : json_decode((string) ($outbox['payload'] ?? '{}'), true);
            $scheduleId = is_array($payload) ? (int) ($payload['schedule_id'] ?? 0) : 0;
            return [
                'event.reminder.due.schedule.' . max(0, $scheduleId),
                max(1, (int) $outbox['aggregate_version']),
            ];
        }

        if ($descriptor['kind'] === 'lifecycle'
            && $descriptor['state'] === 'published'
            && $audience === 'admin') {
            return ['event.admin_publication.created', 1];
        }
        if ($descriptor['kind'] === 'lifecycle'
            && $descriptor['state'] === 'pending_review'
            && $audience === 'admin') {
            return [
                'event.admin_moderation.submitted',
                max(1, (int) $outbox['aggregate_version']),
            ];
        }

        return [(string) $outbox['action'], max(1, (int) $outbox['aggregate_version'])];
    }

    /**
     * @param array{kind:string,state:string,notification_type:string,offer_secret:bool} $descriptor
     * @param array<string,mixed> $payload
     * @return array{subject:string,message:string,path:string,html:string}
     */
    private function render(array $descriptor, array $payload, object $event, object $recipient, string $audience): array
    {
        $title = (string) $event->title;
        $subject = __('event_notifications.subject', ['title' => $title]);
        $params = ['title' => $title];

        if ($descriptor['kind'] === 'reminder') {
            $timezone = trim((string) ($event->timezone ?? 'UTC'));
            try {
                new \DateTimeZone($timezone);
            } catch (Throwable) {
                $timezone = 'UTC';
            }
            $start = CarbonImmutable::parse((string) $event->start_time, 'UTC')
                ->setTimezone($timezone)
                ->locale(\App\I18n\FormattingLocale::carbon());
            $when = (bool) ($event->all_day ?? false)
                ? $start->isoFormat('LL')
                : $start->isoFormat('LLLL') . ' (' . $timezone . ')';
            $offset = CarbonInterval::minutes(max(1, (int) ($payload['offset_minutes'] ?? 1)))
                ->cascade()
                ->locale(\App\I18n\FormattingLocale::carbon())
                ->forHumans();
            $subject = __('event_notifications.reminder.subject', ['title' => $title]);
            $message = __('event_notifications.reminder.message', [
                'title' => $title,
                'offset' => $offset,
                'when' => $when,
            ]);
        } elseif ($descriptor['kind'] === 'update') {
            $labels = [];
            foreach ((array) ($payload['changed_fields'] ?? []) as $field) {
                if (! is_string($field)) {
                    continue;
                }
                $labelKey = match ($field) {
                    'title' => 'title',
                    'start_time', 'end_time' => 'time',
                    'timezone' => 'timezone',
                    'all_day' => 'all_day',
                    'location' => 'venue',
                    'is_online', 'online_link', 'allow_remote_attendance' => 'online_access',
                    'max_attendees' => 'capacity',
                    'venue_accessibility' => 'accessibility',
                    'accessibility_step_free',
                    'accessibility_toilet',
                    'accessibility_hearing_loop',
                    'accessibility_quiet_space',
                    'accessibility_seating',
                    'accessibility_parking',
                    'accessibility_parking_details',
                    'accessibility_transit_details',
                    'accessibility_assistance_contact',
                    'accessibility_notes' => 'accessibility',
                    'cancellation_policy' => 'cancellation_policy',
                    default => null,
                };
                if ($labelKey !== null) {
                    $labels[] = __('event_notifications.update.fields.' . $labelKey);
                }
            }
            $labels = array_values(array_unique($labels));
            if ($labels === []) {
                throw new RuntimeException('event_notification_update_fields_unsupported');
            }
            $message = __('event_notifications.update.message', [
                'title' => $title,
                'changes' => implode(__('event_notifications.update.separator'), $labels),
            ]);
            if (in_array((string) ($payload['recurrence_scope'] ?? 'single'), [
                'all',
                'this_and_future',
            ], true)) {
                $message .= ' ' . __('event_notifications.update.series_scope');
            }
        } elseif ($audience === 'organizer') {
            $subjectUserId = (int) ($payload['user_id'] ?? 0);
            $subjectUser = DB::table('users')
                ->where('tenant_id', (int) $event->tenant_id)
                ->where('id', $subjectUserId)
                ->first(['name', 'first_name', 'last_name', 'profile_type', 'organization_name']);
            $params['name'] = UserDisplayName::resolve(
                $subjectUser,
                __('emails.common.fallback_member_name'),
            );
            $params['state'] = __("event_notifications.states.{$descriptor['state']}");
            $message = __("event_notifications.{$descriptor['kind']}.organizer", $params);
        } elseif ($descriptor['kind'] === 'staff_role') {
            $params['role'] = __("event_notifications.roles." . (string) ($payload['role'] ?? 'staff'));
            $message = __("event_notifications.staff_role.{$descriptor['state']}", $params);
        } elseif ($descriptor['kind'] === 'guardian_consent') {
            $status = $descriptor['state'] === 'granted' ? 'active' : 'withdrawn';
            $message = __("event_safety.govuk.guardian_status.{$status}");
        } else {
            $messageState = $descriptor['state'] === 'restored_private'
                ? 'restored'
                : $descriptor['state'];
            $message = __("event_notifications.{$descriptor['kind']}.{$messageState}", $params);
        }

        if (in_array($descriptor['state'], ['cancelled', 'rejected'], true)
            && trim((string) ($payload['reason'] ?? '')) !== '') {
            $message .= ' ' . __('event_notifications.reason', ['reason' => (string) $payload['reason']]);
        }

        $path = match (true) {
            $descriptor['kind'] === 'lifecycle'
                && $descriptor['state'] === 'pending_review'
                && $audience === 'admin' => '/admin/events?publication_state=pending_review',
            $descriptor['kind'] === 'lifecycle'
                && $descriptor['state'] === 'archived'
                && $audience !== 'admin' => '/events',
            default => '/events/' . (int) $event->id,
        };
        $recipientName = $recipient->first_name ?? $recipient->name ?? __('emails.common.fallback_name');
        $url = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $path;
        $html = EmailTemplateBuilder::make()
            ->theme('info')
            ->title($subject)
            ->greeting((string) $recipientName)
            ->paragraph(htmlspecialchars($message, ENT_QUOTES, 'UTF-8'))
            ->button(__('event_notifications.view_event'), $url)
            ->render();

        return compact('subject', 'message', 'path', 'html');
    }

    private function reminderChannelSuppression(
        int $tenantId,
        int $eventId,
        int $userId,
        int $ruleId,
        string $channel,
    ): ?string {
        if (! (bool) app(EventConfigurationService::class)->value('reminders_enabled', true, $tenantId)) {
            return 'tenant_reminders_disabled';
        }
        $resolution = EventNotificationPreferenceResolver::resolveForEvent(
            $userId,
            $tenantId,
            $eventId,
        );
        if (! (bool) ($resolution['reminders_enabled'] ?? false)) {
            return 'reminders_disabled';
        }
        if (! (bool) ($resolution['channels'][$channel] ?? false)) {
            return 'channel_disabled_' . (string) ($resolution['channel_sources'][$channel] ?? 'unknown');
        }
        if ($ruleId <= 0) {
            return null;
        }

        $column = match ($channel) {
            'email' => 'email_enabled',
            'in_app' => 'in_app_enabled',
            'web_push' => 'web_push_enabled',
            'fcm' => 'fcm_enabled',
            'realtime' => 'realtime_enabled',
            default => null,
        };
        if ($column === null) {
            return 'channel_unsupported';
        }
        $rule = DB::table('event_reminder_rules')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('id', $ruleId)
            ->first([$column]);
        if ($rule === null) {
            return 'reminder_rule_missing';
        }

        return $rule->{$column} === null || (bool) $rule->{$column}
            ? null
            : 'channel_disabled_rule';
    }

    private function guardianStatusChannelSuppression(
        int $tenantId,
        int $eventId,
        int $userId,
        string $channel,
        bool $allowRecurringTemplate = false,
    ): ?string {
        $preferences = EventNotificationPreferenceResolver::resolveForEvent(
            $userId,
            $tenantId,
            $eventId,
            $allowRecurringTemplate,
        );
        $channels = is_array($preferences['channels'] ?? null)
            ? $preferences['channels']
            : [];
        $sources = is_array($preferences['channel_sources'] ?? null)
            ? $preferences['channel_sources']
            : [];
        $enabled = match ($channel) {
            'email' => (bool) ($channels['email'] ?? false),
            'in_app' => (bool) ($channels['in_app'] ?? false),
            'push' => (bool) ($channels['web_push'] ?? false)
                || (bool) ($channels['fcm'] ?? false),
            default => false,
        };
        if ($enabled) {
            return null;
        }
        $source = match ($channel) {
            'push' => (string) ($sources['web_push'] ?? $sources['fcm'] ?? 'unknown'),
            default => (string) ($sources[$channel] ?? 'unknown'),
        };

        return 'channel_disabled_' . preg_replace('/[^a-z0-9_]/', '_', strtolower($source));
    }

    private function closeQueuedReminder(
        int $tenantId,
        int $scheduleId,
        string $status,
        string $reason,
    ): void {
        $timestamps = [];
        if ($status === 'cancelled') {
            $timestamps['cancelled_at'] = now();
        } elseif ($status === 'superseded') {
            $timestamps['superseded_at'] = now();
        }
        DB::table('event_reminder_schedules')
            ->where('tenant_id', $tenantId)
            ->where('id', $scheduleId)
            ->where('status', 'queued')
            ->update([
                'status' => $status,
                'reason_code' => $reason,
                ...$timestamps,
                'updated_at' => now(),
            ]);
    }

    private function completeReminderSchedule(
        int $tenantId,
        int $outboxId,
        int $scheduleId,
        bool $anyDelivered,
    ): void {
        if ($scheduleId <= 0) {
            throw new RuntimeException('event_notification_reminder_schedule_identity_invalid');
        }
        $status = $anyDelivered ? 'delivered' : 'suppressed';
        $updated = DB::table('event_reminder_schedules')
            ->where('tenant_id', $tenantId)
            ->where('id', $scheduleId)
            ->where('outbox_id', $outboxId)
            ->where('status', 'queued')
            ->update([
                'status' => $status,
                'reason_code' => $anyDelivered ? null : 'all_channels_suppressed',
                'delivered_at' => $anyDelivered ? now() : null,
                'updated_at' => now(),
            ]);
        if ($updated === 1) {
            return;
        }
        $terminal = DB::table('event_reminder_schedules')
            ->where('tenant_id', $tenantId)
            ->where('id', $scheduleId)
            ->where('outbox_id', $outboxId)
            ->whereIn('status', ['delivered', 'suppressed', 'cancelled', 'superseded'])
            ->exists();
        if (! $terminal) {
            throw new RuntimeException('event_notification_reminder_schedule_completion_failed');
        }
    }

    /** @param array<string,mixed> $delivery */
    private function deliverInApp(
        EventReminderChannelDeliveryService $service,
        int $tenantId,
        int $userId,
        array $delivery,
        string $message,
        string $path,
        string $type,
    ): void {
        $claim = $service->claim($tenantId, (int) $delivery['id']);
        if ($claim === null) {
            return;
        }
        $deliveryId = (int) $claim['id'];
        $claimToken = (string) $claim['claim_token'];

        try {
            DB::transaction(function () use ($service, $tenantId, $userId, $deliveryId, $claimToken, $message, $path, $type): void {
                Notification::createNotification($userId, $message, $path, $type, false, $tenantId);
                if (! $service->markDelivered($tenantId, $deliveryId, $claimToken, 'database')) {
                    throw new RuntimeException('event_notification_in_app_ledger_completion_failed');
                }
            }, 3);
        } catch (Throwable $exception) {
            $service->markRetrying($tenantId, $deliveryId, $claimToken, $exception->getMessage());
        }
    }

    /** @param array<string,mixed> $delivery */
    private function deliverPush(
        EventReminderChannelDeliveryService $service,
        int $tenantId,
        int $userId,
        array $delivery,
        string $message,
        string $path,
        string $type,
    ): void {
        $preferences = User::getNotificationPreferences($userId);
        if (! filter_var($preferences['push_enabled'] ?? true, FILTER_VALIDATE_BOOL)) {
            $service->markSuppressed($tenantId, (int) $delivery['id'], 'push_disabled', 'push_enabled');
            return;
        }
        $hasWebPush = Schema::hasTable('push_subscriptions') && DB::table('push_subscriptions')
            ->where('tenant_id', $tenantId)->where('user_id', $userId)->exists();
        $hasFcm = Schema::hasTable('fcm_device_tokens') && DB::table('fcm_device_tokens')
            ->where('tenant_id', $tenantId)->where('user_id', $userId)->exists();
        if (! $hasWebPush && ! $hasFcm) {
            $service->markSuppressed($tenantId, (int) $delivery['id'], 'push_destination_missing');
            return;
        }

        $claim = $service->claim($tenantId, (int) $delivery['id']);
        if ($claim === null) {
            return;
        }
        $deliveryId = (int) $claim['id'];
        $claimToken = (string) $claim['claim_token'];
        try {
            NotificationDispatcher::fanOutPush($userId, $type, $message, $path);
            if (! $service->markDelivered($tenantId, $deliveryId, $claimToken, 'push_handoff')) {
                throw new RuntimeException('event_notification_push_ledger_completion_failed');
            }
        } catch (Throwable $exception) {
            $service->markRetrying($tenantId, $deliveryId, $claimToken, $exception->getMessage());
        }
    }

    /** @param array<string,mixed> $delivery */
    private function deliverWebPush(
        EventReminderChannelDeliveryService $service,
        int $tenantId,
        int $userId,
        array $delivery,
        string $title,
        string $message,
        string $path,
        string $type,
    ): void {
        $deliveryId = (int) $delivery['id'];
        $hasDestination = Schema::hasTable('push_subscriptions')
            && DB::table('push_subscriptions')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->exists();
        if (! $hasDestination) {
            $service->markSuppressed($tenantId, $deliveryId, 'web_push_destination_missing');
            return;
        }
        $claim = $service->claim($tenantId, $deliveryId);
        if ($claim === null) {
            return;
        }
        $token = (string) $claim['claim_token'];
        try {
            if (! WebPushService::sendToUserStatic($userId, $title, $message, $path, $type)) {
                throw new RuntimeException('event_notification_web_push_provider_rejected');
            }
            if (! $service->markDelivered($tenantId, $deliveryId, $token, 'web_push')) {
                throw new RuntimeException('event_notification_web_push_ledger_completion_failed');
            }
        } catch (Throwable $exception) {
            $service->markRetrying($tenantId, $deliveryId, $token, $exception->getMessage());
        }
    }

    /** @param array<string,mixed> $delivery */
    private function deliverFcm(
        EventReminderChannelDeliveryService $service,
        int $tenantId,
        int $userId,
        array $delivery,
        string $title,
        string $message,
        string $path,
        string $type,
    ): void {
        $deliveryId = (int) $delivery['id'];
        $hasDestination = Schema::hasTable('fcm_device_tokens')
            && DB::table('fcm_device_tokens')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->exists();
        if (! $hasDestination) {
            $service->markSuppressed($tenantId, $deliveryId, 'fcm_destination_missing');
            return;
        }
        $claim = $service->claim($tenantId, $deliveryId);
        if ($claim === null) {
            return;
        }
        $token = (string) $claim['claim_token'];
        try {
            $result = FCMPushService::sendToUser($userId, $title, $message, [
                'link' => $path,
                'type' => $type,
            ]);
            if ((int) ($result['sent'] ?? 0) < 1) {
                throw new RuntimeException('event_notification_fcm_provider_rejected');
            }
            if (! $service->markDelivered($tenantId, $deliveryId, $token, 'fcm')) {
                throw new RuntimeException('event_notification_fcm_ledger_completion_failed');
            }
        } catch (Throwable $exception) {
            $service->markRetrying($tenantId, $deliveryId, $token, $exception->getMessage());
        }
    }

    /** @param array<string,mixed> $delivery */
    private function deliverRealtime(
        EventReminderChannelDeliveryService $service,
        int $tenantId,
        int $userId,
        array $delivery,
        string $message,
        string $path,
        string $type,
    ): void {
        $deliveryId = (int) $delivery['id'];
        $pusher = app(PusherService::class);
        if (! $pusher->isConfigured()) {
            $service->markSuppressed($tenantId, $deliveryId, 'realtime_provider_unconfigured');
            return;
        }
        $claim = $service->claim($tenantId, $deliveryId);
        if ($claim === null) {
            return;
        }
        $token = (string) $claim['claim_token'];
        try {
            $sent = PusherService::trigger(
                PusherService::getUserChannel($userId),
                'event-notification',
                ['type' => $type, 'message' => $message, 'link' => $path],
            );
            if (! $sent) {
                throw new RuntimeException('event_notification_realtime_provider_rejected');
            }
            if (! $service->markDelivered($tenantId, $deliveryId, $token, 'pusher')) {
                throw new RuntimeException('event_notification_realtime_ledger_completion_failed');
            }
        } catch (Throwable $exception) {
            $service->markRetrying($tenantId, $deliveryId, $token, $exception->getMessage());
        }
    }

    /**
     * @param array<string,mixed> $outbox
     * @param array{kind:string,state:string,notification_type:string,offer_secret:bool} $descriptor
     * @param array<string,mixed> $delivery
     * @param array{subject:string,message:string,path:string,html:string} $rendered
     */
    private function deliverEmail(
        EventReminderChannelDeliveryService $service,
        array $outbox,
        array $descriptor,
        object $recipient,
        array $delivery,
        array $rendered,
    ): void {
        $tenantId = (int) $outbox['tenant_id'];
        $eventId = (int) $outbox['event_id'];
        $preferenceEventId = max(1, (int) ($descriptor['preference_event_id'] ?? $eventId));
        $userId = (int) $recipient->id;
        $deliveryId = (int) $delivery['id'];
        if (! EventNotificationPreferenceResolver::allowsEmail($userId, $tenantId)) {
            $service->markSuppressed($tenantId, $deliveryId, 'email_events_disabled', EventNotificationPreferenceResolver::EMAIL_PREFERENCE_KEY);
            return;
        }
        // Resolve cadence against the concrete event at dispatch time for every
        // Event email. An event/category/global `off` veto must not be bypassed
        // by lifecycle, registration, waitlist, staff, or update messages.
        $resolution = EventNotificationPreferenceResolver::resolveForEvent(
            $userId,
            $tenantId,
            $preferenceEventId,
        );
        $frequency = $resolution['cadence'];
        // Admin review alerts are operational mail: a pending event is waiting
        // on this admin's decision. The tenant/platform default cadence ('off'
        // out of the box, source 'tenant') expresses no choice by this admin
        // and must not silence or digest-delay the alert. Explicit member-level
        // cadence choices (event/category/global) and the email_events opt-out
        // above still win.
        if ($descriptor['notification_type'] === 'event_moderation'
            && ($descriptor['audience'] ?? null) === 'admin'
            && $resolution['cadence_source'] === 'tenant') {
            $frequency = 'instant';
        }
        if ($frequency === 'off') {
            $service->markSuppressed($tenantId, $deliveryId, 'email_frequency_off', 'frequency');
            return;
        }
        if ($descriptor['offer_secret'] && $frequency !== 'instant') {
            $service->markSuppressed($tenantId, $deliveryId, 'time_sensitive_offer_requires_instant_email', 'frequency');
            return;
        }
        $email = trim((string) ($recipient->email ?? ''));
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $service->markSuppressed($tenantId, $deliveryId, 'email_address_missing');
            return;
        }
        if (Mailer::isSuppressed($email)) {
            $service->markSuppressed($tenantId, $deliveryId, 'email_provider_suppressed');
            return;
        }

        $claim = $service->claim($tenantId, $deliveryId);
        if ($claim === null) {
            return;
        }
        $claimToken = (string) $claim['claim_token'];
        $deliveryKey = (string) $claim['delivery_key'];

        try {
            if ($frequency !== 'instant') {
                DB::transaction(function () use ($service, $tenantId, $eventId, $userId, $deliveryId, $claimToken, $deliveryKey, $frequency, $descriptor, $rendered): void {
                    DB::table('notification_queue')->insertOrIgnore([
                        'event_delivery_id' => $deliveryId,
                        'event_id' => $eventId,
                        'idempotency_key' => $deliveryKey,
                        'tenant_id' => $tenantId,
                        'user_id' => $userId,
                        'activity_type' => $descriptor['notification_type'],
                        'content_snippet' => mb_substr($rendered['message'], 0, 250),
                        'link' => $rendered['path'],
                        'frequency' => $frequency,
                        'email_body' => $rendered['html'],
                        'created_at' => now(),
                        'status' => 'pending',
                    ]);
                    if (! $service->markDelivered($tenantId, $deliveryId, $claimToken, 'notification_queue')) {
                        throw new RuntimeException('event_notification_email_queue_ledger_completion_failed');
                    }
                }, 3);
                return;
            }

            if ($this->successfulEmailEvidenceExists($tenantId, $userId, $deliveryKey)) {
                if (! $service->markDelivered($tenantId, $deliveryId, $claimToken, 'email_log')) {
                    throw new RuntimeException('event_notification_email_evidence_completion_failed');
                }
                if ($descriptor['offer_secret']) {
                    $this->completeOfferEnvelopeAfterDelivery((int) $outbox['id'], $deliveryKey);
                }
                return;
            }

            $html = $rendered['html'];
            $offerClaim = null;
            if ($descriptor['offer_secret']) {
                $offerClaim = ($this->offerEnvelope ?? new EventWaitlistOfferDeliveryEnvelope())
                    ->claimOrResume((int) $outbox['id'], $deliveryKey);
                $offerUrl = TenantContext::getFrontendUrl()
                    . TenantContext::getSlugPrefix()
                    . $rendered['path']
                    . '?waitlist_offer_token=' . rawurlencode($offerClaim->offerToken);
                $html = EmailTemplateBuilder::make()
                    ->theme('success')
                    ->title($rendered['subject'])
                    ->greeting((string) ($recipient->first_name ?? $recipient->name ?? __('emails.common.fallback_name')))
                    ->paragraph(htmlspecialchars($rendered['message'], ENT_QUOTES, 'UTF-8'))
                    ->button(__('event_notifications.accept_offer'), $offerUrl)
                    ->render();
            }

            $sent = EmailDispatchService::sendRaw(
                $email,
                $rendered['subject'],
                $html,
                null,
                null,
                EventNotificationPreferenceResolver::unsubscribeUrl($userId, $tenantId),
                self::EMAIL_CATEGORY,
                [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'idempotency_key' => $deliveryKey,
                    'source' => self::class,
                ],
            );
            if (! $sent) {
                throw new RuntimeException('event_notification_email_provider_rejected');
            }
            if (! $service->markDelivered($tenantId, $deliveryId, $claimToken, 'email')) {
                throw new RuntimeException('event_notification_email_ledger_completion_failed');
            }
            if ($offerClaim !== null) {
                ($this->offerEnvelope ?? new EventWaitlistOfferDeliveryEnvelope())->complete($offerClaim, $deliveryKey);
            }
        } catch (Throwable $exception) {
            $markedRetrying = $service->markRetrying(
                $tenantId,
                $deliveryId,
                $claimToken,
                EventNotificationErrorSanitizer::sanitize($exception->getMessage()),
            );
            if (! $markedRetrying
                && $descriptor['offer_secret']
                && DB::table('event_notification_deliveries')
                    ->where('id', $deliveryId)
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'delivered')
                    ->exists()) {
                throw new RuntimeException('event_waitlist_offer_handoff_completion_failed', 0, $exception);
            }
        }
    }

    private function completeOfferEnvelopeAfterDelivery(int $outboxId, string $deliveryKey): void
    {
        ($this->offerEnvelope ?? new EventWaitlistOfferDeliveryEnvelope())
            ->completeAfterDelivery($outboxId, $deliveryKey);
    }

    private function successfulEmailEvidenceExists(int $tenantId, int $userId, string $deliveryKey): bool
    {
        return Schema::hasTable('email_log')
            && Schema::hasColumn('email_log', 'idempotency_key')
            && DB::table('email_log')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('category', self::EMAIL_CATEGORY)
                ->where('idempotency_key', $deliveryKey)
                ->whereIn('status', ['sent', 'delivered'])
                ->exists();
    }

    private function successfulSensitiveExternalEmailEvidenceExists(
        int $tenantId,
        string $deliveryKey,
        string $externalRecipientHash,
    ): bool {
        return Schema::hasTable('email_log')
            && Schema::hasColumn('email_log', 'idempotency_key')
            && DB::table('email_log')
                ->where('tenant_id', $tenantId)
                ->whereNull('user_id')
                ->where('recipient_email', 'external:' . $externalRecipientHash)
                ->where('category', Mailer::CATEGORY_SAFEGUARDING)
                ->where('idempotency_key', $deliveryKey)
                ->whereIn('status', ['sent', 'delivered'])
                ->exists();
    }
}
