<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\VolunteerQualificationException;
use App\Services\VolunteerQualificationService;
use App\Support\Authorization\AdminTier;
use Illuminate\Http\JsonResponse;

/**
 * VolunteerQualificationController — the volunteer qualifications register.
 *
 * Member routes (own records), organisation routes (volunteers linked to an
 * organisation the caller manages) and the community-staff list. Routes live
 * in routes/api-volunteering-qualifications.php.
 *
 * Authorisation summary (spec §2):
 *  - volunteer: own records only;
 *  - organisation confirmer: owner / owner-admin member of a volunteering
 *    organisation may read and confirm/withdraw for volunteers linked to it
 *    through an approved application;
 *  - community staff (admin, tenant admin, broker, coordinator): everything in
 *    the tenant;
 *  - nobody confirms their own record.
 */
class VolunteerQualificationController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly VolunteerQualificationService $qualifications,
    ) {
    }

    private function ensureFeature(): void
    {
        if (! TenantContext::hasFeature('volunteering')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.volunteering_feature_disabled'), null, 403)
            );
        }
    }

    private function tenantId(): int
    {
        return (int) TenantContext::getId();
    }

    /**
     * Same population as requireBrokerOrAdmin(), as a predicate: brokers and
     * coordinators plus the admin tier. Used where the alternative is not a
     * refusal but a narrower (organisation-scoped) check.
     */
    private function isStaff(object $user): bool
    {
        $role = (string) ($user->role ?? 'member');

        return in_array($role, ['broker', 'coordinator'], true) || AdminTier::allows($user);
    }

    /**
     * Mirrors VolunteerController::ensureOrgAccess: the organisation's owner,
     * an active owner/admin member, or an admin-tier user.
     */
    private function canOpenOrganization(int $orgId, object $user): bool
    {
        if (! $this->qualifications->organizationExists($this->tenantId(), $orgId)) {
            return false;
        }
        if ($this->qualifications->canManageOrganization($this->tenantId(), (int) $user->id, $orgId)) {
            return true;
        }

        return AdminTier::allows($user);
    }

    private function refuse(VolunteerQualificationException $e): JsonResponse
    {
        if ($e->errors() !== []) {
            return $this->respondWithErrors($e->errors(), $e->status());
        }

        return $this->respondWithError($e->errorCode(), $e->getMessage(), $e->field(), $e->status());
    }

    private function forbidden(string $message): JsonResponse
    {
        return $this->respondWithError('FORBIDDEN', $message, null, 403);
    }

    private function queryFlag(string $key): bool
    {
        $value = $this->query($key);

        return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes'], true);
    }

    // ========================================
    // MEMBER
    // ========================================

    /** GET /v2/volunteering/qualifications */
    public function index(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_qualifications_list', 60, 60);

        return $this->respondWithData($this->qualifications->listForUser($this->tenantId(), $userId));
    }

    /** POST /v2/volunteering/qualifications */
    public function store(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_qualifications_store', 20, 60);

        try {
            $qualification = $this->qualifications->create($this->tenantId(), $userId, $this->getAllInput());
        } catch (VolunteerQualificationException $e) {
            return $this->refuse($e);
        }

        return $this->respondWithData($qualification, null, 201);
    }

    /** PUT /v2/volunteering/qualifications/{id} — owner only */
    public function update($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_qualifications_update', 30, 60);

        try {
            $qualification = $this->qualifications->update($this->tenantId(), $userId, (int) $id, $this->getAllInput());
        } catch (VolunteerQualificationException $e) {
            return $this->refuse($e);
        }

        return $this->respondWithData($qualification);
    }

    /** POST /v2/volunteering/qualifications/{id}/withdraw — owner, confirmer for that volunteer, or staff */
    public function withdraw($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_qualifications_withdraw', 20, 60);

        $tenantId = $this->tenantId();
        $record = $this->qualifications->find($tenantId, (int) $id);
        if ($record === null) {
            return $this->respondWithError('NOT_FOUND', __('api.volunteer_qualification_not_found'), null, 404);
        }

        $organizationId = null;
        if ((int) $record->user_id !== $userId) {
            $user = $this->resolveUser();
            if (! $this->isStaff($user)) {
                $shared = array_values(array_intersect(
                    $this->qualifications->organizationsManagedBy($tenantId, $userId),
                    $this->qualifications->organizationsLinkedToVolunteer($tenantId, (int) $record->user_id),
                ));
                if ($shared === []) {
                    return $this->forbidden(__('api_controllers_2.volunteer.access_denied'));
                }
                $organizationId = (int) $shared[0];
            }
        }

        try {
            $qualification = $this->qualifications->withdraw(
                $tenantId,
                $userId,
                (int) $id,
                trim((string) $this->input('reason', '')),
                $organizationId,
            );
        } catch (VolunteerQualificationException $e) {
            return $this->refuse($e);
        }

        return $this->respondWithData($qualification);
    }

    // ========================================
    // ORGANISATION / STAFF
    // ========================================

    /** POST /v2/volunteering/qualifications/{id}/confirm */
    public function confirm($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_qualifications_confirm', 30, 60);

        $tenantId = $this->tenantId();
        $record = $this->qualifications->find($tenantId, (int) $id);
        if ($record === null) {
            return $this->respondWithError('NOT_FOUND', __('api.volunteer_qualification_not_found'), null, 404);
        }
        if ((int) $record->user_id === $userId) {
            return $this->respondWithError('SELF_CONFIRMATION', __('api.volunteer_qualification_self_confirmation'), null, 403);
        }

        $user = $this->resolveUser();
        $organizationId = $this->inputInt('organization_id');
        if ($organizationId !== null && $organizationId <= 0) {
            $organizationId = null;
        }

        if ($this->isStaff($user)) {
            // Staff confirm on the community's behalf; an organisation is
            // optional and only recorded when it is a real one here.
            if ($organizationId !== null && ! $this->qualifications->organizationExists($tenantId, $organizationId)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.volunteer_qualification_org_not_found'), 'organization_id', 422);
            }
        } else {
            if ($organizationId === null) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.volunteer_qualification_org_required'), 'organization_id', 422);
            }
            if (! $this->qualifications->canManageOrganization($tenantId, $userId, $organizationId)) {
                return $this->forbidden(__('api_controllers_2.volunteer.access_denied'));
            }
            if (! $this->qualifications->isVolunteerLinkedToOrganization($tenantId, (int) $record->user_id, $organizationId)) {
                return $this->forbidden(__('api.volunteer_qualification_not_linked'));
            }
        }

        try {
            $qualification = $this->qualifications->confirm(
                $tenantId,
                $userId,
                (int) $id,
                trim((string) $this->input('method', '')),
                $organizationId,
            );
        } catch (VolunteerQualificationException $e) {
            return $this->refuse($e);
        }

        return $this->respondWithData($qualification);
    }

    /** GET /v2/volunteering/organizations/{orgId}/qualifications */
    public function organizationIndex($orgId): JsonResponse
    {
        $this->ensureFeature();
        $this->getUserId();
        $this->rateLimit('vol_qualifications_org_list', 60, 60);

        $user = $this->resolveUser();
        if (! $this->canOpenOrganization((int) $orgId, $user)) {
            return $this->forbidden(__('api_controllers_2.volunteer.access_denied'));
        }

        $result = $this->qualifications->listForOrganization($this->tenantId(), (int) $orgId, [
            'status' => $this->query('status'),
            'q' => $this->query('q'),
            'expiring' => $this->queryFlag('expiring'),
            'cursor' => $this->query('cursor'),
            'per_page' => $this->queryInt('per_page', 20, 1, 50),
        ]);

        return $this->respondWithData($result);
    }

    /** GET /v2/admin/volunteering/qualifications — broker-or-admin */
    public function staffIndex(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireBrokerOrAdmin();
        $this->rateLimit('vol_qualifications_staff_list', 60, 60);

        $result = $this->qualifications->listForStaff($this->tenantId(), [
            'status' => $this->query('status'),
            'q' => $this->query('q'),
            'expiring' => $this->queryFlag('expiring'),
            'type' => $this->query('type'),
            'page' => $this->queryInt('page', 1, 1, 100000),
            'per_page' => $this->queryInt('per_page', 25, 1, 100),
        ]);

        return $this->respondWithData($result);
    }
}
