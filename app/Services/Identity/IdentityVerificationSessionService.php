<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Identity;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * IdentityVerificationSessionService — CRUD and status management for verification sessions.
 */
class IdentityVerificationSessionService
{
    /**
     * Create a new verification session record.
     *
     * @param int    $tenantId
     * @param int    $userId
     * @param string $providerSlug
     * @param string $verificationLevel
     * @param array  $providerData Data returned from provider's createSession()
     * @return int The created session ID
     */
    public static function create(
        int $tenantId,
        int $userId,
        string $providerSlug,
        string $verificationLevel,
        array $providerData
    ): int {
        DB::statement(
            "INSERT INTO identity_verification_sessions
                (tenant_id, user_id, provider_slug, provider_session_id, verification_level,
                 status, redirect_url, client_token, expires_at)
             VALUES (?, ?, ?, ?, ?, 'created', ?, ?, ?)",
            [
                $tenantId,
                $userId,
                $providerSlug,
                $providerData['provider_session_id'] ?? null,
                $verificationLevel,
                $providerData['redirect_url'] ?? null,
                $providerData['client_token'] ?? null,
                $providerData['expires_at'] ?? null,
            ]
        );

        return (int) DB::getPdo()->lastInsertId();
    }

    /**
     * Get a session by ID.
     */
    public static function getById(int $sessionId): ?array
    {
        $rows = DB::select(
            "SELECT * FROM identity_verification_sessions WHERE id = ?",
            [$sessionId]
        );

        return !empty($rows) ? (array) $rows[0] : null;
    }

    /**
     * Find a session by provider session ID and provider slug.
     */
    public static function findByProviderSession(string $providerSlug, string $providerSessionId, ?int $tenantId = null): ?array
    {
        $query = "SELECT * FROM identity_verification_sessions
             WHERE provider_slug = ? AND provider_session_id = ?";
        $params = [$providerSlug, $providerSessionId];

        if ($tenantId !== null) {
            $query .= " AND tenant_id = ?";
            $params[] = $tenantId;
        }

        $query .= " ORDER BY created_at DESC LIMIT 1";

        $rows = DB::select($query, $params);

        return !empty($rows) ? (array) $rows[0] : null;
    }

    /**
     * Get the latest session for a user.
     */
    public static function getLatestForUser(int $tenantId, int $userId): ?array
    {
        $rows = DB::select(
            "SELECT * FROM identity_verification_sessions
             WHERE tenant_id = ? AND user_id = ?
             ORDER BY created_at DESC LIMIT 1",
            [$tenantId, $userId]
        );

        return !empty($rows) ? (array) $rows[0] : null;
    }

    /**
     * Get all sessions for a user.
     */
    public static function getAllForUser(int $tenantId, int $userId): array
    {
        $rows = DB::select(
            "SELECT * FROM identity_verification_sessions
             WHERE tenant_id = ? AND user_id = ?
             ORDER BY created_at DESC",
            [$tenantId, $userId]
        );

        return array_map(fn($row) => (array) $row, $rows);
    }

    /**
     * Update session status.
     */
    public static function updateStatus(
        int $sessionId,
        string $status,
        ?string $resultSummary = null,
        ?string $providerReference = null,
        ?string $failureReason = null
    ): void {
        $completedAt = in_array($status, ['passed', 'failed', 'expired', 'cancelled'], true)
            ? date('Y-m-d H:i:s')
            : null;

        DB::statement(
            "UPDATE identity_verification_sessions
             SET status = ?,
                 result_summary = COALESCE(?, result_summary),
                 provider_reference = COALESCE(?, provider_reference),
                 failure_reason = ?,
                 completed_at = COALESCE(?, completed_at),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?",
            [$status, $resultSummary, $providerReference, $failureReason, $completedAt, $sessionId]
        );

        // Send outcome email for terminal statuses
        try {
            self::sendStatusEmail($sessionId, $status, $failureReason);
        } catch (\Throwable $e) {
            Log::warning('[IdentityVerificationSessionService] sendStatusEmail failed: ' . $e->getMessage());
        }
    }

    /**
     * Send a passed/failed outcome email to the user linked to a verification session.
     *
     * Only fires for 'passed' or 'failed' statuses; silently skips all others.
     */
    private static function sendStatusEmail(int $sessionId, string $status, ?string $failureReason = null): void
    {
        if ($status !== 'passed' && $status !== 'failed') {
            return;
        }

        // Load session + user in one query
        $row = DB::selectOne(
            "SELECT ivs.user_id, u.email, u.first_name, u.name, u.tenant_id, u.preferred_language
             FROM identity_verification_sessions ivs
             JOIN users u ON u.id = ivs.user_id AND u.tenant_id = ivs.tenant_id
             WHERE ivs.id = ?",
            [$sessionId]
        );

        if (!$row || empty($row->email)) {
            return;
        }

        // Set tenant context so Mailer + URL helpers resolve correctly.
        $previousTenantId = TenantContext::currentId();
        TenantContext::setById((int) $row->tenant_id);
        try {
            LocaleContext::withLocale($row, function () use ($row, $sessionId, $status, $failureReason) {
                $firstName  = $row->first_name ?? $row->name ?? __('emails.common.fallback_name');
                $baseUrl    = TenantContext::getFrontendUrl();
                $basePath   = TenantContext::getSlugPrefix();

                if ($status === 'passed') {
                    $subject  = __('emails.identity_verification.passed_subject');
                    $ctaUrl   = $baseUrl . $basePath . '/profile';

                    $html = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails.identity_verification.passed_title'))
                        ->previewText(__('emails.identity_verification.passed_preview'))
                        // greeting() expects the bare name (wrapped + escaped at
                        // render) — a full translated greeting rendered doubled.
                        ->greeting($firstName)
                        ->paragraph(__('emails.identity_verification.passed_body'))
                        ->button(__('emails.identity_verification.passed_cta'), $ctaUrl)
                        ->render();
                } else {
                    $subject  = __('emails.identity_verification.failed_subject');
                    $ctaUrl   = $baseUrl . $basePath . '/settings/security';

                    $builder = EmailTemplateBuilder::make()
                        ->theme('brand')
                        ->title(__('emails.identity_verification.failed_title'))
                        ->previewText(__('emails.identity_verification.failed_preview'))
                        ->greeting($firstName)
                        ->paragraph(__('emails.identity_verification.failed_body'));

                    if (!empty($failureReason)) {
                        // infoCard escapes at render — pre-escaping double-encodes.
                        $builder->infoCard([
                            __('emails.identity_verification.failed_reason_label') => $failureReason,
                        ]);
                    }

                    $html = $builder
                        ->paragraph(__('emails.identity_verification.failed_retry_note'))
                        ->button(__('emails.identity_verification.failed_cta'), $ctaUrl)
                        ->render();
                }

                if (!\App\Services\EmailDispatchService::sendRaw($row->email, $subject, $html, null, null, null, 'identity_verification', ['tenant_id' => (int) $row->tenant_id])) {
                    Log::warning('[IdentityVerificationSessionService] result email failed', [
                        'session_id' => $sessionId,
                        'user_id' => $row->user_id ?? null,
                        'status' => $status,
                    ]);
                }
            });
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById((int) $previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }

    /**
     * Get sessions pending for a tenant (admin view).
     */
    public static function getPendingForTenant(int $tenantId, int $limit = 50, int $offset = 0): array
    {
        $rows = DB::select(
            "SELECT ivs.*, u.first_name, u.last_name, u.email
             FROM identity_verification_sessions ivs
             JOIN users u ON u.id = ivs.user_id
             WHERE ivs.tenant_id = ? AND ivs.status IN ('created', 'started', 'processing')
             ORDER BY ivs.created_at DESC
             LIMIT ? OFFSET ?",
            [$tenantId, $limit, $offset]
        );

        return array_map(fn($row) => (array) $row, $rows);
    }

    /**
     * Get abandoned sessions (created/started but not completed within $hoursOld hours).
     * Used by cron to send reminder emails.
     *
     * @param int $hoursOld  Sessions older than this many hours
     * @param int $limit
     * @return array Sessions with user info
     */
    public static function getAbandoned(int $hoursOld = 24, int $limit = 100): array
    {
        $rows = DB::select(
            "SELECT ivs.*, u.first_name, u.last_name, u.email, ivs.tenant_id
             FROM identity_verification_sessions ivs
             JOIN users u ON u.id = ivs.user_id AND u.tenant_id = ivs.tenant_id
             WHERE ivs.status IN ('created', 'started')
               AND ivs.created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
               AND ivs.reminder_sent_at IS NULL
             ORDER BY ivs.created_at ASC
             LIMIT ?",
            [$hoursOld, $limit]
        );

        return array_map(fn($row) => (array) $row, $rows);
    }

    /**
     * Mark a session as having had a reminder sent.
     */
    public static function markReminderSent(int $sessionId, int $tenantId): void
    {
        DB::statement(
            "UPDATE identity_verification_sessions SET reminder_sent_at = NOW() WHERE id = ? AND tenant_id = ?",
            [$sessionId, $tenantId]
        );
    }

    /**
     * Expire sessions older than the given hours that are still in created/started status.
     *
     * DELIBERATELY CROSS-TENANT (2026-07-09 audit): called from cron as
     * platform-wide maintenance — abandonment is a row-level property, so the
     * UPDATE intentionally omits tenant_id. Do NOT add a tenant filter, and
     * do NOT copy this query shape into request-path code.
     *
     * @param int $hoursOld  Sessions older than this many hours
     * @return int Number of sessions expired
     */
    public static function expireAbandoned(int $hoursOld = 72): int
    {
        return DB::affectingStatement(
            "UPDATE identity_verification_sessions
             SET status = 'expired', completed_at = NOW(), updated_at = NOW()
             WHERE status IN ('created', 'started')
               AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)",
            [$hoursOld]
        );
    }

    /**
     * Delete completed/expired sessions older than the retention period.
     * Keeps audit trail in identity_verification_events but cleans session table.
     *
     * DELIBERATELY CROSS-TENANT (2026-07-09 audit): cron retention sweep for
     * ALL tenants — the DELETE intentionally omits tenant_id. Do NOT add a
     * tenant filter, and do NOT copy this query shape into request-path code.
     *
     * @param int $retentionDays  Delete sessions older than this (default 180 days)
     * @return int Number of sessions deleted
     */
    public static function purgeOldSessions(int $retentionDays = 180): int
    {
        return DB::affectingStatement(
            "DELETE FROM identity_verification_sessions
             WHERE status IN ('passed', 'failed', 'expired', 'cancelled')
               AND completed_at IS NOT NULL
               AND completed_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
            [$retentionDays]
        );
    }

    /**
     * Check if user has completed payment for identity verification in this tenant.
     * Used for the "pay once" rule — if they've paid before, skip payment on retry.
     */
    public static function hasCompletedPaymentForTenant(int $tenantId, int $userId): bool
    {
        $row = DB::selectOne(
            "SELECT 1 FROM identity_verification_sessions
             WHERE tenant_id = ? AND user_id = ? AND payment_status = 'completed'
             LIMIT 1",
            [$tenantId, $userId]
        );
        return $row !== null;
    }

    /**
     * Update payment status on a session.
     */
    public static function updatePaymentStatus(int $sessionId, string $paymentStatus, ?string $paymentIntentId = null): void
    {
        $updates = ['payment_status' => $paymentStatus, 'updated_at' => now()];
        $query = "UPDATE identity_verification_sessions SET payment_status = ?, updated_at = NOW()";
        $params = [$paymentStatus];

        if ($paymentIntentId !== null) {
            $query .= ", stripe_payment_intent_id = ?";
            $params[] = $paymentIntentId;
        }

        $query .= " WHERE id = ?";
        $params[] = $sessionId;

        DB::statement($query, $params);
    }

    /**
     * Mark a fee payment failed unless it has already completed (F-107).
     *
     * Stripe does not guarantee webhook order, so a late or replayed
     * `payment_intent.payment_failed` can arrive after `succeeded`. `completed`
     * is terminal: the conditional UPDATE makes the transition atomic, so a
     * failure event can never un-pay a member who has paid.
     *
     * @return bool true when the row moved to `failed`
     */
    public static function markPaymentFailedUnlessCompleted(int $sessionId): bool
    {
        return DB::update(
            "UPDATE identity_verification_sessions
             SET payment_status = 'failed', updated_at = NOW()
             WHERE id = ? AND payment_status <> 'completed'",
            [$sessionId]
        ) > 0;
    }

    /**
     * Find a session by its Stripe PaymentIntent ID.
     */
    public static function findByPaymentIntentId(string $paymentIntentId): ?array
    {
        $rows = DB::select(
            "SELECT * FROM identity_verification_sessions WHERE stripe_payment_intent_id = ? LIMIT 1",
            [$paymentIntentId]
        );
        return !empty($rows) ? (array) $rows[0] : null;
    }
}
