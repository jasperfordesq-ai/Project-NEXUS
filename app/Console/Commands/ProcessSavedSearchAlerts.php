<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Listing;
use App\Models\Notification;
use App\Services\ListingService;

/**
 * Process saved search alerts — find new listings matching saved searches
 * where notify_on_new is enabled and send notifications to users.
 *
 * Scheduled: hourly via Laravel scheduler.
 */
class ProcessSavedSearchAlerts extends Command
{
    protected $signature = 'listings:process-search-alerts {--tenant= : Specific tenant ID (default: all)}';
    protected $description = 'Check saved searches for new matching listings and notify users';

    public function handle(): int
    {
        $specificTenant = $this->option('tenant');

        if ($specificTenant) {
            $tenantIds = [(int) $specificTenant];
        } else {
            $tenantIds = DB::table('tenants')
                ->where('is_active', true)
                ->pluck('id')
                ->toArray();
        }

        $totalAlerts = 0;
        $totalSearches = 0;
        $previousTenantId = TenantContext::currentId();

        try {
            foreach ($tenantIds as $tenantId) {
                TenantContext::setById($tenantId);

                try {
                    [$alerts, $searches] = $this->processTenantsSearches($tenantId);
                    $totalAlerts += $alerts;
                    $totalSearches += $searches;

                    if ($alerts > 0) {
                        $this->info("Tenant {$tenantId}: {$alerts} alert(s) sent for {$searches} saved search(es).");
                    }
                } catch (\Throwable $e) {
                    Log::error('[ProcessSavedSearchAlerts] Failed for tenant', [
                        'tenant_id' => $tenantId,
                        'error' => $e->getMessage(),
                    ]);
                    $this->error("Tenant {$tenantId}: Error — {$e->getMessage()}");
                }
            }
        } finally {
            // Never leave the caller looking at the last tenant we happened to
            // loop over — same shape as GroupScheduledPostService::publishDue().
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }

        $this->info("Done. Total: {$totalAlerts} alert(s) sent for {$totalSearches} saved search(es).");

        return Command::SUCCESS;
    }

    /**
     * Process all saved searches with notify_on_new for a given tenant.
     *
     * @return array{0: int, 1: int} [alerts_sent, searches_processed]
     */
    private function processTenantsSearches(int $tenantId): array
    {
        $savedSearches = DB::table('saved_searches')
            ->where('tenant_id', $tenantId)
            ->where('notify_on_new', true)
            ->get();

        $alertsSent = 0;
        $searchesProcessed = 0;

        foreach ($savedSearches as $search) {
            try {
                $sent = $this->processSingleSearch($search, $tenantId);
                if ($sent) {
                    $alertsSent++;
                }
                $searchesProcessed++;
            } catch (\Throwable $e) {
                Log::warning('[ProcessSavedSearchAlerts] Failed for saved search', [
                    'saved_search_id' => $search->id,
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
                // Continue processing other saved searches — don't let one failure stop all
            }
        }

        return [$alertsSent, $searchesProcessed];
    }

    /**
     * Process a single saved search — find new matching listings and notify.
     *
     * @return bool True if a notification was sent
     */
    private function processSingleSearch(object $search, int $tenantId): bool
    {
        $queryParams = json_decode($search->query_params, true) ?? [];

        // Determine the cutoff time — only find listings created after this point
        $cutoff = $search->last_notified_at
            ?? $search->last_run_at
            ?? $search->updated_at
            ?? $search->created_at;

        if (!$cutoff) {
            return false;
        }

        // The alert is only for a member whose account is in good standing. A
        // suspended, banned, rejected or deleted member is not notified — same
        // rule, and the same two columns, as EventBroadcastDeliveryConsumer.
        $recipient = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', (int) $search->user_id)
            ->first(['id', 'preferred_language', 'status', 'deleted_at']);

        if ($recipient === null
            || (string) ($recipient->status ?? '') !== 'active'
            || ($recipient->deleted_at ?? null) !== null) {
            return false;
        }

        // Build the query to find new matching listings. The visibility rule is
        // the canonical one every other listing read uses, so the member is never
        // told about listings moderators rejected or have not yet approved.
        $query = ListingService::applyPublicVisibility(Listing::query())
            ->where('tenant_id', $tenantId)
            // A GDPR-erased listing carries deleted_at; it must not be counted.
            ->whereNull('deleted_at')
            ->where('created_at', '>', $cutoff);

        // Apply filters from saved search params
        if (!empty($queryParams['q'])) {
            $searchTerm = '%' . $queryParams['q'] . '%';
            $query->where(function ($q) use ($searchTerm) {
                $q->where('title', 'LIKE', $searchTerm)
                  ->orWhere('description', 'LIKE', $searchTerm);
            });
        }

        if (!empty($queryParams['type']) && in_array($queryParams['type'], ['offer', 'request', 'all'], true)) {
            if ($queryParams['type'] !== 'all') {
                $query->where('type', $queryParams['type']);
            }
        }

        if (!empty($queryParams['category_id'])) {
            $query->where('category_id', (int) $queryParams['category_id']);
        }

        if (!empty($queryParams['category'])) {
            $catId = DB::table('categories')
                ->where('slug', $queryParams['category'])
                ->where('type', 'listing')
                ->where('tenant_id', $tenantId)
                ->value('id');
            if ($catId) {
                $query->where('category_id', $catId);
            }
        }

        if (!empty($queryParams['service_type'])) {
            $query->where('service_type', $queryParams['service_type']);
        }

        $newCount = $query->count();

        if ($newCount === 0) {
            return false;
        }

        $link = '/search?' . http_build_query($queryParams);

        // Render AND send inside the recipient's locale — this runs from an hourly
        // cron worker, which otherwise renders everything in the worker's default.
        LocaleContext::withLocale($recipient, function () use ($search, $newCount, $link, $tenantId): void {
            // The unnamed-search fallback is part of the message, so it belongs
            // inside the recipient's locale too.
            $searchName = htmlspecialchars(
                $search->name ?: __('notifications.saved_search_default_name'),
                ENT_QUOTES,
                'UTF-8'
            );

            $message = $newCount === 1
                ? __('notifications.saved_search_alert_one', ['search' => $searchName])
                : __('notifications.saved_search_alert_many', ['count' => $newCount, 'search' => $searchName]);

            Notification::createNotification(
                userId: (int) $search->user_id,
                message: $message,
                link: $link,
                type: 'saved_search_alert',
                tenantId: $tenantId,
            );
            \App\Services\NotificationDispatcher::fanOutPush((int) ($search->user_id), 'saved_search_alert', $message, $link);
        });

        // Update the saved search timestamps
        DB::table('saved_searches')
            ->where('id', $search->id)
            ->where('tenant_id', $tenantId)
            ->update([
                'last_notified_at' => now(),
                'last_result_count' => $newCount,
                'updated_at' => now(),
            ]);

        return true;
    }
}
