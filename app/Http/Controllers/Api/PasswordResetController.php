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
use App\Core\TenantContext;
use App\Core\RateLimiter;
use App\Core\EmailTemplateBuilder;
use App\I18n\LocaleContext;
use App\Jobs\SendPasswordResetEmail;
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

        // Process the reset request OFF the request, on the queue worker.
        //
        // 🔴 SECURITY (E-013 F-023). The response below is deliberately identical
        // whether or not the address belongs to an account. But the reset email
        // is a multi-second send, and doing it inline — only for an account that
        // exists — made an existing address answer measurably slower than an
        // unknown one, a response-time oracle for enumerating registered emails.
        // We run under mod_php (no early response flush), so deferring to the
        // terminate phase would not help. Dispatching UNCONDITIONALLY (the
        // account lookup lives in the job, not here) makes the request path do
        // identical, constant work for every address, closing the oracle.
        SendPasswordResetEmail::dispatch($email, TenantContext::getId());

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

        // A reset credential is bound to the community that issued it. React
        // supplies X-Tenant-ID, web-uk supplies X-Tenant-Slug, and emailed
        // links carry the tenant path/domain, all of which TenantContext has
        // already resolved. Reject a valid token in a foreign context before
        // password/session state can be touched.
        $requestTenantId = (int) TenantContext::getId();
        if ($requestTenantId > 0 && $requestTenantId !== (int) $resetRecord['tenant_id']) {
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
                    '/settings/security',
                    'password_changed'
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $user['id']), 'password_changed', __('api_controllers_2.password_reset.changed_bell'), '/settings/security');
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
