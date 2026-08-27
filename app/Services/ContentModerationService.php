<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\ContentModerationQueue;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * ContentModerationService — Laravel DI-based service for content moderation.
 *
 * Manages reported content review, approval, and rejection workflows.
 * All queries are tenant-scoped via HasTenantScope trait on models.
 */
class ContentModerationService
{
    /** Content types that can be moderated */
    public const CONTENT_TYPES = ['post', 'listing', 'event', 'comment', 'group'];

    /** Moderation statuses */
    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_FLAGGED = 'flagged';

    /** Spam patterns for auto-filter */
    public const SPAM_PATTERNS = [
        '/\b(buy now|click here|limited offer|free money|act now)\b/i',
        '/https?:\/\/[^\s]{80,}/',
        '/(.)\1{15,}/',
        '/[A-Z\s]{50,}/',
    ];

    public function __construct(
        private readonly ContentModerationQueue $queue,
    ) {}

    /**
     * Detect spam in content using SPAM_PATTERNS.
     *
     * Returns true if any pattern matches. Used during post creation to
     * flag content for review without blocking submission.
     * (Wired into FeedService::createPost().)
     */
    public static function detectSpam(string $content): bool
    {
        foreach (self::SPAM_PATTERNS as $pattern) {
            if (preg_match($pattern, $content)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get all content moderation items for a tenant with pagination.
     *
     * @return array{items: array, total: int}
     */
    public static function getReports(int $tenantId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $offset = max(0, (int) ($filters['offset'] ?? 0));
        $status = $filters['status'] ?? null;

        $query = ContentModerationQueue::query()
            ->with(['author:id,first_name,last_name,profile_type,organization_name,name,avatar_url', 'reviewer:id,first_name,last_name,profile_type,organization_name,name']);

        if ($status !== null) {
            $query->where('status', $status);
        }

        $total = (clone $query)->count();
        $items = $query->orderByDesc('created_at')
            ->offset($offset)
            ->limit($limit)
            ->get()
            ->map(function (ContentModerationQueue $item) {
                $data = $item->toArray();
                $data['author_name'] = $item->author
                    ? UserDisplayName::resolve($item->author)
                    : null;
                $data['reviewer_name'] = $item->reviewer
                    ? UserDisplayName::resolve($item->reviewer)
                    : null;
                return $data;
            })
            ->all();

        return ['items' => $items, 'total' => $total];
    }

    /**
     * Approve moderation queue item (dismiss the report).
     */
    public static function approve(int $reportId, int $tenantId, int $moderatorId): bool
    {
        return ContentModerationQueue::query()
            ->where('id', $reportId)
            ->where('status', self::STATUS_PENDING)
            ->update([
                'status' => self::STATUS_APPROVED,
                'reviewer_id' => $moderatorId,
                'reviewed_at' => now(),
            ]) > 0;
    }

    /**
     * Reject moderation queue item (take action — hide or remove).
     */
    public static function reject(int $reportId, int $tenantId, int $moderatorId, ?string $reason = null): bool
    {
        return ContentModerationQueue::query()
            ->where('id', $reportId)
            ->where('status', self::STATUS_PENDING)
            ->update([
                'status' => self::STATUS_REJECTED,
                'reviewer_id' => $moderatorId,
                'reviewed_at' => now(),
                'rejection_reason' => $reason,
            ]) > 0;
    }

    /**
     * Get moderation statistics for a tenant.
     */
    public static function getStats(int $tenantId): array
    {
        try {
            $rows = ContentModerationQueue::query()
                ->selectRaw('status, COUNT(*) as count')
                ->groupBy('status')
                ->pluck('count', 'status')
                ->all();
        } catch (\Throwable $e) {
            return ['pending' => 0, 'approved' => 0, 'rejected' => 0, 'flagged' => 0, 'total' => 0];
        }

        return [
            'pending' => (int) ($rows['pending'] ?? 0),
            'approved' => (int) ($rows['approved'] ?? 0),
            'rejected' => (int) ($rows['rejected'] ?? 0),
            'flagged' => (int) ($rows['flagged'] ?? 0),
            'total' => array_sum(array_map('intval', $rows)),
        ];
    }

    /**
     * Get moderation queue with filtering and sorting.
     *
     * @return array{items: array, total: int}
     */
    public static function getQueue(int $tenantId, array $filters = [], int $limit = 50, int $offset = 0): array
    {
        $limit = min(200, max(1, $limit));
        $offset = max(0, $offset);

        $query = ContentModerationQueue::query()
            ->with(['author:id,first_name,last_name,profile_type,organization_name,email,avatar_url', 'reviewer:id,first_name,last_name,profile_type,organization_name']);

        if (!empty($filters['status']) && in_array($filters['status'], [self::STATUS_PENDING, self::STATUS_APPROVED, self::STATUS_REJECTED, self::STATUS_FLAGGED], true)) {
            $query->where('status', $filters['status']);
        }

        if (!empty($filters['content_type']) && in_array($filters['content_type'], self::CONTENT_TYPES, true)) {
            $query->where('content_type', $filters['content_type']);
        }

        if (!empty($filters['search'])) {
            $searchPattern = '%' . $filters['search'] . '%';
            $query->where(function (Builder $q) use ($searchPattern) {
                $q->where('title', 'LIKE', $searchPattern)
                  ->orWhereHas('author', function (Builder $aq) use ($searchPattern) {
                      $aq->where('first_name', 'LIKE', $searchPattern)
                         ->orWhere('last_name', 'LIKE', $searchPattern);
                  });
            });
        }

        $total = (clone $query)->count();

        $items = $query
            ->orderByRaw("CASE status WHEN 'flagged' THEN 1 WHEN 'pending' THEN 2 WHEN 'rejected' THEN 3 WHEN 'approved' THEN 4 END")
            ->orderBy('created_at', 'asc')
            ->offset($offset)
            ->limit($limit)
            ->get()
            ->map(function (ContentModerationQueue $item) {
                return [
                    'id' => $item->id,
                    'content_type' => $item->content_type,
                    'content_id' => (int) $item->content_id,
                    'title' => $item->title,
                    'status' => $item->status,
                    'author' => [
                        'id' => (int) $item->author_id,
                        'name' => $item->author ? UserDisplayName::resolve($item->author) : null,
                        'email' => $item->author->email ?? null,
                        'avatar' => $item->author->avatar_url ?? null,
                    ],
                    'auto_flagged' => (bool) $item->auto_flagged,
                    'flag_reason' => $item->flag_reason,
                    'reviewer' => $item->reviewer_id ? [
                        'id' => (int) $item->reviewer_id,
                        'name' => $item->reviewer ? UserDisplayName::resolve($item->reviewer) : null,
                    ] : null,
                    'reviewed_at' => $item->reviewed_at?->toDateTimeString(),
                    'rejection_reason' => $item->rejection_reason,
                    'created_at' => $item->created_at?->toDateTimeString(),
                    'updated_at' => $item->updated_at?->toDateTimeString(),
                ];
            })
            ->all();

        return ['items' => $items, 'total' => $total];
    }

    /**
     * Review (approve/reject) a moderation queue item.
     *
     * @return array{success: bool, message: string}
     */
    public static function review(int $id, int $tenantId, int $adminId, string $decision, ?string $rejectionReason = null): array
    {
        if (!in_array($decision, [self::STATUS_APPROVED, self::STATUS_REJECTED], true)) {
            return ['success' => false, 'message' => __('svc_notifications_2.moderation.invalid_decision')];
        }

        if ($decision === self::STATUS_REJECTED && empty($rejectionReason)) {
            return ['success' => false, 'message' => __('svc_notifications_2.moderation.rejection_reason_required')];
        }

        $logContext = [
            'moderation_item_id' => $id,
            'tenant_id' => $tenantId,
        ];
        try {
            $outcome = DB::transaction(function () use (
                $id,
                $decision,
                $adminId,
                $rejectionReason,
                $tenantId,
                &$logContext,
            ): array {
                // This first read selects the lock order only. The row is
                // explicitly tenant-scoped and is re-read with FOR UPDATE
                // before any decision is accepted.
                $candidate = ContentModerationQueue::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($id)
                    ->first(['id', 'tenant_id', 'content_type', 'content_id']);
                if ($candidate === null) {
                    return ['outcome' => 'not_found'];
                }

                $logContext['content_type'] = (string) $candidate->content_type;
                $logContext['content_id'] = (int) $candidate->content_id;

                // Events have a two-axis lifecycle, immutable history and an
                // outbox. They must never be changed through the legacy status
                // column. Lock their canonical root before the queue row so
                // every publication/moderation path shares root -> queue order.
                if ($candidate->content_type === 'event') {
                    self::lockEventDecisionRoot(
                        $tenantId,
                        (int) $candidate->content_id,
                    );
                }

                /** @var ContentModerationQueue|null $item */
                $item = ContentModerationQueue::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($id)
                    ->lockForUpdate()
                    ->first();
                if ($item === null
                    || (string) $item->content_type !== (string) $candidate->content_type
                    || (int) $item->content_id !== (int) $candidate->content_id) {
                    return ['outcome' => 'not_found'];
                }
                if (in_array((string) $item->status, [self::STATUS_APPROVED, self::STATUS_REJECTED], true)) {
                    return ['outcome' => 'already_reviewed'];
                }
                if ($item->content_type === 'event' && $item->status !== self::STATUS_PENDING) {
                    return ['outcome' => 'already_reviewed'];
                }

                if ($item->content_type === 'event') {
                    self::applyEventDecision(
                        $item,
                        $decision,
                        $tenantId,
                        $adminId,
                        $rejectionReason,
                    );
                } else {
                    $item->update([
                        'status' => $decision,
                        'reviewer_id' => $adminId,
                        'reviewed_at' => now(),
                        'rejection_reason' => $rejectionReason,
                    ]);
                    self::applyDecision($item, $decision);
                }

                return [
                    'outcome' => 'success',
                    'content_type' => (string) $item->content_type,
                    'content_id' => (int) $item->content_id,
                ];
            }, 3);
        } catch (\Throwable $exception) {
            Log::warning('ContentModerationService::review event lifecycle decision failed', [
                ...$logContext,
                'error' => $exception->getMessage(),
            ]);

            return ['success' => false, 'message' => __('api.invalid_status')];
        }

        if (($outcome['outcome'] ?? null) === 'not_found') {
            return ['success' => false, 'message' => __('svc_notifications_2.moderation.item_not_found')];
        }
        if (($outcome['outcome'] ?? null) === 'already_reviewed') {
            return ['success' => false, 'message' => __('svc_notifications_2.moderation.already_reviewed')];
        }

        return [
            'success' => true,
            'message' => __('svc_notifications_2.moderation.content_decision', ['decision' => $decision]),
            'content_type' => (string) $outcome['content_type'],
            'content_id' => (int) $outcome['content_id'],
        ];
    }

    /**
     * Get moderation settings for a tenant.
     */
    public static function getModerationSettings(int $tenantId): array
    {
        $settings = [
            'enabled' => false,
            'require_post' => false,
            'require_listing' => false,
            'require_event' => false,
            'require_comment' => false,
            'auto_filter' => false,
        ];

        try {
            foreach ($settings as $key => $default) {
                $value = DB::table('tenant_settings')
                    ->where('tenant_id', $tenantId)
                    ->where('setting_key', "moderation.{$key}")
                    ->value('setting_value');
                $settings[$key] = (bool) $value;
            }
        } catch (\Throwable $e) {
            // Use defaults if settings table unavailable
        }

        return $settings;
    }

    /**
     * Update moderation settings for a tenant.
     */
    public static function updateSettings(int $tenantId, array $settings): bool
    {
        $allowedKeys = ['enabled', 'require_post', 'require_listing', 'require_event', 'require_comment', 'auto_filter'];

        try {
            foreach ($allowedKeys as $key) {
                if (isset($settings[$key])) {
                    DB::table('tenant_settings')->updateOrInsert(
                        ['tenant_id' => $tenantId, 'setting_key' => "moderation.{$key}"],
                        ['setting_value' => $settings[$key] ? '1' : '0', 'updated_at' => now()]
                    );
                }
            }
            return true;
        } catch (\Throwable $e) {
            Log::error('ContentModerationService::updateSettings failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Apply moderation decision to the actual content.
     */
    private static function applyDecision(ContentModerationQueue $item, string $decision): void
    {
        $contentType = $item->content_type;
        $contentId = (int) $item->content_id;
        $tenantId = $item->tenant_id;

        try {
            if ($decision === self::STATUS_APPROVED) {
                match ($contentType) {
                    'post' => DB::table('feed_posts')->where('id', $contentId)->where('tenant_id', $tenantId)->update(['is_hidden' => 0]),
                    'listing' => DB::table('listings')->where('id', $contentId)->where('tenant_id', $tenantId)->update(['status' => 'active']),
                    'comment' => DB::table('comments')->where('id', $contentId)->where('tenant_id', $tenantId)->update(['is_hidden' => 0]),
                    default => null,
                };
            } elseif ($decision === self::STATUS_REJECTED) {
                match ($contentType) {
                    'post' => DB::table('feed_posts')->where('id', $contentId)->where('tenant_id', $tenantId)->update(['is_hidden' => 1]),
                    'listing' => DB::table('listings')->where('id', $contentId)->where('tenant_id', $tenantId)->update(['status' => 'rejected']),
                    'comment' => DB::table('comments')->where('id', $contentId)->where('tenant_id', $tenantId)->update(['is_hidden' => 1]),
                    default => null,
                };
            }
        } catch (\Throwable $e) {
            Log::error("ContentModerationService::applyDecision failed for {$contentType} #{$contentId}: " . $e->getMessage());
        }
    }

    /**
     * Lock and revalidate the canonical Event root before a queue-row lock.
     * A concurrent occurrence detach also follows root -> occurrence order, so
     * a changed relationship fails closed instead of reviewing another root.
     */
    private static function lockEventDecisionRoot(int $tenantId, int $eventId): void
    {
        $snapshot = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->first(['id', 'parent_event_id']);
        if ($snapshot === null) {
            throw new \RuntimeException('event_lifecycle_event_not_found');
        }

        $rootId = max(0, (int) ($snapshot->parent_event_id ?? 0)) ?: $eventId;
        $root = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $rootId)
            ->lockForUpdate()
            ->first(['id']);
        $target = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->lockForUpdate()
            ->first(['id', 'parent_event_id']);
        $currentRootId = $target === null
            ? 0
            : (max(0, (int) ($target->parent_event_id ?? 0)) ?: (int) $target->id);
        if ($root === null || $target === null || $currentRootId !== $rootId) {
            throw new \RuntimeException('event_lifecycle_concurrent_root_changed');
        }
    }

    private static function applyEventDecision(
        ContentModerationQueue $item,
        string $decision,
        int $tenantId,
        int $adminId,
        ?string $rejectionReason,
    ): void {
        /** @var User|null $actor */
        $actor = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($adminId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first();
        if ($actor === null) {
            throw new \RuntimeException('event_lifecycle_authorization_denied');
        }

        $workflow = app(EventPublicationWorkflowService::class);
        if ($decision === self::STATUS_APPROVED) {
            $workflow->approveModerationDecision((int) $item->content_id, $actor);
            return;
        }

        $workflow->rejectModerationDecision(
            (int) $item->content_id,
            $actor,
            trim((string) $rejectionReason),
        );
    }
}
