<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Enums\EventStaffRole;
use App\Exceptions\EventRoleAssignmentException;
use App\Http\Resources\EventStaffResource;
use App\Support\Members\MemberProfileVisibility;
use App\Models\EventStaffAssignment;
use App\Models\User;
use App\Services\EventRoleService;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Http\JsonResponse;
use Throwable;

/** Canonical management API for tenant-scoped Events staff assignments. */
final class EventStaffController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventRoleService $roles,
    ) {}

    public function index(int $id): JsonResponse
    {
        $includeInactive = false;
        if (request()->has('include_inactive')) {
            $parsed = filter_var(
                request()->query('include_inactive'),
                FILTER_VALIDATE_BOOL,
                FILTER_NULL_ON_FAILURE,
            );
            if ($parsed === null) {
                return $this->validationError('include_inactive');
            }
            $includeInactive = $parsed;
        }

        try {
            $assignments = $this->roles->list($id, $this->actor(), $includeInactive);
        } catch (EventRoleAssignmentException $exception) {
            return $this->roleError($exception);
        }

        $viewerId = $this->requireUserId();
        $viewerIsAdmin = MemberProfileVisibility::viewerIsAdmin($viewerId);

        return $this->respondWithData(
            $assignments
                ->map(static fn (EventStaffAssignment $assignment): array => EventStaffResource::fromModel(
                    $assignment,
                    $viewerId,
                    $viewerIsAdmin,
                ))
                ->values()
                ->all(),
            [
                'include_inactive' => $includeInactive,
                'role_capabilities' => EventRoleService::capabilityMap(),
            ],
        );
    }

    public function store(int $id): JsonResponse
    {
        $userId = $this->positiveInteger(request()->input('user_id'));
        if ($userId === null) {
            return $this->validationError('user_id');
        }

        $rawRole = request()->input('role');
        if (! is_string($rawRole) || trim($rawRole) === '') {
            return $this->validationError('role');
        }
        $rawRole = trim($rawRole);
        if ($rawRole === 'owner') {
            return $this->roleError(new EventRoleAssignmentException('event_staff_role_owner_implicit'));
        }
        $role = EventStaffRole::tryFrom($rawRole);
        if ($role === null) {
            return $this->validationError('role');
        }

        $expiry = $this->expiry(request()->input('expires_at'));
        if ($expiry === false) {
            return $this->validationError('expires_at');
        }

        $idempotencyKey = $this->idempotencyKey();
        if ($idempotencyKey === false) {
            return $this->validationError('idempotency_key');
        }

        try {
            $result = $this->roles->grant(
                $id,
                $userId,
                $role,
                $this->actor(),
                $expiry,
                $idempotencyKey,
            );
        } catch (EventRoleAssignmentException $exception) {
            return $this->roleError($exception);
        }

        return $this->respondWithData(
            $this->mutationResponse($result, $idempotencyKey),
            null,
            $result['changed'] && (int) $result['assignment']->assignment_version === 1 ? 201 : 200,
        );
    }

    public function destroy(int $id, int $assignmentId): JsonResponse
    {
        $idempotencyKey = $this->idempotencyKey();
        if ($idempotencyKey === false) {
            return $this->validationError('idempotency_key');
        }

        try {
            $actor = $this->actor();
            $assignment = $this->roles->find($id, $assignmentId, $actor);
            if ($assignment === null) {
                throw new EventRoleAssignmentException('event_staff_role_assignment_not_found');
            }
            $role = $assignment->role instanceof EventStaffRole
                ? $assignment->role
                : EventStaffRole::tryFrom((string) $assignment->getRawOriginal('role'));
            if ($role === null) {
                throw new EventRoleAssignmentException('event_staff_role_assignment_invalid');
            }

            $result = $this->roles->revoke(
                $id,
                (int) $assignment->user_id,
                $role,
                $actor,
                $idempotencyKey,
            );
        } catch (EventRoleAssignmentException $exception) {
            return $this->roleError($exception);
        }

        if ($result['assignment'] === null) {
            return $this->roleError(
                new EventRoleAssignmentException('event_staff_role_assignment_not_found'),
            );
        }

        return $this->respondWithData($this->mutationResponse($result, $idempotencyKey));
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
            throw new EventRoleAssignmentException('event_staff_role_actor_invalid');
        }

        return $actor;
    }

    private function positiveInteger(mixed $value): ?int
    {
        $parsed = filter_var($value, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]);

        return $parsed === false ? null : (int) $parsed;
    }

    /** @return DateTimeInterface|false|null */
    private function expiry(mixed $value): DateTimeInterface|false|null
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value) || trim($value) === '') {
            return false;
        }

        try {
            return CarbonImmutable::parse($value)->utc()->startOfSecond();
        } catch (Throwable) {
            return false;
        }
    }

    private function idempotencyKey(): string|false|null
    {
        $header = request()->header('Idempotency-Key');
        $body = request()->input('idempotency_key');
        if (($header !== null && ! is_string($header)) || ($body !== null && ! is_string($body))) {
            return false;
        }

        $header = is_string($header) ? trim($header) : null;
        $body = is_string($body) ? trim($body) : null;
        if ($header !== null && $body !== null && $header !== $body) {
            return false;
        }

        return $header ?? $body;
    }

    /**
     * @param array{assignment:EventStaffAssignment,changed:bool,history_id:?int,outbox_id:?int} $result
     * @return array<string, mixed>
     */
    private function mutationResponse(array $result, ?string $idempotencyKey): array
    {
        return [
            'assignment' => EventStaffResource::fromModel(
                $result['assignment'],
                $this->requireUserId(),
                MemberProfileVisibility::viewerIsAdmin($this->requireUserId()),
            ),
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed']
                && $idempotencyKey !== null
                && $result['history_id'] !== null,
            'history_entry_id' => $result['history_id'],
        ];
    }

    private function validationError(string $field): JsonResponse
    {
        return $this->respondWithError(
            'EVENT_STAFF_VALIDATION_FAILED',
            __('api.validation_failed'),
            $field,
            422,
        );
    }

    private function roleError(EventRoleAssignmentException $exception): JsonResponse
    {
        [$code, $message, $field, $status] = match ($exception->reasonCode) {
            'event_staff_role_event_not_found' => [
                'EVENT_NOT_FOUND', __('api.event_not_found'), null, 404,
            ],
            'event_staff_role_target_invalid' => [
                'USER_NOT_FOUND', __('api.user_not_found'), 'user_id', 404,
            ],
            'event_staff_role_assignment_not_found' => [
                'EVENT_STAFF_ASSIGNMENT_NOT_FOUND', __('api.invalid_input'), null, 404,
            ],
            'event_staff_role_authorization_denied',
            'event_staff_role_privilege_escalation_denied',
            'event_staff_role_actor_invalid' => [
                'EVENT_STAFF_FORBIDDEN', __('api.forbidden'), null, 403,
            ],
            'event_staff_role_owner_implicit' => [
                'EVENT_STAFF_OWNER_ROLE_IMPLICIT', __('api.invalid_input'), 'role', 422,
            ],
            'event_staff_role_expiry_not_future' => [
                'EVENT_STAFF_EXPIRY_INVALID', __('api.invalid_input'), 'expires_at', 422,
            ],
            'event_staff_role_idempotency_key_invalid' => [
                'EVENT_STAFF_IDEMPOTENCY_KEY_INVALID', __('api.invalid_input'), 'idempotency_key', 422,
            ],
            'event_staff_role_idempotency_conflict' => [
                'EVENT_STAFF_IDEMPOTENCY_CONFLICT', __('api.invalid_input'), 'idempotency_key', 409,
            ],
            'event_staff_role_concurrent_write_failed',
            'event_staff_role_version_invalid' => [
                'EVENT_STAFF_CONFLICT', __('api.invalid_input'), null, 409,
            ],
            'event_staff_role_schema_unavailable',
            'event_staff_role_feature_disabled',
            'event_staff_role_tenant_context_missing' => [
                'EVENT_STAFF_UNAVAILABLE', __('api.service_unavailable'), null, 503,
            ],
            'event_staff_role_assignment_invalid',
            'event_staff_role_persistence_failed' => [
                'EVENT_STAFF_SERVER_ERROR', __('api.server_error'), null, 500,
            ],
            default => [
                'EVENT_STAFF_VALIDATION_FAILED', __('api.validation_failed'), null, 422,
            ],
        };

        return $this->respondWithError($code, $message, $field, $status);
    }
}
