<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Enums\EventAttendanceAction;
use App\Enums\EventCapacityRegistrationState;
use App\Exceptions\EventAttendanceException;
use App\Exceptions\EventParticipationException;
use App\Exceptions\EventOfflineCheckinException;
use App\Exceptions\EventRegistrationException;
use App\Exceptions\EventWaitlistException;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Services\EventAttendanceService;
use App\Services\EventCheckinCredentialService;
use App\Services\EventPeopleBulkService;
use App\Services\EventPeopleHistoryService;
use App\Services\EventPeopleService;
use App\Services\EventRegistrationService;
use App\Services\EventWaitlistService;
use App\Support\CsvExportSanitizer;
use App\Support\Events\EventPeopleQuery;
use App\Support\Events\EventPeopleBulkOperation;
use App\Support\Events\EventRegistrationTransitionResult;
use App\Support\Events\EventWaitlistTransitionResult;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Thin canonical registration, waitlist, and organiser People API. */
final class EventRegistrationController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventRegistrationService $registrations,
        private readonly EventWaitlistService $waitlist,
        private readonly EventPeopleService $people,
        private readonly EventAttendanceService $attendance,
        private readonly EventPeopleBulkService $bulkPeople,
        private readonly EventPeopleHistoryService $peopleHistory,
        private readonly EventPolicy $policy,
    ) {}

    public function show(int $id): JsonResponse
    {
        try {
            [$event, $actor] = $this->selfContext($id);

            return $this->respondWithData($this->people->relationship($event, $actor));
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException|SafeguardingPolicyException $exception) {
            return $this->registrationError($exception);
        }
    }

    public function confirm(int $id): JsonResponse
    {
        try {
            [$event, $actor] = $this->selfContext($id);
            $result = $this->registrations->confirm(
                (int) $event->getKey(),
                (int) $actor->getKey(),
                $actor,
                $this->idempotencyKey(),
            );

            return $this->registrationMutation($event, $actor, $result);
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException|SafeguardingPolicyException $exception) {
            return $this->registrationError($exception);
        }
    }

    public function withdraw(int $id): JsonResponse
    {
        try {
            [$event, $actor] = $this->exitContext($id, false);
            $result = $this->registrations->withdraw(
                (int) $event->getKey(),
                (int) $actor->getKey(),
                $actor,
                $this->idempotencyKey(),
                null,
                $this->reason(),
            );

            return $this->registrationMutation($event, $actor, $result);
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException|SafeguardingPolicyException $exception) {
            return $this->registrationError($exception);
        }
    }

    public function joinWaitlist(int $id): JsonResponse
    {
        try {
            [$event, $actor] = $this->selfContext($id);
            $result = $this->waitlist->join(
                (int) $event->getKey(),
                (int) $actor->getKey(),
                $actor,
                $this->idempotencyKey(),
            );

            return $this->waitlistMutation($event, $actor, $result, 201);
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException|SafeguardingPolicyException $exception) {
            return $this->registrationError($exception);
        }
    }

    public function leaveWaitlist(int $id): JsonResponse
    {
        try {
            [$event, $actor] = $this->exitContext($id, true);
            $result = $this->waitlist->withdraw(
                (int) $event->getKey(),
                (int) $actor->getKey(),
                $actor,
                $this->idempotencyKey(),
                null,
                $this->reason(),
            );

            return $this->waitlistMutation($event, $actor, $result);
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException|SafeguardingPolicyException $exception) {
            return $this->registrationError($exception);
        }
    }

    public function acceptOffer(int $id): JsonResponse
    {
        try {
            [$event, $actor] = $this->selfContext($id);
            $token = request()->input('token');
            if (request()->exists('token')) {
                if (! is_string($token)
                    || trim($token) === ''
                    || mb_strlen(trim($token)) > 512) {
                    throw new EventWaitlistException('event_waitlist_offer_token_invalid');
                }
                $result = $this->waitlist->acceptOffer(
                    (int) $event->getKey(),
                    (int) $actor->getKey(),
                    trim($token),
                    $actor,
                    $this->idempotencyKey(),
                );
            } else {
                $result = $this->waitlist->acceptActiveOffer(
                    (int) $event->getKey(),
                    (int) $actor->getKey(),
                    $actor,
                    $this->idempotencyKey(),
                );
            }

            return $this->waitlistMutation($event, $actor, $result);
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException|SafeguardingPolicyException $exception) {
            return $this->registrationError($exception);
        }
    }

    public function people(int $id): JsonResponse
    {
        try {
            $actor = $this->actor();
            $event = $this->event($id);
            $fullProjection = $this->policy->manageRegistration($actor, $event)
                && $this->policy->viewRoster($actor, $event)
                && $this->policy->viewWaitlist($actor, $event);
            $attendanceProjection = $this->policy->viewRoster($actor, $event)
                && $this->policy->manageAttendance($actor, $event);
            if (! $fullProjection && ! $attendanceProjection) {
                throw new EventRegistrationException(
                    'event_registration_authorization_denied',
                );
            }
            $input = request()->query();
            $this->assertOnlyKeys($input, [
                'page',
                'per_page',
                'search',
                'registration_state',
                'waitlist_state',
                'attendance_state',
                'engagement_state',
                'sort',
                'direction',
            ]);
            $query = EventPeopleQuery::fromArray($input);
            $result = $this->people->paginateForActor($event, $actor, $query);
            $totalPages = $result['total'] > 0
                ? (int) ceil($result['total'] / $result['per_page'])
                : 0;

            return $this->respondWithData($result['items'], [
                'current_page' => $result['page'],
                'per_page' => $result['per_page'],
                'total' => $result['total'],
                'total_pages' => $totalPages,
                'has_more' => $result['page'] < $totalPages,
                ...$query->meta(),
                'metrics' => $result['metrics'],
                'projection' => $fullProjection ? 'full' : 'attendance',
                'sensitive_fields_redacted' => true,
                'capabilities' => [
                    'view_roster' => $this->policy->viewRoster($actor, $event),
                    'view_waitlist' => $this->policy->viewWaitlist($actor, $event),
                    'manage_registration' => $this->policy->manageRegistration($actor, $event),
                    'manage_attendance' => $this->policy->manageAttendance($actor, $event),
                    'export_people' => $fullProjection
                        && $this->policy->exportPeople($actor, $event),
                    'view_history' => $fullProjection || $attendanceProjection,
                ],
            ]);
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException|SafeguardingPolicyException $exception) {
            return $this->registrationError($exception);
        }
    }

    public function exportPeople(int $id): StreamedResponse|JsonResponse
    {
        try {
            [$event, $actor] = $this->managementContext($id, true);
            if (! $this->policy->exportPeople($actor, $event)) {
                throw new EventRegistrationException(
                    'event_registration_authorization_denied',
                );
            }
            $input = request()->query();
            $this->assertOnlyKeys($input, [
                'search',
                'registration_state',
                'waitlist_state',
                'attendance_state',
                'engagement_state',
                'sort',
                'direction',
            ]);
            $query = EventPeopleQuery::fromArray($input);
            $headers = [
                __('event_registration.people_export.member_id'),
                __('event_registration.people_export.member_name'),
                __('event_registration.people_export.engagement'),
                __('event_registration.people_export.registration'),
                __('event_registration.people_export.registration_changed'),
                __('event_registration.people_export.waitlist'),
                __('event_registration.people_export.queue_position'),
                __('event_registration.people_export.queue_sequence'),
                __('event_registration.people_export.attendance'),
                __('event_registration.people_export.attendance_changed'),
                __('event_registration.people_export.checked_in'),
                __('event_registration.people_export.checked_out'),
            ];

            return new StreamedResponse(function () use ($event, $query, $headers): void {
                $output = fopen('php://output', 'wb');
                if ($output === false) {
                    return;
                }
                fputcsv($output, CsvExportSanitizer::row($headers));
                foreach ($this->people->exportRows($event, $query) as $person) {
                    fputcsv($output, CsvExportSanitizer::row([
                        $person['user_id'] ?? null,
                        $person['display_name'] ?? null,
                        $person['engagement_state'] ?? null,
                        $person['registration_state'] ?? null,
                        $person['registration_changed_at'] ?? null,
                        $person['waitlist_state'] ?? null,
                        $person['waitlist_position'] ?? null,
                        $person['waitlist_sequence'] ?? null,
                        $person['attendance_state'] ?? null,
                        $person['attendance_changed_at'] ?? null,
                        $person['checked_in_at'] ?? null,
                        $person['checked_out_at'] ?? null,
                    ]));
                }
                fclose($output);
            }, 200, [
                'Content-Type' => 'text/csv; charset=UTF-8',
                'Content-Disposition' => 'attachment; filename="event-' . $id . '-people.csv"',
                'Cache-Control' => 'private, no-store, max-age=0',
                'X-Content-Type-Options' => 'nosniff',
            ]);
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException|SafeguardingPolicyException $exception) {
            return $this->registrationError($exception);
        }
    }

    public function bulk(int $id): JsonResponse
    {
        try {
            [$event, $actor] = $this->managementContext($id, true);
            $input = request()->all();
            $this->assertOnlyKeys($input, ['operations']);
            $rawOperations = $input['operations'] ?? null;
            if (! is_array($rawOperations)
                || ! array_is_list($rawOperations)
                || $rawOperations === []
                || count($rawOperations) > EventPeopleBulkService::MAX_OPERATIONS) {
                throw new EventRegistrationException(
                    'event_registration_people_bulk_invalid',
                );
            }

            $operations = [];
            foreach ($rawOperations as $rawOperation) {
                if (! is_array($rawOperation)) {
                    throw new EventRegistrationException(
                        'event_registration_people_bulk_invalid',
                    );
                }
                $this->assertOnlyKeys($rawOperation, [
                    'user_id',
                    'action',
                    'expected_version',
                    'idempotency_key',
                    'reason',
                ], 'event_registration_people_bulk_invalid');
                $operations[] = EventPeopleBulkOperation::fromArray($rawOperation);
            }

            $result = $this->bulkPeople->execute($event, $actor, $operations);
            $result['results'] = array_map(function (array $operation): array {
                if (($operation['success'] ?? false) === true) {
                    return $operation;
                }
                $reasonCode = is_string($operation['error'] ?? null)
                    ? $operation['error']
                    : 'event_registration_server_error';
                unset($operation['error']);

                return [
                    ...$operation,
                    'error' => $this->serializedError($reasonCode),
                ];
            }, $result['results']);

            return $this->respondWithData($result);
        } catch (
            EventAttendanceException|
            EventRegistrationException|
            EventWaitlistException|
            EventParticipationException|
            SafeguardingPolicyException $exception
        ) {
            return $this->registrationError($exception);
        }
    }
    /**
     * POST /api/v2/events/{id}/attendance/code
     *
     * Record attendance from a SCANNED signed check-in credential, rather than from
     * an organiser picking a person off the roster.
     *
     * 🔴 Why this endpoint had to exist. The Blade accessible frontend does this
     * in-process (GovukAlpha\Concerns\EventOfflineCheckinParity::eventsOfflineCheckinCode),
     * calling three services directly. Every other accessible-frontend page has an
     * HTTP equivalent, so web-uk could reach it — this one did not, which is why the
     * route matrix sat at 706 of 707 and why Blade could not be retired. This is the
     * 707th.
     *
     * Deliberately mirrors eventsOfflineCheckinCode's validation exactly:
     *   - confirmation must be "1" (a scan alone must not mutate anything; a link
     *     preview fetching the URL must never mark someone present)
     *   - the credential must carry the nqx2_ prefix and be at most 1024 characters
     *   - undo requires a reason
     *
     * 🔴 One deliberate DIFFERENCE from Blade: the idempotency key is required, where
     * Blade invents a fresh uuid whenever the field is absent. A fresh key per POST can
     * never match a previous submission, so Blade's replay protection does not actually
     * protect anything; requiring a stable key from the caller does, and it is what
     * every other mutating endpoint on this controller already demands. web-uk issues
     * one per rendered form.
     *
     * 🔴 It reads the CURRENT attendance_version from the database rather than
     * requiring expected_version from the caller, which is the one place it differs
     * from `attendance()` above — and it is not an oversight. A scanner holds a
     * signed code, not a roster row; it has no way to know the version. Blade made
     * the same choice for the same reason. The optimistic-locking value is still
     * passed to the service, so two staff scanning the same pass at once still
     * conflict rather than both winning.
     */
    public function attendanceByCode(int $id): JsonResponse
    {
        try {
            [$event, $actor] = $this->attendanceContext($id);
            $input = request()->all();
            $this->assertOnlyKeys($input, [
                'action',
                'credential',
                'confirmation',
                'reason',
                'idempotency_key',
            ], 'event_attendance_action_invalid');

            $credential = trim((string) ($input['credential'] ?? ''));
            $action = is_string($input['action'] ?? null)
                ? EventAttendanceAction::tryFrom(strtolower(trim($input['action'])))
                : null;
            $reason = $this->reason();

            // One combined guard, matching Blade, so a caller cannot learn which
            // part of a bad request was wrong.
            if ((string) ($input['confirmation'] ?? '') !== '1'
                || $action === null
                || ! str_starts_with($credential, 'nqx2_')
                || mb_strlen($credential) > 1024
                || ($action === EventAttendanceAction::Undo && ($reason === null || $reason === ''))) {
                throw new EventAttendanceException('event_attendance_action_invalid');
            }

            $verified = app(EventCheckinCredentialService::class)->verify($id, $credential);
            $subjectUserId = (int) $verified->user_id;

            // 🔴 An unreadable credential and a credential for somebody this actor
            // cannot see give the SAME answer. Distinguishing them would turn the
            // endpoint into a way to test whether a given person is registered.
            if ($subjectUserId <= 0
                || ! $this->people->attendanceSubjectVisible($event, $subjectUserId)) {
                throw new EventOfflineCheckinException('event_qr_registration_not_found');
            }

            $tenantId = TenantContext::currentId();
            if ($tenantId === null || $tenantId <= 0) {
                throw new EventOfflineCheckinException('event_checkin_tenant_context_missing');
            }

            $version = DB::table('event_attendance')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $id)
                ->where('user_id', $subjectUserId)
                ->value('attendance_version');

            $member = $this->member($subjectUserId);
            $result = $this->attendance->transition(
                (int) $event->getKey(),
                (int) $member->getKey(),
                $action,
                $actor,
                is_numeric($version) ? (int) $version : 0,
                $reason,
                $this->idempotencyKey(),
            );

            return $this->respondWithData([
                'member' => [
                    'id' => (int) $member->getKey(),
                    'display_name' => $member->getAttribute('name'),
                ],
                'mutation' => $result->toArray(),
            ]);
        } catch (EventOfflineCheckinException $exception) {
            // Logged at the same level and with the same fields as Blade, so the two
            // frontends produce comparable operational records.
            Log::notice('Signed check-in code rejected', [
                'tenant_id' => TenantContext::getId(),
                'event_id' => $id,
                'reason_code' => $exception->reasonCode,
            ]);

            return $this->respondWithError(
                'EVENT_CHECKIN_CODE_INVALID',
                __('api.event_checkin_code_invalid'),
                null,
                422,
            );
        } catch (
            EventAttendanceException|
            EventRegistrationException|
            EventWaitlistException|
            EventParticipationException|
            SafeguardingPolicyException $exception
        ) {
            return $this->registrationError($exception);
        }
    }


    public function attendance(int $id, int $userId): JsonResponse
    {
        try {
            [$event, $actor] = $this->attendanceContext($id);
            $input = request()->all();
            $this->assertOnlyKeys($input, [
                'action',
                'expected_version',
                'reason',
                'idempotency_key',
            ], 'event_attendance_action_invalid');
            $action = is_string($input['action'] ?? null)
                ? EventAttendanceAction::tryFrom(
                    strtolower(trim($input['action'])),
                )
                : null;
            if ($action === null) {
                throw new EventAttendanceException(
                    'event_attendance_action_invalid',
                );
            }
            $expectedVersion = $input['expected_version'] ?? null;
            if (! is_int($expectedVersion) || $expectedVersion < 0) {
                throw new EventAttendanceException(
                    'event_attendance_version_invalid',
                );
            }
            if (! $this->people->attendanceSubjectVisible($event, $userId)) {
                throw new EventRegistrationException(
                    'event_registration_subject_not_found',
                );
            }
            $member = $this->member($userId);
            $result = $this->attendance->transition(
                (int) $event->getKey(),
                (int) $member->getKey(),
                $action,
                $actor,
                $expectedVersion,
                $this->reason(),
                $this->idempotencyKey(),
            );

            return $this->respondWithData([
                'member' => [
                    'id' => (int) $member->getKey(),
                    'display_name' => $member->getAttribute('name'),
                ],
                'mutation' => $result->toArray(),
            ]);
        } catch (
            EventAttendanceException|
            EventRegistrationException|
            EventWaitlistException|
            EventParticipationException|
            SafeguardingPolicyException $exception
        ) {
            return $this->registrationError($exception);
        }
    }

    public function history(int $id, int $userId): JsonResponse
    {
        try {
            $actor = $this->actor();
            $event = $this->event($id);
            $input = request()->query();
            $this->assertOnlyKeys($input, ['page', 'per_page']);
            $page = $this->queryInteger($input['page'] ?? '1');
            $perPage = $this->queryInteger($input['per_page'] ?? '50');
            $member = $this->member($userId);
            $result = $this->peopleHistory->paginate(
                $event,
                $member,
                $actor,
                $page,
                $perPage,
            );
            $totalPages = $result['total'] > 0
                ? (int) ceil($result['total'] / $result['per_page'])
                : 0;

            return $this->respondWithData($result['items'], [
                'current_page' => $result['page'],
                'per_page' => $result['per_page'],
                'total' => $result['total'],
                'total_pages' => $totalPages,
                'has_more' => $result['page'] < $totalPages,
                'projection' => $this->policy->manageRegistration($actor, $event)
                    ? 'full'
                    : 'attendance',
                'sensitive_fields_redacted' => true,
            ]);
        } catch (EventRegistrationException $exception) {
            return $this->registrationError($exception);
        }
    }

    public function approve(int $id, int $userId): JsonResponse
    {
        return $this->manageState(
            $id,
            $userId,
            EventCapacityRegistrationState::Confirmed,
        );
    }

    public function reject(int $id, int $userId): JsonResponse
    {
        return $this->manageState(
            $id,
            $userId,
            EventCapacityRegistrationState::Declined,
        );
    }

    public function cancel(int $id, int $userId): JsonResponse
    {
        return $this->manageState(
            $id,
            $userId,
            EventCapacityRegistrationState::Cancelled,
        );
    }

    private function manageState(
        int $eventId,
        int $userId,
        EventCapacityRegistrationState $target,
    ): JsonResponse {
        try {
            [$event, $actor] = $this->managementContext($eventId);
            $member = $this->member($userId);
            $current = $this->registrations->stateFor(
                (int) $event->getKey(),
                (int) $member->getKey(),
            );
            if ($current === null
                || $current === $target
                || ! $current->canTransitionTo($target)) {
                throw new EventRegistrationException('event_registration_transition_invalid');
            }
            if ($target === EventCapacityRegistrationState::Confirmed
                && ! in_array($current, [
                    EventCapacityRegistrationState::Invited,
                    EventCapacityRegistrationState::Pending,
                ], true)) {
                throw new EventRegistrationException('event_registration_transition_invalid');
            }
            $reason = $this->reason();
            if (in_array($target, [
                EventCapacityRegistrationState::Declined,
                EventCapacityRegistrationState::Cancelled,
            ], true) && $reason === null) {
                throw new EventRegistrationException('event_registration_reason_required');
            }
            $result = $this->registrations->transition(
                (int) $event->getKey(),
                (int) $member->getKey(),
                $target,
                $actor,
                $this->idempotencyKey(),
                null,
                null,
                $reason,
            );

            return $this->registrationMutation($event, $member, $result);
        } catch (EventRegistrationException|EventWaitlistException|EventParticipationException|SafeguardingPolicyException $exception) {
            return $this->registrationError($exception);
        }
    }

    /** @return array{Event,User} */
    private function selfContext(int $eventId): array
    {
        $actor = $this->selfActor();
        $event = $this->event($eventId);
        if (! $this->policy->view($actor, $event)) {
            throw new EventRegistrationException('event_registration_event_not_found');
        }

        return [$event, $actor];
    }

    /** @return array{Event,User} */
    private function exitContext(int $eventId, bool $waitlist): array
    {
        $actor = $this->selfActor();
        $event = $this->event($eventId);
        $state = $waitlist
            ? $this->waitlist->stateFor($eventId, (int) $actor->getKey())
            : $this->registrations->stateFor($eventId, (int) $actor->getKey());
        if ($state === null) {
            // Do not reveal a hidden event to a caller without an exact own fact.
            throw new EventRegistrationException('event_registration_event_not_found');
        }

        return [$event, $actor];
    }

    /** @return array{Event,User} */
    private function managementContext(int $eventId, bool $requireCompletePeopleView = false): array
    {
        $actor = $this->actor();
        $event = $this->event($eventId);
        $allowed = $this->policy->manageRegistration($actor, $event);
        if ($requireCompletePeopleView) {
            $allowed = $allowed
                && $this->policy->viewRoster($actor, $event)
                && $this->policy->viewWaitlist($actor, $event);
        }
        if (! $allowed) {
            throw new EventRegistrationException('event_registration_authorization_denied');
        }

        return [$event, $actor];
    }

    /** @return array{Event,User} */
    private function attendanceContext(int $eventId): array
    {
        $actor = $this->actor();
        $event = $this->event($eventId);
        if (! $this->policy->viewRoster($actor, $event)
            || ! $this->policy->manageAttendance($actor, $event)) {
            throw new EventRegistrationException(
                'event_registration_authorization_denied',
            );
        }

        return [$event, $actor];
    }

    /**
     * Resolve the acting user by authenticated id alone.
     *
     * Auth is GLOBAL; only resources are tenant-scoped. This lookup carried
     * `AND tenant_id = ?` against the current tenant and therefore refused
     * every actor whose account row lives on another tenant — network admins,
     * platform admins, and an event's own cross-tenant organiser were locked
     * out of approve / reject / cancel, the bulk people endpoint, the roster
     * and the participation history. Same bug family as 5373940c8 and
     * 766b867d2. There is no IDOR risk: the id comes from requireUserId().
     * Authority is still decided by EventPolicy against the tenant-scoped
     * event, and the SUBJECT of a write stays tenant-scoped in member() and
     * in the services' lockParticipants().
     */
    private function actor(): User
    {
        $tenantId = TenantContext::currentId();
        $actor = $tenantId === null || $tenantId <= 0
            ? null
            : User::withoutGlobalScopes()
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->find($this->requireUserId());
        if (! $actor instanceof User) {
            throw new EventRegistrationException('event_registration_actor_invalid');
        }

        return $actor;
    }

    /**
     * Resolve the actor for a SELF-service registration write.
     *
     * Here the actor is also the subject, and a participation subject must
     * belong to the event's tenant: EventParticipationEligibilityService
     * enforces it, and the safeguarding contact checks it runs are
     * tenant-local by construction. Asserting it at the boundary keeps a
     * cross-tenant member's refusal a truthful 403 rather than the 404
     * "member not found" the subject lookup would raise deeper in the stack.
     */
    private function selfActor(): User
    {
        $actor = $this->actor();
        if ((int) $actor->getAttribute('tenant_id') !== (int) TenantContext::currentId()) {
            throw new EventParticipationException('event_participation_scope_invalid');
        }

        return $actor;
    }

    private function event(int $eventId): Event
    {
        $tenantId = TenantContext::currentId();
        /** @var Event|null $event */
        $event = $tenantId === null
            ? null
            : Event::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($eventId)
                ->first();
        if ($event === null) {
            throw new EventRegistrationException('event_registration_event_not_found');
        }

        return $event;
    }

    private function member(int $userId): User
    {
        $tenantId = TenantContext::currentId();
        /** @var User|null $member */
        $member = $tenantId === null
            ? null
            : User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->whereKey($userId)
                ->first();
        if ($member === null) {
            throw new EventRegistrationException('event_registration_subject_not_found');
        }

        return $member;
    }

    private function idempotencyKey(): string
    {
        $header = request()->header('Idempotency-Key');
        $body = request()->input('idempotency_key');
        if (($header !== null && ! is_string($header))
            || ($body !== null && ! is_string($body))) {
            throw new EventRegistrationException('event_registration_idempotency_key_invalid');
        }
        $header = is_string($header) ? trim($header) : null;
        $body = is_string($body) ? trim($body) : null;
        if ($header !== null && $body !== null && $header !== $body) {
            throw new EventRegistrationException('event_registration_idempotency_key_invalid');
        }
        $key = $header ?? $body;
        if ($key === null || $key === '') {
            throw new EventRegistrationException('event_registration_idempotency_key_required');
        }
        if (mb_strlen($key) > 191) {
            throw new EventRegistrationException('event_registration_idempotency_key_invalid');
        }

        return $key;
    }

    private function reason(): ?string
    {
        $reason = request()->input('reason');
        if ($reason === null || $reason === '') {
            return null;
        }
        if (! is_string($reason)) {
            throw new EventRegistrationException('event_registration_reason_invalid');
        }

        $reason = trim($reason);
        if ($reason === '') {
            return null;
        }
        if (mb_strlen($reason) > 4000) {
            throw new EventRegistrationException('event_registration_reason_too_long');
        }

        return $reason;
    }

    /**
     * @param array<string,mixed> $input
     * @param list<string> $allowed
     */
    private function assertOnlyKeys(
        array $input,
        array $allowed,
        string $reasonCode = 'event_registration_people_query_invalid',
    ): void {
        foreach (array_keys($input) as $key) {
            if (! is_string($key) || ! in_array($key, $allowed, true)) {
                if (str_starts_with($reasonCode, 'event_attendance_')) {
                    throw new EventAttendanceException($reasonCode);
                }

                throw new EventRegistrationException($reasonCode);
            }
        }
    }

    private function queryInteger(mixed $value): int
    {
        if (is_int($value)) {
            return $value;
        }
        if (is_string($value) && preg_match('/^[0-9]+$/', $value) === 1) {
            return (int) $value;
        }

        throw new EventRegistrationException(
            'event_registration_people_query_invalid',
        );
    }

    private function registrationMutation(
        Event $event,
        User $member,
        EventRegistrationTransitionResult $result,
    ): JsonResponse {
        return $this->respondWithData([
            'relationship' => $this->people->relationship($event, $member),
            'mutation' => [
                'changed' => $result->changed,
                'idempotent_replay' => $result->replayed,
                'history_entry_id' => $result->historyId,
                'released_capacity' => $result->releasedCapacity,
                'next_offer_created' => $result->offeredEntry !== null,
            ],
        ]);
    }

    private function waitlistMutation(
        Event $event,
        User $member,
        EventWaitlistTransitionResult $result,
        int $changedStatus = 200,
    ): JsonResponse {
        return $this->respondWithData([
            'relationship' => $this->people->relationship($event, $member),
            'mutation' => [
                'changed' => $result->changed,
                'idempotent_replay' => $result->replayed,
                'history_entry_id' => $result->historyId,
                'next_offer_created' => $result->nextOfferedEntry !== null,
            ],
        ], null, $result->changed ? $changedStatus : 200);
    }

    private function registrationError(
        EventAttendanceException|EventRegistrationException|EventWaitlistException|EventParticipationException|SafeguardingPolicyException $exception,
    ): JsonResponse {
        if ($exception instanceof SafeguardingPolicyException) {
            return $this->safeguardingPolicyError($exception);
        }
        [$code, $message, $field, $status] = $this->errorDetails(
            $exception->reasonCode,
        );

        return $this->respondWithError($code, $message, $field, $status);
    }

    /** @return array{string,string,?string,int} */
    private function errorDetails(string $reasonCode): array
    {
        return match ($reasonCode) {
            'event_registration_event_not_found',
            'event_waitlist_event_not_found',
            'event_attendance_event_not_found' => [
                'EVENT_NOT_FOUND', __('api.event_not_found'), null, 404,
            ],
            'event_registration_subject_not_found',
            'event_waitlist_subject_not_found',
            'event_waitlist_entry_not_found',
            'event_attendance_attendee_not_found' => [
                'EVENT_REGISTRATION_MEMBER_NOT_FOUND', __('api.user_not_found'), null, 404,
            ],
            'event_registration_actor_invalid',
            'event_registration_authorization_denied',
            'event_waitlist_actor_not_found',
            'event_attendance_authorization_denied',
            'event_participation_audience_denied',
            'event_participation_organizer_invalid',
            'event_participation_scope_invalid' => [
                'EVENT_REGISTRATION_FORBIDDEN', __('api.forbidden'), null, 403,
            ],
            'event_participation_kiss_treffen_members_only' => [
                'KISS_TREFFEN_MEMBERS_ONLY',
                __('api.caring_kiss_treffen_members_only_rsvp'),
                null,
                403,
            ],
            'event_participation_safety_denied' => [
                'EVENT_SAFETY_ACTION_REQUIRED',
                __('event_registration.safety_requirements_not_met'),
                null,
                409,
            ],
            'event_participation_safety_unavailable' => [
                'EVENT_SAFETY_UNAVAILABLE',
                __('event_registration.safety_unavailable'),
                null,
                503,
            ],
            'event_registration_idempotency_key_required' => [
                'EVENT_REGISTRATION_IDEMPOTENCY_REQUIRED',
                __('event_registration.idempotency_required'),
                'idempotency_key',
                422,
            ],
            'event_registration_idempotency_key_invalid',
            'event_waitlist_idempotency_key_invalid',
            'event_waitlist_offer_envelope_idempotency_invalid',
            'event_attendance_idempotency_key_invalid' => [
                'EVENT_REGISTRATION_IDEMPOTENCY_INVALID',
                __('event_registration.idempotency_invalid'),
                'idempotency_key',
                422,
            ],
            'event_registration_idempotency_conflict',
            'event_waitlist_idempotency_conflict',
            'event_waitlist_offer_envelope_conflict',
            'event_attendance_idempotency_conflict' => [
                'EVENT_REGISTRATION_IDEMPOTENCY_CONFLICT',
                __('event_registration.idempotency_conflict'),
                'idempotency_key',
                409,
            ],
            'event_registration_concrete_occurrence_required',
            'event_waitlist_concrete_occurrence_required',
            'event_attendance_concrete_occurrence_required' => [
                'EVENT_OCCURRENCE_REQUIRED',
                __('event_registration.concrete_occurrence_required'),
                null,
                409,
            ],
            'event_registration_event_unavailable',
            'event_waitlist_event_unavailable',
            'event_attendance_event_unavailable' => [
                'EVENT_REGISTRATION_UNAVAILABLE',
                __('event_registration.event_unavailable'),
                null,
                409,
            ],
            'event_registration_event_started',
            'event_waitlist_event_started' => [
                'EVENT_REGISTRATION_CLOSED',
                __('event_registration.event_started'),
                null,
                409,
            ],
            'event_registration_capacity_full' => [
                'EVENT_CAPACITY_FULL', __('event_registration.capacity_full'), null, 409,
            ],
            'event_registration_tenant_disabled' => [
                'EVENT_REGISTRATION_DISABLED', __('api.events_registration_disabled'), null, 403,
            ],
            'event_waitlist_tenant_disabled' => [
                'EVENT_WAITLIST_DISABLED', __('api.events_waitlist_disabled'), null, 403,
            ],
            'event_waitlist_finite_capacity_required' => [
                'EVENT_WAITLIST_CAPACITY_REQUIRED',
                __('event_registration.finite_capacity_required'),
                null,
                409,
            ],
            'event_waitlist_capacity_available' => [
                'EVENT_CAPACITY_AVAILABLE',
                __('event_registration.capacity_available'),
                null,
                409,
            ],
            'event_waitlist_registration_confirmed' => [
                'EVENT_ALREADY_CONFIRMED',
                __('event_registration.already_confirmed'),
                null,
                409,
            ],
            'event_registration_offer_acceptance_required' => [
                'EVENT_OFFER_ACCEPTANCE_REQUIRED',
                __('event_registration.offer_acceptance_required'),
                null,
                409,
            ],
            'event_registration_transition_invalid',
            'event_waitlist_transition_invalid',
            'event_waitlist_withdrawal_invalid',
            'event_attendance_transition_invalid',
            'event_attendance_undo_unavailable',
            'event_attendance_fact_missing' => [
                'EVENT_REGISTRATION_TRANSITION_INVALID',
                __('event_registration.transition_invalid'),
                null,
                409,
            ],
            'event_waitlist_offer_not_active' => [
                'EVENT_WAITLIST_OFFER_INACTIVE',
                __('event_registration.waitlist_offer_inactive'),
                null,
                409,
            ],
            'event_waitlist_offer_expired',
            'event_waitlist_offer_envelope_expired' => [
                'EVENT_WAITLIST_OFFER_EXPIRED',
                __('event_registration.waitlist_offer_expired'),
                null,
                410,
            ],
            'event_waitlist_offer_token_invalid' => [
                'EVENT_WAITLIST_OFFER_TOKEN_INVALID',
                __('event_registration.waitlist_offer_token_invalid'),
                'token',
                422,
            ],
            'event_waitlist_timed_offers_disabled' => [
                'EVENT_WAITLIST_TIMED_OFFERS_DISABLED',
                __('event_registration.timed_offers_disabled'),
                null,
                409,
            ],
            'event_registration_people_query_invalid' => [
                'EVENT_PEOPLE_QUERY_INVALID',
                __('event_registration.people_query_invalid'),
                null,
                422,
            ],
            'event_registration_people_bulk_invalid',
            'event_registration_people_bulk_duplicate_subject',
            'event_attendance_action_invalid',
            'event_attendance_subject_invalid',
            'event_attendance_version_invalid',
            'event_attendance_reason_too_long',
            'event_attendance_notes_too_long',
            'event_attendance_hours_unavailable',
            'event_attendance_schedule_invalid' => [
                'EVENT_PEOPLE_VALIDATION_FAILED',
                __('event_registration.validation_failed'),
                null,
                422,
            ],
            'event_attendance_registration_required' => [
                'EVENT_ATTENDANCE_REGISTRATION_REQUIRED',
                __('api.event_not_rsvped'),
                null,
                409,
            ],
            'event_attendance_too_early',
            'event_attendance_no_show_too_early' => [
                'EVENT_ATTENDANCE_TOO_EARLY',
                __('api.event_too_early_checkin'),
                null,
                409,
            ],
            'event_attendance_window_closed' => [
                'EVENT_ATTENDANCE_WINDOW_CLOSED',
                __('api.event_ended_checkin'),
                null,
                409,
            ],
            'event_registration_reason_invalid',
            'event_registration_reason_too_long',
            'event_waitlist_reason_too_long',
            'event_registration_capacity_pool_invalid',
            'event_waitlist_capacity_pool_invalid',
            'event_registration_allocation_key_unavailable',
            'event_waitlist_allocation_key_unavailable' => [
                'EVENT_REGISTRATION_VALIDATION_FAILED',
                __('event_registration.validation_failed'),
                null,
                422,
            ],
            'event_registration_reason_required',
            'event_attendance_reason_required' => [
                'EVENT_REGISTRATION_REASON_REQUIRED',
                __('event_registration.reason_required'),
                'reason',
                422,
            ],
            'event_waitlist_concurrent_conflict',
            'event_registration_version_conflict',
            'event_attendance_version_conflict',
            'event_attendance_history_conflict' => [
                'EVENT_REGISTRATION_CONFLICT',
                __('event_registration.request_conflict'),
                null,
                409,
            ],
            'event_registration_tenant_context_missing',
            'event_waitlist_tenant_context_missing',
            'event_attendance_tenant_context_missing',
            'event_waitlist_offer_envelope_unavailable',
            'event_waitlist_offer_envelope_key_unavailable',
            'event_waitlist_offer_envelope_cipher_unavailable' => [
                'EVENT_REGISTRATION_UNAVAILABLE',
                __('event_registration.service_unavailable'),
                null,
                503,
            ],
            default => [
                'EVENT_REGISTRATION_SERVER_ERROR',
                __('event_registration.server_error'),
                null,
                500,
            ],
        };
    }

    /** @return array{code:string,message:string,field?:string} */
    private function serializedError(string $reasonCode): array
    {
        [$code, $message, $field] = $this->errorDetails($reasonCode);
        $error = ['code' => $code, 'message' => $message];
        if ($field !== null) {
            $error['field'] = $field;
        }

        return $error;
    }
}
