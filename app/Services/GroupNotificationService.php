<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\NotificationDispatcher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * GroupNotificationService — sends in-app + email + push notifications for group events.
 *
 * Native Laravel implementation (replaces legacy wrapper).
 * Uses NotificationDispatcher::dispatch() to create in-app bell notifications
 * AND trigger email/push delivery based on user frequency settings.
 */
class GroupNotificationService
{
    public function __construct()
    {
    }

    /**
     * Notify group admins/owners that a user has requested to join.
     */
    public function notifyJoinRequest(int $groupId, int $userId): void
    {
        $tenantId = TenantContext::getId();

        $group = $this->getGroupName($groupId, $tenantId);
        $userName = $this->getUserName($userId, $tenantId);

        if (!$group || !$userName) {
            Log::warning('GroupNotification: missing group or user', [
                'group_id' => $groupId,
                'user_id' => $userId,
            ]);
            return;
        }

        $admins = $this->getGroupAdmins($groupId, $tenantId);

        $safeUserName  = htmlspecialchars($userName, ENT_QUOTES, 'UTF-8');
        $safeGroupName = htmlspecialchars($group->name, ENT_QUOTES, 'UTF-8');
        ['relative' => $link, 'absolute' => $actionUrl] = $this->notificationLinks("/groups/{$groupId}?tab=members");
        $safeActionUrl = htmlspecialchars($actionUrl, ENT_QUOTES, 'UTF-8');
        $policies = GroupNotificationPreferenceService::getForUsers(
            array_map(static fn (object $admin): int => (int) $admin->user_id, $admins),
            $groupId,
        );

        foreach ($admins as $admin) {
            if ((int) $admin->user_id === $userId) {
                continue; // Don't notify the requester if they're somehow an admin
            }
            // Render the bell + email in each admin's preferred language.
            $deliveryPolicy = $policies[(int) $admin->user_id] ?? GroupNotificationPreferenceService::get((int) $admin->user_id, $groupId);
            LocaleContext::withLocale($admin->preferred_language ?? null, function () use ($admin, $groupId, $userId, $userName, $group, $safeUserName, $safeGroupName, $link, $safeActionUrl, $deliveryPolicy) {
                $message = __('notifications.group_join_request', ['name' => $userName, 'group' => $group->name]);
                $htmlContent = "<p>" . __('notifications.group_join_request', ['name' => "<strong>{$safeUserName}</strong>", 'group' => "<strong>{$safeGroupName}</strong>"]) . "</p>"
                    . "<p><a href=\"{$safeActionUrl}\">" . __('notifications.group_join_request_review') . "</a></p>";

                try {
                    NotificationDispatcher::dispatch(
                        (int) $admin->user_id,
                        'group',
                        $groupId,
                        'group_join_request',
                        $message,
                        $link,
                        $htmlContent,
                        false,
                        $userId,
                        $deliveryPolicy,
                    );
                } catch (\Throwable $e) {
                    Log::error('GroupNotification: failed to dispatch join request notification', [
                        'group_id' => $groupId,
                        'admin_user_id' => $admin->user_id,
                        'error' => $e->getMessage(),
                    ]);
                }
            });
        }
    }

    /**
     * Notify a user that they have been accepted into a group.
     */
    public function notifyJoined(int $groupId, int $userId, ?string $idempotencyKey = null): void
    {
        $tenantId = TenantContext::getId();

        $group = $this->getGroupName($groupId, $tenantId);
        if (!$group) {
            return;
        }

        $recipientLocale = $this->getUserLocale($userId, $tenantId);
        $safeGroupName = htmlspecialchars($group->name, ENT_QUOTES, 'UTF-8');
        ['relative' => $link, 'absolute' => $actionUrl] = $this->notificationLinks("/groups/{$groupId}");
        $safeActionUrl = htmlspecialchars($actionUrl, ENT_QUOTES, 'UTF-8');
        $deliveryPolicy = GroupNotificationPreferenceService::get($userId, $groupId);

        LocaleContext::withLocale($recipientLocale, function () use ($userId, $groupId, $group, $safeGroupName, $link, $safeActionUrl, $deliveryPolicy, $idempotencyKey) {
            $message = __('notifications.group_joined', ['group' => $group->name]);
            $htmlContent = "<p>" . __('notifications.group_joined', ['group' => "<strong>{$safeGroupName}</strong>"]) . "</p>"
                . "<p><a href=\"{$safeActionUrl}\">" . __('notifications.group_joined_visit') . "</a></p>";

            try {
                NotificationDispatcher::dispatch(
                    $userId,
                    'group',
                    $groupId,
                    'group_join',
                    $message,
                    $link,
                    $htmlContent,
                    false,
                    null,
                    $deliveryPolicy,
                    $idempotencyKey,
                );
            } catch (\Throwable $e) {
                Log::error('GroupNotification: failed to dispatch joined notification', [
                    'group_id' => $groupId,
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
            }
        });
    }

    /**
     * Notify a user that their join request was rejected.
     */
    public function notifyJoinRejected(int $groupId, int $userId, ?string $idempotencyKey = null): void
    {
        $tenantId = TenantContext::getId();

        $group = $this->getGroupName($groupId, $tenantId);
        if (!$group) {
            return;
        }

        $recipientLocale = $this->getUserLocale($userId, $tenantId);
        $safeGroupName = htmlspecialchars($group->name, ENT_QUOTES, 'UTF-8');
        ['relative' => $link, 'absolute' => $actionUrl] = $this->notificationLinks('/groups');
        $safeActionUrl = htmlspecialchars($actionUrl, ENT_QUOTES, 'UTF-8');
        $deliveryPolicy = GroupNotificationPreferenceService::get($userId, $groupId);

        LocaleContext::withLocale($recipientLocale, function () use ($userId, $groupId, $group, $safeGroupName, $link, $safeActionUrl, $deliveryPolicy, $idempotencyKey) {
            $message = __('notifications.group_join_rejected', ['group' => $group->name]);
            $htmlContent = "<p>" . __('notifications.group_join_rejected', ['group' => "<strong>{$safeGroupName}</strong>"]) . "</p>"
                . "<p><a href=\"{$safeActionUrl}\">" . __('notifications.group_browse_others') . "</a></p>";

            try {
                NotificationDispatcher::dispatch(
                    $userId,
                    'group',
                    $groupId,
                    'group_join_rejected',
                    $message,
                    $link,
                    $htmlContent,
                    false,
                    null,
                    $deliveryPolicy,
                    $idempotencyKey,
                );
            } catch (\Throwable $e) {
                Log::error('GroupNotification: failed to dispatch join rejected notification', [
                    'group_id' => $groupId,
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
            }
        });
    }

    /**
     * Notify group members about a new discussion.
     */
    public function notifyNewDiscussion(int $groupId, int $discussionId, int $authorId, string $title): void
    {
        $tenantId = TenantContext::getId();

        $group = $this->getGroupName($groupId, $tenantId);
        $authorName = $this->getUserName($authorId, $tenantId);

        if (!$group || !$authorName) {
            return;
        }

        $safeTitle     = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
        $safeAuthor    = htmlspecialchars($authorName, ENT_QUOTES, 'UTF-8');
        $safeGroupName = htmlspecialchars($group->name, ENT_QUOTES, 'UTF-8');
        ['relative' => $link, 'absolute' => $actionUrl] = $this->notificationLinks("/groups/{$groupId}?tab=discussion");
        $safeActionUrl = htmlspecialchars($actionUrl, ENT_QUOTES, 'UTF-8');

        $members = $this->getActiveMembers($groupId, $tenantId);
        $policies = GroupNotificationPreferenceService::getForUsers(
            array_map(static fn (object $member): int => (int) $member->user_id, $members),
            $groupId,
        );

        foreach ($members as $member) {
            if ((int) $member->user_id === $authorId) {
                continue; // Don't notify the author
            }
            // Render message + html content in each member's preferred language.
            $deliveryPolicy = $policies[(int) $member->user_id] ?? GroupNotificationPreferenceService::get((int) $member->user_id, $groupId);
            LocaleContext::withLocale($member->preferred_language ?? null, function () use ($member, $groupId, $discussionId, $authorId, $authorName, $title, $group, $safeAuthor, $safeTitle, $safeGroupName, $link, $safeActionUrl, $deliveryPolicy) {
                $message = __('notifications.group_new_discussion', ['author' => $authorName, 'title' => $title, 'group' => $group->name]);
                $htmlContent = "<p>" . __('notifications.group_new_discussion', ['author' => "<strong>{$safeAuthor}</strong>", 'title' => "<strong>\"{$safeTitle}\"</strong>", 'group' => "<strong>{$safeGroupName}</strong>"]) . "</p>"
                    . "<p><a href=\"{$safeActionUrl}\">" . __('notifications.group_view_discussion') . "</a></p>";

                try {
                    NotificationDispatcher::dispatch(
                        (int) $member->user_id,
                        'group',
                        $groupId,
                        'new_topic',
                        $message,
                        $link,
                        $htmlContent,
                        false,
                        $authorId,
                        $deliveryPolicy,
                    );
                } catch (\Throwable $e) {
                    Log::error('GroupNotification: failed to dispatch new discussion notification', [
                        'group_id' => $groupId,
                        'discussion_id' => $discussionId,
                        'member_user_id' => $member->user_id,
                        'error' => $e->getMessage(),
                    ]);
                }
            });
        }
    }

    /**
     * Notify group members about a new announcement.
     */
    public function notifyNewAnnouncement(int $groupId, int $authorId, string $title): void
    {
        $tenantId = TenantContext::getId();

        $group = $this->getGroupName($groupId, $tenantId);
        $authorName = $this->getUserName($authorId, $tenantId);

        if (!$group || !$authorName) {
            return;
        }

        $safeTitle     = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
        $safeAuthor    = htmlspecialchars($authorName, ENT_QUOTES, 'UTF-8');
        $safeGroupName = htmlspecialchars($group->name, ENT_QUOTES, 'UTF-8');
        ['relative' => $link, 'absolute' => $actionUrl] = $this->notificationLinks("/groups/{$groupId}?tab=announcements");
        $safeActionUrl = htmlspecialchars($actionUrl, ENT_QUOTES, 'UTF-8');

        $members = $this->getActiveMembers($groupId, $tenantId);
        $policies = GroupNotificationPreferenceService::getForUsers(
            array_map(static fn (object $member): int => (int) $member->user_id, $members),
            $groupId,
        );

        foreach ($members as $member) {
            if ((int) $member->user_id === $authorId) {
                continue; // Don't notify the author
            }
            // Render announcement in each member's preferred language.
            $deliveryPolicy = $policies[(int) $member->user_id] ?? GroupNotificationPreferenceService::get((int) $member->user_id, $groupId);
            LocaleContext::withLocale($member->preferred_language ?? null, function () use ($member, $groupId, $authorId, $authorName, $title, $group, $safeAuthor, $safeTitle, $safeGroupName, $link, $safeActionUrl, $deliveryPolicy) {
                $message = __('notifications.group_new_announcement', ['author' => $authorName, 'title' => $title, 'group' => $group->name]);
                $htmlContent = "<p>" . __('notifications.group_new_announcement', ['author' => "<strong>{$safeAuthor}</strong>", 'title' => "<strong>\"{$safeTitle}\"</strong>", 'group' => "<strong>{$safeGroupName}</strong>"]) . "</p>"
                    . "<p><a href=\"{$safeActionUrl}\">" . __('notifications.group_view_announcement') . "</a></p>";

                try {
                    NotificationDispatcher::dispatch(
                        (int) $member->user_id,
                        'group',
                        $groupId,
                        'new_topic',
                        $message,
                        $link,
                        $htmlContent,
                        true, // isOrganizer: announcements are admin-only, treat as organizer priority
                        $authorId,
                        $deliveryPolicy,
                    );
                } catch (\Throwable $e) {
                    Log::error('GroupNotification: failed to dispatch announcement notification', [
                        'group_id' => $groupId,
                        'member_user_id' => $member->user_id,
                        'error' => $e->getMessage(),
                    ]);
                }
            });
        }
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /**
     * Get group name by ID (tenant-scoped).
     */
    private function getGroupName(int $groupId, int $tenantId): ?object
    {
        return DB::selectOne(
            "SELECT id, name FROM `groups` WHERE id = ? AND tenant_id = ?",
            [$groupId, $tenantId]
        );
    }

    /**
     * Get a user's display name.
     */
    private function getUserName(int $userId, int $tenantId): ?string
    {
        $user = DB::selectOne(
            "SELECT CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) as name
             FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );

        return $user ? trim($user->name) : null;
    }

    /**
     * Get admin/owner members of a group.
     *
     * @return array<object>
     */
    private function getGroupAdmins(int $groupId, int $tenantId): array
    {
        return DB::select(
            "SELECT gm.user_id, u.preferred_language
             FROM group_members gm
             JOIN `groups` g ON gm.group_id = g.id
             JOIN users u ON u.id = gm.user_id AND u.tenant_id = g.tenant_id
             WHERE gm.group_id = ? AND g.tenant_id = ?
             AND gm.role IN ('admin', 'owner')
             AND gm.status IN ('active', 'approved')",
            [$groupId, $tenantId]
        );
    }

    /**
     * Get all active members of a group.
     *
     * @return array<object>
     */
    private function getActiveMembers(int $groupId, int $tenantId): array
    {
        return DB::select(
            "SELECT gm.user_id, u.preferred_language
             FROM group_members gm
             JOIN `groups` g ON gm.group_id = g.id
             JOIN users u ON u.id = gm.user_id AND u.tenant_id = g.tenant_id
             WHERE gm.group_id = ? AND g.tenant_id = ?
             AND gm.status IN ('active', 'approved')",
            [$groupId, $tenantId]
        );
    }

    private function getUserLocale(int $userId, int $tenantId): ?string
    {
        return DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->value('preferred_language');
    }

    /** @return array{relative: string, absolute: string} */
    private function notificationLinks(string $path): array
    {
        $relative = '/' . ltrim($path, '/');
        $tenantPrefix = rtrim(TenantContext::getSlugPrefix(), '/');

        return [
            'relative' => $relative,
            'absolute' => rtrim(TenantContext::getFrontendUrl(), '/') . $tenantPrefix . $relative,
        ];
    }
}
