<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Identity;

use Illuminate\Support\Facades\DB;

/**
 * IdentityVerificationEventService — Audit log for all identity verification events.
 *
 * Every state transition in the registration/verification flow is recorded
 * for auditability, compliance, and debugging.
 *
 * 🔴 Reads MUST use DB::select() / DB::selectOne(), never DB::statement().
 * DB::statement() returns a bool, not a PDOStatement, so calling ->fetchAll()
 * or ->fetchColumn() on it is a fatal "Call to a member function on bool".
 * Every read method here carried that bug from the day the file was written:
 * GET /api/v2/admin/identity/audit-log 500'd for every admin, on every tenant,
 * for the whole life of the endpoint. DB::statement() is correct for the
 * INSERT in log(), which is why the write path was never affected.
 */
class IdentityVerificationEventService
{
    /** Event types */
    public const EVENT_REGISTRATION_STARTED = 'registration_started';
    public const EVENT_VERIFICATION_CREATED = 'verification_created';
    public const EVENT_VERIFICATION_STARTED = 'verification_started';
    public const EVENT_VERIFICATION_PROCESSING = 'verification_processing';
    public const EVENT_VERIFICATION_PASSED = 'verification_passed';
    public const EVENT_VERIFICATION_FAILED = 'verification_failed';
    public const EVENT_VERIFICATION_EXPIRED = 'verification_expired';
    public const EVENT_VERIFICATION_CANCELLED = 'verification_cancelled';
    public const EVENT_ADMIN_REVIEW_STARTED = 'admin_review_started';
    public const EVENT_ADMIN_APPROVED = 'admin_approved';
    public const EVENT_ADMIN_REJECTED = 'admin_rejected';
    public const EVENT_ACCOUNT_ACTIVATED = 'account_activated';
    public const EVENT_FALLBACK_TRIGGERED = 'fallback_triggered';

    /** Actor types */
    public const ACTOR_SYSTEM = 'system';
    public const ACTOR_USER = 'user';
    public const ACTOR_ADMIN = 'admin';
    public const ACTOR_WEBHOOK = 'webhook';

    /**
     * Log an identity verification event.
     *
     * @param int         $tenantId
     * @param int         $userId
     * @param string      $eventType  One of the EVENT_* constants
     * @param int|null    $sessionId  identity_verification_sessions.id (if applicable)
     * @param int|null    $actorId    The user performing the action (admin ID, or null for system)
     * @param string      $actorType  One of the ACTOR_* constants
     * @param array|null  $details    Additional context (JSON-serializable)
     * @param string|null $ipAddress
     * @param string|null $userAgent
     */
    public static function log(
        int $tenantId,
        int $userId,
        string $eventType,
        ?int $sessionId = null,
        ?int $actorId = null,
        string $actorType = self::ACTOR_SYSTEM,
        ?array $details = null,
        ?string $ipAddress = null,
        ?string $userAgent = null
    ): void {
        try {
            DB::statement(
                "INSERT INTO identity_verification_events
                    (tenant_id, user_id, session_id, event_type, actor_id, actor_type, details, ip_address, user_agent)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    $tenantId,
                    $userId,
                    $sessionId,
                    $eventType,
                    $actorId,
                    $actorType,
                    $details ? json_encode($details) : null,
                    $ipAddress,
                    $userAgent ? substr($userAgent, 0, 500) : null,
                ]
            );
        } catch (\Throwable $e) {
            // Audit logging should never break the main flow
            \Illuminate\Support\Facades\Log::warning("[IdentityVerificationEventService] Failed to log event '{$eventType}' for user {$userId}: " . $e->getMessage());
        }
    }

    /**
     * Get verification events for a user (for admin review).
     *
     * @param int $tenantId
     * @param int $userId
     * @param int $limit
     * @return array
     */
    public static function getForUser(int $tenantId, int $userId, int $limit = 50): array
    {
        return DB::select(
            "SELECT * FROM identity_verification_events
             WHERE tenant_id = ? AND user_id = ?
             ORDER BY created_at DESC
             LIMIT ?",
            [$tenantId, $userId, $limit]
        );
    }

    /**
     * Get events for a specific verification session.
     *
     * @param int $sessionId
     * @return array
     */
    public static function getForSession(int $sessionId): array
    {
        return DB::select(
            "SELECT * FROM identity_verification_events
             WHERE session_id = ?
             ORDER BY created_at ASC",
            [$sessionId]
        );
    }

    /**
     * Get all verification events for a tenant (admin audit log).
     *
     * @param int         $tenantId
     * @param int         $limit
     * @param int         $offset
     * @param string|null $eventType  Filter by event type (optional)
     * @return array{events: array, total: int}
     */
    public static function getForTenant(int $tenantId, int $limit = 50, int $offset = 0, ?string $eventType = null): array
    {
        $params = [$tenantId];
        $whereExtra = '';
        if ($eventType) {
            $whereExtra = ' AND event_type = ?';
            $params[] = $eventType;
        }

        $total = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM identity_verification_events WHERE tenant_id = ?" . $whereExtra,
            $params
        )->cnt;

        $params[] = $limit;
        $params[] = $offset;
        $events = DB::select(
            "SELECT e.*, u.first_name, u.last_name, u.email as user_email
             FROM identity_verification_events e
             LEFT JOIN users u ON u.id = e.user_id
             WHERE e.tenant_id = ?" . $whereExtra . "
             ORDER BY e.created_at DESC
             LIMIT ? OFFSET ?",
            $params
        );

        return ['events' => $events, 'total' => $total];
    }
}
