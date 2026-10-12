<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Exceptions\EventRecurrenceDefinitionBlueprintException;
use App\Http\Requests\Events\CommitEventRecurrenceDefinitionBlueprintRequest;
use App\Http\Requests\Events\PreviewEventRecurrenceDefinitionBlueprintRequest;
use App\Http\Resources\EventRecurrenceDefinitionBlueprintResource;
use App\Services\EventRecurrenceDefinitionBlueprintService;
use Illuminate\Http\JsonResponse;
use Throwable;

/** Explicit preview/commit API for future-occurrence definition propagation. */
final class EventRecurrenceDefinitionBlueprintController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventRecurrenceDefinitionBlueprintService $blueprints,
    ) {}

    public function history(int $id): JsonResponse
    {
        $rawLimit = request()->query('limit');
        $rawBefore = request()->query('before_version');
        $limit = $rawLimit === null
            ? 25
            : $this->canonicalPositiveDecimalInteger($rawLimit);
        if ($limit === null || $limit > 100) {
            return $this->historyValidationError('limit');
        }
        $beforeVersion = null;
        if ($rawBefore !== null) {
            $beforeVersion = $this->canonicalPositiveDecimalInteger($rawBefore);
            if ($beforeVersion === null) {
                return $this->historyValidationError('before_version');
            }
        }
        try {
            $history = $this->blueprints->history(
                $id,
                $this->getActingUserId(),
                $limit,
                $beforeVersion,
            );
        } catch (EventRecurrenceDefinitionBlueprintException $exception) {
            return $this->blueprintError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData(
            EventRecurrenceDefinitionBlueprintResource::history($history),
        ));
    }

    private function canonicalPositiveDecimalInteger(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value > 0 ? $value : null;
        }
        if (! is_string($value)
            || preg_match('/^[1-9][0-9]*$/D', $value) !== 1) {
            return null;
        }
        $integer = filter_var(
            $value,
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 1]],
        );

        return is_int($integer) ? $integer : null;
    }

    private function historyValidationError(string $field): JsonResponse
    {
        return $this->privateResponse($this->respondWithError(
            'EVENT_RECURRENCE_DEFINITION_VALIDATION_FAILED',
            __('api.validation_failed'),
            $field,
            422,
        ));
    }

    public function preview(
        PreviewEventRecurrenceDefinitionBlueprintRequest $request,
        int $id,
    ): JsonResponse {
        try {
            $preview = $this->blueprints->preview(
                $id,
                $this->getActingUserId(),
                $request->effectiveFromRecurrenceId(),
                $request->selectedSections(),
            );
        } catch (EventRecurrenceDefinitionBlueprintException $exception) {
            return $this->blueprintError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData(
            EventRecurrenceDefinitionBlueprintResource::preview($preview),
        ));
    }

    public function commit(
        CommitEventRecurrenceDefinitionBlueprintRequest $request,
        int $id,
    ): JsonResponse {
        try {
            $result = $this->blueprints->commit(
                $id,
                $this->getActingUserId(),
                $request->effectiveFromRecurrenceId(),
                $request->selectedSections(),
                $request->previewToken(),
                $request->idempotencyKey(),
            );
        } catch (EventRecurrenceDefinitionBlueprintException $exception) {
            return $this->blueprintError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData(
            EventRecurrenceDefinitionBlueprintResource::commit($result),
            null,
            $result['idempotent_replay'] ? 200 : 201,
        ));
    }

    private function blueprintError(
        EventRecurrenceDefinitionBlueprintException $exception,
    ): JsonResponse {
        [$code, $message, $field, $status] = match ($exception->reasonCode) {
            'event_recurrence_definition_source_invalid',
            'event_recurrence_definition_root_invalid' => [
                'EVENT_RECURRENCE_DEFINITION_NOT_FOUND', __('api.event_not_found'), null, 404,
            ],
            'event_recurrence_definition_actor_invalid',
            'event_recurrence_definition_authorization_denied' => [
                'EVENT_RECURRENCE_DEFINITION_FORBIDDEN', __('api.forbidden'), null, 403,
            ],
            'event_recurrence_definition_schema_unavailable',
            'event_recurrence_definition_rollout_disabled',
            'event_recurrence_definition_tenant_required',
            'event_recurrence_definition_token_key_unavailable' => [
                'EVENT_RECURRENCE_DEFINITION_UNAVAILABLE', __('api.service_unavailable'), null, 503,
            ],
            'event_recurrence_definition_token_invalid',
            'event_recurrence_definition_token_expired',
            'event_recurrence_definition_preview_stale' => [
                'EVENT_RECURRENCE_DEFINITION_PREVIEW_INVALID', __('api.invalid_input'), 'preview_token', 409,
            ],
            'event_recurrence_definition_conflict',
            'event_recurrence_definition_idempotency_conflict' => [
                'EVENT_RECURRENCE_DEFINITION_CONFLICT', __('api.invalid_input'), null, 409,
            ],
            default => [
                'EVENT_RECURRENCE_DEFINITION_VALIDATION_FAILED', __('api.validation_failed'), null, 422,
            ],
        };

        return $this->privateResponse(
            $this->respondWithError($code, $message, $field, $status),
        );
    }

    private function unexpected(Throwable $exception): JsonResponse
    {
        report($exception);

        return $this->privateResponse($this->respondWithError(
            'EVENT_RECURRENCE_DEFINITION_SERVER_ERROR',
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
}
