<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\I18n\LocaleContext;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * GroupReportingService — Sends monthly digest emails to group owners/admins.
 *
 * Iterates all active tenants internally (do NOT wrap in forEachTenant).
 * For each tenant with the 'groups' feature enabled, finds groups with
 * recent activity and emails a summary to the group owner and admins.
 */
class GroupReportingService
{
    /**
     * Send monthly digest emails to all group owners/admins across all tenants.
     *
     * This method iterates tenants internally — do NOT call from within
     * forEachTenant() or you will get duplicate emails per tenant.
     *
     * @return array{sent: int, total_groups: int}
     */
    public static function sendAllWeeklyDigests(): array
    {
        $sent = 0;
        $totalGroups = 0;

        $previousTenantId = TenantContext::currentId();

        try {
            $tenants = DB::table('tenants')
                ->where('is_active', 1)
                ->select(['id', 'slug', 'name'])
                ->get();
        } catch (\Throwable $e) {
            Log::error('GroupReportingService: Failed to query tenants', [
                'error' => $e->getMessage(),
            ]);
            return ['sent' => 0, 'total_groups' => 0];
        }

        $digestSince = now()->subDays(30);

        try {
            foreach ($tenants as $tenant) {
                try {
                    TenantContext::setById($tenant->id);
                } catch (\Throwable $e) {
                    Log::warning('GroupReportingService: Failed to set tenant context', [
                        'tenant_id' => $tenant->id,
                        'error' => $e->getMessage(),
                    ]);
                    continue;
                }

                // Skip tenants without the groups feature
                try {
                    if (!TenantContext::hasFeature('groups')) {
                        continue;
                    }
                } catch (\Throwable $e) {
                    Log::debug('GroupReportingService: Could not check groups feature', [
                        'tenant_id' => $tenant->id,
                        'error' => $e->getMessage(),
                    ]);
                    continue;
                }

                try {
                // Find all active groups for this tenant
                $groups = DB::table('groups')
                    ->where('tenant_id', $tenant->id)
                    ->where('status', GroupStatus::Active->value)
                    ->select(['id', 'tenant_id', 'name', 'owner_id', 'cached_member_count'])
                    ->get();

                if ($groups->isEmpty()) {
                    continue;
                }

                $totalGroups += $groups->count();

                foreach ($groups as $group) {
                    try {
                        $result = self::processGroupDigest(
                            $group,
                            $tenant,
                            $digestSince
                        );
                        $sent += $result;
                    } catch (\Throwable $e) {
                        Log::warning('GroupReportingService: Failed to process group digest', [
                            'group_id' => $group->id,
                            'tenant_id' => $tenant->id,
                            'error' => $e->getMessage(),
                        ]);
                    }
                }
                } catch (\Throwable $e) {
                    Log::error('GroupReportingService: Error processing tenant', [
                        'tenant_id' => $tenant->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        } finally {
            if (app()->runningInConsole()) {
                TenantContext::reset();
            } elseif ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }

        return ['sent' => $sent, 'total_groups' => $totalGroups];
    }

    /**
     * Process and send the monthly digest for a single group.
     *
     * Gathers activity stats for the past month and sends an email to
     * the group owner and any admins who have not opted out.
     *
     * @return int Number of emails sent for this group
     */
    private static function processGroupDigest(
        object $group,
        object $tenant,
        \DateTimeInterface $weekAgo
    ): int {
        $tenantId = $tenant->id;

        // Gather monthly activity stats
        $newMemberCount = self::countNewMembers($group->id, $tenantId, $weekAgo);
        $newDiscussionCount = self::countNewDiscussions($group->id, $tenantId, $weekAgo);
        $newPostCount = self::countNewPosts($group->id, $tenantId, $weekAgo);
        $newEventCount = self::countNewEvents($group->id, $tenantId, $weekAgo);

        // Skip groups with no activity this month
        if ($newMemberCount === 0 && $newDiscussionCount === 0 && $newPostCount === 0 && $newEventCount === 0) {
            return 0;
        }

        $totalMembers = (int) ($group->cached_member_count ?? 0);
        if ($totalMembers === 0) {
            // Fallback: count active members directly
            try {
                $totalMembers = (int) DB::table('group_members')
                    ->where('tenant_id', $tenantId)
                    ->where('group_id', $group->id)
                    ->where('status', 'active')
                    ->count();
            } catch (\Throwable $e) {
                // Non-critical, keep 0
            }
        }

        $stats = [
            'group_name'       => $group->name,
            'new_members'      => $newMemberCount,
            'new_discussions'   => $newDiscussionCount,
            'new_posts'        => $newPostCount,
            'new_events'       => $newEventCount,
            'total_members'    => $totalMembers,
        ];

        // Find group owner and admins to notify
        $recipientIds = self::getGroupRecipients($group);

        $emailsSent = 0;

        foreach ($recipientIds as $userId) {
            try {
                // Check notification preferences — opt-out model
                try {
                    $prefs = User::getNotificationPreferences($userId);
                    if (!((bool) ($prefs['email_group_digest'] ?? true))) {
                        continue;
                    }
                } catch (\Throwable $prefError) {
                    Log::debug('GroupReportingService: Could not read email_group_digest pref', [
                        'user_id' => $userId,
                        'error' => $prefError->getMessage(),
                    ]);
                    // Default to sending on error
                }

                $user = User::where('id', $userId)
                    ->where('tenant_id', $tenant->id)
                    ->where('status', 'active')
                    ->whereNotNull('email')
                    ->where('email', '!=', '')
                    ->first(['id', 'tenant_id', 'email', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language']);

                if (!$user) {
                    continue;
                }

                // Wrap subject + body (stat labels, greetings, CTA) render in the
                // recipient's preferred_language. Each admin/owner gets the digest
                // in their own language.
                $success = LocaleContext::withLocale($user, function () use ($user, $group, $stats, $tenant) {
                    $name = UserDisplayName::resolve($user);
                    $subject = __('emails.group_digest.subject', ['group' => $group->name]);
                    $body = self::buildDigestEmailBody($name, $stats, $tenant->name ?? __('emails.common.fallback_tenant_name'));

                    return EmailDispatchService::sendRaw($user->email, $subject, $body, null, null, null, 'group_digest', ['tenant_id' => (int) $tenant->id]);
                });

                if ($success) {
                    $emailsSent++;
                }
            } catch (\Throwable $e) {
                Log::warning('GroupReportingService: Failed to send digest to user', [
                    'user_id' => $userId,
                    'group_id' => $group->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $emailsSent;
    }

    /**
     * Get the user IDs who should receive the group digest (owner + admins).
     *
     * @return int[]
     */
    private static function getGroupRecipients(object $group): array
    {
        $recipientIds = [];

        // Always include the group owner
        if (!empty($group->owner_id)) {
            $recipientIds[] = (int) $group->owner_id;
        }

        // Include group admins from group_members
        try {
            $adminIds = DB::table('group_members')
                ->where('tenant_id', $group->tenant_id ?? TenantContext::getId())
                ->where('group_id', $group->id)
                ->where('status', 'active')
                ->whereIn('role', ['admin', 'owner'])
                ->pluck('user_id')
                ->map(fn($id) => (int) $id)
                ->all();

            $recipientIds = array_merge($recipientIds, $adminIds);
        } catch (\Throwable $e) {
            Log::debug('GroupReportingService: Could not query group admins', [
                'group_id' => $group->id,
                'error' => $e->getMessage(),
            ]);
        }

        // Deduplicate (owner may also be listed as admin in group_members)
        return array_values(array_unique($recipientIds));
    }

    /**
     * Count new members who joined the group in the given period.
     */
    private static function countNewMembers(int $groupId, int $tenantId, \DateTimeInterface $since): int
    {
        try {
            return (int) DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('status', 'active')
                ->where('created_at', '>=', $since)
                ->count();
        } catch (\Throwable $e) {
            Log::debug('[GroupReporting] countNewMembers failed: ' . $e->getMessage());
            return 0;
        }
    }

    /**
     * Count new discussions created in the group in the given period.
     */
    private static function countNewDiscussions(int $groupId, int $tenantId, \DateTimeInterface $since): int
    {
        try {
            return (int) DB::table('group_discussions')
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->where('created_at', '>=', $since)
                ->count();
        } catch (\Throwable $e) {
            Log::debug('[GroupReporting] countNewDiscussions failed: ' . $e->getMessage());
            return 0;
        }
    }

    /**
     * Count new posts in group discussions in the given period.
     *
     * Joins through group_discussions to scope posts to the correct group.
     */
    private static function countNewPosts(int $groupId, int $tenantId, \DateTimeInterface $since): int
    {
        try {
            return (int) DB::table('group_posts')
                ->join('group_discussions', 'group_posts.discussion_id', '=', 'group_discussions.id')
                ->where('group_discussions.group_id', $groupId)
                ->where('group_posts.tenant_id', $tenantId)
                ->where('group_posts.created_at', '>=', $since)
                ->count();
        } catch (\Throwable $e) {
            Log::debug('[GroupReporting] countNewPosts failed: ' . $e->getMessage());
            return 0;
        }
    }

    /**
     * Count new events associated with the group in the given period.
     */
    private static function countNewEvents(int $groupId, int $tenantId, \DateTimeInterface $since): int
    {
        try {
            return (int) DB::table('events')
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->where('created_at', '>=', $since)
                ->count();
        } catch (\Throwable $e) {
            Log::debug('[GroupReporting] countNewEvents failed: ' . $e->getMessage());
            return 0;
        }
    }

    /**
     * Build the HTML body for a group monthly digest email.
     */
    private static function buildDigestEmailBody(string $name, array $stats, string $communityName): string
    {
        $safeName = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
        $safeGroupName = htmlspecialchars($stats['group_name'], ENT_QUOTES, 'UTF-8');
        $safeCommunityName = htmlspecialchars($communityName, ENT_QUOTES, 'UTF-8');

        $builder = EmailTemplateBuilder::make()
            ->theme('brand')
            ->title(__('emails.group_digest.title'))
            ->previewText(__('emails.group_digest.preview', ['group' => $safeGroupName, 'community' => $safeCommunityName]))
            ->greeting($safeName ?: __('emails.common.fallback_name'))
            ->paragraph(__('emails.group_digest.intro', ['group' => $safeGroupName, 'community' => $safeCommunityName]));

        // Build stat cards for non-zero activity metrics
        $statCards = [];
        if ($stats['new_members'] > 0) {
            $statCards[] = ['value' => (string) $stats['new_members'], 'label' => __('emails.group_digest.stat_new_members'), 'icon' => '👥'];
        }
        if ($stats['new_discussions'] > 0) {
            $statCards[] = ['value' => (string) $stats['new_discussions'], 'label' => __('emails.group_digest.stat_new_discussions'), 'icon' => '💬'];
        }
        if ($stats['new_posts'] > 0) {
            $statCards[] = ['value' => (string) $stats['new_posts'], 'label' => __('emails.group_digest.stat_new_posts'), 'icon' => '📝'];
        }
        if ($stats['new_events'] > 0) {
            $statCards[] = ['value' => (string) $stats['new_events'], 'label' => __('emails.group_digest.stat_new_events'), 'icon' => '📅'];
        }

        if (!empty($statCards)) {
            $builder->statCards($statCards);
        } else {
            $builder->paragraph(__('emails.group_digest.quiet_week'));
        }

        $builder->infoCard([__('emails.group_digest.total_members_label') => (string) $stats['total_members']])
            ->paragraph(__('emails.group_digest.thanks'))
            ->button(__('emails.group_digest.visit_button'), EmailTemplateBuilder::tenantUrl('/groups'));

        return $builder->render();
    }
}
