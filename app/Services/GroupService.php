<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Events\GroupCreated;
use App\Events\GroupDeleted;
use App\Events\GroupMemberJoined;
use App\Events\GroupMemberLeft;
use App\Events\GroupUpdated;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\Group;
use App\Models\GroupDiscussion;
use App\Models\GroupPost;
use App\Models\ActivityLog;
use App\Models\Notification;
use App\Models\User;
use App\Support\CursorSigner;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * GroupService — Laravel DI-based service for group operations.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class GroupService
{
    public function __construct(
        private readonly Group $group,
    ) {}

    /**
     * Get groups with cursor-based pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}|null
     */
    public static function getAll(array $filters = []): ?array
    {
        self::$errors = [];
        $limit = max(1, min((int) ($filters['limit'] ?? 20), 100));
        $cursor = $filters['cursor'] ?? null;
        $viewerUserId = !empty($filters['viewer_user_id']) ? (int) $filters['viewer_user_id'] : null;
        $tenantId = (int) TenantContext::getId();

        $query = Group::query()
            ->active()
            ->with(['creator:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->withCount('activeMembers');

        // Show featured groups (regardless of hierarchy) + top-level non-featured groups
        if (empty($filters['parent_id'])) {
            $query->where(function (Builder $q) {
                $q->where('is_featured', true)
                  ->orWhere(function (Builder $q2) {
                      $q2->whereNull('parent_id')->orWhere('parent_id', 0);
                  });
            });
        }

        if (! empty($filters['visibility'])) {
            $visibility = $filters['visibility'];
            $query->where('visibility', $visibility);
            if (in_array($visibility, ['private', 'secret'], true)) {
                if ($viewerUserId && self::isPlatformAdmin($viewerUserId)) {
                    // Tenant/platform admins may audit private groups in their tenant.
                } elseif ($viewerUserId) {
                    $query->where(function (Builder $q) use ($viewerUserId) {
                        $q->where('owner_id', $viewerUserId)
                            ->orWhereIn('id', function ($sub) use ($viewerUserId) {
                                $sub->select('group_id')
                                    ->from('group_members')
                                    ->where('user_id', $viewerUserId)
                                    ->where('status', 'active');
                            });
                    });
                } else {
                    $query->whereRaw('1 = 0');
                }
            }
        } else {
            $query->where(function (Builder $q) use ($viewerUserId) {
                $q->where('visibility', 'public');
                if ($viewerUserId && self::isPlatformAdmin($viewerUserId)) {
                    $q->orWhereIn('visibility', ['private', 'secret']);
                } elseif ($viewerUserId) {
                    $q->orWhere('owner_id', $viewerUserId);
                    $q->orWhereIn('id', function ($sub) use ($viewerUserId) {
                        $sub->select('group_id')
                            ->from('group_members')
                            ->where('user_id', $viewerUserId)
                            ->where('status', 'active');
                    });
                }
            });
        }

        if (! empty($filters['type_id'])) {
            $query->where('type_id', (int) $filters['type_id']);
        }

        if (! empty($filters['user_id'])) {
            // Direct subquery on group_members avoids a JOIN to users + withCount-triggered N+1
            $uid = (int) $filters['user_id'];
            $query->whereIn('id', function ($sub) use ($uid) {
                $sub->select('group_id')
                    ->from('group_members')
                    ->where('user_id', $uid)
                    ->where('status', 'active');
            });
        }

        if (! empty($filters['search'])) {
            $term = '%' . $filters['search'] . '%';
            $query->where(function (Builder $q) use ($term) {
                $q->where('name', 'LIKE', $term)
                  ->orWhere('description', 'LIKE', $term);
            });
        }

        if ($cursor !== null && $cursor !== '') {
            $cursorPayload = is_string($cursor) ? CursorSigner::decode($cursor) : null;
            if (
                !is_array($cursorPayload)
                || ($cursorPayload['kind'] ?? null) !== 'group_directory'
                || (int) ($cursorPayload['tenant_id'] ?? 0) !== $tenantId
                || !isset($cursorPayload['featured'], $cursorPayload['id'])
                || !is_numeric($cursorPayload['featured'])
                || !is_numeric($cursorPayload['id'])
            ) {
                self::$errors[] = ['code' => 'INVALID_CURSOR', 'message' => __('api.invalid_cursor')];
                return null;
            }

            $featured = (int) $cursorPayload['featured'];
            $cursorId = (int) $cursorPayload['id'];
            if (!in_array($featured, [0, 1], true) || $cursorId <= 0) {
                self::$errors[] = ['code' => 'INVALID_CURSOR', 'message' => __('api.invalid_cursor')];
                return null;
            }

            $query->where(function (Builder $after) use ($featured, $cursorId): void {
                $after->where('is_featured', '<', $featured)
                    ->orWhere(function (Builder $sameFeatured) use ($featured, $cursorId): void {
                        $sameFeatured->where('is_featured', $featured)
                            ->where('id', '<', $cursorId);
                    });
            });
        }

        $query->orderByDesc('is_featured')->orderByDesc('id');

        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $enriched = $items->map(function (Group $group) {
            $data = $group->toArray();
            return self::enrichGroupData($data, $group);
        })->all();

        $last = $items->last();

        return [
            'items'    => $enriched,
            'cursor'   => $hasMore && $last !== null
                ? CursorSigner::encode([
                    'kind' => 'group_directory',
                    'tenant_id' => $tenantId,
                    'featured' => $last->is_featured ? 1 : 0,
                    'id' => (int) $last->id,
                ])
                : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Batch-load viewer membership data for multiple groups (avoids N+1).
     *
     * @param  int[] $groupIds
     * @return array<int, array{status: string, role: string|null, is_admin: bool}> Map of group_id => membership
     */
    public static function getViewerMembershipsBatch(array $groupIds, int $userId): array
    {
        if (empty($groupIds)) {
            return [];
        }
        $tenantId = TenantContext::getId();
        $placeholders = implode(',', array_fill(0, count($groupIds), '?'));
        $params = array_merge($groupIds, [$tenantId, $userId]);
        $rows = DB::select(
            "SELECT group_id, status, role FROM group_members WHERE group_id IN ({$placeholders}) AND group_id IN (SELECT id FROM groups WHERE tenant_id = ?) AND user_id = ?",
            $params
        );
        $map = [];
        foreach ($rows as $row) {
            $map[(int) $row->group_id] = [
                'status'   => $row->status ?? 'none',
                'role'     => $row->role,
                'is_admin' => in_array($row->role ?? '', ['admin', 'owner']),
            ];
        }
        return $map;
    }

    /**
     * Get a single group by ID.
     */
    public static function getById(int $id, ?int $currentUserId = null, bool $enforceVisibility = false): ?array
    {
        /** @var Group|null $group */
        $group = Group::query()
            ->with(['creator:id,first_name,last_name,organization_name,profile_type,avatar_url'])
            ->withCount('activeMembers')
            ->find($id);

        if (! $group) {
            return null;
        }

        if ($enforceVisibility && ! self::canView($id, $currentUserId)) {
            return null;
        }

        $data = $group->toArray();
        $data = self::enrichGroupData($data, $group);

        // Replace eager-loaded creator relation with safe public fields only
        $creator = $group->creator;
        if ($creator) {
            $data['creator'] = [
                'id'         => $creator->id,
                'name'       => ($creator->profile_type === 'organisation' && $creator->organization_name)
                                    ? $creator->organization_name
                                    : UserDisplayName::resolve($creator),
                'avatar'     => $creator->avatar_url,
                'avatar_url' => $creator->avatar_url,
            ];
        }

        // Fetch immediate child groups (sub_groups) so the frontend can render the subgroups tab
        $tenantId = TenantContext::getId();
        $subGroups = [];
        if (
            $currentUserId
            && GroupConfigurationService::isTabEnabled('subgroups')
            && GroupAccessService::canViewMemberContent($id, $currentUserId)
        ) {
            $subGroups = DB::table('groups')
                ->where('tenant_id', $tenantId)
                ->where('parent_id', $id)
                ->where('status', GroupStatus::Active->value)
                ->where(function ($q) use ($currentUserId, $tenantId) {
                    $q->where('visibility', 'public')
                        ->orWhere('owner_id', $currentUserId)
                        ->orWhereIn('id', function ($sub) use ($currentUserId, $tenantId) {
                            $sub->select('group_id')
                                ->from('group_members')
                                ->where('tenant_id', $tenantId)
                                ->where('user_id', $currentUserId)
                                ->where('status', 'active');
                        });
                })
                ->orderBy('name')
                ->select(['id', 'name', 'description', 'image_url', 'visibility', 'cached_member_count', 'type_id', 'parent_id'])
                ->get()
                ->map(fn($g) => [
                    'id'           => (int) $g->id,
                    'name'         => $g->name,
                    'description'  => $g->description,
                    'image_url'    => $g->image_url,
                    'visibility'   => $g->visibility,
                    'member_count' => (int) ($g->cached_member_count ?? 0),
                    'type_id'      => $g->type_id,
                    'parent_id'    => (int) $g->parent_id,
                ])
                ->all();
        }
        $data['sub_groups'] = $subGroups;

        if ($currentUserId) {
            $membership = DB::table('group_members')
                ->whereIn('group_id', fn ($q) => $q->select('id')->from('groups')->where('tenant_id', $tenantId))
                ->where('group_id', $id)
                ->where('user_id', $currentUserId)
                ->first();

            $membershipStatus = in_array((string) ($membership->status ?? ''), ['active', 'pending', 'invited', 'banned'], true)
                ? (string) $membership->status
                : 'none';
            $membershipRole = in_array((string) ($membership->role ?? ''), ['member', 'admin', 'owner'], true)
                ? (string) $membership->role
                : null;
            $isOwner = (int) $group->owner_id === $currentUserId || $membershipRole === 'owner';
            $canManageMembers = GroupAccessService::canManageMembers($id, $currentUserId);
            $canManageAdmins = $canManageMembers && self::canManageGroupAdmins($group, $currentUserId);

            // Flat fields (legacy)
            $data['my_role'] = $membershipRole;
            $data['my_status'] = $membershipStatus;

            // Canonical membership state and server-authoritative capabilities.
            $data['viewer_membership'] = [
                'status' => $membershipStatus,
                'role' => $membershipRole,
                'is_admin' => $canManageMembers,
                'capabilities' => [
                    'can_join' => in_array($membershipStatus, ['none', 'invited'], true)
                        && GroupAccessService::canJoin($id, $currentUserId),
                    'can_leave' => $membershipStatus === 'active' && ! $isOwner,
                    'can_cancel_request' => $membershipStatus === 'pending',
                    'can_invite' => $canManageMembers,
                    'can_manage_members' => $canManageMembers,
                    'can_manage_admins' => $canManageAdmins,
                    'can_delete' => $isOwner || self::isPlatformAdmin($currentUserId),
                ],
            ];

            if (GroupAccessService::canViewMemberContent($id, $currentUserId)) {
                // Recent members (last 5 active members)
                $recentMembers = DB::table('group_members')
                    ->join('users', 'group_members.user_id', '=', 'users.id')
                    ->whereIn('group_members.group_id', fn ($q) => $q->select('id')->from('groups')->where('tenant_id', $tenantId))
                    ->where('group_members.group_id', $id)
                    ->where('group_members.status', 'active')
                    ->orderByDesc('group_members.created_at')
                    ->limit(5)
                    ->select(['users.id', 'users.first_name', 'users.last_name', 'users.profile_type', 'users.organization_name', 'users.avatar_url'])
                    ->get();

                $data['recent_members'] = $recentMembers->map(fn($m) => [
                    'id'         => (int) $m->id,
                    'first_name' => $m->first_name,
                    'last_name'  => $m->last_name,
                    'name'       => UserDisplayName::resolve($m),
                    'avatar_url' => $m->avatar_url,
                    'avatar'     => $m->avatar_url,
                ])->all();
            }
        }

        return $data;
    }

    /**
     * Enrich group data with frontend-compatible field aliases.
     */
    private static function enrichGroupData(array $data, Group $group): array
    {
        $memberCount = $data['active_members_count'] ?? $group->cached_member_count ?? 0;
        $data['member_count'] = $memberCount;
        $data['members_count'] = $memberCount;

        return $data;
    }

    /** Authoritative Create/Edit/Settings choices and validation limits. */
    public static function getFormCapabilities(int $userId): array
    {
        $tenantId = (int) TenantContext::getId();
        $allowPrivate = (bool) GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_ALLOW_PRIVATE_GROUPS,
            true,
        );
        $minimumDescription = max(0, (int) GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_MIN_DESCRIPTION_LENGTH,
            10,
        ));
        $maximumDescription = max($minimumDescription, (int) GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_MAX_DESCRIPTION_LENGTH,
            5000,
        ));

        $types = DB::table('group_types')
            ->where('tenant_id', $tenantId)
            ->where('is_active', 1)
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get(['id', 'name', 'description', 'icon', 'color'])
            ->map(static fn (object $type): array => [
                'id' => (int) $type->id,
                'name' => (string) $type->name,
                'description' => $type->description !== null ? (string) $type->description : null,
                'icon' => $type->icon !== null ? (string) $type->icon : null,
                'color' => $type->color !== null ? (string) $type->color : null,
            ])
            ->all();

        $parentCandidates = Group::query()
            ->active()
            ->manageableBy($userId, GroupAccessService::isTenantAdmin($userId))
            ->orderBy('name')
            ->get(['id', 'name', 'parent_id'])
            ->map(static fn (Group $group): array => [
                'id' => (int) $group->id,
                'name' => (string) $group->name,
                'parent_id' => $group->parent_id !== null ? (int) $group->parent_id : null,
            ])
            ->all();

        return [
            'allowed_visibility' => $allowPrivate
                ? ['public', 'private', 'secret']
                : ['public'],
            'limits' => [
                'name_min' => 3,
                'name_max' => 255,
                'description_min' => $minimumDescription,
                'description_max' => $maximumDescription,
                'location_max' => 255,
                'image_max_bytes' => 8 * 1024 * 1024,
            ],
            'templates' => GroupTemplateService::getAll(),
            'group_types' => $types,
            'parent_candidates' => $parentCandidates,
            'fields' => [
                'type' => $types !== [],
                'parent' => $parentCandidates !== [],
                'location' => true,
                'avatar' => true,
                'cover' => true,
                'branding' => true,
            ],
            'image_operations' => ['keep', 'replace', 'remove'],
            'capabilities' => [
                'can_create' => (bool) GroupConfigurationService::get(
                    GroupConfigurationService::CONFIG_ALLOW_USER_GROUP_CREATION,
                    true,
                ) || GroupAccessService::isTenantAdmin($userId),
            ],
        ];
    }

    /**
     * Create a new group.
     */
    public static function create(int $userId, array $data): ?Group
    {
        return self::createWithProvenance($userId, $data);
    }

    /**
     * Create a group from an approved idea-to-team conversion workflow.
     *
     * Keeping provenance in this explicit trusted entry point prevents normal
     * group-create requests from supplying arbitrary source identifiers while
     * still routing every group through the canonical creation policy and
     * lifecycle initialization.
     */
    public static function createFromIdea(
        int $userId,
        array $data,
        int $ideaId,
        int $challengeId,
    ): ?Group {
        return self::createWithProvenance($userId, $data, [
            'source_idea_id' => $ideaId,
            'source_challenge_id' => $challengeId,
        ]);
    }

    /**
     * @param array{source_idea_id?: int, source_challenge_id?: int} $provenance
     */
    private static function createWithProvenance(
        int $userId,
        array $data,
        array $provenance = [],
    ): ?Group
    {
        self::$errors = [];
        unset($data['tags'], $data['features'], $data['welcome_message']);

        if (array_key_exists('template_id', $data) && $data['template_id'] !== null && $data['template_id'] !== '') {
            if (! is_numeric($data['template_id']) || (int) $data['template_id'] < 1) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_template_invalid'), 'field' => 'template_id'];
                return null;
            }
            $template = GroupTemplateService::get((int) $data['template_id']);
            if ($template === null || ! (bool) ($template['is_active'] ?? false)) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_template_invalid'), 'field' => 'template_id'];
                return null;
            }
            $data['template_id'] = (int) $template['id'];
            $data['visibility'] ??= (string) $template['default_visibility'];
            $data['type_id'] ??= $template['default_type_id'] !== null
                ? (int) $template['default_type_id']
                : null;
            $data['_template_tags'] = is_array($template['default_tags'] ?? null)
                ? array_values(array_map('intval', $template['default_tags']))
                : [];
            $data['_template_features'] = is_array($template['features'] ?? null)
                ? $template['features']
                : [];
            $data['_template_welcome'] = trim((string) ($template['welcome_message'] ?? ''));
        } else {
            $data['template_id'] = null;
            $data['_template_tags'] = [];
            $data['_template_features'] = [];
            $data['_template_welcome'] = '';
        }

        $data['visibility'] ??= (string) GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_DEFAULT_VISIBILITY,
            'public',
        );

        $data = self::normalizeLocationPayload($data);
        if ($data === null) {
            return null;
        }
        $data = self::normalizeBrandColors($data);
        if ($data === null) {
            return null;
        }

        if (! self::validate($data)) {
            return null;
        }

        if (! self::validateCreationPolicy($userId, $data)) {
            return null;
        }

        if (! self::validateFormRelations($userId, $data)) {
            return null;
        }

        $initialStatus = GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_REQUIRE_GROUP_APPROVAL,
            false,
        ) ? GroupStatus::PendingReview : GroupStatus::Active;

        $group = DB::transaction(function () use ($userId, $data, $initialStatus, $provenance) {
            $group = new Group([
                'owner_id'             => $userId,
                'name'                 => trim($data['name']),
                'description'          => trim($data['description'] ?? ''),
                'visibility'           => $data['visibility'] ?? 'public',
                'image_url'            => $data['image_url'] ?? null,
                'cover_image_url'      => $data['cover_image_url'] ?? null,
                'primary_color'        => $data['primary_color'] ?? null,
                'accent_color'         => $data['accent_color'] ?? null,
                'location'             => $data['location'] ?? null,
                'latitude'             => $data['latitude'] ?? null,
                'longitude'            => $data['longitude'] ?? null,
                'type_id'              => $data['type_id'] ?? null,
                'template_id'          => $data['template_id'] ?? null,
                'template_features'    => $data['_template_features'] ?? [],
                'parent_id'            => $data['parent_id'] ?? null,
                'federated_visibility' => $data['federated_visibility'] ?? 'none',
                'source_idea_id'       => $provenance['source_idea_id'] ?? null,
                'source_challenge_id'  => $provenance['source_challenge_id'] ?? null,
            ]);

            $group->status = $initialStatus;
            $group->is_active = $initialStatus->legacyIsActive();

            $group->save();

            // The creator owns the group. Non-active lifecycle states still
            // deny child-content access through GroupAccessService.
            $group->attachMember($userId, [
                'role'   => 'owner',
                'status' => 'active',
            ]);

            $group->cached_member_count = 1;
            $group->save();

            if (! empty($data['_template_tags'])) {
                GroupTagService::setForGroup((int) $group->id, $data['_template_tags']);
            }
            if (($data['_template_welcome'] ?? '') !== '') {
                GroupWelcomeService::setConfig((int) $group->id, true, (string) $data['_template_welcome']);
            }
            if (! empty($data['parent_id'])) {
                Group::query()->whereKey((int) $data['parent_id'])->update(['has_children' => true]);
            }

            // Creation and its audit are one write boundary.
            GroupAuditService::log(
                GroupAuditService::ACTION_GROUP_CREATED,
                (int) $group->id,
                $userId,
                ['name' => $group->name],
            );

            if ($initialStatus === GroupStatus::PendingReview) {
                GroupApprovalWorkflowService::submitForApproval($group->id, $userId);
            }

            $fresh = $group->fresh(['creator']);

            return $fresh ?? $group;
        });

        if ($initialStatus === GroupStatus::Active) {
            $eventTenantId = (int) TenantContext::getId();
            DB::afterCommit(static function () use ($group, $eventTenantId): void {
                try {
                    GroupCreated::dispatch($group, $eventTenantId);
                } catch (\Throwable $e) {
                    Log::warning('Failed to dispatch GroupCreated', [
                        'group_id' => $group->id ?? null,
                        'error' => $e->getMessage(),
                    ]);
                }
            });
        }

        // Send creation confirmation email to the group creator
        try {
            $creator = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->select(['email', 'first_name', 'name', 'preferred_language', 'tenant_id'])
                ->first();

            if ($creator && !empty($creator->email)) {
                // Render title/preview/greeting/body/subject in the creator's
                // preferred_language so the confirmation lands in their language.
                LocaleContext::withLocale($creator, function () use ($creator, $group) {
                    $firstName  = $creator->first_name ?? $creator->name ?? __('emails.common.fallback_name');
                    $tenantName = TenantContext::getName();
                    $groupUrl   = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/groups/' . $group->id;
                    $groupName  = $group->name ?? '';

                    $html = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails_created.group.title'))
                        ->previewText(__('emails_created.group.preview', ['name' => $groupName, 'community' => $tenantName]))
                        ->greeting($firstName)
                        ->paragraph(__('emails_created.group.body', ['community' => $tenantName]))
                        ->highlight($groupName)
                        ->button(__('emails_created.group.cta'), $groupUrl)
                        ->render();

                    if (!\App\Services\EmailDispatchService::sendRaw(
                        $creator->email,
                        __('emails_created.group.subject', ['name' => $groupName, 'community' => $tenantName]),
                        $html,
                        null,
                        null,
                        null,
                        'group',
                        ['tenant_id' => (int) $creator->tenant_id]
                    )) {
                        Log::warning('[GroupService] creation email send returned false', ['group_id' => $group->id]);
                    }
                });
            }
        } catch (\Throwable $e) {
            Log::warning('[GroupService] creation email failed: ' . $e->getMessage());
        }

        return $group;
    }

    /**
     * Join a group.
     */
    public static function join(int $groupId, int $userId): array
    {
        self::$errors = [];
        $tenantId = (int) TenantContext::getId();

        $result = DB::transaction(function () use ($groupId, $userId, $tenantId): array {
            $group = self::lockJoinableMembershipGroup($groupId, $tenantId);
            if ($group === null) {
                $error = self::$errors[0] ?? ['code' => 'NOT_FOUND', 'message' => __('api.group_not_found')];
                return ['success' => false, 'code' => $error['code'], 'error' => $error['message']];
            }

            if (self::lockMembershipUser($userId, $tenantId) === null) {
                $error = self::$errors[0] ?? ['code' => 'FORBIDDEN', 'message' => __('api.forbidden')];
                return ['success' => false, 'code' => $error['code'], 'error' => $error['message']];
            }

            $membership = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('user_id', $userId)
                ->lockForUpdate()
                ->first();
            $existingStatus = (string) ($membership->status ?? '');

            if ($existingStatus === 'banned') {
                return ['success' => false, 'code' => 'BANNED', 'error' => __('api.group_banned')];
            }
            if ($existingStatus === 'active') {
                self::syncCachedMemberCount($groupId, $tenantId);
                return ['success' => true, 'status' => 'active', 'action' => 'already_member', 'activated' => false];
            }
            if ($existingStatus === 'pending') {
                return ['success' => true, 'status' => 'pending', 'action' => 'already_requested', 'activated' => false];
            }

            if ((string) $group->visibility === 'secret' && $existingStatus !== 'invited') {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_secret_invite_required')];
                return ['success' => false, 'code' => 'FORBIDDEN', 'error' => __('api.group_secret_invite_required')];
            }

            $status = $group->visibility === 'private' ? 'pending' : 'active';
            if (! self::assertMembershipCapacity($group, $userId, $tenantId, $status === 'active')) {
                $error = self::$errors[0];
                return ['success' => false, 'code' => $error['code'], 'error' => $error['message']];
            }

            self::assertSafeguardingCohortAllowed(
                $groupId,
                $userId,
                $tenantId,
                $status === 'pending' ? 'group_join_request' : 'group_join',
                $status === 'pending',
            );

            $now = now();
            if ($membership !== null) {
                DB::table('group_members')
                    ->where('id', $membership->id)
                    ->where('tenant_id', $tenantId)
                    ->update([
                        'role' => 'member',
                        'status' => $status,
                        'joined_at' => $now,
                        'updated_at' => $now,
                    ]);
            } else {
                try {
                    DB::table('group_members')->insert([
                        'tenant_id' => $tenantId,
                        'group_id' => $groupId,
                        'user_id' => $userId,
                        'role' => 'member',
                        'status' => $status,
                        'joined_at' => $now,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                } catch (\Illuminate\Database\UniqueConstraintViolationException) {
                    $winnerStatus = (string) (DB::table('group_members')
                        ->where('tenant_id', $tenantId)
                        ->where('group_id', $groupId)
                        ->where('user_id', $userId)
                        ->value('status') ?? '');
                    if ($winnerStatus === 'banned') {
                        return ['success' => false, 'code' => 'BANNED', 'error' => __('api.group_banned')];
                    }
                    if (in_array($winnerStatus, ['active', 'pending'], true)) {
                        return [
                            'success' => true,
                            'status' => $winnerStatus,
                            'action' => $winnerStatus === 'active' ? 'already_member' : 'already_requested',
                            'activated' => false,
                        ];
                    }
                    return ['success' => false, 'code' => 'ALREADY_MEMBER', 'error' => __('api.group_already_member')];
                }
            }

            self::syncCachedMemberCount($groupId, $tenantId);
            GroupAuditService::log(
                $status === 'active'
                    ? GroupAuditService::ACTION_MEMBER_JOINED
                    : GroupAuditService::ACTION_MEMBER_JOIN_REQUESTED,
                $groupId,
                $userId,
                [
                    'target_user_id' => $userId,
                    'source' => $status === 'active' ? 'direct_join' : 'join_request',
                    'membership_status' => $status,
                ],
            );
            if ($status === 'active') {
                GroupWebhookService::fire(
                    $groupId,
                    GroupWebhookService::EVENT_MEMBER_JOINED,
                    ['user_id' => $userId],
                );
            }

            return [
                'success' => true,
                'status' => $status,
                'action' => $status === 'active' ? 'joined' : 'requested',
                'activated' => $status === 'active',
            ];
        }, 3);

        if (($result['activated'] ?? false) === true) {
            self::dispatchMembershipActivatedEffects($groupId, $userId, $tenantId);
        }

        return $result;
    }

    /**
     * Leave a group.
     */
    public static function leave(int $groupId, int $userId): array
    {
        self::$errors = [];
        $tenantId = (int) TenantContext::getId();

        $result = DB::transaction(function () use ($groupId, $userId, $tenantId): array {
            /** @var Group|null $group */
            $group = Group::query()
                ->where('tenant_id', $tenantId)
                ->whereKey($groupId)
                ->lockForUpdate()
                ->first();
            if ($group === null) {
                self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_not_found')];
                return ['success' => false];
            }

            if (self::lockMembershipUser($userId, $tenantId) === null) {
                return ['success' => false];
            }

            $membership = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('user_id', $userId)
                ->lockForUpdate()
                ->first();
            if ($membership === null) {
                self::$errors[] = ['code' => 'NOT_MEMBER', 'message' => __('api.group_user_not_member')];
                return ['success' => false];
            }

            if ((string) $membership->status === 'banned') {
                self::$errors[] = ['code' => 'BANNED', 'message' => __('api.group_banned')];
                return ['success' => false];
            }

            if ((int) $group->owner_id === $userId || (string) $membership->role === 'owner') {
                self::$errors[] = ['code' => 'OWNER_CANNOT_LEAVE', 'message' => __('api.group_owner_transfer_required')];
                return ['success' => false];
            }

            $wasActive = (string) $membership->status === 'active';
            if ($wasActive && (string) $membership->role === 'admin') {
                $adminCount = DB::table('group_members')
                    ->where('tenant_id', $tenantId)
                    ->where('group_id', $groupId)
                    ->where('status', 'active')
                    ->whereIn('role', ['admin', 'owner'])
                    ->count();
                if ($adminCount <= 1) {
                    self::$errors[] = ['code' => 'SOLE_ADMIN', 'message' => __('api.group_sole_admin_transfer_required')];
                    return ['success' => false];
                }
            }

            $deleted = DB::table('group_members')
                ->where('id', $membership->id)
                ->where('tenant_id', $tenantId)
                ->delete();
            if ($deleted !== 1) {
                self::$errors[] = ['code' => 'NOT_MEMBER', 'message' => __('api.group_user_not_member')];
                return ['success' => false];
            }

            self::syncCachedMemberCount($groupId, $tenantId);
            GroupAuditService::log(
                GroupAuditService::ACTION_MEMBER_LEFT,
                $groupId,
                $userId,
                [
                    'target_user_id' => $userId,
                    'source' => 'self_leave',
                    'previous_status' => (string) $membership->status,
                    'previous_role' => (string) $membership->role,
                ],
            );
            if ($wasActive) {
                GroupWebhookService::fire(
                    $groupId,
                    GroupWebhookService::EVENT_MEMBER_LEFT,
                    ['user_id' => $userId],
                );
            }

            return [
                'success' => true,
                'status' => 'none',
                'action' => $wasActive ? 'left' : 'request_cancelled',
                'was_active' => $wasActive,
            ];
        }, 3);

        if (($result['success'] ?? false) && ($result['was_active'] ?? false)) {
            self::dispatchMembershipLeftEffects($groupId, $userId, $tenantId);
        }

        return $result;
    }

    private static function lockJoinableMembershipGroup(int $groupId, int $tenantId): ?Group
    {
        /** @var Group|null $group */
        $group = Group::query()
            ->where('tenant_id', $tenantId)
            ->whereKey($groupId)
            ->lockForUpdate()
            ->first();
        if ($group === null) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_not_found')];
            return null;
        }

        if ($group->status !== GroupStatus::Active || ! (bool) $group->is_active) {
            self::$errors[] = ['code' => 'GROUP_UNAVAILABLE', 'message' => __('api.group_join_failed')];
            return null;
        }

        return $group;
    }

    private static function lockMembershipUser(int $userId, int $tenantId): ?User
    {
        /** @var User|null $user */
        $user = User::query()
            ->where('tenant_id', $tenantId)
            ->whereKey($userId)
            ->lockForUpdate()
            ->first();
        if ($user === null) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.forbidden')];
        }

        return $user;
    }

    private static function assertMembershipCapacity(
        Group $group,
        int $userId,
        int $tenantId,
        bool $checkGroupCapacity = true,
    ): bool {
        $maxGroups = (int) GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_MAX_GROUPS_PER_USER,
            10,
        );
        if ($maxGroups > 0) {
            $activeGroupCount = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('status', 'active')
                ->count();
            if ($activeGroupCount >= $maxGroups) {
                self::$errors[] = [
                    'code' => 'MEMBERSHIP_LIMIT_REACHED',
                    'message' => __('api.group_membership_limit_reached'),
                ];
                return false;
            }
        }

        if (! $checkGroupCapacity) {
            return true;
        }

        $activeMemberCount = DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', (int) $group->id)
            ->where('status', 'active')
            ->count();
        $maxMembers = max(1, (int) GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_MAX_MEMBERS_PER_GROUP,
            500,
        ));
        if ($activeMemberCount >= $maxMembers) {
            DB::table('groups')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $group->id)
                ->update(['cached_member_count' => $activeMemberCount]);
            self::$errors[] = ['code' => 'CAPACITY_FULL', 'message' => __('api.group_capacity_full')];
            return false;
        }

        return true;
    }

    private static function syncCachedMemberCount(int $groupId, int $tenantId): int
    {
        $activeMemberCount = DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->where('status', 'active')
            ->count();

        DB::table('groups')
            ->where('tenant_id', $tenantId)
            ->where('id', $groupId)
            ->update(['cached_member_count' => $activeMemberCount]);

        return $activeMemberCount;
    }

    private static function dispatchMembershipActivatedEffects(
        int $groupId,
        int $userId,
        int $tenantId,
    ): void {
        TenantContext::runForTenant($tenantId, function () use ($groupId, $userId, $tenantId): void {
            $recipient = User::query()
                ->where('tenant_id', $tenantId)
                ->whereKey($userId)
                ->first();

            LocaleContext::withLocale($recipient, function () use ($groupId, $userId, $tenantId): void {
                try { GroupWelcomeService::sendWelcome($groupId, $userId); } catch (\Throwable $e) { Log::warning('GroupService: failed to send membership welcome', ['group_id' => $groupId, 'user_id' => $userId, 'error' => $e->getMessage()]); }
                try { GroupChallengeService::incrementProgress($groupId, 'members'); } catch (\Throwable $e) { Log::warning('GroupService: failed to increment member challenge progress', ['group_id' => $groupId, 'error' => $e->getMessage()]); }
                try { GroupMemberJoined::dispatch($groupId, $userId, $tenantId); } catch (\Throwable $e) { Log::warning('GroupService: failed to dispatch GroupMemberJoined', ['group_id' => $groupId, 'user_id' => $userId, 'error' => $e->getMessage()]); }
            });
        });
    }

    private static function dispatchMembershipLeftEffects(
        int $groupId,
        int $userId,
        int $tenantId,
    ): void {
        TenantContext::runForTenant($tenantId, function () use ($groupId, $userId, $tenantId): void {
            $recipient = User::query()
                ->where('tenant_id', $tenantId)
                ->whereKey($userId)
                ->first();

            LocaleContext::withLocale($recipient, function () use ($groupId, $userId, $tenantId): void {
                try { GroupMemberLeft::dispatch($groupId, $userId, $tenantId); } catch (\Throwable $e) { Log::warning('GroupService: failed to dispatch GroupMemberLeft', ['group_id' => $groupId, 'user_id' => $userId, 'error' => $e->getMessage()]); }
            });
        });
    }

    // -----------------------------------------------------------------
    //  Validation errors
    // -----------------------------------------------------------------

    /** @var array */
    private static array $errors = [];

    /**
     * Get validation errors from the last operation.
     */
    public static function getErrors(): array
    {
        return self::$errors;
    }

    /**
     * Validate group data and return boolean.
     *
     * @return bool True if valid, false if errors (check getErrors()).
     */
    public static function validate(array $data): bool
    {
        self::$errors = [];

        $name = $data['name'] ?? null;
        $visibility = $data['visibility'] ?? null;

        // name is required and max 255
        if ($name === null || trim((string) $name) === '' || mb_strlen(trim((string) $name)) < 3) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.name_required'), 'field' => 'name'];
        } elseif (mb_strlen($name) > 255) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_name_max_255'), 'field' => 'name'];
        }

        // Preserve every visibility value advertised by templates/forms.
        if ($visibility !== null && !in_array($visibility, ['public', 'private', 'secret'], true)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_visibility_invalid'), 'field' => 'visibility'];
        }

        return empty(self::$errors);
    }

    private static function validateCreationPolicy(int $userId, array $data): bool
    {
        $userExists = User::query()->whereKey($userId)->exists();
        if (! $userExists) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.forbidden')];
            return false;
        }

        if (
            ! (bool) GroupConfigurationService::get(
                GroupConfigurationService::CONFIG_ALLOW_USER_GROUP_CREATION,
                true,
            )
            && ! GroupAccessService::isTenantAdmin($userId)
        ) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.forbidden')];
        }

        $maxGroups = max(0, (int) GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_MAX_GROUPS_PER_USER,
            10,
        ));
        $ownedGroupCount = Group::query()
            ->where('owner_id', $userId)
            ->inStates([
                GroupStatus::PendingReview,
                GroupStatus::Active,
                GroupStatus::Dormant,
            ])
            ->count();
        if ($ownedGroupCount >= $maxGroups) {
            self::$errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.rate_limit_exceeded'),
            ];
        }

        if (
            in_array(($data['visibility'] ?? 'public'), ['private', 'secret'], true)
            && ! (bool) GroupConfigurationService::get(
                GroupConfigurationService::CONFIG_ALLOW_PRIVATE_GROUPS,
                true,
            )
        ) {
            self::$errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.group_visibility_invalid'),
                'field' => 'visibility',
            ];
        }

        $description = trim((string) ($data['description'] ?? ''));
        $minimum = max(0, (int) GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_MIN_DESCRIPTION_LENGTH,
            10,
        ));
        $maximum = max($minimum, (int) GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_MAX_DESCRIPTION_LENGTH,
            5000,
        ));
        $descriptionLength = mb_strlen($description);

        if ($descriptionLength < $minimum) {
            self::$errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.description_required'),
                'field' => 'description',
            ];
        } elseif ($descriptionLength > $maximum) {
            self::$errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.safeguarding_description_too_long'),
                'field' => 'description',
            ];
        }

        return self::$errors === [];
    }

    /**
     * Normalize the location triplet. A changed/cleared label can never retain
     * coordinates selected for a previous label.
     */
    private static function normalizeLocationPayload(array $data, ?Group $existing = null): ?array
    {
        $hasLocation = array_key_exists('location', $data);
        $hasLatitude = array_key_exists('latitude', $data);
        $hasLongitude = array_key_exists('longitude', $data);
        if (! $hasLocation && ! $hasLatitude && ! $hasLongitude) {
            return $data;
        }

        $location = $hasLocation
            ? trim((string) ($data['location'] ?? ''))
            : trim((string) ($existing?->location ?? ''));
        if (mb_strlen($location) > 255) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_location_too_long'), 'field' => 'location'];
            return null;
        }
        $data['location'] = $location !== '' ? $location : null;

        if ($location === '') {
            $data['latitude'] = null;
            $data['longitude'] = null;
            return $data;
        }

        $latitudeSupplied = $hasLatitude && $data['latitude'] !== null && $data['latitude'] !== '';
        $longitudeSupplied = $hasLongitude && $data['longitude'] !== null && $data['longitude'] !== '';
        if ($latitudeSupplied xor $longitudeSupplied) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_coordinates_pair_required'), 'field' => 'location'];
            return null;
        }

        if ($latitudeSupplied && $longitudeSupplied) {
            if (! is_numeric($data['latitude']) || ! is_numeric($data['longitude'])) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_coordinates_invalid'), 'field' => 'location'];
                return null;
            }
            $latitude = (float) $data['latitude'];
            $longitude = (float) $data['longitude'];
            if ($latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_coordinates_invalid'), 'field' => 'location'];
                return null;
            }
            $data['latitude'] = $latitude;
            $data['longitude'] = $longitude;
            return $data;
        }

        if ($existing === null || ($hasLocation && $location !== trim((string) $existing->location))) {
            $data['latitude'] = null;
            $data['longitude'] = null;
        }

        return $data;
    }

    /** Normalize nullable group brand colours to canonical #RRGGBB values. */
    private static function normalizeBrandColors(array $data): ?array
    {
        foreach (['primary_color', 'accent_color'] as $field) {
            if (! array_key_exists($field, $data)) {
                continue;
            }
            $value = trim((string) ($data[$field] ?? ''));
            if ($value === '') {
                $data[$field] = null;
                continue;
            }
            if (preg_match('/^#[0-9A-Fa-f]{6}$/D', $value) !== 1) {
                self::$errors[] = [
                    'code' => 'VALIDATION_ERROR',
                    'message' => __('api.group_color_invalid'),
                    'field' => $field,
                ];
                return null;
            }
            $data[$field] = strtoupper($value);
        }

        return $data;
    }

    private static function validateFormRelations(
        int $userId,
        array $data,
        ?int $editingGroupId = null,
    ): bool {
        $tenantId = (int) TenantContext::getId();

        if (array_key_exists('type_id', $data) && $data['type_id'] !== null && $data['type_id'] !== '') {
            if (! is_numeric($data['type_id']) || (int) $data['type_id'] < 1
                || ! DB::table('group_types')
                    ->where('id', (int) $data['type_id'])
                    ->where('tenant_id', $tenantId)
                    ->where('is_active', 1)
                    ->exists()) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_type_invalid'), 'field' => 'type_id'];
            }
        }

        $parentId = $data['parent_id'] ?? null;
        if ($parentId !== null && $parentId !== '') {
            if (! is_numeric($parentId) || (int) $parentId < 1) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_parent_invalid'), 'field' => 'parent_id'];
            } else {
                $parentId = (int) $parentId;
                $parent = DB::table('groups')
                    ->where('id', $parentId)
                    ->where('tenant_id', $tenantId)
                    ->where('status', GroupStatus::Active->value)
                    ->where('is_active', 1)
                    ->first(['id', 'parent_id']);
                if ($parent === null || ! GroupAccessService::canManage($parentId, $userId)) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_parent_invalid'), 'field' => 'parent_id'];
                } elseif ($editingGroupId !== null) {
                    $cursor = $parent;
                    $visited = [];
                    while ($cursor !== null) {
                        $cursorId = (int) $cursor->id;
                        if ($cursorId === $editingGroupId || isset($visited[$cursorId])) {
                            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_parent_cycle'), 'field' => 'parent_id'];
                            break;
                        }
                        $visited[$cursorId] = true;
                        $nextId = $cursor->parent_id !== null ? (int) $cursor->parent_id : 0;
                        if ($nextId < 1) {
                            break;
                        }
                        $cursor = DB::table('groups')
                            ->where('id', $nextId)
                            ->where('tenant_id', $tenantId)
                            ->first(['id', 'parent_id']);
                    }
                }
            }
        }

        if (! empty($data['_template_tags'])) {
            $tagIds = array_values(array_unique(array_filter(
                array_map('intval', (array) $data['_template_tags']),
                static fn (int $tagId): bool => $tagId > 0,
            )));
            $validCount = DB::table('group_tags')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $tagIds)
                ->count();
            if ($validCount !== count($tagIds)) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_template_invalid'), 'field' => 'template_id'];
            }
        }

        return self::$errors === [];
    }

    // -----------------------------------------------------------------
    //  Update
    // -----------------------------------------------------------------

    /**
     * Update a group.
     */
    public static function update(
        int $id,
        int $userId,
        array $data,
        bool $trustedImageUpdate = false,
    ): bool
    {
        self::$errors = [];

        /** @var Group|null $group */
        $group = Group::query()->find($id);

        if (! $group) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_not_found')];
            return false;
        }

        if (! self::canModify($id, $userId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_edit_forbidden')];
            return false;
        }

        $normalized = self::normalizeLocationPayload($data, $group);
        if ($normalized === null) {
            return false;
        }
        $data = $normalized;
        $normalizedColors = self::normalizeBrandColors($data);
        if ($normalizedColors === null) {
            return false;
        }
        $data = $normalizedColors;

        if (array_key_exists('name', $data)) {
            $name = trim((string) $data['name']);
            if ($name === '' || mb_strlen($name) < 3) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.name_required'), 'field' => 'name'];
            } elseif (mb_strlen($name) > 255) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_name_max_255'), 'field' => 'name'];
            }
            $data['name'] = $name;
        }

        if (
            array_key_exists('visibility', $data)
            && $data['visibility'] !== null
            && ! in_array($data['visibility'], ['public', 'private', 'secret'], true)
        ) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_visibility_invalid'), 'field' => 'visibility'];
        }

        if (
            array_key_exists('federated_visibility', $data)
            && ! in_array($data['federated_visibility'], ['none', 'listed', 'joinable'], true)
        ) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.invalid_input'), 'field' => 'federated_visibility'];
        }

        if (array_key_exists('visibility', $data)
            && in_array($data['visibility'], ['private', 'secret'], true)
            && ! (bool) GroupConfigurationService::get(GroupConfigurationService::CONFIG_ALLOW_PRIVATE_GROUPS, true)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_visibility_invalid'), 'field' => 'visibility'];
        }

        if (array_key_exists('description', $data)) {
            $description = trim((string) $data['description']);
            $minimum = max(0, (int) GroupConfigurationService::get(GroupConfigurationService::CONFIG_MIN_DESCRIPTION_LENGTH, 10));
            $maximum = max($minimum, (int) GroupConfigurationService::get(GroupConfigurationService::CONFIG_MAX_DESCRIPTION_LENGTH, 5000));
            if (mb_strlen($description) < $minimum) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.description_required'), 'field' => 'description'];
            } elseif (mb_strlen($description) > $maximum) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.safeguarding_description_too_long'), 'field' => 'description'];
            }
            $data['description'] = $description;
        }

        if (! self::validateFormRelations($userId, $data, $id)) {
            return false;
        }

        if (! empty(self::$errors)) {
            return false;
        }

        $allowed = ['name', 'description', 'visibility', 'location', 'latitude', 'longitude', 'type_id', 'parent_id', 'federated_visibility', 'primary_color', 'accent_color'];
        if ($trustedImageUpdate) {
            $allowed[] = 'image_url';
            $allowed[] = 'cover_image_url';
        }
        $updates = collect($data)->only($allowed)->all();

        if (! empty($updates)) {
            $originalParentId = $group->parent_id !== null ? (int) $group->parent_id : null;
            $group = DB::transaction(function () use ($id, $userId, $updates, $originalParentId): Group {
                /** @var Group $locked */
                $locked = Group::query()->whereKey($id)->lockForUpdate()->firstOrFail();
                $locked->fill($updates);
                $locked->save();

                $nextParentId = $locked->parent_id !== null ? (int) $locked->parent_id : null;
                if ($nextParentId !== $originalParentId) {
                    if ($nextParentId !== null) {
                        Group::query()->whereKey($nextParentId)->update(['has_children' => true]);
                    }
                    if ($originalParentId !== null) {
                        $stillHasChildren = Group::query()
                            ->where('parent_id', $originalParentId)
                            ->whereKeyNot($id)
                            ->exists();
                        Group::query()->whereKey($originalParentId)->update(['has_children' => $stillHasChildren]);
                    }
                }

                GroupAuditService::log(
                    GroupAuditService::ACTION_GROUP_UPDATED,
                    $id,
                    $userId,
                    ['fields' => array_values(array_keys($updates))],
                );

                return $locked;
            }, 3);

            $eventGroup = $group->fresh() ?? $group;
            $eventTenantId = (int) TenantContext::getId();
            DB::afterCommit(static function () use ($eventGroup, $eventTenantId): void {
                try {
                    GroupUpdated::dispatch($eventGroup, $eventTenantId);
                } catch (\Throwable $e) {
                    Log::warning('Failed to dispatch GroupUpdated', [
                        'group_id' => $eventGroup->id ?? null,
                        'error' => $e->getMessage(),
                    ]);
                }
            });
        }

        return true;
    }

    // -----------------------------------------------------------------
    //  Delete
    // -----------------------------------------------------------------

    /**
     * Delete a group.
     */
    public static function delete(int $id, int $userId): bool
    {
        self::$errors = [];

        /** @var Group|null $group */
        $group = Group::query()->find($id);

        if (! $group) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_not_found')];
            return false;
        }

        // Only owner or platform admin can delete
        if ((int) $group->owner_id !== $userId && ! self::isPlatformAdmin($userId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_delete_forbidden')];
            return false;
        }

        $groupName = $group->name;
        // Defense-in-depth (2026-07-09 audit): the parent load above is
        // tenant-scoped + owner-checked, but every cascade DELETE/UPDATE below
        // also carries the tenant filter so a copy-paste into an unscoped
        // context can never cross tenants. Child-of-child tables without a
        // tenant_id column (subscribers, chatroom messages, wiki revisions)
        // inherit scoping from these tenant-filtered parent-id lists.
        $tenantId = (int) TenantContext::getId();

        $deleted = DB::transaction(function () use ($group, $id, $userId, $groupName, $tenantId): bool {
            ActivityLog::log(
                $userId,
                'group_deleted',
                json_encode(['group_id' => $id, 'group_name' => $groupName], JSON_THROW_ON_ERROR),
                false,
                null,
                'admin',
                'group',
                $id,
            );

            // Fetch active members before deleting (to notify them)
            $memberIds = DB::table('group_members')
                ->where('group_id', $id)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->where('user_id', '!=', $userId)
                ->pluck('user_id')
                ->all();

            // Delete group members
            DB::table('group_members')->where('group_id', $id)->where('tenant_id', $tenantId)->delete();

            // Delete discussion posts, then discussions
            $discussionIds = GroupDiscussion::withoutGlobalScopes()
                ->where('group_id', $id)
                ->where('tenant_id', $tenantId)
                ->pluck('id')
                ->all();

            if (! empty($discussionIds)) {
                if (Schema::hasTable('group_discussion_subscribers')) {
                    DB::table('group_discussion_subscribers')->whereIn('discussion_id', $discussionIds)->delete();
                }

                GroupPost::withoutGlobalScopes()
                    ->whereIn('discussion_id', $discussionIds)
                    ->delete();

                GroupDiscussion::withoutGlobalScopes()
                    ->where('group_id', $id)
                    ->where('tenant_id', $tenantId)
                    ->delete();
            }

            // Disassociate events from this group (preserve events, clear group_id)
            DB::table('events')
                ->where('group_id', $id)
                ->where('tenant_id', $tenantId)
                ->update(['group_id' => null]);

            // Delete chatroom messages and chatrooms
            $chatroomIds = DB::table('group_chatrooms')
                ->where('group_id', $id)
                ->where('tenant_id', $tenantId)
                ->pluck('id')
                ->all();

            if (! empty($chatroomIds)) {
                $placeholders = implode(',', array_fill(0, count($chatroomIds), '?'));
                DB::delete("DELETE FROM group_chatroom_messages WHERE chatroom_id IN ({$placeholders})", $chatroomIds);
                DB::delete("DELETE FROM group_chatroom_pinned_messages WHERE chatroom_id IN ({$placeholders})", $chatroomIds);
                DB::table('group_chatrooms')->where('group_id', $id)->where('tenant_id', $tenantId)->delete();
            }

            self::deleteRelatedGroupRecords($id, $tenantId);

            // Delete the group itself
            $group->delete();

            return true;
        });

        if ($deleted) {
            DB::afterCommit(static function () use ($id, $tenantId, $groupName): void {
                try {
                    GroupDeleted::dispatch($id, $tenantId, $groupName);
                } catch (\Throwable $e) {
                    Log::warning('Failed to dispatch GroupDeleted', [
                        'group_id' => $id,
                        'error' => $e->getMessage(),
                    ]);
                }
            });
        }

        return $deleted;
    }

    private static function deleteRelatedGroupRecords(int $groupId, int $tenantId): void
    {
        if (Schema::hasTable('group_wiki_pages')) {
            $pageIds = DB::table('group_wiki_pages')->where('group_id', $groupId)->where('tenant_id', $tenantId)->pluck('id')->all();
            if (! empty($pageIds) && Schema::hasTable('group_wiki_revisions')) {
                // group_wiki_revisions has no tenant_id column — scoped via the
                // tenant-filtered page-id list above.
                DB::table('group_wiki_revisions')->whereIn('page_id', $pageIds)->delete();
            }
            DB::table('group_wiki_pages')->where('group_id', $groupId)->where('tenant_id', $tenantId)->delete();
        }

        if (Schema::hasTable('group_questions')) {
            $questionIds = DB::table('group_questions')->where('group_id', $groupId)->where('tenant_id', $tenantId)->pluck('id')->all();
            if (! empty($questionIds)) {
                if (Schema::hasTable('group_answers')) {
                    $answerIds = DB::table('group_answers')->whereIn('question_id', $questionIds)->pluck('id')->all();
                    if (! empty($answerIds) && Schema::hasTable('group_qa_votes')) {
                        DB::table('group_qa_votes')->where('votable_type', 'answer')->whereIn('votable_id', $answerIds)->delete();
                    }
                    DB::table('group_answers')->whereIn('question_id', $questionIds)->delete();
                }
                if (Schema::hasTable('group_qa_votes')) {
                    DB::table('group_qa_votes')->where('votable_type', 'question')->whereIn('votable_id', $questionIds)->delete();
                }
            }
            DB::table('group_questions')->where('group_id', $groupId)->where('tenant_id', $tenantId)->delete();
        }

        // Tables without a tenant_id column — group_id alone is the only key
        // available; the parent group was tenant-checked before the cascade.
        foreach (['group_custom_field_values', 'group_tag_assignments'] as $table) {
            if (Schema::hasTable($table)) {
                DB::table($table)->where('group_id', $groupId)->delete();
            }
        }

        foreach ([
            'group_announcements',
            'group_audit_log',
            'group_approval_requests',
            'group_challenges',
            'group_chatrooms',
            'group_files',
            'group_invites',
            'group_media',
            'group_notification_preferences',
            'group_scheduled_posts',
            'group_views',
            'group_webhooks',
        ] as $table) {
            if (Schema::hasTable($table)) {
                DB::table($table)->where('group_id', $groupId)->where('tenant_id', $tenantId)->delete();
            }
        }

        if (Schema::hasTable('group_content_flags')) {
            DB::table('group_content_flags')
                ->where('content_type', 'group')
                ->where('content_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->delete();
        }

        if (Schema::hasTable('group_policies')) {
            DB::table('group_policies')
                ->whereIn('policy_key', GroupWelcomeService::policyKeysForGroup($groupId))
                ->where('tenant_id', $tenantId)
                ->delete();
        }
    }

    // -----------------------------------------------------------------
    //  Members
    // -----------------------------------------------------------------

    /**
     * Get members of a group with cursor-based pagination.
     */
    public static function getMembers(int $groupId, array $filters = []): ?array
    {
        self::$errors = [];
        $limit = max(1, min((int) ($filters['limit'] ?? 20), 100));
        $role = $filters['role'] ?? null;
        $cursor = $filters['cursor'] ?? null;
        $search = is_scalar($filters['q'] ?? null)
            ? preg_replace('/\s+/u', ' ', trim((string) $filters['q']))
            : '';
        $search = mb_strtolower(is_string($search) ? $search : '');
        if (mb_strlen($search) > 100) {
            self::$errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.group_member_search_too_long'),
                'field' => 'q',
            ];
            return null;
        }
        $viewerUserId = isset($filters['viewer_user_id']) ? (int) $filters['viewer_user_id'] : null;
        $tenantId = (int) TenantContext::getId();

        /** @var Group|null $group */
        $group = Group::query()->where('tenant_id', $tenantId)->find($groupId);
        $viewerCanManageMembers = $group !== null
            && $viewerUserId !== null
            && GroupAccessService::canManageMembers($groupId, $viewerUserId);
        $viewerCanManageAdmins = $viewerCanManageMembers
            && $group !== null
            && self::canManageGroupAdmins($group, $viewerUserId);

        $query = DB::table('group_members')
            ->join('users', 'group_members.user_id', '=', 'users.id')
            ->where('group_members.group_id', $groupId)
            ->where('group_members.tenant_id', $tenantId)
            ->where('users.tenant_id', $tenantId)
            ->whereIn('group_members.group_id', function ($q) use ($tenantId) {
                $q->select('id')->from('groups')->where('tenant_id', $tenantId);
            })
            ->where('group_members.status', 'active')
            ->select([
                'group_members.id as membership_id',
                'group_members.user_id',
                'group_members.role',
                'group_members.created_at as joined_at',
                DB::raw("FIELD(group_members.role, 'owner', 'admin', 'member') as role_rank"),
                'users.first_name',
                'users.last_name',
                'users.avatar_url',
            ]);

        if ($role) {
            $query->where('group_members.role', $role);
        }

        if ($search !== '') {
            $pattern = '%' . addcslashes($search, '\\%_') . '%';
            $query->where(function ($names) use ($pattern): void {
                $names->whereRaw('LOWER(users.first_name) LIKE ?', [$pattern])
                    ->orWhereRaw('LOWER(users.last_name) LIKE ?', [$pattern])
                    ->orWhereRaw("LOWER(CONCAT_WS(' ', users.first_name, users.last_name)) LIKE ?", [$pattern]);
            });
        }

        if ($cursor !== null && $cursor !== '') {
            $payload = is_string($cursor) ? CursorSigner::decode($cursor) : null;
            if (
                !is_array($payload)
                || ($payload['kind'] ?? null) !== 'group_members'
                || (int) ($payload['tenant_id'] ?? 0) !== $tenantId
                || (int) ($payload['group_id'] ?? 0) !== $groupId
                || ($payload['role'] ?? null) !== $role
                || ($payload['q'] ?? '') !== $search
                || !isset($payload['role_rank'], $payload['membership_id'])
                || !is_numeric($payload['role_rank'])
                || !is_numeric($payload['membership_id'])
            ) {
                self::$errors[] = ['code' => 'INVALID_CURSOR', 'message' => __('api.invalid_cursor')];
                return null;
            }

            $roleRank = (int) $payload['role_rank'];
            $membershipId = (int) $payload['membership_id'];
            if (!in_array($roleRank, [1, 2, 3], true) || $membershipId <= 0) {
                self::$errors[] = ['code' => 'INVALID_CURSOR', 'message' => __('api.invalid_cursor')];
                return null;
            }

            $query->where(function ($after) use ($roleRank, $membershipId): void {
                $after->whereRaw("FIELD(group_members.role, 'owner', 'admin', 'member') > ?", [$roleRank])
                    ->orWhere(function ($sameRole) use ($roleRank, $membershipId): void {
                        $sameRole
                            ->whereRaw("FIELD(group_members.role, 'owner', 'admin', 'member') = ?", [$roleRank])
                            ->where('group_members.id', '>', $membershipId);
                    });
            });
        }

        $query->orderByRaw("FIELD(group_members.role, 'owner', 'admin', 'member')")
              ->orderBy('group_members.id');

        $members = $query->limit($limit + 1)->get();

        $hasMore = $members->count() > $limit;
        if ($hasMore) {
            $members->pop();
        }

        $items = $members->map(function ($m) use ($group, $viewerUserId, $viewerCanManageMembers, $viewerCanManageAdmins): array {
            $targetUserId = (int) $m->user_id;
            $targetRole = in_array((string) $m->role, ['member', 'admin', 'owner'], true)
                ? (string) $m->role
                : 'member';
            $isOwner = $group !== null
                && ((int) $group->owner_id === $targetUserId || $targetRole === 'owner');
            $isSelf = $viewerUserId === $targetUserId;
            $targetIsAdmin = in_array($targetRole, ['admin', 'owner'], true);

            return [
                'id' => $targetUserId,
                'name' => UserDisplayName::resolve($m),
                'avatar_url' => $m->avatar_url,
                'role' => $targetRole,
                'joined_at' => $m->joined_at,
                'capabilities' => [
                    'can_change_role' => $viewerCanManageAdmins && ! $isOwner && ! $isSelf,
                    'can_remove' => $viewerCanManageMembers
                        && ! $isOwner
                        && ! $isSelf
                        && (! $targetIsAdmin || $viewerCanManageAdmins),
                ],
            ];
        })->all();

        $last = $members->last();

        return [
            'items'    => $items,
            'cursor'   => $hasMore && $last !== null
                ? CursorSigner::encode([
                    'kind' => 'group_members',
                    'tenant_id' => $tenantId,
                    'group_id' => $groupId,
                    'role' => $role,
                    'q' => $search,
                    'role_rank' => (int) $last->role_rank,
                    'membership_id' => (int) $last->membership_id,
                ])
                : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Update a member's role in a group.
     */
    public static function updateMemberRole(int $groupId, int $targetUserId, int $actingUserId, string $role): bool
    {
        self::$errors = [];

        if (! in_array($role, ['admin', 'member'])) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.invalid_role'), 'field' => 'role'];
            return false;
        }

        $tenantId = (int) TenantContext::getId();
        $group = null;
        $changed = false;

        $success = DB::transaction(function () use (
            $groupId,
            $targetUserId,
            $actingUserId,
            $role,
            $tenantId,
            &$group,
            &$changed,
        ): bool {
            $group = self::lockJoinableMembershipGroup($groupId, $tenantId);
            if ($group === null) {
                return false;
            }
            if (! GroupAccessService::canManageMembers($groupId, $actingUserId)) {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_manage_members_forbidden')];
                return false;
            }

            $membership = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('user_id', $targetUserId)
                ->lockForUpdate()
                ->first();
            if ($membership === null || (string) $membership->status !== 'active') {
                self::$errors[] = ['code' => 'NOT_MEMBER', 'message' => __('api.group_user_not_member')];
                return false;
            }

            if ((int) $group->owner_id === $targetUserId || (string) $membership->role === 'owner') {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_cannot_change_owner_role')];
                return false;
            }
            if ($targetUserId === $actingUserId) {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_manage_admins_forbidden')];
                return false;
            }
            if (
                ($role === 'admin' || (string) $membership->role === 'admin')
                && ! self::canManageGroupAdmins($group, $actingUserId)
            ) {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_manage_admins_forbidden')];
                return false;
            }

            if ((string) $membership->role === $role) {
                return true;
            }

            $previousRole = (string) $membership->role;
            $changed = DB::table('group_members')
                ->where('id', $membership->id)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->update(['role' => $role, 'updated_at' => now()]) === 1;

            if ($changed) {
                GroupAuditService::log(
                    GroupAuditService::ACTION_MEMBER_ROLE_CHANGED,
                    $groupId,
                    $actingUserId,
                    [
                        'target_user_id' => $targetUserId,
                        'old_role' => $previousRole,
                        'new_role' => $role,
                    ],
                );
            }

            return $changed;
        }, 3);

        if (! $success) {
            return false;
        }

        // Email promoted member when they become an admin
        if ($role === 'admin' && $changed && $group !== null) {
            try {
                $tenantId = TenantContext::getId();
                $member = DB::table('users')
                    ->where('id', $targetUserId)
                    ->where('tenant_id', $tenantId)
                    ->select(['email', 'first_name', 'name', 'preferred_language', 'tenant_id'])
                    ->first();
                if ($member && !empty($member->email)) {
                    // Render subject + body in the promoted member's locale.
                    LocaleContext::withLocale($member, function () use ($member, $group, $groupId) {
                        $firstName  = $member->first_name ?? $member->name ?? __('emails.common.fallback_name');
                        $community  = TenantContext::getName();
                        $groupName  = htmlspecialchars($group->name, ENT_QUOTES, 'UTF-8');
                        $roleLabel  = __('emails_commerce.group_promoted.role_admin');
                        $groupUrl   = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/groups/' . $groupId;
                        $html = EmailTemplateBuilder::make()
                            ->theme('success')
                            ->title(__('emails_commerce.group_promoted.title'))
                            ->greeting($firstName)
                            ->paragraph(__('emails_commerce.group_promoted.body', ['role' => $roleLabel, 'group_name' => $groupName, 'community' => $community]))
                            ->paragraph(__('emails_commerce.group_promoted.responsibilities', ['role' => $roleLabel]))
                            ->button(__('emails_commerce.group_promoted.cta'), $groupUrl)
                            ->render();
                        if (!\App\Services\EmailDispatchService::sendRaw(
                            $member->email,
                            __('emails_commerce.group_promoted.subject', ['role' => $roleLabel, 'group_name' => $groupName, 'community' => $community]),
                            $html,
                            null,
                            null,
                            null,
                            'group',
                            ['tenant_id' => (int) $member->tenant_id]
                        )) {
                            Log::warning('[GroupService] group_promoted email send returned false', ['group_id' => $groupId]);
                        }
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('[GroupService] group_promoted email failed: ' . $e->getMessage());
            }
        }

        return true;
    }

    /**
     * Remove a member from a group.
     */
    public static function removeMember(int $groupId, int $targetUserId, int $actingUserId): bool
    {
        self::$errors = [];
        $tenantId = (int) TenantContext::getId();
        $group = null;

        $removed = DB::transaction(function () use (
            $groupId,
            $targetUserId,
            $actingUserId,
            $tenantId,
            &$group,
        ): bool {
            $group = self::lockJoinableMembershipGroup($groupId, $tenantId);
            if ($group === null) {
                return false;
            }
            if (! GroupAccessService::canManageMembers($groupId, $actingUserId)) {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_remove_members_forbidden')];
                return false;
            }
            if ((int) $group->owner_id === $targetUserId) {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_cannot_remove_owner')];
                return false;
            }
            if ($targetUserId === $actingUserId) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_use_leave_endpoint')];
                return false;
            }
            if (self::lockMembershipUser($targetUserId, $tenantId) === null) {
                self::$errors = [['code' => 'NOT_MEMBER', 'message' => __('api.group_user_not_member')]];
                return false;
            }

            $membership = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('user_id', $targetUserId)
                ->lockForUpdate()
                ->first();
            if ($membership === null || (string) $membership->status !== 'active') {
                self::$errors[] = ['code' => 'NOT_MEMBER', 'message' => __('api.group_user_not_member')];
                return false;
            }
            if ((string) $membership->role === 'owner') {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_cannot_remove_owner')];
                return false;
            }
            if ((string) $membership->role === 'admin' && ! self::canManageGroupAdmins($group, $actingUserId)) {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_manage_admins_forbidden')];
                return false;
            }

            $deleted = DB::table('group_members')
                ->where('id', $membership->id)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->delete();
            if ($deleted !== 1) {
                self::$errors[] = ['code' => 'NOT_MEMBER', 'message' => __('api.group_user_not_member')];
                return false;
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_MEMBER_REMOVED,
                $groupId,
                $actingUserId,
                [
                    'target_user_id' => $targetUserId,
                    'old_role' => (string) $membership->role,
                ],
            );

            self::syncCachedMemberCount($groupId, $tenantId);
            GroupWebhookService::fire(
                $groupId,
                GroupWebhookService::EVENT_MEMBER_LEFT,
                ['user_id' => $targetUserId, 'removed_by' => $actingUserId],
            );
            return true;
        }, 3);

        if (! $removed || $group === null) {
            return false;
        }

        self::dispatchMembershipLeftEffects($groupId, $targetUserId, $tenantId);

        // Email + bell to removed member — both rendered in their locale.
        try {
            $member = DB::table('users')
                ->where('id', $targetUserId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'first_name', 'name', 'preferred_language', 'tenant_id'])
                ->first();

            LocaleContext::withLocale($member, function () use ($member, $group, $targetUserId, $tenantId) {
                // Email (only if we have contact details)
                if ($member && !empty($member->email)) {
                    try {
                        $firstName = $member->first_name ?? $member->name ?? __('emails.common.fallback_name');
                        $community = TenantContext::getName();
                        $groupName = htmlspecialchars($group->name, ENT_QUOTES, 'UTF-8');
                        $browseUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/groups';
                        $html = EmailTemplateBuilder::make()
                            ->theme('warning')
                            ->title(__('emails_commerce.group_removed.title'))
                            ->greeting($firstName)
                            ->paragraph(__('emails_commerce.group_removed.body', ['group_name' => $groupName, 'community' => $community]))
                            ->paragraph(__('emails_commerce.group_removed.suggestion'))
                            ->button(__('emails_commerce.group_removed.cta'), $browseUrl)
                            ->render();
                        if (!\App\Services\EmailDispatchService::sendRaw(
                            $member->email,
                            __('emails_commerce.group_removed.subject', ['group_name' => $groupName, 'community' => $community]),
                            $html,
                            null,
                            null,
                            null,
                            'group',
                            ['tenant_id' => (int) $tenantId]
                        )) {
                            Log::warning('[GroupService] group_removed email send returned false', ['group_id' => $group->id]);
                        }
                    } catch (\Throwable $e) {
                        Log::warning('[GroupService] group_removed email failed: ' . $e->getMessage());
                    }
                }

                // In-app bell to removed member
                Notification::create([
                    'user_id'    => $targetUserId,
                    'message'    => __('api_controllers_3.admin_bells.group_member_removed', ['group' => $group->name]),
                    'link'       => '/groups',
                    'type'       => 'group_member_removed',
                    'created_at' => now(),
                ]);
            });
        } catch (\Throwable $e) {
            Log::warning('[GroupService] group_removed notification failed: ' . $e->getMessage());
        }

        return true;
    }

    // -----------------------------------------------------------------
    //  Join requests
    // -----------------------------------------------------------------

    /**
     * Get pending join requests for a group (admin only).
     */
    public static function getPendingRequests(int $groupId, int $adminUserId): ?array
    {
        self::$errors = [];

        if (! self::canModify($groupId, $adminUserId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_view_join_requests_forbidden')];
            return null;
        }

        $tenantId = \App\Core\TenantContext::getId();

        $pending = DB::table('group_members')
            ->join('users', 'group_members.user_id', '=', 'users.id')
            ->where('group_members.group_id', $groupId)
            ->where('group_members.tenant_id', $tenantId)
            ->where('group_members.status', 'pending')
            ->select([
                'users.id',
                'users.first_name',
                'users.last_name', 'users.profile_type', 'users.organization_name',
                'users.avatar_url',
                'group_members.created_at as requested_at',
            ])
            ->get();

        return $pending->map(function ($p) {
            $name = UserDisplayName::resolve($p);

            return [
                // Legacy flat keys (kept for backward compatibility with existing clients)
                'id'         => (int) $p->id,
                'name'       => $name,
                'avatar_url' => $p->avatar_url,
                // Shape the React frontend's JoinRequest contract expects
                // (user_id + nested user + created_at). Without these the join-
                // requests panel crashed on request.user.avatar being undefined.
                'user_id'    => (int) $p->id,
                'user'       => [
                    'id'     => (int) $p->id,
                    'name'   => $name,
                    'avatar' => $p->avatar_url,
                ],
                'created_at' => $p->requested_at,
            ];
        })->all();
    }

    /**
     * Handle a join request (accept/reject).
     */
    public static function handleJoinRequest(int $groupId, int $requesterId, int $adminUserId, string $action): bool
    {
        self::$errors = [];

        if (! in_array($action, ['accept', 'reject'])) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_action_accept_or_reject'), 'field' => 'action'];
            return false;
        }

        $tenantId = (int) TenantContext::getId();
        $activated = false;

        $success = DB::transaction(function () use (
            $groupId,
            $requesterId,
            $adminUserId,
            $action,
            $tenantId,
            &$activated,
        ): bool {
            $group = self::lockJoinableMembershipGroup($groupId, $tenantId);
            if ($group === null) {
                return false;
            }
            if (! GroupAccessService::canManageMembers($groupId, $adminUserId)) {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_handle_join_requests_forbidden')];
                return false;
            }

            $membership = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('user_id', $requesterId)
                ->lockForUpdate()
                ->first();
            if ($membership === null || (string) $membership->status !== 'pending') {
                self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.pending_request_not_found')];
                return false;
            }

            if ($action === 'reject') {
                $deleted = DB::table('group_members')
                    ->where('id', $membership->id)
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'pending')
                    ->delete();
                self::syncCachedMemberCount($groupId, $tenantId);
                if ($deleted !== 1) {
                    return false;
                }
                GroupAuditService::log(
                    GroupAuditService::ACTION_MEMBER_JOIN_REJECTED,
                    $groupId,
                    $adminUserId,
                    [
                        'target_user_id' => $requesterId,
                        'source' => 'join_request_rejection',
                        'previous_status' => 'pending',
                    ],
                );
                return true;
            }

            if (self::lockMembershipUser($requesterId, $tenantId) === null) {
                self::$errors = [['code' => 'NOT_FOUND', 'message' => __('api.pending_request_not_found')]];
                return false;
            }
            if (! self::assertMembershipCapacity($group, $requesterId, $tenantId)) {
                return false;
            }

            self::assertSafeguardingCohortAllowed(
                $groupId,
                $requesterId,
                $tenantId,
                'group_join_request_accept',
            );

            $activated = DB::table('group_members')
                ->where('id', $membership->id)
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->update([
                    'status' => 'active',
                    'joined_at' => now(),
                    'updated_at' => now(),
                ]) === 1;
            if (! $activated) {
                self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.pending_request_not_found')];
                return false;
            }

            self::syncCachedMemberCount($groupId, $tenantId);
            GroupAuditService::log(
                GroupAuditService::ACTION_MEMBER_JOINED,
                $groupId,
                $adminUserId,
                [
                    'target_user_id' => $requesterId,
                    'source' => 'join_request_approval',
                    'membership_status' => 'active',
                ],
            );
            GroupWebhookService::fire(
                $groupId,
                GroupWebhookService::EVENT_MEMBER_JOINED,
                ['user_id' => $requesterId, 'approved_by' => $adminUserId],
            );
            return true;
        }, 3);

        if ($success && $activated) {
            self::dispatchMembershipActivatedEffects($groupId, $requesterId, $tenantId);
        }

        return $success;
    }

    /**
     * A group membership exposes a member to the active cohort. Check both
     * directions before activating membership; for a private join request the
     * initial directed contact is limited to the group's administrators.
     */
    public static function assertSafeguardingCohortAllowed(
        int $groupId,
        int $joiningUserId,
        int $tenantId,
        string $channel,
        bool $administratorsOnly = false,
    ): void {
        if ((int) TenantContext::getId() !== $tenantId) {
            self::throwGroupPolicyUnavailable($tenantId, $groupId, $channel, 'tenant_context_mismatch');
        }

        try {
            $group = DB::table('groups')
                ->where('id', $groupId)
                ->where('tenant_id', $tenantId)
                ->select(['id', 'owner_id'])
                ->first();
            if (! $group) {
                self::throwGroupPolicyUnavailable($tenantId, $groupId, $channel, 'group_not_found');
            }

            // Scope through the already tenant-verified group id. Do not filter
            // on group_members.tenant_id here: historical rows can carry the
            // old default tenant even though their globally unique group_id is
            // valid, and omitting them would silently weaken the cohort gate.
            $members = DB::table('group_members')
                ->where('group_id', $groupId)
                ->where('status', 'active')
                ->when($administratorsOnly, static function ($query): void {
                    $query->whereIn('role', ['owner', 'admin']);
                })
                ->pluck('user_id')
                ->map(static fn (mixed $id): int => (int) $id)
                ->all();

            // Group ownership is authoritative even if a damaged legacy pivot
            // row is absent, so never omit the owner from a contact cohort.
            $members[] = (int) $group->owner_id;
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            self::throwGroupPolicyUnavailable(
                $tenantId,
                $groupId,
                $channel,
                'group_recipient_lookup_failed',
                $e,
            );
        }

        $members = array_values(array_unique(array_filter(
            $members,
            static fn (int $memberId): bool => $memberId > 0 && $memberId !== $joiningUserId,
        )));
        sort($members, SORT_NUMERIC);

        $policy = app(SafeguardingInteractionPolicy::class);
        foreach ($members as $memberId) {
            $policy->assertLocalContactAllowed($joiningUserId, $memberId, $tenantId, $channel);
            $policy->assertLocalContactAllowed($memberId, $joiningUserId, $tenantId, $channel);
        }
    }

    /**
     * Fail closed before a group content write reaches the current active
     * cohort or any explicitly mentioned/targeted member.
     *
     * @param list<int> $additionalRecipientIds
     */
    public static function assertSafeguardingBroadcastAllowed(
        int $groupId,
        int $senderId,
        int $tenantId,
        string $channel,
        ?string $content = null,
        array $additionalRecipientIds = [],
    ): void {
        if ((int) TenantContext::getId() !== $tenantId) {
            self::throwGroupPolicyUnavailable($tenantId, $groupId, $channel, 'tenant_context_mismatch');
        }

        try {
            $group = DB::table('groups')
                ->where('id', $groupId)
                ->where('tenant_id', $tenantId)
                ->select(['id', 'owner_id'])
                ->first();
            if (! $group) {
                self::throwGroupPolicyUnavailable($tenantId, $groupId, $channel, 'group_not_found');
            }

            $recipientIds = DB::table('group_members')
                ->where('group_id', $groupId)
                ->where('status', 'active')
                ->pluck('user_id')
                ->map(static fn (mixed $id): int => (int) $id)
                ->all();

            $recipientIds[] = (int) $group->owner_id;
            $recipientIds = array_merge($recipientIds, $additionalRecipientIds);

            if ($content !== null && $content !== '') {
                foreach (GroupMentionService::parseMentions($content) as $mention) {
                    $recipientIds[] = (int) $mention['user_id'];
                }
            }
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            self::throwGroupPolicyUnavailable(
                $tenantId,
                $groupId,
                $channel,
                'group_recipient_lookup_failed',
                $e,
            );
        }

        $recipientIds = array_values(array_unique(array_filter(
            array_map(static fn (mixed $id): int => (int) $id, $recipientIds),
            static fn (int $id): bool => $id > 0 && $id !== $senderId,
        )));
        sort($recipientIds, SORT_NUMERIC);

        if ($recipientIds === []) {
            return;
        }

        app(SafeguardingInteractionPolicy::class)->assertManyLocalContactsAllowed(
            $senderId,
            $recipientIds,
            $tenantId,
            $channel,
        );
    }

    private static function throwGroupPolicyUnavailable(
        int $tenantId,
        int $groupId,
        string $channel,
        string $reason,
        ?\Throwable $exception = null,
    ): never {
        Log::error('Safeguarding group recipient resolution unavailable', array_filter([
            'tenant_id' => $tenantId,
            'group_id' => $groupId,
            'channel' => $channel,
            'reason_code' => $reason,
            'exception_class' => $exception !== null ? $exception::class : null,
        ], static fn (mixed $value): bool => $value !== null));

        throw new SafeguardingPolicyException(
            'SAFEGUARDING_POLICY_UNAVAILABLE',
            __('safeguarding.errors.policy_unavailable'),
        );
    }

    // -----------------------------------------------------------------
    //  Discussions
    // -----------------------------------------------------------------

    /**
     * Get discussions in a group.
     */
    public static function getDiscussions(int $groupId, int $userId, array $filters = []): ?array
    {
        self::$errors = [];

        if (! self::requireDiscussionAccess($groupId, $userId, false)) {
            return null;
        }

        $limit = max(1, min((int) ($filters['limit'] ?? 20), 100));
        $cursor = $filters['cursor'] ?? null;
        $cursorPayload = null;
        if ($cursor !== null && $cursor !== '') {
            $cursorPayload = self::decodeDiscussionCursor($cursor, 'discussion', $groupId);
            if ($cursorPayload === null) {
                self::$errors[] = ['code' => 'INVALID_CURSOR', 'message' => __('api.invalid_cursor')];
                return null;
            }
        }

        $query = GroupDiscussion::query()
            ->with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->withCount('posts')
            ->withMax('posts as last_post_at', 'created_at')
            ->where('group_id', $groupId);

        if ($cursorPayload !== null) {
            $query->where(static function (Builder $after) use ($cursorPayload): void {
                $after->whereRaw('COALESCE(is_pinned, 0) < ?', [$cursorPayload['pinned']])
                    ->orWhere(static function (Builder $samePinned) use ($cursorPayload): void {
                        $samePinned->whereRaw('COALESCE(is_pinned, 0) = ?', [$cursorPayload['pinned']])
                            ->where(static function (Builder $older) use ($cursorPayload): void {
                                $older->where('created_at', '<', $cursorPayload['created_at'])
                                    ->orWhere(static function (Builder $sameTime) use ($cursorPayload): void {
                                        $sameTime->where('created_at', $cursorPayload['created_at'])
                                            ->where('id', '<', $cursorPayload['id']);
                                    });
                            });
                    });
            });
        }

        $query
            ->orderByRaw('COALESCE(is_pinned, 0) DESC')
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        $discussions = $query->limit($limit + 1)->get();
        $hasMore = $discussions->count() > $limit;
        if ($hasMore) {
            $discussions->pop();
        }

        $items = $discussions->map(static function (GroupDiscussion $d): array {
            $user = $d->user;
            $replyCount = max(0, (int) $d->getAttribute('posts_count') - 1);

            return [
                'id'            => (int) $d->id,
                'title'         => (string) $d->title,
                'author'        => [
                    'id'         => (int) $d->user_id,
                    'name'       => $user ? UserDisplayName::resolve($user) : __('api.unknown_user'),
                    'avatar_url' => $user?->avatar_url,
                ],
                'reply_count'   => $replyCount,
                'is_pinned'     => (bool) $d->is_pinned,
                'created_at'    => $d->created_at?->toISOString(),
                'last_reply_at' => $replyCount > 0
                    ? self::formatDiscussionTimestamp($d->getAttribute('last_post_at'))
                    : null,
            ];
        })->all();

        return [
            'items'    => $items,
            'cursor'   => $hasMore && $discussions->isNotEmpty()
                ? self::encodeDiscussionCursor('discussion', $discussions->last())
                : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Create a discussion in a group.
     */
    public static function createDiscussion(int $groupId, int $userId, array $data): ?array
    {
        self::$errors = [];

        if (! self::requireDiscussionAccess($groupId, $userId, true, 'api.group_member_required_create_discussions')) {
            return null;
        }

        $titleInput = $data['title'] ?? null;
        $contentInput = $data['content'] ?? null;
        $title = is_string($titleInput) ? trim($titleInput) : '';
        $content = is_string($contentInput) ? trim($contentInput) : '';

        if ($title === '') {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.title_required'), 'field' => 'title'];
            return null;
        }

        if (mb_strlen($title) > 255) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.listing_title_max'), 'field' => 'title'];
            return null;
        }

        if ($content === '') {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_content_required'), 'field' => 'content'];
            return null;
        }

        if (strlen($content) > 60000) {
            self::$errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.feed_post_content_too_long', ['max' => 60000]),
                'field' => 'content',
            ];
            return null;
        }

        // Sanitize to prevent XSS — strip HTML tags from title, allow basic formatting in content
        $title = trim(strip_tags($title));
        $content = trim(\App\Helpers\HtmlSanitizer::sanitize($content, false));
        if ($title === '') {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.title_required'), 'field' => 'title'];
            return null;
        }
        if ($content === '') {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_content_required'), 'field' => 'content'];
            return null;
        }
        if (strlen($content) > 60000) {
            self::$errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.feed_post_content_too_long', ['max' => 60000]),
                'field' => 'content',
            ];
            return null;
        }
        $tenantId = (int) TenantContext::getId();

        return DB::transaction(function () use ($groupId, $userId, $tenantId, $title, $content): ?array {
            if (! self::lockWritableDiscussionGroup($groupId, $userId, $tenantId, 'api.group_member_required_create_discussions')) {
                return null;
            }

            self::assertSafeguardingBroadcastAllowed(
                $groupId,
                $userId,
                $tenantId,
                'group_discussion_create',
                $title . ' ' . $content,
            );

            $discussion = GroupDiscussion::create([
                'group_id' => $groupId,
                'user_id'  => $userId,
                'title'    => $title,
            ]);

            GroupPost::create([
                'discussion_id' => $discussion->id,
                'user_id'       => $userId,
                'content'       => $content,
            ]);

            $discussion->load('user:id,first_name,last_name,profile_type,organization_name,avatar_url');
            $user = $discussion->user;

            // Fire integrations
            GroupWebhookService::fire($groupId, GroupWebhookService::EVENT_DISCUSSION_CREATED, [
                'discussion_id' => $discussion->id,
                'title' => $title,
            ]);
            try { GroupAuditService::log(GroupAuditService::ACTION_DISCUSSION_CREATED, $groupId, $userId, ['discussion_id' => $discussion->id]); } catch (\Throwable $e) { \Log::warning('GroupService: failed to log discussion_created audit', ['group_id' => $groupId, 'discussion_id' => $discussion->id, 'error' => $e->getMessage()]); }
            try { GroupChallengeService::incrementProgress($groupId, 'discussions'); } catch (\Throwable $e) { \Log::warning('GroupService: failed to increment challenge progress for discussions', ['group_id' => $groupId, 'error' => $e->getMessage()]); }
            try { GroupMentionService::notifyMentioned($groupId, $userId, $content, 'discussion', $discussion->id); } catch (\Throwable $e) { \Log::warning('GroupService: failed to notify mentioned users in discussion', ['group_id' => $groupId, 'discussion_id' => $discussion->id, 'error' => $e->getMessage()]); }

            return [
                'id'            => (int) $discussion->id,
                'title'         => (string) $discussion->title,
                'content'       => $content,
                'author'        => [
                    'id'         => (int) $discussion->user_id,
                    'name'       => $user ? UserDisplayName::resolve($user) : __('api.unknown_user'),
                    'avatar_url' => $user?->avatar_url,
                ],
                'reply_count'   => 0,
                'is_pinned'     => false,
                'created_at'    => $discussion->created_at?->toISOString(),
                'last_reply_at' => null,
            ];
        });
    }

    /**
     * Get messages in a group discussion.
     */
    public static function getDiscussionMessages(int $groupId, int $discussionId, int $userId, array $filters = []): ?array
    {
        self::$errors = [];

        if (! self::requireDiscussionAccess($groupId, $userId, false)) {
            return null;
        }

        // Verify discussion belongs to group
        $discussion = GroupDiscussion::query()
            ->with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->where('group_id', $groupId)
            ->find($discussionId);

        if ($discussion === null) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_discussion_not_found')];
            return null;
        }

        $limit = max(1, min((int) ($filters['limit'] ?? 50), 100));
        $cursor = $filters['cursor'] ?? null;
        $cursorPayload = null;
        if ($cursor !== null && $cursor !== '') {
            $cursorPayload = self::decodeDiscussionCursor($cursor, 'discussion_reply', $discussionId);
            if ($cursorPayload === null) {
                self::$errors[] = ['code' => 'INVALID_CURSOR', 'message' => __('api.invalid_cursor')];
                return null;
            }
        }

        $rootPost = GroupPost::query()
            ->where('discussion_id', $discussionId)
            ->orderBy('created_at')
            ->orderBy('id')
            ->first();

        $replyBase = GroupPost::query()->where('discussion_id', $discussionId);
        if ($rootPost === null) {
            $replyBase->whereRaw('1 = 0');
        } else {
            $replyBase->where('id', '!=', (int) $rootPost->id);
        }

        $totalReplies = (clone $replyBase)->count();
        $lastReplyAt = (clone $replyBase)->max('created_at');

        $query = (clone $replyBase)->with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url']);
        if ($cursorPayload !== null) {
            $query->where(static function (Builder $older) use ($cursorPayload): void {
                $older->where('created_at', '<', $cursorPayload['created_at'])
                    ->orWhere(static function (Builder $sameTime) use ($cursorPayload): void {
                        $sameTime->where('created_at', $cursorPayload['created_at'])
                            ->where('id', '<', $cursorPayload['id']);
                    });
            });
        }

        $query->orderByDesc('created_at')->orderByDesc('id');

        $posts = $query->limit($limit + 1)->get();
        $hasMore = $posts->count() > $limit;
        if ($hasMore) {
            $posts->pop();
        }

        $oldestReturned = $posts->last();
        $items = $posts->reverse()->values()->map(static function (GroupPost $p) use ($userId): array {
            $user = $p->user;
            return [
                'id'         => (int) $p->id,
                'content'    => (string) $p->content,
                'author'     => [
                    'id'         => (int) $p->user_id,
                    'name'       => $user ? UserDisplayName::resolve($user) : __('api.unknown_user'),
                    'avatar_url' => $user?->avatar_url,
                ],
                'is_own'     => (int) $p->user_id === $userId,
                'created_at' => $p->created_at?->toISOString(),
            ];
        })->all();

        $user = $discussion->user;

        return [
            'discussion' => [
                'id'            => (int) $discussion->id,
                'title'         => (string) $discussion->title,
                'content'       => (string) ($rootPost?->content ?? ''),
                'author'        => [
                    'id'         => (int) $discussion->user_id,
                    'name'       => $user ? UserDisplayName::resolve($user) : __('api.unknown_user'),
                    'avatar_url' => $user?->avatar_url,
                ],
                'reply_count'   => (int) $totalReplies,
                'is_pinned'     => (bool) $discussion->is_pinned,
                'created_at'    => $discussion->created_at?->toISOString(),
                'last_reply_at' => self::formatDiscussionTimestamp($lastReplyAt),
            ],
            'items'    => $items,
            'cursor'   => $hasMore && $oldestReturned !== null
                ? self::encodeDiscussionCursor('discussion_reply', $oldestReturned)
                : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Post a message to a group discussion.
     */
    public static function postToDiscussion(int $groupId, int $discussionId, int $userId, array $data): ?array
    {
        self::$errors = [];

        if (! self::requireDiscussionAccess($groupId, $userId, true)) {
            return null;
        }

        $contentInput = $data['content'] ?? null;
        $content = is_string($contentInput) ? trim($contentInput) : '';
        if ($content === '') {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_content_required'), 'field' => 'content'];
            return null;
        }

        if (strlen($content) > 60000) {
            self::$errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.feed_post_content_too_long', ['max' => 60000]),
                'field' => 'content',
            ];
            return null;
        }

        // Sanitize to prevent XSS — allow basic formatting tags
        $content = trim(\App\Helpers\HtmlSanitizer::sanitize($content, false));
        if ($content === '') {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_content_required'), 'field' => 'content'];
            return null;
        }
        if (strlen($content) > 60000) {
            self::$errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.feed_post_content_too_long', ['max' => 60000]),
                'field' => 'content',
            ];
            return null;
        }
        $tenantId = (int) TenantContext::getId();

        $post = DB::transaction(function () use ($groupId, $discussionId, $userId, $content, $tenantId): ?GroupPost {
            if (! self::lockWritableDiscussionGroup($groupId, $userId, $tenantId)) {
                return null;
            }

            $discussion = GroupDiscussion::query()
                ->where('group_id', $groupId)
                ->whereKey($discussionId)
                ->lockForUpdate()
                ->first();
            if ($discussion === null) {
                self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_discussion_not_found')];
                return null;
            }
            if ((bool) $discussion->is_locked) {
                self::$errors[] = ['code' => 'DISCUSSION_LOCKED', 'message' => __('api.group_discussion_locked')];
                return null;
            }

            self::assertSafeguardingBroadcastAllowed(
                $groupId,
                $userId,
                $tenantId,
                'group_discussion_post',
                $content,
            );

            $post = GroupPost::create([
                'discussion_id' => $discussionId,
                'user_id'       => $userId,
                'content'       => $content,
            ]);
            GroupWebhookService::fire($groupId, GroupWebhookService::EVENT_POST_CREATED, [
                'post_id' => $post->id,
                'discussion_id' => $discussionId,
            ]);

            return $post;
        });

        if ($post === null) {
            return null;
        }

        // Fire integrations
        try { GroupAuditService::log(GroupAuditService::ACTION_POST_CREATED, $groupId, $userId, ['post_id' => $post->id]); } catch (\Throwable $e) { \Log::warning('GroupService: failed to log post_created audit', ['group_id' => $groupId, 'post_id' => $post->id, 'error' => $e->getMessage()]); }
        try { GroupChallengeService::incrementProgress($groupId, 'posts'); } catch (\Throwable $e) { \Log::warning('GroupService: failed to increment challenge progress for posts', ['group_id' => $groupId, 'error' => $e->getMessage()]); }
        try { GroupMentionService::notifyMentioned($groupId, $userId, $content, 'post', $post->id); } catch (\Throwable $e) { \Log::warning('GroupService: failed to notify mentioned users in post', ['group_id' => $groupId, 'post_id' => $post->id, 'error' => $e->getMessage()]); }

        $post->load('user:id,first_name,last_name,profile_type,organization_name,avatar_url');
        $user = $post->user;

        return [
            'id'         => (int) $post->id,
            'content'    => (string) $post->content,
            'author'     => [
                'id'         => (int) $post->user_id,
                'name'       => $user ? UserDisplayName::resolve($user) : __('api.unknown_user'),
                'avatar_url' => $user?->avatar_url,
            ],
            'is_own'     => true,
            'created_at' => $post->created_at?->toISOString(),
        ];
    }

    private static function requireDiscussionAccess(
        int $groupId,
        int $userId,
        bool $write,
        string $writeMessageKey = 'api.group_member_required_post',
    ): bool
    {
        $exists = DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', (int) TenantContext::getId())
            ->exists();
        if (! $exists) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_not_found')];
            return false;
        }

        $allowed = $write
            ? GroupAccessService::canWriteContent($groupId, $userId)
            : GroupAccessService::canViewMemberContent($groupId, $userId);
        if (! $allowed) {
            self::$errors[] = [
                'code' => 'FORBIDDEN',
                'message' => $write
                    ? __($writeMessageKey)
                    : __('api.group_member_required_view_discussions'),
            ];
            return false;
        }

        return true;
    }

    private static function lockWritableDiscussionGroup(
        int $groupId,
        int $userId,
        int $tenantId,
        string $writeMessageKey = 'api.group_member_required_post',
    ): bool
    {
        $group = DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->select(['status'])
            ->sharedLock()
            ->first();
        if ($group === null) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_not_found')];
            return false;
        }

        $status = GroupStatus::tryFrom((string) $group->status);
        if ($status === null || ! $status->isWritable() || ! GroupAccessService::canWriteContent($groupId, $userId)) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __($writeMessageKey)];
            return false;
        }

        return true;
    }

    /** @return array{pinned?: int, created_at: string, id: int}|null */
    private static function decodeDiscussionCursor(mixed $cursor, string $type, int $scopeId): ?array
    {
        if (! is_string($cursor) || $cursor === '') {
            return null;
        }

        $payload = CursorSigner::decode($cursor);
        if (
            ! is_array($payload)
            || ($payload['v'] ?? null) !== 1
            || ($payload['type'] ?? null) !== $type
            || (int) ($payload['tenant_id'] ?? 0) !== (int) TenantContext::getId()
            || ($payload['scope_id'] ?? null) !== $scopeId
            || ! isset($payload['created_at'], $payload['id'])
            || ! is_string($payload['created_at'])
            || ! self::isValidDiscussionCursorTimestamp($payload['created_at'])
            || ! is_int($payload['id'])
            || $payload['id'] <= 0
        ) {
            return null;
        }

        $result = [
            'created_at' => $payload['created_at'],
            'id' => $payload['id'],
        ];
        if ($type === 'discussion') {
            if (! isset($payload['pinned']) || ! in_array($payload['pinned'], [0, 1], true)) {
                return null;
            }
            $result['pinned'] = $payload['pinned'];
        }

        return $result;
    }

    private static function encodeDiscussionCursor(string $type, GroupDiscussion|GroupPost $record): string
    {
        $payload = [
            'v' => 1,
            'type' => $type,
            'tenant_id' => (int) TenantContext::getId(),
            'scope_id' => $record instanceof GroupDiscussion
                ? (int) $record->group_id
                : (int) $record->discussion_id,
            'created_at' => $record->created_at?->format('Y-m-d H:i:s'),
            'id' => (int) $record->id,
        ];
        if ($record instanceof GroupDiscussion) {
            $payload['pinned'] = (int) ((bool) $record->is_pinned);
        }

        return CursorSigner::encode($payload);
    }

    private static function isValidDiscussionCursorTimestamp(string $timestamp): bool
    {
        try {
            $parsed = \Carbon\CarbonImmutable::createFromFormat('Y-m-d H:i:s', $timestamp);
        } catch (\Throwable) {
            return false;
        }

        return $parsed !== null && $parsed->format('Y-m-d H:i:s') === $timestamp;
    }

    private static function formatDiscussionTimestamp(mixed $timestamp): ?string
    {
        if ($timestamp === null || $timestamp === '') {
            return null;
        }

        try {
            return \Carbon\CarbonImmutable::parse($timestamp)->toISOString();
        } catch (\Throwable) {
            return null;
        }
    }

    // -----------------------------------------------------------------
    //  Images
    // -----------------------------------------------------------------

    /**
     * Update a group's image (avatar or cover).
     */
    public static function updateImage(int $groupId, int $userId, string $imageUrl, string $type = 'avatar'): bool
    {
        return self::replaceImage($groupId, $userId, $imageUrl, $type) !== null;
    }

    /**
     * Commit a staged avatar/cover replacement and return the previous URL so
     * storage cleanup happens only after the database mutation commits.
     *
     * @return array{image_url: string|null, previous_url: string|null, type: string}|null
     */
    public static function replaceImage(
        int $groupId,
        int $userId,
        ?string $imageUrl,
        string $type = 'avatar',
    ): ?array {
        self::$errors = [];
        if (! in_array($type, ['avatar', 'cover'], true)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_image_type_invalid'), 'field' => 'type'];
            return null;
        }
        if ($imageUrl !== null && ! str_starts_with($imageUrl, '/uploads/tenants/')) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.failed_upload_image'), 'field' => 'image'];
            return null;
        }

        $tenantId = (int) TenantContext::getId();
        return DB::transaction(function () use ($groupId, $userId, $imageUrl, $type, $tenantId): ?array {
            /** @var Group|null $group */
            $group = Group::query()
                ->where('tenant_id', $tenantId)
                ->whereKey($groupId)
                ->lockForUpdate()
                ->first();
            if ($group === null) {
                self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_not_found')];
                return null;
            }
            if (! self::canModify($groupId, $userId)) {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_modify_forbidden')];
                return null;
            }

            $field = $type === 'cover' ? 'cover_image_url' : 'image_url';
            $previous = $group->{$field} !== null ? (string) $group->{$field} : null;
            $group->{$field} = $imageUrl;
            $group->save();

            GroupAuditService::log(
                GroupAuditService::ACTION_GROUP_IMAGE_UPDATED,
                $groupId,
                $userId,
                [
                    'image_type' => $type,
                    'operation' => $imageUrl === null ? 'removed' : 'replaced',
                    'had_previous' => $previous !== null,
                ],
            );

            return ['image_url' => $imageUrl, 'previous_url' => $previous, 'type' => $type];
        }, 3);
    }

    // -----------------------------------------------------------------
    //  Helpers
    // -----------------------------------------------------------------

    /**
     * Check if a user can modify a group (is admin/owner).
     */
    public static function canView(int $groupId, ?int $userId = null): bool
    {
        return GroupAccessService::canViewOverview($groupId, $userId);
    }

    public static function isActiveMember(int $groupId, int $userId): bool
    {
        return GroupAccessService::isActiveMember($groupId, $userId);
    }

    public static function canModify(int $groupId, int $userId): bool
    {
        return GroupAccessService::canManage($groupId, $userId);
    }

    private static function canManageGroupAdmins(Group $group, int $actingUserId): bool
    {
        return (int) $group->owner_id === $actingUserId || self::isPlatformAdmin($actingUserId);
    }

    /**
     * Check if user is a platform admin.
     */
    private static function isPlatformAdmin(int $userId): bool
    {
        return GroupAccessService::isTenantAdmin($userId);
    }
}
