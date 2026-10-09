<?php
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\UserRegistered;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Sends a welcome notification (email + in-app) when a new user registers.
 *
 * For pending users (awaiting email verification), this sends a combined
 * welcome + verification email with a verify link. For already-active users
 * (e.g. admin-created), it sends a generic welcome.
 */
class SendWelcomeNotification
{
    public function __construct()
    {
        //
    }

    /**
     * Handle the event.
     */
    public function handle(UserRegistered $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent deliveries for the
        // same registration so the activation email + verification token are
        // issued exactly once (regression guard for the 2026-04-02 email-bombing class).
        $userId = (int) ($event->user->id ?? 0);
        $tenantId = (int) ($event->tenantId ?? 0);
        $handledKey = null;
        $claimKey = null;
        $claimAcquired = false;
        if ($userId > 0) {
            $handledKey = 'send_welcome:done:' . $tenantId . ':' . $userId;
            $claimKey = 'send_welcome:claim:' . $tenantId . ':' . $userId;
            if (Cache::has($handledKey)) {
                Log::info('SendWelcomeNotification: duplicate delivery suppressed', ['user_id' => $userId, 'tenant_id' => $tenantId]);
                return;
            }
            $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
            if (!$claimAcquired) {
                Log::info('SendWelcomeNotification: concurrent delivery suppressed', ['user_id' => $userId, 'tenant_id' => $tenantId]);
                return;
            }
        }

        $previousTenantId = TenantContext::currentId();

        try {
            // Tenant context for any notifications/emails below.
            // Search-index upserts are handled by UserObserver (queued + retried)
            // on the `created` event â€” no direct indexUser() call here.
            TenantContext::setById($event->tenantId);

            // The ENTIRE welcome flow renders in the new user's language
            // (from UserRegistered event payload).
            LocaleContext::withLocale($event->user, function () use ($event) {
                // Create in-app welcome notification
                Notification::create([
                    'tenant_id'  => $event->tenantId,
                    'user_id'    => $event->user->id,
                    'type'       => 'welcome',
                    'message'    => __('emails.welcome.in_app_message'),
                    'link'       => '/feed',
                    'is_read'    => false,
                    'created_at' => now(),
                ]);

                // Send email
                $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';
                $userName = $event->user->first_name ?? $event->user->name ?? __('emails.common.fallback_name');
                $userEmail = $event->user->email ?? null;

                if (!$userEmail) {
                    return;
                }

                $safeTenantName = htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8');
                $safeUserName = htmlspecialchars($userName, ENT_QUOTES, 'UTF-8');

                // For pending users: send combined welcome + verification email
                $isPending = ($event->user->status ?? '') === 'pending'
                          || empty($event->user->email_verified_at);

                if ($isPending) {
                    $verificationToken = $this->buildVerificationToken();
                    $verifyUrl = $this->buildVerificationUrl($verificationToken['token']);

                    $html = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails.welcome.title', ['community' => $safeTenantName]))
                        ->previewText(__('emails.welcome.pending_preview', ['community' => $safeTenantName]))
                        ->greeting($safeUserName)
                        ->paragraph(__('emails.welcome.pending_intro', ['community' => $safeTenantName]))
                        ->paragraph(__('emails.welcome.pending_verify_instruction'))
                        ->button(__('emails.welcome.pending_button'), $verifyUrl)
                        ->paragraph(__('emails.welcome.pending_once_verified'))
                        ->bulletList([
                            __('emails.welcome.pending_bullet_profile'),
                            __('emails.welcome.pending_bullet_listings'),
                            __('emails.welcome.pending_bullet_connections'),
                        ])
                        ->paragraph(__('emails.welcome.pending_ignore'))
                        ->render();

                    if (!EmailDispatchService::sendRaw($userEmail, __('emails.welcome.pending_subject', ['community' => $tenantName]), $html, null, null, null, 'activation', [
                        'tenant_id' => $event->tenantId,
                        'idempotency_key' => 'activation:' . $event->tenantId . ':' . $event->user->id,
                    ])) {
                        Log::warning('SendWelcomeNotification: pending welcome email failed to send', ['user_email' => $userEmail, 'tenant_id' => $event->tenantId]);
                        return;
                    }

                    $this->storeVerificationToken($event->user->id, $event->tenantId, $verificationToken);
                } else {
                    // Already active user (admin-created) â€” generic welcome only
                    $html = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails.welcome.title', ['community' => $safeTenantName]))
                        ->previewText(__('emails.welcome.active_preview', ['name' => $safeUserName]))
                        ->greeting($safeUserName)
                        ->paragraph(__('emails.welcome.active_intro', ['community' => $safeTenantName]))
                        ->highlight(__('emails.welcome.active_get_started'), 'âœ¨')
                        ->bulletList([
                            __('emails.welcome.active_bullet_profile'),
                            __('emails.welcome.active_bullet_listings'),
                            __('emails.welcome.active_bullet_connections'),
                            __('emails.welcome.active_bullet_events'),
                        ])
                        ->paragraph(__('emails.welcome.active_help'))
                        ->button(__('emails.welcome.active_button'), EmailTemplateBuilder::tenantUrl('/feed'))
                        ->render();

                    if (!EmailDispatchService::sendRaw($userEmail, __('emails.welcome.subject', ['community' => $tenantName]), $html, null, null, null, 'welcome', [
                        'tenant_id' => $event->tenantId,
                        'idempotency_key' => 'welcome:' . $event->tenantId . ':' . $event->user->id,
                    ])) {
                        Log::warning('SendWelcomeNotification: welcome email failed to send', ['user_email' => $userEmail, 'tenant_id' => $event->tenantId]);
                    }
                }
            });

            // Mark handled only after the flow ran to completion so a duplicate
            // delivery cannot re-send the welcome/activation email.
            if ($handledKey !== null) {
                Cache::put($handledKey, 1, now()->addHours(24));
            }
        } catch (\Throwable $e) {
            Log::error('SendWelcomeNotification listener failed', [
                'user_id' => $event->user->id ?? null,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
        } finally {
            if ($claimAcquired && $claimKey !== null) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    /**
     * @return array{token:string, hashed_token:string, expires_at:string}
     */
    private function buildVerificationToken(): array
    {
        $token = bin2hex(random_bytes(32));

        return [
            'token' => $token,
            // SHA-256, not bcrypt: 256-bit random token needs no stretching,
            // and the deterministic hash enables indexed lookup at verify time
            // (the bcrypt scheme forced a full-table password_verify scan).
            'hashed_token' => hash('sha256', $token),
            'expires_at' => date('Y-m-d H:i:s', time() + 86400), // 24 hours
        ];
    }

    private function storeVerificationToken(int $userId, int $tenantId, array $verificationToken): void
    {
        $this->ensureVerificationTokenTableExists();

        // Clean up old tokens for this user only after send acceptance.
        DB::delete(
            "DELETE FROM email_verification_tokens WHERE user_id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );

        DB::insert(
            "INSERT INTO email_verification_tokens (user_id, tenant_id, token, expires_at) VALUES (?, ?, ?, ?)",
            [$userId, $tenantId, $verificationToken['hashed_token'], $verificationToken['expires_at']]
        );
    }

    private function ensureVerificationTokenTableExists(): void
    {
        // The table is schema-managed (database/schema/mysql-schema.sql); the
        // CREATE below is only a fallback for a database built without it.
        // Check first: MariaDB commits any open transaction before DDL, even
        // when IF NOT EXISTS finds the table, which split the caller's
        // transaction on every registration and leaked test fixtures into
        // nexus_test.
        if (Schema::hasTable('email_verification_tokens')) {
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
    }

    private function buildVerificationUrl(string $token): string
    {
        $appUrl = TenantContext::getFrontendUrl();
        $basePath = TenantContext::getSlugPrefix();

        return $appUrl . $basePath . '/verify-email?token=' . $token;
    }
}
