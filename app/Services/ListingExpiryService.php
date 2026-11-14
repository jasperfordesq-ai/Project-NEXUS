<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\ActivityLog;
use App\Models\Listing;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ListingExpiryService — auto-expiry and renewal workflow for listings.
 *
 * Handles:
 * - Processing expired listings (marking them as 'expired')
 * - One-click renewal (extends expiry by 30 days)
 * - Renewal tracking (renewed_at, renewal_count)
 */
class ListingExpiryService
{
    private const RENEWAL_DAYS = 30;
    private const MAX_RENEWALS = 12;

    /**
     * Process all expired listings for the current tenant.
     *
     * @return array{expired: int, errors: int}
     */
    public function processExpiredListings(): array
    {
        $tenantId = TenantContext::getId();
        $expired = 0;
        $errors = 0;

        try {
            $listings = Listing::where('tenant_id', $tenantId)
                ->where(function ($q) {
                    $q->whereNull('status')->orWhere('status', 'active');
                })
                ->whereNotNull('expires_at')
                ->where('expires_at', '<=', now())
                ->select(['id', 'title', 'type', 'user_id', 'expires_at'])
                ->get();
        } catch (\Exception $e) {
            Log::error("[ListingExpiryService] Query error: " . $e->getMessage());
            return ['expired' => 0, 'errors' => 1];
        }

        foreach ($listings as $listing) {
            try {
                $listing->update(['status' => 'expired']);

                $title = htmlspecialchars($listing->title, ENT_QUOTES, 'UTF-8');
                $listingLink = "/listings/{$listing->id}";

                // Fetch owner once including preferred_language so notification + email
                // both render in the owner's language (cron default = 'en' otherwise).
                $ownerRow = DB::table('users')
                    ->where('id', $listing->user_id)
                    ->where('tenant_id', $tenantId)
                    ->select(['first_name', 'name', 'email', 'preferred_language'])
                    ->first();

                LocaleContext::withLocale($ownerRow, function () use ($listing, $title, $listingLink, $ownerRow, $tenantId) {
                    Notification::create([
                        'user_id' => $listing->user_id,
                        'message' => __('emails_listings.listings.expired.notification', ['title' => $title]),
                        'link' => $listingLink,
                        'type' => 'listing_expired',
                        'created_at' => now(),
                    ]);

                    // Send email notification to listing owner
                    try {
                        if ($ownerRow && !empty($ownerRow->email) && filter_var($ownerRow->email, FILTER_VALIDATE_EMAIL)) {
                            $ownerName = htmlspecialchars($ownerRow->first_name ?? $ownerRow->name ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
                            $frontendUrl = TenantContext::getFrontendUrl();
                            $basePath = TenantContext::getSlugPrefix();
                            $listingUrl = $frontendUrl . $basePath . $listingLink;

                            $body = "<p>" . __('emails.common.greeting', ['name' => $ownerName]) . "</p>"
                                . "<p>" . __('emails_listings.listings.expired.body_expired', ['title' => $title]) . "</p>"
                                . "<p>" . __('emails_listings.listings.expired.body_renew') . "</p>";

                            $html = \App\Core\EmailTemplateBuilder::make()
                                ->theme('brand')
                                ->title(__('emails_listings.listings.expired.heading'))
                                ->paragraph(__('emails_listings.listings.expired.subheading'))
                                ->paragraph($body)
                                ->button(__('emails_listings.listings.expired.cta'), $listingUrl)
                                ->render();

                            if (!EmailDispatchService::sendRaw($ownerRow->email, __('emails_listings.listings.expired.subject'), $html, null, null, null, 'listing_expiry', ['tenant_id' => $tenantId])) {
                                Log::warning("[ListingExpiryService] Email send returned false for user={$listing->user_id}, listing={$listing->id}");
                            }
                        }
                    } catch (\Exception $e) {
                        Log::warning("[ListingExpiryService] Email send failed for user={$listing->user_id}, listing={$listing->id}: " . $e->getMessage());
                    }
                });

                $expired++;
            } catch (\Exception $e) {
                Log::error("[ListingExpiryService] Failed to expire listing {$listing->id}: " . $e->getMessage());
                $errors++;
            }
        }

        return ['expired' => $expired, 'errors' => $errors];
    }

    /**
     * Process expired listings across ALL tenants (for cron job).
     *
     * @return array{total_expired: int, total_errors: int, tenants_processed: int}
     */
    public function processAllTenants(): array
    {
        $totalExpired = 0;
        $totalErrors = 0;
        $tenantsProcessed = 0;

        try {
            $tenantIds = DB::table('tenants')
                ->where('is_active', 1)
                ->pluck('id');
        } catch (\Exception $e) {
            Log::error("[ListingExpiryService] Failed to fetch tenants: " . $e->getMessage());
            return ['total_expired' => 0, 'total_errors' => 1, 'tenants_processed' => 0];
        }

        $previousTenantId = TenantContext::currentId();
        try {
            foreach ($tenantIds as $tenantId) {
                try {
                    \App\Core\TenantContext::setById($tenantId);
                    $result = $this->processExpiredListings();
                    $totalExpired += $result['expired'];
                    $totalErrors += $result['errors'];
                    $tenantsProcessed++;
                } catch (\Exception $e) {
                    Log::error("[ListingExpiryService] Error processing tenant {$tenantId}: " . $e->getMessage());
                    $totalErrors++;
                }
            }
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }

        return [
            'total_expired' => $totalExpired,
            'total_errors' => $totalErrors,
            'tenants_processed' => $tenantsProcessed,
        ];
    }

    /**
     * Renew a listing (extend expiry by RENEWAL_DAYS).
     *
     * @return array{success: bool, error: string|null, error_code?: string|null, new_expires_at: string|null}
     */
    public function renewListing(int $listingId, int $userId): array
    {
        $tenantId = TenantContext::getId();

        $listing = Listing::where('tenant_id', $tenantId)
            ->where('id', $listingId)
            ->first();

        if (!$listing) {
            return ['success' => false, 'error' => __('api.listing_not_found'), 'error_code' => 'not_found', 'new_expires_at' => null];
        }

        // Authorization: owner or admin
        if ((int) $listing->user_id !== $userId) {
            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->select(['role', 'is_super_admin', 'is_tenant_super_admin'])
                ->first();

            if (!$user || (!in_array($user->role, ['admin', 'tenant_admin']) && !$user->is_super_admin && !$user->is_tenant_super_admin)) {
                return ['success' => false, 'error' => __('api.listing_renew_forbidden'), 'error_code' => 'forbidden', 'new_expires_at' => null];
            }
        }

        // Check renewal limit
        $currentCount = (int) ($listing->renewal_count ?? 0);
        if ($currentCount >= self::MAX_RENEWALS) {
            return ['success' => false, 'error' => __('api.listing_renewal_limit_reached', ['max' => self::MAX_RENEWALS]), 'error_code' => 'limit_reached', 'new_expires_at' => null];
        }

        // Calculate new expiry date
        if ($listing->status === 'active' && $listing->expires_at && $listing->expires_at > now()) {
            $baseDate = $listing->expires_at;
        } else {
            $baseDate = now();
        }

        $newExpiresAt = $baseDate->copy()->addDays(self::RENEWAL_DAYS)->format('Y-m-d H:i:s');

        // Set + save instead of DB::raw('renewal_count + 1'): the raw expression
        // conflicts with the 'renewal_count' => 'integer' cast in Listing::$casts.
        $listing->status = 'active';
        $listing->expires_at = $newExpiresAt;
        $listing->renewed_at = now();
        $listing->renewal_count = $currentCount + 1;
        $listing->save();

        // Log activity
        try {
            ActivityLog::log(
                $userId,
                'listing_renewed',
                "Renewed listing #{$listingId}: " . ($listing->title ?? 'Unknown')
            );
        } catch (\Exception $e) {
            // Non-critical
        }

        return [
            'success' => true,
            'error' => null,
            'error_code' => null,
            'new_expires_at' => $newExpiresAt,
        ];
    }

    /**
     * Set expiry date for a listing.
     */
    public function setExpiry(int $listingId, ?string $expiresAt): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $affected = Listing::where('id', $listingId)
                ->where('tenant_id', $tenantId)
                ->update(['expires_at' => $expiresAt]);

            return $affected > 0;
        } catch (\Exception $e) {
            Log::error("[ListingExpiryService] setExpiry error: " . $e->getMessage());
            return false;
        }
    }
}
