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
use App\Core\EmailTemplateBuilder;
use App\I18n\LocaleContext;
use App\Models\ActivityLog;
use App\Services\EmailDispatchService;
use App\Services\RateLimitService;
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
        if ($this->tenantSettings->requiresAdminApproval($tenantId)) {
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

        // Look up user (tenant-scoped)
        $userRow = DB::selectOne(
            "SELECT id, email, first_name, email_verified_at, tenant_id, preferred_language FROM users WHERE email = ? AND tenant_id = ?",
            [$email, $tenantId]
        );
        $user = $userRow ? (array)$userRow : null;

        // Only send if user exists AND is not yet verified
        if ($user && empty($user['email_verified_at'])) {
            $this->sendVerificationEmail($user);
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
     * Send verification email to user
     */
    private function sendVerificationEmail(array $user): bool
    {
        $tenantId = (int) ($user['tenant_id'] ?? TenantContext::getId());

        // Ensure the table exists (create if not)
        $this->ensureTokenTableExists();

        // Generate a secure random token
        $token = bin2hex(random_bytes(32));

        // Hash the token before storing. SHA-256 (not bcrypt): the token is
        // 256 bits of CSPRNG output, so key-stretching adds nothing — and a
        // deterministic hash allows an indexed exact-match lookup. The bcrypt
        // scheme made verification scan EVERY unexpired token in the tenant
        // at ~100ms of password_verify() per row, hanging the endpoint once
        // a registration wave left a few hundred tokens outstanding.
        $hashedToken = hash('sha256', $token);

        // Calculate expiry time
        $expiresAt = date('Y-m-d H:i:s', time() + self::TOKEN_EXPIRY_SECONDS);

        // Build verification URL — include tenant base path for correct routing
        $tenantRouting = TenantContext::runForTenant($tenantId, fn (): array => [
            'frontend_url' => TenantContext::getFrontendUrl(),
            'slug_prefix' => TenantContext::getSlugPrefix(),
        ]);
        $appUrl = $tenantRouting['frontend_url'];
        $basePath = $tenantRouting['slug_prefix'];
        $verifyUrl = $appUrl . $basePath . "/verify-email?token=" . $token;

        // Send verification email
        try {
            // Get tenant name
            $tenantName = 'Project NEXUS';
            if ($tenantId) {
                try {
                    $tenantRow = DB::selectOne(
                        "SELECT name FROM tenants WHERE id = ?",
                        [$tenantId]
                    );
                    if ($tenantRow) {
                        $tenantName = $tenantRow->name;
                    }
                } catch (\Throwable $e) {
                    // Use default tenant name
                }
            }

            // Render in the recipient's preferred_language so the verification
            // email arrives in their locale rather than the request caller's.
            $sent = LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($tenantId, $user, $tenantName, $verifyUrl) {
                $firstName = $user['first_name'] ?? '';
                $greeting = $firstName !== ''
                    ? __('emails_misc.auth.verify_email_greeting', ['name' => htmlspecialchars($firstName, ENT_QUOTES, 'UTF-8'), 'community' => $tenantName])
                    : __('emails_misc.auth.verify_email_greeting_fallback');

                $html = EmailTemplateBuilder::make()
                    ->title(__('emails_misc.auth.verify_email_title'))
                    ->greeting($greeting)
                    ->paragraph(__('emails_misc.auth.verify_email_body'))
                    ->paragraph(__('emails_misc.auth.verify_email_ignore'))
                    ->button(__('emails_misc.auth.verify_email_cta'), $verifyUrl)
                    ->render();

                return EmailDispatchService::sendRaw(
                    $user['email'],
                    __('emails_misc.auth.verify_email_subject', ['community' => $tenantName]),
                    $html,
                    null,
                    null,
                    null,
                    'email_verification',
                    ['tenant_id' => $tenantId]
                );
            });

            if (!$sent) {
                Log::warning('[EmailVerification] Verification email dispatch returned false', [
                    'user_id' => $user['id'],
                    'tenant_id' => $tenantId,
                ]);
                return false;
            }

            // Only replace verification tokens after send acceptance. This
            // preserves any previous valid link if the resend fails.
            $this->cleanupVerificationTokens($user['id'], $tenantId);

            DB::insert(
                "INSERT INTO email_verification_tokens (user_id, tenant_id, token, expires_at) VALUES (?, ?, ?, ?)",
                [$user['id'], $tenantId, $hashedToken, $expiresAt]
            );

            return true;
        } catch (\Throwable $e) {
            Log::warning('[EmailVerification] Verification email failed for user: ' . $e->getMessage(), ['user_id' => $user['id']]);
            return false;
        }
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

    /**
     * Create the token table if it doesn't exist
     */
    private function ensureTokenTableExists(): void
    {
        if ($this->tokenTableExists()) {
            return;
        }

        try {
            DB::statement("
                CREATE TABLE IF NOT EXISTS `email_verification_tokens` (
                    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    `user_id` INT UNSIGNED NOT NULL,
                    `tenant_id` INT(11) NOT NULL,
                    `token` VARCHAR(255) NOT NULL,
                    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    `expires_at` TIMESTAMP NOT NULL,
                    INDEX `idx_user_id` (`user_id`),
                    INDEX `idx_tenant_id` (`tenant_id`),
                    INDEX `idx_tenant_user` (`tenant_id`, `user_id`),
                    INDEX `idx_expires_at` (`expires_at`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            ");
        } catch (\Throwable $e) {
            Log::warning('[EmailVerification] Failed to create email_verification_tokens table: ' . $e->getMessage());
        }
    }
}
