<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Identity;

use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Support\UserDisplayName;

/**
 * RegistrationOrchestrationService — Central coordinator for the registration flow.
 *
 * After a user is created by RegistrationApiController, this service determines
 * the next steps based on the tenant's registration policy: direct activation,
 * admin approval, identity verification, or invite-only gate.
 *
 * This is the single entry point for post-registration logic that depends
 * on the Registration Policy Engine.
 */
class RegistrationOrchestrationService
{
    /**
     * Process a newly registered user according to the tenant's registration policy.
     *
     * Called from RegistrationApiController after user creation. Returns
     * instructions for the controller to render the correct response.
     *
     * @param int $userId
     * @param int $tenantId
     * @return array{
     *   action: string,
     *   requires_verification: bool,
     *   requires_approval: bool,
     *   verification_session: ?array,
     *   next_steps: string[],
     *   message: string
     * }
     */
    public static function processRegistration(int $userId, int $tenantId): array
    {
        $policy = RegistrationPolicyService::getEffectivePolicy($tenantId);

        // Log registration start
        IdentityVerificationEventService::log(
            $tenantId,
            $userId,
            IdentityVerificationEventService::EVENT_REGISTRATION_STARTED,
            null,
            null,
            IdentityVerificationEventService::ACTOR_SYSTEM,
            ['registration_mode' => $policy['registration_mode'], 'has_policy' => $policy['has_policy']],
            \App\Core\ClientIp::get(),
            $_SERVER['HTTP_USER_AGENT'] ?? null
        );

        switch ($policy['registration_mode']) {
            case 'open':
                return self::handleOpenRegistration($userId, $tenantId, $policy);

            case 'open_with_approval':
                return self::handleOpenWithApproval($userId, $tenantId, $policy);

            case 'verified_identity':
            case 'government_id':
                return self::handleVerifiedIdentity($userId, $tenantId, $policy);

            case 'invite_only':
                return self::handleInviteOnly($userId, $tenantId, $policy);

            case 'waitlist':
                return self::handleWaitlist($userId, $tenantId, $policy);

            default:
                // Unknown mode — safe fallback to approval
                return self::handleOpenWithApproval($userId, $tenantId, $policy);
        }
    }

    /**
     * Initiate identity verification for a user.
     *
     * Called when the user is ready to start verification (may be immediately
     * after registration or when they click "Start Verification").
     *
     * @param int $userId
     * @param int $tenantId
     * @return array Session data with redirect_url or client_token
     * @throws \RuntimeException If verification cannot be initiated
     */
    public static function initiateVerification(int $userId, int $tenantId): array
    {
        $policy = RegistrationPolicyService::getEffectivePolicy($tenantId);

        if (!$policy['verification_provider']) {
            throw new \RuntimeException('No verification provider configured for this tenant.');
        }

        $provider = IdentityProviderRegistry::get($policy['verification_provider']);

        if (!$provider->isAvailable($tenantId)) {
            // Trigger fallback if configured
            if ($policy['fallback_mode'] !== 'none') {
                return self::triggerFallback($userId, $tenantId, 'provider_unavailable');
            }
            throw new \RuntimeException('Identity verification provider is currently unavailable.');
        }

        // Load provider config: tenant-specific credentials take priority, then legacy policy blob
        $providerConfig = [];
        $tenantCreds = TenantProviderCredentialService::get($tenantId, $policy['verification_provider']);
        if ($tenantCreds) {
            $providerConfig = $tenantCreds;
        } else {
            $policyRow = RegistrationPolicyService::getPolicy($tenantId);
            if ($policyRow && !empty($policyRow['provider_config'])) {
                $providerConfig = RegistrationPolicyService::decryptConfig($policyRow['provider_config']);
            }
        }

        // Create session with provider
        $providerData = $provider->createSession(
            $userId,
            $tenantId,
            $policy['verification_level'],
            $providerConfig
        );

        // Persist session
        $sessionId = IdentityVerificationSessionService::create(
            $tenantId,
            $userId,
            $policy['verification_provider'],
            $policy['verification_level'],
            $providerData
        );

        // Update user verification status
        DB::statement(
            "UPDATE users SET verification_status = 'pending', verification_provider = ? WHERE id = ? AND tenant_id = ?",
            [$policy['verification_provider'], $userId, $tenantId]
        );

        // Log
        IdentityVerificationEventService::log(
            $tenantId,
            $userId,
            IdentityVerificationEventService::EVENT_VERIFICATION_CREATED,
            $sessionId,
            null,
            IdentityVerificationEventService::ACTOR_SYSTEM,
            ['provider' => $policy['verification_provider'], 'level' => $policy['verification_level']]
        );

        $session = IdentityVerificationSessionService::getById($sessionId);

        return [
            'session_id' => $sessionId,
            'redirect_url' => $providerData['redirect_url'] ?? null,
            'client_token' => $providerData['client_token'] ?? null,
            'provider' => $policy['verification_provider'],
            'expires_at' => $providerData['expires_at'] ?? null,
            'status' => 'created',
        ];
    }

    /**
     * Handle a verification result (from webhook or polling).
     *
     * @param int    $sessionId     identity_verification_sessions.id
     * @param string $status        'passed', 'failed', 'processing', 'expired'
     * @param array  $result        Normalized result from provider
     */
    public static function handleVerificationResult(int $sessionId, string $status, array $result): void
    {
        $session = IdentityVerificationSessionService::getById($sessionId);
        if (!$session) {
            \Illuminate\Support\Facades\Log::warning("[RegistrationOrchestrationService] Session {$sessionId} not found");
            return;
        }

        $tenantId = (int) $session['tenant_id'];
        $userId = (int) $session['user_id'];

        // Update session
        IdentityVerificationSessionService::updateStatus(
            $sessionId,
            $status,
            isset($result['decision']) ? json_encode($result) : null,
            $result['provider_reference'] ?? null,
            $result['failure_reason'] ?? null
        );

        // Map status to event type
        $eventMap = [
            'passed' => IdentityVerificationEventService::EVENT_VERIFICATION_PASSED,
            'failed' => IdentityVerificationEventService::EVENT_VERIFICATION_FAILED,
            'processing' => IdentityVerificationEventService::EVENT_VERIFICATION_PROCESSING,
            'expired' => IdentityVerificationEventService::EVENT_VERIFICATION_EXPIRED,
        ];
        $eventType = $eventMap[$status] ?? IdentityVerificationEventService::EVENT_VERIFICATION_PROCESSING;

        IdentityVerificationEventService::log(
            $tenantId,
            $userId,
            $eventType,
            $sessionId,
            null,
            IdentityVerificationEventService::ACTOR_WEBHOOK,
            $result
        );

        // Apply post-verification action
        if (in_array($status, ['passed', 'failed'], true)) {
            self::applyPostVerificationAction($userId, $tenantId, $status);
        }
    }

    /**
     * Apply the post-verification action based on tenant policy.
     */
    public static function applyPostVerificationAction(int $userId, int $tenantId, string $verificationStatus): void
    {
        $policy = RegistrationPolicyService::getEffectivePolicy($tenantId);

        // Update user verification status
        $dbStatus = $verificationStatus === 'passed' ? 'passed' : 'failed';
        $completedAt = date('Y-m-d H:i:s');
        DB::statement(
            "UPDATE users SET verification_status = ?, verification_completed_at = ? WHERE id = ? AND tenant_id = ?",
            [$dbStatus, $completedAt, $userId, $tenantId]
        );

        // Notify admins of verification result (both pass and fail)
        \App\Services\NotificationDispatcher::dispatchVerificationCompletedToAdmins($userId, $verificationStatus);

        if ($verificationStatus === 'passed') {
            // Send verification passed email
            \App\Services\NotificationDispatcher::dispatchVerificationPassed($userId);

            switch ($policy['post_verification']) {
                case 'activate':
                    // Auto-activate the user
                    DB::statement(
                        "UPDATE users SET is_approved = 1 WHERE id = ? AND tenant_id = ?",
                        [$userId, $tenantId]
                    );
                    IdentityVerificationEventService::log(
                        $tenantId,
                        $userId,
                        IdentityVerificationEventService::EVENT_ACCOUNT_ACTIVATED,
                        null, null,
                        IdentityVerificationEventService::ACTOR_SYSTEM,
                        ['reason' => 'verification_passed', 'post_action' => 'activate']
                    );
                    break;

                case 'admin_approval':
                    // Keep is_approved=0, admin must still approve
                    IdentityVerificationEventService::log(
                        $tenantId,
                        $userId,
                        IdentityVerificationEventService::EVENT_ADMIN_REVIEW_STARTED,
                        null, null,
                        IdentityVerificationEventService::ACTOR_SYSTEM,
                        ['reason' => 'verification_passed_pending_admin']
                    );
                    break;

                case 'limited_access':
                    // Grant limited access (is_approved stays 0 but a special status allows some access)
                    DB::statement(
                        "UPDATE users SET status = 'active' WHERE id = ? AND tenant_id = ?",
                        [$userId, $tenantId]
                    );
                    break;
            }
        } else {
            // Verification failed — send email notification
            $failureReason = '';
            $session = IdentityVerificationSessionService::getLatestForUser($tenantId, $userId);
            if ($session) {
                $failureReason = $session['failure_reason'] ?? '';
            }
            \App\Services\NotificationDispatcher::dispatchVerificationFailed($userId, $failureReason);

            if ($policy['post_verification'] === 'reject_on_fail') {
                DB::statement(
                    "UPDATE users SET status = 'inactive' WHERE id = ? AND tenant_id = ?",
                    [$userId, $tenantId]
                );
            } elseif ($policy['fallback_mode'] !== 'none') {
                self::triggerFallback($userId, $tenantId, 'verification_failed');
            }
        }
    }

    /**
     * Trigger fallback mode when verification is unavailable or fails.
     */
    public static function triggerFallback(int $userId, int $tenantId, string $reason): array
    {
        $policy = RegistrationPolicyService::getEffectivePolicy($tenantId);

        IdentityVerificationEventService::log(
            $tenantId,
            $userId,
            IdentityVerificationEventService::EVENT_FALLBACK_TRIGGERED,
            null, null,
            IdentityVerificationEventService::ACTOR_SYSTEM,
            ['reason' => $reason, 'fallback_mode' => $policy['fallback_mode']]
        );

        switch ($policy['fallback_mode']) {
            case 'admin_review':
                return [
                    'action' => 'pending_approval',
                    'requires_verification' => false,
                    'requires_approval' => true,
                    'verification_session' => null,
                    'next_steps' => ['Your account will be manually reviewed by an administrator.'],
                    'message' => __('svc_notifications_2.registration.queued_for_review'),
                ];

            case 'native_registration':
                // Auto-activate (standard registration without verification)
                DB::statement(
                    "UPDATE users SET is_approved = 1, verification_status = 'none' WHERE id = ? AND tenant_id = ?",
                    [$userId, $tenantId]
                );
                return [
                    'action' => 'activated',
                    'requires_verification' => false,
                    'requires_approval' => false,
                    'verification_session' => null,
                    'next_steps' => [],
                    'message' => __('svc_notifications_2.registration.complete'),
                ];

            default:
                return [
                    'action' => 'error',
                    'requires_verification' => false,
                    'requires_approval' => false,
                    'verification_session' => null,
                    'next_steps' => ['Please contact support.'],
                    'message' => __('svc_notifications_2.registration.verification_unavailable'),
                ];
        }
    }

    /**
     * Get the current registration/verification status for a user.
     */
    public static function getRegistrationStatus(int $userId, int $tenantId): array
    {
        $userRow = DB::selectOne(
            "SELECT id, status, is_approved, email_verified_at, verification_status, verification_provider, verification_completed_at
             FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
        $user = $userRow ? (array) $userRow : null;

        if (!$user) {
            return ['status' => 'not_found'];
        }

        $policy = RegistrationPolicyService::getEffectivePolicy($tenantId);
        $latestSession = IdentityVerificationSessionService::getLatestForUser($tenantId, $userId);

        return [
            'status' => self::deriveUserState($user, $policy),
            'email_verified' => !empty($user['email_verified_at']),
            'is_approved' => (bool) $user['is_approved'],
            'verification_status' => $user['verification_status'] ?? 'none',
            'verification_provider' => $user['verification_provider'],
            'registration_mode' => $policy['registration_mode'],
            'latest_session' => $latestSession ? [
                'id' => $latestSession['id'],
                'status' => $latestSession['status'],
                'provider' => $latestSession['provider_slug'],
                'created_at' => $latestSession['created_at'],
                'completed_at' => $latestSession['completed_at'],
                'failure_reason' => $latestSession['failure_reason'],
            ] : null,
        ];
    }

    /**
     * Derive the conceptual user state from DB columns.
     */
    private static function deriveUserState(array $user, array $policy): string
    {
        if ($user['status'] === 'banned') return 'banned';
        if ($user['status'] === 'suspended') return 'suspended';

        $verificationStatus = $user['verification_status'] ?? 'none';

        if ($verificationStatus === 'pending') return 'pending_verification';
        if ($verificationStatus === 'failed') return 'verification_failed';

        if (empty($user['is_approved'])) return 'pending_admin_review';

        return 'active';
    }

    // ─── Private helpers ─────────────────────────────────────────────────

    private static function handleOpenRegistration(int $userId, int $tenantId, array $policy): array
    {
        // Open registration: no gates, activate immediately
        DB::statement(
            "UPDATE users SET is_approved = 1 WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );

        IdentityVerificationEventService::log(
            $tenantId,
            $userId,
            IdentityVerificationEventService::EVENT_ACCOUNT_ACTIVATED,
            null, null,
            IdentityVerificationEventService::ACTOR_SYSTEM,
            ['reason' => 'open_registration']
        );

        return [
            'action' => 'activated',
            'requires_verification' => false,
            'requires_approval' => false,
            'verification_session' => null,
            'next_steps' => [],
            'message' => __('svc_notifications_2.registration.welcome'),
        ];
    }

    private static function handleOpenWithApproval(int $userId, int $tenantId, array $policy): array
    {
        // User stays is_approved=0, admin must approve

        // Notify all tenant admins that a new user requires approval
        try {
            $user = \Illuminate\Support\Facades\DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->select(['first_name', 'last_name', 'profile_type', 'organization_name', 'name', 'email'])
                ->first();

            if ($user) {
                $userName = UserDisplayName::resolve($user);
                if (empty($userName)) {
                    $userName = $user->name ?? 'Unknown';
                }
                $email = $user->email ?? '';

                // Render the admin bell message per-admin under their
                // preferred_language — the registering user's caller locale
                // would otherwise leak into every admin's notification
                // (notifyAdmins wraps under LocaleContext but receives a
                // pre-rendered $message, so the render has to happen per
                // admin here). We inline Notification::createNotification
                // per-admin since pending_approval has no email pathway
                // through sendExchangeEmailImmediately.
                $admins = \Illuminate\Support\Facades\DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('role', ['admin', 'broker', 'coordinator'])
                    ->where('status', 'active')
                    ->select(['id', 'preferred_language'])
                    ->get();

                foreach ($admins as $admin) {
                    LocaleContext::withLocale($admin, function () use ($admin, $userId, $userName, $email) {
                        $message = __('svc_notifications.registration.admin_pending_approval', ['name' => $userName, 'email' => $email]);
                        \App\Models\Notification::createNotification(
                            (int) $admin->id,
                            $message,
                            '/notifications',
                            'pending_approval'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $admin->id, 'pending_approval', $message, '/notifications');
                    });
                }
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("[RegistrationOrchestrationService] Failed to notify admins of pending approval for user #{$userId}: " . $e->getMessage());
        }

        return [
            'action' => 'pending_approval',
            'requires_verification' => false,
            'requires_approval' => true,
            'verification_session' => null,
            'next_steps' => ['Your account will be reviewed by a community administrator.'],
            'message' => __('svc_notifications_2.registration.pending_admin_approval'),
        ];
    }

    private static function handleVerifiedIdentity(int $userId, int $tenantId, array $policy): array
    {
        if (!$policy['verification_provider']) {
            // No provider configured, fall back
            if ($policy['fallback_mode'] !== 'none') {
                return self::triggerFallback($userId, $tenantId, 'no_provider_configured');
            }
            // Default to admin approval if no fallback
            return self::handleOpenWithApproval($userId, $tenantId, $policy);
        }

        // Mark user as pending verification
        DB::statement(
            "UPDATE users SET verification_status = 'pending', verification_provider = ? WHERE id = ? AND tenant_id = ?",
            [$policy['verification_provider'], $userId, $tenantId]
        );

        return [
            'action' => 'pending_verification',
            'requires_verification' => true,
            'requires_approval' => $policy['post_verification'] === 'admin_approval',
            'verification_session' => null, // Session created when user starts verification
            'next_steps' => ['Please complete identity verification to activate your account.'],
            'message' => __('svc_notifications_2.registration.verify_identity'),
        ];
    }

    private static function handleInviteOnly(int $userId, int $tenantId, array $policy): array
    {
        // Invite-only: user should not have gotten here without an invite code,
        // but if they did, keep them pending
        return [
            'action' => 'pending_approval',
            'requires_verification' => false,
            'requires_approval' => true,
            'verification_session' => null,
            'next_steps' => ['Your account is pending review.'],
            'message' => __('svc_notifications_2.registration.pending_review'),
        ];
    }

    private static function handleWaitlist(int $userId, int $tenantId, array $policy): array
    {
        // Waitlist: user is placed on the waitlist, admin activates in order
        DB::statement(
            "UPDATE users SET verification_status = 'waitlisted' WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );

        // Calculate position on waitlist
        $positionRow = DB::selectOne(
            "SELECT COUNT(*) AS pos FROM users
             WHERE tenant_id = ? AND verification_status = 'waitlisted' AND is_approved = 0
               AND created_at <= (SELECT created_at FROM users WHERE id = ? AND tenant_id = ?)",
            [$tenantId, $userId, $tenantId]
        );
        $position = (int) ($positionRow->pos ?? 0);

        IdentityVerificationEventService::log(
            $tenantId,
            $userId,
            'waitlist_joined',
            null, null,
            IdentityVerificationEventService::ACTOR_SYSTEM,
            ['position' => (int) $position]
        );

        return [
            'action' => 'waitlisted',
            'requires_verification' => false,
            'requires_approval' => false,
            'requires_waitlist' => true,
            'waitlist_position' => (int) $position,
            'verification_session' => null,
            'next_steps' => ["You're on the waitlist! Your position: #{$position}."],
            'message' => __('svc_notifications_2.registration.added_to_waitlist'),
        ];
    }

    /**
     * Admin review: approve or reject a verification session.
     *
     * @param int    $sessionId  identity_verification_sessions.id
     * @param int    $adminId    The admin performing the review
     * @param string $decision   'approve' or 'reject'
     * @return array Result with status and message
     * @throws \InvalidArgumentException If session not found or invalid decision
     */
    public static function adminReview(int $sessionId, int $adminId, string $decision): array
    {
        if (!in_array($decision, ['approve', 'reject'], true)) {
            throw new \InvalidArgumentException('Decision must be "approve" or "reject".');
        }

        $session = IdentityVerificationSessionService::getById($sessionId);
        if (!$session) {
            throw new \InvalidArgumentException('Verification session not found.');
        }

        $tenantId = (int) $session['tenant_id'];
        $userId = (int) $session['user_id'];

        // Verify tenant matches current context
        if ($tenantId !== TenantContext::getId()) {
            throw new \InvalidArgumentException('Session does not belong to this tenant.');
        }

        if ($decision === 'approve') {
            // Update session status to passed
            IdentityVerificationSessionService::updateStatus($sessionId, 'passed', null, null, null);

            // Activate the user
            DB::statement(
                "UPDATE users SET is_approved = 1, verification_status = 'passed', verification_completed_at = ? WHERE id = ? AND tenant_id = ?",
                [date('Y-m-d H:i:s'), $userId, $tenantId]
            );

            // Log admin approved event
            IdentityVerificationEventService::log(
                $tenantId,
                $userId,
                IdentityVerificationEventService::EVENT_ADMIN_APPROVED,
                $sessionId,
                $adminId,
                IdentityVerificationEventService::ACTOR_ADMIN,
                ['decision' => 'approve', 'admin_id' => $adminId],
                \App\Core\ClientIp::get(),
                $_SERVER['HTTP_USER_AGENT'] ?? null
            );

            // Log account activated event
            IdentityVerificationEventService::log(
                $tenantId,
                $userId,
                IdentityVerificationEventService::EVENT_ACCOUNT_ACTIVATED,
                $sessionId,
                $adminId,
                IdentityVerificationEventService::ACTOR_ADMIN,
                ['reason' => 'admin_approved']
            );

            // Notify the user
            \App\Services\NotificationDispatcher::dispatchVerificationPassed($userId);

            return [
                'status' => 'approved',
                'message' => __('svc_notifications_2.registration.user_approved_activated'),
                'user_id' => $userId,
                'session_id' => $sessionId,
            ];
        } else {
            // Reject
            IdentityVerificationSessionService::updateStatus(
                $sessionId,
                'failed',
                null,
                null,
                'Rejected by administrator'
            );

            // Update user verification status
            DB::statement(
                "UPDATE users SET verification_status = 'failed', verification_completed_at = ? WHERE id = ? AND tenant_id = ?",
                [date('Y-m-d H:i:s'), $userId, $tenantId]
            );

            // Log admin rejected event
            IdentityVerificationEventService::log(
                $tenantId,
                $userId,
                IdentityVerificationEventService::EVENT_ADMIN_REJECTED,
                $sessionId,
                $adminId,
                IdentityVerificationEventService::ACTOR_ADMIN,
                ['decision' => 'reject', 'admin_id' => $adminId],
                \App\Core\ClientIp::get(),
                $_SERVER['HTTP_USER_AGENT'] ?? null
            );

            // Notify the user
            \App\Services\NotificationDispatcher::dispatchVerificationFailed($userId, 'Rejected by administrator');

            return [
                'status' => 'rejected',
                'message' => __('svc_notifications_2.registration.user_verification_rejected'),
                'user_id' => $userId,
                'session_id' => $sessionId,
            ];
        }
    }

    /**
     * Send reminder emails for abandoned verification sessions (24h+).
     * Intended to run hourly via cron.
     *
     * @return int Number of reminders sent
     */
    public static function sendVerificationReminders(): int
    {
        $abandoned = IdentityVerificationSessionService::getAbandoned(24, 100);
        $count = 0;

        foreach ($abandoned as $row) {
            try {
                $queued = TenantContext::runForTenant((int) $row['tenant_id'], function () use ($row): bool {
                    return \App\Services\NotificationDispatcher::dispatchVerificationReminder((int) $row['user_id']);
                });

                if (!$queued) {
                    continue;
                }

                // The reminder is now durably queued in notification_queue;
                // actual email send/retry status is tracked by that queue.
                IdentityVerificationSessionService::markReminderSent((int) $row['id'], (int) $row['tenant_id']);
                $count++;
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning("[VerificationReminder] Failed for session {$row['id']}: " . $e->getMessage());
            }
        }

        return $count;
    }

    /**
     * Expire verification sessions older than 72 hours.
     * Intended to run daily via cron.
     *
     * @return int Number of sessions expired
     */
    public static function expireAbandonedSessions(): int
    {
        return IdentityVerificationSessionService::expireAbandoned(72);
    }

    /**
     * Purge completed/expired sessions older than retention period.
     * Intended to run weekly via cron. Audit events are retained separately.
     *
     * @param int $retentionDays Default 180 days
     * @return int Number of sessions purged
     */
    public static function purgeOldSessions(int $retentionDays = 180): int
    {
        return IdentityVerificationSessionService::purgeOldSessions($retentionDays);
    }
}
