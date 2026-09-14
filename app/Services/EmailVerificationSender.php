<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Renders and sends the account "verify your email" message and rotates the
 * verification token.
 *
 * Extracted from EmailVerificationController so the same send logic can run
 * both inline (registration, authenticated resend, admin resend) and — for the
 * public `resend-verification-by-email` endpoint — OUT of the request on the
 * queue. The queued path exists to close a response-timing enumeration oracle
 * (E-013 F-023 for the password-reset twin; F-024 here): sending inline only
 * for an existing, unverified account made that address answer measurably
 * slower than an unknown one, revealing which addresses have an unverified
 * account despite the deliberately generic response message.
 */
final class EmailVerificationSender
{
    private const TOKEN_EXPIRY_SECONDS = 86400;

    /**
     * Send the verification email for a resolved user row and store a fresh
     * single-use token. Returns whether the dispatch was accepted.
     *
     * @param array<string,mixed> $user user row incl. id, email, first_name, tenant_id, preferred_language
     */
    public function send(array $user): bool
    {
        $tenantId = (int) ($user['tenant_id'] ?? TenantContext::getId());

        $this->ensureTokenTableExists();

        // 256-bit CSPRNG token, SHA-256-hashed for an indexed exact-match lookup
        // (key-stretching adds nothing to high-entropy random data).
        $token = bin2hex(random_bytes(32));
        $hashedToken = hash('sha256', $token);
        $expiresAt = date('Y-m-d H:i:s', time() + self::TOKEN_EXPIRY_SECONDS);

        $tenantRouting = TenantContext::runForTenant($tenantId, fn (): array => [
            'frontend_url' => TenantContext::getFrontendUrl(),
            'slug_prefix' => TenantContext::getSlugPrefix(),
        ]);
        $appUrl = $tenantRouting['frontend_url'];
        $basePath = $tenantRouting['slug_prefix'];
        $verifyUrl = $appUrl . $basePath . '/verify-email?token=' . $token;

        try {
            $tenantName = 'Project NEXUS';
            if ($tenantId) {
                try {
                    $tenantRow = DB::selectOne('SELECT name FROM tenants WHERE id = ?', [$tenantId]);
                    if ($tenantRow) {
                        $tenantName = $tenantRow->name;
                    }
                } catch (\Throwable $e) {
                    // Use default tenant name.
                }
            }

            // Render in the recipient's preferred_language, not the caller's.
            $sent = (bool) LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($tenantId, $user, $tenantName, $verifyUrl) {
                $firstName = $user['first_name'] ?? '';
                $greeting = $firstName !== ''
                    ? __('emails_misc.auth.verify_email_greeting', ['name' => htmlspecialchars((string) $firstName, ENT_QUOTES, 'UTF-8'), 'community' => $tenantName])
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
                    'user_id' => $user['id'] ?? null,
                    'tenant_id' => $tenantId,
                ]);
                return false;
            }

            // Rotate tokens only after the dispatcher accepts the new email, so a
            // previous valid link survives a send failure.
            DB::delete('DELETE FROM email_verification_tokens WHERE user_id = ? AND tenant_id = ?', [$user['id'], $tenantId]);
            DB::insert(
                'INSERT INTO email_verification_tokens (user_id, tenant_id, token, expires_at) VALUES (?, ?, ?, ?)',
                [$user['id'], $tenantId, $hashedToken, $expiresAt]
            );

            return true;
        } catch (\Throwable $e) {
            Log::warning('[EmailVerification] Verification email failed for user: ' . $e->getMessage(), ['user_id' => $user['id'] ?? null]);
            return false;
        }
    }

    private function ensureTokenTableExists(): void
    {
        try {
            $exists = DB::select("SHOW TABLES LIKE 'email_verification_tokens'");
            if (!empty($exists)) {
                return;
            }
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
            Log::warning('[EmailVerification] Failed to ensure email_verification_tokens table: ' . $e->getMessage());
        }
    }
}
