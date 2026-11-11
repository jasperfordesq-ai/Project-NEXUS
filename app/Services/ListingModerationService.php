<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplate;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\ActivityLog;
use App\Models\Listing;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ListingModerationService — QA workflow for listings.
 *
 * When enabled per tenant, new listings enter "pending_review" status.
 * Admins can approve or reject listings through the review queue.
 */
class ListingModerationService
{
    /**
     * Check if listing moderation is enabled for the current tenant.
     */
    public function isModerationEnabled(): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $configured = ListingConfigurationService::get(ListingConfigurationService::CONFIG_MODERATION_ENABLED);
            if (filter_var($configured, FILTER_VALIDATE_BOOLEAN)) {
                return true;
            }

            $legacyValue = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', 'general.listing_moderation_enabled')
                ->value('setting_value');

            return filter_var($legacyValue, FILTER_VALIDATE_BOOLEAN);
        } catch (\Exception $e) {
            Log::warning('[ListingModeration] Failed to check moderation enabled status: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Flag a listing for moderation review.
     */
    public function flag(int $tenantId, int $listingId, int $userId, string $reason): bool
    {
        $listing = Listing::where('id', $listingId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$listing) {
            return false;
        }

        $listing->update([
            'moderation_status' => 'pending_review',
            'rejection_reason' => trim($reason),
        ]);

        return true;
    }

    /**
     * Approve a listing — sets moderation_status to 'approved' and status to 'active'.
     */
    public function approve(int $tenantId, int $listingId, int $adminId): bool
    {
        // Use explicit tenant_id parameter (callers pass it)
        $listing = Listing::where('id', $listingId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$listing) {
            return false;
        }

        $isPendingReview = $listing->moderation_status === 'pending_review';
        $isLegacyPending = $listing->moderation_status === null && $listing->status === 'pending';

        if (! $isPendingReview && ! $isLegacyPending) {
            return false;
        }

        $listing->update([
            'status' => 'active',
            'moderation_status' => 'approved',
            'reviewed_by' => $adminId,
            'reviewed_at' => now(),
            'rejection_reason' => null,
        ]);

        // Record in feed_activity
        try {
            (new \App\Services\FeedActivityService())->recordActivity(
                $tenantId,
                $listing->user_id,
                'listing',
                $listing->id,
                [
                    'title' => $listing->title,
                    'content' => $listing->description,
                    'image_url' => $listing->image_url,
                    'metadata' => ['location' => $listing->location, 'listing_type' => $listing->type ?? 'offer'],
                    'created_at' => date('Y-m-d H:i:s'),
                ]
            );
        } catch (\Exception $e) {
            Log::warning("ListingModerationService::approve feed_activity failed: " . $e->getMessage());
        }

        // Notify owner — render bell message in owner's locale
        $title = htmlspecialchars($listing->title, ENT_QUOTES, 'UTF-8');
        $ownerLang = DB::table('users')
            ->where('id', $listing->user_id)
            ->where('tenant_id', $tenantId)
            ->value('preferred_language');
        LocaleContext::withLocale($ownerLang, function () use ($listing, $title, $listingId, $tenantId) {
            $message = __('emails_listings.listings.approved.notification', ['title' => $title]);
            // Tenant-safe writer (forces the recipient's tenant_id) instead of a
            // raw Notification::create that omitted tenant_id, plus device push
            // for channel parity — this path previously sent a bell only.
            Notification::createNotification(
                (int) $listing->user_id,
                $message,
                "/listings/{$listingId}",
                'listing_approved',
                false,
                (int) $tenantId
            );
            \App\Services\NotificationDispatcher::fanOutPush((int) $listing->user_id, 'listing_approved', $message, "/listings/{$listingId}");
        });

        ActivityLog::log($adminId, 'listing_moderation_approve', "Approved listing #{$listingId}: {$listing->title}");

        return true;
    }

    /**
     * Reject a listing — sets moderation_status to 'rejected' with a reason.
     */
    public function reject(int $tenantId, int $listingId, int $adminId, string $reason = ''): bool
    {
        $listing = Listing::where('id', $listingId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$listing) {
            return false;
        }

        $isPendingReview = $listing->moderation_status === 'pending_review';
        $isLegacyPending = $listing->moderation_status === null && $listing->status === 'pending';

        if (! $isPendingReview && ! $isLegacyPending) {
            return false;
        }

        $reason = trim($reason);
        if (empty($reason)) {
            return false;
        }

        $listing->update([
            'status' => 'rejected',
            'moderation_status' => 'rejected',
            'reviewed_by' => $adminId,
            'reviewed_at' => now(),
            'rejection_reason' => $reason,
        ]);

        // Notify owner (bell) — render message in owner's locale
        $title = htmlspecialchars($listing->title, ENT_QUOTES, 'UTF-8');
        $safeReason = htmlspecialchars($reason, ENT_QUOTES, 'UTF-8');
        $owner = DB::table('users')
            ->where('id', $listing->user_id)
            ->where('tenant_id', $tenantId)
            ->select(['email', 'first_name', 'name', 'preferred_language'])
            ->first();

        LocaleContext::withLocale($owner, function () use ($listing, $title, $safeReason, $listingId) {
            Notification::create([
                'user_id' => $listing->user_id,
                'message' => __('emails_listings.listings.rejected.notification', ['title' => $title, 'reason' => $safeReason]),
                'link' => "/listings/{$listingId}",
                'type' => 'listing_rejected',
                'created_at' => now(),
            ]);
        });

        // Send email notification to listing owner — render in owner's locale
        try {
            if ($owner && !empty($owner->email) && filter_var($owner->email, FILTER_VALIDATE_EMAIL)) {
                LocaleContext::withLocale($owner, function () use ($owner, $listingId, $title, $safeReason, $tenantId) {
                    $ownerName = htmlspecialchars($owner->first_name ?? $owner->name ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
                    $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';
                    $frontendUrl = TenantContext::getFrontendUrl();
                    $basePath = TenantContext::getSlugPrefix();
                    $listingUrl = $frontendUrl . $basePath . "/listings/{$listingId}";

                    $body = "<p>" . __('emails.common.greeting', ['name' => $ownerName]) . "</p>"
                        . "<p>" . __('emails_listings.listings.rejected.body_not_approved', ['title' => $title]) . "</p>"
                        . "<p>" . __('emails_listings.listings.rejected.body_reason', ['reason' => $safeReason]) . "</p>"
                        . "<p>" . __('emails_listings.listings.rejected.body_resubmit') . "</p>";

                    $html = \App\Core\EmailTemplateBuilder::make()
                        ->theme('warning')
                        ->title(__('emails_listings.listings.rejected.heading'))
                        ->paragraph(__('emails_listings.listings.rejected.subheading'))
                        ->paragraph($body)
                        ->button(__('emails_listings.listings.rejected.cta'), $listingUrl)
                        ->render();

                    if (!EmailDispatchService::sendRaw($owner->email, __('emails_listings.listings.rejected.subject'), $html, null, null, null, 'listing_moderation', ['tenant_id' => $tenantId])) {
                        Log::warning("[ListingModerationService] reject email send returned false for user={$owner->id}, listing={$listingId}");
                    }
                });
            }
        } catch (\Exception $e) {
            Log::warning("[ListingModerationService] reject email failed for user={$listing->user_id}, listing={$listingId}: " . $e->getMessage());
        }

        ActivityLog::log($adminId, 'listing_moderation_reject', "Rejected listing #{$listingId}: {$listing->title}. Reason: {$reason}");

        return true;
    }

    /**
     * Get pending listings for the current tenant.
     */
    public function getPending(int $tenantId): array
    {
        return Listing::where('tenant_id', $tenantId)
            ->where('moderation_status', 'pending_review')
            ->orderBy('created_at', 'asc')
            ->get()
            ->toArray();
    }

    /**
     * Reject a listing (admin shorthand without tenantId).
     */
    public function rejectListing(int $id, int $adminId, string $reason = ''): array
    {
        $tenantId = TenantContext::getId();
        $listing = Listing::where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $listing) {
            return ['success' => false, 'error' => __('api.listing_not_found')];
        }

        if (trim($reason) === '') {
            return ['success' => false, 'error' => __('api.listing_reject_reason_required')];
        }

        $success = $this->reject($tenantId, $id, $adminId, $reason);

        return $success
            ? ['success' => true, 'error' => null]
            : ['success' => false, 'error' => __('api.listing_reject_failed')];
    }

    /**
     * Get the review queue with pagination.
     *
     * @return array{items: array, total: int, pages: int}
     */
    public function getReviewQueue(int $page = 1, int $limit = 20, ?string $type = null): array
    {
        $tenantId = TenantContext::getId();
        $offset = ($page - 1) * $limit;

        $query = DB::table('listings as l')
            ->join('users as u', 'l.user_id', '=', 'u.id')
            ->leftJoin('categories as c', 'l.category_id', '=', 'c.id')
            ->where('l.tenant_id', $tenantId)
            ->where('l.moderation_status', 'pending_review');

        if ($type && in_array($type, ['offer', 'request'], true)) {
            $query->where('l.type', $type);
        }

        $total = $query->count();

        $items = (clone $query)
            ->select([
                'l.id', 'l.title', 'l.description', 'l.type', 'l.category_id',
                'l.image_url', 'l.location', 'l.status', 'l.moderation_status',
                'l.created_at', 'l.user_id',
                DB::raw(\App\Support\UserDisplayName::sql('u', 'author_name')),
                'u.avatar_url as author_avatar',
                'u.email as author_email',
                'c.name as category_name',
                'c.color as category_color',
            ])
            ->orderBy('l.created_at', 'asc')
            ->offset($offset)
            ->limit($limit)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();

        return [
            'items' => $items,
            'total' => $total,
            'pages' => (int) ceil($total / $limit),
        ];
    }

    /**
     * Get moderation statistics for the current tenant.
     */
    public function getStats(): array
    {
        $tenantId = TenantContext::getId();

        $result = DB::table('listings')
            ->where('tenant_id', $tenantId)
            ->whereNotNull('moderation_status')
            ->selectRaw("
                COUNT(*) as total,
                SUM(CASE WHEN moderation_status = 'pending_review' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN moderation_status = 'approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN moderation_status = 'rejected' THEN 1 ELSE 0 END) as rejected
            ")
            ->first();

        return [
            'total' => (int) ($result->total ?? 0),
            'pending' => (int) ($result->pending ?? 0),
            'approved' => (int) ($result->approved ?? 0),
            'rejected' => (int) ($result->rejected ?? 0),
            'moderation_enabled' => $this->isModerationEnabled(),
        ];
    }
}
