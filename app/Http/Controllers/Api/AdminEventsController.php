<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Enums\EventOperationalState;
use App\Enums\EventCapacityRegistrationState;
use App\Enums\EventNotificationDeliveryMode;
use App\Enums\EventPublicationState;
use App\Enums\EventWaitlistQueueState;
use App\Exceptions\EventLifecycleTransitionException;
use App\Http\Resources\AdminEventResource;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\Event;
use App\Models\User;
use App\Services\EventNotificationService;
use App\Services\EventPublicationWorkflowService;
use App\Services\EventService;
use App\Services\NotificationDispatcher;
use App\Support\Authorization\CrossTenantEntry;
use App\Support\Events\EventLifecycleCompatibility;
use App\Support\Events\EventLifecycleTransitionResult;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Tenant-admin Event moderation and operational lifecycle surface. */
class AdminEventsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventNotificationService $notifications,
        private readonly EventPublicationWorkflowService $publicationWorkflow,
    ) {
    }

    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1) ?? 1;
        $limit = $this->queryInt('per_page', $this->queryInt('limit', 20, 1, 100), 1, 100) ?? 20;

        $query = $this->adminEventQuery($tenantId);
        $status = $this->scalarQuery('status');
        if ($status !== null) {
            if (! in_array($status, ['active', 'draft', 'cancelled', 'completed'], true)) {
                return $this->respondWithError('VALIDATION_INVALID_STATUS', __('api.invalid_status'), 'status', 422);
            }
            $query->where('e.status', $status);
        }

        $publicationValue = $this->scalarQuery('publication_state')
            ?? $this->scalarQuery('publication_status');
        if ($publicationValue !== null) {
            $publication = EventPublicationState::tryFrom($publicationValue);
            if ($publication === null) {
                return $this->respondWithError(
                    'VALIDATION_INVALID_PUBLICATION_STATE',
                    __('api.invalid_status'),
                    'publication_state',
                    422,
                );
            }
            $this->applyPublicationFilter($query, $publication);
            if ($publication === EventPublicationState::PendingReview) {
                // Moderation is one decision per canonical Event root. Listing
                // every occurrence would starve unrelated submissions and
                // disagree with the single root queue row.
                $query->where(static fn (Builder $root) => $root
                    ->whereNull('e.parent_event_id')
                    ->orWhere('e.parent_event_id', 0));
            }
        }

        $operationalValue = $this->scalarQuery('operational_state')
            ?? $this->scalarQuery('operational_status');
        if ($operationalValue !== null) {
            $operational = EventOperationalState::tryFrom($operationalValue);
            if ($operational === null) {
                return $this->respondWithError(
                    'VALIDATION_INVALID_OPERATIONAL_STATE',
                    __('api.invalid_status'),
                    'operational_state',
                    422,
                );
            }
            $this->applyOperationalFilter($query, $operational);
        }

        foreach (['organizer_id' => 'e.user_id', 'group_id' => 'e.group_id'] as $filter => $column) {
            $value = $this->positiveIntegerQuery($filter);
            if ($value === false) {
                return $this->respondWithError(
                    'VALIDATION_INVALID_FILTER',
                    __('api.invalid_status'),
                    $filter,
                    422,
                );
            }
            if (is_int($value)) {
                $query->where($column, $value);
            }
        }

        $dateFrom = $this->dateQuery('date_from');
        $dateTo = $this->dateQuery('date_to');
        if ($dateFrom === false || $dateTo === false
            || (is_string($dateFrom) && is_string($dateTo) && $dateFrom > $dateTo)) {
            return $this->respondWithError('VALIDATION_INVALID_DATE', __('api.invalid_date'), null, 422);
        }
        if (is_string($dateFrom)) {
            $query->where('e.start_time', '>=', $dateFrom . ' 00:00:00');
        }
        if (is_string($dateTo)) {
            $query->where('e.start_time', '<=', $dateTo . ' 23:59:59');
        }

        $capacity = $this->scalarQuery('capacity');
        if ($capacity !== null) {
            if (! in_array($capacity, ['full', 'available', 'unlimited', 'limited'], true)) {
                return $this->respondWithError(
                    'VALIDATION_INVALID_CAPACITY',
                    __('api.invalid_status'),
                    'capacity',
                    422,
                );
            }
            match ($capacity) {
                'full' => $query->whereNotNull('e.max_attendees')
                    ->whereRaw('COALESCE(oc.occupied_count, 0) >= e.max_attendees'),
                'available' => $query->whereNotNull('e.max_attendees')
                    ->whereRaw('COALESCE(oc.occupied_count, 0) < e.max_attendees'),
                'unlimited' => $query->whereNull('e.max_attendees'),
                'limited' => $query->whereNotNull('e.max_attendees'),
            };
        }

        $search = $this->scalarQuery('search');
        if ($search !== null) {
            $pattern = '%' . mb_substr($search, 0, 200) . '%';
            $query->where(static function (Builder $builder) use ($pattern): void {
                $builder->where('e.title', 'LIKE', $pattern)
                    ->orWhere('e.description', 'LIKE', $pattern)
                    ->orWhere('e.location', 'LIKE', $pattern)
                    ->orWhere('u.name', 'LIKE', $pattern);
            });
        }

        $total = (clone $query)->count('e.id');
        $items = $query
            ->orderByDesc('e.created_at')
            ->orderByDesc('e.id')
            ->limit($limit)
            ->offset(($page - 1) * $limit)
            ->get()
            ->map(static fn (object $row): array => AdminEventResource::fromRow($row))
            ->all();

        return $this->respondWithPaginatedCollection($items, $total, $page, $limit);
    }

    public function show(int $id): JsonResponse
    {
        $this->requireAdmin();
        $resource = $this->adminEventResource($id, $this->getTenantId());

        return $resource === null
            ? $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404)
            : $this->respondWithData($resource);
    }

    public function approve(int $id): JsonResponse
    {
        [$actor, $snapshot] = $this->actorAndSnapshot($id);
        if ($snapshot === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        $operation = $this->performPublicationTransition(
            fn (): array => $this->publicationWorkflow->approve($id, $actor),
        );
        if ($operation instanceof JsonResponse) {
            return $operation;
        }
        $result = $operation['result'];
        if ($result->changed && $this->directSideEffectsEnabled($result)) {
            $this->notifyOrganizerApproved($snapshot, (int) $actor->id);
        }

        return $this->transitionResponse($id, $result, 'approve', $operation['series']);
    }

    public function reject(int $id): JsonResponse
    {
        [$actor, $snapshot] = $this->actorAndSnapshot($id);
        if ($snapshot === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }
        $reason = $this->requiredReason();
        if ($reason instanceof JsonResponse) {
            return $reason;
        }

        $operation = $this->performPublicationTransition(
            fn (): array => $this->publicationWorkflow->reject($id, $actor, $reason),
        );

        return $operation instanceof JsonResponse
            ? $operation
            : $this->transitionResponse(
                $id,
                $operation['result'],
                'reject',
                $operation['series'],
            );
    }

    public function postpone(int $id): JsonResponse
    {
        [$actor, $snapshot] = $this->actorAndSnapshot($id);
        if ($snapshot === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }
        $operation = $this->performSeriesLifecycleTransition(
            $snapshot,
            $actor,
            'postpone',
            $this->optionalReason(),
        );
        if ($operation instanceof JsonResponse) {
            return $operation;
        }
        $result = $operation['result'];
        if ($result->changed && $this->directSideEffectsEnabled($result)) {
            $this->notifyScheduleChanged($snapshot, (int) $actor->id);
        }

        return $this->transitionResponse($id, $result, 'postpone', $operation['series']);
    }

    public function cancel(int $id): JsonResponse
    {
        [$actor, $snapshot] = $this->actorAndSnapshot($id);
        if ($snapshot === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }
        $reason = $this->requiredReason();
        if ($reason instanceof JsonResponse) {
            return $reason;
        }
        $operation = $this->performSeriesLifecycleTransition(
            $snapshot,
            $actor,
            'cancel',
            $reason,
        );
        if ($operation instanceof JsonResponse) {
            return $operation;
        }
        $result = $operation['result'];
        if ($result->changed && $this->directSideEffectsEnabled($result)) {
            $this->notifyCancellation($result, $snapshot, (int) $actor->id, $reason);
        }

        return $this->transitionResponse($id, $result, 'cancel', $operation['series']);
    }

    public function complete(int $id): JsonResponse
    {
        [$actor, $snapshot] = $this->actorAndSnapshot($id);
        if ($snapshot === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }
        $operation = $this->performSeriesLifecycleTransition(
            $snapshot,
            $actor,
            'complete',
            $this->optionalReason(),
        );

        return $operation instanceof JsonResponse
            ? $operation
            : $this->transitionResponse(
                $id,
                $operation['result'],
                'complete',
                $operation['series'],
            );
    }

    public function archive(int $id): JsonResponse
    {
        [$actor, $snapshot] = $this->actorAndSnapshot($id);
        if ($snapshot === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }
        $current = $this->snapshotLifecycle($snapshot);
        $reason = $this->optionalReason();
        $cancelOperationally = in_array($current['operational'], [
            EventOperationalState::Scheduled,
            EventOperationalState::Postponed,
        ], true);
        $operation = $this->performSeriesLifecycleTransition(
            $snapshot,
            $actor,
            'archive',
            $reason,
        );
        if ($operation instanceof JsonResponse) {
            return $operation;
        }
        $result = $operation['result'];
        if ($result->changed
            && $cancelOperationally
            && $this->directSideEffectsEnabled($result)) {
            $this->notifyCancellation(
                $result,
                $snapshot,
                (int) $actor->id,
                $reason,
            );
        }

        return $this->transitionResponse($id, $result, 'archive', $operation['series']);
    }

    public function restore(int $id): JsonResponse
    {
        [$actor, $snapshot] = $this->actorAndSnapshot($id);
        if ($snapshot === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }
        $operation = $this->performSeriesLifecycleTransition(
            $snapshot,
            $actor,
            'restore',
            $this->optionalReason(),
        );
        if ($operation instanceof JsonResponse) {
            return $operation;
        }
        $result = $operation['result'];
        if ($result->changed && $this->directSideEffectsEnabled($result)) {
            $this->notifyScheduleChanged($snapshot, (int) $actor->id);
        }

        return $this->transitionResponse($id, $result, 'restore', $operation['series']);
    }

    public function reschedule(int $id): JsonResponse
    {
        return $this->restore($id);
    }

    public function destroy(int $id): JsonResponse
    {
        return $this->archive($id);
    }

    private function adminEventQuery(int $tenantId): Builder
    {
        $defaultPool = trim((string) config('events.registration.default_capacity_pool_key', 'event'));
        if ($defaultPool === '') {
            $defaultPool = 'event';
        }
        $engagementCounts = DB::table('event_rsvps')
            ->where('tenant_id', $tenantId)
            ->selectRaw(
                "tenant_id, event_id,
                 SUM(CASE WHEN status = 'interested' THEN 1 ELSE 0 END) AS interested_count,
                 SUM(CASE WHEN status = 'attended' THEN 1 ELSE 0 END) AS legacy_attended_count"
            )
            ->groupBy('tenant_id', 'event_id');

        $confirmedCounts = DB::query()
            ->fromSub(
                $this->adminConfirmedSubjects($tenantId, $defaultPool),
                'confirmed_subjects',
            )
            ->selectRaw('tenant_id, event_id, COUNT(*) AS confirmed_count')
            ->groupBy('tenant_id', 'event_id');

        $activeOffers = DB::table('event_waitlist_entries as active_offer')
            ->select([
                'active_offer.tenant_id',
                'active_offer.event_id',
                'active_offer.user_id',
            ])
            ->where('active_offer.tenant_id', $tenantId)
            ->where('active_offer.capacity_pool_key', $defaultPool)
            ->where('active_offer.queue_state', EventWaitlistQueueState::Offered->value)
            ->where('active_offer.offer_expires_at', '>', now());
        $occupiedCounts = DB::query()
            ->fromSub(
                $this->adminConfirmedSubjects($tenantId, $defaultPool)->union($activeOffers),
                'occupied_subjects',
            )
            ->selectRaw('tenant_id, event_id, COUNT(*) AS occupied_count')
            ->groupBy('tenant_id', 'event_id');

        $canonicalWaitlist = DB::table('event_waitlist_entries as canonical_waitlist')
            ->select([
                'canonical_waitlist.tenant_id',
                'canonical_waitlist.event_id',
                'canonical_waitlist.user_id',
            ])
            ->where('canonical_waitlist.tenant_id', $tenantId)
            ->where('canonical_waitlist.capacity_pool_key', $defaultPool)
            ->whereIn('canonical_waitlist.queue_state', [
                EventWaitlistQueueState::Waiting->value,
                EventWaitlistQueueState::Offered->value,
            ]);
        $legacyWaitlist = DB::table('event_waitlist as legacy_waitlist')
            ->select([
                'legacy_waitlist.tenant_id',
                'legacy_waitlist.event_id',
                'legacy_waitlist.user_id',
            ])
            ->where('legacy_waitlist.tenant_id', $tenantId)
            ->where('legacy_waitlist.status', 'waiting')
            ->whereNotExists(static function ($canonical) use ($defaultPool): void {
                $canonical->selectRaw('1')
                    ->from('event_waitlist_entries as canonical_waitlist')
                    ->whereColumn(
                        'canonical_waitlist.tenant_id',
                        'legacy_waitlist.tenant_id',
                    )
                    ->whereColumn(
                        'canonical_waitlist.event_id',
                        'legacy_waitlist.event_id',
                    )
                    ->whereColumn(
                        'canonical_waitlist.user_id',
                        'legacy_waitlist.user_id',
                    )
                    ->where('canonical_waitlist.capacity_pool_key', $defaultPool);
            });
        $waitlistCounts = DB::query()
            ->fromSub($canonicalWaitlist->union($legacyWaitlist), 'waitlist_subjects')
            ->selectRaw('tenant_id, event_id, COUNT(*) AS waitlist_count')
            ->groupBy('tenant_id', 'event_id');
        $attendanceCounts = DB::table('event_attendance')
            ->where('tenant_id', $tenantId)
            ->selectRaw('tenant_id, event_id, COUNT(*) AS attendance_count')
            ->groupBy('tenant_id', 'event_id');

        return DB::table('events as e')
            ->leftJoin('users as u', static function ($join): void {
                $join->on('u.id', '=', 'e.user_id')->on('u.tenant_id', '=', 'e.tenant_id');
            })
            ->leftJoin('groups as g', static function ($join): void {
                $join->on('g.id', '=', 'e.group_id')->on('g.tenant_id', '=', 'e.tenant_id');
            })
            ->leftJoin('categories as c', static function ($join): void {
                $join->on('c.id', '=', 'e.category_id')->on('c.tenant_id', '=', 'e.tenant_id');
            })
            ->leftJoinSub($engagementCounts, 'ec', static function ($join): void {
                $join->on('ec.event_id', '=', 'e.id')->on('ec.tenant_id', '=', 'e.tenant_id');
            })
            ->leftJoinSub($confirmedCounts, 'rc', static function ($join): void {
                $join->on('rc.event_id', '=', 'e.id')->on('rc.tenant_id', '=', 'e.tenant_id');
            })
            ->leftJoinSub($occupiedCounts, 'oc', static function ($join): void {
                $join->on('oc.event_id', '=', 'e.id')->on('oc.tenant_id', '=', 'e.tenant_id');
            })
            ->leftJoinSub($waitlistCounts, 'wc', static function ($join): void {
                $join->on('wc.event_id', '=', 'e.id')->on('wc.tenant_id', '=', 'e.tenant_id');
            })
            ->leftJoinSub($attendanceCounts, 'ac', static function ($join): void {
                $join->on('ac.event_id', '=', 'e.id')->on('ac.tenant_id', '=', 'e.tenant_id');
            })
            ->where('e.tenant_id', $tenantId)
            ->select([
                'e.id',
                'e.user_id',
                'e.parent_event_id',
                'e.is_recurring_template',
                'e.group_id',
                'e.category_id',
                'e.title',
                'e.description',
                'e.status',
                'e.publication_status',
                'e.operational_status',
                'e.lifecycle_version',
                'e.start_time',
                'e.end_time',
                'e.timezone',
                'e.all_day',
                'e.location',
                'e.max_attendees',
                'e.lifecycle_reason',
                'e.moderation_submitted_at',
                'e.moderation_submitted_by',
                'e.moderated_at',
                'e.moderated_by',
                'e.moderation_reason',
                'e.created_at',
                'e.updated_at',
                'u.name as organizer_name',
                'g.name as group_name',
                'c.name as category_name',
            ])
            ->selectRaw('COALESCE(rc.confirmed_count, 0) AS confirmed_count')
            ->selectRaw('COALESCE(oc.occupied_count, 0) AS capacity_occupied_count')
            ->selectRaw('COALESCE(ec.interested_count, 0) AS interested_count')
            ->selectRaw('COALESCE(ec.legacy_attended_count, 0) AS legacy_attended_count')
            ->selectRaw('COALESCE(wc.waitlist_count, 0) AS waitlist_count')
            ->selectRaw('COALESCE(ac.attendance_count, 0) AS attendance_count')
            ->selectRaw(
                '(SELECT COUNT(*) FROM events series_occurrence'
                . ' WHERE series_occurrence.tenant_id = e.tenant_id'
                . ' AND series_occurrence.parent_event_id = e.id) AS occurrence_count'
            )
            ->selectRaw(
                '(SELECT COUNT(*) FROM events future_series_occurrence'
                . ' WHERE future_series_occurrence.tenant_id = e.tenant_id'
                . ' AND future_series_occurrence.parent_event_id = e.id'
                . ' AND future_series_occurrence.start_time >= NOW()) AS future_occurrence_count'
            );
    }

    private function adminConfirmedSubjects(int $tenantId, string $defaultPool): Builder
    {
        $canonicalConfirmed = DB::table('event_registrations as canonical_registration')
            ->select([
                'canonical_registration.tenant_id',
                'canonical_registration.event_id',
                'canonical_registration.user_id',
            ])
            ->where('canonical_registration.tenant_id', $tenantId)
            ->where('canonical_registration.capacity_pool_key', $defaultPool)
            ->where(
                'canonical_registration.registration_state',
                EventCapacityRegistrationState::Confirmed->value,
            );
        $legacyConfirmed = DB::table('event_rsvps as legacy_registration')
            ->select([
                'legacy_registration.tenant_id',
                'legacy_registration.event_id',
                'legacy_registration.user_id',
            ])
            ->where('legacy_registration.tenant_id', $tenantId)
            ->whereIn('legacy_registration.status', ['going', 'attended'])
            ->whereNotExists(static function ($canonical) use ($defaultPool): void {
                $canonical->selectRaw('1')
                    ->from('event_registrations as canonical_registration')
                    ->whereColumn(
                        'canonical_registration.tenant_id',
                        'legacy_registration.tenant_id',
                    )
                    ->whereColumn(
                        'canonical_registration.event_id',
                        'legacy_registration.event_id',
                    )
                    ->whereColumn(
                        'canonical_registration.user_id',
                        'legacy_registration.user_id',
                    )
                    ->where('canonical_registration.capacity_pool_key', $defaultPool);
            });

        return $canonicalConfirmed->union($legacyConfirmed);
    }

    private function adminEventResource(int $eventId, int $tenantId): ?array
    {
        $row = $this->adminEventQuery($tenantId)->where('e.id', $eventId)->first();

        return $row === null ? null : AdminEventResource::fromRow($row);
    }

    private function applyPublicationFilter(Builder $query, EventPublicationState $state): void
    {
        $query->where(static function (Builder $builder) use ($state): void {
            $builder->where('e.publication_status', $state->value);
            if ($state === EventPublicationState::Draft) {
                $builder->orWhere(static fn (Builder $fallback) => $fallback
                    ->whereNull('e.publication_status')->where('e.status', 'draft'));
            } elseif ($state === EventPublicationState::Published) {
                $builder->orWhere(static fn (Builder $fallback) => $fallback
                    ->whereNull('e.publication_status')
                    ->where(static fn (Builder $legacy) => $legacy
                        ->whereNull('e.status')
                        ->orWhereIn('e.status', ['active', 'cancelled', 'completed'])));
            }
        });
    }

    private function applyOperationalFilter(Builder $query, EventOperationalState $state): void
    {
        $query->where(static function (Builder $builder) use ($state): void {
            $builder->where('e.operational_status', $state->value);
            $legacyStatuses = match ($state) {
                EventOperationalState::Scheduled => ['active', 'draft'],
                EventOperationalState::Cancelled => ['cancelled'],
                EventOperationalState::Completed => ['completed'],
                EventOperationalState::Postponed => [],
            };
            if ($legacyStatuses !== []) {
                $builder->orWhere(static function (Builder $fallback) use ($legacyStatuses, $state): void {
                    $fallback->whereNull('e.operational_status')
                        ->where(static function (Builder $legacy) use ($legacyStatuses, $state): void {
                            $legacy->whereIn('e.status', $legacyStatuses);
                            if ($state === EventOperationalState::Scheduled) {
                                $legacy->orWhereNull('e.status');
                            }
                        });
                });
            }
        });
    }

    /** @return array{0:User,1:object|null} */
    private function actorAndSnapshot(int $eventId): array
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        // The ACTOR is looked up by id alone: a tenant super admin working in a
        // community below its own has its account row in its home community
        // (owner rule, 12 Oct 2026). CrossTenantEntry decides whether that row may
        // act here; the event below stays confined to this community.
        /** @var User|null $actor */
        $actor = User::withoutGlobalScopes()->whereKey($adminId)->first();
        if ($actor === null || ! CrossTenantEntry::actorMayActIn($actor, (int) $tenantId)) {
            throw (new \Illuminate\Database\Eloquent\ModelNotFoundException())->setModel(User::class, [$adminId]);
        }
        // From another community (a tenant super admin above, or the platform
        // owner), the change is made by the admin's DELEGATE here: event records
        // may only name an account of the event's own community (owner, 12 Oct
        // 2026, option 3; register O-209).
        if ((int) $actor->tenant_id !== (int) $tenantId) {
            $actor = CrossTenantEntry::activeActor((int) $adminId, (int) $tenantId);
            if ($actor === null) {
                throw (new \Illuminate\Database\Eloquent\ModelNotFoundException())->setModel(User::class, [$adminId]);
            }
        }
        $snapshot = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->select([
                'id', 'tenant_id', 'user_id', 'title', 'start_time', 'location', 'status',
                'publication_status', 'operational_status', 'lifecycle_version', 'parent_event_id',
                'is_recurring_template',
            ])
            ->first();

        return [$actor, $snapshot];
    }

    /** @return array{publication:EventPublicationState,operational:EventOperationalState} */
    private function snapshotLifecycle(object $snapshot): array
    {
        return EventLifecycleCompatibility::resolve(
            is_string($snapshot->publication_status) ? $snapshot->publication_status : null,
            is_string($snapshot->operational_status) ? $snapshot->operational_status : null,
            is_string($snapshot->status) ? $snapshot->status : null,
        );
    }

    /**
     * @return array{result:EventLifecycleTransitionResult,series:array<string,mixed>}|JsonResponse
     */
    private function performSeriesLifecycleTransition(
        Event $event,
        User $actor,
        string $action,
        ?string $reason,
    ): array|JsonResponse {
        try {
            return EventService::transitionLifecycleTargets($event, $actor, $action, $reason);
        } catch (EventLifecycleTransitionException $exception) {
            return match ($exception->reasonCode) {
                'event_lifecycle_event_not_found' => $this->respondWithError(
                    'NOT_FOUND',
                    __('api.event_not_found'),
                    null,
                    404,
                ),
                'event_lifecycle_authorization_denied' => $this->respondWithError(
                    'FORBIDDEN',
                    __('api.admin_access_required'),
                    null,
                    403,
                ),
                'event_lifecycle_reason_too_long' => $this->respondWithError(
                    'VALIDATION_INVALID_REASON',
                    __('api.invalid_status'),
                    'reason',
                    422,
                ),
                default => $this->respondWithError(
                    'EVENT_LIFECYCLE_CONFLICT',
                    __('api.invalid_status'),
                    null,
                    409,
                ),
            };
        }
    }

    /**
     * @param callable():array{result:EventLifecycleTransitionResult,series:array<string,mixed>} $transition
     * @return array{result:EventLifecycleTransitionResult,series:array<string,mixed>}|JsonResponse
     */
    private function performPublicationTransition(callable $transition): array|JsonResponse
    {
        try {
            return $transition();
        } catch (EventLifecycleTransitionException $exception) {
            return match ($exception->reasonCode) {
                'event_lifecycle_event_not_found' => $this->respondWithError(
                    'NOT_FOUND',
                    __('api.event_not_found'),
                    null,
                    404,
                ),
                'event_lifecycle_authorization_denied' => $this->respondWithError(
                    'FORBIDDEN',
                    __('api.admin_access_required'),
                    null,
                    403,
                ),
                'event_lifecycle_reason_too_long' => $this->respondWithError(
                    'VALIDATION_INVALID_REASON',
                    __('api.invalid_status'),
                    'reason',
                    422,
                ),
                default => $this->respondWithError(
                    'EVENT_LIFECYCLE_CONFLICT',
                    __('api.invalid_status'),
                    null,
                    409,
                ),
            };
        }
    }

    private function transitionResponse(
        int $eventId,
        EventLifecycleTransitionResult $result,
        string $action,
        ?array $series = null,
    ): JsonResponse {
        $tenantId = (int) $result->event->getAttribute('tenant_id');
        $resource = $this->adminEventResource($eventId, $tenantId);
        if ($resource === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }
        $resource['transition'] = [
            'action' => $action,
            'changed' => $result->changed,
            'history_id' => $result->historyId,
            'outbox_id' => $result->outboxId,
            'cascade' => $result->cascade,
        ];
        if ($series !== null) {
            $resource['transition']['series'] = $series;
        }

        return $this->respondWithData($resource);
    }

    private function notifyOrganizerApproved(object $snapshot, int $adminId): void
    {
        $organizerId = (int) $snapshot->user_id;
        if ($organizerId <= 0 || $organizerId === $adminId) {
            return;
        }
        try {
            $tenantId = (int) $snapshot->tenant_id;
            $recipient = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', $organizerId)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->select(['id', 'preferred_language'])
                ->first();
            if ($recipient === null) {
                return;
            }
            LocaleContext::withLocale($recipient, function () use ($organizerId, $snapshot, $tenantId): void {
                $message = __('api_controllers_3.admin_bells.event_approved');
                $path = '/events/' . (int) $snapshot->id;
                Notification::createNotification(
                    $organizerId,
                    $message,
                    $path,
                    'info',
                    false,
                    $tenantId,
                );
                NotificationDispatcher::fanOutPush($organizerId, 'info', $message, $path);
            });
        } catch (\Throwable $exception) {
            Log::warning('Admin event approval notification failed', [
                'event_id' => (int) $snapshot->id,
                'user_id' => $organizerId,
                'error' => $exception->getMessage(),
            ]);
        }
    }

    private function notifyCancellation(
        EventLifecycleTransitionResult $result,
        object $snapshot,
        int $adminId,
        ?string $reason,
    ): void {
        $recipientIds = $result->affectedRecipientUserIds;
        $organizerId = (int) $snapshot->user_id;
        if ($organizerId > 0 && $organizerId !== $adminId) {
            $recipientIds[] = $organizerId;
        }
        try {
            $this->notifications->notifyCancellation(
                (int) $snapshot->tenant_id,
                (int) $snapshot->id,
                $reason,
                array_values(array_unique($recipientIds)),
            );
        } catch (\Throwable $exception) {
            Log::warning('Admin event cancellation notification failed', [
                'event_id' => (int) $snapshot->id,
                'error' => $exception->getMessage(),
            ]);
        }
    }

    private function directSideEffectsEnabled(EventLifecycleTransitionResult $result): bool
    {
        return in_array($result->deliveryMode, [
            EventNotificationDeliveryMode::Direct->value,
            EventNotificationDeliveryMode::ShadowOutbox->value,
        ], true);
    }

    private function notifyScheduleChanged(object $snapshot, int $adminId): void
    {
        try {
            $tenantId = (int) $snapshot->tenant_id;
            $this->notifications->notifyEventUpdated((int) $snapshot->id, [
                'start_time' => $snapshot->start_time,
            ]);
            $organizerId = (int) $snapshot->user_id;
            if ($organizerId <= 0 || $organizerId === $adminId) {
                return;
            }
            $recipient = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', $organizerId)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->select(['id', 'preferred_language'])
                ->first();
            if ($recipient === null) {
                return;
            }
            LocaleContext::withLocale($recipient, function () use ($organizerId, $snapshot, $tenantId): void {
                $message = __('notifications.event_updated', [
                    'title' => (string) $snapshot->title,
                    'changes' => __('notifications.event_change_date_time'),
                ]);
                $path = '/events/' . (int) $snapshot->id;
                Notification::createNotification(
                    $organizerId,
                    $message,
                    $path,
                    'event_update',
                    false,
                    $tenantId,
                );
                NotificationDispatcher::fanOutPush($organizerId, 'event_update', $message, $path);
            });
        } catch (\Throwable $exception) {
            Log::warning('Admin event schedule notification failed', [
                'event_id' => (int) $snapshot->id,
                'error' => $exception->getMessage(),
            ]);
        }
    }

    private function requiredReason(): string|JsonResponse
    {
        $reason = $this->optionalReason();

        return $reason === null
            ? $this->respondWithError(
                'VALIDATION_REQUIRED_FIELD',
                __('api.missing_required_field', ['field' => 'reason']),
                'reason',
                422,
            )
            : $reason;
    }

    private function optionalReason(): ?string
    {
        $value = $this->input('reason');
        if (! is_scalar($value)) {
            return null;
        }
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    private function scalarQuery(string $key): ?string
    {
        $value = $this->query($key);
        if (! is_scalar($value)) {
            return null;
        }
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    private function positiveIntegerQuery(string $key): int|false|null
    {
        $value = $this->query($key);
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_scalar($value) || ! ctype_digit((string) $value) || (int) $value <= 0) {
            return false;
        }

        return (int) $value;
    }

    private function dateQuery(string $key): string|false|null
    {
        $value = $this->scalarQuery($key);
        if ($value === null) {
            return null;
        }
        if (! preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $matches)
            || ! checkdate((int) $matches[2], (int) $matches[3], (int) $matches[1])) {
            return false;
        }

        return $value;
    }
}
