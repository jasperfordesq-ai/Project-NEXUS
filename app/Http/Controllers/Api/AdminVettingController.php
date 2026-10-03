<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\MemberVettingAttestationService;
use App\Services\SafeguardingJurisdictionService;
use App\Services\SafeguardingPreferenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Broker safeguarding confirmations without certificate evidence.
 *
 * There is intentionally no generic record create/edit, arbitrary status,
 * certificate evidence/reference/result, upload, bulk-confirm, or delete
 * endpoint. Operational scope/private notes are encrypted by the service.
 */
class AdminVettingController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const PROHIBITED_INPUT_FIELDS = [
        'document', 'file', 'document_url', 'reference_number', 'certificate_number',
        'issue_date', 'expiry_date', 'renewal_date', 'notes', 'result', 'status',
        'scheme_code', 'attestation_code', 'vetting_type', 'purpose_code',
        'scope_type', 'scope_identifier', 'policy_version', 'confirmed_at',
        'works_with_children', 'works_with_vulnerable_adults', 'requires_enhanced_check',
    ];

    /**
     * F-437: fields of an attestation that are never returned to its own
     * subject, mirroring what MemberVettingAttestationService::getMemberStatus()
     * already withholds on the member-facing route.
     */
    private const SELF_WITHHELD_FIELDS = [
        'private_notes', 'scope_summary', 'revocation_reason_code', 'confirmed_by_name',
    ];

    public function __construct(
        private readonly MemberVettingAttestationService $attestations,
        private readonly SafeguardingJurisdictionService $jurisdictions,
    ) {}

    /** GET /v2/admin/vetting */
    public function list(): JsonResponse
    {
        $this->requireVettingDecisionMaker();
        $tenantId = TenantContext::getId();

        $result = $this->attestations->listMembers($tenantId, [
            'status' => $this->input('status', 'all'),
            'search' => $this->input('search', ''),
            'page' => $this->inputInt('page', 1, 1),
            'per_page' => $this->inputInt('per_page', 25, 1, 100),
        ]);

        return $this->respondWithData($result['data'], [
            'pagination' => $result['pagination'],
        ]);
    }

    /** GET /v2/admin/vetting/stats */
    public function stats(): JsonResponse
    {
        $this->requireVettingDecisionMaker();

        return $this->respondWithData($this->attestations->stats(TenantContext::getId()));
    }

    /** GET /v2/admin/vetting/{id} */
    public function show(int $id): JsonResponse
    {
        $callerId = $this->requireVettingDecisionMaker();
        $record = $this->attestations->getById($id, TenantContext::getId());

        if ($record === null) {
            return $this->respondWithError('NOT_FOUND', __('api.vetting_confirmation_not_found'), null, 404);
        }

        return $this->respondWithData($this->withholdOwnPrivateFields($record, $callerId));
    }

    /** GET /v2/admin/vetting/user/{userId} */
    public function getUserRecords(int $userId): JsonResponse
    {
        $callerId = $this->requireVettingDecisionMaker();

        try {
            $records = $this->attestations->getUserRecords($userId, TenantContext::getId());

            return $this->respondWithData(array_map(
                fn (array $record): array => $this->withholdOwnPrivateFields($record, $callerId),
                $records,
            ));
        } catch (SafeguardingPolicyException $e) {
            return $this->policyError($e);
        }
    }

    /** GET /v2/admin/vetting/policy */
    public function policy(): JsonResponse
    {
        $this->requireVettingDecisionMaker();
        $tenantId = TenantContext::getId();

        return $this->respondWithData([
            'policy' => $this->jurisdictions->getPolicy($tenantId),
            'jurisdictions' => $this->jurisdictions->availableJurisdictions(),
            'revocation_reason_codes' => MemberVettingAttestationService::REVOCATION_REASON_CODES,
            'review_resolution_codes' => MemberVettingAttestationService::REVIEW_RESOLUTION_CODES,
        ]);
    }

    /** PUT /v2/admin/vetting/policy */
    public function updatePolicy(): JsonResponse
    {
        // Only an admin chooses the community's safeguarding jurisdiction
        // (owner decision, 3 Oct 2026, reversing F-546's 2 Oct widening).
        // Brokers and coordinators read it on the broker Vetting page, marked
        // "Admin only", and every broker page shows a notice while it is unset.
        // AdminTier, so a broker with a stray admin flag is refused too — the
        // screen uses the same rule (isAdminTierUser in lib/access.ts).
        $adminId = $this->requireAdmin();
        if (($error = $this->rejectProhibitedInput(['jurisdiction'])) !== null) {
            return $error;
        }
        $tenantId = TenantContext::getId();
        $jurisdiction = trim((string) $this->input('jurisdiction', ''));

        if ($jurisdiction === '') {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.safeguarding_jurisdiction_required'),
                'jurisdiction',
                422,
            );
        }

        try {
            $previousPolicy = $this->jurisdictions->getPolicy($tenantId);
            $result = DB::transaction(function () use ($tenantId, $jurisdiction, $adminId, $previousPolicy): array {
                $policy = $this->jurisdictions->configure($tenantId, $jurisdiction, $adminId);
                $transition = is_string($policy['preset'] ?? null) && $policy['preset'] !== ''
                    ? SafeguardingPreferenceService::replaceCountryPreset(
                        $tenantId,
                        $policy['preset'],
                        $previousPolicy['jurisdiction'] !== $policy['jurisdiction'],
                        $adminId,
                    )
                    : SafeguardingPreferenceService::preservePresetProtectionsForUnavailablePolicy(
                        $tenantId,
                        $adminId,
                    );

                return ['policy' => $policy, 'transition' => $transition];
            });
            // `configure()` resolves its response inside the transaction. Reload
            // after commit so no uncommitted policy value can remain cached.
            $this->jurisdictions->forget($tenantId);
            $policy = $this->jurisdictions->getPolicy($tenantId);

            return $this->respondWithData([
                'policy' => $policy,
                'preference_transition' => $result['transition'],
                'message' => __('api.safeguarding_jurisdiction_updated'),
            ]);
        } catch (SafeguardingPolicyException $e) {
            $this->jurisdictions->forget($tenantId);
            return $this->policyError($e);
        } catch (Throwable $e) {
            $this->jurisdictions->forget($tenantId);
            throw $e;
        }
    }

    /** POST /v2/admin/vetting/policy/rotate */
    public function rotatePolicy(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        if (($error = $this->rejectProhibitedInput(['acknowledgement', 'reason_code'])) !== null) {
            return $error;
        }
        $tenantId = TenantContext::getId();
        if (! $this->inputBool('acknowledgement', false)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.safeguarding_policy_rotation_acknowledgement_required'),
                'acknowledgement',
                422,
            );
        }
        $reasonCode = trim((string) $this->input('reason_code', 'policy_changed'));
        if (! in_array($reasonCode, ['policy_changed', 'scheduled_review', 'incident_response'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_reason_code'), 'reason_code', 422);
        }

        try {
            $rotation = $this->jurisdictions->rotatePolicyVersion($tenantId, $adminId, $reasonCode);
            $policy = $rotation['policy'];
            $affectedMembers = $rotation['affected_member_ids'];

            foreach ($affectedMembers as $memberId) {
                $member = DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $memberId)
                    ->first(['preferred_language']);
                try {
                    LocaleContext::withLocale($member, function () use ($memberId, $tenantId): void {
                        Notification::createNotification(
                            $memberId,
                            __('safeguarding.review.attestation_policy_rotated_member'),
                            '/settings',
                            'safeguarding_vetting_review',
                            true,
                            $tenantId,
                        );
                    });
                } catch (Throwable $e) {
                    Log::warning('Safeguarding policy rotation member notification failed', [
                        'tenant_id' => $tenantId,
                        'member_id' => $memberId,
                        'exception' => $e::class,
                    ]);
                }
            }

            return $this->respondWithData([
                'policy' => $policy,
                'reason_code' => $reasonCode,
                'affected_member_count' => count($affectedMembers),
                'message' => __('api.safeguarding_policy_rotated'),
            ]);
        } catch (SafeguardingPolicyException $e) {
            return $this->policyError($e);
        }
    }

    /** POST /v2/admin/vetting/user/{userId}/confirm */
    public function confirm(int $userId): JsonResponse
    {
        $actorId = $this->requireVettingDecisionMaker();
        if (($error = $this->rejectProhibitedInput([
            'acknowledgement',
            'review_request_id',
            'certification_codes',
            'scope_summary',
            'private_notes',
            'review_due_at',
            'authority_expires_at',
        ])) !== null) {
            return $error;
        }
        if (! $this->inputBool('acknowledgement', false)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.vetting_confirmation_acknowledgement_required'),
                'acknowledgement',
                422,
            );
        }

        $details = request()->validate([
            'certification_codes' => ['sometimes', 'array', 'min:1', 'max:3'],
            'certification_codes.*' => ['string', 'max:64', 'distinct'],
            'scope_summary' => ['sometimes', 'nullable', 'string', 'max:500'],
            'private_notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'review_due_at' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:today'],
            'authority_expires_at' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:today'],
        ]);

        try {
            $record = $this->attestations->confirmForCurrentPolicy(
                TenantContext::getId(),
                $userId,
                $actorId,
                $this->optionalPositiveInt('review_request_id'),
                $details,
            );
            $this->notifyMemberStatusUpdated($userId);

            return $this->respondWithData($record, null, 201);
        } catch (SafeguardingPolicyException $e) {
            return $this->policyError($e);
        }
    }

    /** POST /v2/admin/vetting/user/{userId}/revoke */
    public function revoke(int $userId): JsonResponse
    {
        $actorId = $this->requireVettingDecisionMaker();
        if (($error = $this->rejectProhibitedInput(['reason_code', 'review_request_id'])) !== null) {
            return $error;
        }

        $reasonCode = trim((string) $this->input('reason_code', 'community_decision_withdrawn'));

        try {
            $record = $this->attestations->revokeForCurrentPolicy(
                TenantContext::getId(),
                $userId,
                $actorId,
                $reasonCode,
                $this->optionalPositiveInt('review_request_id'),
            );
            $this->notifyMemberStatusUpdated($userId);

            return $this->respondWithData($record);
        } catch (SafeguardingPolicyException $e) {
            return $this->policyError($e);
        }
    }

    /** POST /v2/admin/vetting/reviews/{reviewId}/resolve */
    public function resolveReview(int $reviewId): JsonResponse
    {
        $actorId = $this->requireVettingDecisionMaker();
        if (($error = $this->rejectProhibitedInput(['resolution_code'])) !== null) {
            return $error;
        }

        try {
            $record = $this->attestations->resolveReview(
                TenantContext::getId(),
                $reviewId,
                $actorId,
                trim((string) $this->input('resolution_code', '')),
            );

            return $this->respondWithData($record);
        } catch (SafeguardingPolicyException $e) {
            return $this->policyError($e);
        }
    }

    /** @param list<string> $allowedFields */
    private function rejectProhibitedInput(array $allowedFields): ?JsonResponse
    {
        if (request()->allFiles() !== []) {
            return $this->respondWithError(
                'VETTING_EVIDENCE_PROHIBITED',
                __('api.vetting_evidence_prohibited'),
                'file',
                422,
            );
        }

        $inputKeys = array_keys($this->getAllInput());
        $prohibited = array_intersect($inputKeys, self::PROHIBITED_INPUT_FIELDS);
        $unknown = array_diff($inputKeys, $allowedFields);
        if ($prohibited !== [] || $unknown !== []) {
            return $this->respondWithError(
                'VETTING_EVIDENCE_PROHIBITED',
                __('api.vetting_evidence_prohibited'),
                (string) (array_values(array_merge($prohibited, $unknown))[0] ?? 'request'),
                422,
            );
        }

        return null;
    }

    /**
     * F-437: a vetting decision-maker may read their own clearance state, but
     * never the private fields recorded about them. `requireVettingDecisionMaker()`
     * admits a broker deliberately, and neither read route compared the record's
     * subject with the caller, so the subject received the officer's decrypted
     * `private_notes` and `scope_summary`, the internal `revocation_reason_code`
     * and the deciding officer's name.
     *
     * These are exactly the four fields the platform's own member-facing route
     * already withholds — `MemberVettingAttestationService::getMemberStatus()`
     * returns only the policy, the decision, the review status and four dates.
     * Withholding rather than refusing keeps the decision-maker's legitimate
     * view of their own clearance state.
     *
     * @param array<string, mixed> $record
     * @return array<string, mixed>
     */
    private function withholdOwnPrivateFields(array $record, int $callerId): array
    {
        if ((int) ($record['user_id'] ?? 0) !== $callerId) {
            return $record;
        }

        foreach (self::SELF_WITHHELD_FIELDS as $field) {
            if (array_key_exists($field, $record)) {
                $record[$field] = null;
            }
        }

        return $record;
    }

    private function optionalPositiveInt(string $key): ?int
    {
        $value = $this->input($key);
        if ($value === null || $value === '') {
            return null;
        }

        $parsed = (int) $value;

        return $parsed > 0 ? $parsed : null;
    }

    private function policyError(SafeguardingPolicyException $e): JsonResponse
    {
        $status = match ($e->reasonCode) {
            'MEMBER_NOT_FOUND', 'VETTING_CONFIRMATION_NOT_FOUND', 'VETTING_REVIEW_REQUEST_NOT_FOUND' => 404,
            'VETTING_SELF_CONFIRMATION_FORBIDDEN', 'VETTING_DECISION_ACTOR_NOT_FOUND',
            // F-421: the decision maker does not outrank the subject.
            'INSUFFICIENT_PERMISSIONS' => 403,
            'SAFEGUARDING_POLICY_UNAVAILABLE', 'SAFEGUARDING_JURISDICTION_REQUIRED' => 409,
            default => 422,
        };

        $key = 'api.' . strtolower($e->reasonCode);
        $message = __($key);
        if ($message === $key) {
            $message = __('api.vetting_decision_failed');
        }

        return $this->respondWithError($e->reasonCode, $message, null, $status);
    }

    private function notifyMemberStatusUpdated(int $memberId): void
    {
        $member = DB::table('users')
            ->where('id', $memberId)
            ->where('tenant_id', TenantContext::getId())
            ->select(['id', 'preferred_language'])
            ->first();
        if ($member === null) {
            return;
        }

        try {
            LocaleContext::withLocale($member->preferred_language ?? null, static function () use ($memberId): void {
                Notification::createNotification(
                    $memberId,
                    __('svc_notifications.vetting_status_updated'),
                    '/settings?safeguarding=1',
                    'safeguarding_status_updated',
                    false,
                    TenantContext::getId(),
                );
            });
        } catch (Throwable $e) {
            Log::warning('Safeguarding attestation member notification failed', [
                'tenant_id' => TenantContext::getId(),
                'member_id' => $memberId,
                'exception' => $e::class,
            ]);
        }
    }
}
