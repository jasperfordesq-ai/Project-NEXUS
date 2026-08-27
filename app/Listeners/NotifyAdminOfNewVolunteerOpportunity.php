<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\VolunteerOpportunityCreated;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Notifies all admins, brokers, and coordinators when a new volunteer opportunity is posted.
 */
class NotifyAdminOfNewVolunteerOpportunity implements ShouldQueue
{
    /**
     * Fail fast instead of letting redis re-deliver this fanout mid-flight
     * (retry_after=90s). A re-delivery would re-email EVERY admin. $timeout<retry_after
     * plus the Cache idempotency guard keep one event → one fanout.
     */
    public int $tries = 1;
    public int $timeout = 60;

    public function handle(VolunteerOpportunityCreated $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent re-deliveries so the admin
        // fanout (email + bell to every admin) runs exactly once per event.
        $entityId = (int) ($event->opportunity->id ?? 0);
        $tenantId = (int) ($event->tenantId ?? 0);
        $handledKey = null;
        $claimKey = null;
        $claimAcquired = false;
        if ($entityId > 0) {
            $handledKey = 'notify_admin_new_vol_opp:done:' . $tenantId . ':' . $entityId;
            $claimKey = 'notify_admin_new_vol_opp:claim:' . $tenantId . ':' . $entityId;
            if (Cache::has($handledKey)) {
                Log::info('NotifyAdminOfNewVolunteerOpportunity: duplicate fanout suppressed', ['entity_id' => $entityId, 'tenant_id' => $tenantId]);
                return;
            }
            $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
            if (!$claimAcquired) {
                Log::info('NotifyAdminOfNewVolunteerOpportunity: concurrent fanout suppressed', ['entity_id' => $entityId, 'tenant_id' => $tenantId]);
                return;
            }
        }

        try {
            TenantContext::runForTenant((int) $event->tenantId, function () use ($event, $handledKey): void {
                $opportunity = $event->opportunity;
                $tenantName  = TenantContext::get()['name'] ?? __('emails.common.platform_name');
                $baseUrl     = TenantContext::getFrontendUrl();
                $basePath    = TenantContext::getSlugPrefix();
                $oppPath     = '/volunteering/opportunities/' . $opportunity->id;
                $oppUrl      = $baseUrl . $basePath . $oppPath;

                $oppTitle = $opportunity->title ?? __('emails_misc.admin_notify.new_vol_opp_fallback_title');

                // Load the poster's name. vol_opportunities stores the poster in
                // created_by (there is no user_id column), so reading user_id always
                // fell through to the fallback name.
                $posterName = __('emails.common.fallback_member_name');
                if (!empty($opportunity->created_by)) {
                    $poster = DB::table('users')
                        ->where('id', $opportunity->created_by)
                        ->where('tenant_id', $event->tenantId)
                        ->select(['first_name', 'last_name', 'profile_type', 'organization_name', 'name'])
                        ->first();
                    if ($poster) {
                        $posterName = UserDisplayName::resolve($poster)
                            ?: ($poster->name ?? __('emails.common.fallback_member_name'));
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

                    LocaleContext::withLocale($admin, function () use ($admin, $opportunity, $oppTitle, $oppUrl, $oppPath, $posterName, $tenantName, $adminEmail, $event) {
                        $adminName = $admin->first_name ?? $admin->name ?? __('emails.common.fallback_name');

                        $bellContent = __('emails_misc.admin_notify.new_vol_opp_bell', ['title' => $oppTitle]);
                        Notification::createNotification((int) $admin->id, $bellContent, $oppPath, 'new_vol_opp_created');
                        \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $admin->id), 'new_vol_opp_created', $bellContent, $oppPath);

                        $subject = __('emails_misc.admin_notify.new_vol_opp_subject', ['community' => $tenantName]);

                        $html = EmailTemplateBuilder::make()
                            ->theme('info')
                            ->title(__('emails_misc.admin_notify.new_vol_opp_title'))
                            ->previewText(__('emails_misc.admin_notify.new_vol_opp_preview', ['community' => $tenantName]))
                            ->greeting($adminName)
                            ->paragraph(__('emails_misc.admin_notify.new_vol_opp_body', ['community' => htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8')]))
                            ->highlight(htmlspecialchars($oppTitle, ENT_QUOTES, 'UTF-8'))
                            ->bulletList([
                                __('emails_misc.admin_notify.new_vol_opp_by_label') . ': ' . htmlspecialchars($posterName, ENT_QUOTES, 'UTF-8'),
                            ])
                            ->button(__('emails_misc.admin_notify.new_vol_opp_cta'), $oppUrl)
                            ->render();

                        if (!EmailDispatchService::sendRaw($adminEmail, $subject, $html, null, null, null, 'admin_new_volunteer_opportunity', ['tenant_id' => $event->tenantId])) {
                            Log::warning('NotifyAdminOfNewVolunteerOpportunity: email send failed', ['admin_id' => $admin->id, 'email' => $adminEmail]);
                        }
                    });
                }

                // Mark handled only after the full fanout ran, so a redis re-delivery can't re-email admins.
                if ($handledKey !== null) {
                    Cache::put($handledKey, 1, now()->addHours(24));
                }
            });
        } catch (\Throwable $e) {
            Log::error('NotifyAdminOfNewVolunteerOpportunity listener failed', [
                'opportunity_id' => $event->opportunity->id ?? null,
                'tenant_id'      => $event->tenantId,
                'error'          => $e->getMessage(),
                'trace'          => $e->getTraceAsString(),
            ]);
        } finally {
            if ($claimAcquired && $claimKey !== null) {
                Cache::forget($claimKey);
            }
        }
    }
}
