<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\ApiErrorCodes;
use App\Core\TenantContext;
use App\Core\RateLimiter;
use App\Core\EmailTemplate;
use App\Models\ActivityLog;
use App\Services\RateLimitService;
use App\Jobs\SendEmailVerificationResend;
use Illuminate\Support\Facades\Log;

/**
 * EmailVerificationController -- Email verification endpoints.
 */
class EmailVerificationController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly RateLimitService $rateLimitService,
        private readonly \App\Services\TenantSettingsService $tenantSettings,
    ) {}

    /** Token expiry in seconds (24 hours) */
    private const TOKEN_EXPIRY_SECONDS = 86400;

    /** Minimum seconds between resend requests */
    private const RESEND_COOLDOWN_SECONDS = 60;

    /** POST /api/auth/verify-email */
    public function verifyEmail(): JsonResponse
    {
        // Rate limit by IP - 10 attempts per 15 minutes. Tightened from 20
        // because this endpoint validates a token; high attempt counts have
        // no legitimate use and only enable token-guessing.
        $this->rateLimit('verify_email', 10, 900);

        $token = $this->input('token');
        $tenantId = TenantContext::getId();

        if (empty($token)) {
            return $this->respondWithError(
                ApiErrorCodes::VALIDATION_REQUIRED_FIELD,
                __('api.verification_token_required'),
                'token',
                400
            );
        }

        // Find and validate the verification token (tenant-scoped)
        $verificationRecord = $this->findValidVerificationToken($token, $tenantId);

        if (!$verificationRecord) {
            return $this->respondWithError(
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                __('api.invalid_verification_token'),
                'token',
                400
            );
        }

        $userId = $verificationRecord['user_id'];

        // Check if already verified (tenant-scoped)
        $userRow = DB::selectOne(
            "SELECT id, email_verified_at, is_verified FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
        $user = $userRow ? (array)$userRow : null;

        if (!$user) {
            return $this->respondWithError(
                ApiErrorCodes::RESOURCE_NOT_FOUND,
                __('api.user_not_found'),
                null,
                404
            );
        }

        if (!empty($user['email_verified_at'])) {
            // Already verified - delete any remaining tokens and return success
            $this->cleanupVerificationTokens($userId, $tenantId);

            return $this->respondWithData([
                'verified' => true,
                'message' => __('api_controllers_1.email_verification.already_verified')
            ]);
        }

        // Mark the email as verified. The activation rule depends on the
        // tenant's admin_approval toggle (B2 — self-serve activation lockout):
        //   - Approval REQUIRED: only an already-approved (is_approved=1) user
        //     goes active; everyone else stays 'pending' for an admin to promote.
        //   - Approval OFF (self-serve): verifying the email both APPROVES and
        //     ACTIVATES the account. Self-serve registration never sets
        //     is_approved, so without this a verified user is stuck 'pending'
        //     forever and login's approval gate blocks them permanently.
        //   - Identity-verification or waitlist community (E-035 F-152): held
        //     exactly like approval REQUIRED. Verifying the email never approves
        //     the account; it is released by passing identity verification
        //     (RegistrationOrchestrationService) or by an administrator.
        if (
            $this->tenantSettings->requiresAdminApproval($tenantId)
            || $this->tenantSettings->registrationActivationHold($tenantId) !== null
        ) {
            DB::update(
                "UPDATE users SET email_verified_at = NOW(), is_verified = 1, status = CASE WHEN status = 'pending' AND is_approved = 1 THEN 'active' ELSE status END WHERE id = ? AND tenant_id = ?",
                [$userId, $tenantId]
            );
        } else {
            DB::update(
                "UPDATE users SET email_verified_at = NOW(), is_verified = 1, is_approved = 1, status = CASE WHEN status = 'pending' THEN 'active' ELSE status END WHERE id = ? AND tenant_id = ?",
                [$userId, $tenantId]
            );
        }

        // Delete all verification tokens for this user in this tenant
        $this->cleanupVerificationTokens($userId, $tenantId);

        // Log the verification
        try {
            \App\Models\ActivityLog::log(
                $userId,
                'email_verified',
                'Email address verified via API'
            );
        } catch (\Throwable $e) {
            Log::warning('[EmailVerification] Failed to log email verification: ' . $e->getMessage());
        }

        // Award gamification points if available
        try {
            if (class_exists('\App\Models\Gamification')) {
                \App\Models\Gamification::awardPoints($userId, 'email_verified', 10, 'Verified email address');
            }
        } catch (\Throwable $e) {
            // Gamification is optional
        }

        // Tell the client whether the member is now ACTIVE or still waiting on an
        // administrator, so the verify-email screen can say so.
        //
        // 🔴 VerifyEmailPage has always had an "awaiting approval" panel, but it
        // derived the condition from `tenant.settings.admin_approval` in the
        // bootstrap payload — and that key is DELIBERATELY excluded from the public
        // bootstrap (TenantBootstrapController names it in its exclusion list), so
        // the flag was permanently false and the panel was dead code. Returning it
        // here fixes the screen without leaking a tenant configuration value to
        // anonymous callers, which is why it was excluded in the first place.
        //
        // Re-read the row rather than inferring from the UPDATE above: the approval
        // branch only activates an already-approved member, so "approval required"
        // does not by itself mean this member is still pending.
        $stillPending = false;
        try {
            $state = DB::selectOne(
                "SELECT status, is_approved FROM users WHERE id = ? AND tenant_id = ?",
                [$userId, $tenantId]
            );
            $stillPending = $state !== null
                && ((string) $state->status === 'pending' || (int) $state->is_approved !== 1);
        } catch (\Throwable $e) {
            Log::warning('[EmailVerification] Failed to read post-verification state: ' . $e->getMessage());
        }

        return $this->respondWithData([
            'verified' => true,
            'requires_approval' => $stillPending,
            'message' => __('api_controllers_1.email_verification.verified_successfully')
        ]);
    }

    /** POST /api/auth/resend-verification */
    public function resendVerification(): JsonResponse
    {
        $userId = $this->requireAuth();

        // Rate limit by user - 1 request per minute
        $userKey = "resend_verification:user:{$userId}";
        if (!RateLimiter::attempt($userKey, 1, self::RESEND_COOLDOWN_SECONDS)) {
            return $this->respondWithError(
                ApiErrorCodes::RATE_LIMIT_EXCEEDED,
                __('api.verification_resend_cooldown'),
                null,
                429
            );
        }

        // Get user details (tenant-scoped)
        $tenantId = TenantContext::getId();
        $userRow = DB::selectOne(
            "SELECT id, email, first_name, email_verified_at, tenant_id, preferred_language FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
        $user = $userRow ? (array)$userRow : null;

        if (!$user) {
            return $this->respondWithError(
                ApiErrorCodes::RESOURCE_NOT_FOUND,
                __('api.user_not_found'),
                null,
                404
            );
        }

        // Check if already verified
        if (!empty($user['email_verified_at'])) {
            return $this->respondWithData([
                'message' => __('api_controllers_1.email_verification.already_verified'),
                'already_verified' => true
            ]);
        }

        // Generate and send new verification email. Do not report success or
        // rotate tokens unless the dispatcher accepts the message.
        if (!$this->sendVerificationEmail($user)) {
            return $this->respondWithError(
                'EMAIL_SEND_FAILED',
                __('api.verification_email_send_failed'),
                null,
                503
            );
        }

        return $this->respondWithData([
            'message' => __('api_controllers_1.email_verification.verification_sent')
        ]);
    }

    /** POST /api/auth/resend-verification-by-email */
    public function resendVerificationByEmail(): JsonResponse
    {
        // Rate limit by IP — 3 per 5 minutes (aggressive since unauthenticated)
        $ip = \App\Core\ClientIp::get();
        if ($this->rateLimitService->check("resend_verify:$ip", 3, 300)) {
            return $this->respondWithError(
                ApiErrorCodes::RATE_LIMIT_EXCEEDED,
                __('api.rate_limit_exceeded'),
                null,
                429
            );
        }

        $email = strtolower(trim($this->input('email', '')));
        $tenantId = TenantContext::getId();

        // Always return the same success message (prevents user enumeration)
        $genericResponse = ['message' => __('api_controllers_1.email_verification.generic_resend')];

        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $this->respondWithData($genericResponse);
        }

        // 🔴 SECURITY (E-035 F-171). Per-RECIPIENT cooldown. The per-IP limit
        // above does not stop an attacker from spamming ONE inbox from many IPs
        // (email bombing), and each send rotates the recipient's token — so a
        // rapid burst also repeatedly invalidates a link the member may already
        // be trying to use. Throttle per (tenant, address) across all source IPs
        // so at most one resend per address per window actually dispatches; the
        // rest are dropped, which also stops the burst from churning the token.
        //
        // Enumeration-safe: the key is hashed from the SUBMITTED address (which
        // the attacker already knows) and set for EVERY well-formed address,
        // account or not, so it does not correlate with account existence. When
        // the cooldown is active we still return the SAME generic response and
        // never a 429 — a distinct throttle response would itself be an oracle.
        $cooldownKey = 'resend_verify_recipient:' . $tenantId . ':' . hash('sha256', $email);
        $firstInWindow = \Illuminate\Support\Facades\Cache::add(
            $cooldownKey,
            1,
            self::RESEND_COOLDOWN_SECONDS
        );

        // Do the account lookup and send OFF the request, on the queue worker.
        //
        // 🔴 SECURITY (E-013 F-024). The response is identical whether or not the
        // address has an account, but sending the verification email inline — and
        // only for an account that exists AND is unverified — made that address
        // answer measurably slower than an unknown one, a response-time oracle
        // for enumerating unverified accounts. We run under mod_php (no early
        // response flush), so this is dispatched to the queue. Dispatching (the
        // lookup lives in the job, not here) makes the request path do identical,
        // constant work for every address; the per-recipient cooldown above only
        // gates the dispatch and is constant work in itself.
        if ($firstInWindow) {
            SendEmailVerificationResend::dispatch($email, $tenantId);
        }

        return $this->respondWithData($genericResponse);
    }

    /** POST /api/v2/admin/users/{id}/send-verification-email */
    public function adminResendVerification($id): JsonResponse
    {
        // broker-or-admin: brokers resend a member's verification email.
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();
        $userId = (int) $id;

        $userRow = DB::selectOne(
            "SELECT id, email, first_name, email_verified_at, tenant_id, preferred_language FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
        $user = $userRow ? (array) $userRow : null;

        if (!$user) {
            return $this->respondWithError(
                ApiErrorCodes::RESOURCE_NOT_FOUND,
                __('api.user_not_found'),
                null,
                404
            );
        }

        if (!empty($user['email_verified_at'])) {
            return $this->respondWithData([
                'sent' => false,
                'already_verified' => true,
                'id' => $userId,
            ]);
        }

        if (!$this->sendVerificationEmail($user)) {
            return $this->respondWithError(
                'EMAIL_SEND_FAILED',
                __('api.verification_email_send_failed'),
                null,
                503
            );
        }

        ActivityLog::log($adminId, 'admin_resend_verification_email', "Resent verification email to user #{$userId} ({$user['email']})");

        return $this->respondWithData([
            'sent' => true,
            'already_verified' => false,
            'id' => $userId,
        ]);
    }

    /**
     * Send the verification email and rotate the token.
     *
     * Delegates to EmailVerificationSender so the identical logic runs both here
     * (registration, authenticated resend, admin resend) and — for the public
     * resend-verification-by-email endpoint — out of the request on the queue
     * (SendEmailVerificationResend), which closes the F-024 timing oracle.
     *
     * @param array<string,mixed> $user
     */
    private function sendVerificationEmail(array $user): bool
    {
        return app(\App\Services\EmailVerificationSender::class)->send($user);
    }

    /**
     * Find a valid (non-expired) verification token, scoped to tenant
     */
    private function findValidVerificationToken(string $token, int $tenantId): ?array
    {
        if (!$this->tokenTableExists()) {
            return null;
        }

        // Fast path: tokens are stored as SHA-256 of the 256-bit random value,
        // so the lookup is a single indexed exact match.
        $record = DB::selectOne(
            "SELECT * FROM email_verification_tokens WHERE tenant_id = ? AND token = ? AND expires_at > NOW()",
            [$tenantId, hash('sha256', $token)]
        );
        if ($record) {
            return (array)$record;
        }

        // Legacy fallback: rows written before the SHA-256 switch hold bcrypt
        // hashes ('$2y$...'). Tokens live 24h, so this set drains to empty
        // within a day of deploy and the scan then matches zero rows.
        $records = DB::select(
            "SELECT * FROM email_verification_tokens WHERE tenant_id = ? AND expires_at > NOW() AND token LIKE '\$2%'",
            [$tenantId]
        );

        foreach ($records as $record) {
            $recordArr = (array)$record;
            if (password_verify($token, $recordArr['token'])) {
                return $recordArr;
            }
        }

        return null;
    }

    /**
     * Delete all verification tokens for a user in a specific tenant
     */
    private function cleanupVerificationTokens(int $userId, ?int $tenantId = null): void
    {
        if (!$this->tokenTableExists()) {
            return;
        }

        $tenantId = $tenantId ?? TenantContext::getId();

        DB::delete(
            "DELETE FROM email_verification_tokens WHERE user_id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
    }

    /**
     * Check if the token table exists
     */
    private function tokenTableExists(): bool
    {
        static $exists = null;

        if ($exists === null) {
            try {
                $result = DB::select(
                    "SHOW TABLES LIKE 'email_verification_tokens'"
                );
                $exists = !empty($result);
            } catch (\Throwable $e) {
                $exists = false;
            }
        }

        return $exists;
    }
}
