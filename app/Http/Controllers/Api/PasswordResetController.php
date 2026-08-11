<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\TokenService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\ApiErrorCodes;
use App\Core\Env;
use App\Core\TenantContext;
use App\Core\RateLimiter;
use App\Core\EmailTemplateBuilder;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\PasswordHistoryService;
use Illuminate\Support\Facades\Log;

/**
 * PasswordResetController -- Password reset flow.
 */
class PasswordResetController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly TokenService $tokenService,
        private readonly \App\Services\PwnedPasswordService $pwnedPassword,
    ) {}

    /** Token expiry in seconds (1 hour) */
    private const TOKEN_EXPIRY_SECONDS = 3600;

    /** Minimum password length */
    private const MIN_PASSWORD_LENGTH = 12;

    /** POST auth/forgot-password */
    public function forgotPassword(): JsonResponse
    {
        // Rate limit by IP - 5 requests per 15 minutes
        $this->rateLimit('forgot_password', 5, 900);

        // Forgot-password Turnstile gate removed 2026-05-16 — too many false
        // positives blocked legitimate users from recovering their accounts.
        // Bot/enumeration defence: per-IP 5/15min route throttle + per-email
        // 10/hr limiter below + email enumeration safety (always-success
        // response regardless of whether the address exists).

        $email = $this->input('email');

        // Validate email format
        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $this->respondWithError(
                ApiErrorCodes::VALIDATION_INVALID_FORMAT,
                __('api.valid_email_required'),
                'email',
                400
            );
        }

        // Additional rate limit by email - 10 requests per hour. Bumped from
        // 3/hr (2026-05-15) because legitimate users frustrated by typos or
        // missing inbox delivery were silently rate-limited and never saw a
        // reset email at all. Bots are caught by the per-IP throttle (5/min)
        // and the Turnstile gate above, so the per-email cap exists only to
        // prevent a single-account spam loop, not as a primary defence.
        $emailKey = 'forgot_password_email:' . strtolower($email);
        if (!RateLimiter::attempt($emailKey, 10, 3600)) {
            $masked = substr($email, 0, 2) . '***@' . (explode('@', $email)[1] ?? '***');
            Log::warning('[PasswordReset] per-email rate limit hit', [
                'email_masked' => $masked,
                'ip' => \App\Core\ClientIp::get(),
            ]);
            // Surface the rate limit so the frontend can tell the user to wait
            // rather than promising an email that will never arrive. This is
            // safe against enumeration: the limiter triggers regardless of
            // whether the email belongs to a real account.
            return $this->respondWithError(
                ApiErrorCodes::RATE_LIMIT_EXCEEDED,
                __('api.too_many_attempts'),
                'email',
                429
            );
        }

        // Process reset request (don't reveal if user exists)
        $this->processPasswordResetRequest($email);

        // Always return the same response
        return $this->respondWithData([
            'message' => __('api_controllers_2.password_reset.link_sent')
        ]);
    }

    /** POST auth/reset-password */
    public function resetPassword(): JsonResponse
    {
        // Rate limit by IP - 10 attempts per 15 minutes
        $this->rateLimit('reset_password', 10, 900);

        $token = $this->input('token');
        $password = $this->input('password');
        $passwordConfirmation = $this->input('password_confirmation');

        // Validate required fields
        $errors = [];

        if (empty($token)) {
            $errors[] = [
                'code' => ApiErrorCodes::VALIDATION_REQUIRED_FIELD,
                'message' => __('api.reset_token_required'),
                'field' => 'token'
            ];
        }

        if (empty($password)) {
            $errors[] = [
                'code' => ApiErrorCodes::VALIDATION_REQUIRED_FIELD,
                'message' => __('api.password_required'),
                'field' => 'password'
            ];
        }

        if (empty($passwordConfirmation)) {
            $errors[] = [
                'code' => ApiErrorCodes::VALIDATION_REQUIRED_FIELD,
                'message' => __('api.password_confirmation_required'),
                'field' => 'password_confirmation'
            ];
        }

        if (!empty($errors)) {
            return $this->respondWithErrors($errors, 400);
        }

        // Check passwords match
        if ($password !== $passwordConfirmation) {
            return $this->respondWithError(
                ApiErrorCodes::VALIDATION_ERROR,
                __('api.passwords_do_not_match'),
                'password_confirmation',
                400
            );
        }

        // Validate password strength
        $passwordErrors = $this->validatePasswordStrength($password);
        if (!empty($passwordErrors)) {
            return $this->respondWithErrors($passwordErrors, 400);
        }

        // HIBP check — reject if the chosen new password appears in known
        // breach corpora. Same rule as registration.
        if ($this->pwnedPassword->isPwned($password)) {
            return $this->respondWithError(
                ApiErrorCodes::VALIDATION_ERROR,
                __('api.password_pwned'),
                'password',
                422
            );
        }

        // Resolve only the token's immutable locator here. The authoritative
        // expiry/user/reuse checks and consumption happen under row locks in
        // the transaction below.
        $resetRecord = $this->findResetTokenCandidate($token);

        if (!$resetRecord || !isset($resetRecord['tenant_id'])) {
            return $this->respondWithError(
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                __('api.invalid_reset_token'),
                'token',
                400
            );
        }

        // Update the password — scope by user ID to prevent cross-tenant updates
        $email = (string) $resetRecord['email'];
        $tokenTenantId = (int) $resetRecord['tenant_id'];
        $hashedResetToken = hash('sha256', $token);
        $hashedPassword = password_hash($password, PASSWORD_ARGON2ID);

        // Find the user globally — the reset token validates identity, and the user
        // may be resetting from a different tenant context than where they belong
        $userRow = DB::table('users')
            ->where('email', $email)
            ->where('tenant_id', $tokenTenantId)
            ->whereNull('deleted_at')
            ->first();
        $user = $userRow ? (array) $userRow : null;

        if (!$user) {
            return $this->respondWithError(
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                __('api.unable_to_reset_password'),
                'token',
                400
            );
        }

        // Defence-in-depth: every active token MUST carry its origin tenant.
        // The migration purges pre-existing NULL-tenant rows; a NULL here can
        // only mean tampering or schema drift — reject either way.
        if ($tokenTenantId === null || (int) $user['tenant_id'] !== $tokenTenantId) {
            return $this->respondWithError(
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                __('api.invalid_reset_token'),
                'token',
                400
            );
        }

        // Reject reuse of the current password or any recent historical one
        if (PasswordHistoryService::isReused((int) $user['id'], (int) $user['tenant_id'], $password, $user['password_hash'] ?? null)) {
            return $this->respondWithError(
                ApiErrorCodes::VALIDATION_ERROR,
                __('api.password_reused'),
                'password',
                422
            );
        }

        // Atomically update password, delete reset tokens, and revoke sessions.
        // A revocation failure rolls the password and reset-token changes back.
        try {
            $resetOutcome = DB::transaction(function () use (
                $hashedPassword,
                $hashedResetToken,
                $password,
                $user,
                $email,
                $tokenTenantId
            ): array {
                // Every password mutation locks the tenant user first. The
                // reset-token lock follows, matching session revocation's
                // user-first ordering and serialising competing reset/change
                // requests for this account.
                $lockedUserRow = DB::table('users')
                    ->where('id', (int) $user['id'])
                    ->where('tenant_id', $tokenTenantId)
                    ->whereNull('deleted_at')
                    ->lockForUpdate()
                    ->first();
                if ($lockedUserRow === null) {
                    return ['status' => 'user_missing'];
                }
                $user = (array) $lockedUserRow;

                $lockedResetToken = DB::table('password_resets')
                    ->where('email', $email)
                    ->where('tenant_id', $tokenTenantId)
                    ->where('token', $hashedResetToken)
                    ->whereRaw(
                        'created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)',
                        [self::TOKEN_EXPIRY_SECONDS]
                    )
                    ->lockForUpdate()
                    ->first();
                if (
                    $lockedResetToken === null
                    || !is_string($lockedResetToken->token ?? null)
                    || !hash_equals($lockedResetToken->token, $hashedResetToken)
                ) {
                    return ['status' => 'token_invalid'];
                }

                // Repeat reuse validation against the locked, current hash.
                if (PasswordHistoryService::isReused(
                    (int) $user['id'],
                    $tokenTenantId,
                    $password,
                    isset($user['password_hash']) ? (string) $user['password_hash'] : null
                )) {
                    return ['status' => 'password_reused'];
                }

                // Consume every reset token for this tenant account before
                // changing its password. A rollback restores both together.
                $consumed = DB::table('password_resets')
                    ->where('email', $email)
                    ->where('tenant_id', $tokenTenantId)
                    ->delete();
                if ($consumed < 1) {
                    throw new \RuntimeException('Could not consume password reset token.');
                }
                // Update by user ID AND tenant_id — defense-in-depth against cross-tenant updates
                $updated = DB::table('users')
                    ->where('id', (int) $user['id'])
                    ->where('tenant_id', $tokenTenantId)
                    ->update(['password_hash' => $hashedPassword]);
                if ($updated !== 1) {
                    throw new \RuntimeException('Could not update password during reset.');
                }

                PasswordHistoryService::record(
                    (int) $user['id'],
                    $tokenTenantId,
                    isset($user['password_hash']) ? (string) $user['password_hash'] : null
                );

                $this->invalidateUserTokens((int) $user['id'], $tokenTenantId);

                return ['status' => 'updated', 'user' => $user];
            }, 3);
        } catch (\Throwable $e) {
            Log::error('[PasswordReset] Password transaction failed', [
                'user_id' => (int) $user['id'],
                'tenant_id' => (int) $user['tenant_id'],
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError(
                ApiErrorCodes::SERVER_INTERNAL_ERROR,
                __('api.server_error'),
                null,
                500
            );
        }

        if (($resetOutcome['status'] ?? null) === 'password_reused') {
            return $this->respondWithError(
                ApiErrorCodes::VALIDATION_ERROR,
                __('api.password_reused'),
                'password',
                422
            );
        }

        if (($resetOutcome['status'] ?? null) !== 'updated' || !is_array($resetOutcome['user'] ?? null)) {
            $message = ($resetOutcome['status'] ?? null) === 'user_missing'
                ? __('api.unable_to_reset_password')
                : __('api.invalid_reset_token');

            return $this->respondWithError(
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                $message,
                'token',
                400
            );
        }

        /** @var array<string, mixed> $user */
        $user = $resetOutcome['user'];

        // Log the password change
        try {
            \App\Models\ActivityLog::log(
                $user['id'],
                'password_reset',
                'Password was reset via API'
            );
        } catch (\Throwable $e) {
            Log::warning('[PasswordReset] Failed to log password reset: ' . $e->getMessage());
        }

        // Security notification: bell + email for password change
        // Both render under the user's preferred_language.
        $recipientLocale = $user['preferred_language'] ?? null;
        try {
            LocaleContext::withLocale($recipientLocale, function () use ($user) {
                Notification::createNotification(
                    (int) $user['id'],
                    __('api_controllers_2.password_reset.changed_bell'),
                    null,
                    'password_changed'
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $user['id']), 'password_changed', __('api_controllers_2.password_reset.changed_bell'), null);
            });
        } catch (\Throwable $e) {
            Log::warning('[PasswordReset] Failed to create password change notification: ' . $e->getMessage());
        }

        $previousTenantId = TenantContext::currentId();
        try {
            TenantContext::setById($tokenTenantId);
            LocaleContext::withLocale($recipientLocale, function () use ($email, $tokenTenantId) {
                $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';

                $html = EmailTemplateBuilder::make()
                    ->theme('warning')
                    ->title(__('emails.security.password_changed_title'))
                    ->previewText(__('emails.security.password_changed_preview'))
                    ->paragraph(__('emails.security.password_changed_body'))
                    ->highlight(__('emails.security.password_changed_warning'))
                    ->render();

                $subject = __('emails.security.password_changed_subject', ['community' => $tenantName]);
                if (!EmailDispatchService::sendRaw($email, $subject, $html, null, null, null, 'security_alert', ['tenant_id' => $tokenTenantId])) {
                    Log::warning('[PasswordReset] password change email send returned false');
                }
            });
        } catch (\Throwable $e) {
            Log::warning('[PasswordReset] Failed to send password change email: ' . $e->getMessage());
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }

        return $this->respondWithData([
            'message' => __('api_controllers_2.password_reset.updated')
        ]);
    }

    /**
     * Process password reset request for an email
     */
    private function processPasswordResetRequest(string $email): void
    {
        $masked = substr($email, 0, 2) . '***@' . (explode('@', $email)[1] ?? '***');
        $user = $this->resolvePasswordResetUser($email);

        if (!$user) {
            // User doesn't exist in this tenant or any community beneath it. The
            // RESPONSE stays deliberately identical to the success case — telling
            // the caller "no such account" would turn this endpoint into an
            // email-enumeration oracle. Only the LOG distinguishes them.
            //
            // 🔴 This is a `warning`, not an `info`, on purpose: production's
            // daily log level is `warning`, so the old `info` was written
            // nowhere. That is what made a silently-dropped reset request
            // undiagnosable — the member was told to check their inbox for an
            // email that had never been created, and nothing recorded it.
            Log::warning('[PasswordReset] reset requested for unknown email', [
                'email_masked' => $masked,
                'tenant_id' => TenantContext::getId(),
                'ip' => \App\Core\ClientIp::get(),
            ]);
            return;
        }

        // Generate a secure random token (256-bit entropy, hex-encoded)
        $token = bin2hex(random_bytes(32));

        // Hash the token with SHA-256 for storage. SHA-256 is appropriate here
        // (NOT for passwords) because the token is high-entropy random data.
        // This enables an indexed exact-match lookup instead of scanning
        // every non-expired record with bcrypt's password_verify().
        $hashedToken = hash('sha256', $token);

        $userTenantId = isset($user['tenant_id']) ? (int) $user['tenant_id'] : null;

        // Build reset URL — include tenant base path for correct routing
        $resetUrl = null;
        $tenantName = 'Project NEXUS';
        try {
            TenantContext::setById($userTenantId);
        $appUrl = TenantContext::getFrontendUrl();
        $basePath = TenantContext::getSlugPrefix();

        // Defensive: ensure frontend URL is never the API URL
        if (!$appUrl || str_contains($appUrl, 'api.')) {
            $appUrl = Env::get('APP_URL', 'https://app.project-nexus.ie');
            if (str_contains($appUrl, 'api.')) {
                $appUrl = str_replace('api.', 'app.', $appUrl);
            }
        }

        $resetUrl = $appUrl . $basePath . "/password/reset?token=" . $token;
            $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';
        } finally {
            TenantContext::reset();
        }

        // Send reset email under the user's preferred locale
        try {
            TenantContext::setById($userTenantId);
            $resetEmailSent = (bool) LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user, $email, $resetUrl, $tenantName, $userTenantId) {
                // greeting() expects the bare NAME — it wraps it in
                // emails.common.greeting and escapes at render. Passing a full
                // translated greeting rendered "Hi Hi John,," with a
                // double-escaped name.
                $firstName = $user['first_name'] ?? ($user['name'] ?? null);

                $html = EmailTemplateBuilder::make()
                    ->theme('warning')
                    ->title(__('emails.password_reset.title'))
                    ->previewText(__('emails.password_reset.preview'))
                    ->greeting($firstName ?? __('emails.common.fallback_name'))
                    ->paragraph(__('emails.password_reset.body'))
                    ->paragraph(__('emails.password_reset.expiry'))
                    ->button(__('emails.password_reset.cta'), $resetUrl)
                    ->paragraph(__('emails.password_reset.ignore'))
                    ->render();

                $subject = __('emails.password_reset.subject', ['community' => $tenantName]);
                return EmailDispatchService::sendRaw($email, $subject, $html, null, null, null, 'password_reset', ['tenant_id' => $userTenantId]);
            });
            if ($resetEmailSent) {
                // Rotate reset tokens only after the dispatcher accepts the new
                // email. If SMTP/Gmail fails, any previous valid link remains
                // usable instead of being silently invalidated.
                if ($userTenantId !== null) {
                    DB::delete(
                        "DELETE FROM password_resets WHERE email = ? AND tenant_id <=> ?",
                        [$email, $userTenantId]
                    );
                } else {
                    DB::delete(
                        "DELETE FROM password_resets WHERE email = ? AND tenant_id IS NULL",
                        [$email]
                    );
                }

                DB::insert(
                    "INSERT INTO password_resets (email, tenant_id, token, created_at) VALUES (?, ?, ?, NOW())",
                    [$email, $userTenantId, $hashedToken]
                );

                Log::info('[PasswordReset] reset email dispatched', [
                    'email_masked' => $masked,
                    'user_id' => $user['id'] ?? null,
                    'tenant_id' => $userTenantId,
                ]);
            } else {
                Log::warning('[PasswordReset] reset email send returned false', [
                    'email_masked' => $masked,
                    'user_id' => $user['id'] ?? null,
                    'tenant_id' => $userTenantId,
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('[PasswordReset] Password reset email failed for ' . $masked . ': ' . $e->getMessage(), [
                'user_id' => $user['id'] ?? null,
                'tenant_id' => $userTenantId,
            ]);
        } finally {
            TenantContext::reset();
        }
    }

    private function resolvePasswordResetUser(string $email): ?array
    {
        $tenantId = TenantContext::getId();
        $normalizedEmail = strtolower(trim($email));

        if ($tenantId && $tenantId !== 1) {
            $row = DB::table('users')
                ->where('email', $normalizedEmail)
                ->where('tenant_id', $tenantId)
                ->whereNull('deleted_at')
                ->first();

            if ($row) {
                return (array) $row;
            }

            // Not in this tenant — try the sub-communities BENEATH it before
            // giving up. A sub-tenant with no domain of its own is only
            // reachable at `<parent-domain>/<slug>`, so a member who starts from
            // the parent domain root resolves to the PARENT and would otherwise
            // get no email at all while being told to check their inbox. The
            // boundary is this tenant's own subtree, never "any tenant".
            $subtreeIds = \App\Support\Tenancy\TenantSubtree::descendantIds((int) $tenantId);

            if ($subtreeIds === []) {
                return null;
            }

            $matches = DB::table('users')
                ->where('email', $normalizedEmail)
                ->whereIn('tenant_id', $subtreeIds)
                ->whereNull('deleted_at')
                ->orderBy('tenant_id')
                ->limit(2)
                ->get();

            if ($matches->count() === 1) {
                return (array) $matches->first();
            }

            if ($matches->count() > 1) {
                // Cannot tell which community they meant. Sending to both would
                // be confusing and doubles the reset tokens in flight; ask them
                // to use their community's own link instead. Logged at warning
                // because production runs at `warning` — an `info` here is
                // written nowhere and made this class of failure invisible.
                Log::warning('[PasswordReset] ambiguous sub-community reset request', [
                    'email_masked' => substr($email, 0, 2) . '***@' . (explode('@', $email)[1] ?? '***'),
                    'resolved_tenant_id' => (int) $tenantId,
                    'candidate_tenant_ids' => $matches->pluck('tenant_id')->all(),
                ]);
            }

            return null;
        }

        $rows = DB::table('users')
            ->where('email', $normalizedEmail)
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->limit(2)
            ->get();

        if ($rows->count() === 1) {
            return (array) $rows->first();
        }

        if ($rows->count() > 1) {
            Log::warning('[PasswordReset] ambiguous global reset request for email present in multiple tenants', [
                'email_masked' => substr($email, 0, 2) . '***@' . (explode('@', $email)[1] ?? '***'),
            ]);
        }

        return null;
    }

    /**
     * Resolve the reset token's tenant/email locator without authorising it.
     * Expiry and continued existence are rechecked under row locks before use.
     *
     * @return array<string, mixed>|null
     */
    private function findResetTokenCandidate(string $token): ?array
    {
        // Hash the supplied token with SHA-256 and look it up directly by
        // the indexed token column. This eliminates the linear-scan timing
        // signal from the previous bcrypt-per-row approach.
        $hashedToken = hash('sha256', $token);

        $record = DB::table('password_resets')
            ->where('token', $hashedToken)
            ->whereRaw(
                'created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)',
                [self::TOKEN_EXPIRY_SECONDS]
            )
            ->first();

        if (!$record) {
            return null;
        }

        $recordArr = (array)$record;

        // Constant-time confirmation (defence in depth — DB equality already
        // matched, but hash_equals avoids any future-proofing surprises).
        if (!is_string($recordArr['token'] ?? null) || !hash_equals($recordArr['token'], $hashedToken)) {
            return null;
        }

        return $recordArr;
    }

    /**
     * Validate password strength
     */
    private function validatePasswordStrength(string $password): array
    {
        // NIST SP 800-63B aligned: enforce length only, no mandatory
        // character classes. The HIBP breach check (called by the
        // resetPassword handler immediately after this) is the meaningful
        // defence; complexity rules push users to predictable patterns
        // without slowing down attackers.
        $errors = [];
        if (strlen($password) < self::MIN_PASSWORD_LENGTH) {
            $errors[] = [
                'code' => ApiErrorCodes::VALIDATION_TOO_SHORT,
                'message' => __('api.password_min_length_generic', ['length' => self::MIN_PASSWORD_LENGTH]),
                'field' => 'password',
            ];
        }
        return $errors;
    }

    /**
     * Invalidate all tokens for a user after password change
     */
    private function invalidateUserTokens(int $userId, int $tenantId): void
    {
        if ($this->tokenService->revokeAllTokensForUser($userId, 'password_reset') < 1) {
            throw new \RuntimeException('Could not revoke sessions after password reset.');
        }

        try {
            $columns = DB::select(
                "SHOW COLUMNS FROM users LIKE 'password_changed_at'"
            );

            if (!empty($columns)) {
                DB::update(
                    "UPDATE users SET password_changed_at = NOW() WHERE id = ? AND tenant_id = ?",
                    [$userId, $tenantId]
                );
            }
        } catch (\Throwable $e) {
            Log::warning('[PasswordReset] Could not update password_changed_at: ' . $e->getMessage(), ['user_id' => $userId]);
        }
    }
}
