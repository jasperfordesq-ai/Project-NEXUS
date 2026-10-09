<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\I18n\LocaleContext;
use App\Models\Connection;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\FeedPost;
use App\Models\GroupMember;
use App\Models\Listing;
use App\Models\Review;
use App\Models\Transaction;
use App\Models\User;
use App\Models\VolLog;
use App\Models\UserBadge;
use App\Models\UserStreak;
use App\Support\Wallet\OpeningBalance;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * NexusScoreService — Eloquent-based comprehensive 1000-point scoring system.
 *
 * Score Breakdown:
 * - Community Engagement: 250 points
 * - Contribution Quality: 200 points
 * - Volunteer Hours: 200 points
 * - Platform Activity: 150 points
 * - Badges & Achievements: 100 points
 * - Social Impact: 100 points
 *
 * All queries are tenant-scoped via HasTenantScope trait on models.
 */
class NexusScoreService
{
    public const MAX_ENGAGEMENT = 250;
    public const MAX_QUALITY = 200;
    public const MAX_VOLUNTEER = 200;
    public const MAX_ACTIVITY = 150;
    public const MAX_BADGES = 100;
    public const MAX_IMPACT = 100;

    public function __construct(
        private readonly User $user,
    ) {}

    /**
     * Calculate comprehensive Nexus Score (static methods for backward compat).
     */
    public function calculate(int $tenantId, int $userId): float
    {
        $scoreData = $this->calculateNexusScore($userId, $tenantId);
        return (float) $scoreData['total_score'];
    }

    /**
     * Get score for a user (simple float return).
     */
    public function getScore(int $tenantId, int $userId): ?float
    {
        try {
            return $this->calculate($tenantId, $userId);
        } catch (\Throwable $e) {
            Log::error('NexusScore::getScore error: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Get score breakdown for a user.
     */
    public function getBreakdown(int $tenantId, int $userId): array
    {
        try {
            $scoreData = $this->calculateNexusScore($userId, $tenantId);
            return $scoreData['breakdown'] ?? [];
        } catch (\Throwable $e) {
            Log::error('NexusScore::getBreakdown error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Recalculate scores for all users in a tenant.
     */
    public function recalculateAll(int $tenantId): int
    {
        $users = $this->user->newQuery()
            ->where('tenant_id', $tenantId)
            ->where('is_approved', true)
            ->pluck('id');

        $count = 0;
        foreach ($users as $userId) {
            try {
                $this->calculateNexusScore($userId, $tenantId);
                $count++;
            } catch (\Throwable $e) {
                continue;
            }
        }

        return $count;
    }

    /**
     * Calculate comprehensive Nexus Score for a user.
     */
    public function calculateNexusScore(int $userId, int $tenantId): array
    {
        $engagement = $this->calculateEngagementScore($userId, $tenantId);
        $quality = $this->calculateQualityScore($userId, $tenantId);
        $volunteer = $this->calculateVolunteerScore($userId, $tenantId);
        $activity = $this->calculateActivityScore($userId, $tenantId);
        $badges = $this->calculateBadgeScore($userId, $tenantId);
        $impact = $this->calculateImpactScore($userId, $tenantId);

        $totalScore = $engagement['score'] + $quality['score'] + $volunteer['score']
                    + $activity['score'] + $badges['score'] + $impact['score'];

        $percentile = $this->calculatePercentile($totalScore);
        $tier = $this->calculateTier($totalScore);

        return [
            'total_score' => round($totalScore, 1),
            'max_score'   => 1000,
            'percentage'  => round(($totalScore / 1000) * 100, 1),
            'percentile'  => $percentile,
            'tier'        => $tier,
            'breakdown'   => [
                'engagement' => $engagement,
                'quality'    => $quality,
                'volunteer'  => $volunteer,
                'activity'   => $activity,
                'badges'     => $badges,
                'impact'     => $impact,
            ],
            'insights'       => $this->generateInsights($engagement, $quality, $volunteer, $activity, $badges, $impact, $userId),
            'next_milestone' => $this->getNextMilestone($totalScore),
        ];
    }

    /**
     * Calculate user tier based on total score.
     */
    public function calculateTier(float $score): array
    {
        if ($score >= 900) { return ['name' => 'Legendary', 'color' => '#ffd700', 'icon' => "\xF0\x9F\x91\x91"]; }
        if ($score >= 800) { return ['name' => 'Elite', 'color' => '#c0c0c0', 'icon' => "\xF0\x9F\x92\x8E"]; }
        if ($score >= 700) { return ['name' => 'Expert', 'color' => '#cd7f32', 'icon' => "\xE2\xAD\x90"]; }
        if ($score >= 600) { return ['name' => 'Advanced', 'color' => '#6366f1', 'icon' => "\xF0\x9F\x94\xA5"]; }
        if ($score >= 500) { return ['name' => 'Proficient', 'color' => '#8b5cf6', 'icon' => "\xF0\x9F\x9A\x80"]; }
        if ($score >= 400) { return ['name' => 'Intermediate', 'color' => '#06b6d4', 'icon' => "\xF0\x9F\x92\xAA"]; }
        if ($score >= 300) { return ['name' => 'Developing', 'color' => '#10b981', 'icon' => "\xF0\x9F\x8C\xB1"]; }
        if ($score >= 200) { return ['name' => 'Beginner', 'color' => '#f59e0b', 'icon' => "\xF0\x9F\x8C\x9F"]; }
        return ['name' => 'Novice', 'color' => '#94a3b8', 'icon' => "\xF0\x9F\x8E\xAF"];
    }

    /**
     * Get community-wide statistics.
     */
    public function getCommunityStats(int $tenantId): array
    {
        $userIds = $this->user->newQuery()
            ->where('tenant_id', $tenantId)
            ->where('is_approved', true)
            ->pluck('id')
            ->all();

        $scores = [];
        $tierCounts = [];

        foreach ($userIds as $userId) {
            try {
                $scoreData = $this->calculateNexusScore($userId, $tenantId);
                $scores[] = $scoreData['total_score'];
                $tierName = $scoreData['tier']['name'];
                $tierCounts[$tierName] = ($tierCounts[$tierName] ?? 0) + 1;
            } catch (\Throwable $e) {
                continue;
            }
        }

        $totalUsers = count($scores);
        $averageScore = $totalUsers > 0 ? round(array_sum($scores) / $totalUsers, 1) : 0;

        $allTiers = ['Legendary', 'Elite', 'Expert', 'Advanced', 'Proficient', 'Intermediate', 'Developing', 'Beginner', 'Novice'];
        foreach ($allTiers as $tier) {
            if (! isset($tierCounts[$tier])) {
                $tierCounts[$tier] = 0;
            }
        }

        return [
            'total_users'       => $totalUsers,
            'average_score'     => $averageScore,
            'tier_distribution' => $tierCounts,
        ];
    }

    // =========================================================================
    // PRIVATE SCORE CALCULATION METHODS
    // =========================================================================

    /**
     * Community Engagement Score (250 points max).
     *
     * Opening balances (hours brought in from another timebank by an admin
     * member import) are not exchanges: they earn no credits, connection or
     * active day here.
     */
    private function calculateEngagementScore(int $userId, int $tenantId): array
    {
        $creditsSent = (float) Transaction::where('sender_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('transaction_type', '!=', OpeningBalance::TYPE)
            ->where('status', 'completed')->sum('amount');
        $creditsReceived = (float) Transaction::where('receiver_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('transaction_type', '!=', OpeningBalance::TYPE)
            ->where('status', 'completed')->sum('amount');
        $uniqueConnections = (int) Transaction::where('status', 'completed')
            ->where('tenant_id', $tenantId)
            ->where('transaction_type', '!=', OpeningBalance::TYPE)
            ->where(fn ($q) => $q->where('sender_id', $userId)->orWhere('receiver_id', $userId))
            ->selectRaw('COUNT(DISTINCT CASE WHEN sender_id = ? THEN receiver_id WHEN receiver_id = ? THEN sender_id END) as cnt', [$userId, $userId])
            ->value('cnt');
        $activeDays = (int) Transaction::where('status', 'completed')
            ->where('tenant_id', $tenantId)
            ->where('transaction_type', '!=', OpeningBalance::TYPE)
            ->where(fn ($q) => $q->where('sender_id', $userId)->orWhere('receiver_id', $userId))
            ->selectRaw('COUNT(DISTINCT DATE(created_at)) as cnt')
            ->value('cnt');

        $creditsSentScore = min(80, ($creditsSent / 100) * 80);
        $creditsReceivedScore = min(70, ($creditsReceived / 100) * 70);
        $connectionsScore = min(50, ($uniqueConnections / 25) * 50);
        $diversityScore = min(50, ($activeDays / 100) * 50);

        $totalScore = $creditsSentScore + $creditsReceivedScore + $connectionsScore + $diversityScore;

        return [
            'score'      => round($totalScore, 1),
            'max'        => self::MAX_ENGAGEMENT,
            'percentage' => round(($totalScore / self::MAX_ENGAGEMENT) * 100, 1),
            'details'    => [
                'credits_sent'           => (int) $creditsSent,
                'credits_sent_score'     => round($creditsSentScore, 1),
                'credits_received'       => (int) $creditsReceived,
                'credits_received_score' => round($creditsReceivedScore, 1),
                'unique_connections'     => $uniqueConnections,
                'connections_score'      => round($connectionsScore, 1),
                'active_days'            => $activeDays,
                'diversity_score'        => round($diversityScore, 1),
            ],
        ];
    }

    /**
     * Contribution Quality Score (200 points max).
     */
    private function calculateQualityScore(int $userId, int $tenantId): array
    {
        $avgRating = (float) Review::where('receiver_id', $userId)->where('tenant_id', $tenantId)->avg('rating');
        $reviewCount = (int) Review::where('receiver_id', $userId)->where('tenant_id', $tenantId)->count();
        $positiveReviews = (int) Review::where('receiver_id', $userId)->where('tenant_id', $tenantId)->where('rating', '>=', 4)->count();

        // An imported opening balance is always "completed"; counting it would
        // hand a newly imported member a 100% exchange success rate.
        $totalTxns = Transaction::where('tenant_id', $tenantId)
            ->where('transaction_type', '!=', OpeningBalance::TYPE)
            ->where(fn ($q) => $q->where('sender_id', $userId)->orWhere('receiver_id', $userId))->count();
        $completedTxns = Transaction::where('status', 'completed')
            ->where('tenant_id', $tenantId)
            ->where('transaction_type', '!=', OpeningBalance::TYPE)
            ->where(fn ($q) => $q->where('sender_id', $userId)->orWhere('receiver_id', $userId))->count();

        $successRate = $totalTxns > 0 ? ($completedTxns / $totalTxns) : 0;

        $ratingScore = ($avgRating / 5.0) * 100;
        $reviewScore = min(50, ($positiveReviews / 20) * 50);
        $successScore = $successRate * 50;

        $totalScore = $ratingScore + $reviewScore + $successScore;

        return [
            'score'      => round($totalScore, 1),
            'max'        => self::MAX_QUALITY,
            'percentage' => round(($totalScore / self::MAX_QUALITY) * 100, 1),
            'details'    => [
                'avg_rating'       => round($avgRating, 2),
                'rating_score'     => round($ratingScore, 1),
                'review_count'     => $reviewCount,
                'positive_reviews' => $positiveReviews,
                'review_score'     => round($reviewScore, 1),
                'success_rate'     => round($successRate * 100, 1),
                'success_score'    => round($successScore, 1),
            ],
        ];
    }

    /**
     * Volunteer Hours Score (200 points max).
     */
    private function calculateVolunteerScore(int $userId, int $tenantId): array
    {
        $totalHours = (float) VolLog::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')->sum('hours');
        $volunteerDays = (int) VolLog::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->selectRaw('COUNT(DISTINCT date_logged) as cnt')
            ->value('cnt');
        $daysSpan = (int) VolLog::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->selectRaw('DATEDIFF(MAX(date_logged), MIN(date_logged)) + 1 as span')
            ->value('span');

        $hoursScore = min(150, ($totalHours / 250) * 150);
        $consistency = $daysSpan > 0 ? ($volunteerDays / $daysSpan) : 0;
        $consistencyScore = min(50, $consistency * 50 * 10);

        $totalScore = $hoursScore + $consistencyScore;

        return [
            'score'      => round($totalScore, 1),
            'max'        => self::MAX_VOLUNTEER,
            'percentage' => round(($totalScore / self::MAX_VOLUNTEER) * 100, 1),
            'details'    => [
                'total_hours'       => round($totalHours, 1),
                'hours_score'       => round($hoursScore, 1),
                'volunteer_days'    => $volunteerDays,
                'consistency_rate'  => round($consistency * 100, 1),
                'consistency_score' => round($consistencyScore, 1),
            ],
        ];
    }

    /**
     * Platform Activity Score (150 points max).
     */
    private function calculateActivityScore(int $userId, int $tenantId): array
    {
        $listingCount = Listing::where('user_id', $userId)->where('tenant_id', $tenantId)->where('status', 'active')->count();

        $eventCount = 0;
        try {
            $eventCount = EventRsvp::where('user_id', $userId)->where('tenant_id', $tenantId)->count();
        } catch (\Throwable $e) {
            Log::warning('NexusScore: EventRsvp query failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
        }

        $groupCount = GroupMember::where('user_id', $userId)->where('tenant_id', $tenantId)->where('status', 'active')->count();

        $loginStreak = (int) (UserStreak::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('streak_type', 'login')
            ->value('current_streak') ?? 0);

        $listingScore = min(40, ($listingCount / 20) * 40);
        $eventScore = min(40, ($eventCount / 30) * 40);
        $groupScore = min(35, ($groupCount / 10) * 35);
        $streakScore = min(35, ($loginStreak / 100) * 35);

        $totalScore = $listingScore + $eventScore + $groupScore + $streakScore;

        return [
            'score'      => round($totalScore, 1),
            'max'        => self::MAX_ACTIVITY,
            'percentage' => round(($totalScore / self::MAX_ACTIVITY) * 100, 1),
            'details'    => [
                'listing_count' => $listingCount,
                'listing_score' => round($listingScore, 1),
                'event_count'   => $eventCount,
                'event_score'   => round($eventScore, 1),
                'group_count'   => $groupCount,
                'group_score'   => round($groupScore, 1),
                'login_streak'  => $loginStreak,
                'streak_score'  => round($streakScore, 1),
            ],
        ];
    }

    /**
     * Badge & Achievement Score (100 points max).
     */
    private function calculateBadgeScore(int $userId, int $tenantId): array
    {
        $badges = UserBadge::where('user_id', $userId)->where('tenant_id', $tenantId)->get();

        $rarityWeights = [
            'vol_500h' => 10, 'vol_250h' => 8, 'transaction_50' => 7,
            'diversity_25' => 7, 'membership_annual' => 6, 'level_10' => 6,
            'vol_100h' => 5, 'level_5' => 4, 'default' => 2,
        ];

        $totalBadgeScore = 0;
        $badgeDetails = [];

        foreach ($badges as $badge) {
            $badgeKey = $badge->badge_key ?? '';
            $weight = $rarityWeights[$badgeKey] ?? $rarityWeights['default'];
            $totalBadgeScore += $weight;
            $badgeDetails[] = ['name' => $badge->name, 'key' => $badgeKey, 'weight' => $weight];
        }

        $score = min(100, $totalBadgeScore);

        return [
            'score'      => round($score, 1),
            'max'        => self::MAX_BADGES,
            'percentage' => round(($score / self::MAX_BADGES) * 100, 1),
            'details'    => [
                'badge_count' => $badges->count(),
                'rare_badges' => $badges->filter(function ($b) use ($rarityWeights) {
                    return ($rarityWeights[$b->badge_key ?? ''] ?? 2) >= 6;
                })->count(),
                'badges' => $badgeDetails,
            ],
        ];
    }

    /**
     * Social Impact Score (100 points max).
     */
    private function calculateImpactScore(int $userId, int $tenantId): array
    {
        $postCount = 0;
        try {
            $postCount = FeedPost::where('user_id', $userId)->where('tenant_id', $tenantId)->count();
        } catch (\Throwable $e) {
            Log::warning('NexusScore: FeedPost query failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
        }

        $likesReceived = 0;
        try {
            $likesReceived = (int) DB::table('post_likes')
                ->join('feed_posts', 'post_likes.post_id', '=', 'feed_posts.id')
                ->where('feed_posts.user_id', $userId)
                ->where('feed_posts.tenant_id', $tenantId)
                ->count();
        } catch (\Throwable $e) {
            Log::warning('NexusScore: post_likes query failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
        }

        $contentScore = min(50, ($postCount / 50) * 50);
        $engagementScore = min(50, ($likesReceived / 100) * 50);

        $totalScore = $contentScore + $engagementScore;

        return [
            'score'      => round($totalScore, 1),
            'max'        => self::MAX_IMPACT,
            'percentage' => round(($totalScore / self::MAX_IMPACT) * 100, 1),
            'details'    => [
                'post_count'       => $postCount,
                'content_score'    => round($contentScore, 1),
                'likes_received'   => $likesReceived,
                'engagement_score' => round($engagementScore, 1),
            ],
        ];
    }

    /**
     * Estimate percentile rank based on score.
     */
    private function calculatePercentile(float $userScore): int
    {
        if ($userScore >= 900) { return 99; }
        if ($userScore >= 800) { return 95; }
        if ($userScore >= 700) { return 90; }
        if ($userScore >= 600) { return 80; }
        if ($userScore >= 500) { return 70; }
        if ($userScore >= 400) { return 60; }
        if ($userScore >= 300) { return 50; }
        if ($userScore >= 200) { return 40; }
        if ($userScore >= 100) { return 30; }
        return 20;
    }

    /**
     * Generate personalized insights.
     *
     * Strings are rendered in the scored user's preferred_language when a
     * $userId is provided. Insights are cached as fully-rendered JSON in
     * nexus_score_cache and later surfaced back to the user themselves, so
     * they must resolve under the recipient's locale rather than the HTTP
     * caller's (an admin viewing another user's score would otherwise leak
     * the admin's locale into the cached payload).
     */
    public function generateInsights(array $engagement, array $quality, array $volunteer, array $activity, array $badges, array $impact, ?int $userId = null): array
    {
        $locale = null;
        if ($userId !== null) {
            try {
                $row = DB::table('users')->where('id', $userId)->value('preferred_language');
                if (is_string($row) && $row !== '') {
                    $locale = $row;
                }
            } catch (\Throwable $e) {
                // Fall through — render in the current locale if the lookup fails.
            }
        }

        return LocaleContext::withLocale($locale, function () use ($engagement, $quality, $volunteer, $activity, $badges, $impact) {
            $insights = [];
            $categories = [
                ['name' => 'Engagement', 'data' => $engagement, 'key' => 'engagement'],
                ['name' => 'Quality', 'data' => $quality, 'key' => 'quality'],
                ['name' => 'Volunteer', 'data' => $volunteer, 'key' => 'volunteer'],
                ['name' => 'Activity', 'data' => $activity, 'key' => 'activity'],
                ['name' => 'Badges', 'data' => $badges, 'key' => 'badges'],
                ['name' => 'Impact', 'data' => $impact, 'key' => 'impact'],
            ];

            usort($categories, fn ($a, $b) => $b['data']['percentage'] <=> $a['data']['percentage']);

            $strongest = $categories[0];
            $insights[] = [
                'type'    => 'strength',
                'title'   => __('svc_notifications.nexus_score.strength_title', ['name' => $strongest['name']]),
                'message' => __('svc_notifications.nexus_score.strength_message', ['percentage' => $strongest['data']['percentage'], 'name' => $strongest['name']]),
                'icon'    => "\xF0\x9F\x8F\x86",
            ];

            $weakest = $categories[count($categories) - 1];
            if ($weakest['data']['percentage'] < 50) {
                $tipKeys = [
                    'engagement' => 'tip_engagement',
                    'quality'    => 'tip_quality',
                    'volunteer'  => 'tip_volunteer',
                    'activity'   => 'tip_activity',
                    'badges'     => 'tip_badges',
                    'impact'     => 'tip_impact',
                ];
                $tipKey = $tipKeys[$weakest['key']] ?? 'tip_default';
                $insights[] = [
                    'type'    => 'improvement',
                    'title'   => __('svc_notifications.nexus_score.improvement_title', ['name' => $weakest['name']]),
                    'message' => __('svc_notifications.nexus_score.' . $tipKey),
                    'icon'    => "\xF0\x9F\x92\xA1",
                ];
            }

            if (($engagement['details']['unique_connections'] ?? 0) < 10) {
                $insights[] = [
                    'type'    => 'suggestion',
                    'title'   => __('svc_notifications.nexus_score.suggestion_connect_title'),
                    'message' => __('svc_notifications.nexus_score.suggestion_connect_message'),
                    'icon'    => "\xF0\x9F\xA4\x9D",
                ];
            }

            if (($quality['details']['review_count'] ?? 0) < 5) {
                $insights[] = [
                    'type'    => 'suggestion',
                    'title'   => __('svc_notifications.nexus_score.suggestion_exchanges_title'),
                    'message' => __('svc_notifications.nexus_score.suggestion_exchanges_message'),
                    'icon'    => "\xE2\xAD\x90",
                ];
            }

            return $insights;
        });
    }

    /**
     * Get next milestone.
     */
    public function getNextMilestone(float $currentScore): array
    {
        $milestones = [
            ['score' => 200, 'name' => 'Beginner', 'reward' => 'Unlock profile customization'],
            ['score' => 300, 'name' => 'Developing', 'reward' => 'Unlock advanced search filters'],
            ['score' => 400, 'name' => 'Intermediate', 'reward' => 'Featured in community spotlight'],
            ['score' => 500, 'name' => 'Proficient', 'reward' => 'Unlock priority listing placement'],
            ['score' => 600, 'name' => 'Advanced', 'reward' => 'Mentor badge and mentoring access'],
            ['score' => 700, 'name' => 'Expert', 'reward' => 'Exclusive community events access'],
            ['score' => 800, 'name' => 'Elite', 'reward' => 'VIP support and early feature access'],
            ['score' => 900, 'name' => 'Legendary', 'reward' => 'Hall of Fame recognition'],
        ];

        foreach ($milestones as $milestone) {
            if ($currentScore < $milestone['score']) {
                $remaining = $milestone['score'] - $currentScore;
                return [
                    'target_score'        => $milestone['score'],
                    'name'                => $milestone['name'],
                    'reward'              => $milestone['reward'],
                    'points_remaining'    => round($remaining, 1),
                    'progress_percentage' => round(($currentScore / $milestone['score']) * 100, 1),
                ];
            }
        }

        return [
            'target_score'        => 1000,
            'name'                => 'Maximum Level',
            'reward'              => 'You\'ve achieved everything!',
            'points_remaining'    => 0,
            'progress_percentage' => 100,
        ];
    }
}
