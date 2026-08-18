<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\EventAttendanceException;
use App\Exceptions\EventParticipationException;
use App\Exceptions\EventRegistrationException;
use App\Exceptions\EventWaitlistException;
use App\Exceptions\SafeguardingPolicyException;
use App\Http\Resources\EventDetailResource;
use App\Http\Resources\EventLegacyResource;
use App\Http\Resources\EventListResource;
use App\Http\Resources\EventRegistrationResource;
use App\Http\Resources\EventRosterResource;
use App\Http\Resources\EventSeriesResource;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Services\EventAttendanceService;
use App\Services\EventConfigurationService;
use App\Services\EventNotificationDeliveryModeResolver;
use App\Services\EventRegistrationService;
use App\Services\EventService;
use App\Services\EventNotificationService;
use App\Services\EventPublicationWorkflowService;
use App\Services\EventWaitlistService;
use App\Services\EventReminderPreferenceService;
use App\Services\EventReminderScheduleService;
use App\Enums\EventNotificationDeliveryMode;
use App\Support\Events\EventAttendanceResult;
use App\Support\Events\EventLifecycleCompatibility;
use App\Http\Resources\PublicEventResource;
use App\Models\Poll;
use Illuminate\Http\JsonResponse;
use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * EventsController - CRUD for community events, RSVPs, waitlist, series, recurring.
 *
 * All methods use Laravel DI services — no legacy static calls.
 */
class EventsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventService $eventService,
        private readonly EventNotificationService $eventNotificationService,
        private readonly EventAttendanceService $eventAttendanceService,
        private readonly EventRegistrationService $eventRegistrationService,
        private readonly EventWaitlistService $eventWaitlistService,
        private readonly EventPolicy $eventPolicy,
        private readonly EventReminderPreferenceService $eventReminderPreferences,
        private readonly EventReminderScheduleService $eventReminderSchedules,
        private readonly EventPublicationWorkflowService $eventPublicationWorkflow,
        private readonly EventConfigurationService $eventConfiguration,
    ) {}

    private function eventContractVersion(): int
    {
        $requested = trim((string) request()->headers->get('X-Events-Contract', ''));

        return $requested === (string) config('events.contract.canonical_version', 2) ? 2 : 1;
    }

    private function usesCanonicalEventContract(): bool
    {
        return $this->eventContractVersion() === 2;
    }

    private function legacyRegistrationActor(int $userId): User
    {
        $actor = User::withoutGlobalScopes()
            ->where('tenant_id', (int) TenantContext::getId())
            ->whereKey($userId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first();
        if ($actor === null) {
            throw new EventRegistrationException('event_registration_actor_invalid');
        }

        return $actor;
    }

    private function legacyCompatibilityIdempotencyKey(): ?string
    {
        $key = request()->header('Idempotency-Key');
        if ($key === null || trim($key) === '') {
            return null;
        }
        $key = trim($key);
        if (mb_strlen($key) > 191) {
            throw new EventRegistrationException('event_registration_idempotency_key_invalid');
        }

        return $key;
    }

    private function legacyWaitlistedResponse(
        int $eventId,
        int $userId,
        int $position,
    ): JsonResponse {
        $event = $this->eventService->getById($eventId, $userId);
        $payload = [
            'status' => 'waitlisted',
            'waitlist_position' => $position,
            'rsvp_counts' => $event['rsvp_counts'] ?? ['going' => 0, 'interested' => 0],
            'message' => __('api.event_full_waitlisted_msg'),
        ];

        return $this->respondWithData(
            $event !== null
                ? $this->serializeRegistration($event, $userId, $payload)
                : $payload,
        );
    }

    private function legacyRsvpFailureResponse(): JsonResponse
    {
        $errors = $this->eventService->getErrors();
        $httpStatus = 422;
        foreach ($errors as $error) {
            if (($error['code'] ?? null) === 'NOT_FOUND') {
                $httpStatus = 404;
                break;
            }
            if (($error['code'] ?? null) === 'EVENT_CANCELLED') {
                $httpStatus = 409;
                break;
            }
            if (($error['code'] ?? null) === 'KISS_TREFFEN_MEMBERS_ONLY') {
                $httpStatus = 403;
                break;
            }
        }

        return $this->respondWithErrors($errors, $httpStatus);
    }

    private function legacyCanonicalMutationError(
        EventRegistrationException|EventWaitlistException|EventParticipationException $exception,
        string $operation,
    ): JsonResponse {
        return match ($exception->reasonCode) {
            'event_registration_event_not_found',
            'event_waitlist_event_not_found',
            'event_registration_concrete_occurrence_required',
            'event_waitlist_concrete_occurrence_required',
            'event_registration_event_unavailable',
            'event_waitlist_event_unavailable' => $operation === 'remove_rsvp'
                ? $this->respondWithErrors([[
                    'code' => 'NOT_FOUND',
                    'message' => __('api.event_not_found'),
                ]], 400)
                : $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404),
            'event_registration_kiss_treffen_members_only' => $this->respondWithError(
                'KISS_TREFFEN_MEMBERS_ONLY',
                __('api.caring_kiss_treffen_members_only_rsvp'),
                null,
                403,
            ),
            'event_participation_kiss_treffen_members_only' => $this->respondWithError(
                'KISS_TREFFEN_MEMBERS_ONLY',
                __('api.caring_kiss_treffen_members_only_rsvp'),
                null,
                403,
            ),
            'event_participation_audience_denied',
            'event_participation_organizer_invalid',
            'event_participation_scope_invalid' => $this->respondWithError(
                'NOT_FOUND',
                __('api.event_not_found'),
                null,
                404,
            ),
            'event_participation_safety_denied' => $this->respondWithError(
                'EVENT_SAFETY_ACTION_REQUIRED',
                __('event_registration.safety_requirements_not_met'),
                null,
                409,
            ),
            'event_participation_safety_unavailable' => $this->respondWithError(
                'EVENT_SAFETY_UNAVAILABLE',
                __('event_registration.safety_unavailable'),
                null,
                503,
            ),
            'event_registration_idempotency_key_invalid',
            'event_waitlist_idempotency_key_invalid' => $this->respondWithError(
                'VALIDATION_ERROR',
                __('event_registration.idempotency_invalid'),
                'Idempotency-Key',
                422,
            ),
            'event_registration_event_started',
            'event_waitlist_event_started' => $this->respondWithError(
                'EVENT_ENDED',
                __('svc_notifications_2.event.rsvp_ended'),
                null,
                422,
            ),
            'event_waitlist_capacity_available',
            'event_waitlist_finite_capacity_required',
            'event_waitlist_registration_confirmed' => $this->respondWithError(
                'WAITLIST_FAILED',
                __('api.event_waitlist_failed'),
                null,
                400,
            ),
            'event_registration_offer_acceptance_required' => $this->respondWithError(
                'RSVP_FAILED',
                __('api.event_rsvp_update_failed'),
                null,
                409,
            ),
            default => $this->respondWithError(
                $operation === 'waitlist' ? 'WAITLIST_FAILED' : 'RSVP_FAILED',
                $operation === 'waitlist'
                    ? __('api.event_waitlist_failed')
                    : __('api.event_rsvp_update_failed'),
                null,
                $operation === 'waitlist' ? 400 : 422,
            ),
        };
    }

    private function discoveryValidationResponse(ValidationException $exception): JsonResponse
    {
        $errors = $exception->errors();
        $field = array_key_first($errors);
        $message = $field !== null && isset($errors[$field][0])
            ? (string) $errors[$field][0]
            : __('api.invalid_cursor');

        return $this->respondWithError('VALIDATION_ERROR', $message, $field, 422);
    }

    private function attendanceActor(int $userId): User
    {
        $actor = User::withoutGlobalScopes()
            ->where('tenant_id', (int) TenantContext::getId())
            ->whereKey($userId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first();

        if ($actor === null) {
            throw new EventAttendanceException('event_attendance_authorization_denied');
        }

        return $actor;
    }

    private function attendanceIdempotencyKey(): ?string
    {
        $header = request()->header('Idempotency-Key');
        if (is_string($header) && trim($header) !== '') {
            return $header;
        }
        if ($header !== null && ! is_string($header)) {
            throw new EventAttendanceException('event_attendance_idempotency_key_invalid');
        }

        $input = $this->input('idempotency_key');
        if ($input === null || $input === '') {
            return null;
        }
        if (! is_string($input)) {
            throw new EventAttendanceException('event_attendance_idempotency_key_invalid');
        }

        return $input;
    }

    private function attendanceHours(): ?float
    {
        $hours = $this->input('hours');
        if ($hours === null || $hours === '') {
            return null;
        }
        if ((! is_int($hours) && ! is_float($hours) && ! is_string($hours))
            || ! is_numeric((string) $hours)) {
            throw new EventAttendanceException('event_attendance_hours_invalid');
        }

        $value = (float) $hours;
        if (! is_finite($value)) {
            throw new EventAttendanceException('event_attendance_hours_invalid');
        }

        return $value;
    }

    private function attendanceNotes(): ?string
    {
        $notes = $this->input('notes');
        if ($notes === null) {
            return null;
        }
        if (! is_string($notes)) {
            throw new EventAttendanceException('event_attendance_subject_invalid');
        }

        return $notes;
    }

    /** @return array<string,mixed> */
    private function attendanceResultData(EventAttendanceResult $result): array
    {
        $data = $result->toArray();
        $alreadyCheckedIn = $result->outcome === 'already_checked_in';

        return [
            'attendance_id' => $data['attendance_id'],
            'event_id' => $data['event_id'],
            'user_id' => $data['user_id'],
            'attendee_id' => $data['user_id'],
            'outcome' => $result->outcome,
            'checked_in' => (bool) $data['checked_in'],
            'marked' => $result->outcome === 'checked_in',
            'already_checked_in' => $alreadyCheckedIn,
            'replayed' => $alreadyCheckedIn,
            'checked_in_at' => $data['checked_in_at'],
            'credit_status' => $data['credit_status'],
            'hours_credited' => $data['hours_credited'],
            'attendance_version' => $data['attendance_version'],
        ];
    }

    /** @return array{code:string,message:string,status:int,field:string|null} */
    private function attendanceError(EventAttendanceException $exception): array
    {
        return match ($exception->reasonCode) {
            'event_attendance_event_not_found',
            'event_attendance_concrete_occurrence_required' => [
                'code' => 'NOT_FOUND',
                'message' => __('api.event_not_found'),
                'status' => 404,
                'field' => null,
            ],
            'event_attendance_authorization_denied' => [
                'code' => 'FORBIDDEN',
                'message' => __('api.event_attendance_forbidden'),
                'status' => 403,
                'field' => null,
            ],
            'event_attendance_attendee_not_found' => [
                'code' => 'NOT_FOUND',
                'message' => __('api.user_not_found'),
                'status' => 404,
                'field' => 'user_id',
            ],
            'event_attendance_registration_required' => [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.event_not_rsvped'),
                'status' => 422,
                'field' => 'user_id',
            ],
            'event_attendance_too_early' => [
                'code' => 'TOO_EARLY',
                'message' => __('api.event_too_early_checkin'),
                'status' => 422,
                'field' => null,
            ],
            'event_attendance_window_closed' => [
                'code' => 'EVENT_ENDED',
                'message' => __('api.event_ended_checkin'),
                'status' => 422,
                'field' => null,
            ],
            'event_attendance_event_unavailable' => [
                'code' => 'EVENT_UNAVAILABLE',
                'message' => __('api.event_checkin_failed'),
                'status' => 409,
                'field' => null,
            ],
            'event_attendance_idempotency_conflict' => [
                'code' => 'IDEMPOTENCY_CONFLICT',
                'message' => __('api.event_checkin_failed'),
                'status' => 409,
                'field' => 'idempotency_key',
            ],
            'event_attendance_idempotency_key_invalid' => [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.invalid_input'),
                'status' => 422,
                'field' => 'idempotency_key',
            ],
            'event_attendance_hours_invalid' => [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.invalid_amount'),
                'status' => 422,
                'field' => 'hours',
            ],
            'event_attendance_hours_unavailable' => [
                'code' => 'HOURS_OVERRIDE_UNAVAILABLE',
                'message' => __('api.event_checkin_failed'),
                'status' => 422,
                'field' => 'hours',
            ],
            'event_attendance_notes_too_long' => [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.invalid_input'),
                'status' => 422,
                'field' => 'notes',
            ],
            'event_attendance_subject_invalid',
            'event_attendance_schedule_invalid' => [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.invalid_input'),
                'status' => 422,
                'field' => null,
            ],
            default => [
                'code' => 'CHECKIN_ERROR',
                'message' => __('api.event_checkin_failed'),
                'status' => 500,
                'field' => null,
            ],
        };
    }

    private function attendanceErrorResponse(EventAttendanceException $exception): JsonResponse
    {
        $error = $this->attendanceError($exception);

        return $this->respondWithError(
            $error['code'],
            $error['message'],
            $error['field'],
            $error['status'],
        );
    }

    private function lifecycleReason(bool $required): string|JsonResponse|null
    {
        $value = $this->input('reason');
        if ($value !== null && ! is_scalar($value)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_input'),
                'reason',
                422,
            );
        }

        $reason = $value === null ? null : trim((string) $value);
        if ($reason === '') {
            $reason = null;
        }
        if ($required && $reason === null) {
            return $this->respondWithError(
                'VALIDATION_REQUIRED_FIELD',
                __('api.missing_required_field', ['field' => 'reason']),
                'reason',
                422,
            );
        }
        if ($reason !== null && mb_strlen($reason) > 4000) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_input'),
                'reason',
                422,
            );
        }

        return $reason;
    }

    private function archiveReasonRequired(int $eventId, int $userId): bool
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null) {
            return false;
        }
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->first();
        $actor = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($userId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first();
        if ($event === null || $actor === null || ! $this->eventPolicy->manage($actor, $event)) {
            return false;
        }

        try {
            $lifecycle = EventLifecycleCompatibility::resolve(
                is_string($event->getRawOriginal('publication_status'))
                    ? $event->getRawOriginal('publication_status')
                    : null,
                is_string($event->getRawOriginal('operational_status'))
                    ? $event->getRawOriginal('operational_status')
                    : null,
                is_string($event->getRawOriginal('status'))
                    ? $event->getRawOriginal('status')
                    : null,
            );
            if ($lifecycle['publication']->value === 'published') {
                return true;
            }
        } catch (\Throwable) {
            return true;
        }

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
                ->whereIn('status', ['going', 'interested', 'maybe', 'invited', 'waitlisted'])
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

    private function lifecycleIdempotencyKey(): string|JsonResponse|null
    {
        $header = request()->header('Idempotency-Key');
        if (is_string($header) && trim($header) !== '') {
            return trim($header);
        }
        if ($header !== null && ! is_string($header)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_input'),
                'idempotency_key',
                422,
            );
        }

        $input = $this->input('idempotency_key');
        if ($input === null || $input === '') {
            return null;
        }
        if (! is_string($input)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_input'),
                'idempotency_key',
                422,
            );
        }

        $input = trim($input);

        return $input === '' ? null : $input;
    }

    private function lifecycleFailureResponse(string $action): JsonResponse
    {
        $errors = $this->eventService->getErrors();
        if ($errors === []) {
            return $this->respondWithError(
                'SERVER_ERROR',
                $action === 'cancel'
                    ? __('api.event_cancel_failed')
                    : __('api.delete_failed', ['resource' => 'event']),
                null,
                500,
            );
        }

        $code = (string) ($errors[0]['code'] ?? '');
        $status = match ($code) {
            'NOT_FOUND' => 404,
            'FORBIDDEN' => 403,
            'EVENT_LIFECYCLE_CONFLICT', 'ALREADY_CANCELLED' => 409,
            'VALIDATION_ERROR', 'VALIDATION_REQUIRED_FIELD' => 422,
            'SERVER_ERROR' => 500,
            default => 400,
        };

        return $this->respondWithErrors($errors, $status);
    }

    /** @return array<string,mixed>|null */
    private function lifecycleResponseData(): ?array
    {
        return $this->eventService->getLastLifecycleResponse();
    }

    /** @return array<int, array<string, mixed>> */
    private function contractFacts(array $events, int $viewerId): array
    {
        return $this->eventService->getContractFacts($events, $viewerId);
    }

    /** @return array<string, mixed> */
    private function serializeListEvent(array $event, array $facts): array
    {
        if ($this->usesCanonicalEventContract()) {
            return EventListResource::fromArray($event, $facts);
        }

        return PublicEventResource::augment(EventLegacyResource::fromArray($event));
    }

    /** @return array<string, mixed> */
    private function serializeDetailEvent(array $event, array $facts): array
    {
        if ($this->usesCanonicalEventContract()) {
            return EventDetailResource::fromArray($event, $facts);
        }

        return PublicEventResource::augment(EventLegacyResource::fromArray($event));
    }

    /** @return array<string, mixed> */
    private function serializeRegistration(array $event, int $viewerId, array $legacyPayload): array
    {
        if (!$this->usesCanonicalEventContract()) {
            return $legacyPayload;
        }

        $facts = $this->contractFacts([$event], $viewerId);

        return EventRegistrationResource::fromArray(
            $event,
            $facts[(int) $event['id']] ?? [],
            $legacyPayload
        );
    }

    // ================================================================
    // LIST / SHOW
    // ================================================================

    /**
     * GET /api/v2/events
     */
    public function index(): JsonResponse
    {
        $userId = $this->requireAuth();

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
            'when'  => $this->query('when', 'upcoming'),
            'viewer_id' => $userId,
        ];

        if ($this->query('category_id') !== null) {
            $filters['category_id'] = $this->query('category_id');
        } elseif ($this->query('category') !== null) {
            $filters['category'] = $this->query('category');
        }
        if ($this->query('series_id') !== null) {
            $filters['series_id'] = $this->query('series_id');
        }
        if ($this->query('group_id') !== null) {
            $filters['group_id'] = $this->query('group_id');
        }
        if ($this->query('user_id') !== null) {
            $filters['user_id'] = $this->query('user_id');
        }
        if ($this->query('q') !== null) {
            $filters['search'] = $this->query('q');
        }
        if ($this->query('step_free') !== null) {
            $filters['step_free'] = $this->query('step_free');
        }
        if ($this->query('cursor') !== null) {
            $filters['cursor'] = $this->query('cursor');
        }

        // Proximity / radius filter (near_lat, near_lng, radius_km)
        $nearLat = $this->query('near_lat');
        $nearLng = $this->query('near_lng');
        $radiusKm = $this->query('radius_km');
        if ($nearLat !== null || $nearLng !== null || $radiusKm !== null) {
            $filters['near_lat'] = $nearLat;
            $filters['near_lng'] = $nearLng;
            $filters['radius_km'] = $radiusKm ?? 25;
        }

        try {
            $result = $this->eventService->getAll($filters);
        } catch (ValidationException $exception) {
            return $this->discoveryValidationResponse($exception);
        }

        // Batch-load user RSVP statuses (single query instead of N+1).
        if (!empty($result['items'])) {
            $eventIds = array_column($result['items'], 'id');
            $rsvpMap = $this->eventService->getUserRsvpsBatch($eventIds, $userId);
            foreach ($result['items'] as &$event) {
                $event['user_rsvp'] = $rsvpMap[(int) $event['id']] ?? null;
            }
            unset($event);
        }

        $factsById = $this->usesCanonicalEventContract()
            ? $this->contractFacts($result['items'], $userId)
            : [];
        $items = [];
        foreach ($result['items'] as $event) {
            $items[] = $this->serializeListEvent($event, $factsById[(int) $event['id']] ?? []);
        }

        return $this->respondWithCollection(
            $items,
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    /**
     * GET /api/v2/events/{id}
     */
    public function show(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $event = $this->eventService->getById($id, $userId);

        if (!$event) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        $facts = $this->usesCanonicalEventContract()
            ? $this->contractFacts([$event], $userId)
            : [];

        return $this->respondWithData(
            $this->serializeDetailEvent($event, $facts[$id] ?? [])
        );
    }

    /**
     * GET /api/v2/events/nearby
     */
    public function nearby(): JsonResponse
    {
        $userId = $this->requireAuth();
        $lat = $this->query('lat');
        $lon = $this->query('lon');

        if ($lat === null || $lon === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_lat_lon_required'), null, 400);
        }

        if (!is_scalar($lat) || !is_numeric((string) $lat)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_lat_range'), 'lat', 400);
        }
        if (!is_scalar($lon) || !is_numeric((string) $lon)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_lon_range'), 'lon', 400);
        }

        $lat = (float) $lat;
        $lon = (float) $lon;

        if ($lat < -90 || $lat > 90) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_lat_range'), 'lat', 400);
        }
        if ($lon < -180 || $lon > 180) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_lon_range'), 'lon', 400);
        }

        $filters = [
            'radius_km' => $this->query('radius_km', '25'),
            'limit'     => $this->queryInt('per_page', 20, 1, 100),
        ];

        if ($this->query('category_id') !== null) {
            $filters['category_id'] = $this->query('category_id');
        } elseif ($this->query('category') !== null) {
            $filters['category'] = $this->query('category');
        }
        if ($this->query('series_id') !== null) {
            $filters['series_id'] = $this->query('series_id');
        }
        if ($this->query('cursor') !== null) {
            $filters['cursor'] = $this->query('cursor');
        }

        try {
            $result = $this->eventService->getNearby($lat, $lon, $filters, $userId);
        } catch (ValidationException $exception) {
            return $this->discoveryValidationResponse($exception);
        }

        $items = $result['items'];
        if ($this->usesCanonicalEventContract()) {
            $factsById = $this->contractFacts($items, $userId);
            $items = array_map(
                fn (array $event): array => $this->serializeListEvent(
                    $event,
                    $factsById[(int) $event['id']] ?? []
                ),
                $items
            );
        }

        return $this->respondWithData($items, [
            'search' => [
                'type'      => 'nearby',
                'lat'       => $lat,
                'lon'       => $lon,
                'radius_km' => $filters['radius_km'],
            ],
            'per_page' => $filters['limit'],
            'has_more' => $result['has_more'],
            'cursor' => $result['cursor'],
        ]);
    }

    // ================================================================
    // CREATE / UPDATE / DELETE
    // ================================================================

    /**
     * POST /api/v2/events
     */
    public function store(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('events_create', 10, 60);

        $tenantId = (int) TenantContext::getId();
        if (! $this->eventConfiguration->canCreate($tenantId, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.events_creation_not_allowed'), null, 403);
        }

        $data = $this->getAllInput();
        if (! array_key_exists('max_attendees', $data)) {
            $defaultCapacity = (int) $this->eventConfiguration->value('default_capacity', 0, $tenantId);
            if ($defaultCapacity > 0) {
                $data['max_attendees'] = $defaultCapacity;
            }
        }

        $pollIds = [];
        if (array_key_exists('poll_ids', $data)) {
            $pollIdsResult = $this->ownedEventPollIds($data['poll_ids'], $userId);
            if ($pollIdsResult instanceof JsonResponse) {
                return $pollIdsResult;
            }
            $pollIds = $pollIdsResult;
        }

        $result = $this->eventService->create($userId, $data);

        if ($result === null) {
            $errors = $this->eventService->getErrors();
            $status = 422;
            foreach ($errors as $error) {
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        // create() returns an Event model (Laravel) or an int ID (legacy)
        $eventId = $result instanceof \App\Models\Event ? $result->id : (int) $result;

        // Link polls to this event
        if (! empty($pollIds)) {
            Poll::query()
                ->where('tenant_id', TenantContext::getId())
                ->where('user_id', $userId)
                ->whereIn('id', $pollIds)
                ->update(['event_id' => $eventId]);
        }

        $event = $this->eventService->getById($eventId, $userId);

        $facts = $this->usesCanonicalEventContract() && $event !== null
            ? $this->contractFacts([$event], $userId)
            : [];

        return $this->respondWithData(
            $event !== null
                ? $this->serializeDetailEvent($event, $facts[$eventId] ?? [])
                : null,
            null,
            201
        );
    }

    /**
     * PUT /api/v2/events/{id}
     */
    public function update(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('events_update', 20, 60);

        $data = $this->getAllInput();

        $pollIds = null;
        if (array_key_exists('poll_ids', $data)) {
            $pollIdsResult = $this->ownedEventPollIds($data['poll_ids'], $userId);
            if ($pollIdsResult instanceof JsonResponse) {
                return $pollIdsResult;
            }
            $pollIds = $pollIdsResult;
        }

        $success = $this->eventService->update($id, $userId, $data);

        if (!$success) {
            $errors = $this->eventService->getErrors();
            $status = 422;
            foreach ($errors as $error) {
                if ($error['code'] === 'NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        // Update poll associations
        if ($pollIds !== null) {
            Poll::query()
                ->where('tenant_id', TenantContext::getId())
                ->where('user_id', $userId)
                ->where('event_id', $id)
                ->update(['event_id' => null]);

            if (! empty($pollIds)) {
                Poll::query()
                    ->where('tenant_id', TenantContext::getId())
                    ->where('user_id', $userId)
                    ->whereIn('id', $pollIds)
                    ->update(['event_id' => $id]);
            }
        }

        // Notify attendees of meaningful changes
        try {
            $meaningfulChanges = $this->eventService->getLastMeaningfulUpdateChanges();
            if (!empty($meaningfulChanges)
                && EventNotificationDeliveryModeResolver::resolve(
                    (int) TenantContext::getId(),
                ) !== EventNotificationDeliveryMode::OutboxAuthoritative) {
                $this->eventNotificationService->notifyEventUpdated($id, $meaningfulChanges);
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("Event update notification error: " . $e->getMessage());
        }

        $event = $this->eventService->getById($id, $userId);

        $facts = $this->usesCanonicalEventContract() && $event !== null
            ? $this->contractFacts([$event], $userId)
            : [];

        return $this->respondWithData(
            $event !== null
                ? $this->serializeDetailEvent($event, $facts[$id] ?? [])
                : null
        );
    }

    /** POST /api/v2/events/{id}/submit */
    public function submitForReview(int $id): JsonResponse
    {
        return $this->publicationTransition($id, 'submit_for_review');
    }

    /** POST /api/v2/events/{id}/publish */
    public function publish(int $id): JsonResponse
    {
        return $this->publicationTransition($id, 'publish');
    }

    private function publicationTransition(int $id, string $action): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('events_publish', 10, 60);
        // Auth is GLOBAL; only resources are tenant-scoped. `$userId` comes
        // from requireAuth(), so this resolves the caller's own row — a tenant
        // predicate here 403'd every actor whose home tenant differs from the
        // tenant being acted in, before the workflow could even authorize.
        /** @var User|null $actor */
        $actor = User::withoutGlobalScopes()
            ->whereKey($userId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first();
        if ($actor === null) {
            return $this->respondWithError('FORBIDDEN', __('api.event_edit_forbidden'), null, 403);
        }

        try {
            if ($action === 'submit_for_review') {
                $this->eventPublicationWorkflow->submit($id, $actor);
            } else {
                $this->eventPublicationWorkflow->publish($id, $actor);
            }
        } catch (\App\Exceptions\EventLifecycleTransitionException $exception) {
            return match ($exception->reasonCode) {
                'event_lifecycle_event_not_found' => $this->respondWithError(
                    'NOT_FOUND',
                    __('api.event_not_found'),
                    null,
                    404,
                ),
                'event_lifecycle_authorization_denied',
                'event_lifecycle_subject_invalid' => $this->respondWithError(
                    'FORBIDDEN',
                    __('api.event_edit_forbidden'),
                    null,
                    403,
                ),
                'event_publication_review_required' => $this->respondWithError(
                    'EVENT_REVIEW_REQUIRED',
                    __('api.invalid_status'),
                    null,
                    409,
                ),
                'event_publication_review_not_required' => $this->respondWithError(
                    'EVENT_REVIEW_NOT_REQUIRED',
                    __('api.invalid_status'),
                    null,
                    409,
                ),
                default => $this->respondWithError(
                    'EVENT_LIFECYCLE_CONFLICT',
                    __('api.invalid_status'),
                    null,
                    409,
                ),
            };
        }

        $event = $this->eventService->getById($id, $userId);
        if ($event === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }
        $facts = $this->usesCanonicalEventContract()
            ? $this->contractFacts([$event], $userId)
            : [];

        return $this->respondWithData($this->serializeDetailEvent($event, $facts[$id] ?? []));
    }

    /**
     * DELETE /api/v2/events/{id}
     */
    public function destroy(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('events_delete', 10, 60);

        $reason = $this->lifecycleReason($this->archiveReasonRequired($id, $userId));
        if ($reason instanceof JsonResponse) {
            return $reason;
        }
        $idempotencyKey = $this->lifecycleIdempotencyKey();
        if ($idempotencyKey instanceof JsonResponse) {
            return $idempotencyKey;
        }

        $success = $this->eventService->delete($id, $userId, $reason, $idempotencyKey);

        if (!$success) {
            return $this->lifecycleFailureResponse('archive');
        }

        $data = $this->lifecycleResponseData();
        if ($data === null) {
            return $this->respondWithError(
                'SERVER_ERROR',
                __('api.delete_failed', ['resource' => 'event']),
                null,
                500,
            );
        }

        return $this->usesCanonicalEventContract()
            ? $this->respondWithData($data)
            : $this->noContent();
    }

    private function ownedEventPollIds(mixed $pollIds, int $userId): array|JsonResponse
    {
        if (! is_array($pollIds)) {
            return $this->respondWithError('VALIDATION_ERROR', __('validation.array', ['attribute' => 'poll_ids']), 'poll_ids', 400);
        }

        $ids = array_values(array_unique(array_filter(
            array_map(static fn ($id): int => (int) $id, $pollIds),
            static fn (int $id): bool => $id > 0
        )));

        if ($ids === []) {
            return [];
        }

        $ownedCount = Poll::query()
            ->where('tenant_id', TenantContext::getId())
            ->where('user_id', $userId)
            ->whereIn('id', $ids)
            ->count();

        if ($ownedCount !== count($ids)) {
            return $this->respondWithError('FORBIDDEN', __('api.poll_not_found_or_not_owned'), 'poll_ids', 403);
        }

        return $ids;
    }

    // ================================================================
    // RSVP
    // ================================================================

    /**
     * POST /api/v2/events/{id}/rsvp
     */
    public function rsvp($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('events_rsvp', 30, 60);

        $status = $this->input('status');

        if (empty($status)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_rsvp_status_required'), 'status', 400);
        }
        if (! is_string($status)
            || ! in_array($status, ['going', 'interested', 'not_going', 'declined'], true)) {
            return $this->respondWithErrors([[
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.event_invalid_rsvp_status'),
                'field' => 'status',
            ]], 422);
        }
        if ($status === 'going'
            && ! (bool) $this->eventConfiguration->value('registration_enabled', true)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        $event = $this->eventService->getById($id, $userId);
        if ($event === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        try {
            $requestKey = $this->legacyCompatibilityIdempotencyKey();
            $actor = $this->legacyRegistrationActor($userId);
            if ($status === 'going') {
                try {
                    $registration = DB::transaction(function () use (
                        $id,
                        $userId,
                        $actor,
                        $requestKey,
                    ) {
                        $result = $this->eventRegistrationService->confirmCompatibility(
                            $id,
                            $userId,
                            $actor,
                            $requestKey,
                        );
                        $this->eventWaitlistService->withdrawCompatibility(
                            $id,
                            $userId,
                            $actor,
                            $requestKey,
                        );

                        return $result;
                    }, 5);
                } catch (EventRegistrationException $exception) {
                    if ($exception->reasonCode !== 'event_registration_capacity_full') {
                        throw $exception;
                    }
                    if (! (bool) $this->eventConfiguration->value('waitlist_enabled', true)) {
                        return $this->respondWithError('EVENT_FULL', __('api.invalid_input'), null, 409);
                    }
                    $waitlisted = $this->eventWaitlistService->joinCompatibility(
                        $id,
                        $userId,
                        $actor,
                        $requestKey,
                    );

                    return $this->legacyWaitlistedResponse(
                        $id,
                        $userId,
                        (int) $waitlisted->entry->queue_sequence,
                    );
                }

                if ($registration->changed
                    && EventNotificationDeliveryModeResolver::resolve(
                        (int) TenantContext::getId(),
                    ) === EventNotificationDeliveryMode::Direct) {
                    try {
                        $this->eventNotificationService->notifyRsvp($id, $userId, $status);
                    } catch (\Throwable $exception) {
                        \Illuminate\Support\Facades\Log::warning(
                            'RSVP notification error: ' . $exception->getMessage(),
                        );
                    }
                }
            } else {
                $success = DB::transaction(function () use (
                    $id,
                    $userId,
                    $status,
                    $actor,
                    $requestKey,
                ): bool {
                    $this->eventRegistrationService->withdrawCompatibility(
                        $id,
                        $userId,
                        $actor,
                        $requestKey,
                    );
                    $this->eventWaitlistService->withdrawCompatibility(
                        $id,
                        $userId,
                        $actor,
                        $requestKey,
                    );
                    $success = $this->eventService->rsvp($id, $userId, $status);
                    if (! $success) {
                        throw new \RuntimeException('legacy_event_rsvp_mutation_failed');
                    }

                    return true;
                }, 5);
                if (! $success) {
                    return $this->legacyRsvpFailureResponse();
                }
                if ($this->eventService->wasLastRsvpChanged()
                    && EventNotificationDeliveryModeResolver::resolve(
                        (int) TenantContext::getId(),
                    ) === EventNotificationDeliveryMode::Direct) {
                    try {
                        $this->eventNotificationService->notifyRsvp($id, $userId, $status);
                    } catch (\Throwable $exception) {
                        \Illuminate\Support\Facades\Log::warning(
                            'RSVP notification error: ' . $exception->getMessage(),
                        );
                    }
                }
            }
        } catch (SafeguardingPolicyException $exception) {
            return $this->safeguardingPolicyError($exception);
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException $exception) {
            return $this->legacyCanonicalMutationError($exception, 'rsvp');
        } catch (\RuntimeException $exception) {
            if ($exception->getMessage() === 'legacy_event_rsvp_mutation_failed') {
                return $this->legacyRsvpFailureResponse();
            }
            throw $exception;
        }

        $event = $this->eventService->getById($id, $userId);

        // Always make the idempotent claim for a going RSVP. This lets a retry
        // recover from a transient XP-write failure, while the database unique
        // key prevents duplicate awards after status cycling or RSVP recreation.
        // Routed through EngagementService so admin-defined challenges on
        // attend_event actually progress — XP is unchanged (same XP_VALUES
        // lookup), challenge progress is what the direct awardXP call lacked.
        if ($status === 'going') {
            try {
                \App\Services\EngagementService::record(
                    $userId,
                    'attend_event',
                    'event:' . $id,
                    __('govuk_alpha.profile.activity_types.event_rsvp'),
                );
            } catch (\Throwable $e) {
                \Log::warning('Gamification XP award failed', ['action' => 'attend_event', 'user' => $userId, 'error' => $e->getMessage()]);
            }
        }

        $payload = [
            'status'      => $status,
            'rsvp_counts' => $event['rsvp_counts'] ?? ['going' => 0, 'interested' => 0],
        ];

        return $this->respondWithData(
            $event !== null ? $this->serializeRegistration($event, $userId, $payload) : $payload
        );
    }

    /**
     * DELETE /api/v2/events/{id}/rsvp
     */
    public function removeRsvp($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('events_rsvp', 30, 60);

        try {
            $requestKey = $this->legacyCompatibilityIdempotencyKey();
            $actor = $this->legacyRegistrationActor($userId);
            DB::transaction(function () use ($id, $userId, $actor, $requestKey): void {
                $this->eventRegistrationService->withdrawCompatibility(
                    $id,
                    $userId,
                    $actor,
                    $requestKey,
                );
                $this->eventWaitlistService->withdrawCompatibility(
                    $id,
                    $userId,
                    $actor,
                    $requestKey,
                );
                if (! $this->eventService->removeRsvp($id, $userId)) {
                    throw new \RuntimeException('legacy_event_rsvp_remove_failed');
                }
            }, 5);
        } catch (\RuntimeException $exception) {
            if ($exception->getMessage() !== 'legacy_event_rsvp_remove_failed') {
                throw $exception;
            }

            return $this->respondWithErrors($this->eventService->getErrors(), 400);
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException $exception) {
            return $this->legacyCanonicalMutationError($exception, 'remove_rsvp');
        }

        return $this->noContent();
    }

    // ================================================================
    // ATTENDEES / CHECK-IN
    // ================================================================

    /**
     * GET /api/v2/events/{id}/attendees
     */
    public function attendees($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();

        $event = $this->eventService->getById($id, $userId);
        if (!$event) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        $filters = [
            'limit'  => $this->queryInt('per_page', 20, 1, 100),
            'status' => $this->query('status', 'going'),
        ];

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->eventService->getAttendees($id, $filters, $userId);
        $items = array_map(
            $this->usesCanonicalEventContract()
                ? static fn (array $attendee): array => EventRosterResource::fromArray($attendee)
                : static fn (array $attendee): array => EventRosterResource::legacyFromArray($attendee),
            $result['items']
        );

        return $this->respondWithCollection(
            $items,
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    /**
     * POST /api/v2/events/{id}/attendees/{attendeeId}/check-in
     */
    public function checkIn($id, $attendeeId): JsonResponse
    {
        $id = (int) $id;
        $attendeeId = (int) $attendeeId;
        $userId = $this->requireAuth();
        $this->rateLimit('events_checkin', 30, 60);

        try {
            $result = $this->eventAttendanceService->record(
                $id,
                $attendeeId,
                $this->attendanceActor($userId),
                $this->attendanceHours(),
                $this->attendanceNotes(),
                $this->attendanceIdempotencyKey(),
            );
        } catch (EventAttendanceException $exception) {
            return $this->attendanceErrorResponse($exception);
        } catch (\Throwable $exception) {
            \Log::error('Event check-in failed', [
                'event_id' => $id,
                'attendee_id' => $attendeeId,
                'actor_id' => $userId,
                'error' => $exception->getMessage(),
            ]);
            return $this->respondWithError(
                'CHECKIN_ERROR',
                __('api.event_checkin_failed'),
                null,
                500,
            );
        }

        return $this->respondWithData($this->attendanceResultData($result));
    }

    // ================================================================
    // CANCEL
    // ================================================================

    /**
     * POST /api/v2/events/{id}/cancel
     */
    public function cancel($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('events_cancel', 5, 60);

        $reason = $this->lifecycleReason(true);
        if ($reason instanceof JsonResponse) {
            return $reason;
        }
        if ($reason === null) {
            return $this->respondWithError(
                'VALIDATION_REQUIRED_FIELD',
                __('api.missing_required_field', ['field' => 'reason']),
                'reason',
                422,
            );
        }
        $idempotencyKey = $this->lifecycleIdempotencyKey();
        if ($idempotencyKey instanceof JsonResponse) {
            return $idempotencyKey;
        }

        $success = $this->eventService->cancelEvent(
            $id,
            $userId,
            $reason,
            $idempotencyKey,
        );

        if (!$success) {
            return $this->lifecycleFailureResponse('cancel');
        }

        $data = $this->lifecycleResponseData();

        return $data === null
            ? $this->respondWithError(
                'SERVER_ERROR',
                __('api.event_cancel_failed'),
                null,
                500,
            )
            : $this->respondWithData($data);
    }

    // ================================================================
    // WAITLIST
    // ================================================================

    /**
     * GET /api/v2/events/{id}/waitlist
     */
    public function waitlist($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();

        $event = $this->eventService->getById($id, $userId);
        if (!$event) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        $result = $this->eventService->getWaitlist($id, [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ], $userId);

        $userPosition = $this->eventService->getUserWaitlistPosition($id, $userId);

        return $this->respondWithData($result['items'], [
            'has_more'      => $result['has_more'],
            'user_position' => $userPosition,
        ]);
    }

    /**
     * POST /api/v2/events/{id}/waitlist
     */
    public function joinWaitlist($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('events_waitlist', 30, 60);

        if (! (bool) $this->eventConfiguration->value('waitlist_enabled', true)) {
            return $this->respondWithError('FORBIDDEN', __('api.events_waitlist_disabled'), null, 403);
        }

        $event = $this->eventService->getById($id, $userId);
        if (!$event) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        try {
            $actor = $this->legacyRegistrationActor($userId);
            $result = $this->eventWaitlistService->joinCompatibility(
                $id,
                $userId,
                $actor,
                $this->legacyCompatibilityIdempotencyKey(),
            );
        } catch (SafeguardingPolicyException $exception) {
            return $this->safeguardingPolicyError($exception);
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException $exception) {
            return $this->legacyCanonicalMutationError($exception, 'waitlist');
        }

        $position = (int) $result->entry->queue_sequence;
        $payload = [
            'waitlisted' => true,
            'position'   => $position,
        ];
        $event = $this->eventService->getById($id, $userId);

        return $this->respondWithData(
            $event !== null && $this->usesCanonicalEventContract()
                ? $this->serializeRegistration(
                    $event,
                    $userId,
                    array_merge($payload, ['status' => 'waitlisted'])
                )
                : $payload
        );
    }

    /**
     * DELETE /api/v2/events/{id}/waitlist
     */
    public function leaveWaitlist($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('events_waitlist', 30, 60);

        try {
            $this->eventWaitlistService->withdrawCompatibility(
                $id,
                $userId,
                $this->legacyRegistrationActor($userId),
                $this->legacyCompatibilityIdempotencyKey(),
            );
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException $exception) {
            // Historical leave semantics are deliberately idempotent 204, even
            // when no active waitlist row exists. The canonical writer still
            // fails closed and records no cross-tenant mutation.
            \Illuminate\Support\Facades\Log::notice(
                'Legacy event waitlist leave produced no canonical mutation',
                [
                    'tenant_id' => TenantContext::getId(),
                    'event_id' => $id,
                    'reason_code' => $exception->reasonCode,
                ],
            );
        }

        return $this->noContent();
    }

    // ================================================================
    // REMINDERS
    // ================================================================

    /**
     * GET /api/v2/events/{id}/reminders
     */
    public function getReminders($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();

        if (! (bool) $this->eventConfiguration->value('reminders_enabled', true)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        if ($this->eventService->getById($id, $userId) === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        $reminders = $this->eventReminderPreferences->eventPreferences($id, $userId);

        return $this->respondWithData($this->reminderPreferencePayload($reminders));
    }

    /**
     * PUT /api/v2/events/{id}/reminders
     */
    public function updateReminders($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('events_reminders', 20, 60);

        if (! (bool) $this->eventConfiguration->value('reminders_enabled', true)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        if ($this->eventService->getById($id, $userId) === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        $overrides = $this->input('overrides', []);
        $rules = $this->input('rules', []);
        $expectedRevision = $this->input('expected_revision');
        if (! is_array($overrides) || ! is_array($rules)
            || ! is_int($expectedRevision) || $expectedRevision < 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_reminders_update_failed'), null, 422);
        }

        try {
            $updated = $this->eventReminderPreferences->replaceEventPreferences(
                $id,
                $userId,
                $overrides,
                $rules,
                $expectedRevision,
            );
            $this->reconcileUserReminderSchedules($id, $userId);
        } catch (\RuntimeException $exception) {
            if ($exception->getMessage() === 'event_reminder_preference_version_conflict') {
                return $this->respondWithError('VERSION_CONFLICT', __('api.event_reminders_update_failed'), null, 409);
            }
            throw $exception;
        } catch (\InvalidArgumentException) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_reminders_update_failed'), null, 422);
        }

        return $this->respondWithData($this->reminderPreferencePayload($updated));
    }

    /** DELETE /api/v2/events/{id}/reminders */
    public function deleteReminders($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('events_reminders', 20, 60);
        if (! (bool) $this->eventConfiguration->value('reminders_enabled', true)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }
        if ($this->eventService->getById($id, $userId) === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }
        $expectedRevision = $this->input('expected_revision');
        if (! is_int($expectedRevision) || $expectedRevision < 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_reminders_update_failed'), null, 422);
        }
        try {
            $updated = $this->eventReminderPreferences->deleteEventPreferences(
                $id,
                $userId,
                $expectedRevision,
            );
            $this->reconcileUserReminderSchedules($id, $userId);
        } catch (\RuntimeException $exception) {
            if ($exception->getMessage() === 'event_reminder_preference_version_conflict') {
                return $this->respondWithError('VERSION_CONFLICT', __('api.event_reminders_update_failed'), null, 409);
            }
            throw $exception;
        }

        return $this->respondWithData($this->reminderPreferencePayload($updated));
    }

    /** @param array<string,mixed> $preferences @return array<string,mixed> */
    private function reminderPreferencePayload(array $preferences): array
    {
        return [
            ...$preferences,
            'limits' => [
                'minimum_offset_minutes' => max(1, (int) config('events.reminders.minimum_offset_minutes', 5)),
                'maximum_offset_minutes' => max(1, (int) config('events.reminders.maximum_offset_minutes', 525600)),
                'maximum_rules' => max(1, (int) config('events.reminders.max_rules_per_event', 10)),
                'default_offsets_minutes' => array_values(array_map(
                    static fn (mixed $offset): int => (int) $offset,
                    (array) config('events.reminders.default_offsets_minutes', [1440, 60]),
                )),
            ],
            'capabilities' => [
                'independent_channels' => true,
                'diagnostics_supported' => false,
            ],
        ];
    }

    private function reconcileUserReminderSchedules(int $eventId, int $userId): void
    {
        $tenantId = (int) TenantContext::getId();
        $registration = DB::table('event_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('registration_state', 'confirmed')
            ->first(['id', 'registration_version']);
        if ($registration === null) {
            $this->eventReminderSchedules->cancelForRegistrationExit(
                $eventId,
                $userId,
                'registration_inactive',
            );
            return;
        }
        $this->eventReminderSchedules->reconcileConfirmedRegistration(
            $eventId,
            $userId,
            (int) $registration->id,
            (int) $registration->registration_version,
        );
    }

    // ================================================================
    // ATTENDANCE
    // ================================================================

    /**
     * GET /api/v2/events/{id}/attendance
     */
    public function getAttendance($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();

        $event = $this->eventService->getById($id, $userId);
        if (!$event) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        $records = $this->eventService->getAttendanceRecords($id, $userId);
        if ($records === null) {
            return $this->respondWithError('FORBIDDEN', __('api.event_attendance_forbidden'), null, 403);
        }

        return $this->respondWithData($records);
    }

    /**
     * POST /api/v2/events/{id}/attendance
     */
    public function markAttendance($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('events_attendance', 30, 60);

        $attendeeId = $this->inputInt('user_id');
        if (!$attendeeId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_user_id_required'), 'user_id', 400);
        }

        try {
            $result = $this->eventAttendanceService->record(
                $id,
                $attendeeId,
                $this->attendanceActor($userId),
                $this->attendanceHours(),
                $this->attendanceNotes(),
                $this->attendanceIdempotencyKey(),
            );
        } catch (EventAttendanceException $exception) {
            return $this->attendanceErrorResponse($exception);
        } catch (\Throwable $exception) {
            \Log::error('Event attendance recording failed', [
                'event_id' => $id,
                'attendee_id' => $attendeeId,
                'actor_id' => $userId,
                'error' => $exception->getMessage(),
            ]);
            return $this->respondWithError(
                'CHECKIN_ERROR',
                __('api.event_mark_attendance_failed'),
                null,
                500,
            );
        }

        return $this->respondWithData($this->attendanceResultData($result));
    }

    /**
     * POST /api/v2/events/{id}/attendance/bulk
     */
    public function bulkMarkAttendance($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('events_attendance', 10, 60);

        $userIds = $this->input('user_ids');
        if (!is_array($userIds) || empty($userIds)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_user_ids_array_required'), 'user_ids', 400);
        }

        if (count($userIds) > EventService::MAX_BULK_ATTENDANCE) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.bulk_too_many', ['max' => EventService::MAX_BULK_ATTENDANCE]),
                'user_ids',
                422
            );
        }

        $normalizedUserIds = [];
        foreach ($userIds as $candidate) {
            if (is_int($candidate) && $candidate > 0) {
                $normalizedUserIds[] = $candidate;
                continue;
            }
            if (is_string($candidate) && ctype_digit($candidate) && (int) $candidate > 0) {
                $normalizedUserIds[] = (int) $candidate;
                continue;
            }

            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.event_user_ids_array_required'),
                'user_ids',
                422
            );
        }

        $userIds = array_values(array_unique($normalizedUserIds));

        try {
            $actor = $this->attendanceActor($userId);
            $hours = $this->attendanceHours();
            $notes = $this->attendanceNotes();
            $idempotencyKey = $this->attendanceIdempotencyKey();
        } catch (EventAttendanceException $exception) {
            return $this->attendanceErrorResponse($exception);
        }

        $outcomes = [];
        $marked = 0;
        $alreadyCheckedIn = 0;
        $failed = 0;
        foreach ($userIds as $attendeeId) {
            try {
                $item = $this->attendanceResultData($this->eventAttendanceService->record(
                    $id,
                    $attendeeId,
                    $actor,
                    $hours,
                    $notes,
                    $idempotencyKey,
                ));
                $item['success'] = true;
                $outcomes[] = $item;
                if ($item['already_checked_in']) {
                    $alreadyCheckedIn++;
                } else {
                    $marked++;
                }
            } catch (EventAttendanceException $exception) {
                $error = $this->attendanceError($exception);
                $outcomes[] = [
                    'user_id' => $attendeeId,
                    'attendee_id' => $attendeeId,
                    'success' => false,
                    'outcome' => 'failed',
                    'checked_in' => false,
                    'marked' => false,
                    'already_checked_in' => false,
                    'replayed' => false,
                    'error' => [
                        'code' => $error['code'],
                        'message' => $error['message'],
                        'field' => $error['field'],
                    ],
                    'http_status' => $error['status'],
                ];
                $failed++;
            } catch (\Throwable $exception) {
                \Log::error('Bulk event attendance item failed', [
                    'event_id' => $id,
                    'attendee_id' => $attendeeId,
                    'actor_id' => $userId,
                    'error' => $exception->getMessage(),
                ]);
                $outcomes[] = [
                    'user_id' => $attendeeId,
                    'attendee_id' => $attendeeId,
                    'success' => false,
                    'outcome' => 'failed',
                    'checked_in' => false,
                    'marked' => false,
                    'already_checked_in' => false,
                    'replayed' => false,
                    'error' => [
                        'code' => 'CHECKIN_ERROR',
                        'message' => __('api.event_mark_attendance_failed'),
                        'field' => null,
                    ],
                    'http_status' => 500,
                ];
                $failed++;
            }
        }

        $successful = $marked + $alreadyCheckedIn;

        return $this->respondWithData([
            'total' => count($userIds),
            'processed' => count($outcomes),
            'successful' => $successful,
            'marked' => $marked,
            'already_checked_in' => $alreadyCheckedIn,
            'failed' => $failed,
            'complete' => $failed === 0,
            'partial_success' => $successful > 0 && $failed > 0,
            'outcomes' => $outcomes,
        ]);
    }

    // ================================================================
    // SERIES
    // ================================================================

    /**
     * GET /api/v2/events/series
     */
    public function listSeries(): JsonResponse
    {
        $userId = $this->requireAuth();
        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];
        if ($this->query('cursor') !== null) {
            $filters['cursor'] = $this->query('cursor');
        }

        try {
            $result = $this->eventService->getAllSeries($filters, $userId);
        } catch (ValidationException $exception) {
            return $this->discoveryValidationResponse($exception);
        }
        $items = $this->usesCanonicalEventContract()
            ? array_map(
                static fn (array $series): array => EventSeriesResource::fromArray($series),
                $result['items']
            )
            : $result['items'];

        return $this->respondWithData($items, [
            'has_more' => $result['has_more'],
            'cursor' => $result['cursor'],
        ]);
    }

    /**
     * POST /api/v2/events/series
     */
    public function createSeries(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('events_series', 10, 60);

        $title = $this->input('title');
        $description = $this->input('description');

        if (empty($title)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_series_title_required'), 'title', 400);
        }

        $seriesId = $this->eventService->createSeries($userId, $title, $description);

        if (!$seriesId) {
            $errors = $this->eventService->getErrors();
            return $this->respondWithErrors($errors, 422);
        }

        $series = $this->eventService->getSeriesInfo($seriesId, $userId);

        return $this->respondWithData(
            $this->usesCanonicalEventContract() && $series !== null
                ? EventSeriesResource::fromArray($series)
                : $series,
            null,
            201
        );
    }

    /**
     * GET /api/v2/events/series/{seriesId}
     */
    public function showSeries($seriesId): JsonResponse
    {
        $seriesId = (int) $seriesId;
        $userId = $this->requireAuth();

        $series = $this->eventService->getSeriesInfo($seriesId, $userId);
        if (!$series) {
            return $this->respondWithError('NOT_FOUND', __('api.event_series_not_found'), null, 404);
        }

        $events = $this->eventService->getSeriesEvents($seriesId, $userId);

        if ($this->usesCanonicalEventContract()) {
            return $this->respondWithData(EventSeriesResource::fromArray($series, $events));
        }

        return $this->respondWithData(['series' => $series, 'events' => $events]);
    }

    /**
     * POST /api/v2/events/{id}/series
     */
    public function linkToSeries($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('events_series', 20, 60);

        $seriesId = $this->inputInt('series_id');
        if (!$seriesId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_series_id_required'), 'series_id', 422);
        }

        $success = $this->eventService->linkToSeries($id, $seriesId, $userId);

        if (!$success) {
            $errors = $this->eventService->getErrors();
            $status = 422;
            foreach ($errors as $error) {
                if ($error['code'] === 'NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData(['linked' => true, 'event_id' => $id, 'series_id' => $seriesId]);
    }

    // ================================================================
    // RECURRING
    // ================================================================

    /**
     * POST /api/v2/events/recurring
     */
    public function createRecurring(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('events_create', 5, 60);

        $tenantId = (int) TenantContext::getId();
        if (! $this->eventConfiguration->canCreate($tenantId, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.events_creation_not_allowed'), null, 403);
        }
        if (! (bool) $this->eventConfiguration->value('recurrence_enabled', true, $tenantId)) {
            return $this->respondWithError('FORBIDDEN', __('api.events_recurrence_disabled'), null, 403);
        }

        $data = $this->getAllInput();
        if (! array_key_exists('max_attendees', $data)) {
            $defaultCapacity = (int) $this->eventConfiguration->value('default_capacity', 0, $tenantId);
            if ($defaultCapacity > 0) {
                $data['max_attendees'] = $defaultCapacity;
            }
        }

        $result = $this->eventService->createRecurring($userId, $data);

        if (!$result) {
            $errors = $this->eventService->getErrors();
            $status = 422;
            foreach ($errors as $error) {
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
                if ($error['code'] === 'EVENT_RECURRENCE_UNAVAILABLE') {
                    $status = 503;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        $template = $this->eventService->getById($result['template_id'], $userId);
        $templatePayload = $template;
        if ($this->usesCanonicalEventContract() && $template !== null) {
            $facts = $this->contractFacts([$template], $userId);
            $templatePayload = $this->serializeDetailEvent(
                $template,
                $facts[(int) $result['template_id']] ?? []
            );
        }

        return $this->respondWithData([
            'template'             => $templatePayload,
            'occurrences_created'  => $result['occurrences'],
        ], null, 201);
    }

    /**
     * PUT /api/v2/events/{id}/recurring
     */
    public function updateRecurring($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('events_update', 20, 60);

        $data = $this->getAllInput();
        $scope = $data['scope'] ?? 'single';

        if (!in_array($scope, ['single', 'all'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_scope_must_be_single_or_all'), 'scope', 422);
        }

        $success = $this->eventService->updateRecurring($id, $userId, $data, $scope);

        if (!$success) {
            $errors = $this->eventService->getErrors();
            $status = 422;
            foreach ($errors as $error) {
                if ($error['code'] === 'NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        $event = $this->eventService->getById($id, $userId);
        $facts = $this->usesCanonicalEventContract() && $event !== null
            ? $this->contractFacts([$event], $userId)
            : [];

        return $this->respondWithData(
            $event !== null ? $this->serializeDetailEvent($event, $facts[$id] ?? []) : null
        );
    }

    // ================================================================
    // IMAGE UPLOAD
    // ================================================================

    /**
     * POST /api/v2/events/{id}/image
     *
     * Upload an image for an event. Uses request()->file() (Laravel native).
     * Field name: 'image'
     */
    public function uploadImage($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $rawScope = request()->input('scope');
        $scope = is_string($rawScope) && trim($rawScope) !== '' ? trim($rawScope) : null;
        $this->rateLimit('events_image_upload', 10, 60);

        // Authorize before touching the uploaded temporary file or creating a
        // tenant upload. This prevents guessed event IDs leaving orphan files.
        if (!$this->eventService->canUpdateImage($id, $userId, $scope)) {
            $errors = $this->eventService->getErrors();
            $status = collect($errors)->contains(fn (array $error): bool => ($error['code'] ?? null) === 'NOT_FOUND')
                ? 404
                : (collect($errors)->contains(fn (array $error): bool => ($error['code'] ?? null) === 'FORBIDDEN')
                    ? 403
                    : 422);
            return $this->respondWithErrors($errors, $status);
        }

        $file = request()->file('image');
        if (!$file || !$file->isValid()) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.event_no_image_uploaded'), 'image', 422);
        }

        $imageUrl = null;
        try {
            // Build a $_FILES-compatible array for ImageUploader::upload()
            $fileArray = [
                'name'     => $file->getClientOriginalName(),
                'type'     => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error'    => UPLOAD_ERR_OK,
                'size'     => $file->getSize(),
            ];

            $imageUrl = \App\Core\ImageUploader::upload($fileArray, 'events');

            $success = $this->eventService->updateImage($id, $userId, $imageUrl, $scope);

            if (!$success) {
                \App\Core\ImageUploader::deleteTenantUpload($imageUrl, 'events');
                $errors = $this->eventService->getErrors();
                $status = 422;
                foreach ($errors as $error) {
                    if ($error['code'] === 'NOT_FOUND') {
                        $status = 404;
                        break;
                    }
                    if ($error['code'] === 'FORBIDDEN') {
                        $status = 403;
                        break;
                    }
                }
                return $this->respondWithErrors($errors, $status);
            }

            return $this->respondWithData(['image_url' => $imageUrl]);
        } catch (\Exception $e) {
            if ($imageUrl !== null) {
                \App\Core\ImageUploader::deleteTenantUpload($imageUrl, 'events');
            }
            \Log::error('Event image upload failed', [
                'tenant_id' => TenantContext::getId(),
                'event_id' => $id,
                'actor_id' => $userId,
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.event_image_upload_failed'), 'image', 500);
        }
    }
}
