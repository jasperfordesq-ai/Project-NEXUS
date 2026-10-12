<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Exceptions\EventTemplateException;
use App\Http\Requests\Events\ArchiveEventTemplateRequest;
use App\Http\Requests\Events\CaptureEventTemplateRequest;
use App\Http\Requests\Events\ListEventTemplateHistoryRequest;
use App\Http\Requests\Events\ListEventTemplatesRequest;
use App\Http\Requests\Events\MaterializeEventTemplateRequest;
use App\Http\Requests\Events\PreviewEventTemplateMaterializationRequest;
use App\Http\Requests\Events\ReviseEventTemplateRequest;
use App\Http\Resources\EventTemplateAuditResource;
use App\Http\Resources\EventTemplateMaterializationResource;
use App\Http\Resources\EventTemplatePreviewResource;
use App\Http\Resources\EventTemplateResource;
use App\Services\EventTemplateQueryService;
use App\Services\EventTemplateService;
use Illuminate\Http\JsonResponse;
use Throwable;

/** Canonical API for preview-first, allowlist-only event templates and cloning. */
final class EventTemplateController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventTemplateService $templates,
        private readonly EventTemplateQueryService $queries,
    ) {}

    public function index(ListEventTemplatesRequest $request): JsonResponse
    {
        $validated = $request->validated();
        try {
            $result = $this->queries->index(
                $this->getActingUserId(),
                (string) ($validated['status'] ?? 'active'),
                isset($validated['source_event_id']) ? (int) $validated['source_event_id'] : null,
                isset($validated['search']) ? (string) $validated['search'] : null,
                isset($validated['cursor']) ? (int) $validated['cursor'] : null,
                (int) ($validated['per_page'] ?? 20),
            );
        } catch (EventTemplateException $exception) {
            return $this->templateError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData(
            array_map(EventTemplateResource::fromRecord(...), $result['records']),
            $result['meta'],
        ));
    }

    public function show(int $templateId): JsonResponse
    {
        try {
            $record = $this->queries->show($templateId, $this->getActingUserId());
        } catch (EventTemplateException $exception) {
            return $this->templateError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse(
            $this->respondWithData(EventTemplateResource::fromRecord($record)),
        );
    }

    public function history(
        ListEventTemplateHistoryRequest $request,
        int $templateId,
    ): JsonResponse {
        $validated = $request->validated();
        try {
            $result = $this->queries->history(
                $templateId,
                $this->getActingUserId(),
                isset($validated['cursor']) ? (int) $validated['cursor'] : null,
                (int) ($validated['per_page'] ?? 50),
            );
        } catch (EventTemplateException $exception) {
            return $this->templateError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData(
            array_map(EventTemplateAuditResource::fromModel(...), $result['audits']),
            $result['meta'],
        ));
    }

    public function previewCapture(int $sourceEventId): JsonResponse
    {
        try {
            $preview = $this->templates->previewCapture(
                $sourceEventId,
                $this->getActingUserId(),
            );
        } catch (EventTemplateException $exception) {
            return $this->templateError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData(
            EventTemplatePreviewResource::capture($preview),
        ));
    }

    public function capture(
        CaptureEventTemplateRequest $request,
        int $sourceEventId,
    ): JsonResponse {
        try {
            $result = $this->templates->capture(
                $sourceEventId,
                $this->getActingUserId(),
                $request->idempotencyKey(),
            );
            $record = $this->queries->show(
                (int) $result['template']->id,
                $this->getActingUserId(),
            );
        } catch (EventTemplateException $exception) {
            return $this->templateError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData([
            'template' => EventTemplateResource::fromRecord($record),
            'changed' => $result['created'],
            'idempotent_replay' => ! $result['created'],
        ], null, $result['created'] ? 201 : 200));
    }

    public function revise(
        ReviseEventTemplateRequest $request,
        int $templateId,
    ): JsonResponse {
        try {
            $result = $this->templates->revise(
                $templateId,
                $this->getActingUserId(),
                (int) $request->validated('expected_version'),
                $request->idempotencyKey(),
            );
            $record = $this->queries->show($templateId, $this->getActingUserId());
        } catch (EventTemplateException $exception) {
            return $this->templateError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData([
            'template' => EventTemplateResource::fromRecord($record),
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed'],
        ]));
    }

    public function archive(
        ArchiveEventTemplateRequest $request,
        int $templateId,
    ): JsonResponse {
        try {
            $result = $this->templates->archive(
                $templateId,
                $this->getActingUserId(),
                (int) $request->validated('expected_version'),
                trim((string) $request->validated('reason')),
                $request->idempotencyKey(),
            );
            $record = $this->queries->show($templateId, $this->getActingUserId());
        } catch (EventTemplateException $exception) {
            return $this->templateError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData([
            'template' => EventTemplateResource::fromRecord($record),
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed'],
        ]));
    }

    public function previewMaterialization(
        PreviewEventTemplateMaterializationRequest $request,
        int $templateId,
    ): JsonResponse {
        $input = $request->materializationInput();
        try {
            $preview = $this->templates->previewMaterialization(
                $templateId,
                $input['template_version'],
                $this->getActingUserId(),
                $input['start_time'],
                $input['end_time'],
                $input['overrides'],
            );
        } catch (EventTemplateException $exception) {
            return $this->templateError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData(
            EventTemplatePreviewResource::materialization($preview),
        ));
    }

    public function materialize(
        MaterializeEventTemplateRequest $request,
        int $templateId,
    ): JsonResponse {
        $input = $request->materializationInput();
        try {
            $result = $this->templates->materialize(
                $templateId,
                $input['template_version'],
                $this->getActingUserId(),
                $input['start_time'],
                $input['end_time'],
                $input['overrides'],
                $request->idempotencyKey(),
            );
        } catch (EventTemplateException $exception) {
            return $this->templateError($exception);
        } catch (Throwable $exception) {
            return $this->unexpected($exception);
        }

        return $this->privateResponse($this->respondWithData(
            EventTemplateMaterializationResource::fromResult(
                $result['event'],
                $result['materialization'],
                $result['created'],
            ),
            null,
            $result['created'] ? 201 : 200,
        ));
    }

    private function templateError(EventTemplateException $exception): JsonResponse
    {
        [$code, $message, $field, $status] = match ($exception->reasonCode) {
            'event_template_not_found',
            'event_template_source_not_found',
            'event_template_version_not_found' => [
                'EVENT_TEMPLATE_NOT_FOUND', __('api.event_not_found'), null, 404,
            ],
            'event_template_authorization_denied',
            'event_template_actor_not_active' => [
                'EVENT_TEMPLATE_FORBIDDEN', __('api.forbidden'), null, 403,
            ],
            'event_template_schema_unavailable',
            'event_template_feature_disabled',
            'event_template_tenant_context_required' => [
                'EVENT_TEMPLATE_UNAVAILABLE', __('api.service_unavailable'), null, 503,
            ],
            'event_template_version_conflict',
            'event_template_version_stale',
            'event_template_idempotency_conflict',
            'event_template_archived',
            'event_template_snapshot_integrity_invalid',
            'event_template_idempotency_evidence_invalid',
            'event_template_materialized_event_invalid' => [
                'EVENT_TEMPLATE_CONFLICT', __('api.invalid_input'), null, 409,
            ],
            'event_template_idempotency_key_invalid' => [
                'EVENT_TEMPLATE_VALIDATION_FAILED', __('api.validation_failed'), 'idempotency_key', 422,
            ],
            'event_template_archive_reason_invalid' => [
                'EVENT_TEMPLATE_VALIDATION_FAILED', __('api.validation_failed'), 'reason', 422,
            ],
            'event_template_schedule_start_invalid',
            'event_template_schedule_start_not_future' => [
                'EVENT_TEMPLATE_VALIDATION_FAILED', __('api.validation_failed'), 'start_time', 422,
            ],
            'event_template_schedule_end_invalid',
            'event_template_schedule_range_invalid',
            'event_template_all_day_end_required',
            'event_template_all_day_boundary_invalid' => [
                'EVENT_TEMPLATE_VALIDATION_FAILED', __('api.validation_failed'), 'end_time', 422,
            ],
            'event_template_schedule_timezone_invalid' => [
                'EVENT_TEMPLATE_VALIDATION_FAILED', __('api.validation_failed'), 'overrides.timezone', 422,
            ],
            'event_template_override_field_forbidden',
            'event_template_override_value_invalid',
            'event_template_payload_manifest_invalid' => [
                'EVENT_TEMPLATE_VALIDATION_FAILED', __('api.validation_failed'), 'overrides', 422,
            ],
            default => [
                'EVENT_TEMPLATE_VALIDATION_FAILED', __('api.validation_failed'), null, 422,
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
            'EVENT_TEMPLATE_SERVER_ERROR',
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
