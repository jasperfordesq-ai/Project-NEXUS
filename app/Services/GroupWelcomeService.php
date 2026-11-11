<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;

/**
 * GroupWelcomeService — Auto-sends welcome messages to new group members.
 *
 * Each group can configure a custom welcome message template with
 * variables: {member_name}, {group_name}, {admin_name}.
 */
class GroupWelcomeService
{
    const SETTING_KEY = 'welcome_message';
    const ENABLED_KEY = 'welcome_message_enabled';

    /** @return list<string> */
    public static function policyKeysForGroup(int $groupId): array
    {
        return [
            self::SETTING_KEY . '_' . $groupId,
            self::ENABLED_KEY . '_' . $groupId,
        ];
    }

    /**
     * Get the welcome message config for a group.
     */
    public static function getConfig(int $groupId): array
    {
        $tenantId = TenantContext::getId();

        $config = DB::table('group_policies')
            ->where('tenant_id', $tenantId)
            ->whereIn('policy_key', self::policyKeysForGroup($groupId))
            ->pluck('policy_value', 'policy_key')
            ->toArray();

        $messageKey = self::SETTING_KEY . '_' . $groupId;
        $enabledKey = self::ENABLED_KEY . '_' . $groupId;

        return [
            'enabled' => isset($config[$enabledKey]) ? json_decode($config[$enabledKey], true) === true : false,
            'message' => isset($config[$messageKey]) ? json_decode($config[$messageKey], true) : '',
        ];
    }

    /**
     * Set welcome message for a group.
     */
    public static function setConfig(int $groupId, bool $enabled, string $message): void
    {
        $tenantId = TenantContext::getId();

        $entries = [
            [
                'tenant_id' => $tenantId,
                'policy_key' => self::ENABLED_KEY . '_' . $groupId,
                'policy_value' => json_encode($enabled),
                'category' => 'notifications',
                'value_type' => 'boolean',
                'description' => __('api.group_welcome_enabled_description', ['group' => $groupId]),
            ],
            [
                'tenant_id' => $tenantId,
                'policy_key' => self::SETTING_KEY . '_' . $groupId,
                'policy_value' => json_encode($message),
                'category' => 'notifications',
                'value_type' => 'string',
                'description' => __('api.group_welcome_template_description', ['group' => $groupId]),
            ],
        ];

        foreach ($entries as $entry) {
            DB::table('group_policies')->updateOrInsert(
                ['tenant_id' => $entry['tenant_id'], 'policy_key' => $entry['policy_key']],
                array_merge($entry, ['updated_at' => now()])
            );
        }
    }

    /**
     * Send welcome message to a new member (called on join/accept).
     */
    public static function sendWelcome(int $groupId, int $userId): bool
    {
        $tenantId = TenantContext::getId();
        if (! GroupAccessService::canViewMemberContent($groupId, $userId)) {
            return false;
        }

        $config = self::getConfig($groupId);

        if (!$config['enabled'] || empty($config['message'])) {
            return false;
        }

        $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->first();
        $group = DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('status', \App\Enums\GroupStatus::Active->value)
            ->first();

        if (!$user || !$group) {
            return false;
        }

        $owner = DB::table('users')->where('id', $group->owner_id)->where('tenant_id', $tenantId)->first();

        // Replace template variables
        $message = str_replace(
            ['{member_name}', '{group_name}', '{admin_name}'],
            [
                // E-122: the new member reads this; their own name is theirs to
                // see, the group owner's is shown as that member may see it.
                $user->name ?? __('api.group_welcome_member_fallback'),
                $group->name,
                ($owner ? \App\Support\Names\RecipientName::of($owner, (int) $userId, '') : '') ?: __('api.group_welcome_admin_fallback'),
            ],
            $config['message']
        );

        // Create notification via the notification dispatcher
        try {
            return LocaleContext::withLocale($user, function () use ($tenantId, $userId, $groupId, $group, $message): bool {
                DB::table('notifications')->insert([
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                    'type' => 'group_welcome',
                    'title' => __('api.group_welcome_notification_title', ['group' => $group->name]),
                    'message' => $message,
                    'link' => '/groups/' . $groupId,
                    'is_read' => 0,
                    'created_at' => now(),
                ]);

                return true;
            });
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning('[GroupWelcome] Failed to send welcome notification: ' . $e->getMessage());
            return false;
        }
    }
}
