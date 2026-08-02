<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventBroadcastAction;
use App\Enums\EventBroadcastAudienceSegment;
use App\Enums\EventBroadcastChannel;
use App\Enums\EventBroadcastDeliveryStatus;
use App\Enums\EventBroadcastStatus;
use App\Enums\EventBroadcastVariant;
use App\Exceptions\EventBroadcastException;
use App\Models\Event;
use App\Models\EventBroadcast;
use App\Models\EventBroadcastHistory;
use App\Models\User;
use App\Support\Events\EventBroadcastFoundationSupport;
use BackedEnum;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/** Versioned organizer workflow and transactional recipient-outbox producer. */
final class EventBroadcastService
{
    public function __construct(
        private readonly EventBroadcastAudienceResolver $audiences,
        private readonly EventBroadcastFoundationSupport $support = new EventBroadcastFoundationSupport(),
    ) {
    }

    /**
     * @param list<EventBroadcastAudienceSegment|string> $segments
     * @param list<EventBroadcastChannel|string> $channels
     * @return array<string,mixed>
     */
    public function preview(
        int $eventId,
        User|int $actor,
        EventBroadcastVariant|string $variant,
        array $segments,
        array $channels,
    ): array {
        $this->support->assertSchema();
        $tenantId = $this->support->tenantId();
        $this->support->assertCreationEnabled($tenantId);
        $event = $this->support->event($tenantId, $eventId);
        $persistedActor = $this->support->actor($tenantId, $actor);
        $this->support->authorize($persistedActor, $event);
        $normalizedVariant = $this->variant($variant);
        $normalizedSegments = $this->segments($segments, $normalizedVariant);
        $normalizedChannels = $this->channels($channels);
        $audience = $this->audiences->resolve($event, $normalizedSegments);

        return [
            'contract_version' => 1,
            'event_id' => $eventId,
            'variant' => $normalizedVariant->value,
            'segments' => $this->values($normalizedSegments),
            'channels' => $this->values($normalizedChannels),
            'recipient_count' => $audience['recipient_count'],
            'delivery_count' => $audience['recipient_count'] * count($normalizedChannels),
            'segment_counts' => $audience['segment_counts'],
            'generated_at' => CarbonImmutable::now('UTC')->toIso8601String(),
        ];
    }

    /**
     * @param list<EventBroadcastAudienceSegment|string> $segments
     * @param list<EventBroadcastChannel|string> $channels
     * @return array{broadcast:EventBroadcast,changed:bool}
     */
    public function createDraft(
        int $eventId,
        User|int $actor,
        EventBroadcastVariant|string $variant,
        array $segments,
        array $channels,
        string $body,
        string $idempotencyKey,
    ): array {
        $this->support->assertSchema();
        $tenantId = $this->support->tenantId();
        $this->support->assertCreationEnabled($tenantId);
        $normalizedVariant = $this->variant($variant);
        $normalizedSegments = $this->segments($segments, $normalizedVariant);
        $normalizedChannels = $this->channels($channels);
        $body = $this->support->body($body);
        $contentHash = hash('sha256', $body);
        $keyHash = $this->support->idempotencyHash($idempotencyKey);
        $requestHash = null;

        try {
            return DB::transaction(function () use (
                $tenantId,
                $eventId,
                $actor,
                $normalizedVariant,
                $normalizedSegments,
                $normalizedChannels,
                $body,
                $contentHash,
                $keyHash,
                &$requestHash,
            ): array {
                $event = $this->support->event($tenantId, $eventId, true);
                $persistedActor = $this->support->actor($tenantId, $actor, true);
                $this->support->authorize($persistedActor, $event);
                $requestHash = $this->support->requestHash([
                    'action' => EventBroadcastAction::Created->value,
                    'event_id' => $eventId,
                    'actor_user_id' => (int) $persistedActor->id,
                    'variant' => $normalizedVariant->value,
                    'segments' => $this->values($normalizedSegments),
                    'channels' => $this->values($normalizedChannels),
                    'content_hash' => $contentHash,
                ]);
                $replay = $this->historyReplay(
                    $tenantId,
                    $keyHash,
                    EventBroadcastAction::Created,
                    $requestHash,
                    true,
                );
                if ($replay !== null) {
                    return [
                        'broadcast' => $this->broadcastModel($tenantId, (int) $replay->broadcast_id),
                        'changed' => false,
                    ];
                }

                $now = CarbonImmutable::now('UTC');
                $broadcastId = (int) DB::table('event_broadcasts')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'occurrence_key' => (string) $event->getRawOriginal('occurrence_key'),
                    'variant' => $normalizedVariant->value,
                    'status' => EventBroadcastStatus::Draft->value,
                    'broadcast_version' => 1,
                    'audience_segments' => json_encode($this->values($normalizedSegments), JSON_THROW_ON_ERROR),
                    'channels' => json_encode($this->values($normalizedChannels), JSON_THROW_ON_ERROR),
                    'body' => $body,
                    'content_hash' => $contentHash,
                    'created_by_user_id' => (int) $persistedActor->id,
                    'updated_by_user_id' => (int) $persistedActor->id,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $this->insertHistory(
                    $tenantId,
                    $eventId,
                    $broadcastId,
                    1,
                    EventBroadcastAction::Created,
                    null,
                    EventBroadcastStatus::Draft,
                    (int) $persistedActor->id,
                    $keyHash,
                    $requestHash,
                    $contentHash,
                    [
                        'contract_version' => 1,
                        'variant' => $normalizedVariant->value,
                        'segments' => $this->values($normalizedSegments),
                        'channels' => $this->values($normalizedChannels),
                    ],
                    $now,
                );

                return [
                    'broadcast' => $this->broadcastModel($tenantId, $broadcastId),
                    'changed' => true,
                ];
            }, 3);
        } catch (QueryException $exception) {
            return $this->recoverReplay(
                $exception,
                $tenantId,
                $keyHash,
                EventBroadcastAction::Created,
                $requestHash,
            );
        }
    }

    /**
     * @param list<EventBroadcastAudienceSegment|string> $segments
     * @param list<EventBroadcastChannel|string> $channels
     * @return array{broadcast:EventBroadcast,changed:bool}
     */
    public function reviseDraft(
        int $broadcastId,
        User|int $actor,
        int $expectedVersion,
        EventBroadcastVariant|string $variant,
        array $segments,
        array $channels,
        string $body,
        string $idempotencyKey,
    ): array {
        $this->support->assertSchema();
        $tenantId = $this->support->tenantId();
        $this->support->assertCreationEnabled($tenantId);
        $normalizedVariant = $this->variant($variant);
        $normalizedSegments = $this->segments($segments, $normalizedVariant);
        $normalizedChannels = $this->channels($channels);
        $body = $this->support->body($body);
        $contentHash = hash('sha256', $body);
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $broadcastId,
            $actor,
            $expectedVersion,
            $normalizedVariant,
            $normalizedSegments,
            $normalizedChannels,
            $body,
            $contentHash,
            $keyHash,
        ): array {
            $broadcast = $this->broadcast($tenantId, $broadcastId, true);
            $event = $this->support->event($tenantId, (int) $broadcast->event_id, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorize($persistedActor, $event);
            $requestHash = $this->support->requestHash([
                'action' => EventBroadcastAction::Revised->value,
                'broadcast_id' => $broadcastId,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
                'variant' => $normalizedVariant->value,
                'segments' => $this->values($normalizedSegments),
                'channels' => $this->values($normalizedChannels),
                'content_hash' => $contentHash,
            ]);
            $replay = $this->historyReplay(
                $tenantId,
                $keyHash,
                EventBroadcastAction::Revised,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return ['broadcast' => $this->broadcastModel($tenantId, $broadcastId), 'changed' => false];
            }
            $this->assertVersionAndStatus(
                $broadcast,
                $expectedVersion,
                [EventBroadcastStatus::Draft],
            );

            $newVersion = $expectedVersion + 1;
            $now = CarbonImmutable::now('UTC');
            $updated = DB::table('event_broadcasts')
                ->where('tenant_id', $tenantId)
                ->where('id', $broadcastId)
                ->where('status', EventBroadcastStatus::Draft->value)
                ->where('broadcast_version', $expectedVersion)
                ->update([
                    'variant' => $normalizedVariant->value,
                    'broadcast_version' => $newVersion,
                    'audience_segments' => json_encode($this->values($normalizedSegments), JSON_THROW_ON_ERROR),
                    'channels' => json_encode($this->values($normalizedChannels), JSON_THROW_ON_ERROR),
                    'body' => $body,
                    'content_hash' => $contentHash,
                    'updated_by_user_id' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                throw new EventBroadcastException('event_broadcast_version_conflict');
            }
            $this->insertHistory(
                $tenantId,
                (int) $broadcast->event_id,
                $broadcastId,
                $newVersion,
                EventBroadcastAction::Revised,
                EventBroadcastStatus::Draft,
                EventBroadcastStatus::Draft,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                $contentHash,
                [
                    'contract_version' => 1,
                    'variant' => $normalizedVariant->value,
                    'segments' => $this->values($normalizedSegments),
                    'channels' => $this->values($normalizedChannels),
                ],
                $now,
            );

            return ['broadcast' => $this->broadcastModel($tenantId, $broadcastId), 'changed' => true];
        }, 3);
    }

    /** @return array{broadcast:EventBroadcast,changed:bool} */
    public function schedule(
        int $broadcastId,
        User|int $actor,
        int $expectedVersion,
        ?DateTimeInterface $scheduledAt,
        string $idempotencyKey,
    ): array {
        $this->support->assertSchema();
        $tenantId = $this->support->tenantId();
        $this->support->assertCreationEnabled($tenantId);
        $requestedSchedule = $scheduledAt === null
            ? null
            : CarbonImmutable::instance($scheduledAt)->utc();
        $effectiveSchedule = $requestedSchedule ?? CarbonImmutable::now('UTC');
        if ($effectiveSchedule->lessThan(CarbonImmutable::now('UTC')->subMinute())) {
            throw new EventBroadcastException('event_broadcast_schedule_in_past');
        }
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $broadcastId,
            $actor,
            $expectedVersion,
            $requestedSchedule,
            $effectiveSchedule,
            $keyHash,
        ): array {
            $broadcast = $this->broadcast($tenantId, $broadcastId, true);
            $event = $this->support->event($tenantId, (int) $broadcast->event_id, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorize($persistedActor, $event);
            $requestHash = $this->support->requestHash([
                'action' => EventBroadcastAction::Scheduled->value,
                'broadcast_id' => $broadcastId,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
                'scheduled_at' => $requestedSchedule?->toIso8601String() ?? 'immediate',
            ]);
            $replay = $this->historyReplay(
                $tenantId,
                $keyHash,
                EventBroadcastAction::Scheduled,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return ['broadcast' => $this->broadcastModel($tenantId, $broadcastId), 'changed' => false];
            }
            $this->assertVersionAndStatus(
                $broadcast,
                $expectedVersion,
                [EventBroadcastStatus::Draft],
            );
            $variant = EventBroadcastVariant::from((string) $broadcast->getRawOriginal('variant'));
            $segments = $this->segments((array) $broadcast->audience_segments, $variant);
            $channels = $this->channels((array) $broadcast->channels);
            $this->assertScheduleEligible($event, $variant, $effectiveSchedule);
            $audience = $this->audiences->resolve($event, $segments);
            if ($audience['recipient_count'] < 1) {
                throw new EventBroadcastException('event_broadcast_audience_empty');
            }

            $newVersion = $expectedVersion + 1;
            $deliveryCount = $audience['recipient_count'] * count($channels);
            $now = CarbonImmutable::now('UTC');
            $updated = DB::table('event_broadcasts')
                ->where('tenant_id', $tenantId)
                ->where('id', $broadcastId)
                ->where('status', EventBroadcastStatus::Draft->value)
                ->where('broadcast_version', $expectedVersion)
                ->update([
                    'status' => EventBroadcastStatus::Scheduled->value,
                    'broadcast_version' => $newVersion,
                    'scheduled_at' => $effectiveSchedule,
                    'recipient_count' => $audience['recipient_count'],
                    'delivery_count' => $deliveryCount,
                    'scheduled_by_user_id' => (int) $persistedActor->id,
                    'updated_by_user_id' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                throw new EventBroadcastException('event_broadcast_version_conflict');
            }
            $this->insertDeliveries(
                $tenantId,
                (int) $broadcast->event_id,
                $broadcastId,
                $newVersion,
                $audience['recipient_ids'],
                $channels,
                $effectiveSchedule,
                $now,
            );
            $this->insertHistory(
                $tenantId,
                (int) $broadcast->event_id,
                $broadcastId,
                $newVersion,
                EventBroadcastAction::Scheduled,
                EventBroadcastStatus::Draft,
                EventBroadcastStatus::Scheduled,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                (string) $broadcast->content_hash,
                [
                    'contract_version' => 1,
                    'recipient_count' => $audience['recipient_count'],
                    'delivery_count' => $deliveryCount,
                    'segment_counts' => $audience['segment_counts'],
                    'segments' => $this->values($segments),
                    'channels' => $this->values($channels),
                    'scheduled_at' => $effectiveSchedule->toIso8601String(),
                ],
                $now,
            );

            return ['broadcast' => $this->broadcastModel($tenantId, $broadcastId), 'changed' => true];
        }, 3);
    }

    /** @return array{broadcast:EventBroadcast,changed:bool} */
    public function cancel(
        int $broadcastId,
        User|int $actor,
        int $expectedVersion,
        string $reason,
        string $idempotencyKey,
    ): array {
        $this->support->assertSchema();
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason) > 500) {
            throw new EventBroadcastException('event_broadcast_cancel_reason_invalid');
        }
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $broadcastId,
            $actor,
            $expectedVersion,
            $reason,
            $keyHash,
        ): array {
            $broadcast = $this->broadcast($tenantId, $broadcastId, true);
            $event = $this->support->event($tenantId, (int) $broadcast->event_id, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorize($persistedActor, $event);
            $requestHash = $this->support->requestHash([
                'action' => EventBroadcastAction::Cancelled->value,
                'broadcast_id' => $broadcastId,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
                'reason' => $reason,
            ]);
            $replay = $this->historyReplay(
                $tenantId,
                $keyHash,
                EventBroadcastAction::Cancelled,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return ['broadcast' => $this->broadcastModel($tenantId, $broadcastId), 'changed' => false];
            }
            $from = EventBroadcastStatus::from((string) $broadcast->getRawOriginal('status'));
            $this->assertVersionAndStatus(
                $broadcast,
                $expectedVersion,
                [EventBroadcastStatus::Draft, EventBroadcastStatus::Scheduled],
            );
            $started = DB::table('event_broadcast_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('broadcast_id', $broadcastId)
                ->whereIn('status', [
                    EventBroadcastDeliveryStatus::Processing->value,
                    EventBroadcastDeliveryStatus::Delivered->value,
                ])
                ->exists();
            if ($started) {
                throw new EventBroadcastException('event_broadcast_cancel_after_send_forbidden');
            }

            $newVersion = $expectedVersion + 1;
            $now = CarbonImmutable::now('UTC');
            $updated = DB::table('event_broadcasts')
                ->where('tenant_id', $tenantId)
                ->where('id', $broadcastId)
                ->where('status', $from->value)
                ->where('broadcast_version', $expectedVersion)
                ->update([
                    'status' => EventBroadcastStatus::Cancelled->value,
                    'broadcast_version' => $newVersion,
                    'cancelled_by_user_id' => (int) $persistedActor->id,
                    'cancelled_at' => $now,
                    'updated_by_user_id' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                throw new EventBroadcastException('event_broadcast_version_conflict');
            }
            $cancelledDeliveries = DB::table('event_broadcast_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('broadcast_id', $broadcastId)
                ->whereIn('status', [
                    EventBroadcastDeliveryStatus::Pending->value,
                    EventBroadcastDeliveryStatus::Retry->value,
                ])
                ->update([
                    'status' => EventBroadcastDeliveryStatus::Cancelled->value,
                    'cancelled_at' => $now,
                    'claim_token' => null,
                    'claimed_at' => null,
                    'next_attempt_at' => null,
                    'updated_at' => $now,
                ]);
            $this->insertHistory(
                $tenantId,
                (int) $broadcast->event_id,
                $broadcastId,
                $newVersion,
                EventBroadcastAction::Cancelled,
                $from,
                EventBroadcastStatus::Cancelled,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                (string) $broadcast->content_hash,
                [
                    'contract_version' => 1,
                    'reason_recorded' => true,
                    'cancelled_delivery_count' => $cancelledDeliveries,
                ],
                $now,
            );

            return ['broadcast' => $this->broadcastModel($tenantId, $broadcastId), 'changed' => true];
        }, 3);
    }

    /**
     * Cancel this event's not-yet-sent broadcasts because the event itself is
     * being cancelled.
     *
     * Sibling of EventRegistrationService/EventWaitlistService's
     * cancelActiveForLifecycleWithinTransaction, and called from the same
     * cascade. Without it a broadcast scheduled before the cancellation still
     * went out afterwards, telling attendees about an event that is no longer
     * happening — registrations, waitlist and reminders were all being
     * cancelled correctly; broadcasts were simply missed.
     *
     * Differs from cancel() in three deliberate ways, because this runs as a
     * cascade rather than an operator action: it takes no expected version
     * (it reads each row's current one under lock), it never authorises
     * against the actor (the caller has already authorised cancelling the
     * whole event), and a broadcast that is already sending or partly
     * delivered is SKIPPED rather than throwing — a half-sent announcement
     * must not be able to block the event's own cancellation.
     *
     * @return array{cancelled:int,deliveries_cancelled:int,skipped_in_flight:int}
     */
    public function cancelPendingForLifecycleWithinTransaction(
        Event $event,
        User $actor,
        string $reason,
        string $idempotencyPrefix,
    ): array {
        if (DB::transactionLevel() <= 0) {
            throw new EventBroadcastException('event_broadcast_transaction_required');
        }

        $tenantId = $this->support->tenantId();
        $eventId = (int) $event->getKey();
        if ((int) $event->tenant_id !== $tenantId || $eventId <= 0) {
            throw new EventBroadcastException('event_broadcast_event_scope_invalid');
        }

        $reason = trim($reason);
        if ($reason === '') {
            $reason = 'event_cancelled';
        }
        $reason = mb_substr($reason, 0, 500);

        $cancellable = [
            EventBroadcastStatus::Draft->value,
            EventBroadcastStatus::Scheduled->value,
        ];

        $broadcasts = DB::table('event_broadcasts')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereIn('status', $cancellable)
            ->lockForUpdate()
            ->get();

        $now = CarbonImmutable::now('UTC');
        $cancelled = 0;
        $deliveriesCancelled = 0;
        $skipped = 0;

        foreach ($broadcasts as $row) {
            $broadcastId = (int) $row->id;

            // Already going out — the deliveries trigger forbids
            // processing -> cancelled, and half-recalling a send would be
            // dishonest anyway. Leave it and report it.
            $inFlight = DB::table('event_broadcast_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('broadcast_id', $broadcastId)
                ->whereIn('status', [
                    EventBroadcastDeliveryStatus::Processing->value,
                    EventBroadcastDeliveryStatus::Delivered->value,
                ])
                ->exists();
            if ($inFlight) {
                $skipped++;

                continue;
            }

            $from = EventBroadcastStatus::from((string) $row->status);
            $currentVersion = (int) $row->broadcast_version;
            $newVersion = $currentVersion + 1;

            $updated = DB::table('event_broadcasts')
                ->where('tenant_id', $tenantId)
                ->where('id', $broadcastId)
                ->where('status', $from->value)
                ->where('broadcast_version', $currentVersion)
                ->update([
                    'status' => EventBroadcastStatus::Cancelled->value,
                    'broadcast_version' => $newVersion,
                    'cancelled_by_user_id' => (int) $actor->id,
                    'cancelled_at' => $now,
                    'updated_by_user_id' => (int) $actor->id,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                // Someone changed it between the lock and here; leave it to
                // its own operator rather than fighting for it.
                $skipped++;

                continue;
            }

            $deliveriesCancelled += DB::table('event_broadcast_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('broadcast_id', $broadcastId)
                ->whereIn('status', [
                    EventBroadcastDeliveryStatus::Pending->value,
                    EventBroadcastDeliveryStatus::Retry->value,
                ])
                ->update([
                    'status' => EventBroadcastDeliveryStatus::Cancelled->value,
                    'cancelled_at' => $now,
                    'claim_token' => null,
                    'claimed_at' => null,
                    'next_attempt_at' => null,
                    'updated_at' => $now,
                ]);

            $keyHash = $this->support->idempotencyHash(
                $idempotencyPrefix . ':broadcast:' . $broadcastId,
            );
            $requestHash = $this->support->requestHash([
                'action' => EventBroadcastAction::Cancelled->value,
                'broadcast_id' => $broadcastId,
                'actor_user_id' => (int) $actor->id,
                'expected_version' => $currentVersion,
                'reason' => $reason,
            ]);

            $this->insertHistory(
                $tenantId,
                $eventId,
                $broadcastId,
                $newVersion,
                EventBroadcastAction::Cancelled,
                $from,
                EventBroadcastStatus::Cancelled,
                (int) $actor->id,
                $keyHash,
                $requestHash,
                (string) $row->content_hash,
                [
                    'contract_version' => 1,
                    'reason_recorded' => true,
                    'cascade' => 'event_lifecycle',
                    'cancelled_delivery_count' => $deliveriesCancelled,
                ],
                $now,
            );

            $cancelled++;
        }

        return [
            'cancelled' => $cancelled,
            'deliveries_cancelled' => $deliveriesCancelled,
            'skipped_in_flight' => $skipped,
        ];
    }

    /** @return array{broadcast:EventBroadcast,changed:bool} */
    public function retryFailed(
        int $broadcastId,
        User|int $actor,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        $this->support->assertSchema();
        $tenantId = $this->support->tenantId();
        $this->support->assertCreationEnabled($tenantId);
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $broadcastId,
            $actor,
            $expectedVersion,
            $keyHash,
        ): array {
            $broadcast = $this->broadcast($tenantId, $broadcastId, true);
            $event = $this->support->event($tenantId, (int) $broadcast->event_id, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorize($persistedActor, $event);
            $requestHash = $this->support->requestHash([
                'action' => EventBroadcastAction::Retried->value,
                'broadcast_id' => $broadcastId,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
            ]);
            $replay = $this->historyReplay(
                $tenantId,
                $keyHash,
                EventBroadcastAction::Retried,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return ['broadcast' => $this->broadcastModel($tenantId, $broadcastId), 'changed' => false];
            }
            $this->assertVersionAndStatus(
                $broadcast,
                $expectedVersion,
                [EventBroadcastStatus::Failed],
            );

            $now = CarbonImmutable::now('UTC');
            $reset = DB::table('event_broadcast_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('broadcast_id', $broadcastId)
                ->where('status', EventBroadcastDeliveryStatus::DeadLetter->value)
                ->update([
                    'status' => EventBroadcastDeliveryStatus::Retry->value,
                    'attempts' => 0,
                    'available_at' => $now,
                    'next_attempt_at' => $now,
                    'claim_token' => null,
                    'claimed_at' => null,
                    'dead_lettered_at' => null,
                    'last_error_code' => null,
                    'updated_at' => $now,
                ]);
            if ($reset < 1) {
                throw new EventBroadcastException('event_broadcast_dead_letter_missing');
            }
            $newVersion = $expectedVersion + 1;
            $updated = DB::table('event_broadcasts')
                ->where('tenant_id', $tenantId)
                ->where('id', $broadcastId)
                ->where('status', EventBroadcastStatus::Failed->value)
                ->where('broadcast_version', $expectedVersion)
                ->update([
                    'status' => EventBroadcastStatus::Scheduled->value,
                    'broadcast_version' => $newVersion,
                    'scheduled_at' => $now,
                    'dead_letter_count' => 0,
                    'failure_code' => null,
                    'failed_at' => null,
                    'updated_by_user_id' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                throw new EventBroadcastException('event_broadcast_version_conflict');
            }
            $this->insertHistory(
                $tenantId,
                (int) $broadcast->event_id,
                $broadcastId,
                $newVersion,
                EventBroadcastAction::Retried,
                EventBroadcastStatus::Failed,
                EventBroadcastStatus::Scheduled,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                (string) $broadcast->content_hash,
                ['contract_version' => 1, 'reset_delivery_count' => $reset],
                $now,
            );

            return ['broadcast' => $this->broadcastModel($tenantId, $broadcastId), 'changed' => true];
        }, 3);
    }

    public function markSending(int $tenantId, int $broadcastId): bool
    {
        return DB::transaction(function () use ($tenantId, $broadcastId): bool {
            $broadcast = $this->broadcast($tenantId, $broadcastId, true);
            $status = EventBroadcastStatus::from((string) $broadcast->getRawOriginal('status'));
            if ($status === EventBroadcastStatus::Sending) {
                return true;
            }
            if ($status !== EventBroadcastStatus::Scheduled
                || $broadcast->scheduled_at === null
                || $broadcast->scheduled_at->isFuture()) {
                return false;
            }

            $fromVersion = (int) $broadcast->broadcast_version;
            $version = $fromVersion + 1;
            $now = CarbonImmutable::now('UTC');
            $updated = DB::table('event_broadcasts')
                ->where('tenant_id', $tenantId)
                ->where('id', $broadcastId)
                ->where('status', EventBroadcastStatus::Scheduled->value)
                ->where('broadcast_version', $fromVersion)
                ->update([
                    'status' => EventBroadcastStatus::Sending->value,
                    'broadcast_version' => $version,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                return false;
            }
            $keyHash = hash('sha256', "event-broadcast:system:sending:{$tenantId}:{$broadcastId}:{$version}");
            $requestHash = $this->support->requestHash([
                'action' => EventBroadcastAction::Sending->value,
                'broadcast_id' => $broadcastId,
                'version' => $version,
            ]);
            $this->insertHistory(
                $tenantId,
                (int) $broadcast->event_id,
                $broadcastId,
                $version,
                EventBroadcastAction::Sending,
                EventBroadcastStatus::Scheduled,
                EventBroadcastStatus::Sending,
                null,
                $keyHash,
                $requestHash,
                (string) $broadcast->content_hash,
                ['contract_version' => 1],
                $now,
            );

            return true;
        }, 3);
    }

    public function reconcileDeliveryState(int $tenantId, int $broadcastId): void
    {
        DB::transaction(function () use ($tenantId, $broadcastId): void {
            $broadcast = $this->broadcast($tenantId, $broadcastId, true);
            $status = EventBroadcastStatus::from((string) $broadcast->getRawOriginal('status'));
            if (in_array($status, [EventBroadcastStatus::Draft, EventBroadcastStatus::Cancelled, EventBroadcastStatus::Sent], true)) {
                return;
            }
            $counts = DB::table('event_broadcast_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('broadcast_id', $broadcastId)
                ->select('status', DB::raw('COUNT(*) AS aggregate'))
                ->groupBy('status')
                ->pluck('aggregate', 'status')
                ->map(static fn (mixed $count): int => (int) $count)
                ->all();
            $delivered = (int) ($counts[EventBroadcastDeliveryStatus::Delivered->value] ?? 0);
            $suppressed = (int) ($counts[EventBroadcastDeliveryStatus::Suppressed->value] ?? 0);
            $deadLetters = (int) ($counts[EventBroadcastDeliveryStatus::DeadLetter->value] ?? 0);
            $active = (int) ($counts[EventBroadcastDeliveryStatus::Pending->value] ?? 0)
                + (int) ($counts[EventBroadcastDeliveryStatus::Retry->value] ?? 0)
                + (int) ($counts[EventBroadcastDeliveryStatus::Processing->value] ?? 0);
            $now = CarbonImmutable::now('UTC');
            $baseCounts = [
                'delivered_count' => $delivered,
                'suppressed_count' => $suppressed,
                'dead_letter_count' => $deadLetters,
                'updated_at' => $now,
            ];
            if ($active > 0) {
                DB::table('event_broadcasts')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $broadcastId)
                    ->update($baseCounts);
                return;
            }

            $target = $deadLetters > 0
                ? EventBroadcastStatus::Failed
                : EventBroadcastStatus::Sent;
            if ($status === $target) {
                DB::table('event_broadcasts')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $broadcastId)
                    ->update($baseCounts);
                return;
            }
            if ($status !== EventBroadcastStatus::Sending || ! $status->canTransitionTo($target)) {
                throw new EventBroadcastException('event_broadcast_transition_invalid');
            }
            $fromVersion = (int) $broadcast->broadcast_version;
            $version = $fromVersion + 1;
            $updates = $baseCounts + [
                'status' => $target->value,
                'broadcast_version' => $version,
                'sent_at' => $target === EventBroadcastStatus::Sent ? $now : null,
                'failed_at' => $target === EventBroadcastStatus::Failed ? $now : null,
                'failure_code' => $target === EventBroadcastStatus::Failed
                    ? 'event_broadcast_delivery_dead_lettered'
                    : null,
            ];
            $updated = DB::table('event_broadcasts')
                ->where('tenant_id', $tenantId)
                ->where('id', $broadcastId)
                ->where('status', EventBroadcastStatus::Sending->value)
                ->where('broadcast_version', $fromVersion)
                ->update($updates);
            if ($updated !== 1) {
                throw new EventBroadcastException('event_broadcast_version_conflict');
            }
            $action = $target === EventBroadcastStatus::Sent
                ? EventBroadcastAction::Sent
                : EventBroadcastAction::Failed;
            $keyHash = hash('sha256', "event-broadcast:system:{$action->value}:{$tenantId}:{$broadcastId}:{$version}");
            $requestHash = $this->support->requestHash([
                'action' => $action->value,
                'broadcast_id' => $broadcastId,
                'version' => $version,
                'delivered' => $delivered,
                'suppressed' => $suppressed,
                'dead_lettered' => $deadLetters,
            ]);
            $this->insertHistory(
                $tenantId,
                (int) $broadcast->event_id,
                $broadcastId,
                $version,
                $action,
                EventBroadcastStatus::Sending,
                $target,
                null,
                $keyHash,
                $requestHash,
                (string) $broadcast->content_hash,
                [
                    'contract_version' => 1,
                    'delivered_count' => $delivered,
                    'suppressed_count' => $suppressed,
                    'dead_letter_count' => $deadLetters,
                ],
                $now,
            );
        }, 3);
    }

    private function assertScheduleEligible(
        Event $event,
        EventBroadcastVariant $variant,
        CarbonImmutable $scheduledAt,
    ): void {
        if (! $variant->requiresCompletedEvent()) {
            return;
        }
        $eventEnd = $event->end_time ?? $event->start_time;
        if ($eventEnd === null) {
            throw new EventBroadcastException('event_broadcast_event_schedule_invalid');
        }
        $end = $eventEnd instanceof DateTimeInterface
            ? CarbonImmutable::instance($eventEnd)->utc()
            : CarbonImmutable::parse((string) $eventEnd, (string) ($event->timezone ?? 'UTC'))->utc();
        if ($scheduledAt->lessThan($end)) {
            throw new EventBroadcastException('event_broadcast_post_event_too_early');
        }
    }

    /** @param list<int> $recipientIds @param list<EventBroadcastChannel> $channels */
    private function insertDeliveries(
        int $tenantId,
        int $eventId,
        int $broadcastId,
        int $broadcastVersion,
        array $recipientIds,
        array $channels,
        CarbonImmutable $availableAt,
        CarbonImmutable $now,
    ): void {
        $rows = [];
        foreach ($recipientIds as $recipientId) {
            foreach ($channels as $channel) {
                $rows[] = [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'broadcast_id' => $broadcastId,
                    'frozen_broadcast_version' => $broadcastVersion,
                    'recipient_user_id' => $recipientId,
                    'channel' => $channel->value,
                    'delivery_key' => hash('sha256', implode('|', [
                        'event-broadcast-delivery-v1',
                        $tenantId,
                        $eventId,
                        $broadcastId,
                        $broadcastVersion,
                        $recipientId,
                        $channel->value,
                    ])),
                    'status' => EventBroadcastDeliveryStatus::Pending->value,
                    'attempts' => 0,
                    'available_at' => $availableAt,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }
        foreach (array_chunk($rows, 500) as $chunk) {
            DB::table('event_broadcast_deliveries')->insert($chunk);
        }
    }

    /** @param list<EventBroadcastAudienceSegment|string> $segments @return list<EventBroadcastAudienceSegment> */
    private function segments(array $segments, EventBroadcastVariant $variant): array
    {
        $normalized = [];
        foreach ($segments as $value) {
            $candidate = $value instanceof EventBroadcastAudienceSegment
                ? $value
                : (is_string($value)
                    ? EventBroadcastAudienceSegment::tryFrom(trim($value))
                    : null);
            if ($candidate === null) {
                throw new EventBroadcastException('event_broadcast_audience_segment_invalid');
            }
            $normalized[$candidate->value] = $candidate;
        }
        ksort($normalized);
        $normalized = array_values($normalized);
        if ($normalized === []) {
            throw new EventBroadcastException('event_broadcast_audience_empty');
        }
        if ($variant->requiresCompletedEvent()) {
            foreach ($normalized as $segment) {
                if (! $segment->isAttendanceSegment()) {
                    throw new EventBroadcastException('event_broadcast_post_event_audience_invalid');
                }
            }
        }
        if ($variant === EventBroadcastVariant::ReviewRequest
            && ($this->values($normalized) !== [EventBroadcastAudienceSegment::AttendanceAttended->value])) {
            throw new EventBroadcastException('event_broadcast_review_audience_invalid');
        }

        return $normalized;
    }

    /** @param list<EventBroadcastChannel|string> $channels @return list<EventBroadcastChannel> */
    private function channels(array $channels): array
    {
        $normalized = [];
        foreach ($channels as $value) {
            $candidate = $value instanceof EventBroadcastChannel
                ? $value
                : (is_string($value) ? EventBroadcastChannel::tryFrom(trim($value)) : null);
            if ($candidate === null) {
                throw new EventBroadcastException('event_broadcast_channel_invalid');
            }
            $normalized[$candidate->value] = $candidate;
        }
        ksort($normalized);
        $normalized = array_values($normalized);
        if ($normalized === []) {
            throw new EventBroadcastException('event_broadcast_channel_empty');
        }

        return $normalized;
    }

    private function variant(EventBroadcastVariant|string $variant): EventBroadcastVariant
    {
        $normalized = is_string($variant) ? EventBroadcastVariant::tryFrom($variant) : $variant;
        if ($normalized === null) {
            throw new EventBroadcastException('event_broadcast_variant_invalid');
        }

        return $normalized;
    }

    /** @param list<BackedEnum> $enums @return list<string> */
    private function values(array $enums): array
    {
        return array_map(static fn (BackedEnum $enum): string => (string) $enum->value, $enums);
    }

    /** @param list<EventBroadcastStatus> $statuses */
    private function assertVersionAndStatus(
        EventBroadcast $broadcast,
        int $expectedVersion,
        array $statuses,
    ): void {
        if ($expectedVersion <= 0 || (int) $broadcast->broadcast_version !== $expectedVersion) {
            throw new EventBroadcastException('event_broadcast_version_conflict');
        }
        $status = EventBroadcastStatus::from((string) $broadcast->getRawOriginal('status'));
        if (! in_array($status, $statuses, true)) {
            throw new EventBroadcastException('event_broadcast_transition_invalid');
        }
    }

    private function broadcast(int $tenantId, int $broadcastId, bool $lock = false): EventBroadcast
    {
        $query = EventBroadcast::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($broadcastId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $broadcast = $query->first();
        if ($broadcast === null) {
            throw new EventBroadcastException('event_broadcast_not_found');
        }

        return $broadcast;
    }

    private function broadcastModel(int $tenantId, int $broadcastId): EventBroadcast
    {
        return EventBroadcast::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->findOrFail($broadcastId);
    }

    private function historyReplay(
        int $tenantId,
        string $keyHash,
        EventBroadcastAction $action,
        string $requestHash,
        bool $lock = false,
    ): ?EventBroadcastHistory {
        $query = EventBroadcastHistory::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $keyHash);
        if ($lock) {
            $query->lockForUpdate();
        }
        $history = $query->first();
        if ($history === null) {
            return null;
        }
        $storedAction = $history->action instanceof BackedEnum
            ? (string) $history->action->value
            : (string) $history->getRawOriginal('action');
        if ($storedAction !== $action->value
            || ! hash_equals((string) $history->request_hash, $requestHash)) {
            throw new EventBroadcastException('event_broadcast_idempotency_conflict');
        }

        return $history;
    }

    /**
     * @return array{broadcast:EventBroadcast,changed:bool}
     * @throws QueryException
     */
    private function recoverReplay(
        QueryException $exception,
        int $tenantId,
        string $keyHash,
        EventBroadcastAction $action,
        ?string $requestHash,
    ): array {
        if ($requestHash !== null && $this->isUniqueConflict($exception)) {
            $history = $this->historyReplay($tenantId, $keyHash, $action, $requestHash);
            if ($history !== null) {
                return [
                    'broadcast' => $this->broadcastModel($tenantId, (int) $history->broadcast_id),
                    'changed' => false,
                ];
            }
        }

        throw $exception;
    }

    /** @param array<string,mixed> $metadata */
    private function insertHistory(
        int $tenantId,
        int $eventId,
        int $broadcastId,
        int $version,
        EventBroadcastAction $action,
        ?EventBroadcastStatus $from,
        EventBroadcastStatus $to,
        ?int $actorId,
        string $keyHash,
        string $requestHash,
        string $contentHash,
        array $metadata,
        CarbonImmutable $now,
    ): void {
        DB::table('event_broadcast_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'broadcast_id' => $broadcastId,
            'broadcast_version' => $version,
            'action' => $action->value,
            'from_status' => $from?->value,
            'to_status' => $to->value,
            'actor_user_id' => $actorId,
            'idempotency_hash' => $keyHash,
            'request_hash' => $requestHash,
            'content_hash' => $contentHash,
            'metadata' => json_encode($metadata, JSON_THROW_ON_ERROR),
            'created_at' => $now,
        ]);
    }

    private function isUniqueConflict(QueryException $exception): bool
    {
        return in_array((string) ($exception->errorInfo[0] ?? $exception->getCode()), ['23000', '23505'], true);
    }
}
