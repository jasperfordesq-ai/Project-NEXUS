<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * GroupChatroomService — Native Laravel implementation for group chatroom operations.
 *
 * Manages group chatrooms (channels) and their messages.
 * Tables: group_chatrooms, group_chatroom_messages
 */
class GroupChatroomService
{
    /** @var array<int, array{code: string, message: string, field?: string}> */
    private array $errors = [];

    public function __construct()
    {
    }

    /**
     * Get validation/operation errors from the last operation.
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Get all chatrooms for a group.
     *
     * @param string|null $category  Optional category filter (e.g. 'general', 'announcements')
     * @param int|null    $userId    Viewer ID; null is denied (kept nullable for compatibility)
     */
    public function getChatrooms(int $groupId, ?string $category = null, ?int $userId = null): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if ($userId === null) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_chatroom_private_channel')];
            return null;
        }

        if (!$this->authorizeParent($groupId, $userId, false)) {
            return null;
        }

        $query = DB::table('group_chatrooms')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->orderByDesc('is_default')
            ->orderBy('name');

        if ($category !== null) {
            $query->where('category', $category);
        }

        $chatrooms = $query->get();

        return $chatrooms->map(fn ($c) => [
            'id'          => (int) $c->id,
            'group_id'    => (int) $c->group_id,
            'name'        => $c->name,
            'description' => $c->description,
            'category'    => $c->category,
            'is_default'  => (bool) $c->is_default,
            'is_private'  => (bool) $c->is_private,
            'created_by'  => (int) $c->created_by,
            'created_at'  => $c->created_at,
        ])->values()->all();
    }

    /**
     * Get a single chatroom by ID.
     */
    public function getById(int $chatroomId, int $userId): ?array
    {
        $chatroom = $this->assertAccess($chatroomId, $userId);
        if ($chatroom === null) {
            return null;
        }

        return [
            'id'          => (int) $chatroom->id,
            'group_id'    => (int) $chatroom->group_id,
            'name'        => $chatroom->name,
            'description' => $chatroom->description,
            'category'    => $chatroom->category ?? null,
            'is_default'  => (bool) $chatroom->is_default,
            'is_private'  => (bool) ($chatroom->is_private ?? false),
            'created_by'  => (int) $chatroom->created_by,
            'created_at'  => $chatroom->created_at,
        ];
    }

    /**
     * Create a new chatroom in a group.
     */
    public function create(int $groupId, int $userId, array $data): ?int
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (!$this->authorizeParent($groupId, $userId, true)) {
            return null;
        }

        $name = trim($data['name'] ?? '');
        if (empty($name)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_chatroom_name_required'), 'field' => 'name'];
            return null;
        }

        if (mb_strlen($name) > 100) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_chatroom_name_too_long'), 'field' => 'name'];
            return null;
        }

        // Name and description are immediately visible directed content for
        // every active group member, so chatroom creation is also a protected
        // group contact write.
        $recipientIds = DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->where('status', 'active')
            ->where('user_id', '!=', $userId)
            ->pluck('user_id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
        $decision = app(SafeguardingInteractionPolicy::class)->evaluateManyLocalContacts(
            $userId,
            $recipientIds,
            $tenantId,
            'group_chatroom_create',
        );
        if (! $decision->isAllowed()) {
            $this->setSafeguardingError($decision);
            return null;
        }

        $category = isset($data['category']) ? trim($data['category']) : null;
        if ($category !== null && mb_strlen($category) > 100) {
            $category = mb_substr($category, 0, 100);
        }

        $isPrivate = (bool) ($data['is_private'] ?? false);
        $permissions = isset($data['permissions']) ? json_encode($data['permissions']) : null;

        $id = DB::table('group_chatrooms')->insertGetId([
            'group_id'    => $groupId,
            'tenant_id'   => $tenantId,
            'name'        => $name,
            'description' => trim($data['description'] ?? '') ?: null,
            'category'    => $category ?: null,
            'is_private'  => $isPrivate ? 1 : 0,
            'permissions' => $permissions,
            'created_by'  => $userId,
            'is_default'  => 0,
            'created_at'  => now(),
        ]);

        return (int) $id;
    }

    private function setSafeguardingError(SafeguardingInteractionDecision $decision): void
    {
        $this->errors = [MessageService::buildSafeguardingError([
            'status' => $decision->status,
            'code' => $decision->code,
            'required_vetting_types' => $decision->requiredAttestationCodes,
            'required_vetting_labels' => $decision->requiredAttestationLabels,
            'can_request_coordinator' => $decision->canRequestCoordinator,
        ])];
    }

    /**
     * Ensure a default "General" chatroom exists for a group. Returns its ID.
     */
    public function ensureDefaultChatroom(int $groupId, int $userId): ?int
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (!$this->authorizeParent($groupId, $userId, true)) {
            return null;
        }

        // Check if a default chatroom already exists
        $existing = DB::table('group_chatrooms')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('is_default', 1)
            ->first();

        if ($existing) {
            return (int) $existing->id;
        }

        // Create the default chatroom
        $id = DB::table('group_chatrooms')->insertGetId([
            'group_id'    => $groupId,
            'tenant_id'   => $tenantId,
            'name'        => __('api_controllers_1.group_chatroom.default_name'),
            'description' => __('api_controllers_1.group_chatroom.default_description'),
            'created_by'  => $userId,
            'is_default'  => 1,
            'created_at'  => now(),
        ]);

        return (int) $id;
    }

    /**
     * Delete a chatroom.
     */
    public function delete(int $chatroomId, int $userId): bool
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();

        $chatroom = $this->findAccessibleChatroom($chatroomId, $userId, true);
        if ($chatroom === null) {
            return false;
        }

        if ($chatroom->is_default) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_chatroom_cannot_delete_default')];
            return false;
        }

        $isAdmin = GroupAccessService::canManage((int) $chatroom->group_id, $userId);
        $isCreator = (int) $chatroom->created_by === $userId;

        if (! $isAdmin && ! $isCreator) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_chatroom_delete_forbidden')];
            return false;
        }

        return DB::transaction(function () use ($chatroomId, $userId, $tenantId): bool {
            $chatroom = DB::table('group_chatrooms')
                ->where('id', $chatroomId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if ($chatroom === null) {
                $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_chatroom_not_found')];
                return false;
            }

            // Messages are cascade-deleted via FK.
            $deleted = DB::table('group_chatrooms')
                ->where('id', $chatroomId)
                ->where('tenant_id', $tenantId)
                ->delete();
            if ($deleted !== 1) {
                return false;
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_CHATROOM_DELETED,
                (int) $chatroom->group_id,
                $userId,
                [
                    'chatroom_id' => $chatroomId,
                    'name' => (string) $chatroom->name,
                    'target_user_id' => (int) $chatroom->created_by,
                ],
            );

            return true;
        });
    }

    /**
     * Get messages in a chatroom with cursor-based pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getMessages(int $chatroomId, array $filters = [], ?int $userId = null): ?array
    {
        $this->errors = [];
        $limit = min((int) ($filters['limit'] ?? 50), 100);
        $cursor = $filters['cursor'] ?? null;
        $tenantId = TenantContext::getId();

        if ($userId === null) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_chatroom_private_channel')];
            return null;
        }

        if ($this->assertAccess($chatroomId, $userId) === null) {
            return null;
        }

        $query = DB::table('group_chatroom_messages as m')
            ->join('users as u', function ($join) use ($tenantId) {
                $join->on('m.user_id', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->join('group_chatrooms as c', 'm.chatroom_id', '=', 'c.id')
            ->where('m.chatroom_id', $chatroomId)
            ->where('c.tenant_id', $tenantId)
            ->select([
                'm.id',
                'm.chatroom_id',
                'm.user_id',
                'm.body',
                'm.created_at',
                'm.updated_at',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name',
                'u.avatar_url',
            ]);

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                $query->where('m.id', '<', (int) $cursorId);
            }
        }

        $query->orderByDesc('m.id');

        $messages = $query->limit($limit + 1)->get();
        $hasMore = $messages->count() > $limit;
        if ($hasMore) {
            $messages->pop();
        }

        $items = $messages->map(fn ($m) => [
            'id'         => (int) $m->id,
            'body'       => $m->body,
            'user_id'    => (int) $m->user_id,
            'author'     => [
                'id'         => (int) $m->user_id,
                'name'       => UserDisplayName::resolve($m),
                'avatar_url' => $m->avatar_url,
            ],
            'created_at' => $m->created_at,
            'updated_at' => $m->updated_at,
        ])->all();

        return [
            'items'    => $items,
            'cursor'   => $hasMore && $messages->isNotEmpty() ? base64_encode((string) $messages->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Post a message to a chatroom.
     */
    public function postMessage(int $chatroomId, int $userId, string $body): ?int
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();

        $chatroom = $this->findAccessibleChatroom($chatroomId, $userId, true);
        if ($chatroom === null) {
            return null;
        }

        $body = trim($body);
        if (empty($body)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.message_body_required'), 'field' => 'body'];
            return null;
        }

        // A group chatroom post is delivered to every other active group
        // member. Evaluate the indivisible send before storing or broadcasting
        // it so this parallel chat implementation cannot bypass the central DM
        // safeguarding boundary.
        $recipientIds = DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $chatroom->group_id)
            ->where('status', 'active')
            ->where('user_id', '!=', $userId)
            ->pluck('user_id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
        $decision = app(SafeguardingInteractionPolicy::class)->evaluateManyLocalContacts(
            $userId,
            $recipientIds,
            $tenantId,
            'group_chatroom_message',
        );
        if (! $decision->isAllowed()) {
            $this->setSafeguardingError($decision);
            return null;
        }

        $id = DB::table('group_chatroom_messages')->insertGetId([
            'chatroom_id' => $chatroomId,
            'user_id'     => $userId,
            'body'        => $body,
            'created_at'  => now(),
        ]);

        // Broadcast via Pusher
        try {
            event(new \App\Events\GroupChatroomMessagePosted(
                $tenantId,
                (int) $chatroom->group_id,
                $chatroomId,
                [
                    'id' => (int) $id,
                    'chatroom_id' => $chatroomId,
                    'user_id' => $userId,
                    'body' => $body,
                    'created_at' => now()->toIso8601String(),
                ]
            ));
        } catch (\Throwable $e) {
            // Non-critical — message is saved, broadcast failed
        }

        return (int) $id;
    }

    /**
     * Delete a chatroom message.
     */
    public function deleteMessage(int $messageId, int $userId): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        return DB::transaction(function () use ($messageId, $userId, $tenantId): bool {
            $message = DB::table('group_chatroom_messages as m')
                ->join('group_chatrooms as c', 'm.chatroom_id', '=', 'c.id')
                ->where('m.id', $messageId)
                ->where('c.tenant_id', $tenantId)
                ->select(['m.id', 'm.user_id', 'm.chatroom_id', 'c.group_id'])
                ->lockForUpdate()
                ->first();

            if (! $message) {
                $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.message_not_found')];
                return false;
            }

            if (!$this->authorizeParent((int) $message->group_id, $userId, true)) {
                return false;
            }

            $isAuthor = (int) $message->user_id === $userId;
            if (!$isAuthor && !GroupAccessService::canManage((int) $message->group_id, $userId)) {
                $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_chatroom_message_delete_forbidden')];
                return false;
            }

            $deleted = DB::table('group_chatroom_messages')
                ->where('id', $messageId)
                ->delete();
            if ($deleted !== 1) {
                return false;
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_CHATROOM_MESSAGE_DELETED,
                (int) $message->group_id,
                $userId,
                [
                    'chatroom_id' => (int) $message->chatroom_id,
                    'message_id' => $messageId,
                    'target_user_id' => (int) $message->user_id,
                ],
            );

            return true;
        });
    }

    /**
     * Check whether a user can access a chatroom (private-channel visibility).
     * Returns the chatroom row on success, null on failure (with errors set).
     */
    public function assertAccess(int $chatroomId, ?int $userId): ?object
    {
        $this->errors = [];

        if ($userId === null) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_chatroom_private_channel')];
            return null;
        }

        return $this->findAccessibleChatroom($chatroomId, $userId, false);
    }

    /**
     * Pin a message in a chatroom. Only group admins/owners may pin.
     */
    public function pinMessage(int $groupId, int $chatroomId, int $messageId, int $userId): bool
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();

        if (!$this->authorizeParent($groupId, $userId, true)) {
            return false;
        }

        if (!GroupAccessService::canManage($groupId, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_chatroom_admin_only_pin')];
            return false;
        }

        // The route's group ID is part of the authorization boundary. A valid
        // chatroom from another group must not be accepted by ID alone.
        $chatroom = DB::table('group_chatrooms')
            ->where('id', $chatroomId)
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $chatroom) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_chatroom_not_found')];
            return false;
        }

        // Verify message belongs to this chatroom
        $message = DB::table('group_chatroom_messages')
            ->where('id', $messageId)
            ->where('chatroom_id', $chatroomId)
            ->first();

        if (! $message) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_chatroom_message_not_in_chatroom')];
            return false;
        }

        // Check if already pinned
        return DB::transaction(function () use ($groupId, $chatroomId, $messageId, $userId, $tenantId): bool {
            DB::table('group_chatrooms')
                ->where('id', $chatroomId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            $exists = DB::table('group_chatroom_pinned_messages')
                ->where('chatroom_id', $chatroomId)
                ->where('message_id', $messageId)
                ->where('tenant_id', $tenantId)
                ->exists();

            if ($exists) {
                // Idempotent — already pinned
                return true;
            }

            DB::table('group_chatroom_pinned_messages')->insert([
                'chatroom_id' => $chatroomId,
                'message_id'  => $messageId,
                'pinned_by'   => $userId,
                'tenant_id'   => $tenantId,
                'created_at'  => now(),
            ]);
            GroupAuditService::log(
                GroupAuditService::ACTION_CHATROOM_MESSAGE_PINNED,
                $groupId,
                $userId,
                ['chatroom_id' => $chatroomId, 'message_id' => $messageId],
            );

            return true;
        }, 3);
    }

    /**
     * Unpin a message from a chatroom. Only group admins/owners may unpin.
     */
    public function unpinMessage(int $groupId, int $chatroomId, int $messageId, int $userId): bool
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();

        if (!$this->authorizeParent($groupId, $userId, true)) {
            return false;
        }

        if (!GroupAccessService::canManage($groupId, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_chatroom_admin_only_unpin')];
            return false;
        }

        // Verify chatroom
        $chatroom = DB::table('group_chatrooms')
            ->where('id', $chatroomId)
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $chatroom) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_chatroom_not_found')];
            return false;
        }

        $messageExists = DB::table('group_chatroom_messages')
            ->where('id', $messageId)
            ->where('chatroom_id', $chatroomId)
            ->exists();

        if (!$messageExists) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_chatroom_message_not_in_chatroom')];
            return false;
        }

        return DB::transaction(function () use ($groupId, $chatroomId, $messageId, $userId, $tenantId): bool {
            DB::table('group_chatrooms')
                ->where('id', $chatroomId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            $deleted = DB::table('group_chatroom_pinned_messages')
                ->where('chatroom_id', $chatroomId)
                ->where('message_id', $messageId)
                ->where('tenant_id', $tenantId)
                ->delete();

            if ($deleted === 0) {
                $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_chatroom_pinned_message_not_found')];
                return false;
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_CHATROOM_MESSAGE_UNPINNED,
                $groupId,
                $userId,
                ['chatroom_id' => $chatroomId, 'message_id' => $messageId],
            );

            return true;
        }, 3);
    }

    /**
     * Get all pinned messages for a chatroom.
     */
    public function getPinnedMessages(int $groupId, int $chatroomId, ?int $userId = null): ?array
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();

        if ($userId === null) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_chatroom_private_channel')];
            return null;
        }

        if (!$this->authorizeParent($groupId, $userId, false)) {
            return null;
        }

        $chatroom = DB::table('group_chatrooms')
            ->where('id', $chatroomId)
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$chatroom) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_chatroom_not_found')];
            return null;
        }

        $pinned = DB::table('group_chatroom_pinned_messages as p')
            ->join('group_chatroom_messages as m', function ($join) {
                $join->on('p.message_id', '=', 'm.id')
                    ->on('p.chatroom_id', '=', 'm.chatroom_id');
            })
            ->join('users as u', function ($join) use ($tenantId) {
                $join->on('m.user_id', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('p.chatroom_id', $chatroomId)
            ->where('p.tenant_id', $tenantId)
            ->select([
                'm.id',
                'm.body',
                'm.user_id',
                'm.created_at as message_created_at',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name',
                'u.avatar_url',
                'p.pinned_by',
                'p.created_at as pinned_at',
            ])
            ->orderByDesc('p.created_at')
            ->get();

        return $pinned->map(fn ($row) => [
            'id'         => (int) $row->id,
            'body'       => $row->body,
            'user_id'    => (int) $row->user_id,
            'author'     => [
                'id'         => (int) $row->user_id,
                'name'       => UserDisplayName::resolve($row),
                'avatar_url' => $row->avatar_url,
            ],
            'created_at' => $row->message_created_at,
            'pinned_by'  => (int) $row->pinned_by,
            'pinned_at'  => $row->pinned_at,
        ])->all();
    }

    private function authorizeParent(int $groupId, int $userId, bool $write): bool
    {
        $tenantId = (int) TenantContext::getId();
        $exists = DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (!$exists) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_chatroom_not_found')];
            return false;
        }

        $allowed = $write
            ? GroupAccessService::canWriteContent($groupId, $userId)
            : GroupAccessService::canViewMemberContent($groupId, $userId);

        if (!$allowed) {
            $this->errors[] = [
                'code' => 'FORBIDDEN',
                'message' => $write
                    ? __('api.group_chatroom_member_only_post')
                    : __('api.group_chatroom_private_channel'),
            ];
            return false;
        }

        return true;
    }

    private function findAccessibleChatroom(
        int $chatroomId,
        int $userId,
        bool $write,
        ?int $expectedGroupId = null,
    ): ?object {
        $tenantId = (int) TenantContext::getId();

        // When a route supplies the parent, authorize it before touching the
        // child. Child-only routes first perform a tenant-concealed lookup to
        // discover the parent, then immediately apply the same policy.
        if ($expectedGroupId !== null && !$this->authorizeParent($expectedGroupId, $userId, $write)) {
            return null;
        }

        $query = DB::table('group_chatrooms')
            ->where('id', $chatroomId)
            ->where('tenant_id', $tenantId);

        if ($expectedGroupId !== null) {
            $query->where('group_id', $expectedGroupId);
        }

        $chatroom = $query->first();
        if (!$chatroom) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_chatroom_not_found')];
            return null;
        }

        if ($expectedGroupId === null && !$this->authorizeParent((int) $chatroom->group_id, $userId, $write)) {
            return null;
        }

        return $chatroom;
    }
}
