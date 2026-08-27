<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ExchangeRatingService — native DB query builder implementation.
 *
 * Handles post-completion satisfaction ratings for exchange requests.
 * Both parties (requester and provider) can leave a 1–5 star rating
 * with an optional comment. Each user can only rate an exchange once.
 */
class ExchangeRatingService
{
    /**
     * Submit a rating for a completed exchange.
     *
     * @param int         $exchangeId Exchange request ID.
     * @param int         $userId     The user submitting the rating (rater).
     * @param int         $rating     1–5 star rating.
     * @param string|null $comment    Optional review comment.
     * @return array{success: bool, error?: string}
     */
    public function submitRating(int $exchangeId, int $userId, int $rating, ?string $comment = null): array
    {
        $tenantId = TenantContext::getId();

        // Validate rating range
        if ($rating < 1 || $rating > 5) {
            return ['success' => false, 'error' => 'Rating must be between 1 and 5'];
        }

        // Fetch the exchange to verify it exists, is completed, and determine roles
        $exchange = DB::selectOne(
            "SELECT id, requester_id, provider_id, status
             FROM exchange_requests
             WHERE id = ? AND tenant_id = ?",
            [$exchangeId, $tenantId]
        );

        if (!$exchange) {
            return ['success' => false, 'error' => 'Exchange not found'];
        }

        if ($exchange->status !== 'completed') {
            return ['success' => false, 'error' => 'Exchange must be completed before rating'];
        }

        // Determine the rater's role and the rated user
        $requesterId = (int) $exchange->requester_id;
        $providerId = (int) $exchange->provider_id;

        if ($userId === $requesterId) {
            $role = 'requester';
            $ratedId = $providerId;
        } elseif ($userId === $providerId) {
            $role = 'provider';
            $ratedId = $requesterId;
        } else {
            return ['success' => false, 'error' => 'You are not a participant in this exchange'];
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $userId,
            $ratedId,
            (int) $tenantId,
            'exchange_rating',
        );

        // Check if already rated (unique constraint: exchange_id + rater_id)
        $existing = DB::selectOne(
            "SELECT id FROM exchange_ratings WHERE exchange_id = ? AND rater_id = ?",
            [$exchangeId, $userId]
        );

        if ($existing) {
            return ['success' => false, 'error' => 'You have already rated this exchange'];
        }

        try {
            DB::insert(
                "INSERT INTO exchange_ratings (tenant_id, exchange_id, rater_id, rated_id, rating, comment, role, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
                [$tenantId, $exchangeId, $userId, $ratedId, $rating, $comment, $role]
            );
        } catch (\Throwable $e) {
            Log::error('[ExchangeRatingService] submitRating failed: ' . $e->getMessage());
            return ['success' => false, 'error' => 'Failed to submit rating'];
        }

        // Notify the rated user
        try {
            $user = DB::table('users')->where('id', $ratedId)->where('tenant_id', $tenantId)->select(['email', 'first_name', 'name', 'preferred_language'])->first();
            if ($user && !empty($user->email)) {
                LocaleContext::withLocale($user, function () use ($user, $rating, $exchangeId, $ratedId, $tenantId) {
                    $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                    $fullUrl   = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/exchanges/' . $exchangeId;
                    $html = EmailTemplateBuilder::make()
                        ->title(__('emails_misc.exchange_rating.received_title'))
                        ->greeting($firstName)
                        ->paragraph(__('emails_misc.exchange_rating.received_body', ['rating' => $rating]))
                        ->button(__('emails_misc.exchange_rating.received_cta'), $fullUrl)
                        ->render();
                    if (!\App\Services\EmailDispatchService::sendRaw($user->email, __('emails_misc.exchange_rating.received_subject'), $html, null, null, null, 'exchange_rating', ['tenant_id' => $tenantId])) {
                        Log::warning('[ExchangeRatingService] submitRating email failed', ['rated_id' => $ratedId]);
                    }
                });
            }
        } catch (\Throwable $e) {
            Log::warning('[ExchangeRatingService] submitRating email error: ' . $e->getMessage());
        }

        return ['success' => true];
    }

    /**
     * Get all ratings for a specific exchange.
     *
     * @return array<int, array>
     */
    public function getRatingsForExchange(int $exchangeId): array
    {
        $tenantId = TenantContext::getId();

        $rows = DB::select(
            "SELECT er.id, er.exchange_id, er.rater_id, er.rated_id, er.rating, er.comment, er.role, er.created_at,
                    u.first_name AS rater_first_name, u.last_name AS rater_last_name,
 u.profile_type AS rater_profile_type,
 u.organization_name AS rater_organization_name, u.username AS rater_username
             FROM exchange_ratings er
             LEFT JOIN users u ON u.id = er.rater_id
             WHERE er.exchange_id = ? AND er.tenant_id = ?
             ORDER BY er.created_at ASC",
            [$exchangeId, $tenantId]
        );

        return array_map(fn ($row) => (array) $row, $rows);
    }

    /**
     * Check whether a user has already rated a specific exchange.
     */
    public function hasRated(int $exchangeId, int $userId): bool
    {
        $tenantId = TenantContext::getId();

        $row = DB::selectOne(
            "SELECT id FROM exchange_ratings WHERE exchange_id = ? AND rater_id = ? AND tenant_id = ?",
            [$exchangeId, $userId, $tenantId]
        );

        return $row !== null;
    }

    /**
     * Get a user's aggregate rating data (average rating received across all exchanges).
     *
     * @return array{average: float, count: int}
     */
    public function getUserRating(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $row = DB::selectOne(
            "SELECT AVG(rating) AS average, COUNT(*) AS count
             FROM exchange_ratings
             WHERE rated_id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );

        return [
            'average' => $row && $row->average !== null ? round((float) $row->average, 2) : 0.0,
            'count' => $row ? (int) $row->count : 0,
        ];
    }
}
