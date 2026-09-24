<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Core\TenantContext;
use App\Services\Identity\IdentityProviderRegistry;
use App\Services\Identity\IdentityVerificationEventService;
use App\Services\Identity\IdentityVerificationSessionService;
use App\Services\Identity\InviteCodeService;
use App\Services\Identity\RegistrationOrchestrationService;
use App\Services\Identity\RegistrationPolicyService;
use App\Services\Identity\TenantProviderCredentialService;

/**
 * RegistrationPolicyController -- Registration policy and identity verification.
 *
 * Converted from legacy delegation to direct static service calls.
 */
class RegistrationPolicyController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly IdentityProviderRegistry $identityProviderRegistry,
        private readonly IdentityVerificationEventService $identityVerificationEventService,
        private readonly IdentityVerificationSessionService $identityVerificationSessionService,
        private readonly InviteCodeService $inviteCodeService,
        private readonly RegistrationOrchestrationService $registrationOrchestrationService,
        private readonly RegistrationPolicyService $registrationPolicyService,
        private readonly TenantProviderCredentialService $tenantProviderCredentialService,
    ) {}

    // ─── Admin Endpoints ─────────────────────────────────────────────────

    /** GET /api/v2/admin/config/registration-policy */
    public function getPolicy(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $policy = $this->registrationPolicyService->getEffectivePolicy($tenantId);

        return $this->respondWithData($policy);
    }

    /** PUT /api/v2/admin/config/registration-policy */
    public function updatePolicy(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $input = $this->getAllInput();

        // Only platform super-admins (God) may disable email verification
        if (isset($input['require_email_verify']) && !(bool) $input['require_email_verify']) {
            try {
                $this->requirePlatformSuperAdmin();
            } catch (\Throwable) {
                return $this->respondWithError(
                    'AUTH_INSUFFICIENT_PERMISSIONS',
                    'Only platform super-admins may disable email verification.',
                    'require_email_verify',
                    403
                );
            }
        }

        // 🔴 E-035 F-153: turning member approval OFF through the registration
        // policy is the same reserved change as writing general.admin_approval=
        // false on the settings endpoint, which AdminSettingsController restricts
        // to platform super-admins. upsertPolicy()->syncToLegacySettings() maps
        // every mode except open_with_approval to admin_approval=false, so a
        // plain admin could clear approval via this back door. Require the same
        // platform-super-admin authorization when the change would disable an
        // approval gate that is currently on. A plain admin may still switch
        // between modes that keep approval on, or that leave an already-off
        // approval off.
        $requestedMode = isset($input['registration_mode']) && is_string($input['registration_mode'])
            ? $input['registration_mode']
            : null;
        if ($requestedMode !== null && in_array($requestedMode, RegistrationPolicyService::MODES, true)) {
            // open_with_approval is the only mode that keeps member approval ON.
            $wouldRequireApproval = $requestedMode === 'open_with_approval';
            $currentlyRequiresApproval = app(\App\Services\TenantSettingsService::class)
                ->requiresAdminApproval($tenantId);
            if (!$wouldRequireApproval && $currentlyRequiresApproval) {
                try {
                    $this->requirePlatformSuperAdmin();
                } catch (\Throwable) {
                    return $this->respondWithError(
                        'AUTH_INSUFFICIENT_PERMISSIONS',
                        __('api.super_admin_required'),
                        'registration_mode',
                        403
                    );
                }
            }
        }

        try {
            $policy = $this->registrationPolicyService->upsertPolicy($tenantId, $input);
            return $this->respondWithData($policy);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_INVALID_VALUE', $e->getMessage(), null, 422);
        }
    }

    /** GET /api/v2/admin/identity/providers */
    public function listProviders(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $providers = $this->identityProviderRegistry->listForAdmin();

        $configured = $this->tenantProviderCredentialService->listConfigured($tenantId);
        foreach ($providers as &$provider) {
            try {
                $instance = $this->identityProviderRegistry->get($provider['slug']);
                $provider['available'] = $instance->isAvailable($tenantId);
            } catch (\Throwable) {
                $provider['available'] = false;
            }
            $provider['has_credentials'] = isset($configured[$provider['slug']]);
        }

        return $this->respondWithData($providers);
    }

    /** GET /api/v2/admin/identity/sessions */
    public function listSessions(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $limit = min($this->inputInt('limit', 50), 100);
        $offset = max($this->inputInt('offset', 0), 0);

        $sessions = $this->identityVerificationSessionService->getPendingForTenant($tenantId, $limit, $offset);

        return $this->respondWithData($sessions);
    }

    /** GET /api/v2/admin/identity/audit-log */
    public function getAuditLog(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $limit = min($this->inputInt('limit', 50), 100);
        $offset = max($this->inputInt('offset', 0), 0);
        $eventType = $this->input('event_type', null);

        $result = $this->identityVerificationEventService->getForTenant($tenantId, $limit, $offset, $eventType);

        return $this->respondWithData($result);
    }

    // ─── Admin Review Endpoints ──────────────────────────────────────────

    /** POST /api/v2/admin/identity/sessions/{id}/approve */
    public function adminApproveVerification($id): JsonResponse
    {
        $adminId = $this->requireAdmin();

        $sessionId = (int) $id;
        if (!$sessionId) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.reg_session_id_required'), null, 400);
        }

        try {
            $result = $this->registrationOrchestrationService->adminReview($sessionId, $adminId, 'approve');
            return $this->respondWithData($result);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_INVALID_VALUE', $e->getMessage(), null, 422);
        }
    }

    /** POST /api/v2/admin/identity/sessions/{id}/reject */
    public function adminRejectVerification($id): JsonResponse
    {
        $adminId = $this->requireAdmin();

        $sessionId = (int) $id;
        if (!$sessionId) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.reg_session_id_required'), null, 400);
        }

        try {
            $result = $this->registrationOrchestrationService->adminReview($sessionId, $adminId, 'reject');
            return $this->respondWithData($result);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_INVALID_VALUE', $e->getMessage(), null, 422);
        }
    }

    // ─── Provider Credential Endpoints ──────────────────────────────────────

    /** GET /api/v2/admin/identity/provider-credentials */
    public function listProviderCredentials(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $configured = $this->tenantProviderCredentialService->listConfigured($tenantId);
        $allProviders = $this->identityProviderRegistry->all();

        $result = [];
        foreach ($allProviders as $slug => $provider) {
            if ($slug === 'mock') {
                continue;
            }
            $result[] = [
                'provider_slug' => $slug,
                'provider_name' => $provider->getName(),
                'has_credentials' => isset($configured[$slug]),
                'required_fields' => $this->tenantProviderCredentialService->getRequiredFields($slug),
            ];
        }

        return $this->respondWithData($result);
    }

    /** PUT /api/v2/admin/identity/provider-credentials/{slug} */
    public function saveProviderCredentials($slug): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if (!$slug || !$this->identityProviderRegistry->has($slug)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.reg_unknown_provider'), null, 404);
        }

        $input = $this->getAllInput();
        $credentials = [];

        $allowedFields = ['api_key', 'webhook_secret'];
        foreach ($allowedFields as $field) {
            if (isset($input[$field]) && is_string($input[$field]) && $input[$field] !== '') {
                $credentials[$field] = $input[$field];
            }
        }

        if (empty($credentials)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.reg_credential_required'), null, 422);
        }

        $saved = $this->tenantProviderCredentialService->save($tenantId, $slug, $credentials);

        return $this->respondWithData(['saved' => $saved, 'provider_slug' => $slug]);
    }

    /** DELETE /api/v2/admin/identity/provider-credentials/{slug} */
    public function deleteProviderCredentials($slug): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if (!$slug || !$this->identityProviderRegistry->has($slug)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.reg_unknown_provider'), null, 404);
        }

        $deleted = $this->tenantProviderCredentialService->delete($tenantId, $slug);

        return $this->respondWithData(['deleted' => $deleted, 'provider_slug' => $slug]);
    }

    // ─── Invite Code Endpoints ────────────────────────────────────────────

    /** GET /api/v2/admin/invite-codes */
    public function listInviteCodes(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $limit = min($this->inputInt('limit', 50), 100);
        $offset = max($this->inputInt('offset', 0), 0);

        $result = $this->inviteCodeService->listForTenant($tenantId, $limit, $offset);

        return $this->respondWithData($result);
    }

    /** POST /api/v2/admin/invite-codes */
    public function generateInviteCodes(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $input = $this->getAllInput();

        $count = max(1, min((int) ($input['count'] ?? 1), 100));
        $maxUses = isset($input['max_uses']) ? max(1, (int) $input['max_uses']) : 1;
        $expiresAt = $input['expires_at'] ?? null;
        $note = isset($input['note']) ? substr(trim($input['note']), 0, 255) : null;

        if ($expiresAt && !strtotime($expiresAt)) {
            return $this->respondWithError('VALIDATION_INVALID_FORMAT', __('api.reg_invalid_expires_at'), null, 422);
        }

        $codes = $this->inviteCodeService->generate($tenantId, $adminId, $count, $maxUses, $expiresAt, $note);

        return $this->respondWithData(['codes' => $codes, 'count' => count($codes)]);
    }

    /** DELETE /api/v2/admin/invite-codes/{id} */
    public function deactivateInviteCode($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $codeId = (int) $id;
        if (!$codeId) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.reg_code_id_required'), null, 400);
        }

        $success = $this->inviteCodeService->deactivate($tenantId, $codeId);
        if (!$success) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.reg_invite_code_not_found'), null, 404);
        }

        return $this->respondWithData(['deactivated' => true]);
    }

    // ─── User-Facing Endpoints ───────────────────────────────────────────

    /** GET /api/v2/auth/verification-status */
    public function getVerificationStatus(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $status = $this->registrationOrchestrationService->getRegistrationStatus($userId, $tenantId);

        return $this->respondWithData($status);
    }

    /** POST /api/v2/auth/start-verification */
    public function startVerification(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        // Rate limit: 5 verification starts per user per hour
        $this->rateLimit("verify_start_{$userId}", 5, 3600);

        try {
            $result = $this->registrationOrchestrationService->initiateVerification($userId, $tenantId);
            return $this->respondWithData($result);
        } catch (\RuntimeException $e) {
            \Illuminate\Support\Facades\Log::error('Verification initiation failed', ['user' => $userId, 'error' => $e->getMessage()]);
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.reg_verification_unavailable'), null, 503);
        }
    }

    /** POST /api/v2/auth/validate-invite */
    public function validateInviteCode(): JsonResponse
    {
        // Rate limit: 10 invite code checks per IP per minute
        $this->rateLimit('invite_validate_' . request()->ip(), 10, 60);

        $input = $this->getAllInput();
        $code = $input['code'] ?? '';

        if (!$code || strlen($code) < 4) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.reg_invite_code_required'), null, 400);
        }

        $tenantId = $this->getTenantId();
        $policy = $this->registrationPolicyService->getEffectivePolicy($tenantId);
        if (($policy['registration_mode'] ?? 'open') === 'closed') {
            return $this->respondWithData(['valid' => false, 'reason' => 'registration_closed']);
        }

        $result = $this->inviteCodeService->validate($tenantId, $code);

        return $this->respondWithData(['valid' => $result['valid'], 'reason' => $result['reason'] ?? null]);
    }

    // ─── Tenant Circuit Breaker (admin) ──────────────────────────────────

    /** GET /api/v2/admin/registration/breaker — current breaker status for this tenant */
    public function getBreakerStatus(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $tripped = (bool) \Illuminate\Support\Facades\Cache::get('register_tenant_breaker:' . $tenantId);
        $countInHour = (int) \Illuminate\Support\Facades\Cache::get('register_tenant_hourly:' . $tenantId, 0);
        $threshold = (int) (getenv('REGISTRATION_TENANT_HOURLY_CAP') ?: 20);

        return $this->respondWithData([
            'tripped' => $tripped,
            'count_in_current_hour' => $countInHour,
            'threshold' => $threshold,
            'auto_resume_in_seconds' => $tripped ? 3600 : null,
        ]);
    }

    /** POST /api/v2/admin/registration/resume-signups — manually clear the breaker */
    public function resumeSignups(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        \Illuminate\Support\Facades\Cache::forget('register_tenant_breaker:' . $tenantId);
        \Illuminate\Support\Facades\Cache::forget('register_tenant_breaker:' . $tenantId . ':ttl');
        // Also reset the hourly counter so a fresh wave doesn't immediately
        // re-trip the breaker before a real signup pattern emerges.
        \Illuminate\Support\Facades\Cache::forget('register_tenant_hourly:' . $tenantId);

        \Illuminate\Support\Facades\Log::warning('registration.breaker_manually_cleared', [
            'tenant_id' => $tenantId,
            'admin_user_id' => $adminId,
            'ip' => request()->ip(),
        ]);

        return $this->respondWithData(['resumed' => true]);
    }

    /** GET /api/v2/auth/registration-info */
    public function getRegistrationInfo(): JsonResponse
    {
        // Rate limit: 30 per IP per minute
        $this->rateLimit('reg_info_' . request()->ip(), 30, 60);

        $tenantId = $this->getTenantId();
        $policy = $this->registrationPolicyService->getEffectivePolicy($tenantId);
        $mode = (string) ($policy['registration_mode'] ?? 'open');

        return $this->respondWithData([
            'registration_mode' => $mode,
            'requires_invite_code' => $mode === 'invite_only',
            'requires_verification' => in_array($mode, ['verified_identity', 'government_id'], true),
            'is_waitlist' => $mode === 'waitlist',
            'is_closed' => $mode === 'closed',
            'can_register' => $mode !== 'closed',
            'message' => $mode === 'closed' ? __('api.registration_closed') : null,
        ]);
    }
}
