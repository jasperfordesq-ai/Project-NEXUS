<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Models\Comment;
use App\Models\Connection;
use App\Models\EventRsvp;
use App\Models\FeedPost;
use App\Models\Like;
use App\Models\Listing;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * MemberActivityService — Laravel DI-based service for member activity data.
 *
 * Provides aggregated dashboard data, activity timelines, hours summaries,
 * skills breakdowns, connection stats, and engagement metrics.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class MemberActivityService
{
    /**
     * Get comprehensive dashboard data for a user.
     */
    public function getDashboard(int $userId): array
    {
        return [
            'timeline'         => $this->getTimeline($userId, 20),
            'hours'            => $this->getHours($userId),
            'connections'      => Connection::query()
                ->where(fn (Builder $q) => $q->where('requester_id', $userId)->orWhere('receiver_id', $userId))
                ->where('status', 'accepted')
                ->count(),
            'posts_count'      => FeedPost::query()->where('user_id', $userId)->count(),
        ];
    }

    /**
     * Get comprehensive dashboard data (full version with all sections).
     *
     * F-002 (E-038): exchange detail — who the member exchanged with, the hours
     * of each exchange, monthly hours and the net balance — is private to the
     * member and to their community's admins and brokers. Pass
     * $includeExchangeDetail = false for any other viewer: the timeline then
     * carries no exchange entries, and `hours_summary` / `monthly_hours` are
     * omitted rather than zeroed, so a client cannot mistake "hidden" for
     * "no activity".
     */
    public function getDashboardData(int $userId, bool $includeExchangeDetail = true): array
    {
        $data = [
            'timeline'         => $this->getRecentTimeline($userId, null, 30, $includeExchangeDetail),
            'skills_breakdown' => $this->getSkillsBreakdown($userId),
            'connection_stats' => $this->getConnectionStats($userId),
            'engagement'       => $this->getEngagementMetrics($userId),
        ];

        if ($includeExchangeDetail) {
            $data['hours_summary'] = $this->getHoursSummary($userId);
            $data['monthly_hours'] = $this->getMonthlyHours($userId);
        }

        return $data;
    }

    /**
     * Get recent activity timeline for a user.
     */
    public function getTimeline(int $userId, int $limit = 30): array
    {
        $items = collect();

        // Posts
        $posts = FeedPost::query()
            ->where('user_id', $userId)
            ->select('id', DB::raw("'post' as activity_type"), 'content as description', 'created_at')
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get();
        $items = $items->merge($posts);

        // Transactions
        $txns = Transaction::query()
            ->where(fn (Builder $q) => $q->where('sender_id', $userId)->orWhere('receiver_id', $userId))
            ->where('status', 'completed')
            ->selectRaw(
                "id, CASE WHEN sender_id = ? THEN 'gave_hours' ELSE 'received_hours' END as activity_type, CONCAT(amount, ' hour(s)') as description, created_at",
                [$userId]
            )
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get();
        $items = $items->merge($txns);

        return $items
            ->sortByDesc('created_at')
            ->take($limit)
            ->values()
            ->map(fn ($i) => $i instanceof \Illuminate\Database\Eloquent\Model ? $i->toArray() : (array) $i)
            ->all();
    }

    /**
     * Get recent activity timeline (full version with comments, connections, events).
     */
    public function getRecentTimeline(int $userId, ?int $tenantId = null, int $limit = 30, bool $includeExchanges = true): array
    {
        $items = collect();

        // Posts — only public posts belong in a timeline shown to other members.
        $posts = FeedPost::query()
            ->where('user_id', $userId)
            ->where('visibility', 'public')
            ->select('id', DB::raw("'post' as activity_type"), 'content as description', 'created_at')
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get();
        $items = $items->merge($posts);

        // Transactions with user names — exchange partners and hours, so only
        // for the member themselves or staff (F-002).
        $activityTenantId = \App\Core\TenantContext::getId();
        if ($includeExchanges) {
            $txns = Transaction::query()
                ->leftJoin('users as s', function ($join) use ($activityTenantId) {
                    $join->on('transactions.sender_id', '=', 's.id')->where('s.tenant_id', $activityTenantId);
                })
                ->leftJoin('users as r', function ($join) use ($activityTenantId) {
                    $join->on('transactions.receiver_id', '=', 'r.id')->where('r.tenant_id', $activityTenantId);
                })
                ->where(fn (Builder $q) => $q->where('transactions.sender_id', $userId)->orWhere('transactions.receiver_id', $userId))
                ->where('transactions.status', 'completed')
                ->selectRaw(
                    "transactions.id,
                     CASE WHEN transactions.sender_id = ? THEN 'gave_hours' ELSE 'received_hours' END as activity_type,
                     CONCAT(
                         CASE WHEN transactions.sender_id = ? THEN 'Gave ' ELSE 'Received ' END,
                         transactions.amount, ' hour(s)',
                         CASE WHEN transactions.sender_id = ? THEN CONCAT(' to ', COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, ''))
                              ELSE CONCAT(' from ', COALESCE(s.first_name, ''), ' ', COALESCE(s.last_name, ''))
                         END
                     ) as description,
                     transactions.created_at",
                    [$userId, $userId, $userId]
                )
                ->orderByDesc('transactions.created_at')
                ->limit($limit)
                ->get();
            $items = $items->merge($txns);
        }

        // Comments
        try {
            $comments = Comment::query()
                ->where('user_id', $userId)
                ->select('id', DB::raw("'comment' as activity_type"), DB::raw("SUBSTRING(content, 1, 100) as description"), 'created_at')
                ->orderByDesc('created_at')
                ->limit($limit)
                ->get();
            $items = $items->merge($comments);
        } catch (\Illuminate\Database\QueryException $e) {
            report($e);
        }

        // Connections
        try {
            $connections = Connection::query()
                ->leftJoin('users as u1', function ($join) use ($activityTenantId) {
                    $join->on('connections.requester_id', '=', 'u1.id')->where('u1.tenant_id', $activityTenantId);
                })
                ->leftJoin('users as u2', function ($join) use ($activityTenantId) {
                    $join->on('connections.receiver_id', '=', 'u2.id')->where('u2.tenant_id', $activityTenantId);
                })
                ->where(fn (Builder $q) => $q->where('connections.requester_id', $userId)->orWhere('connections.receiver_id', $userId))
                ->where('connections.status', 'accepted')
                ->selectRaw(
                    "connections.id,
                     'connection' as activity_type,
                     CONCAT('Connected with ',
                         CASE WHEN connections.requester_id = ? THEN CONCAT(u2.first_name, ' ', u2.last_name)
                              ELSE CONCAT(u1.first_name, ' ', u1.last_name)
                         END
                     ) as description,
                     connections.updated_at as created_at",
                    [$userId]
                )
                ->orderByDesc('connections.updated_at')
                ->limit($limit)
                ->get();
            $items = $items->merge($connections);
        } catch (\Illuminate\Database\QueryException $e) {
            report($e);
        }

        // Event RSVPs
        try {
            $events = EventRsvp::query()
                ->join('events as e', 'event_rsvps.event_id', '=', 'e.id')
                ->where('event_rsvps.user_id', $userId)
                ->where('event_rsvps.status', 'going')
                ->select(
                    'event_rsvps.id',
                    DB::raw("'event_rsvp' as activity_type"),
                    DB::raw("CONCAT('RSVP to ', e.title) as description"),
                    'event_rsvps.created_at'
                )
                ->orderByDesc('event_rsvps.created_at')
                ->limit($limit)
                ->get();
            $items = $items->merge($events);
        } catch (\Illuminate\Database\QueryException $e) {
            report($e);
        }

        return $items
            ->sortByDesc('created_at')
            ->take($limit)
            ->values()
            ->map(fn ($i) => $i instanceof \Illuminate\Database\Eloquent\Model ? $i->toArray() : (array) $i)
            ->all();
    }

    /**
     * Get hours given/received summary.
     *
     * @return array{given: float, received: float, balance: float}
     */
    public function getHours(int $userId): array
    {
        $given = (float) Transaction::query()
            ->where('sender_id', $userId)
            ->where('status', 'completed')
            ->sum('amount');

        $received = (float) Transaction::query()
            ->where('receiver_id', $userId)
            ->where('status', 'completed')
            ->sum('amount');

        return [
            'given'    => $given,
            'received' => $received,
            'balance'  => $received - $given,
        ];
    }

    /**
     * Get hours given/received summary (full version with counts).
     *
     * @return array{hours_given: float, hours_received: float, transactions_given: int, transactions_received: int, net_balance: float}
     */
    public function getHoursSummary(int $userId, ?int $tenantId = null): array
    {
        $givenQuery = Transaction::query()
            ->where('sender_id', $userId)
            ->where('status', 'completed');

        $receivedQuery = Transaction::query()
            ->where('receiver_id', $userId)
            ->where('status', 'completed');

        $givenTotal = (float) (clone $givenQuery)->sum('amount');
        $givenCount = (clone $givenQuery)->count();
        $receivedTotal = (float) (clone $receivedQuery)->sum('amount');
        $receivedCount = (clone $receivedQuery)->count();

        return [
            'hours_given'           => round($givenTotal, 1),
            'hours_received'        => round($receivedTotal, 1),
            'transactions_given'    => $givenCount,
            'transactions_received' => $receivedCount,
            'net_balance'           => round($receivedTotal - $givenTotal, 1),
        ];
    }

    /**
     * Get skills offered vs requested breakdown.
     */
    public function getSkillsBreakdown(int $userId, ?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        // Try user_skills table (M1 taxonomy)
        try {
            $skills = DB::table('user_skills as us')
                ->where('us.user_id', $userId)
                ->where('us.tenant_id', $tenantId)
                ->select(['us.skill_name', 'us.is_offering', 'us.is_requesting', 'us.proficiency'])
                ->selectRaw(
                    "(SELECT COUNT(*) FROM skill_endorsements se WHERE se.endorsed_id = ? AND se.skill_name = us.skill_name AND se.tenant_id = ?) as endorsements",
                    [$userId, $tenantId]
                )
                ->orderBy('us.skill_name')
                ->get()
                ->map(fn ($r) => (array) $r)
                ->all();

            if (! empty($skills)) {
                return [
                    'skills'           => $skills,
                    'offering_count'   => count(array_filter($skills, fn ($s) => $s['is_offering'])),
                    'requesting_count' => count(array_filter($skills, fn ($s) => $s['is_requesting'])),
                ];
            }
        } catch (\Exception $e) {
            // user_skills table may not exist yet
        }

        // Fallback: parse legacy skills CSV from users table
        $user = User::query()->where('id', $userId)->value('skills');

        $skillsList = [];
        if (! empty($user)) {
            $skillsList = array_map('trim', explode(',', $user));
        }

        $offers = Listing::query()
            ->where('user_id', $userId)
            ->where('type', 'offer')
            ->where('status', 'active')
            ->count();

        $requests = Listing::query()
            ->where('user_id', $userId)
            ->where('type', 'request')
            ->where('status', 'active')
            ->count();

        return [
            'skills'           => array_map(fn ($s) => [
                'skill_name'   => $s,
                'is_offering'  => true,
                'is_requesting' => false,
                'proficiency'  => null,
                'endorsements' => 0,
            ], $skillsList),
            'offering_count'   => $offers,
            'requesting_count' => $requests,
        ];
    }

    /**
     * Get connection statistics.
     *
     * @return array{total_connections: int, pending_requests: int, groups_joined: int}
     */
    public function getConnectionStats(int $userId, ?int $tenantId = null): array
    {
        $total = Connection::query()
            ->where(fn (Builder $q) => $q->where('requester_id', $userId)->orWhere('receiver_id', $userId))
            ->where('status', 'accepted')
            ->count();

        $pending = Connection::query()
            ->where('receiver_id', $userId)
            ->where('status', 'pending')
            ->count();

        $groups = DB::table('group_members as gm')
            ->join('groups as g', 'gm.group_id', '=', 'g.id')
            ->where('gm.user_id', $userId)
            ->where('gm.tenant_id', TenantContext::getId())
            ->where('g.tenant_id', TenantContext::getId())
            ->where('gm.status', 'active')
            ->where('g.status', GroupStatus::Active->value)
            ->count();

        return [
            'total_connections' => $total,
            'pending_requests'  => $pending,
            'groups_joined'     => $groups,
        ];
    }

    /**
     * Get engagement metrics (posts, comments, likes in last 30 days).
     */
    public function getEngagementMetrics(int $userId, ?int $tenantId = null): array
    {
        $thirtyDaysAgo = Carbon::now()->subDays(30);

        $postsCount = FeedPost::query()
            ->where('user_id', $userId)
            ->where('created_at', '>=', $thirtyDaysAgo)
            ->count();

        $commentsCount = 0;
        try {
            $commentsCount = Comment::query()
                ->where('user_id', $userId)
                ->where('created_at', '>=', $thirtyDaysAgo)
                ->count();
        } catch (\Exception $e) {
            Log::debug('[MemberActivity] Failed to count comments for user ' . $userId . ': ' . $e->getMessage());
        }

        $likesGiven = 0;
        $likesReceived = 0;
        try {
            $likesGiven = Like::query()
                ->where('user_id', $userId)
                ->where('created_at', '>=', $thirtyDaysAgo)
                ->count();

            $likesReceived = Like::query()
                ->join('feed_posts as p', function ($join) {
                    $join->on('likes.target_id', '=', 'p.id')
                        ->where('likes.target_type', '=', 'post');
                })
                ->where('p.user_id', $userId)
                ->where('likes.created_at', '>=', $thirtyDaysAgo)
                ->count();
        } catch (\Exception $e) {
            Log::debug('[MemberActivity] Failed to count likes for user ' . $userId . ': ' . $e->getMessage());
        }

        return [
            'posts_count'    => $postsCount,
            'comments_count' => $commentsCount,
            'likes_given'    => $likesGiven,
            'likes_received' => $likesReceived,
            'period'         => 'last_30_days',
        ];
    }

    /**
     * Get monthly hours given/received for charting (last 12 months).
     */
    public function getMonthlyHours(int $userId, ?int $tenantId = null): array
    {
        $twelveMonthsAgo = Carbon::now()->subMonths(12);

        $given = Transaction::query()
            ->where('sender_id', $userId)
            ->where('status', 'completed')
            ->where('created_at', '>=', $twelveMonthsAgo)
            ->select(DB::raw("DATE_FORMAT(created_at, '%Y-%m') as month"), DB::raw('COALESCE(SUM(amount), 0) as total'))
            ->groupBy('month')
            ->orderBy('month')
            ->pluck('total', 'month')
            ->all();

        $received = Transaction::query()
            ->where('receiver_id', $userId)
            ->where('status', 'completed')
            ->where('created_at', '>=', $twelveMonthsAgo)
            ->select(DB::raw("DATE_FORMAT(created_at, '%Y-%m') as month"), DB::raw('COALESCE(SUM(amount), 0) as total'))
            ->groupBy('month')
            ->orderBy('month')
            ->pluck('total', 'month')
            ->all();

        $months = [];
        for ($i = 11; $i >= 0; $i--) {
            $monthKey = Carbon::now()->subMonths($i)->format('Y-m');
            $label = Carbon::now()->subMonths($i)->format('M Y');
            $months[] = [
                'month'    => $monthKey,
                'label'    => $label,
                'given'    => round((float) ($given[$monthKey] ?? 0), 1),
                'received' => round((float) ($received[$monthKey] ?? 0), 1),
            ];
        }

        return $months;
    }
}
