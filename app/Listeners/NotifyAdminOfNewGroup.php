<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\GroupCreated;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Notifies all admins, brokers, and coordinators when a new group is created.
 */
class NotifyAdminOfNewGroup implements ShouldQueue
{
    /**
     * Fail fast instead of letting redis re-deliver this fanout mid-flight
     * (retry_after=90s). A re-delivery would re-email EVERY admin. $timeout<retry_after
     * plus the Cache idempotency guard keep one event → one fanout.
     */
    public int $tries = 1;
    public int $timeout = 60;

    public function handle(GroupCreated $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent re-deliveries so the admin
        // fanout (email + bell to every admin) runs exactly once per event.
        $entityId = (int) ($event->group->id ?? 0);
        $tenantId = (int) ($event->tenantId ?? 0);
        $handledKey = null;
        $claimKey = null;
        $claimAcquired = false;
        if ($entityId > 0) {
            $handledKey = 'notify_admin_new_group:done:' . $tenantId . ':' . $entityId;
            $claimKey = 'notify_admin_new_group:claim:' . $tenantId . ':' . $entityId;
            if (Cache::has($handledKey)) {
                Log::info('NotifyAdminOfNewGroup: duplicate fanout suppressed', ['entity_id' => $entityId, 'tenant_id' => $tenantId]);
                return;
            }
            $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
            if (!$claimAcquired) {
                Log::info('NotifyAdminOfNewGroup: concurrent fanout suppressed', ['entity_id' => $entityId, 'tenant_id' => $tenantId]);
                return;
            }
        }

        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById($event->tenantId);

            $group      = $event->group;
            $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';
            $baseUrl    = TenantContext::getFrontendUrl();
            $basePath   = TenantContext::getSlugPrefix();
            $groupUrl   = $baseUrl . $basePath . '/groups/' . $group->id;

            $groupName = $group->name ?? 'Untitled group';

            // Load the group owner's name. Null means "unknown" — the
            // translated fallback is resolved per-admin INSIDE the
            // LocaleContext closure below so it renders in each admin's
            // language, not the dispatching context's (2026-07-09 audit P4).
            $creatorName = null;
            if (!empty($group->owner_id)) {
                $creator = DB::table('users')
                    ->where('id', $group->owner_id)
                    ->where('tenant_id', $event->tenantId)
                    ->select(['first_name', 'last_name', 'profile_type', 'organization_name', 'name'])
                    ->first();
                if ($creator) {
                    $creatorName = UserDisplayName::resolve($creator)
                        ?: ($creator->name ?? null);
                }
            }

            $admins = DB::table('users')
                ->where('tenant_id', $event->tenantId)
                ->whereIn('role', ['super_admin', 'admin', 'tenant_admin', 'broker', 'coordinator'])
                ->where('status', 'active')
                ->select(['id', 'email', 'first_name', 'name', 'preferred_language'])
                ->get();

            if ($admins->isEmpty()) {
                return;
            }

            foreach ($admins as $admin) {
                $adminEmail = $admin->email ?? null;
                if (!$adminEmail) {
                    continue;
                }

                LocaleContext::withLocale($admin, function () use ($admin, $group, $groupName, $groupUrl, $creatorName, $tenantName, $adminEmail, $event) {
                    $adminName = $admin->first_name ?? $admin->name ?? 'Admin';

                    $bellContent = __('emails_misc.admin_notify.new_group_bell', ['name' => $groupName]);
                    Notification::createNotification((int) $admin->id, $bellContent, '/groups/' . $group->id, 'new_group_created');
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($admin->id), 'new_group_created', $bellContent, '/groups/' . $group->id);

                    $subject = __('emails_misc.admin_notify.new_group_subject', ['community' => $tenantName]);

                    $html = EmailTemplateBuilder::make()
                        ->theme('info')
                        ->title(__('emails_misc.admin_notify.new_group_title'))
                        ->previewText(__('emails_misc.admin_notify.new_group_preview', ['community' => $tenantName]))
                        ->greeting($adminName)
                        ->paragraph(__('emails_misc.admin_notify.new_group_body', ['community' => htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8')]))
                        ->highlight(htmlspecialchars($groupName, ENT_QUOTES, 'UTF-8'))
                        ->bulletList([
                            __('emails_misc.admin_notify.new_group_by_label') . ': ' . htmlspecialchars($creatorName ?? __('emails.common.fallback_member_name'), ENT_QUOTES, 'UTF-8'),
                        ])
                        ->button(__('emails_misc.admin_notify.new_group_cta'), $groupUrl)
                        ->render();

                    if (!EmailDispatchService::sendRaw($adminEmail, $subject, $html, null, null, null, 'admin_new_group', ['tenant_id' => $event->tenantId])) {
                        Log::warning('NotifyAdminOfNewGroup: email send failed', ['admin_id' => $admin->id, 'email' => $adminEmail]);
                    }
                });
            }

            // Mark handled only after the full fanout ran, so a redis re-delivery can't re-email admins.
            if ($handledKey !== null) {
                Cache::put($handledKey, 1, now()->addHours(24));
            }
        } catch (\Throwable $e) {
            Log::error('NotifyAdminOfNewGroup listener failed', [
                'group_id'  => $event->group->id ?? null,
                'tenant_id' => $event->tenantId,
                'error'     => $e->getMessage(),
                'trace'     => $e->getTraceAsString(),
            ]);
        } finally {
            if ($claimAcquired && $claimKey !== null) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }
}
