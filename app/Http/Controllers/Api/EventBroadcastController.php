<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Exceptions\EventBroadcastException;
use App\Exceptions\SafeguardingPolicyException;
use App\Http\Requests\Events\CancelEventBroadcastRequest;
use App\Http\Requests\Events\CreateEventBroadcastRequest;
use App\Http\Requests\Events\EventBroadcastFormRequest;
use App\Http\Requests\Events\PreviewEventBroadcastRequest;
use App\Http\Requests\Events\RetryEventBroadcastRequest;
use App\Http\Requests\Events\ReviseEventBroadcastRequest;
use App\Http\Requests\Events\ScheduleEventBroadcastRequest;
use App\Services\EventBroadcastQueryService;
use App\Services\EventBroadcastService;
use App\Support\Events\EventBroadcastFoundationSupport;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

/** Thin private API over the versioned organizer-communications aggregate. */
final class EventBroadcastController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventBroadcastService $broadcasts,
        private readonly EventBroadcastQueryService $queries,
    ) {
    }

    public function index(Request $request, int $eventId): JsonResponse
    {
        $page = $this->positiveInteger($request->query('page', 1));
        $perPage = $this->positiveInteger($request->query('per_page', 20));
        if ($page === null || $perPage === null) {
            return $this->paginationValidationError($page === null ? 'page' : 'per_page');
        }
        try {
            $result = $this->queries->paginateForEvent(
                $eventId,
                $this->getActingUserId(),
                $page,
                min(100, $perPage),
                $this->wantsSummary($request),
            );
        } catch (EventBroadcastException $exception) {
            return $this->broadcastError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithPaginatedCollection(
            $result['items'],
            $result['total'],
            $result['page'],
            $result['per_page'],
        ));
    }

    public function show(Request $request, int $broadcastId): JsonResponse
    {
        $historyPage = $this->positiveInteger($request->query('history_page', 1));
        $historyPerPage = $this->positiveInteger($request->query('history_per_page', 50));
        if ($historyPage === null || $historyPerPage === null) {
            return $this->paginationValidationError(
                $historyPage === null ? 'history_page' : 'history_per_page',
            );
        }
        try {
            $detail = $this->queries->detail(
                $broadcastId,
                $this->getActingUserId(),
                $historyPage,
                min(100, $historyPerPage),
                $this->wantsSummary($request),
            );
        } catch (EventBroadcastException $exception) {
            return $this->broadcastError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData($detail));
    }

    public function preview(PreviewEventBroadcastRequest $request, int $eventId): JsonResponse
    {
        $validated = $request->validated();
        try {
            $preview = $this->broadcasts->preview(
                $eventId,
                $this->getActingUserId(),
                (string) $validated['variant'],
                (array) $validated['segments'],
                (array) $validated['channels'],
            );
        } catch (SafeguardingPolicyException $exception) {
            return $this->privateResponse($this->safeguardingPolicyError($exception));
        } catch (EventBroadcastException $exception) {
            return $this->broadcastError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData($preview));
    }

    public function store(CreateEventBroadcastRequest $request, int $eventId): JsonResponse
    {
        $validated = $request->validated();
        try {
            $result = $this->broadcasts->createDraft(
                $eventId,
                $this->getActingUserId(),
                (string) $validated['variant'],
                (array) $validated['segments'],
                (array) $validated['channels'],
                (string) $validated['body'],
                $request->idempotencyKey(),
            );
            $detail = $this->queries->detail((int) $result['broadcast']->id, $this->getActingUserId());
        } catch (EventBroadcastException $exception) {
            return $this->broadcastError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->mutationResponse($detail, $result['changed'], 201);
    }

    public function revise(ReviseEventBroadcastRequest $request, int $broadcastId): JsonResponse
    {
        $validated = $request->validated();
        try {
            $result = $this->broadcasts->reviseDraft(
                $broadcastId,
                $this->getActingUserId(),
                (int) $validated['expected_version'],
                (string) $validated['variant'],
                (array) $validated['segments'],
                (array) $validated['channels'],
                (string) $validated['body'],
                $request->idempotencyKey(),
            );
            $detail = $this->queries->detail($broadcastId, $this->getActingUserId());
        } catch (EventBroadcastException $exception) {
            return $this->broadcastError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->mutationResponse($detail, $result['changed']);
    }

    public function schedule(ScheduleEventBroadcastRequest $request, int $broadcastId): JsonResponse
    {
        $validated = $request->validated();
        $scheduledAt = isset($validated['scheduled_at'])
            ? CarbonImmutable::parse((string) $validated['scheduled_at'])
            : null;
        try {
            $result = $this->broadcasts->schedule(
                $broadcastId,
                $this->getActingUserId(),
                (int) $validated['expected_version'],
                $scheduledAt,
                $request->idempotencyKey(),
            );
            $detail = $this->queries->detail($broadcastId, $this->getActingUserId());
        } catch (SafeguardingPolicyException $exception) {
            return $this->privateResponse($this->safeguardingPolicyError($exception));
        } catch (EventBroadcastException $exception) {
            return $this->broadcastError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->mutationResponse($detail, $result['changed']);
    }

    public function cancel(CancelEventBroadcastRequest $request, int $broadcastId): JsonResponse
    {
        $validated = $request->validated();
        try {
            $result = $this->broadcasts->cancel(
                $broadcastId,
                $this->getActingUserId(),
                (int) $validated['expected_version'],
                (string) $validated['reason'],
                $request->idempotencyKey(),
            );
            $detail = $this->queries->detail($broadcastId, $this->getActingUserId());
        } catch (EventBroadcastException $exception) {
            return $this->broadcastError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->mutationResponse($detail, $result['changed']);
    }

    public function retry(RetryEventBroadcastRequest $request, int $broadcastId): JsonResponse
    {
        $validated = $request->validated();
        try {
            $result = $this->broadcasts->retryFailed(
                $broadcastId,
                $this->getActingUserId(),
                (int) $validated['expected_version'],
                $request->idempotencyKey(),
            );
            $detail = $this->queries->detail($broadcastId, $this->getActingUserId());
        } catch (EventBroadcastException $exception) {
            return $this->broadcastError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->mutationResponse($detail, $result['changed']);
    }

    /** @param array<string,mixed> $detail */
    private function mutationResponse(array $detail, bool $changed, int $createdStatus = 200): JsonResponse
    {
        return $this->privateResponse($this->respondWithData([
            ...$detail,
            'changed' => $changed,
            'idempotent_replay' => ! $changed,
        ], null, $changed ? $createdStatus : 200));
    }

    private function broadcastError(EventBroadcastException $exception): JsonResponse
    {
        [$code, $message, $field, $status] = match ($exception->reasonCode) {
            'event_broadcast_not_found', 'event_broadcast_event_not_found' =>
                ['EVENT_BROADCAST_NOT_FOUND', __('api.event_not_found'), null, 404],
            'event_broadcast_authorization_denied', 'event_broadcast_actor_invalid' =>
                ['EVENT_BROADCAST_FORBIDDEN', __('api.forbidden'), null, 403],
            'event_broadcast_schema_unavailable',
            'event_broadcast_audience_schema_unavailable',
            'event_broadcast_feature_disabled',
            'event_broadcast_feature_unavailable',
            'event_broadcast_tenant_context_missing' =>
                ['EVENT_BROADCAST_UNAVAILABLE', __('api.service_unavailable'), null, 503],
            'event_broadcast_version_conflict',
            'event_broadcast_idempotency_conflict',
            'event_broadcast_transition_invalid',
            'event_broadcast_cancel_after_send_forbidden' =>
                ['EVENT_BROADCAST_CONFLICT', __('api.invalid_input'), null, 409],
            'event_broadcast_body_invalid' =>
                ['EVENT_BROADCAST_VALIDATION_FAILED', __('api.validation_failed'), 'body', 422],
            // Emitted only after replay lookup proves this schedule was not accepted.
            'event_broadcast_schedule_in_past' =>
                ['EVENT_BROADCAST_SCHEDULE_IN_PAST', __('api.validation_failed'), 'scheduled_at', 422],
            'event_broadcast_post_event_too_early',
            'event_broadcast_event_schedule_invalid' =>
                ['EVENT_BROADCAST_VALIDATION_FAILED', __('api.validation_failed'), 'scheduled_at', 422],
            'event_broadcast_audience_empty',
            'event_broadcast_audience_invalid',
            'event_broadcast_audience_segment_invalid',
            'event_broadcast_post_event_audience_invalid',
            'event_broadcast_review_audience_invalid' =>
                ['EVENT_BROADCAST_VALIDATION_FAILED', __('api.validation_failed'), 'segments', 422],
            'event_broadcast_channel_empty', 'event_broadcast_channel_invalid' =>
                ['EVENT_BROADCAST_VALIDATION_FAILED', __('api.validation_failed'), 'channels', 422],
            'event_broadcast_variant_invalid' =>
                ['EVENT_BROADCAST_VALIDATION_FAILED', __('api.validation_failed'), 'variant', 422],
            'event_broadcast_cancel_reason_invalid' =>
                ['EVENT_BROADCAST_VALIDATION_FAILED', __('api.validation_failed'), 'reason', 422],
            'event_broadcast_idempotency_key_invalid' =>
                ['EVENT_BROADCAST_VALIDATION_FAILED', __('api.validation_failed'), 'idempotency_key', 422],
            default => ['EVENT_BROADCAST_VALIDATION_FAILED', __('api.validation_failed'), null, 422],
        };
        $explained = EventBroadcastFormRequest::EXPLAINED_ERRORS[$exception->reasonCode] ?? null;
        if ($explained !== null) {
            $error = [
                'code' => $code,
                'message' => __($explained, ['max' => EventBroadcastFoundationSupport::MAX_BODY_LENGTH]),
                'reason' => $exception->reasonCode,
            ];
            if ($field !== null) {
                $error['field'] = $field;
            }

            return $this->privateResponse($this->respondWithErrors([$error], $status));
        }

        return $this->privateResponse($this->respondWithError($code, $message, $field, $status));
    }

    /** `?include=summary`: opt-in, because the store app's schemas reject unknown fields. */
    private function wantsSummary(Request $request): bool
    {
        $include = $request->query('include');

        return is_string($include)
            && in_array('summary', array_map('trim', explode(',', $include)), true);
    }

    private function unexpected(Throwable $exception): JsonResponse
    {
        // Where it failed, and for a database error its SQLSTATE and driver
        // code. Never the message: a query exception embeds its bindings,
        // which can include the organiser's text (E-106).
        $context = [
            'exception' => $exception::class,
            'reason_code' => 'event_broadcast_server_error',
            'origin' => basename($exception->getFile()) . ':' . $exception->getLine(),
        ];
        if ($exception instanceof \Illuminate\Database\QueryException) {
            $context['sqlstate'] = (string) ($exception->errorInfo[0] ?? '');
            $context['driver_code'] = (int) ($exception->errorInfo[1] ?? 0);
        }
        Log::error('Event broadcast request failed', $context);
        return $this->privateResponse($this->respondWithError(
            'EVENT_BROADCAST_SERVER_ERROR',
            __('api.server_error'),
            null,
            500,
        ));
    }

    private function privateResponse(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Pragma', 'no-cache');
        $response->setVary(['Authorization', 'Cookie', 'X-Tenant-ID'], false);
        return $response;
    }

    private function positiveInteger(mixed $value): ?int
    {
        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $parsed === false ? null : (int) $parsed;
    }

    private function paginationValidationError(string $field): JsonResponse
    {
        return $this->privateResponse($this->respondWithError(
            'EVENT_BROADCAST_VALIDATION_FAILED',
            __('api.validation_failed'),
            $field,
            422,
        ));
    }
}
