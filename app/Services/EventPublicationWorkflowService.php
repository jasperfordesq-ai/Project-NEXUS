<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventPublicationState;
use App\Exceptions\EventLifecycleTransitionException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Authorization\AdminTier;
use App\Support\Events\EventLifecycleTransitionContext;
use App\Support\Events\EventLifecycleTransitionGuard;
use App\Support\Events\EventLifecycleTransitionResult;
use Illuminate\Support\Facades\DB;

/**
 * Canonical moderation-aware publication boundary for standalone and recurring Events.
 *
 * A recurring template and all of its concrete occurrences transition inside one
 * outer transaction. Each row still passes through EventLifecycleService, so it
 * receives its own immutable history record and transactional outbox fact.
 */
final class EventPublicationWorkflowService
{
    private readonly EventLifecycleService $lifecycle;
    private readonly EventPolicy $policy;

    public function __construct(
        ?EventLifecycleService $lifecycle = null,
        ?EventPolicy $policy = null,
    ) {
        $this->lifecycle = $lifecycle ?? app(EventLifecycleService::class);
        $this->policy = $policy ?? app(EventPolicy::class);
    }

    public function moderationRequired(?int $tenantId = null): bool
    {
        $tenantId ??= TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventLifecycleTransitionException('event_lifecycle_tenant_context_missing');
        }

        return (bool) app(EventConfigurationService::class)->value(
            'moderation_required',
            false,
            $tenantId,
        );
    }

    /** @return array{result:EventLifecycleTransitionResult,series:array<string,mixed>,action:string,target_state:string} */
    public function submit(int $eventId, User $actor): array
    {
        [$persistedActor, $root, $requestedEventId] = $this->authorizedActorAndEvent($eventId, $actor);
        if (! $this->moderationRequired((int) $root->tenant_id) || $this->isTenantAdmin($persistedActor)) {
            throw new EventLifecycleTransitionException('event_publication_review_not_required');
        }

        return $this->transitionSeries(
            $root,
            $persistedActor,
            EventPublicationState::PendingReview,
            null,
            new EventLifecycleTransitionGuard([
                EventPublicationState::Draft,
                EventPublicationState::PendingReview,
            ]),
            'submit_for_review',
            $requestedEventId,
        );
    }

    /** @return array{result:EventLifecycleTransitionResult,series:array<string,mixed>,action:string,target_state:string} */
    public function publish(int $eventId, User $actor): array
    {
        [$persistedActor, $root, $requestedEventId] = $this->authorizedActorAndEvent($eventId, $actor);
        if ($this->moderationRequired((int) $root->tenant_id) && ! $this->isTenantAdmin($persistedActor)) {
            throw new EventLifecycleTransitionException('event_publication_review_required');
        }

        return $this->transitionSeries(
            $root,
            $persistedActor,
            EventPublicationState::Published,
            null,
            new EventLifecycleTransitionGuard([
                EventPublicationState::Draft,
                EventPublicationState::PendingReview,
                EventPublicationState::Published,
            ]),
            'publish',
            $requestedEventId,
        );
    }

    /** @return array{result:EventLifecycleTransitionResult,series:array<string,mixed>,action:string,target_state:string} */
    public function approve(int $eventId, User $actor, ?string $reason = null): array
    {
        [$persistedActor, $root, $requestedEventId] = $this->authorizedAdminAndEvent($eventId, $actor);

        return $this->transitionSeries(
            $root,
            $persistedActor,
            EventPublicationState::Published,
            $reason,
            new EventLifecycleTransitionGuard([
                EventPublicationState::Draft,
                EventPublicationState::PendingReview,
                EventPublicationState::Published,
            ]),
            'approve',
            $requestedEventId,
        );
    }

    /** Queue-backed approval: both the Event and moderation row must still be pending. */
    public function approveModerationDecision(
        int $eventId,
        User $actor,
        ?string $reason = null,
    ): array {
        [$persistedActor, $root, $requestedEventId] = $this->authorizedAdminAndEvent($eventId, $actor);

        return $this->transitionSeries(
            $root,
            $persistedActor,
            EventPublicationState::Published,
            $reason,
            new EventLifecycleTransitionGuard([
                EventPublicationState::PendingReview,
                EventPublicationState::Published,
            ]),
            'approve',
            $requestedEventId,
            true,
        );
    }

    /** @return array{result:EventLifecycleTransitionResult,series:array<string,mixed>,action:string,target_state:string} */
    public function reject(int $eventId, User $actor, string $reason): array
    {
        return $this->rejectModerationDecision($eventId, $actor, $reason);
    }

    /** Queue-backed rejection: both the Event and moderation row must still be pending. */
    public function rejectModerationDecision(int $eventId, User $actor, string $reason): array
    {
        [$persistedActor, $root, $requestedEventId] = $this->authorizedAdminAndEvent($eventId, $actor);

        return $this->transitionSeries(
            $root,
            $persistedActor,
            EventPublicationState::Draft,
            $reason,
            new EventLifecycleTransitionGuard([
                EventPublicationState::PendingReview,
                EventPublicationState::Draft,
            ]),
            'reject',
            $requestedEventId,
            true,
        );
    }

    /** @return array{0:User,1:Event,2:int} */
    private function authorizedActorAndEvent(int $eventId, User $actor): array
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventLifecycleTransitionException('event_lifecycle_tenant_context_missing');
        }

        // Auth is GLOBAL; only resources are tenant-scoped. Resolving the
        // ACTING user's own row with a tenant predicate refused every actor
        // whose home tenant differs from the tenant being acted in — including
        // the organiser who just created the event. The Event lookup below
        // stays tenant-scoped; authority is decided by EventPolicy.
        /** @var User|null $persistedActor */
        $persistedActor = User::withoutGlobalScopes()
            ->whereKey((int) $actor->getKey())
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first();
        /** @var Event|null $event */
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->first();
        if ($event === null) {
            throw new EventLifecycleTransitionException('event_lifecycle_event_not_found');
        }
        if ($persistedActor === null || ! $this->policy->manage($persistedActor, $event)) {
            throw new EventLifecycleTransitionException('event_lifecycle_authorization_denied');
        }

        $root = $event;
        $parentId = (int) ($event->getRawOriginal('parent_event_id') ?? 0);
        if ($parentId > 0) {
            /** @var Event|null $parent */
            $parent = Event::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($parentId)
                ->where('is_recurring_template', 1)
                ->first();
            if ($parent === null) {
                throw new EventLifecycleTransitionException('event_lifecycle_event_not_found');
            }
            if (! $this->policy->manage($persistedActor, $parent)) {
                throw new EventLifecycleTransitionException('event_lifecycle_authorization_denied');
            }
            $root = $parent;
        }

        return [$persistedActor, $root, (int) $event->getKey()];
    }

    /** @return array{0:User,1:Event,2:int} */
    private function authorizedAdminAndEvent(int $eventId, User $actor): array
    {
        [$persistedActor, $event, $requestedEventId] = $this->authorizedActorAndEvent($eventId, $actor);
        if (! $this->isTenantAdmin($persistedActor)) {
            throw new EventLifecycleTransitionException('event_lifecycle_authorization_denied');
        }

        return [$persistedActor, $event, $requestedEventId];
    }

    /**
     * @return array{result:EventLifecycleTransitionResult,series:array<string,mixed>,action:string,target_state:string}
     */
    private function transitionSeries(
        Event $root,
        User $actor,
        EventPublicationState $target,
        ?string $reason,
        EventLifecycleTransitionGuard $guard,
        string $action,
        int $requestedEventId,
        bool $requiresCurrentModerationDecision = false,
    ): array {
        $tenantId = (int) $root->tenant_id;
        $rootId = (int) $root->getKey();

        return DB::transaction(function () use (
            $tenantId,
            $rootId,
            $actor,
            $target,
            $reason,
            $guard,
            $action,
            $requestedEventId,
            $requiresCurrentModerationDecision,
        ): array {
            /** @var Event|null $lockedRoot */
            $lockedRoot = Event::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($rootId)
                ->lockForUpdate()
                ->first();
            if ($lockedRoot === null) {
                throw new EventLifecycleTransitionException('event_lifecycle_event_not_found');
            }

            // The root lock is the publication-decision serialization point.
            // Re-read and lock the actor after it so a role downgrade racing a
            // queued or direct moderation decision fails closed.
            $transactionActor = $actor;
            if (in_array($action, ['approve', 'reject'], true)) {
                // Actor re-read is by authenticated id alone — never
                // tenant-scoped (see authorizedActorAndEvent).
                /** @var User|null $lockedActor */
                $lockedActor = User::withoutGlobalScopes()
                    ->whereKey((int) $actor->getKey())
                    ->where('status', 'active')
                    ->whereNull('deleted_at')
                    ->lockForUpdate()
                    ->first();
                if ($lockedActor === null || ! AdminTier::allows($lockedActor)) {
                    throw new EventLifecycleTransitionException('event_lifecycle_authorization_denied');
                }
                $transactionActor = $lockedActor;
            }

            $isSeries = (bool) $lockedRoot->getRawOriginal('is_recurring_template');
            $targetIds = [$rootId];
            if ($isSeries) {
                $targetIds = array_values(array_unique(array_merge(
                    $targetIds,
                    Event::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->where('parent_event_id', $rootId)
                        ->orderBy('id')
                        ->pluck('id')
                        ->map(static fn (mixed $id): int => (int) $id)
                        ->all(),
                )));
            }

            if ($requiresCurrentModerationDecision) {
                $this->assertCurrentModerationDecision(
                    $lockedRoot,
                    $targetIds,
                    $action,
                );
            }

            /** @var array<int,EventLifecycleTransitionResult> $results */
            $results = [];
            foreach ($targetIds as $targetId) {
                $results[$targetId] = $this->lifecycle->transition(
                    $targetId,
                    $transactionActor,
                    $target,
                    null,
                    $reason,
                    $guard,
                    new EventLifecycleTransitionContext(
                        $isSeries ? $rootId : null,
                        $isSeries && $targetId !== $rootId,
                    ),
                );
            }
            if ($isSeries) {
                $results = EventService::consolidateSeriesLifecycleResults(
                    $lockedRoot,
                    $transactionActor,
                    $action,
                    $reason,
                    $results,
                );
            }

            $rootResult = $results[$rootId] ?? null;
            if (! $rootResult instanceof EventLifecycleTransitionResult) {
                throw new \LogicException('Recurring Event publication root result is missing.');
            }
            if ($action === 'submit_for_review') {
                $this->syncPendingModerationQueue($rootResult->event);
            } elseif ($action === 'publish' || ($action === 'approve' && $rootResult->changed)) {
                $this->closeModerationQueue(
                    $rootResult->event,
                    $transactionActor,
                    ContentModerationService::STATUS_APPROVED,
                    null,
                );
            } elseif ($action === 'reject' && $rootResult->changed) {
                $this->closeModerationQueue(
                    $rootResult->event,
                    $transactionActor,
                    ContentModerationService::STATUS_REJECTED,
                    $reason,
                );
            }

            $requestedResult = $results[$requestedEventId] ?? null;
            if (! $requestedResult instanceof EventLifecycleTransitionResult) {
                throw new \LogicException('Requested Event publication result is missing.');
            }
            $changedIds = [];
            foreach ($results as $eventId => $result) {
                if ($result->changed) {
                    $changedIds[] = (int) $eventId;
                }
            }

            return [
                'result' => $requestedResult,
                'action' => $action,
                'target_state' => $target->value,
                'series' => [
                    'is_series' => $isSeries,
                    'root_event_id' => $rootId,
                    'target_count' => count($targetIds),
                    'changed_count' => count($changedIds),
                    'replayed_count' => count($targetIds) - count($changedIds),
                    'event_ids' => $targetIds,
                    'changed_event_ids' => $changedIds,
                ],
            ];
        }, 3);
    }

    /**
     * Keep one discoverable queue row per canonical Event root. The root Event
     * row is already locked by EventLifecycleService until the outer
     * transaction commits, which serializes concurrent submissions without a
     * broad uniqueness constraint that would change other moderation families.
     */
    private function syncPendingModerationQueue(Event $event): void
    {
        $tenantId = (int) $event->tenant_id;
        $eventId = (int) $event->getKey();
        $queueEventIds = $this->moderationQueueEventIds($event);
        $rows = DB::table('content_moderation_queue')
            ->where('tenant_id', $tenantId)
            ->where('content_type', 'event')
            ->whereIn('content_id', $queueEventIds)
            ->orderByRaw('content_id = ? DESC', [$eventId])
            ->orderBy('id')
            ->lockForUpdate()
            ->get();
        $now = now();
        $values = [
            'author_id' => (int) $event->user_id,
            'content_id' => $eventId,
            'title' => mb_substr(trim((string) $event->title), 0, 255),
            'status' => ContentModerationService::STATUS_PENDING,
            'reviewer_id' => null,
            'reviewed_at' => null,
            'rejection_reason' => null,
            'auto_flagged' => false,
            'flag_reason' => null,
        ];

        if ($rows->isEmpty()) {
            DB::table('content_moderation_queue')->insert($values + [
                'tenant_id' => $tenantId,
                'content_type' => 'event',
                'content_id' => $eventId,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            return;
        }

        $keeper = $rows->first();
        $needsUpdate = (int) $keeper->content_id !== $eventId
            || (int) $keeper->author_id !== $values['author_id']
            || (string) ($keeper->title ?? '') !== $values['title']
            || (string) $keeper->status !== ContentModerationService::STATUS_PENDING
            || $keeper->reviewer_id !== null
            || $keeper->reviewed_at !== null
            || $keeper->rejection_reason !== null
            || (bool) $keeper->auto_flagged
            || $keeper->flag_reason !== null;
        if ($needsUpdate) {
            DB::table('content_moderation_queue')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $keeper->id)
                ->update($values + ['updated_at' => $now]);
        }

        $duplicateIds = $rows->slice(1)
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
        if ($duplicateIds !== []) {
            DB::table('content_moderation_queue')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $duplicateIds)
                ->delete();
        }
    }

    /**
     * A moderation decision is valid only while both canonical authorities are
     * pending. Replays are accepted only when the Event and every matching
     * queue row already record the same terminal decision.
     *
     * The root Event is locked before this method is called. Locking queue rows
     * second establishes the root -> queue order shared by every decision path.
     *
     * @param list<int> $eventIds
     */
    private function assertCurrentModerationDecision(
        Event $root,
        array $eventIds,
        string $action,
    ): void {
        $rows = DB::table('content_moderation_queue')
            ->where('tenant_id', (int) $root->tenant_id)
            ->where('content_type', 'event')
            ->whereIn('content_id', $eventIds)
            ->orderBy('id')
            ->lockForUpdate()
            ->get(['id', 'status']);
        if ($rows->isEmpty()) {
            throw new EventLifecycleTransitionException('event_publication_decision_stale');
        }

        $statuses = $rows
            ->pluck('status')
            ->map(static fn (mixed $status): string => (string) $status)
            ->unique()
            ->values()
            ->all();
        $publication = (string) $root->getRawOriginal('publication_status');
        $pendingDecision = $publication === EventPublicationState::PendingReview->value
            && $statuses === [ContentModerationService::STATUS_PENDING];
        $terminalStatus = $action === 'approve'
            ? ContentModerationService::STATUS_APPROVED
            : ContentModerationService::STATUS_REJECTED;
        $terminalPublication = $action === 'approve'
            ? EventPublicationState::Published->value
            : EventPublicationState::Draft->value;
        $sameTargetReplay = $publication === $terminalPublication
            && $statuses === [$terminalStatus];

        if (! $pendingDecision && ! $sameTargetReplay) {
            throw new EventLifecycleTransitionException('event_publication_decision_stale');
        }
    }

    private function closeModerationQueue(
        Event $event,
        User $actor,
        string $status,
        ?string $rejectionReason,
    ): void {
        DB::table('content_moderation_queue')
            ->where('tenant_id', (int) $event->tenant_id)
            ->where('content_type', 'event')
            ->whereIn('content_id', $this->moderationQueueEventIds($event))
            ->lockForUpdate()
            ->update([
                'status' => $status,
                'reviewer_id' => (int) $actor->getKey(),
                'reviewed_at' => now(),
                'rejection_reason' => $status === ContentModerationService::STATUS_REJECTED
                    ? $rejectionReason
                    : null,
                'updated_at' => now(),
            ]);
    }

    /** @return list<int> */
    private function moderationQueueEventIds(Event $root): array
    {
        $ids = [(int) $root->getKey()];
        if (! (bool) $root->getRawOriginal('is_recurring_template')) {
            return $ids;
        }

        return array_values(array_unique(array_merge(
            $ids,
            Event::withoutGlobalScopes()
                ->where('tenant_id', (int) $root->tenant_id)
                ->where('parent_event_id', (int) $root->getKey())
                ->pluck('id')
                ->map(static fn (mixed $id): int => (int) $id)
                ->all(),
        )));
    }

    private function isTenantAdmin(User $user): bool
    {
        return AdminTier::allows($user);
    }
}
