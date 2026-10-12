<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Exceptions\EventLifecycleHistoryException;
use App\Http\Requests\Events\ListEventLifecycleHistoryRequest;
use App\Http\Resources\EventLifecycleHistoryResource;
use App\Services\EventLifecycleHistoryQueryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Throwable;

/** Private, manager-only API over immutable Event lifecycle evidence. */
final class EventLifecycleHistoryController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventLifecycleHistoryQueryService $history,
    ) {}

    public function index(ListEventLifecycleHistoryRequest $request, int $id): JsonResponse
    {
        $validated = $request->validated();
        try {
            $result = $this->history->index(
                $id,
                $this->getActingUserId(),
                isset($validated['cursor']) ? (string) $validated['cursor'] : null,
                (int) ($validated['per_page'] ?? 20),
            );
        } catch (EventLifecycleHistoryException $exception) {
            return $this->historyError($exception);
        } catch (Throwable $exception) {
            Log::error('Event lifecycle history request failed', [
                'event_id' => $id,
                'exception' => $exception::class,
            ]);

            return $this->privateResponse($this->respondWithError(
                'EVENT_LIFECYCLE_HISTORY_SERVER_ERROR',
                __('api.server_error'),
                null,
                500,
            ));
        }

        return $this->privateResponse($this->respondWithData(
            array_map(EventLifecycleHistoryResource::fromModel(...), $result['items']),
            $result['meta'],
        ));
    }

    private function historyError(EventLifecycleHistoryException $exception): JsonResponse
    {
        [$code, $message, $field, $status] = match ($exception->reasonCode) {
            'event_lifecycle_history_event_not_found' => [
                'EVENT_LIFECYCLE_HISTORY_NOT_FOUND', __('api.event_not_found'), null, 404,
            ],
            'event_lifecycle_history_authorization_denied' => [
                'EVENT_LIFECYCLE_HISTORY_FORBIDDEN', __('api.forbidden'), null, 403,
            ],
            'event_lifecycle_history_cursor_invalid' => [
                'EVENT_LIFECYCLE_HISTORY_VALIDATION_FAILED', __('api.validation_failed'), 'cursor', 422,
            ],
            'event_lifecycle_history_schema_unavailable',
            'event_lifecycle_history_tenant_context_missing' => [
                'EVENT_LIFECYCLE_HISTORY_UNAVAILABLE', __('api.service_unavailable'), null, 503,
            ],
            default => [
                'EVENT_LIFECYCLE_HISTORY_VALIDATION_FAILED', __('api.validation_failed'), null, 422,
            ],
        };

        return $this->privateResponse(
            $this->respondWithError($code, $message, $field, $status),
        );
    }

    private function privateResponse(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Pragma', 'no-cache');
        $response->setVary(['Authorization', 'Cookie', 'X-Tenant-ID'], false);

        return $response;
    }
}
