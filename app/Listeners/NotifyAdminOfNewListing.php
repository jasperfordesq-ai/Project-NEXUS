<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\ListingCreated;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * Notifies all admins, brokers, and coordinators when a new listing is posted.
 */
class NotifyAdminOfNewListing implements ShouldQueue
{
    /**
     * Fail fast instead of letting redis re-deliver this fanout mid-flight
     * (retry_after=90s). A re-delivery would re-email EVERY admin. $timeout<retry_after
     * plus the Cache idempotency guard keep one event → one fanout.
     */
    public int $tries = 1;
    public int $timeout = 60;

    public function handle(ListingCreated $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent re-deliveries so the admin
        // fanout (email + bell to every admin) runs exactly once per event.
        $entityId = (int) ($event->listing->id ?? 0);
        $tenantId = (int) ($event->tenantId ?? 0);
        $handledKey = null;
        $claimKey = null;
        $claimAcquired = false;
        if ($entityId > 0) {
            $handledKey = 'notify_admin_new_listing:done:' . $tenantId . ':' . $entityId;
            $claimKey = 'notify_admin_new_listing:claim:' . $tenantId . ':' . $entityId;
            if (Cache::has($handledKey)) {
                Log::info('NotifyAdminOfNewListing: duplicate fanout suppressed', ['entity_id' => $entityId, 'tenant_id' => $tenantId]);
                return;
            }
            $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
            if (!$claimAcquired) {
                Log::info('NotifyAdminOfNewListing: concurrent fanout suppressed', ['entity_id' => $entityId, 'tenant_id' => $tenantId]);
                return;
            }
        }

        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById($event->tenantId);

            $listing    = $event->listing;
            $poster     = $event->user;
            $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';
            $baseUrl    = TenantContext::getFrontendUrl();
            $basePath   = TenantContext::getSlugPrefix();
            $listingUrl = $baseUrl . $basePath . '/listings/' . $listing->id;

            $posterName   = UserDisplayName::resolve($poster)
                ?: ($poster->name ?? __('emails.common.fallback_member_name'));
            $listingTitle = $listing->title ?? 'Untitled';
            $listingType  = ucfirst($listing->type ?? 'listing');

            $admins = DB::table('users')
                ->where('tenant_id', $event->tenantId)
                ->whereIn('role', ['super_admin', 'admin', 'tenant_admin', 'broker', 'coordinator'])
                ->where('status', 'active')
                ->select(['id', 'email', 'first_name', 'name', 'preferred_language'])
                ->get();

            if ($admins->isEmpty()) {
                return;
            }

            $skipEmailFanout = $this->shouldSkipEmailFanoutInLocalDevelopment();

            foreach ($admins as $admin) {
                $adminEmail = $admin->email ?? null;
                if (!$adminEmail) {
                    continue;
                }

                // Each admin's notification renders in THEIR language.
                LocaleContext::withLocale($admin, function () use ($admin, $listing, $listingTitle, $listingType, $listingUrl, $posterName, $tenantName, $adminEmail, $event, $skipEmailFanout) {
                    $adminName = $admin->first_name ?? $admin->name ?? 'Admin';

                    $bellContent = __('emails_misc.admin_notify.new_listing_bell', [
                        'title'  => $listingTitle,
                        'poster' => $posterName,
                    ]);
                    Notification::createNotification((int) $admin->id, $bellContent, '/listings/' . $listing->id, 'new_listing_created');
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($admin->id), 'new_listing_created', $bellContent, '/listings/' . $listing->id);

                    if ($skipEmailFanout) {
                        return;
                    }

                    $subject = __('emails_misc.admin_notify.new_listing_subject', ['community' => $tenantName]);

                    $html = EmailTemplateBuilder::make()
                        ->theme('info')
                        ->title(__('emails_misc.admin_notify.new_listing_title'))
                        ->previewText(__('emails_misc.admin_notify.new_listing_preview', ['community' => $tenantName]))
                        ->greeting($adminName)
                        ->paragraph(__('emails_misc.admin_notify.new_listing_body', ['community' => htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8')]))
                        ->highlight(htmlspecialchars($listingTitle, ENT_QUOTES, 'UTF-8'))
                        ->bulletList([
                            __('emails_misc.admin_notify.new_listing_type_label') . ': ' . $listingType,
                            __('emails_misc.admin_notify.new_listing_by_label') . ': ' . htmlspecialchars($posterName, ENT_QUOTES, 'UTF-8'),
                        ])
                        ->button(__('emails_misc.admin_notify.new_listing_cta'), $listingUrl)
                        ->render();

                    if (!EmailDispatchService::sendRaw($adminEmail, $subject, $html, null, null, null, 'admin_new_listing', ['tenant_id' => $event->tenantId])) {
                        Log::warning('NotifyAdminOfNewListing: email send failed', ['admin_id' => $admin->id, 'email' => $adminEmail]);
                    }
                });
            }

            // Mark handled only after the full fanout ran, so a redis re-delivery can't re-email admins.
            if ($handledKey !== null) {
                Cache::put($handledKey, 1, now()->addHours(24));
            }
        } catch (\Throwable $e) {
            Log::error('NotifyAdminOfNewListing listener failed', [
                'listing_id' => $event->listing->id ?? null,
                'tenant_id'  => $event->tenantId,
                'error'      => $e->getMessage(),
                'trace'      => $e->getTraceAsString(),
            ]);
        } finally {
            if ($claimAcquired && $claimKey !== null) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    private function shouldSkipEmailFanoutInLocalDevelopment(): bool
    {
        if (!app()->environment(['local', 'development', 'testing'])) {
            return false;
        }

        if ((string) config('mail.default') !== 'smtp') {
            return false;
        }

        $host = (string) config('mail.mailers.smtp.host');
        if (!in_array($host, ['127.0.0.1', 'localhost', '::1'], true)) {
            return false;
        }

        $port = (int) config('mail.mailers.smtp.port');
        if ($port <= 0) {
            return false;
        }

        $connection = @fsockopen($host, $port, $errorCode, $errorMessage, 0.2);
        if (is_resource($connection)) {
            fclose($connection);
            return false;
        }

        Log::warning('NotifyAdminOfNewListing: skipped local SMTP email fanout because the configured SMTP server is not reachable', [
            'host' => $host,
            'port' => $port,
            'error_code' => $errorCode ?? null,
            'error' => $errorMessage ?? null,
        ]);

        return true;
    }
}
