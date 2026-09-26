<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Exceptions\SafeguardingPolicyException;
use App\Exceptions\ScheduledPublicationRejected;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

/**
 * Lease-backed, exactly-once scheduled group content publishing.
 */
final class GroupScheduledPostService
{
    public const ERROR_IDEMPOTENCY_INVALID = 'idempotency_invalid';
    public const ERROR_IDEMPOTENCY_CONFLICT = 'idempotency_conflict';

    private const MAX_ATTEMPTS = 5;
    private const LEASE_SECONDS = 180;
    private const MAX_BATCH = 100;

    /** @var list<int> */
    private const RETRY_BACKOFF_SECONDS = [60, 300, 900, 3600];

    /** @var list<string> */
    private const POST_TYPES = ['discussion', 'announcement'];

    /** @var list<string> */
    private const RECURRENCE_PATTERNS = ['daily', 'weekly', 'monthly'];

    public static function schedule(int $groupId, int $userId, array $data): int
    {
        $tenantId = (int) TenantContext::getId();
        if (!GroupAccessService::canIntegrate($groupId, $userId)) {
            throw new AuthorizationException(__('api.group_admin_required'));
        }
        if (!TenantContext::hasFeature('groups')) {
            throw new AuthorizationException(__('api.group_scheduled_feature_disabled'));
        }

        $postType = is_string($data['post_type'] ?? null) ? (string) $data['post_type'] : 'discussion';
        if (!in_array($postType, self::POST_TYPES, true)) {
            throw new InvalidArgumentException(__('api.group_scheduled_invalid_payload'));
        }
        $requiredTab = $postType === 'announcement' ? 'announcements' : 'discussion';
        if (!GroupConfigurationService::isTabEnabled($requiredTab)) {
            throw new AuthorizationException(__('api.group_scheduled_feature_disabled'));
        }

        $title = is_string($data['title'] ?? null) ? trim((string) $data['title']) : '';
        $content = is_string($data['content'] ?? null) ? trim((string) $data['content']) : '';
        if ($title === '' || $content === '' || mb_strlen($title) > 255 || strlen($content) > 60000) {
            throw new InvalidArgumentException(__('api.group_scheduled_invalid_payload'));
        }

        try {
            $scheduledAt = Carbon::parse((string) ($data['scheduled_at'] ?? ''));
        } catch (Throwable) {
            throw new InvalidArgumentException(__('api.group_scheduled_date_invalid'));
        }
        if ($scheduledAt->lte(now())) {
            throw new InvalidArgumentException(__('api.group_scheduled_date_invalid'));
        }

        $isRecurring = self::parseStrictBoolean($data['is_recurring'] ?? false);
        if ($isRecurring === null) {
            throw new InvalidArgumentException(__('api.group_scheduled_invalid_payload'));
        }
        $recurrencePattern = $data['recurrence_pattern'] ?? null;
        if (
            $isRecurring
            && (!is_string($recurrencePattern) || !in_array($recurrencePattern, self::RECURRENCE_PATTERNS, true))
        ) {
            throw new InvalidArgumentException(__('api.group_scheduled_recurrence_invalid'));
        }
        if (!$isRecurring) {
            $recurrencePattern = null;
        }

        $identity = GroupContentCreationReceiptService::identity($data['idempotency_key'] ?? null, [
            'content' => $content,
            'group_id' => $groupId,
            'is_recurring' => $isRecurring,
            'post_type' => $postType,
            'recurrence_pattern' => $recurrencePattern,
            'scheduled_at' => $scheduledAt->toIso8601String(),
            'title' => $title,
        ]);
        if ($identity === false) {
            throw new InvalidArgumentException(self::ERROR_IDEMPOTENCY_INVALID);
        }

        if ($identity !== null) {
            $replayedId = DB::transaction(static function () use ($tenantId, $userId, $identity): int|null {
                GroupContentCreationReceiptService::lockActor($tenantId, $userId);
                $receipt = GroupContentCreationReceiptService::find(
                    $tenantId,
                    $userId,
                    'scheduled_post',
                    $identity['key_hash'],
                );
                if ($receipt === null) {
                    return null;
                }
                if (! GroupContentCreationReceiptService::matches($receipt, $identity['request_hash'])) {
                    throw new DomainException(self::ERROR_IDEMPOTENCY_CONFLICT);
                }
                return (int) $receipt->result_id;
            }, 3);
            if ($replayedId !== null) {
                if (! self::exists($groupId, $replayedId)) {
                    throw new RuntimeException('Scheduled post replay target is unavailable.');
                }
                return $replayedId;
            }
        }

        GroupService::assertSafeguardingBroadcastAllowed(
            $groupId,
            $userId,
            $tenantId,
            'group_scheduled_post_create',
            $title . ' ' . $content,
        );

        return DB::transaction(static function () use (
            $tenantId,
            $groupId,
            $userId,
            $postType,
            $title,
            $content,
            $isRecurring,
            $recurrencePattern,
            $scheduledAt,
            $identity,
        ): int {
            if ($identity !== null) {
                GroupContentCreationReceiptService::lockActor($tenantId, $userId);
                $receipt = GroupContentCreationReceiptService::find(
                    $tenantId,
                    $userId,
                    'scheduled_post',
                    $identity['key_hash'],
                );
                if ($receipt !== null) {
                    if (! GroupContentCreationReceiptService::matches($receipt, $identity['request_hash'])) {
                        throw new DomainException(self::ERROR_IDEMPOTENCY_CONFLICT);
                    }
                    return (int) $receipt->result_id;
                }
            }

            $postId = (int) DB::table('group_scheduled_posts')->insertGetId([
                'tenant_id' => $tenantId,
                'group_id' => $groupId,
                'user_id' => $userId,
                'post_type' => $postType,
                'title' => $title,
                'content' => $content,
                'is_recurring' => $isRecurring,
                'recurrence_pattern' => $recurrencePattern,
                'scheduled_at' => $scheduledAt,
                'status' => 'scheduled',
                'attempt_count' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            if ($identity !== null) {
                GroupContentCreationReceiptService::store(
                    $tenantId,
                    $userId,
                    $groupId,
                    'scheduled_post',
                    $identity,
                    $postId,
                    ['id' => $postId],
                );
            }

            return $postId;
        }, 3);
    }

    private static function exists(int $groupId, int $postId): bool
    {
        return DB::table('group_scheduled_posts')
            ->where('tenant_id', (int) TenantContext::getId())
            ->where('group_id', $groupId)
            ->where('id', $postId)
            ->exists();
    }

    public static function getScheduled(int $groupId): array
    {
        $tenantId = (int) TenantContext::getId();

        return DB::table('group_scheduled_posts as sp')
            ->join('users as u', function ($join): void {
                $join->on('sp.user_id', '=', 'u.id')
                    ->on('sp.tenant_id', '=', 'u.tenant_id');
            })
            ->where('sp.group_id', $groupId)
            ->where('sp.tenant_id', $tenantId)
            ->whereIn('sp.status', ['scheduled', 'processing'])
            ->select('sp.*', 'u.name as author_name')
            ->orderBy('sp.scheduled_at')
            ->orderBy('sp.id')
            ->get()
            ->map(static function (object $row): array {
                $serialized = (array) $row;
                $serialized['scheduled_at'] = Carbon::parse(
                    (string) $row->scheduled_at,
                    (string) config('app.timezone', 'UTC'),
                )->utc()->toIso8601String();

                return $serialized;
            })
            ->all();
    }

    public static function cancel(int $groupId, int $postId, int $actorId): bool
    {
        $tenantId = (int) TenantContext::getId();

        return DB::transaction(function () use ($groupId, $postId, $actorId, $tenantId): bool {
            $post = DB::table('group_scheduled_posts')
                ->where('id', $postId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'scheduled')
                ->lockForUpdate()
                ->first(['id', 'user_id', 'post_type', 'scheduled_at', 'status']);
            if ($post === null) {
                return false;
            }

            $updated = DB::table('group_scheduled_posts')
                ->where('id', $postId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'scheduled')
                ->update([
                'status' => 'cancelled',
                'claim_token' => null,
                'lease_expires_at' => null,
                'updated_at' => now(),
                ]);
            if ($updated !== 1) {
                return false;
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_SCHEDULED_POST_CANCELLED,
                $groupId,
                $actorId,
                [
                    'scheduled_post_id' => $postId,
                    'post_type' => (string) $post->post_type,
                    'scheduled_at' => (string) $post->scheduled_at,
                    'target_user_id' => (int) $post->user_id,
                ],
            );

            return true;
        });
    }

    /**
     * Claim and publish a bounded batch. Content creation and the published
     * marker commit in the same outer transaction, making retry exactly-once.
     */
    public static function publishDue(int $limit = self::MAX_BATCH): int
    {
        $previousTenantId = TenantContext::currentId();
        $published = 0;

        try {
            foreach (self::claimDue($limit) as $claim) {
                if (self::publishClaim($claim)) {
                    $published++;
                }
            }
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }

        return $published;
    }

    /**
     * @return list<array{id:int,tenant_id:int,claim_token:string}>
     */
    public static function claimDue(int $limit = self::MAX_BATCH): array
    {
        $limit = max(1, min($limit, self::MAX_BATCH));

        return DB::transaction(function () use ($limit): array {
            $now = now();

            DB::table('group_scheduled_posts')
                ->where('status', 'processing')
                ->where('lease_expires_at', '<=', $now)
                ->where('attempt_count', '>=', self::MAX_ATTEMPTS)
                ->update([
                    'status' => 'failed',
                    'claim_token' => null,
                    'lease_expires_at' => null,
                    'last_error_code' => 'LEASE_EXHAUSTED',
                    'last_error_message' => 'Worker lease expired after the final attempt.',
                    'updated_at' => $now,
                ]);

            DB::table('group_scheduled_posts')
                ->where('status', 'processing')
                ->where('lease_expires_at', '<=', $now)
                ->where('attempt_count', '<', self::MAX_ATTEMPTS)
                ->update([
                    'status' => 'scheduled',
                    'next_attempt_at' => $now,
                    'claim_token' => null,
                    'lease_expires_at' => null,
                    'last_error_code' => 'LEASE_EXPIRED',
                    'last_error_message' => 'A previous worker lease expired before completion.',
                    'updated_at' => $now,
                ]);

            $rows = DB::table('group_scheduled_posts')
                ->where('status', 'scheduled')
                ->where('scheduled_at', '<=', $now)
                ->where('attempt_count', '<', self::MAX_ATTEMPTS)
                ->where(function ($retry) use ($now): void {
                    $retry->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', $now);
                })
                ->orderBy('scheduled_at')
                ->orderBy('id')
                ->limit($limit)
                ->lock('FOR UPDATE SKIP LOCKED')
                ->get(['id', 'tenant_id', 'attempt_count']);

            $claims = [];
            foreach ($rows as $row) {
                $token = (string) Str::uuid();
                DB::table('group_scheduled_posts')
                    ->where('id', (int) $row->id)
                    ->where('tenant_id', (int) $row->tenant_id)
                    ->where('status', 'scheduled')
                    ->update([
                        'status' => 'processing',
                        'claim_token' => $token,
                        'claimed_at' => $now,
                        'lease_expires_at' => $now->copy()->addSeconds(self::LEASE_SECONDS),
                        'attempt_count' => (int) $row->attempt_count + 1,
                        'next_attempt_at' => null,
                        'updated_at' => $now,
                    ]);
                $claims[] = [
                    'id' => (int) $row->id,
                    'tenant_id' => (int) $row->tenant_id,
                    'claim_token' => $token,
                ];
            }

            return $claims;
        });
    }

    /** @param array{id:int,tenant_id:int,claim_token:string} $claim */
    private static function publishClaim(array $claim): bool
    {
        $tenantExists = DB::table('tenants')
            ->where('id', $claim['tenant_id'])
            ->where('is_active', true)
            ->exists();
        if (!$tenantExists) {
            self::failClaim($claim, 'TENANT_UNAVAILABLE', 'The scheduled tenant is no longer active.', true);

            return false;
        }

        try {
            return (bool) TenantContext::runForTenant(
                $claim['tenant_id'],
                static fn (): bool => self::publishClaimForTenant($claim),
            );
        } catch (ScheduledPublicationRejected $exception) {
            self::failClaim($claim, $exception->failureCode, $exception->getMessage(), true);
        } catch (SafeguardingPolicyException $exception) {
            self::failClaim($claim, 'SAFEGUARDING_BLOCKED', $exception->getMessage(), true);
        } catch (Throwable $exception) {
            Log::warning('Scheduled group publication attempt failed', [
                'scheduled_post_id' => $claim['id'],
                'tenant_id' => $claim['tenant_id'],
                'exception' => $exception::class,
            ]);
            self::failClaim(
                $claim,
                'PUBLISH_FAILED',
                $exception::class . ': ' . $exception->getMessage(),
                false,
            );
        }

        return false;
    }

    /** @param array{id:int,tenant_id:int,claim_token:string} $claim */
    private static function publishClaimForTenant(array $claim): bool
    {
        return DB::transaction(function () use ($claim): bool {
            $post = DB::table('group_scheduled_posts')
                ->where('id', $claim['id'])
                ->where('tenant_id', $claim['tenant_id'])
                ->where('status', 'processing')
                ->where('claim_token', $claim['claim_token'])
                ->lockForUpdate()
                ->first();
            if ($post === null) {
                return false;
            }

            $group = DB::table('groups')
                ->where('id', (int) $post->group_id)
                ->where('tenant_id', $claim['tenant_id'])
                ->where('status', GroupStatus::Active->value)
                ->lockForUpdate()
                ->first(['id']);
            if ($group === null) {
                throw new ScheduledPublicationRejected('GROUP_UNAVAILABLE');
            }
            if (!TenantContext::hasFeature('groups')) {
                throw new ScheduledPublicationRejected('FEATURE_DISABLED');
            }

            $postType = (string) $post->post_type;
            if (!in_array($postType, self::POST_TYPES, true)) {
                throw new ScheduledPublicationRejected('POST_TYPE_UNSUPPORTED');
            }
            $requiredTab = $postType === 'announcement' ? 'announcements' : 'discussion';
            if (!GroupConfigurationService::isTabEnabled($requiredTab)) {
                throw new ScheduledPublicationRejected('FEATURE_DISABLED');
            }

            $authorIsActive = DB::table('users')
                ->where('id', (int) $post->user_id)
                ->where('tenant_id', $claim['tenant_id'])
                ->where('status', 'active')
                ->where('is_approved', true)
                ->exists();
            if (!$authorIsActive) {
                throw new ScheduledPublicationRejected('AUTHOR_UNAVAILABLE');
            }
            $canPublish = $postType === 'announcement'
                ? GroupAccessService::canManage((int) $post->group_id, (int) $post->user_id)
                : GroupAccessService::canWriteContent((int) $post->group_id, (int) $post->user_id);
            if (!$canPublish) {
                throw new ScheduledPublicationRejected('AUTHOR_ACCESS_REVOKED');
            }

            if ($postType === 'announcement') {
                $service = app(GroupAnnouncementService::class);
                $published = $service->create((int) $post->group_id, (int) $post->user_id, [
                    'title' => (string) $post->title,
                    'content' => (string) $post->content,
                ]);
                $resourceType = 'announcement';
            } else {
                $published = GroupService::createDiscussion((int) $post->group_id, (int) $post->user_id, [
                    'title' => (string) $post->title,
                    'content' => (string) $post->content,
                ]);
                $resourceType = 'discussion';
            }
            if (!is_array($published) || (int) ($published['id'] ?? 0) <= 0) {
                throw new ScheduledPublicationRejected('CANONICAL_PUBLISH_REJECTED');
            }

            $updated = DB::table('group_scheduled_posts')
                ->where('id', $claim['id'])
                ->where('tenant_id', $claim['tenant_id'])
                ->where('status', 'processing')
                ->where('claim_token', $claim['claim_token'])
                ->update([
                    'status' => 'published',
                    'published_at' => now(),
                    'published_resource_type' => $resourceType,
                    'published_resource_id' => (int) $published['id'],
                    'claim_token' => null,
                    'lease_expires_at' => null,
                    'last_error_code' => null,
                    'last_error_message' => null,
                    'updated_at' => now(),
                ]);
            if ($updated !== 1) {
                throw new ScheduledPublicationRejected('CLAIM_LOST');
            }

            self::scheduleNextOccurrence($post);

            return true;
        });
    }

    private static function scheduleNextOccurrence(object $post): void
    {
        if (!(bool) $post->is_recurring || !is_string($post->recurrence_pattern)) {
            return;
        }

        $priorOccurrence = Carbon::parse((string) $post->scheduled_at);
        $next = match ($post->recurrence_pattern) {
            'daily' => $priorOccurrence->copy()->addDay(),
            'weekly' => $priorOccurrence->copy()->addWeek(),
            'monthly' => $priorOccurrence->copy()->addMonthNoOverflow(),
            default => null,
        };
        if ($next === null) {
            return;
        }

        DB::table('group_scheduled_posts')->insertOrIgnore([
            'tenant_id' => (int) $post->tenant_id,
            'group_id' => (int) $post->group_id,
            'user_id' => (int) $post->user_id,
            'post_type' => (string) $post->post_type,
            'title' => $post->title,
            'content' => (string) $post->content,
            'is_recurring' => true,
            'recurrence_pattern' => (string) $post->recurrence_pattern,
            'scheduled_at' => $next,
            'status' => 'scheduled',
            'attempt_count' => 0,
            'recurrence_parent_id' => (int) $post->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @param array{id:int,tenant_id:int,claim_token:string} $claim */
    private static function failClaim(
        array $claim,
        string $failureCode,
        string $message,
        bool $terminal,
    ): void {
        DB::transaction(function () use ($claim, $failureCode, $message, $terminal): void {
            $row = DB::table('group_scheduled_posts')
                ->where('id', $claim['id'])
                ->where('tenant_id', $claim['tenant_id'])
                ->where('status', 'processing')
                ->where('claim_token', $claim['claim_token'])
                ->lockForUpdate()
                ->first(['id', 'attempt_count']);
            if ($row === null) {
                return;
            }

            $exhausted = (int) $row->attempt_count >= self::MAX_ATTEMPTS;
            $failed = $terminal || $exhausted;
            DB::table('group_scheduled_posts')
                ->where('id', $claim['id'])
                ->where('tenant_id', $claim['tenant_id'])
                ->where('status', 'processing')
                ->where('claim_token', $claim['claim_token'])
                ->update([
                    'status' => $failed ? 'failed' : 'scheduled',
                    'claim_token' => null,
                    'lease_expires_at' => null,
                    'next_attempt_at' => $failed
                        ? null
                        : now()->addSeconds(self::retryBackoff((int) $row->attempt_count)),
                    'last_error_code' => $failureCode,
                    'last_error_message' => mb_substr($message, 0, 500),
                    'updated_at' => now(),
                ]);
        });
    }

    private static function retryBackoff(int $attempt): int
    {
        $index = max(0, min($attempt - 1, count(self::RETRY_BACKOFF_SECONDS) - 1));

        return self::RETRY_BACKOFF_SECONDS[$index];
    }

    private static function parseStrictBoolean(mixed $value): ?bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if ($value === 1 || $value === '1' || $value === 'true') {
            return true;
        }
        if ($value === 0 || $value === '0' || $value === 'false') {
            return false;
        }

        return null;
    }
}
