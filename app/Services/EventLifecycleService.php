<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventNotificationDeliveryMode;
use App\Enums\EventOperationalState;
use App\Enums\EventPublicationState;
use App\Events\CommunityEventCreated;
use App\Exceptions\EventLifecycleTransitionException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventLifecycleCompatibility;
use App\Support\Events\EventLifecycleTransitionContext;
use App\Support\Events\EventLifecycleTransitionGuard;
use App\Support\Events\EventLifecycleTransitionResult;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use UnexpectedValueException;

/**
 * Serialized write boundary for Event publication and operational lifecycle.
 *
 * Every real transition updates both canonical axes and the temporary legacy
 * mirror, appends one immutable history row, and records one transactional
 * outbox event before the transaction commits.
 */
final class EventLifecycleService
{
    private const OUTBOX_ACTION = 'event.lifecycle.transitioned';
    private const MAX_REASON_LENGTH = 4000;

    /** @var list<string> */
    private const ACTIVE_REGISTRATION_STATUSES = [
        'going',
        'interested',
        'maybe',
        'invited',
        'waitlisted',
    ];

    private readonly EventPolicy $policy;
    private readonly EventDomainOutboxService $outbox;
    private readonly EventRegistrationService $registrations;
    private readonly EventWaitlistService $waitlist;
    private readonly EventReminderScheduleService $reminderSchedules;
    private readonly EventFederationPublisher $federation;

    public function __construct(
        ?EventPolicy $policy = null,
        ?EventDomainOutboxService $outbox = null,
        ?EventRegistrationService $registrations = null,
        ?EventWaitlistService $waitlist = null,
        ?EventReminderScheduleService $reminderSchedules = null,
        ?EventFederationPublisher $federation = null,
    ) {
        $this->policy = $policy ?? new EventPolicy();
        $this->outbox = $outbox ?? new EventDomainOutboxService();
        $this->registrations = $registrations ?? new EventRegistrationService();
        $this->waitlist = $waitlist ?? new EventWaitlistService($this->registrations);
        $this->reminderSchedules = $reminderSchedules ?? app(EventReminderScheduleService::class);
        $this->federation = $federation ?? app(EventFederationPublisher::class);
    }

    public function transition(
        int $eventId,
        User $actor,
        ?EventPublicationState $publication = null,
        ?EventOperationalState $operational = null,
        ?string $reason = null,
        ?EventLifecycleTransitionGuard $guard = null,
        ?EventLifecycleTransitionContext $context = null,
    ): EventLifecycleTransitionResult {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventLifecycleTransitionException('event_lifecycle_tenant_context_missing');
        }
        if ($eventId <= 0 || (int) $actor->getKey() <= 0) {
            throw new EventLifecycleTransitionException('event_lifecycle_subject_invalid');
        }
        if ($publication === null && $operational === null) {
            throw new EventLifecycleTransitionException('event_lifecycle_target_missing');
        }

        $reason = $this->normalizeReason($reason);

        $result = TenantContext::runForTenant(
            $tenantId,
            fn (): EventLifecycleTransitionResult => DB::transaction(function () use (
                $tenantId,
                $eventId,
                $actor,
                $publication,
                $operational,
                $reason,
                $guard,
                $context,
            ): EventLifecycleTransitionResult {
            /** @var Event|null $event */
            $event = Event::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($eventId)
                ->lockForUpdate()
                ->first();
            if ($event === null) {
                throw new EventLifecycleTransitionException('event_lifecycle_event_not_found');
            }

            /** @var User|null $persistedActor */
            $persistedActor = User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey((int) $actor->getKey())
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->first();
            if ($persistedActor === null || ! $this->policy->manage($persistedActor, $event)) {
                throw new EventLifecycleTransitionException('event_lifecycle_authorization_denied');
            }

            $fromLegacyStatus = $this->normalizedLegacyForHistory(
                $event->getRawOriginal('status'),
            );
            try {
                $current = EventLifecycleCompatibility::resolve(
                    $this->nullableString($event->getRawOriginal('publication_status')),
                    $this->nullableString($event->getRawOriginal('operational_status')),
                    $this->nullableString($event->getRawOriginal('status')),
                );
            } catch (UnexpectedValueException $exception) {
                throw new EventLifecycleTransitionException($exception->getMessage());
            }

            $fromPublication = $current['publication'];
            $fromOperational = $current['operational'];
            $toPublication = $publication ?? $fromPublication;
            $toOperational = $operational ?? $fromOperational;
            $publicationChanged = $toPublication !== $fromPublication;
            $operationalChanged = $toOperational !== $fromOperational;

            if ($guard !== null && ! $guard->allowsPublication($fromPublication)) {
                throw new EventLifecycleTransitionException('event_lifecycle_publication_source_invalid');
            }
            if ($guard !== null && ! $guard->allowsOperational($fromOperational)) {
                throw new EventLifecycleTransitionException('event_lifecycle_operational_source_invalid');
            }

            if (! $publicationChanged && ! $operationalChanged) {
                return new EventLifecycleTransitionResult($event, false, null, null);
            }
            if ($publicationChanged && ! $fromPublication->canTransitionTo($toPublication)) {
                throw new EventLifecycleTransitionException('event_lifecycle_publication_transition_invalid');
            }
            if ($operationalChanged && ! $fromOperational->canTransitionTo($toOperational)) {
                throw new EventLifecycleTransitionException('event_lifecycle_operational_transition_invalid');
            }

            try {
                EventLifecycleCompatibility::assertCompatible($toPublication, $toOperational);
                $legacyStatus = EventLifecycleCompatibility::legacyMirror($toPublication, $toOperational);
            } catch (UnexpectedValueException $exception) {
                throw new EventLifecycleTransitionException($exception->getMessage());
            }

            $terminalParticipantState = ($operationalChanged
                    && $toOperational === EventOperationalState::Cancelled)
                || ($publicationChanged
                    && $toPublication === EventPublicationState::Archived);
            $hasParticipantState = $terminalParticipantState
                && $this->hasParticipantState($tenantId, $eventId);
            $requiresTerminalReason = $terminalParticipantState
                && ($toOperational === EventOperationalState::Cancelled
                    || $fromPublication === EventPublicationState::Published
                    || $hasParticipantState);
            if ($requiresTerminalReason && $reason === null) {
                throw new EventLifecycleTransitionException('event_lifecycle_reason_required');
            }

            $currentVersion = $this->lifecycleVersion($event->getRawOriginal('lifecycle_version'));
            $nextVersion = $currentVersion + 1;
            $publicationBecamePublished = $publicationChanged
                && $toPublication === EventPublicationState::Published
                && ! DB::table('event_status_history')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->where(static function ($query): void {
                        $query->where('from_publication_status', EventPublicationState::Published->value)
                            ->orWhere('to_publication_status', EventPublicationState::Published->value);
                    })
                    ->exists();
            $now = now();
            $actorId = (int) $persistedActor->getKey();
            $federationAvailable = Schema::hasColumn('events', 'federation_version')
                && Schema::hasTable('event_federation_deliveries')
                && Schema::hasTable('federation_external_partners');
            $updates = [
                'publication_status' => $toPublication->value,
                'operational_status' => $toOperational->value,
                'lifecycle_version' => $nextVersion,
                'lifecycle_reason' => $reason,
                'status' => $legacyStatus,
                'updated_at' => $now,
            ];
            if ($federationAvailable) {
                $updates['federation_version'] = max(
                    1,
                    (int) ($event->getRawOriginal('federation_version') ?? 1),
                ) + 1;
            }

            if ($publicationChanged) {
                $updates['publication_status_changed_at'] = $now;
                $updates['publication_status_changed_by'] = $actorId;
                if ($toPublication === EventPublicationState::PendingReview) {
                    $updates['moderation_submitted_at'] = $now;
                    $updates['moderation_submitted_by'] = $actorId;
                }
                if ($fromPublication === EventPublicationState::PendingReview) {
                    $updates['moderated_at'] = $now;
                    $updates['moderated_by'] = $actorId;
                    $updates['moderation_reason'] = $reason;
                }
            }

            if ($operationalChanged) {
                $updates['operational_status_changed_at'] = $now;
                $updates['operational_status_changed_by'] = $actorId;
                if ($toOperational === EventOperationalState::Cancelled) {
                    $updates['cancelled_at'] = $now;
                    $updates['cancelled_by'] = $actorId;
                    $updates['cancellation_reason'] = $reason;
                } elseif ($fromOperational === EventOperationalState::Cancelled) {
                    $updates['cancelled_at'] = null;
                    $updates['cancelled_by'] = null;
                    $updates['cancellation_reason'] = null;
                }
            }

            $event->forceFill($updates);
            $event->save();

            $cascade = [
                'reminders_cancelled' => 0,
                'waitlist_cancelled' => 0,
                'registrations_cancelled' => 0,
            ];
            $affectedRecipientUserIds = [];
            if ($requiresTerminalReason) {
                $cancellation = $this->cancelDependentState(
                    $event,
                    $persistedActor,
                    (string) $reason,
                    "lifecycle:v{$nextVersion}",
                    $now,
                );
                $cascade = $cancellation['cascade'];
                $affectedRecipientUserIds = $cancellation['recipient_user_ids'];
            } elseif ($operationalChanged
                && $toOperational === EventOperationalState::Postponed) {
                $cascade['reminders_cancelled'] += $this->reminderSchedules->closeForEvent(
                    $eventId,
                    'superseded',
                    'event_postponed',
                );
            } elseif ($operationalChanged
                && $toOperational === EventOperationalState::Completed) {
                $cascade['reminders_cancelled'] += $this->reminderSchedules->closeForEvent(
                    $eventId,
                    'cancelled',
                    'event_completed',
                );
            }

            $axesChanged = [];
            if ($publicationChanged) {
                $axesChanged[] = 'publication';
            }
            if ($operationalChanged) {
                $axesChanged[] = 'operational';
            }
            $metadata = [
                'schema_version' => 1,
                'source' => 'event_lifecycle_service',
                'axes_changed' => $axesChanged,
                'cascade' => $cascade,
            ];
            if ($context !== null) {
                $metadata = array_merge($metadata, $context->metadataFor($eventId));
            }
            $historyId = (int) DB::table('event_status_history')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'actor_user_id' => $actorId,
                'lifecycle_version' => $nextVersion,
                'from_publication_status' => $fromPublication->value,
                'to_publication_status' => $toPublication->value,
                'from_operational_status' => $fromOperational->value,
                'to_operational_status' => $toOperational->value,
                'from_legacy_status' => $fromLegacyStatus,
                'to_legacy_status' => $legacyStatus,
                'reason' => $reason,
                'metadata' => json_encode($metadata, JSON_THROW_ON_ERROR),
                'created_at' => $now,
            ]);

            $outbox = $this->outbox->record(
                $tenantId,
                $eventId,
                $nextVersion,
                self::OUTBOX_ACTION,
                "event:{$tenantId}:{$eventId}:lifecycle:v{$nextVersion}",
                [
                    'schema_version' => 1,
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'actor_user_id' => $actorId,
                    'organizer_user_id' => (int) $event->getAttribute('user_id'),
                    'affected_recipient_user_ids' => $affectedRecipientUserIds,
                    'lifecycle_version' => $nextVersion,
                    'publication' => [
                        'from' => $fromPublication->value,
                        'to' => $toPublication->value,
                    ],
                    'operational' => [
                        'from' => $fromOperational->value,
                        'to' => $toOperational->value,
                    ],
                    'legacy_status' => $legacyStatus,
                    'publication_became_published' => $publicationBecamePublished,
                    'reason' => $reason,
                    'metadata' => $metadata,
                    'occurred_at' => $now->toIso8601String(),
                ],
                // Publication/moderation has no single complete legacy direct
                // sender. Upgrade every real transition to Published, plus
                // submit/reject, so tenant delivery-mode overrides cannot
                // change the recipient audience or leave the organizer silent.
                $publicationChanged && (
                    $toPublication === EventPublicationState::Published
                    || $toPublication === EventPublicationState::PendingReview
                    || ($fromPublication === EventPublicationState::PendingReview
                        && in_array($toPublication, [
                            EventPublicationState::Draft,
                        ], true))
                )
                    ? EventNotificationDeliveryMode::OutboxAuthoritative
                    : null,
            );

            // This ledger is transactionally independent from notification
            // delivery. Neither consumer can claim or acknowledge the other.
            if ($federationAvailable) {
                $this->federation->publish($event);
            }

            return new EventLifecycleTransitionResult(
                $event,
                true,
                $historyId,
                (int) $outbox['id'],
                $affectedRecipientUserIds,
                $cascade,
                $publicationBecamePublished,
                (string) $outbox['production_mode'],
            );
            }, 3),
        );

        $this->dispatchPublicationSideEffectsAfterCommit(
            $result,
            $tenantId,
            $eventId,
            $context?->suppressNotifications ?? false,
        );

        return $result;
    }

    /**
     * @return array{
     *   cascade:array{reminders_cancelled:int,waitlist_cancelled:int,registrations_cancelled:int},
     *   recipient_user_ids:list<int>
     * }
     */
    private function cancelDependentState(
        Event $event,
        User $actor,
        string $reason,
        string $idempotencyPrefix,
        mixed $now,
    ): array
    {
        $tenantId = (int) $event->tenant_id;
        $eventId = (int) $event->getKey();
        $registrationRecipients = DB::table('event_rsvps')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereIn('status', self::ACTIVE_REGISTRATION_STATUSES)
            ->lockForUpdate()
            ->pluck('user_id');
        $waitlistRecipients = DB::table('event_waitlist')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('status', 'waiting')
            ->lockForUpdate()
            ->pluck('user_id');

        $canonicalRegistrations = $this->registrations
            ->cancelActiveForLifecycleWithinTransaction(
                $event,
                $actor,
                $reason,
                $idempotencyPrefix,
            );
        $canonicalWaitlist = $this->waitlist
            ->cancelActiveForLifecycleWithinTransaction(
                $event,
                $actor,
                $reason,
                $idempotencyPrefix,
            );

        $remainingRemindersCancelled = $this->reminderSchedules->closeForEvent(
            $eventId,
            'cancelled',
            'event_unavailable',
        );

        // Not-yet-sent broadcasts die with the event. Reminders, registrations
        // and the waitlist were already cascaded here; broadcasts were not, so
        // an announcement scheduled before the cancellation still reached
        // attendees afterwards. Anything already in flight is skipped, never
        // allowed to block the cancellation itself.
        $broadcastCascade = app(EventBroadcastService::class)
            ->cancelPendingForLifecycleWithinTransaction(
                $event,
                $actor,
                $reason,
                $idempotencyPrefix,
            );
        $legacyWaitlistCancelled = DB::table('event_waitlist')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('status', 'waiting')
            ->update([
                'status' => 'cancelled',
                'cancelled_at' => $now,
                'updated_at' => $now,
            ]);
        $legacyRegistrationsCancelled = DB::table('event_rsvps')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereIn('status', self::ACTIVE_REGISTRATION_STATUSES)
            ->update(['status' => 'cancelled', 'updated_at' => $now]);

        $recipientIds = $registrationRecipients
            ->merge($waitlistRecipients)
            ->merge($canonicalRegistrations['recipient_user_ids'])
            ->merge($canonicalWaitlist['recipient_user_ids'])
            ->map(static fn (mixed $id): int => (int) $id)
            ->filter(static fn (int $id): bool => $id > 0)
            ->unique()
            ->values()
            ->all();

        return [
            'cascade' => [
                'reminders_cancelled' => $canonicalRegistrations['reminders_cancelled']
                    + $remainingRemindersCancelled,
                'waitlist_cancelled' => $canonicalWaitlist['cancelled']
                    + $legacyWaitlistCancelled,
                'registrations_cancelled' => $canonicalRegistrations['cancelled']
                    + $legacyRegistrationsCancelled,
                'broadcasts_cancelled' => $broadcastCascade['cancelled'],
                'broadcast_deliveries_cancelled' => $broadcastCascade['deliveries_cancelled'],
                'broadcasts_skipped_in_flight' => $broadcastCascade['skipped_in_flight'],
            ],
            'recipient_user_ids' => $recipientIds,
        ];
    }

    private function hasParticipantState(int $tenantId, int $eventId): bool
    {
        return DB::table('event_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereIn('registration_state', ['invited', 'pending', 'confirmed'])
            ->exists()
            || DB::table('event_waitlist_entries')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereIn('queue_state', ['waiting', 'offered'])
                ->exists()
            || DB::table('event_rsvps')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereIn('status', self::ACTIVE_REGISTRATION_STATUSES)
                ->exists()
            || DB::table('event_waitlist')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('status', 'waiting')
                ->exists()
            || DB::table('event_reminders')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('status', 'pending')
                ->exists();
    }

    private function dispatchPublicationSideEffectsAfterCommit(
        EventLifecycleTransitionResult $result,
        int $tenantId,
        int $eventId,
        bool $suppressed = false,
    ): void {
        if ($suppressed || ! $result->changed || ! $result->publicationBecamePublished) {
            return;
        }
        if (! in_array($result->deliveryMode, [
            EventNotificationDeliveryMode::Direct->value,
            EventNotificationDeliveryMode::ShadowOutbox->value,
        ], true)) {
            return;
        }

        DB::afterCommit(static function () use ($tenantId, $eventId): void {
            try {
                TenantContext::runForTenant($tenantId, static function () use ($tenantId, $eventId): void {
                    $event = Event::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->whereKey($eventId)
                        ->first();
                    if ($event !== null) {
                        CommunityEventCreated::dispatch($event, $tenantId);
                    }
                });
            } catch (\Throwable $exception) {
                Log::warning('Event lifecycle publication side-effect dispatch failed', [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'error' => $exception->getMessage(),
                ]);
            }
        });
    }

    private function normalizeReason(?string $reason): ?string
    {
        if ($reason === null) {
            return null;
        }

        $reason = trim($reason);
        if ($reason === '') {
            return null;
        }
        if (mb_strlen($reason) > self::MAX_REASON_LENGTH) {
            throw new EventLifecycleTransitionException('event_lifecycle_reason_too_long');
        }

        return $reason;
    }

    private function lifecycleVersion(mixed $version): int
    {
        if ($version === null || $version === '') {
            return 0;
        }
        if (! is_numeric($version) || (int) $version < 0) {
            throw new EventLifecycleTransitionException('event_lifecycle_version_invalid');
        }

        return (int) $version;
    }

    private function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            throw new EventLifecycleTransitionException('event_lifecycle_storage_type_invalid');
        }

        return $value;
    }

    private function normalizedLegacyForHistory(mixed $value): string
    {
        return $value === null ? 'active' : strtolower(trim((string) $value));
    }
}
