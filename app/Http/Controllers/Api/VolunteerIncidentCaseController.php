<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\SafeguardingService;
use App\Services\Volunteering\IncidentAccess;
use App\Services\Volunteering\IncidentShareService;
use App\Services\Volunteering\IncidentTimelineService;
use App\Services\Volunteering\IncidentViews;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * The case record of a volunteering safeguarding incident, for each kind of viewer:
 * community staff (the case file), the person who reported it, and the
 * organisation it is linked to. Every answer is built by IncidentViews from an
 * IncidentAccess decision; an incident the caller may not see is "not found".
 */
class VolunteerIncidentCaseController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const TEXT_MAX = 5000;

    /** Information added by a reporter or an organisation must say something. */
    private const CONTRIBUTION_MIN = 20;

    public function __construct(
        private readonly IncidentTimelineService $timeline,
        private readonly IncidentShareService $shares,
        private readonly SafeguardingService $safeguardingService,
    ) {
    }

    // ── Staff ────────────────────────────────────────────────────────────────

    /** GET /v2/admin/volunteering/incidents/{id} — the full case file. */
    public function staffCase(int $id): JsonResponse
    {
        $this->ensureFeature();
        $staffId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();
        $incident = $this->staffIncident($id, $tenantId, $staffId);
        if (!$incident) {
            return $this->notFound();
        }

        $view = IncidentViews::staff(
            $incident,
            $this->timeline->forIncident($tenantId, $id),
            $this->shares->activeShare($tenantId, $incident)
        );
        $view['handlers'] = array_values(array_filter(
            $this->safeguardingService->getIncidentHandlers($tenantId),
            fn (array $h) => !IncidentAccess::isAboutUser($incident, (int) $h['id'])
        ));
        $view['organisation_leads'] = $this->leadNames($tenantId, (int) ($incident->organization_id ?? 0));

        return $this->respondWithData($view);
    }

    /** POST /v2/admin/volunteering/incidents/{id}/notes {body} */
    public function addNote(int $id): JsonResponse
    {
        $this->ensureFeature();
        $staffId = $this->requireBrokerOrAdmin();
        $this->rateLimit('vol_incident_case_write', 30, 60);
        $tenantId = TenantContext::getId();
        $incident = $this->staffIncident($id, $tenantId, $staffId);
        if (!$incident) {
            return $this->notFound();
        }
        $body = $this->text('body', 1);
        if ($body === null) {
            return $this->invalidText('body', 1);
        }

        $eventId = $this->timeline->record($tenantId, $id, 'staff_note', $staffId, 'staff', $body);

        return $this->respondWithData(['event_id' => $eventId], null, 201);
    }

    /** POST /v2/admin/volunteering/incidents/{id}/messages {audience: reporter|organisation, body} */
    public function sendMessage(int $id): JsonResponse
    {
        $this->ensureFeature();
        $staffId = $this->requireBrokerOrAdmin();
        $this->rateLimit('vol_incident_case_write', 30, 60);
        $tenantId = TenantContext::getId();
        $incident = $this->staffIncident($id, $tenantId, $staffId);
        if (!$incident) {
            return $this->notFound();
        }
        $audience = (string) ($this->getAllInput()['audience'] ?? '');
        $orgId = (int) ($incident->organization_id ?? 0);
        if (!in_array($audience, ['reporter', 'organisation'], true) || ($audience === 'organisation' && $orgId <= 0)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.vol_incident_invalid_field'), 'audience', 422);
        }
        $body = $this->text('body', 1);
        if ($body === null) {
            return $this->invalidText('body', 1);
        }

        $eventId = $audience === 'reporter'
            ? $this->timeline->record($tenantId, $id, 'message_to_reporter', $staffId, 'staff', $body)
            : $this->timeline->record($tenantId, $id, 'message_to_organisation', $staffId, 'staff', $body, [], $orgId);

        return $this->respondWithData(['event_id' => $eventId], null, 201);
    }

    /** POST /v2/admin/volunteering/incidents/{id}/share — full report to the organisation's lead. */
    public function share(int $id): JsonResponse
    {
        $this->ensureFeature();
        $staffId = $this->requireBrokerOrAdmin();
        $this->rateLimit('vol_incident_case_write', 30, 60);
        $tenantId = TenantContext::getId();
        $incident = $this->staffIncident($id, $tenantId, $staffId);
        if (!$incident) {
            return $this->notFound();
        }

        return match ($this->shares->share($tenantId, $incident, $staffId)) {
            'shared' => $this->respondWithData(['shared' => true], null, 201),
            'already_shared' => $this->respondWithData(['shared' => true]),
            'no_organisation' => $this->respondWithError('VALIDATION_ERROR', __('api.vol_incident_invalid_field'), 'organization_id', 422),
            default => $this->respondWithError('VALIDATION_ERROR', __('api.vol_incident_invalid_field'), 'dlp_user_id', 422),
        };
    }

    /** DELETE /v2/admin/volunteering/incidents/{id}/share */
    public function withdrawShare(int $id): JsonResponse
    {
        $this->ensureFeature();
        $staffId = $this->requireBrokerOrAdmin();
        $this->rateLimit('vol_incident_case_write', 30, 60);
        $tenantId = TenantContext::getId();
        $incident = $this->staffIncident($id, $tenantId, $staffId);
        if (!$incident || !$this->shares->withdraw($tenantId, $incident, $staffId)) {
            return $this->notFound();
        }

        return $this->respondWithData(['shared' => false]);
    }

    // ── The person who reported it ───────────────────────────────────────────

    /** GET /v2/volunteering/incidents/{id} — the reporter's own report and its history. */
    public function reporterCase(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_incident_get', 30, 60);
        $tenantId = TenantContext::getId();
        $incident = $this->reporterIncident($id, $tenantId, $userId);
        if (!$incident) {
            return $this->notFound();
        }

        return $this->respondWithData(IncidentViews::reporter($incident, $this->timeline->forIncident($tenantId, $id)));
    }

    /** POST /v2/volunteering/incidents/{id}/additions {body} — more information from the reporter. */
    public function addReporterInformation(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_incident_case_write', 30, 60);
        $tenantId = TenantContext::getId();
        $incident = $this->reporterIncident($id, $tenantId, $userId);
        if (!$incident) {
            return $this->notFound();
        }
        if ($incident->status === 'closed') {
            return $this->respondWithError('INCIDENT_CLOSED', __('api.vol_incident_closed'), null, 409);
        }
        $body = $this->text('body', self::CONTRIBUTION_MIN);
        if ($body === null) {
            return $this->invalidText('body', self::CONTRIBUTION_MIN);
        }

        $eventId = $this->timeline->record($tenantId, $id, 'reporter_addition', $userId, 'reporter', $body);

        return $this->respondWithData(['event_id' => $eventId], null, 201);
    }

    // ── Shared helpers ───────────────────────────────────────────────────────

    /** The incident when the caller reported it (including about themselves); otherwise null. */
    private function reporterIncident(int $id, int $tenantId, int $userId): ?object
    {
        $incident = $this->loadIncident($id, $tenantId);

        return $incident && IncidentAccess::reporterCanSee($incident, $userId) ? $incident : null;
    }

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('volunteering')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.vol_feature_disabled'), null, 403)
            );
        }
    }

    private function loadIncident(int $id, int $tenantId): ?object
    {
        return DB::table('vol_safeguarding_incidents')->where('id', $id)->where('tenant_id', $tenantId)->first();
    }

    private function staffIncident(int $id, int $tenantId, int $staffId): ?object
    {
        $incident = $this->loadIncident($id, $tenantId);

        return $incident && IncidentAccess::staffCanSee($incident, $tenantId, $staffId) ? $incident : null;
    }

    private function notFound(): JsonResponse
    {
        return $this->respondWithError('NOT_FOUND', __('api.vol_incident_not_found'), null, 404);
    }

    /** Trimmed text of $min–5,000 characters, or null when it is outside that. */
    private function text(string $field, int $min): ?string
    {
        $value = $this->getAllInput()[$field] ?? null;
        $value = is_string($value) ? trim($value) : '';
        $length = mb_strlen($value);

        return $length >= $min && $length <= self::TEXT_MAX ? $value : null;
    }

    private function invalidText(string $field, int $min): JsonResponse
    {
        return $this->respondWithError(
            'VALIDATION_ERROR',
            __('api.vol_incident_text_length', ['min' => $min, 'max' => self::TEXT_MAX]),
            $field,
            422
        );
    }

    /** @return list<array{id: int, name: string}> */
    private function leadNames(int $tenantId, int $organizationId): array
    {
        $ids = IncidentAccess::organisationLeadIds($tenantId, $organizationId);
        if ($ids === []) {
            return [];
        }

        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $ids)
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn ($u) => ['id' => (int) $u->id, 'name' => (string) $u->name])
            ->values()
            ->all();
    }
}
