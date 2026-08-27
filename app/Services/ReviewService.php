<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Events\ReviewCreated;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\Review;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use App\Support\UserDisplayName;

/**
 * ReviewService — Laravel DI-based service for review operations.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class ReviewService
{
    public function __construct(
        private readonly Review $review,
    ) {}

    /**
     * Get reviews for a specific user (as receiver) with cursor pagination.
     *
     * @param int   $userId  The user whose reviews to fetch
     * @param array $filters Optional: limit, cursor
     * @return array{items: array, cursor: string|null, has_more: bool, average_rating: float|null, total: int}
     */
    public function getForUser(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = $this->review->newQuery()
            ->withFederated()
            ->with(['reviewer:id,first_name,last_name,avatar_url,organization_name,profile_type'])
            ->where('receiver_id', $userId)
            ->where(function (Builder $q) {
                $q->whereNull('status')
                   ->orWhereIn('status', ['active', 'approved']);
            })
            ->orderByDesc('id');

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                $query->where('id', '<', (int) $cursorId);
            }
        }

        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $nextCursor = $hasMore && $items->isNotEmpty()
            ? base64_encode((string) $items->last()->id)
            : null;

        // Format reviews to match the React contract
        $formatted = $items->map(function (Review $r) {
            $reviewer = $r->reviewer;
            $reviewerName = ($reviewer && $reviewer->profile_type === 'organisation' && $reviewer->organization_name)
                ? $reviewer->organization_name
                : UserDisplayName::resolve($reviewer);

            return [
                'id'           => $r->id,
                'rating'       => $r->rating,
                'comment'      => $r->comment,
                'review_type'  => $r->review_type ?? 'local',
                'is_anonymous' => (bool) ($r->is_anonymous ?? false),
                'reviewer'     => [
                    'id'         => $reviewer?->id,
                    'name'       => ($r->is_anonymous ?? false) ? 'Anonymous' : $reviewerName,
                    'first_name' => ($r->is_anonymous ?? false) ? null : $reviewer?->first_name,
                    'last_name'  => ($r->is_anonymous ?? false) ? null : $reviewer?->last_name,
                    'avatar'     => ($r->is_anonymous ?? false) ? null : $reviewer?->avatar_url,
                    'avatar_url' => ($r->is_anonymous ?? false) ? null : $reviewer?->avatar_url,
                ],
                'created_at' => $r->created_at?->toIso8601String(),
            ];
        })->all();

        // Aggregate stats — include federated reviews so reputation follows the user
        $avgRating = $this->review->newQuery()
            ->withFederated()
            ->where('receiver_id', $userId)
            ->where(function (Builder $q) {
                $q->whereNull('status')->orWhereIn('status', ['active', 'approved']);
            })
            ->avg('rating');

        $total = $this->review->newQuery()
            ->withFederated()
            ->where('receiver_id', $userId)
            ->where(function (Builder $q) {
                $q->whereNull('status')->orWhereIn('status', ['active', 'approved']);
            })
            ->count();

        return [
            'items'          => array_values($formatted),
            'cursor'         => $nextCursor,
            'has_more'       => $hasMore,
            'average_rating' => $avgRating !== null ? round((float) $avgRating, 2) : null,
            'total'          => $total,
        ];
    }

    /**
     * Get reviews WRITTEN BY a specific user (as reviewer) with cursor pagination.
     *
     * Powers the Reviews page "Given" tab. Tenant-scoped via the global
     * TenantScope. Excludes reviews the author has deleted
     * (deleted_by_author_at IS NOT NULL).
     *
     * @param int   $userId  The user whose written reviews to fetch
     * @param array $filters Optional: limit, cursor
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getGivenByUser(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = $this->review->newQuery()
            ->with(['receiver:id,first_name,last_name,avatar_url,organization_name,profile_type'])
            ->where('reviewer_id', $userId)
            ->whereNull('deleted_by_author_at')
            ->orderByDesc('id');

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                $query->where('id', '<', (int) $cursorId);
            }
        }

        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $nextCursor = $hasMore && $items->isNotEmpty()
            ? base64_encode((string) $items->last()->id)
            : null;

        // Format reviews to match the React contract — the `receiver` block
        // describes the member the review is ABOUT.
        $formatted = $items->map(function (Review $r) {
            $receiver = $r->receiver;
            $receiverName = ($receiver && $receiver->profile_type === 'organisation' && $receiver->organization_name)
                ? $receiver->organization_name
                : UserDisplayName::resolve($receiver);

            return [
                'id'          => $r->id,
                'rating'      => $r->rating,
                'comment'     => $r->comment,
                'review_type' => $r->review_type ?? 'local',
                'status'      => $r->status,
                'receiver'    => [
                    'id'         => $receiver?->id,
                    'name'       => $receiverName,
                    'first_name' => $receiver?->first_name,
                    'last_name'  => $receiver?->last_name,
                    'avatar'     => $receiver?->avatar_url,
                    'avatar_url' => $receiver?->avatar_url,
                ],
                'created_at' => $r->created_at?->toIso8601String(),
            ];
        })->all();

        return [
            'items'    => array_values($formatted),
            'cursor'   => $nextCursor,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get the current user's PENDING reviews — completed transactions where the
     * user has not yet reviewed their counterparty.
     *
     * Powers the Reviews page "Pending" tab, the dashboard pending-reviews card,
     * and the review-request email deep link (/reviews/create?transaction_id=…).
     *
     * Returns rows matching the React `PendingReview` contract, where the
     * `receiver_*` fields describe the COUNTERPARTY being reviewed:
     *   { exchange_id, exchange_title, receiver_id, receiver_name,
     *     receiver_avatar, transaction_id, completed_at }
     *
     * @param  array $filters  Optional: limit (default 20, max 100),
     *                         transaction_id (resolve a single transaction).
     * @return array{items: array<int, array<string, mixed>>, meta: array{total: int}}
     */
    public function getPendingReviews(int $userId, array $filters = []): array
    {
        $tenantId = (int) (TenantContext::getId() ?? 0);
        if ($tenantId <= 0 || $userId <= 0) {
            return ['items' => [], 'meta' => ['total' => 0]];
        }

        $limit = min(max((int) ($filters['limit'] ?? 20), 1), 100);
        $onlyTransactionId = isset($filters['transaction_id']) ? (int) $filters['transaction_id'] : null;

        // System credit grants (starting balances, admin grants, community fund)
        // have no peer to review.
        $systemTypes = ['starting_balance', 'admin_grant', 'community_fund'];

        // NOTE: these closures receive an Illuminate\Database\Query\Builder, NOT
        // the Eloquent Builder imported at the top of this file — so they are
        // intentionally left untyped to avoid a TypeError.
        $query = DB::table('transactions as t')
            ->where('t.tenant_id', $tenantId)
            ->where('t.status', 'completed')
            ->whereNotIn('t.transaction_type', $systemTypes)
            ->whereNotNull('t.sender_id')
            ->whereNotNull('t.receiver_id')
            ->whereColumn('t.sender_id', '!=', 't.receiver_id')
            // Current user must be a participant AND must not have hidden the
            // transaction from their own wallet view.
            ->where(function ($w) use ($userId) {
                $w->where(function ($s) use ($userId) {
                    $s->where('t.sender_id', $userId)->where('t.deleted_for_sender', 0);
                })->orWhere(function ($r) use ($userId) {
                    $r->where('t.receiver_id', $userId)->where('t.deleted_for_receiver', 0);
                });
            })
            // Exclude transactions the user has already reviewed (same uniqueness
            // rule create() enforces: one review per reviewer per transaction).
            ->whereNotExists(function ($sub) use ($userId, $tenantId) {
                $sub->selectRaw('1')
                    ->from('reviews as r')
                    ->whereColumn('r.transaction_id', 't.id')
                    ->where('r.tenant_id', $tenantId)
                    ->where('r.reviewer_id', $userId);
            });

        if ($onlyTransactionId !== null) {
            $query->where('t.id', $onlyTransactionId);
        }

        $rows = $query->orderByDesc('t.id')
            ->limit($limit)
            ->get(['t.id', 't.sender_id', 't.receiver_id', 't.description', 't.created_at', 't.updated_at']);

        if ($rows->isEmpty()) {
            return ['items' => [], 'meta' => ['total' => 0]];
        }

        // Resolve each counterparty (the person the review is ABOUT) in one query.
        $counterpartyIds = $rows->map(
            fn ($r) => ((int) $r->sender_id === $userId) ? (int) $r->receiver_id : (int) $r->sender_id
        )->filter()->unique()->values()->all();

        $users = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $counterpartyIds)
            ->whereNotIn('status', ['banned', 'suspended'])
            ->get(['id', 'first_name', 'last_name', 'organization_name', 'profile_type', 'avatar_url'])
            ->keyBy('id');

        $items = [];
        foreach ($rows as $r) {
            $counterpartyId = ((int) $r->sender_id === $userId) ? (int) $r->receiver_id : (int) $r->sender_id;
            $u = $users->get($counterpartyId);
            if ($u === null) {
                continue; // counterparty missing / banned / suspended — nothing to review
            }

            $name = ($u->profile_type === 'organisation' && $u->organization_name)
                ? $u->organization_name
                : UserDisplayName::resolve($u);
            if ($name === '') {
                continue; // no displayable name — skip rather than show a blank prompt
            }

            $description = trim((string) ($r->description ?? ''));

            $items[] = [
                'exchange_id'     => (int) $r->id,
                'exchange_title'  => $description !== '' ? $description : null,
                'receiver_id'     => $counterpartyId,
                'receiver_name'   => $name,
                'receiver_avatar' => $u->avatar_url,
                'transaction_id'  => (int) $r->id,
                'completed_at'    => $r->updated_at ?? $r->created_at,
            ];
        }

        return ['items' => $items, 'meta' => ['total' => count($items)]];
    }

    /**
     * Get review stats (average, total, distribution) for a user.
     *
     * @return array{total: int, average: float, distribution: array}
     */
    public function getStats(int $userId): array
    {
        $baseQuery = fn () => $this->review->newQuery()
            ->withFederated()
            ->where('receiver_id', $userId)
            ->where(function (Builder $q) {
                $q->whereNull('status')->orWhereIn('status', ['active', 'approved']);
            });

        $aggregates = $baseQuery()
            ->selectRaw('COUNT(*) as total, AVG(rating) as average')
            ->first();

        $total   = (int) ($aggregates->total ?? 0);
        $average = $total > 0 ? round((float) ($aggregates->average ?? 0), 2) : 0;

        $distRows = $baseQuery()
            ->selectRaw('rating, COUNT(*) as cnt')
            ->groupBy('rating')
            ->get()
            ->keyBy('rating');

        $distribution = [];
        for ($i = 5; $i >= 1; $i--) {
            $distribution[$i] = (int) ($distRows->get($i)?->cnt ?? 0);
        }

        $positive = ($distribution[5] ?? 0) + ($distribution[4] ?? 0);
        $negative = ($distribution[2] ?? 0) + ($distribution[1] ?? 0);

        return [
            'total'        => $total,
            'average'      => $average,
            'positive'     => $positive,
            'negative'     => $negative,
            'distribution' => $distribution,
        ];
    }

    /**
     * Get a single review by ID.
     */
    public function getById(int $reviewId): ?array
    {
        /** @var Review|null $review */
        $review = $this->review->newQuery()
            ->withFederated()
            ->with([
                'reviewer:id,first_name,last_name,avatar_url,organization_name,profile_type',
                'receiver:id,first_name,last_name,avatar_url,organization_name,profile_type',
            ])
            ->find($reviewId);

        if (! $review) {
            return null;
        }

        return $review->toArray();
    }

    /**
     * Create a new review.
     *
     * @param int   $reviewerId The user creating the review
     * @param array $data       Review data: receiver_id, rating, comment, transaction_id
     * @return array Created review data
     *
     * @throws ValidationException
     * @throws \RuntimeException
     */
    public function create(int $reviewerId, array $data): array
    {
        $receiverId = (int) ($data['receiver_id'] ?? 0);

        // Prevent self-review (check before validation to avoid unnecessary DB queries)
        if ($receiverId > 0 && $reviewerId === $receiverId) {
            throw new \RuntimeException('You cannot review yourself');
        }

        // Tenant-scope the existence checks: a reviewer must not be able to
        // reference a user or transaction from another tenant. Without the
        // scope, `exists:users,id` / `exists:transactions,id` matched rows in
        // ANY tenant, letting a member create a review row that points at a
        // foreign-tenant user or attaches to a foreign-tenant transaction.
        $tenantId = (int) TenantContext::getId();
        validator($data, [
            'receiver_id'    => ['required', 'integer', Rule::exists('users', 'id')->where('tenant_id', $tenantId)],
            'rating'         => 'required|integer|min:1|max:5',
            'comment'        => 'nullable|string|max:2000',
            'transaction_id' => ['nullable', 'integer', Rule::exists('transactions', 'id')->where('tenant_id', $tenantId)],
        ])->validate();

        // A review attached to a transaction must be BETWEEN the two parties of
        // that transaction. Without this, any member could attach a review of
        // anyone to any tenant transaction id — fabricating reviews for exchanges
        // they never took part in, and bypassing the 24h no-transaction throttle
        // below by cycling through transaction ids (review-bombing).
        $transactionId = (int) ($data['transaction_id'] ?? 0);
        if ($transactionId > 0) {
            $txn = DB::table('transactions')
                ->where('id', $transactionId)
                ->where('tenant_id', $tenantId)
                ->first(['sender_id', 'receiver_id']);
            $parties = $txn ? [(int) $txn->sender_id, (int) $txn->receiver_id] : [];
            if (! $txn || ! in_array($reviewerId, $parties, true) || ! in_array($receiverId, $parties, true)) {
                throw new \RuntimeException('You can only review the other party of a transaction you took part in');
            }
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $reviewerId,
            $receiverId,
            $tenantId,
            'local_review',
        );

        // Prevent duplicate reviews for same transaction
        if (! empty($data['transaction_id'])) {
            $exists = $this->review->newQuery()
                ->where('reviewer_id', $reviewerId)
                ->where('transaction_id', $data['transaction_id'])
                ->exists();

            if ($exists) {
                throw new \RuntimeException('You have already reviewed this exchange');
            }
        } else {
            // Without a transaction_id, prevent multiple reviews for the same receiver
            // within a 24-hour window to avoid spam
            $recentExists = $this->review->newQuery()
                ->where('reviewer_id', $reviewerId)
                ->where('receiver_id', $receiverId)
                ->whereNull('transaction_id')
                ->where('created_at', '>=', now()->subDay())
                ->exists();

            if ($recentExists) {
                throw new \RuntimeException('You have already reviewed this member recently');
            }
        }

        $review = $this->review->newInstance([
            'reviewer_id'    => $reviewerId,
            'receiver_id'    => $receiverId,
            'transaction_id' => $data['transaction_id'] ?? null,
            'rating'         => (int) $data['rating'],
            'comment'        => $data['comment'] ?? null,
            'status'         => 'approved',
        ]);

        try {
            $review->save();
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            // A concurrent duplicate submission won the race past the exists()
            // check above — the unique index on (reviewer_id, transaction_id)
            // is the backstop. Surface the same error as the fast-path check
            // so the caller sees one consistent contract (no double XP, no
            // double rating count, no duplicate notifications).
            throw new \RuntimeException('You have already reviewed this exchange');
        }

        $review = $review->fresh(['reviewer', 'receiver']);

        // Fire ReviewCreated so federation listeners can push the review to
        // the receiver's home partner (reputation portability).
        try {
            ReviewCreated::dispatch($review, (int) TenantContext::getId());
        } catch (\Throwable $e) {
            Log::warning('ReviewCreated dispatch failed', [
                'review_id' => $review->id,
                'error' => $e->getMessage(),
            ]);
        }

        $this->notifyReceiver($review);

        return [
            'id'          => $review->id,
            'rating'      => $review->rating,
            'comment'     => $review->comment,
            'receiver_id' => $review->receiver_id,
            'message'     => __('svc_notifications_2.review.submitted_successfully'),
        ];
    }

    private function notifyReceiver(Review $review): void
    {
        if (! empty($review->is_anonymous)) {
            return;
        }

        $receiverId = (int) $review->receiver_id;
        $reviewerId = (int) $review->reviewer_id;

        if ($receiverId <= 0 || $receiverId === $reviewerId) {
            return;
        }

        try {
            $tenantId = (int) (TenantContext::getId() ?: $review->tenant_id);
            $receiver = $review->receiver;
            $reviewer = $review->reviewer;

            if (! $receiver) {
                Log::warning('[ReviewService] receiver missing for review notification', [
                    'review_id' => $review->id,
                    'receiver_id' => $receiverId,
                    'tenant_id' => $tenantId,
                ]);
                return;
            }

            LocaleContext::withLocale($receiver, function () use ($receiver, $reviewer, $review, $receiverId, $tenantId): void {
                $reviewerName = $reviewer->first_name ?? $reviewer->name ?? __('emails.common.fallback_someone');
                $rating = (int) $review->rating;

                Notification::createNotification(
                    $receiverId,
                    __('notifications.review_received_in_app', ['name' => $reviewerName, 'rating' => $rating]),
                    '/reviews',
                    'review',
                    false,
                    $tenantId
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) ($receiverId), 'review', __('notifications.review_received_in_app', ['name' => $reviewerName, 'rating' => $rating]), '/reviews');

                NotificationDispatcher::sendReviewEmail(
                    $receiverId,
                    $reviewerName,
                    $rating,
                    $review->comment
                );
            });
        } catch (\Throwable $e) {
            Log::warning('[ReviewService] review notification failed', [
                'review_id' => $review->id,
                'receiver_id' => $receiverId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Create a review (static entry point).
     *
     * @param int $reviewerId Reviewer user ID
     * @param int $receiverId Receiver user ID
     * @param int $rating Rating (1-5)
     * @param string|null $comment Optional comment
     * @return array|null Created review data or null on failure
     */
    public static function createReview(int $reviewerId, int $receiverId, int $rating, ?string $comment = null): ?array
    {
        try {
            $service = app(self::class);
            return $service->create($reviewerId, [
                'receiver_id' => $receiverId,
                'rating' => $rating,
                'comment' => $comment,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('ReviewService::createReview error: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Delete (soft-hide) a review. Only the reviewer may delete.
     */
    public function delete(int $reviewId): bool
    {
        /** @var Review|null $review */
        $review = $this->review->newQuery()->find($reviewId);

        if (! $review) {
            return false;
        }

        // reviews.status is enum('pending','approved','rejected') — 'hidden'
        // is not in the set and made every reviewer-delete throw. 'rejected'
        // is the soft-hide state all read paths already exclude.
        // deleted_by_author_at distinguishes an author-delete from a
        // moderator-reject so the admin moderation queue can never resurrect
        // a review its author chose to remove.
        $review->status = 'rejected';
        $review->deleted_by_author_at = now();
        $review->save();

        return true;
    }
}
