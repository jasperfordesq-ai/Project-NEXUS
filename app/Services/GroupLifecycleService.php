<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Events\GroupCreated;
use App\Events\GroupUpdated;
use App\Models\Group;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * GroupLifecycleService — Manages group states, archiving, auto-archive,
 * ownership transfer, merge, and cloning.
 *
 * Every transition writes the canonical status and the temporary is_active
 * compatibility mirror together under a tenant-scoped row lock.
 */
class GroupLifecycleService
{
    public const STATUS_PENDING_REVIEW = GroupStatus::PendingReview->value;
    public const STATUS_ACTIVE = GroupStatus::Active->value;
    public const STATUS_DORMANT = GroupStatus::Dormant->value;
    public const STATUS_ARCHIVED = GroupStatus::Archived->value;
    public const STATUS_REJECTED = GroupStatus::Rejected->value;

    /** @deprecated Compatibility aliases for callers from the prior lifecycle vocabulary. */
    public const STATUS_DRAFT = self::STATUS_PENDING_REVIEW;
    public const STATUS_PENDING = self::STATUS_PENDING_REVIEW;
    public const STATUS_DELETED = self::STATUS_ARCHIVED;

    /** Days of inactivity before marking dormant */
    const DORMANT_THRESHOLD_DAYS = 90;

    /** Days dormant before auto-archiving */
    const ARCHIVE_THRESHOLD_DAYS = 180;

    /**
     * A group with more than this many active members is never auto-demoted.
     * Dormancy and archival both hide a group from the directory, from search
     * and from its own members, so they are reserved for groups nobody is in.
     */
    const AUTO_DEMOTE_MAX_ACTIVE_MEMBERS = 1;

    /**
     * Largest share of a tenant's groups a single automatic run may transition.
     * A run that would sweep most of a community's directory is a defect in the
     * activity signal, not a cleanup, so it is refused and logged instead.
     */
    const AUTO_LIFECYCLE_MAX_SHARE = 0.2;

    /** Automatic runs may always transition at least this many groups. */
    const AUTO_LIFECYCLE_MIN_BATCH = 5;

    /**
     * Get the current lifecycle status of a group.
     */
    public static function getStatus(int $groupId): ?string
    {
        /** @var Group|null $group */
        $group = Group::query()->find($groupId);

        return $group?->status->value;
    }

    /**
     * Transition a group to a new status.
     */
    public static function transition(int $groupId, string $newStatus, int $performedBy, string $reason = ''): bool
    {
        try {
            $target = GroupStatus::normalize($newStatus, true);
        } catch (\InvalidArgumentException) {
            return false;
        }

        $updatedGroup = DB::transaction(function () use ($groupId, $target, $performedBy, $reason): Group|null|false {
            /** @var Group|null $group */
            $group = Group::query()->lockForUpdate()->find($groupId);
            if ($group === null || ! $group->status->canTransitionTo($target)) {
                return false;
            }

            if ($group->status === $target) {
                return null;
            }

            $previous = $group->status;
            $group->status = $target;
            $group->is_active = $target->legacyIsActive();
            $group->save();

            // Audit within the transaction so an unaudited transition cannot commit.
            GroupAuditService::log(
                'group_status_changed',
                $groupId,
                $performedBy,
                [
                    'old_status' => $previous->value,
                    'new_status' => $target->value,
                    'reason' => $reason,
                ],
            );

            return $group->fresh();
        });

        if ($updatedGroup === false) {
            return false;
        }

        if ($updatedGroup instanceof Group) {
            $tenantId = (int) TenantContext::getId();
            DB::afterCommit(static function () use ($updatedGroup, $tenantId, $groupId): void {
                try {
                    GroupUpdated::dispatch($updatedGroup, $tenantId);
                } catch (\Throwable $e) {
                    // The canonical state is committed; queued projections are retryable.
                    Log::warning('GroupLifecycle: Failed to dispatch GroupUpdated', [
                        'group_id' => $groupId,
                        'error' => $e->getMessage(),
                    ]);
                }
            });
        }

        return true;
    }

    /**
     * Archive a group — preserves content, locks new activity.
     */
    public static function archive(int $groupId, int $performedBy, string $reason = ''): bool
    {
        return self::transition($groupId, self::STATUS_ARCHIVED, $performedBy, $reason);
    }

    /**
     * Unarchive a group — restores full activity.
     */
    public static function unarchive(int $groupId, int $performedBy): bool
    {
        return self::transition($groupId, self::STATUS_ACTIVE, $performedBy, 'Unarchived');
    }

    /**
     * Transfer ownership of a group.
     */
    public static function transferOwnership(int $groupId, int $newOwnerId, int $performedBy): bool
    {
        $tenantId = (int) TenantContext::getId();

        $result = DB::transaction(function () use ($groupId, $newOwnerId, $performedBy, $tenantId): array {
            $groupRow = DB::table('groups')
                ->where('id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if ($groupRow === null) {
                return ['success' => false, 'changed' => false, 'group' => null];
            }

            $actorExists = DB::table('users')
                ->where('id', $performedBy)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->exists();
            if (! $actorExists || ! GroupAccessService::canManage($groupId, $performedBy)) {
                return ['success' => false, 'changed' => false, 'group' => null];
            }

            $members = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->orderBy('id')
                ->lockForUpdate()
                ->get();
            $newOwnerExists = DB::table('users')
                ->where('id', $newOwnerId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->exists();
            if (! $newOwnerExists) {
                return ['success' => false, 'changed' => false, 'group' => null];
            }
            $newOwnerMembership = $members->first(
                static fn (object $member): bool => (int) $member->user_id === $newOwnerId,
            );
            if ($newOwnerMembership === null || (string) $newOwnerMembership->status !== 'active') {
                return ['success' => false, 'changed' => false, 'group' => null];
            }

            $oldOwnerId = (int) $groupRow->owner_id;
            $ownerRows = $members->filter(
                static fn (object $member): bool => (string) $member->role === 'owner',
            );
            $alreadyConsistent = $oldOwnerId === $newOwnerId
                && (string) $newOwnerMembership->role === 'owner'
                && $ownerRows->count() === 1;
            if ($alreadyConsistent) {
                return ['success' => true, 'changed' => false, 'group' => null];
            }

            DB::table('groups')
                ->where('id', $groupId)
                ->where('tenant_id', $tenantId)
                ->update(['owner_id' => $newOwnerId, 'updated_at' => now()]);

            DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('role', 'owner')
                ->where('user_id', '!=', $newOwnerId)
                ->update(['role' => 'admin', 'updated_at' => now()]);
            DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('user_id', $newOwnerId)
                ->update(['role' => 'owner', 'updated_at' => now()]);

            if ($oldOwnerId !== $newOwnerId) {
                DB::table('group_members')->updateOrInsert(
                    [
                        'tenant_id' => $tenantId,
                        'group_id' => $groupId,
                        'user_id' => $oldOwnerId,
                    ],
                    [
                        'role' => 'admin',
                        'status' => 'active',
                        'updated_at' => now(),
                    ],
                );
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_GROUP_UPDATED,
                $groupId,
                $performedBy,
                [
                    'action' => 'ownership_transferred',
                    'previous_owner_id' => $oldOwnerId,
                    'new_owner_id' => $newOwnerId,
                ],
            );

            return [
                'success' => true,
                'changed' => true,
                'group' => Group::query()->find($groupId),
            ];
        }, 3);

        if (($result['changed'] ?? false) && ($result['group'] ?? null) instanceof Group) {
            $updatedGroup = $result['group'];
            DB::afterCommit(static function () use ($updatedGroup, $tenantId, $groupId): void {
                try {
                    GroupUpdated::dispatch($updatedGroup, $tenantId);
                } catch (\Throwable $e) {
                    Log::warning('GroupLifecycle: Failed to dispatch ownership update', [
                        'group_id' => $groupId,
                        'error' => $e->getMessage(),
                    ]);
                }
            });
        }

        return (bool) ($result['success'] ?? false);
    }

    /**
     * Merge source group into target group.
     */
    public static function mergeGroups(int $sourceGroupId, int $targetGroupId, int $performedBy): bool
    {
        $tenantId = TenantContext::getId();

        $source = DB::table('groups')->where('id', $sourceGroupId)->where('tenant_id', $tenantId)->first();
        $target = DB::table('groups')->where('id', $targetGroupId)->where('tenant_id', $tenantId)->first();

        if (!$source || !$target) {
            return false;
        }

        if (
            GroupStatus::normalize((string) $source->status, (bool) $source->is_active) !== GroupStatus::Active
            || GroupStatus::normalize((string) $target->status, (bool) $target->is_active) !== GroupStatus::Active
        ) {
            return false;
        }

        DB::transaction(function () use ($sourceGroupId, $targetGroupId, $tenantId, $performedBy, $source) {
            // Migrate members (skip duplicates via INSERT IGNORE)
            $sourceMembers = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $sourceGroupId)
                ->where('status', 'active')
                ->get();

            foreach ($sourceMembers as $member) {
                $exists = DB::table('group_members')
                    ->where('tenant_id', $tenantId)
                    ->where('group_id', $targetGroupId)
                    ->where('user_id', $member->user_id)
                    ->exists();

                if (!$exists) {
                    GroupService::assertSafeguardingCohortAllowed(
                        $targetGroupId,
                        (int) $member->user_id,
                        (int) $tenantId,
                        'group_merge_member_activation',
                    );

                    DB::table('group_members')->insert([
                        'tenant_id' => $tenantId,
                        'group_id' => $targetGroupId,
                        'user_id' => $member->user_id,
                        'role' => 'member', // Demote to member in merged group
                        'status' => 'active',
                        'created_at' => $member->created_at,
                        'updated_at' => now(),
                    ]);
                }
            }

            // Migrate discussions
            DB::table('group_discussions')
                ->where('group_id', $sourceGroupId)
                ->where('tenant_id', $tenantId)
                ->update(['group_id' => $targetGroupId]);

            // Migrate files
            DB::table('group_files')
                ->where('group_id', $sourceGroupId)
                ->where('tenant_id', $tenantId)
                ->update(['group_id' => $targetGroupId]);

            // Migrate events
            DB::table('events')
                ->where('group_id', $sourceGroupId)
                ->where('tenant_id', $tenantId)
                ->update(['group_id' => $targetGroupId]);

            // Migrate announcements
            DB::table('group_announcements')
                ->where('group_id', $sourceGroupId)
                ->where('tenant_id', $tenantId)
                ->update(['group_id' => $targetGroupId]);

            // Update cached member count
            $newCount = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $targetGroupId)
                ->where('status', 'active')
                ->count();

            DB::table('groups')
                ->where('id', $targetGroupId)
                ->where('tenant_id', $tenantId)
                ->update(['cached_member_count' => $newCount, 'updated_at' => now()]);

            // Retire the source through the canonical compatibility pair.
            DB::table('groups')
                ->where('id', $sourceGroupId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'status' => GroupStatus::Archived->value,
                    'is_active' => false,
                    'updated_at' => now(),
                ]);

            $previousStatus = GroupStatus::normalize(
                is_string($source->status ?? null) ? $source->status : null,
                (bool) ($source->is_active ?? false),
            );
            GroupAuditService::log('group_status_changed', $sourceGroupId, $performedBy, [
                'old_status' => $previousStatus->value,
                'new_status' => GroupStatus::Archived->value,
                'reason' => 'Merged into group ' . $targetGroupId,
            ]);
            GroupAuditService::log(
                GroupAuditService::ACTION_GROUP_UPDATED,
                $targetGroupId,
                $performedBy,
                [
                    'action' => 'groups_merged',
                    'source_group_id' => $sourceGroupId,
                    'source_name' => $source->name,
                ],
            );
        });

        $updatedGroups = Group::query()->whereIn('id', [$sourceGroupId, $targetGroupId])->get();
        $eventTenantId = (int) $tenantId;
        foreach ($updatedGroups as $updatedGroup) {
            DB::afterCommit(static function () use ($updatedGroup, $eventTenantId): void {
                GroupUpdated::dispatch($updatedGroup, $eventTenantId);
            });
        }

        return true;
    }

    /**
     * Clone a group with settings (optionally with members).
     */
    public static function cloneGroup(int $sourceGroupId, string $newName, int $ownerId, bool $cloneMembers = false): ?int
    {
        $tenantId = (int) TenantContext::getId();
        $newName = trim($newName);
        if ($newName === '' || mb_strlen($newName) < 3 || mb_strlen($newName) > 255) {
            return null;
        }

        $newGroup = DB::transaction(function () use (
            $sourceGroupId,
            $newName,
            $ownerId,
            $cloneMembers,
            $tenantId,
        ): Group|null {
            $source = DB::table('groups')
                ->where('id', $sourceGroupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if ($source === null) {
                return null;
            }
            try {
                $sourceStatus = GroupStatus::normalize((string) $source->status, (bool) $source->is_active);
            } catch (\InvalidArgumentException) {
                return null;
            }
            if ($sourceStatus !== GroupStatus::Active || ! GroupAccessService::canManage($sourceGroupId, $ownerId)) {
                return null;
            }

            $actorExists = DB::table('users')
                ->where('id', $ownerId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->exists();
            if (! $actorExists) {
                return null;
            }

            $sourceMembers = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $sourceGroupId)
                ->where('status', 'active')
                ->orderBy('id')
                ->lockForUpdate()
                ->get();
            $cloneMemberIds = $cloneMembers
                ? $sourceMembers
                    ->pluck('user_id')
                    ->map(static fn (mixed $id): int => (int) $id)
                    ->filter(static fn (int $id): bool => $id !== $ownerId)
                    ->unique()
                    ->values()
                    ->all()
                : [];

            if ($cloneMemberIds !== []) {
                $validMemberIds = DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'active')
                    ->whereIn('id', $cloneMemberIds)
                    ->pluck('id')
                    ->map(static fn (mixed $id): int => (int) $id)
                    ->sort()
                    ->values()
                    ->all();
                $expectedMemberIds = $cloneMemberIds;
                sort($expectedMemberIds);
                if ($validMemberIds !== $expectedMemberIds) {
                    return null;
                }

                $cohort = array_values(array_unique(array_merge([$ownerId], $cloneMemberIds)));
                $policy = app(SafeguardingInteractionPolicy::class);
                foreach ($cohort as $senderId) {
                    $recipientIds = array_values(array_filter(
                        $cohort,
                        static fn (int $recipientId): bool => $recipientId !== $senderId,
                    ));
                    $policy->assertManyLocalContactsAllowed(
                        $senderId,
                        $recipientIds,
                        $tenantId,
                        'group_clone_member_activation',
                    );
                }
            }

            $newGroupId = (int) DB::table('groups')->insertGetId([
                'tenant_id' => $tenantId,
                'owner_id' => $ownerId,
                'name' => $newName,
                'description' => $source->description,
                'visibility' => $source->visibility,
                'type_id' => $source->type_id,
                'location' => $source->location,
                'latitude' => $source->latitude,
                'longitude' => $source->longitude,
                'status' => GroupStatus::Active->value,
                'is_active' => true,
                'cached_member_count' => 1 + count($cloneMemberIds),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $membershipRows = [[
                'tenant_id' => $tenantId,
                'group_id' => $newGroupId,
                'user_id' => $ownerId,
                'role' => 'owner',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]];
            foreach ($cloneMemberIds as $memberId) {
                $membershipRows[] = [
                    'tenant_id' => $tenantId,
                    'group_id' => $newGroupId,
                    'user_id' => $memberId,
                    'role' => 'member',
                    'status' => 'active',
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }
            DB::table('group_members')->insert($membershipRows);

            $tagIds = DB::table('group_tag_assignments')
                ->where('group_id', $sourceGroupId)
                ->lockForUpdate()
                ->pluck('tag_id')
                ->map(static fn (mixed $id): int => (int) $id)
                ->unique()
                ->values()
                ->all();
            if ($tagIds !== []) {
                DB::table('group_tag_assignments')->insert(array_map(
                    static fn (int $tagId): array => ['group_id' => $newGroupId, 'tag_id' => $tagId],
                    $tagIds,
                ));
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_GROUP_CREATED,
                $newGroupId,
                $ownerId,
                ['action' => 'group_cloned', 'source_group_id' => $sourceGroupId],
            );

            return Group::query()->find($newGroupId);
        }, 3);

        if (! $newGroup instanceof Group) {
            return null;
        }

        DB::afterCommit(static function () use ($newGroup, $tenantId): void {
            try {
                GroupCreated::dispatch($newGroup, $tenantId);
            } catch (\Throwable $e) {
                Log::warning('GroupLifecycle: Failed to dispatch cloned group', [
                    'group_id' => $newGroup->id,
                    'error' => $e->getMessage(),
                ]);
            }
        });

        return (int) $newGroup->id;
    }

    /**
     * Check for dormant/inactive groups and update their status.
     * Intended to be run as a scheduled command.
     */
    /**
     * Work out which groups look inactive, and — ONLY when $apply is true — demote them.
     *
     * 🔴 Reporting is the default because nothing may hide a community's groups on its own.
     * This ran nightly until 2026-08-18 and had archived 431 of one tenant's 434 groups in a
     * single run; the owner's decision is that a group is hidden only when a person chooses
     * to hide it. It is no longer scheduled (see bootstrap/app.php), and a caller that wants
     * the old behaviour has to ask for it explicitly and in writing.
     */
    public static function checkInactiveGroups(int $tenantId, bool $apply = false): array
    {
        $dormantThreshold = now()->subDays(self::DORMANT_THRESHOLD_DAYS);
        $archiveThreshold = now()->subDays(self::ARCHIVE_THRESHOLD_DAYS);

        $stats = ['dormant' => 0, 'archived' => 0, 'protected' => 0, 'halted' => false, 'planned' => 0, 'applied' => $apply];

        // Dormant groups remain in the scan so they can advance to archived.
        $groups = DB::table('groups')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', [GroupStatus::Active->value, GroupStatus::Dormant->value])
            ->select(['id', 'owner_id', 'status', 'created_at', 'is_featured'])
            ->get();

        if ($groups->isEmpty()) {
            return $stats;
        }

        $protectedIds = self::autoDemotionProtectedGroupIds($tenantId, $groups->pluck('id')->all());

        // Decide the whole run before writing anything, so the blast-radius
        // guard below sees the true size of the sweep.
        $planned = [];
        foreach ($groups as $group) {
            $groupId = (int) $group->id;
            $lastActivity = self::getLastActivityDate($groupId, $tenantId)
                ?? new \DateTimeImmutable((string) $group->created_at);

            if ($lastActivity >= $dormantThreshold) {
                continue;
            }

            if (isset($protectedIds[$groupId])) {
                $stats['protected']++;
                continue;
            }

            if ($lastActivity < $archiveThreshold) {
                $planned[] = [$groupId, (int) $group->owner_id, GroupStatus::Archived->value, 'Automatic inactivity archive'];
                continue;
            }

            if ($group->status === GroupStatus::Active->value) {
                $planned[] = [$groupId, (int) $group->owner_id, GroupStatus::Dormant->value, 'Automatic inactivity dormancy'];
            }
        }

        $limit = max(self::AUTO_LIFECYCLE_MIN_BATCH, (int) floor($groups->count() * self::AUTO_LIFECYCLE_MAX_SHARE));
        if (count($planned) > $limit) {
            $stats['halted'] = true;
            Log::error('Automatic group lifecycle run refused: sweep too large', [
                'tenant_id' => $tenantId,
                'planned' => count($planned),
                'limit' => $limit,
                'candidates' => $groups->count(),
            ]);

            return $stats;
        }

        $stats['planned'] = count($planned);

        // Report and stop unless a person explicitly asked for the change to be made.
        if (! $apply) {
            return $stats;
        }

        foreach ($planned as [$groupId, $ownerId, $target, $reason]) {
            if (! self::transition($groupId, $target, $ownerId, $reason)) {
                continue;
            }
            $stats[$target === GroupStatus::Archived->value ? 'archived' : 'dormant']++;
        }

        return $stats;
    }

    /**
     * Groups that inactivity must never demote, keyed by id.
     *
     * Both dormant and archived drop a group out of the directory and out of
     * sub-group lists, so neither is safe to apply automatically to a group
     * that is structural rather than conversational. Three kinds go quiet by
     * design: featured groups a community chose to promote, parent groups
     * whose demotion would hide an entire subtree, and groups that still have
     * real membership.
     *
     * @param  list<int|string>  $groupIds
     * @return array<int, true>
     */
    private static function autoDemotionProtectedGroupIds(int $tenantId, array $groupIds): array
    {
        if ($groupIds === []) {
            return [];
        }

        $protected = [];

        $featured = DB::table('groups')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $groupIds)
            ->where('is_featured', true)
            ->pluck('id');
        foreach ($featured as $id) {
            $protected[(int) $id] = true;
        }

        $parents = DB::table('groups')
            ->where('tenant_id', $tenantId)
            ->whereIn('parent_id', $groupIds)
            ->distinct()
            ->pluck('parent_id');
        foreach ($parents as $id) {
            $protected[(int) $id] = true;
        }

        $populated = DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->whereIn('group_id', $groupIds)
            ->where('status', 'active')
            ->groupBy('group_id')
            ->havingRaw('COUNT(*) > ?', [self::AUTO_DEMOTE_MAX_ACTIVE_MEMBERS])
            ->pluck('group_id');
        foreach ($populated as $id) {
            $protected[(int) $id] = true;
        }

        return $protected;
    }

    /**
     * Get the last activity date for a group.
     */
    private static function getLastActivityDate(int $groupId, int $tenantId): ?\DateTimeInterface
    {
        $dates = [];

        $lastPost = DB::table('group_posts as gp')
            ->join('group_discussions as gd', 'gp.discussion_id', '=', 'gd.id')
            ->where('gd.group_id', $groupId)
            ->where('gp.tenant_id', $tenantId)
            ->max('gp.created_at');
        if ($lastPost) $dates[] = $lastPost;

        $lastDiscussion = DB::table('group_discussions')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->max('created_at');
        if ($lastDiscussion) $dates[] = $lastDiscussion;

        $lastMember = DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->where('status', 'active')
            ->max('created_at');
        if ($lastMember) $dates[] = $lastMember;

        // A group is not dead just because nobody used the discussions tab.
        // Events, feed posts, announcements and shared material all count.
        foreach (['events', 'feed_posts', 'group_announcements', 'group_files', 'group_media'] as $table) {
            $latest = DB::table($table)
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->max('created_at');
            if ($latest) $dates[] = $latest;
        }

        if (empty($dates)) {
            return null;
        }

        return new \DateTime(max($dates));
    }

    /**
     * Bulk archive groups.
     */
    public static function bulkArchive(array $groupIds, int $performedBy): int
    {
        $groupIds = DB::table('groups')
            ->where('tenant_id', TenantContext::getId())
            ->whereIn('id', $groupIds)
            ->where('status', '!=', GroupStatus::Archived->value)
            ->pluck('id');

        $changed = 0;
        foreach ($groupIds as $groupId) {
            if (self::archive((int) $groupId, $performedBy, 'Bulk archive')) {
                $changed++;
            }
        }

        return $changed;
    }

    /**
     * Bulk unarchive groups.
     */
    public static function bulkUnarchive(array $groupIds, int $performedBy): int
    {
        $groupIds = DB::table('groups')
            ->where('tenant_id', TenantContext::getId())
            ->whereIn('id', $groupIds)
            ->where('status', GroupStatus::Archived->value)
            ->pluck('id');

        $changed = 0;
        foreach ($groupIds as $groupId) {
            if (self::unarchive((int) $groupId, $performedBy)) {
                $changed++;
            }
        }

        return $changed;
    }
}
