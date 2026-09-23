<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\BrokerMessageCopy;
use App\Models\Message;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * BrokerMessageVisibilityService
 *
 * Manages broker visibility into member messages for compliance and safeguarding.
 * Copies messages to a broker review queue based on configurable criteria.
 *
 * All queries are tenant-scoped via TenantContext::getId() or HasTenantScope.
 */
class BrokerMessageVisibilityService
{
    public const REASON_FIRST_CONTACT = 'first_contact';
    public const REASON_HIGH_RISK_LISTING = 'high_risk_listing';
    public const REASON_NEW_MEMBER = 'new_member';
    public const REASON_FLAGGED_USER = 'flagged_user';
    public const REASON_MONITORING = 'random_sample';

    private BrokerControlConfigService $configService;

    public function __construct(BrokerControlConfigService $configService)
    {
        $this->configService = $configService;
    }

    /**
     * Check if a message should be copied for broker review.
     *
     * @param int $senderId Sender user ID
     * @param int $receiverId Receiver user ID
     * @param int|null $listingId Related listing ID
     * @return string|null Copy reason or null
     */
    public function shouldCopyMessage(int $senderId, int $receiverId, ?int $listingId = null): ?string
    {
        return $this->evaluateCopyRules($senderId, [$receiverId], $listingId)[0] ?? null;
    }

    /**
     * Copy a group-conversation message for broker review when the
     * one-to-one rules would copy it to any of its recipients (F-086).
     *
     * Group messages are stored with receiver_id = 0 and never raise
     * MessageSent, so the listener-driven path cannot see them. The copy names
     * the recipient that triggered the rule (the monitored recipient, or the
     * first-contact recipient) and otherwise the first active recipient.
     *
     * @param list<int> $recipientIds Active participants other than the sender.
     * @return int|null Copy ID, or null when no rule applies.
     */
    public function copyGroupMessageIfRequired(int $messageId, int $senderId, array $recipientIds): ?int
    {
        $recipientIds = array_values(array_filter(
            array_map('intval', $recipientIds),
            static fn (int $id): bool => $id > 0 && $id !== $senderId,
        ));
        if ($recipientIds === []) {
            return null;
        }

        $decision = $this->evaluateCopyRules($senderId, $recipientIds, null);
        if ($decision === null) {
            return null;
        }

        return $this->copyMessageForBroker($messageId, $decision[0], $decision[1]);
    }

    /**
     * The broker copy rules, in priority order, for one sender and one or
     * more recipients. With a single recipient this is exactly the historic
     * one-to-one rule set.
     *
     * @param non-empty-list<int> $receiverIds
     * @return array{0: string, 1: int}|null [reason, receiver the copy names]
     */
    private function evaluateCopyRules(int $senderId, array $receiverIds, ?int $listingId): ?array
    {
        if (!$this->configService->isBrokerVisibilityEnabled()) {
            return null;
        }

        $firstReceiverId = $receiverIds[0];

        // Check BOTH sender and receiver — messages to/from vulnerable users must be monitored
        if ($this->isUserUnderMonitoring($senderId)) {
            return [self::REASON_FLAGGED_USER, $firstReceiverId];
        }
        foreach ($receiverIds as $receiverId) {
            if ($this->isUserUnderMonitoring($receiverId)) {
                return [self::REASON_FLAGGED_USER, $receiverId];
            }
        }

        if ($this->configService->isFirstContactMonitoringEnabled()) {
            foreach ($receiverIds as $receiverId) {
                if ($this->isFirstContact($senderId, $receiverId)) {
                    return [self::REASON_FIRST_CONTACT, $receiverId];
                }
            }
        }

        // Check new member
        $config = $this->configService->getConfig('broker_visibility');
        if (!empty($config['copy_new_member_messages'])) {
            $messagingConfig = $this->configService->getConfig('messaging');
            $monitoringDays = (int) ($messagingConfig['new_member_monitoring_days'] ?? 30);
            if ($monitoringDays > 0 && $this->isNewMember($senderId, $monitoringDays)) {
                return [self::REASON_NEW_MEMBER, $firstReceiverId];
            }
        }

        // Check high-risk listing
        if ($listingId && !empty($config['copy_high_risk_listing_messages'])) {
            $isHighRisk = DB::table('listing_risk_tags')
                ->where('listing_id', $listingId)
                ->where('tenant_id', TenantContext::getId())
                ->whereIn('risk_level', ['high', 'critical'])
                ->exists();
            if ($isHighRisk) {
                return [self::REASON_HIGH_RISK_LISTING, $firstReceiverId];
            }
        }

        // Random sampling — one draw per message, however many recipients.
        $sampleRate = (int) ($config['random_sample_percentage'] ?? 0);
        if ($sampleRate > 0 && rand(1, 100) <= $sampleRate) {
            return [self::REASON_MONITORING, $firstReceiverId];
        }

        return null;
    }

    /**
     * Copy a message for broker review.
     *
     * @param int $messageId Original message ID
     * @param string $reason Copy reason
     * @param int|null $receiverId Recipient the copy names. Only group
     *                             messages pass this: they are stored with
     *                             receiver_id = 0, which is not a member.
     * @return int|null Copy ID or null
     */
    public function copyMessageForBroker(int $messageId, string $reason, ?int $receiverId = null): ?int
    {
        $tenantId = TenantContext::getId();

        $message = Message::where('id', $messageId)
            ->where('tenant_id', $tenantId)
            ->first();
        if (!$message) {
            return null;
        }

        $receiverId ??= (int) $message->receiver_id;
        $groupConversationId = (int) ($message->conversation_id ?? 0);
        if ($groupConversationId > 0) {
            // All copies from one group share a key, like a one-to-one thread.
            $conversationKey = md5('group-' . $groupConversationId);
        } else {
            $ids = [(int) $message->sender_id, $receiverId];
            sort($ids);
            $conversationKey = md5(implode('-', $ids));
        }

        // firstOrCreate is atomic against the
        // (tenant_id, original_message_id) unique index. A retried queue job
        // (or duplicate event dispatch) will return the existing copy
        // instead of inserting a duplicate row.
        $copy = BrokerMessageCopy::firstOrCreate(
            [
                'tenant_id' => $tenantId,
                'original_message_id' => $message->id,
            ],
            [
                'conversation_key' => $conversationKey,
                'sender_id' => $message->sender_id,
                'receiver_id' => $receiverId,
                'message_body' => $message->body ?? '',
                'sent_at' => $message->created_at,
                'copy_reason' => $reason,
                'related_listing_id' => $message->listing_id ?? null,
            ]
        );

        // wasRecentlyCreated tells us whether THIS call inserted the row.
        // If a parallel worker beat us to it, we exit silently — the other
        // worker will dispatch the broker notifications.
        if (!$copy->wasRecentlyCreated) {
            return $copy->id;
        }

        // Notify admin brokers — in-app bell + email for high-priority reasons
        try {
            $sender = User::find($message->sender_id);
            $senderDisplayName = $sender ? trim($sender->name ?? '') : 'A user';
            if (empty($senderDisplayName)) {
                $senderDisplayName = 'A user';
            }

            $brokerUsers = User::where('tenant_id', $tenantId)
                ->whereIn('role', ['admin', 'tenant_admin', 'broker', 'super_admin'])
                ->where('status', 'active')
                ->select(['id', 'email', 'first_name', 'name', 'preferred_language', 'tenant_id'])
                ->get();

            // Recipients include role='broker', who can't access /admin/* routes
            // (BrokerRoute redirects them to /dashboard). Use the broker panel
            // path which all four notified roles (admin, tenant_admin, broker,
            // super_admin) can reach.
            TenantContext::runForTenant($tenantId, function () use ($brokerUsers, $message, $tenantId, $senderDisplayName, $reason) {
                $reviewUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/broker/messages';

                foreach ($brokerUsers as $broker) {
                    if ((int) $broker->id === (int) $message->sender_id) {
                        continue;
                    }

                    // Render bell + email in each broker's preferred language.
                    LocaleContext::withLocale($broker, function () use ($broker, $tenantId, $senderDisplayName, $reason, $reviewUrl) {
                        Notification::create([
                            'tenant_id' => $tenantId,
                            'user_id'   => $broker->id,
                            'message'   => __('svc_notifications.broker.message_for_review', ['sender' => $senderDisplayName]),
                            'link'      => '/broker/messages',
                            'type'      => 'broker_review',
                        ]);

                    // Email notification — only for high-priority reasons that affect monitored/vulnerable members
                        if (
                            in_array($reason, [self::REASON_FLAGGED_USER, self::REASON_HIGH_RISK_LISTING], true)
                            && !empty($broker->email)
                        ) {
                            $this->sendBrokerReviewEmail($broker, $senderDisplayName, $reason, $reviewUrl);
                        }
                    });
                }
            });
        } catch (\Throwable $e) {
            Log::warning('[BrokerMessageVisibilityService] Admin notification error: ' . $e->getMessage());
        }

        // Record first contact if applicable
        if ($reason === self::REASON_FIRST_CONTACT) {
            $this->recordFirstContact((int) $message->sender_id, $receiverId, $messageId);
        }

        return $copy->id;
    }

    /**
     * Get unreviewed messages for broker.
     *
     * @param int $limit Max number of messages
     * @param int $offset Offset for pagination
     * @return array
     */
    public function getUnreviewedMessages(int $limit = 50, int $offset = 0): array
    {
        return BrokerMessageCopy::with(['sender:id,name,avatar_url', 'receiver:id,name,avatar_url'])
            ->whereNull('reviewed_at')
            ->orderByDesc('flagged')
            ->orderByDesc('created_at')
            ->skip($offset)
            ->take($limit)
            ->get()
            ->toArray();
    }

    /**
     * Get messages by filter.
     *
     * @param string $filter Filter type (unreviewed, flagged, reviewed, all)
     * @param int $page Page number
     * @param int $perPage Items per page
     * @return array{items: array, total: int, pages: int}
     */
    public function getMessages(string $filter = 'unreviewed', int $page = 1, int $perPage = 50): array
    {
        $query = BrokerMessageCopy::with(['sender:id,name,avatar_url', 'receiver:id,name,avatar_url', 'reviewer:id,name']);

        switch ($filter) {
            case 'unreviewed':
                $query->whereNull('reviewed_at');
                break;
            case 'flagged':
                $query->where('flagged', true);
                break;
            case 'reviewed':
                $query->whereNotNull('reviewed_at');
                break;
        }

        $total = $query->count();

        $items = $query
            ->orderByDesc('flagged')
            ->orderByDesc('created_at')
            ->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get()
            ->toArray();

        return [
            'items' => $items,
            'total' => $total,
            'pages' => (int) ceil($total / $perPage),
        ];
    }

    /**
     * Mark a message copy as reviewed.
     *
     * @param int $copyId Message copy ID
     * @param int $brokerId Reviewer user ID
     * @return bool
     */
    public function markAsReviewed(int $copyId, int $brokerId): bool
    {
        $copy = BrokerMessageCopy::find($copyId);
        if (!$copy) {
            return false;
        }

        $copy->update([
            'reviewed_by' => $brokerId,
            'reviewed_at' => now(),
        ]);

        return true;
    }

    /**
     * Check if user has messaging disabled.
     *
     * @param int $userId User ID
     * @return bool
     */
    public function isMessagingDisabledForUser(int $userId): bool
    {
        $tenantId = TenantContext::getId();

        $restriction = DB::table('user_messaging_restrictions')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$restriction) {
            return false;
        }

        // Resolve monitoring through the same fail-closed predicate used by
        // broker copying and member-facing status. This also repairs the exact
        // legacy self-selection marker without changing an independent
        // messaging-disabled decision on the same row.
        $this->isActiveAuthorizedMonitoring($restriction, $userId, $tenantId);

        return (bool) ($restriction->messaging_disabled ?? false);
    }

    /**
     * Get the messaging restriction status for a user.
     *
     * @param int $userId User ID
     * @return array{
     *     messaging_disabled: bool,
     *     under_monitoring: bool,
     *     restriction_reason: string|null,
     *     review_notice_required: bool
     * }
     */
    public function getUserRestrictionStatus(int $userId): array
    {
        $tenantId = TenantContext::getId();
        // This is deliberately tenant-policy state, not a participant-pair
        // signal. Pair-specific disclosure could reveal that the other member
        // is monitored; the generic notice safely covers every copy criterion.
        $reviewNoticeRequired = $this->configService->isBrokerVisibilityEnabled();

        $row = DB::table('user_messaging_restrictions')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$row) {
            return [
                'messaging_disabled' => false,
                'under_monitoring' => false,
                'restriction_reason' => null,
                'review_notice_required' => $reviewNoticeRequired,
            ];
        }

        $underMonitoring = $this->isActiveAuthorizedMonitoring($row, $userId, $tenantId);
        $messagingDisabled = (bool) ($row->messaging_disabled ?? 0);

        $restrictionReason = $underMonitoring
            ? ($row->monitoring_reason ?? $row->restriction_reason ?? null)
            : ($messagingDisabled ? ($row->restriction_reason ?? null) : null);
        if ($restrictionReason === SafeguardingTriggerService::MONITORING_REASON_ONBOARDING) {
            $restrictionReason = null;
        }

        return [
            'messaging_disabled' => $messagingDisabled,
            'under_monitoring' => $underMonitoring,
            'restriction_reason' => $restrictionReason,
            'review_notice_required' => $reviewNoticeRequired,
        ];
    }

    /**
     * Count unreviewed messages.
     *
     * @return int
     */
    public function countUnreviewed(): int
    {
        return BrokerMessageCopy::whereNull('reviewed_at')->count();
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    private function isUserUnderMonitoring(int $userId): bool
    {
        $tenantId = TenantContext::getId();

        $restriction = DB::table('user_messaging_restrictions')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$restriction) {
            return false;
        }

        return $this->isActiveAuthorizedMonitoring($restriction, $userId, $tenantId);
    }

    /**
     * Resolve whether a restriction row represents active, authorised content
     * monitoring. The historical onboarding marker came from a member's own
     * safeguarding preference and never authorised brokers to read message
     * bodies, so it must fail closed everywhere monitoring state is consumed.
     */
    private function isActiveAuthorizedMonitoring(object $restriction, int $userId, int $tenantId): bool
    {
        if (($restriction->monitoring_reason ?? null) === SafeguardingTriggerService::MONITORING_REASON_ONBOARDING) {
            $this->clearLegacyPreferenceMonitoring($userId, $tenantId);
            $restriction->under_monitoring = 0;
            $restriction->requires_broker_approval = 0;

            return false;
        }

        if (! (bool) ($restriction->under_monitoring ?? false)) {
            return false;
        }

        $monitoringExpiresAt = $restriction->monitoring_expires_at ?? null;
        if ($monitoringExpiresAt && strtotime((string) $monitoringExpiresAt) <= time()) {
            $this->clearExpiredMonitoring($userId, $tenantId);
            $restriction->under_monitoring = 0;
            $restriction->messaging_disabled = 0;

            return false;
        }

        return true;
    }

    private function isFirstContact(int $senderId, int $receiverId): bool
    {
        $tenantId = TenantContext::getId();

        return !DB::table('user_first_contacts')
            ->where('tenant_id', $tenantId)
            ->where(function ($q) use ($senderId, $receiverId) {
                $q->where(function ($inner) use ($senderId, $receiverId) {
                    $inner->where('user1_id', $senderId)->where('user2_id', $receiverId);
                })->orWhere(function ($inner) use ($senderId, $receiverId) {
                    $inner->where('user1_id', $receiverId)->where('user2_id', $senderId);
                });
            })
            ->exists();
    }

    private function isNewMember(int $userId, int $days = 30): bool
    {
        return User::where('id', $userId)
            ->where('created_at', '>=', now()->subDays($days))
            ->exists();
    }

    private function recordFirstContact(int $userA, int $userB, int $messageId): void
    {
        $tenantId = TenantContext::getId();

        if ($userA > $userB) {
            [$userA, $userB] = [$userB, $userA];
        }

        DB::table('user_first_contacts')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'user1_id' => $userA,
            'user2_id' => $userB,
            'first_message_id' => $messageId,
            'first_contact_at' => now(),
        ]);
    }

    private function clearExpiredMonitoring(int $userId, int $tenantId): void
    {
        try {
            DB::table('user_messaging_restrictions')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'under_monitoring' => 0,
                    'messaging_disabled' => 0,
                    'monitoring_reason' => DB::raw("CONCAT(COALESCE(monitoring_reason, ''), ' [auto-expired]')"),
                    'monitoring_expires_at' => null,
                ]);
        } catch (\Throwable $e) {
            Log::warning('[BrokerMessageVisibilityService] Failed to clear expired monitoring: ' . $e->getMessage());
        }
    }

    /**
     * Remove only the monitoring flags historically written from a member's
     * self-selected safeguarding preference. Preserve independent restrictions
     * and audit fields so legitimate administrative decisions are untouched.
     */
    private function clearLegacyPreferenceMonitoring(int $userId, int $tenantId): void
    {
        try {
            DB::table('user_messaging_restrictions')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->where('monitoring_reason', SafeguardingTriggerService::MONITORING_REASON_ONBOARDING)
                ->update([
                    'under_monitoring' => 0,
                    'requires_broker_approval' => 0,
                ]);
        } catch (\Throwable $e) {
            Log::warning('[BrokerMessageVisibilityService] Failed to clear legacy preference monitoring: ' . $e->getMessage());
        }
    }

    /**
     * Send an email to a broker when a high-priority message is copied for review.
     * Only called for REASON_FLAGGED_USER and REASON_HIGH_RISK_LISTING.
     */
    private function sendBrokerReviewEmail(object $broker, string $senderDisplayName, string $reason, string $reviewUrl): void
    {
        try {
            $brokerName = $broker->first_name ?? $broker->name ?? __('emails.common.fallback_manager');

            $bodyKey = $reason === self::REASON_HIGH_RISK_LISTING
                ? 'emails_misc.safeguarding.broker_message_high_risk_body'
                : 'emails_misc.safeguarding.broker_message_flagged_body';

            $html = EmailTemplateBuilder::make()
                ->theme('warning')
                ->title(__('emails_misc.safeguarding.broker_message_flagged_title'))
                ->previewText(__('emails_misc.safeguarding.broker_message_flagged_preview'))
                ->greeting($brokerName)
                ->paragraph(__($bodyKey, ['sender' => htmlspecialchars($senderDisplayName, ENT_QUOTES, 'UTF-8')]))
                ->paragraph('<em>' . __('emails_misc.safeguarding.broker_message_audit_note') . '</em>')
                ->button(__('emails_misc.safeguarding.broker_message_cta'), $reviewUrl)
                ->render();

            $subject = __('emails_misc.safeguarding.broker_message_flagged_subject', ['sender' => $senderDisplayName]);

            if (!EmailDispatchService::sendRaw($broker->email, $subject, $html, null, null, null, 'safeguarding', ['tenant_id' => (int) $broker->tenant_id])) {
                Log::warning('[BrokerMessageVisibilityService] Broker review email failed to send', [
                    'broker_id'    => $broker->id,
                    'broker_email' => $broker->email,
                    'reason'       => $reason,
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('[BrokerMessageVisibilityService] sendBrokerReviewEmail error: ' . $e->getMessage());
        }
    }

    private function getTenantBrokerAdminIds(): array
    {
        return User::where('tenant_id', TenantContext::getId())
            ->whereIn('role', ['admin', 'tenant_admin', 'broker', 'super_admin'])
            ->where('status', 'active')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->toArray();
    }
}
