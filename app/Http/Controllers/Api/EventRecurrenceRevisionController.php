<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Exceptions\EventRecurrenceRevisionException;
use App\Http\Requests\Events\CommitEventRecurrenceRevisionRequest;
use App\Http\Requests\Events\PreviewEventRecurrenceRevisionRequest;
use App\Http\Resources\EventRecurrenceRevisionResource;
use App\Services\EventRecurrenceRevisionService;
use Illuminate\Http\JsonResponse;
use Throwable;

/** Preview/commit API for explicit “this and future” recurrence revisions. */
final class EventRecurrenceRevisionController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventRecurrenceRevisionService $revisions,
    ) {}

    public function preview(
        PreviewEventRecurrenceRevisionRequest $request,
        int $id,
    ): JsonResponse {
        try {
            $preview = $this->revisions->preview(
                $id,
                $this->getActingUserId(),
                $request->revisionPatch(),
            );
        } catch (EventRecurrenceRevisionException $exception) {
            return $this->revisionError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData(
            EventRecurrenceRevisionResource::preview($preview),
        ));
    }

    public function commit(
        CommitEventRecurrenceRevisionRequest $request,
        int $id,
    ): JsonResponse {
        try {
            $result = $this->revisions->commit(
                $id,
                $this->getActingUserId(),
                $request->revisionPatch(),
                $request->previewToken(),
                $request->idempotencyKey(),
            );
        } catch (EventRecurrenceRevisionException $exception) {
            return $this->revisionError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData(
            EventRecurrenceRevisionResource::commit($result),
            null,
            $result['idempotent_replay'] ? 200 : 201,
        ));
    }

    private function revisionError(EventRecurrenceRevisionException $exception): JsonResponse
    {
        [$code, $message, $field, $status] = match ($exception->reasonCode) {
            'event_recurrence_revision_not_found',
            'event_recurrence_revision_concrete_occurrence_required' => [
                'EVENT_RECURRENCE_REVISION_NOT_FOUND', __('api.event_not_found'), null, 404,
            ],
            'event_recurrence_revision_authorization_denied',
            'event_recurrence_revision_actor_invalid' => [
                'EVENT_RECURRENCE_REVISION_FORBIDDEN', __('api.forbidden'), null, 403,
            ],
            'event_recurrence_revision_schema_unavailable',
            'event_recurrence_revision_feature_disabled',
            'event_recurrence_revision_rollout_disabled',
            'event_recurrence_revision_tenant_required',
            'event_recurrence_revision_token_key_unavailable' => [
                'EVENT_RECURRENCE_REVISION_UNAVAILABLE', __('api.service_unavailable'), null, 503,
            ],
            'event_recurrence_revision_idempotency_invalid' => [
                'EVENT_RECURRENCE_REVISION_VALIDATION_FAILED', __('api.validation_failed'), 'Idempotency-Key', 422,
            ],
            'event_recurrence_revision_patch_invalid',
            'event_recurrence_revision_timezone_invalid' => [
                'EVENT_RECURRENCE_REVISION_VALIDATION_FAILED', __('api.validation_failed'), 'patch', 422,
            ],
            'event_recurrence_revision_token_invalid',
            'event_recurrence_revision_token_scope_invalid' => [
                'EVENT_RECURRENCE_REVISION_PREVIEW_INVALID', __('api.invalid_input'), 'preview_token', 409,
            ],
            'event_recurrence_revision_token_expired' => [
                'EVENT_RECURRENCE_REVISION_PREVIEW_EXPIRED', __('api.invalid_input'), 'preview_token', 409,
            ],
            'event_recurrence_revision_preview_stale',
            'event_recurrence_revision_state_conflict',
            'event_recurrence_revision_idempotency_conflict',
            'event_recurrence_revision_review_pending',
            'event_recurrence_revision_resolution_required',
            'event_recurrence_revision_override_invalid',
            'event_recurrence_revision_rule_invalid',
            'event_recurrence_revision_evidence_invalid',
            'event_recurrence_revision_occurrence_identity_invalid' => [
                'EVENT_RECURRENCE_REVISION_CONFLICT', __('api.invalid_input'), null, 409,
            ],
            'event_recurrence_revision_size_limit' => [
                'EVENT_RECURRENCE_REVISION_LIMIT_EXCEEDED', __('api.invalid_input'), null, 413,
            ],
            default => [
                'EVENT_RECURRENCE_REVISION_VALIDATION_FAILED', __('api.validation_failed'), null, 422,
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
            'EVENT_RECURRENCE_REVISION_SERVER_ERROR',
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
