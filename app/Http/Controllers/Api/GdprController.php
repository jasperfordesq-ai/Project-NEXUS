<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Services\Enterprise\GdprService;
use App\Services\TokenService;

/**
 * GdprController — Eloquent-powered GDPR consent and data request endpoints.
 *
 * Fully migrated from legacy delegation. Uses legacy GdprService (instantiated)
 * for consent updates and data requests. Password verification uses DB facade.
 */
class GdprController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly TokenService $tokenService,
    ) {}

    private function gdprServiceForCurrentTenant(): GdprService
    {
        // Laravel can construct the controller before tenant middleware runs.
        // Bind this service after authentication has resolved the request tenant.
        return new GdprService($this->getTenantId());
    }

    /**
     * POST /api/v2/gdpr/consent
     *
     * Update user consent preference.
     *
     * Request body (JSON):
     * - consent_id: int (required, unless consent_type provided)
     * - consent_type: string (alternative to consent_id)
     * - granted: bool (required)
     */
    public function updateConsent(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('gdpr_consent', 30, 60);

        $consentId = $this->input('consent_id');
        $granted = $this->inputBool('granted', false);

        if (!$consentId && !$this->input('consent_type')) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'consent_id']), 'consent_id', 400);
        }

        // Resolve consent_id (int) to consent type slug, or use consent_type directly
        if ($consentId) {
            $consentRow = DB::table('consent_types')
                ->where('id', (int) $consentId)
                ->select('slug')
                ->first();
            $consentType = $consentRow->slug ?? null;
        } else {
            $consentType = $this->input('consent_type');
        }

        if (!$consentType) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.consent_id_or_type_required'), 'consent_id', 422);
        }

        try {
            $this->gdprServiceForCurrentTenant()->updateUserConsent($userId, $consentType, $granted);

            return $this->respondWithData([
                'updated' => true,
                'consent_id' => $consentId ? (int) $consentId : null,
                'consent_type' => $consentType,
                'granted' => $granted,
            ]);
        } catch (\Exception $e) {
            Log::error('GDPR consent update failed', ['user' => $userId, 'error' => $e->getMessage()]);
            return $this->respondWithError('CONSENT_UPDATE_FAILED', __('api.failed_update_consent'), null, 500);
        }
    }

    /**
     * POST /api/v2/gdpr/request
     *
     * Create a GDPR data request (export, portability, rectification, access).
     *
     * Request body (JSON):
     * - type: 'data_export' | 'data_portability' | 'data_rectification' | 'data_access' (required)
     * - notes: string (optional)
     */
    public function createRequest(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('gdpr_request', 5, 3600);

        $type = $this->input('type');
        $notes = $this->input('notes');

        // Map user-friendly types to internal types
        $typeMap = [
            'data_export' => 'portability',
            'data_portability' => 'portability',
            'data_rectification' => 'rectification',
            'data_access' => 'access',
        ];

        if (!$type || !isset($typeMap[$type])) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_gdpr_request_type'),
                'type',
                400
            );
        }

        try {
            $internalType = $typeMap[$type];

            $result = $this->gdprServiceForCurrentTenant()->createRequest($userId, $internalType, [
                'notes' => $notes,
            ]);

            return $this->respondWithData([
                'request_id' => $result['id'],
                'type' => $type,
                'status' => 'pending',
                'message' => __('api_controllers_1.gdpr.request_submitted'),
            ], null, 201);
        } catch (\Exception $e) {
            Log::error('GDPR request creation failed', ['user' => $userId, 'type' => $type, 'error' => $e->getMessage()]);
            return $this->respondWithError('REQUEST_FAILED', __('api.gdpr_request_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/gdpr/delete-account
     *
     * Request account deletion (GDPR right to erasure).
     * Requires password verification for security.
     *
     * Request body (JSON):
     * - password: string (required)
     * - reason: string (optional)
     * - feedback: string (optional)
     */
    public function deleteAccount(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('gdpr_delete', 3, 3600);

        $password = $this->input('password', '');
        $reason = $this->input('reason');
        $feedback = $this->input('feedback');

        if (empty($password)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.password_required'), 'password', 400);
        }

        // Verify password
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $this->getTenantId())
            ->select('password_hash')
            ->first();

        if (!$user || !password_verify($password, $user->password_hash)) {
            return $this->respondWithError('INVALID_PASSWORD', __('api.invalid_password'), 'password', 403);
        }

        try {
            $result = $this->gdprServiceForCurrentTenant()->createRequest($userId, 'erasure', [
                'notes' => $reason,
                'metadata' => [
                    'feedback' => $feedback,
                    'self_service' => true,
                    'requested_via' => 'api',
                ],
            ]);

            // A confirmed erasure request ends every active session
            // immediately. Leaving another device or copied refresh token
            // usable until the asynchronous erasure worker runs would defeat
            // the sign-out guarantee returned below.
            if ($this->tokenService->revokeAllTokensForUser(
                $userId,
                'account_deletion_request'
            ) < 1) {
                throw new \RuntimeException('Unable to revoke sessions for an account deletion request.');
            }

            return $this->respondWithData([
                'request_id' => $result['id'],
                'message' => __('api_controllers_1.gdpr.account_deletion_submitted'),
                'logout_required' => true,
            ]);
        } catch (\Exception $e) {
            Log::error('Account deletion request failed', ['user' => $userId, 'error' => $e->getMessage()]);
            return $this->respondWithError('DELETE_FAILED', __('api.account_deletion_failed'), null, 500);
        }
    }
}
