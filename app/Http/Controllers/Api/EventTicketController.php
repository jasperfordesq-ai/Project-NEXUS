<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\EventTicketingException;
use App\Http\Resources\EventTicketResource;
use App\Models\User;
use App\Services\EventTicketEntitlementService;
use App\Services\EventTicketQueryService;
use App\Services\EventTicketQuoteService;
use App\Services\EventTicketReconciliationService;
use App\Services\EventTicketTypeService;
use Illuminate\Http\JsonResponse;
use App\Support\Authorization\CrossTenantEntry;

/** Canonical free-ticket API; time-credit materialisation remains fail-closed. */
final class EventTicketController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * Refusals an organiser or member causes by what they entered or when
     * they acted: the input to fix and the message that explains it.
     *
     * @var array<string, array{0:?string,1:string}>
     */
    private const EXPLAINED_ERRORS = [
        'event_ticket_sales_open_invalid' => ['sales_opens_at', 'api.event_ticket_date_invalid'],
        'event_ticket_sales_close_invalid' => ['sales_closes_at', 'api.event_ticket_date_invalid'],
        'event_ticket_timezone_offset_mismatch' => [null, 'api.event_ticket_timezone_offset_mismatch'],
        'event_ticket_sales_window_invalid' => ['sales_closes_at', 'api.event_ticket_sales_window_invalid'],
        'event_ticket_refund_cutoff_invalid' => ['refund_cutoff_at', 'api.event_ticket_refund_cutoff_invalid'],
        'event_ticket_per_member_limit_invalid' => ['per_member_limit', 'api.event_ticket_per_member_limit_invalid'],
        'event_ticket_sales_window_closed' => [null, 'api.event_ticket_sales_window_closed'],
        'event_ticket_per_member_limit_exceeded' => ['units', 'api.event_ticket_per_member_limit_exceeded'],
        'event_ticket_confirmed_registration_required' => [null, 'api.event_ticket_confirmed_registration_required'],
        'event_ticket_allocation_exhausted' => ['units', 'api.event_ticket_allocation_exhausted'],
    ];

    public function __construct(
        private readonly EventTicketQueryService $queries,
        private readonly EventTicketQuoteService $quotes,
        private readonly EventTicketTypeService $types,
        private readonly EventTicketEntitlementService $entitlements,
        private readonly EventTicketReconciliationService $reconciliation,
    ) {}

    public function index(int $id): JsonResponse
    {
        try {
            $catalogue = $this->queries->read($id, $this->actor());
        } catch (EventTicketingException $exception) {
            return $this->ticketError($exception);
        }

        return $this->privateResponse($this->respondWithData(
            EventTicketResource::catalogue($catalogue),
        ));
    }

    public function quote(int $id, int $ticketTypeId): JsonResponse
    {
        $units = $this->positiveInteger(request()->input('units', 1));
        if ($units === null) {
            return $this->validationError('units');
        }
        try {
            $quote = $this->quotes->quote($id, $ticketTypeId, $this->actor(), $units);
        } catch (EventTicketingException $exception) {
            return $this->ticketError($exception);
        }

        return $this->privateResponse($this->respondWithData(EventTicketResource::quote($quote)));
    }

    public function createType(int $id): JsonResponse
    {
        $key = $this->requiredIdempotencyKey();
        if ($key === false) {
            return $this->validationError('idempotency_key');
        }
        try {
            $result = $this->types->create(
                $id,
                $this->actor(),
                request()->except(['idempotency_key']),
                $key,
            );
        } catch (EventTicketingException $exception) {
            return $this->ticketError($exception);
        }

        return $this->privateResponse($this->respondWithData([
            'ticket_type' => EventTicketResource::type($result['ticket_type']),
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed'],
        ], null, $result['changed'] ? 201 : 200));
    }

    public function updateType(int $id, int $ticketTypeId): JsonResponse
    {
        $version = $this->positiveInteger(request()->input('expected_version'));
        $key = $this->requiredIdempotencyKey();
        if ($version === null || $key === false) {
            return $this->validationError($version === null ? 'expected_version' : 'idempotency_key');
        }
        try {
            $result = $this->types->update(
                $id,
                $ticketTypeId,
                $this->actor(),
                request()->except(['expected_version', 'idempotency_key']),
                $version,
                $key,
            );
        } catch (EventTicketingException $exception) {
            return $this->ticketError($exception);
        }

        return $this->privateResponse($this->respondWithData([
            'ticket_type' => EventTicketResource::type($result['ticket_type']),
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed'],
        ]));
    }

    public function transitionType(int $id, int $ticketTypeId, string $action): JsonResponse
    {
        $version = $this->positiveInteger(request()->input('expected_version'));
        $key = $this->requiredIdempotencyKey();
        $reason = is_string(request()->input('reason')) ? trim((string) request()->input('reason')) : '';
        if ($version === null || $key === false) {
            return $this->validationError($version === null ? 'expected_version' : 'idempotency_key');
        }
        try {
            $result = match ($action) {
                'activate' => $this->types->activate($id, $ticketTypeId, $this->actor(), $version, $key),
                'pause' => $this->types->pause($id, $ticketTypeId, $this->actor(), $version, $key, $reason),
                'archive' => $this->types->archive($id, $ticketTypeId, $this->actor(), $version, $key, $reason),
                default => throw new EventTicketingException('event_ticket_type_transition_invalid'),
            };
        } catch (EventTicketingException $exception) {
            return $this->ticketError($exception);
        }

        return $this->privateResponse($this->respondWithData([
            'ticket_type' => EventTicketResource::type($result['ticket_type']),
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed'],
        ]));
    }

    public function allocateSelf(int $id, int $ticketTypeId): JsonResponse
    {
        $units = $this->positiveInteger(request()->input('units', 1));
        $key = $this->requiredIdempotencyKey();
        if ($units === null || $key === false) {
            return $this->validationError($units === null ? 'units' : 'idempotency_key');
        }
        try {
            $actor = $this->actor();
            $result = $this->entitlements->allocateSelf(
                $id,
                $ticketTypeId,
                $this->queries->confirmedRegistrationId($id, (int) $actor->id),
                $actor,
                $units,
                $key,
            );
        } catch (EventTicketingException $exception) {
            return $this->ticketError($exception);
        }

        return $this->privateResponse($this->respondWithData([
            'entitlement' => EventTicketResource::entitlement($result['entitlement']),
            'confirmed_units_after' => $result['confirmed_units_after'],
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed'],
        ], null, $result['changed'] ? 201 : 200));
    }

    public function allocateForMember(int $id, int $ticketTypeId, int $userId): JsonResponse
    {
        $units = $this->positiveInteger(request()->input('units', 1));
        $key = $this->requiredIdempotencyKey();
        if ($units === null || $key === false) {
            return $this->validationError($units === null ? 'units' : 'idempotency_key');
        }
        try {
            $result = $this->entitlements->allocateForMember(
                $id,
                $ticketTypeId,
                $this->queries->confirmedRegistrationId($id, $userId),
                $userId,
                $this->actor(),
                $units,
                $key,
            );
        } catch (EventTicketingException $exception) {
            return $this->ticketError($exception);
        }

        return $this->privateResponse($this->respondWithData([
            'entitlement' => EventTicketResource::entitlement($result['entitlement']),
            'confirmed_units_after' => $result['confirmed_units_after'],
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed'],
        ], null, $result['changed'] ? 201 : 200));
    }

    public function cancelEntitlement(int $id, int $entitlementId): JsonResponse
    {
        $version = $this->positiveInteger(request()->input('expected_version'));
        $key = $this->requiredIdempotencyKey();
        $reason = request()->input('reason');
        if ($version === null || $key === false || ! is_string($reason) || trim($reason) === '') {
            return $this->validationError(
                $version === null ? 'expected_version' : ($key === false ? 'idempotency_key' : 'reason'),
            );
        }
        try {
            $result = $this->entitlements->cancel(
                $id,
                $entitlementId,
                $this->actor(),
                $version,
                $reason,
                $key,
            );
        } catch (EventTicketingException $exception) {
            return $this->ticketError($exception);
        }

        return $this->privateResponse($this->respondWithData([
            'entitlement' => EventTicketResource::entitlement($result['entitlement']),
            'confirmed_units_after' => $result['confirmed_units_after'],
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed'],
        ]));
    }

    public function reconcile(int $id): JsonResponse
    {
        try {
            $report = $this->reconciliation->report($id, $this->actor());
        } catch (EventTicketingException $exception) {
            return $this->ticketError($exception);
        }

        return $this->privateResponse($this->respondWithData(
            EventTicketResource::reconciliation($report),
        ));
    }

    private function actor(): User
    {
        $tenantId = TenantContext::currentId();
        $actor = $tenantId === null ? null : User::withoutGlobalScopes()
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->find($this->requireUserId());
        // Own community, or a crossing CrossTenantEntry admits: a tenant super
        // admin managing a community below its own (owner rule, 12 Oct 2026).
        // Looked up by id, because that account's row is not in this community.
        // What the actor may do to the event is still the event policy's call.
        if ($actor instanceof User && ! CrossTenantEntry::actorMayActIn($actor, (int) $tenantId)) {
            $actor = null;
        }
        if (! $actor instanceof User) {
            throw new EventTicketingException('event_ticket_actor_invalid');
        }

        return $actor;
    }

    private function positiveInteger(mixed $value): ?int
    {
        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $parsed === false ? null : (int) $parsed;
    }

    private function requiredIdempotencyKey(): string|false
    {
        $header = request()->header('Idempotency-Key');
        $body = request()->input('idempotency_key');
        $header = is_string($header) ? trim($header) : null;
        $body = is_string($body) ? trim($body) : null;
        if ($header !== null && $body !== null && ! hash_equals($header, $body)) {
            return false;
        }
        $key = $header ?? $body;

        return $key === null || $key === '' || mb_strlen($key) > 191 ? false : $key;
    }

    private function validationError(string $field): JsonResponse
    {
        return $this->respondWithError(
            'EVENT_TICKET_VALIDATION_FAILED',
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

    private function ticketError(EventTicketingException $exception): JsonResponse
    {
        $reason = $exception->reasonCode;
        if (isset(self::EXPLAINED_ERRORS[$reason])) {
            // Same code and status as before; the message now says what is wrong.
            [$field, $messageKey] = self::EXPLAINED_ERRORS[$reason];
            // A check shared by several inputs (the timezone offset) names
            // the one it was checking on the exception itself.
            $field = $exception->field ?? $field;
            $conflict = $reason === 'event_ticket_allocation_exhausted';
            $error = [
                'code' => $conflict ? 'EVENT_TICKET_CONFLICT' : 'EVENT_TICKET_VALIDATION_FAILED',
                'message' => __($messageKey),
                'reason' => $reason,
            ];
            if ($field !== null) {
                $error['field'] = $field;
            }

            return $this->respondWithErrors([$error], $conflict ? 409 : 422);
        }
        if (in_array($reason, [
            'event_ticket_type_not_found',
            'event_ticket_entitlement_not_found',
            'event_ticket_event_not_found',
            'event_ticket_actor_invalid',
        ], true)) {
            return $this->respondWithError('EVENT_TICKET_NOT_FOUND', __('api.event_not_found'), null, 404);
        }
        if (in_array($reason, [
            'event_ticket_manage_finance_denied',
            'event_ticket_reconciliation_denied',
            'event_ticket_view_denied',
        ], true) || str_contains($reason, 'authorization') || str_contains($reason, 'forbidden')) {
            return $this->respondWithError('EVENT_TICKET_FORBIDDEN', __('api.forbidden'), null, 403);
        }
        if (str_contains($reason, 'schema_unavailable')
            || str_contains($reason, 'feature_disabled')
            || str_contains($reason, 'tenant_context_missing')) {
            return $this->respondWithError(
                'EVENT_TICKET_UNAVAILABLE',
                __('api.service_unavailable'),
                null,
                503,
            );
        }
        if (str_contains($reason, 'conflict')
            || str_contains($reason, 'exhausted')
            || str_contains($reason, 'already')) {
            return $this->respondWithError('EVENT_TICKET_CONFLICT', __('api.invalid_input'), null, 409);
        }
        if (str_contains($reason, 'persistence_failed')) {
            return $this->respondWithError('EVENT_TICKET_SERVER_ERROR', __('api.server_error'), null, 500);
        }

        return $this->respondWithError(
            'EVENT_TICKET_VALIDATION_FAILED',
            __('api.validation_failed'),
            null,
            422,
        );
    }
}
