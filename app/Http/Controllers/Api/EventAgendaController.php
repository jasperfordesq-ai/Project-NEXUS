<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\EventSessionException;
use App\Models\EventSession;
use App\Models\User;
use App\Services\EventSessionService;
use App\Support\Events\EventSessionContractMapper;
use Illuminate\Http\JsonResponse;

/** Canonical tenant-safe API for a concrete event's agenda and speakers. */
final class EventAgendaController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventSessionService $sessions,
    ) {}

    public function index(int $id): JsonResponse
    {
        $includeCancelled = $this->booleanQuery('include_cancelled', false);
        if ($includeCancelled === null) {
            return $this->validationError('include_cancelled');
        }

        try {
            $agenda = $this->sessions->readAgenda($id, $this->actor(), $includeCancelled);
        } catch (EventSessionException $exception) {
            return $this->agendaError($exception);
        }

        return $this->privateResponse($this->respondWithData(EventSessionContractMapper::agenda(
            $agenda['event'],
            $agenda['sessions'],
            ['can_manage' => $agenda['can_manage']],
        )));
    }

    public function store(int $id): JsonResponse
    {
        $idempotencyKey = $this->requiredIdempotencyKey();
        if ($idempotencyKey === false) {
            return $this->validationError('idempotency_key');
        }

        try {
            $result = $this->sessions->create(
                $id,
                $this->actor(),
                request()->except(['idempotency_key']),
                $idempotencyKey,
            );
        } catch (EventSessionException $exception) {
            return $this->agendaError($exception);
        }

        return $this->privateResponse($this->respondWithData(
            $this->sessionMutation($result, $idempotencyKey),
            null,
            $result['changed'] && (int) $result['session']->version === 1 ? 201 : 200,
        ));
    }

    public function update(int $id, int $sessionId): JsonResponse
    {
        $expectedVersion = $this->positiveInteger(request()->input('expected_version'));
        if ($expectedVersion === null) {
            return $this->validationError('expected_version');
        }
        $idempotencyKey = $this->requiredIdempotencyKey();
        if ($idempotencyKey === false) {
            return $this->validationError('idempotency_key');
        }

        try {
            $result = $this->sessions->update(
                $id,
                $sessionId,
                $this->actor(),
                request()->except(['expected_version', 'idempotency_key']),
                $expectedVersion,
                $idempotencyKey,
            );
        } catch (EventSessionException $exception) {
            return $this->agendaError($exception);
        }

        return $this->privateResponse(
            $this->respondWithData($this->sessionMutation($result, $idempotencyKey)),
        );
    }

    public function cancel(int $id, int $sessionId): JsonResponse
    {
        $expectedVersion = $this->positiveInteger(request()->input('expected_version'));
        if ($expectedVersion === null) {
            return $this->validationError('expected_version');
        }
        $reason = request()->input('reason');
        if (! is_string($reason) || trim($reason) === '') {
            return $this->validationError('reason');
        }
        $idempotencyKey = $this->requiredIdempotencyKey();
        if ($idempotencyKey === false) {
            return $this->validationError('idempotency_key');
        }

        try {
            $result = $this->sessions->cancel(
                $id,
                $sessionId,
                $this->actor(),
                $reason,
                $expectedVersion,
                $idempotencyKey,
            );
        } catch (EventSessionException $exception) {
            return $this->agendaError($exception);
        }

        return $this->privateResponse(
            $this->respondWithData($this->sessionMutation($result, $idempotencyKey)),
        );
    }

    public function reorder(int $id): JsonResponse
    {
        $expectedAgendaVersion = $this->nonNegativeInteger(
            request()->input('expected_agenda_version'),
        );
        if ($expectedAgendaVersion === null) {
            return $this->validationError('expected_agenda_version');
        }
        $orderedSessionIds = $this->positiveIntegerList(request()->input('ordered_session_ids'));
        if ($orderedSessionIds === null) {
            return $this->validationError('ordered_session_ids');
        }
        $idempotencyKey = $this->requiredIdempotencyKey();
        if ($idempotencyKey === false) {
            return $this->validationError('idempotency_key');
        }

        try {
            $result = $this->sessions->reorder(
                $id,
                $this->actor(),
                $orderedSessionIds,
                $expectedAgendaVersion,
                $idempotencyKey,
            );
        } catch (EventSessionException $exception) {
            return $this->agendaError($exception);
        }

        return $this->privateResponse($this->respondWithData([
            'sessions' => $result['sessions']
                ->map(static fn ($session): array => EventSessionContractMapper::session($session, true))
                ->values()
                ->all(),
            'agenda_version' => $result['agenda_version'],
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed'] && $result['history_id'] !== null,
            'history_entry_id' => $result['history_id'],
        ]));
    }

    public function register(int $id, int $sessionId): JsonResponse
    {
        $expectedVersion = $this->nonNegativeInteger(request()->input('expected_version'));
        if ($expectedVersion === null) {
            return $this->validationError('expected_version');
        }
        $idempotencyKey = $this->requiredIdempotencyKey();
        if ($idempotencyKey === false) {
            return $this->validationError('idempotency_key');
        }

        try {
            $result = $this->sessions->registerSession(
                $id,
                $sessionId,
                $this->actor(),
                $expectedVersion,
                $idempotencyKey,
            );
        } catch (EventSessionException $exception) {
            return $this->agendaError($exception);
        }

        return $this->privateResponse($this->respondWithData(
            $this->registrationMutation($result, $idempotencyKey),
        ));
    }

    public function withdraw(int $id, int $sessionId): JsonResponse
    {
        $expectedVersion = $this->nonNegativeInteger(request()->input('expected_version'));
        if ($expectedVersion === null) {
            return $this->validationError('expected_version');
        }
        $idempotencyKey = $this->requiredIdempotencyKey();
        if ($idempotencyKey === false) {
            return $this->validationError('idempotency_key');
        }

        try {
            $result = $this->sessions->withdrawSession(
                $id,
                $sessionId,
                $this->actor(),
                $expectedVersion,
                $idempotencyKey,
            );
        } catch (EventSessionException $exception) {
            return $this->agendaError($exception);
        }

        return $this->privateResponse($this->respondWithData(
            $this->registrationMutation($result, $idempotencyKey),
        ));
    }

    private function actor(): User
    {
        $tenantId = TenantContext::currentId();
        $actor = $tenantId === null
            ? null
            : User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->find($this->requireUserId());
        if (! $actor instanceof User) {
            throw new EventSessionException('event_agenda_actor_invalid');
        }

        return $actor;
    }

    private function booleanQuery(string $name, bool $default): ?bool
    {
        if (! request()->has($name)) {
            return $default;
        }

        $parsed = filter_var(request()->query($name), FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);

        return $parsed === null ? null : $parsed;
    }

    private function positiveInteger(mixed $value): ?int
    {
        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $parsed === false ? null : (int) $parsed;
    }

    private function nonNegativeInteger(mixed $value): ?int
    {
        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);

        return $parsed === false ? null : (int) $parsed;
    }

    /** @return list<int>|null */
    private function positiveIntegerList(mixed $value): ?array
    {
        if (! is_array($value) || count($value) > 1000) {
            return null;
        }

        $normalized = [];
        foreach ($value as $candidate) {
            $id = $this->positiveInteger($candidate);
            if ($id === null || in_array($id, $normalized, true)) {
                return null;
            }
            $normalized[] = $id;
        }

        return $normalized;
    }

    private function requiredIdempotencyKey(): string|false
    {
        $header = request()->header('Idempotency-Key');
        $body = request()->input('idempotency_key');
        if (($header !== null && ! is_string($header)) || ($body !== null && ! is_string($body))) {
            return false;
        }

        $header = is_string($header) ? trim($header) : null;
        $body = is_string($body) ? trim($body) : null;
        if ($header !== null && $body !== null && ! hash_equals($header, $body)) {
            return false;
        }
        $key = $header ?? $body;

        return $key === null || $key === '' || mb_strlen($key) > 191 ? false : $key;
    }

    /**
     * @param array{session:\App\Models\EventSession,changed:bool,history_id:?int,agenda_version:int} $result
     * @return array<string,mixed>
     */
    private function sessionMutation(array $result, string $idempotencyKey): array
    {
        return [
            'session' => EventSessionContractMapper::session($result['session'], true),
            'agenda_version' => $result['agenda_version'],
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed']
                && $idempotencyKey !== ''
                && $result['history_id'] !== null,
            'history_entry_id' => $result['history_id'],
        ];
    }

    /**
     * @param array{
     *   session:?\App\Models\EventSession,
     *   changed:bool,
     *   history_id:?int,
     *   agenda_version:int,
     *   registration_version:int
     * } $result
     * @return array<string,mixed>
     */
    private function registrationMutation(array $result, string $idempotencyKey): array
    {
        return [
            'session' => $result['session'] instanceof EventSession
                ? EventSessionContractMapper::session($result['session'])
                : null,
            'registration_version' => $result['registration_version'],
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed']
                && $idempotencyKey !== ''
                && $result['history_id'] !== null,
            'history_entry_id' => $result['history_id'],
        ];
    }

    private function validationError(string $field): JsonResponse
    {
        return $this->respondWithError(
            'EVENT_AGENDA_VALIDATION_FAILED',
            __('api.validation_failed'),
            $field,
            422,
        );
    }

    private function privateResponse(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Pragma', 'no-cache');
        $response->setVary(['Authorization', 'Cookie', 'X-Tenant-ID'], false);

        return $response;
    }

    private function agendaError(EventSessionException $exception): JsonResponse
    {
        [$code, $message, $field, $status] = match ($exception->reasonCode) {
            'event_agenda_event_not_found', 'event_agenda_session_not_found' => [
                'EVENT_AGENDA_NOT_FOUND', __('api.event_not_found'), null, 404,
            ],
            'event_agenda_authorization_denied', 'event_agenda_actor_invalid' => [
                'EVENT_AGENDA_FORBIDDEN', __('api.forbidden'), null, 403,
            ],
            'event_agenda_version_conflict',
            'event_agenda_concurrent_write_failed',
            'event_agenda_idempotency_conflict',
            'event_agenda_registration_version_conflict',
            'event_agenda_registration_idempotency_conflict',
            'event_agenda_session_registration_not_found',
            'event_agenda_capacity_below_registrations',
            'event_agenda_room_conflict',
            'event_agenda_speaker_conflict' => [
                'EVENT_AGENDA_CONFLICT', __('api.invalid_input'), null, 409,
            ],
            'event_agenda_session_capacity_full' => [
                'EVENT_AGENDA_SESSION_FULL', __('api.invalid_input'), 'capacity', 409,
            ],
            'event_agenda_registration_eligibility_required' => [
                'EVENT_AGENDA_REGISTRATION_REQUIRED', __('api.forbidden'), null, 403,
            ],
            'event_agenda_schema_unavailable',
            'event_agenda_feature_disabled',
            'event_agenda_tenant_context_missing' => [
                'EVENT_AGENDA_UNAVAILABLE', __('api.service_unavailable'), null, 503,
            ],
            'event_agenda_persistence_failed',
            'event_agenda_version_invalid',
            'event_agenda_resource_decryption_failed' => [
                'EVENT_AGENDA_SERVER_ERROR', __('api.server_error'), null, 500,
            ],
            'event_agenda_expected_version_invalid' => [
                'EVENT_AGENDA_VALIDATION_FAILED', __('api.validation_failed'), 'expected_version', 422,
            ],
            'event_agenda_registration_expected_version_invalid' => [
                'EVENT_AGENDA_VALIDATION_FAILED', __('api.validation_failed'), 'expected_version', 422,
            ],
            'event_agenda_idempotency_key_invalid' => [
                'EVENT_AGENDA_VALIDATION_FAILED', __('api.validation_failed'), 'idempotency_key', 422,
            ],
            'event_agenda_cancellation_reason_invalid' => [
                'EVENT_AGENDA_VALIDATION_FAILED', __('api.validation_failed'), 'reason', 422,
            ],
            default => [
                'EVENT_AGENDA_VALIDATION_FAILED', __('api.validation_failed'), null, 422,
            ],
        };

        $response = $this->respondWithError($code, $message, $field, $status);
        if ($exception->operationNotApplied && $exception->reasonCode === 'event_agenda_version_conflict') {
            // Additive: preserve the existing error code for older clients.
            $response->setData([...$response->getData(true), 'operation_outcome' => 'not_applied']);
        }

        return $response;
    }
}
