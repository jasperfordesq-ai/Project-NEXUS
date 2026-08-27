<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\GroupMemberJoined;
use App\I18n\LocaleContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Notifies the group owner when a new member joins their group.
 */
class NotifyGroupMemberJoined implements ShouldQueue
{
    /**
     * Fail fast rather than letting redis re-deliver mid-flight. The queue's
     * retry_after is 90s; a slow run released back to another worker would
     * re-send the owner notification. Killing at 60s and not retrying keeps one
     * join → one notification. Belt-and-braces with the Cache guard in handle().
     */
    public int $tries = 1;
    public int $timeout = 60;

    public function __construct()
    {
        //
    }

    /**
     * Handle the event.
     */
    public function handle(GroupMemberJoined $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent re-deliveries for the
        // same (group, member) join so the owner is notified exactly once.
        $guardTenantId = (int) ($event->tenantId ?? 0);
        $handledKey = 'notify_group_member_joined:done:' . $guardTenantId . ':' . (int) $event->groupId . ':' . (int) $event->userId;
        $claimKey = 'notify_group_member_joined:claim:' . $guardTenantId . ':' . (int) $event->groupId . ':' . (int) $event->userId;
        if (Cache::has($handledKey)) {
            Log::info('NotifyGroupMemberJoined: duplicate delivery suppressed', ['group_id' => $event->groupId, 'user_id' => $event->userId, 'tenant_id' => $guardTenantId]);
            return;
        }
        $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
        if (!$claimAcquired) {
            Log::info('NotifyGroupMemberJoined: concurrent delivery suppressed', ['group_id' => $event->groupId, 'user_id' => $event->userId, 'tenant_id' => $guardTenantId]);
            return;
        }

        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById($event->tenantId);

            // Load the group and its owner_id
            $group = DB::table('groups')
                ->where('id', $event->groupId)
                ->where('tenant_id', $event->tenantId)
                ->select(['owner_id', 'name'])
                ->first();

            if (!$group || !$group->owner_id) {
                return;
            }

            $ownerId = (int) $group->owner_id;

            // Don't notify the owner if they joined their own group
            if ($ownerId === $event->userId) {
                return;
            }

            // Load the joining member's name
            $joiner = DB::table('users')
                ->where('id', $event->userId)
                ->where('tenant_id', $event->tenantId)
                ->select(['first_name', 'last_name', 'profile_type', 'organization_name', 'name'])
                ->first();

            if (!$joiner) {
                return;
            }

            // Resolve owner's preferred language (they're the notification recipient).
            $ownerLocale = DB::table('users')
                ->where('id', $ownerId)
                ->where('tenant_id', $event->tenantId)
                ->value('preferred_language');

            LocaleContext::withLocale($ownerLocale, function () use ($joiner, $group, $event, $ownerId) {
                $joinerName = UserDisplayName::resolve($joiner)
                    ?: ($joiner->name ?? __('emails.common.fallback_someone'));

                $groupName = $group->name ?? '';
                $content = __('notifications.group_new_member', ['name' => $joinerName, 'group' => $groupName]);
                $link = '/groups/' . $event->groupId;

                // dispatch() creates the in-app bell notification AND queues the email
                // (respects the owner's global notification frequency preference)
                \App\Services\NotificationDispatcher::dispatch(
                    $ownerId,
                    'global',
                    null,
                    'group_member_joined',
                    $content,
                    $link,
                    null
                );
            });

            // Mark handled only after the flow ran to completion so a redis
            // re-delivery cannot re-send the owner notification.
            Cache::put($handledKey, 1, now()->addHour());
        } catch (\Throwable $e) {
            Log::error('NotifyGroupMemberJoined listener failed', [
                'group_id'  => $event->groupId,
                'user_id'   => $event->userId,
                'tenant_id' => $event->tenantId,
                'error'     => $e->getMessage(),
                'trace'     => $e->getTraceAsString(),
            ]);
        } finally {
            if ($claimAcquired) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }
}
