<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\User;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * GroupConversationService — manages group DM conversations.
 *
 * Group conversations use the `conversations` + `conversation_participants` tables.
 * Messages in group conversations have a `conversation_id` set.
 * 1-to-1 conversations continue using sender_id/receiver_id without a conversation_id.
 */
class GroupConversationService
{
    private static array $errors = [];

    public static function getErrors(): array
    {
        return self::$errors;
    }

    /**
     * Create a new group conversation.
     *
     * @param int $creatorId The user creating the group
     * @param array $memberIds User IDs to add (must NOT include creatorId)
     * @param string $name Group name
     * @return array|null The created conversation data, or null on error
     */
    public static function createGroup(int $creatorId, array $memberIds, string $name): ?array
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $name = trim($name);
        if (empty($name)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_conversation_name_required')];
            return null;
        }
        if (mb_strlen($name) > 100) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_conversation_name_too_long')];
            return null;
        }

        // Ensure memberIds are unique integers, exclude creator
        $memberIds = array_unique(array_map('intval', array_filter($memberIds)));
        $memberIds = array_values(array_diff($memberIds, [$creatorId]));

        // Minimum 2 others + creator = 3 participants
        if (count($memberIds) < 2) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_conversation_min_participants')];
            return null;
        }

        // Maximum 50 participants total
        if (count($memberIds) > 49) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_conversation_max_participants')];
            return null;
        }

        // Verify all members exist in the same tenant
        $validMembers = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $memberIds)
            ->whereNotIn('status', ['banned', 'suspended', 'deactivated'])
            ->pluck('id')
            ->all();

        if (count($validMembers) < 2) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_conversation_not_enough_members')];
            return null;
        }

        // Check block relationships — remove blocked users silently
        $blockedIds = BlockUserService::getBlockedPairIds($creatorId);
        $validMembers = array_diff($validMembers, $blockedIds);

        if (count($validMembers) < 2) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_conversation_not_enough_members_blocked')];
            return null;
        }

        // Every member can contact every other member as soon as the group is
        // created. Check the complete cohort in both directions before writing
        // any participant row; checking only the creator leaves member-to-member
        // protected-contact pairs exposed.
        $decision = self::evaluateCohortPolicy(
            array_merge([$creatorId], array_values($validMembers)),
            $tenantId,
            'group_create',
        );
        if ($decision !== null) {
            self::setSafeguardingError($decision);
            return null;
        }

        return DB::transaction(function () use ($creatorId, $validMembers, $name, $tenantId) {
            $conversation = new Conversation([
                'is_group' => true,
                'group_name' => $name,
                'created_by' => $creatorId,
            ]);
            $conversation->save();

            $now = now();

            // Add creator as admin
            ConversationParticipant::create([
                'conversation_id' => $conversation->id,
                'user_id' => $creatorId,
                'role' => 'admin',
                'joined_at' => $now,
            ]);

            // Add members
            foreach ($validMembers as $memberId) {
                ConversationParticipant::create([
                    'conversation_id' => $conversation->id,
                    'user_id' => $memberId,
                    'role' => 'member',
                    'joined_at' => $now,
                ]);
            }

            return self::formatConversation($conversation->fresh());
        });
    }

    /**
     * Add a member to a group conversation. Admin only.
     */
    public static function addMember(int $conversationId, int $userId, int $addedByUserId): ?array
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $conversation = Conversation::find($conversationId);
        if (!$conversation || !$conversation->is_group) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_conversation_not_found')];
            return null;
        }

        // Check if adder is admin
        $adder = ConversationParticipant::where('conversation_id', $conversationId)
            ->where('user_id', $addedByUserId)
            ->whereNull('left_at')
            ->first();

        if (!$adder || $adder->role !== 'admin') {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_conversation_admin_only_add')];
            return null;
        }

        // Check participant limit
        $activeCount = ConversationParticipant::where('conversation_id', $conversationId)
            ->whereNull('left_at')
            ->count();
        if ($activeCount >= 50) {
            self::$errors[] = ['code' => 'LIMIT_EXCEEDED', 'message' => __('api.group_conversation_max_participants')];
            return null;
        }

        // Check if user exists in same tenant
        $user = User::withoutGlobalScopes()
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();
        if (!$user) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.user_not_found')];
            return null;
        }

        // Check if already a participant
        $existing = ConversationParticipant::where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->first();

        if ($existing && $existing->left_at === null) {
            self::$errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.group_conversation_already_member')];
            return null;
        }

        // Joining or rejoining exposes the existing conversation history to the
        // target member. Every active participant is therefore a potential
        // sender to that target. Check all directions before changing left_at or
        // inserting a participant row; policy-unavailable takes precedence over
        // a normal denial so callers can present a retryable outcome.
        $activeParticipantIds = ConversationParticipant::where('conversation_id', $conversationId)
            ->whereNull('left_at')
            ->pluck('user_id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
        $decision = self::evaluateCohortPolicy(
            array_merge($activeParticipantIds, [$userId]),
            $tenantId,
            'group_member_add',
        );
        if ($decision !== null) {
            self::setSafeguardingError($decision);
            return null;
        }

        if ($existing) {
            // Re-join: clear left_at
            $existing->update(['left_at' => null, 'joined_at' => now()]);
        } else {
            ConversationParticipant::create([
                'conversation_id' => $conversationId,
                'user_id' => $userId,
                'role' => 'member',
                'joined_at' => now(),
            ]);
        }

        return self::formatConversation($conversation->fresh());
    }

    /**
     * Remove a member from a group conversation. Admin or self-leave.
     */
    public static function removeMember(int $conversationId, int $userId, int $removedByUserId): bool
    {
        self::$errors = [];

        $conversation = Conversation::find($conversationId);
        if (!$conversation || !$conversation->is_group) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_conversation_not_found')];
            return false;
        }

        $isSelfLeave = ($userId === $removedByUserId);

        if (!$isSelfLeave) {
            // Check if remover is admin
            $remover = ConversationParticipant::where('conversation_id', $conversationId)
                ->where('user_id', $removedByUserId)
                ->whereNull('left_at')
                ->first();

            if (!$remover || $remover->role !== 'admin') {
                self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_conversation_admin_only_remove')];
                return false;
            }
        }

        $participant = ConversationParticipant::where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->whereNull('left_at')
            ->first();

        if (!$participant) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_conversation_user_not_active_member')];
            return false;
        }

        $participant->update(['left_at' => now()]);

        // If leaving admin was the last admin, promote oldest active member
        if ($participant->role === 'admin') {
            $remainingAdmins = ConversationParticipant::where('conversation_id', $conversationId)
                ->where('role', 'admin')
                ->whereNull('left_at')
                ->count();

            if ($remainingAdmins === 0) {
                $oldestMember = ConversationParticipant::where('conversation_id', $conversationId)
                    ->whereNull('left_at')
                    ->orderBy('joined_at')
                    ->first();

                if ($oldestMember) {
                    $oldestMember->update(['role' => 'admin']);
                }
            }
        }

        return true;
    }

    /**
     * Update group details (name, avatar). Admin only.
     */
    public static function updateGroup(int $conversationId, int $userId, array $data): ?array
    {
        self::$errors = [];

        $conversation = Conversation::find($conversationId);
        if (!$conversation || !$conversation->is_group) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_conversation_not_found')];
            return null;
        }

        $participant = ConversationParticipant::where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->whereNull('left_at')
            ->first();

        if (!$participant || $participant->role !== 'admin') {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_conversation_admin_only_update')];
            return null;
        }

        if (isset($data['name'])) {
            $name = trim($data['name']);
            if (empty($name) || mb_strlen($name) > 100) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_conversation_name_length')];
                return null;
            }
            $conversation->group_name = $name;
        }

        if (isset($data['avatar_url'])) {
            $conversation->group_avatar_url = $data['avatar_url'];
        }

        $conversation->save();

        return self::formatConversation($conversation->fresh());
    }

    /**
     * Get participants of a group conversation.
     */
    public static function getParticipants(int $conversationId, int $userId): ?Collection
    {
        self::$errors = [];

        $conversation = Conversation::find($conversationId);
        if (!$conversation || !$conversation->is_group) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_conversation_not_found')];
            return null;
        }

        // Verify user is a participant
        $isParticipant = ConversationParticipant::where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->whereNull('left_at')
            ->exists();

        if (!$isParticipant) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_conversation_not_member')];
            return null;
        }

        return ConversationParticipant::where('conversation_id', $conversationId)
            ->whereNull('left_at')
            ->join('users', 'conversation_participants.user_id', '=', 'users.id')
            ->select([
                'conversation_participants.id',
                'conversation_participants.user_id',
                'conversation_participants.role',
                'conversation_participants.joined_at',
                'users.first_name',
                'users.last_name',
                'users.avatar_url',
                'users.organization_name',
                'users.profile_type',
                'users.last_active_at',
            ])
            ->orderByRaw("CASE WHEN conversation_participants.role = 'admin' THEN 0 ELSE 1 END")
            ->orderBy('conversation_participants.joined_at')
            ->get()
            ->map(function ($p) {
                $name = ($p->profile_type === 'organisation' && !empty($p->organization_name))
                    ? $p->organization_name
                    : UserDisplayName::resolve($p);
                return [
                    'id' => $p->user_id,
                    'name' => $name,
                    'first_name' => $p->first_name,
                    'last_name' => $p->last_name,
                    'avatar_url' => $p->avatar_url,
                    'role' => $p->role,
                    'joined_at' => $p->joined_at,
                    'is_online' => $p->last_active_at && \Carbon\Carbon::parse($p->last_active_at)->gt(now()->subMinutes(5)),
                ];
            });
    }

    /**
     * Get group conversations for a user.
     */
    public static function getUserGroups(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $conversationIds = ConversationParticipant::where('user_id', $userId)
            ->whereNull('left_at')
            ->pluck('conversation_id');

        $conversations = Conversation::whereIn('id', $conversationIds)
            ->where('is_group', true)
            ->orderByDesc('updated_at')
            ->get();

        return $conversations->map(function ($conv) use ($userId) {
            $data = self::formatConversation($conv);

            // Get last message
            $lastMessage = DB::table('messages')
                ->where('conversation_id', $conv->id)
                ->where('tenant_id', TenantContext::getId())
                ->orderByDesc('id')
                ->first();

            if ($lastMessage) {
                $senderName = '';
                if ($lastMessage->sender_id) {
                    $sender = User::withoutGlobalScopes()->find($lastMessage->sender_id);
                    $senderName = $sender ? ($sender->first_name ?? $sender->name ?? '') : '';
                }
                $data['last_message'] = [
                    'id' => $lastMessage->id,
                    'body' => $lastMessage->body,
                    'sender_id' => $lastMessage->sender_id,
                    'sender_name' => $senderName,
                    'created_at' => $lastMessage->created_at,
                ];
            }

            // Unread count
            $data['unread_count'] = DB::table('messages')
                ->where('conversation_id', $conv->id)
                ->where('tenant_id', TenantContext::getId())
                ->where('sender_id', '!=', $userId)
                ->where('is_read', false)
                ->count();

            return $data;
        })->all();
    }

    /**
     * Get messages for a group conversation.
     */
    public static function getGroupMessages(int $conversationId, int $userId, array $filters = []): ?array
    {
        self::$errors = [];

        $conversation = Conversation::find($conversationId);
        if (!$conversation || !$conversation->is_group) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_conversation_not_found')];
            return null;
        }

        // Verify user is/was a participant
        $participant = ConversationParticipant::where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->first();

        if (!$participant) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_conversation_not_member')];
            return null;
        }

        $limit = min((int) ($filters['limit'] ?? 50), 100);
        $cursor = $filters['cursor'] ?? null;
        $direction = $filters['direction'] ?? 'older';
        $tenantId = TenantContext::getId();

        $query = DB::table('messages')
            ->where('conversation_id', $conversationId)
            ->where('tenant_id', $tenantId)
            ->where('is_deleted', false);

        // If user left, only show messages from before they left
        if ($participant->left_at) {
            $query->where('created_at', '<=', $participant->left_at);
        }

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                if ($direction === 'newer') {
                    $query->where('id', '>', (int) $cursorId);
                } else {
                    $query->where('id', '<', (int) $cursorId);
                }
            }
        }

        if ($direction === 'newer') {
            $query->orderBy('id');
        } else {
            $query->orderByDesc('id');
        }

        $messages = $query->limit($limit + 1)->get();
        $hasMore = $messages->count() > $limit;
        if ($hasMore) {
            $messages->pop();
        }

        // Batch fetch sender info
        $senderIds = $messages->pluck('sender_id')->unique()->all();
        $senders = [];
        if (!empty($senderIds)) {
            $senders = User::withoutGlobalScopes()
                ->whereIn('id', $senderIds)
                ->get(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url'])
                ->keyBy('id');
        }

        $items = $messages->map(function ($msg) use ($senders) {
            $sender = $senders[$msg->sender_id] ?? null;
            return [
                'id' => $msg->id,
                'conversation_id' => $msg->conversation_id,
                'sender_id' => $msg->sender_id,
                'body' => $msg->body,
                'is_read' => (bool) $msg->is_read,
                'is_edited' => (bool) ($msg->is_edited ?? false),
                'is_deleted' => (bool) ($msg->is_deleted ?? false),
                'is_voice' => (bool) ($msg->is_voice ?? false),
                'audio_url' => $msg->audio_url ?? null,
                'audio_duration' => $msg->audio_duration ?? null,
                'transcript' => $msg->transcript ?? null,
                'created_at' => $msg->created_at,
                'sender' => $sender ? [
                    'id' => $sender->id,
                    'first_name' => $sender->first_name,
                    'last_name' => $sender->last_name,
                    'name' => UserDisplayName::resolve($sender),
                    'avatar_url' => $sender->avatar_url,
                ] : null,
            ];
        })->all();

        $safeguarding = null;
        if ($participant->left_at === null) {
            $recipientIds = ConversationParticipant::where('conversation_id', $conversationId)
                ->whereNull('left_at')
                ->where('user_id', '!=', $userId)
                ->pluck('user_id')
                ->map(static fn ($id): int => (int) $id)
                ->all();
            $decision = app(SafeguardingInteractionPolicy::class)->evaluateManyLocalContacts(
                $userId,
                $recipientIds,
                $tenantId,
                'group_message',
            );
            if (! $decision->isAllowed()) {
                $safeguarding = self::formatSafeguardingDecision($decision);
            }
        }

        return [
            'items' => array_values($items),
            'cursor' => $hasMore && $messages->isNotEmpty() ? base64_encode((string) $messages->last()->id) : null,
            'has_more' => $hasMore,
            'conversation' => self::formatConversation($conversation),
            'safeguarding' => $safeguarding,
        ];
    }

    /**
     * Send a message to a group conversation.
     */
    public static function sendGroupMessage(int $conversationId, int $senderId, string $body): ?array
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $conversation = Conversation::find($conversationId);
        if (!$conversation || !$conversation->is_group) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_conversation_not_found')];
            return null;
        }

        // Verify sender is active participant
        $participant = ConversationParticipant::where('conversation_id', $conversationId)
            ->where('user_id', $senderId)
            ->whereNull('left_at')
            ->first();

        if (!$participant) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_conversation_not_active_member')];
            return null;
        }

        $body = \App\Helpers\HtmlSanitizer::stripAll(trim($body));
        if (empty($body)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.message_body_required')];
            return null;
        }

        $recipientIds = ConversationParticipant::where('conversation_id', $conversationId)
            ->whereNull('left_at')
            ->where('user_id', '!=', $senderId)
            ->pluck('user_id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
        $decision = app(SafeguardingInteractionPolicy::class)->evaluateManyLocalContacts(
            $senderId,
            $recipientIds,
            $tenantId,
            'group_message',
        );
        if (! $decision->isAllowed()) {
            self::setSafeguardingError($decision);
            return null;
        }

        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $tenantId,
            'conversation_id' => $conversationId,
            'sender_id' => $senderId,
            'receiver_id' => 0, // Not used for group messages, but column is NOT NULL
            'body' => $body,
            'is_read' => false,
            'created_at' => now(),
        ]);

        // Update conversation timestamp
        $conversation->touch();

        $sender = User::withoutGlobalScopes()->find($senderId);

        return [
            'id' => $messageId,
            'conversation_id' => $conversationId,
            'sender_id' => $senderId,
            'body' => $body,
            'is_read' => false,
            'created_at' => now()->toISOString(),
            'sender' => $sender ? [
                'id' => $sender->id,
                'first_name' => $sender->first_name,
                'last_name' => $sender->last_name,
                'name' => UserDisplayName::resolve($sender),
                'avatar_url' => $sender->avatar_url,
            ] : null,
        ];
    }

    /**
     * Evaluate every directed contact pair in a proposed group cohort.
     *
     * @param list<int> $userIds
     */
    private static function evaluateCohortPolicy(
        array $userIds,
        int $tenantId,
        string $channel,
    ): ?SafeguardingInteractionDecision {
        $userIds = array_values(array_unique(array_filter(
            array_map('intval', $userIds),
            static fn (int $userId): bool => $userId > 0,
        )));
        $firstDenial = null;

        foreach ($userIds as $senderId) {
            foreach ($userIds as $recipientId) {
                if ($senderId === $recipientId) {
                    continue;
                }

                $decision = app(SafeguardingInteractionPolicy::class)->evaluateLocalContact(
                    $senderId,
                    $recipientId,
                    $tenantId,
                    $channel,
                );
                if ($decision->isUnavailable()) {
                    return $decision;
                }
                if ($decision->isDenied() && $firstDenial === null) {
                    $firstDenial = $decision;
                }
            }
        }

        return $firstDenial;
    }

    private static function setSafeguardingError(SafeguardingInteractionDecision $decision): void
    {
        self::$errors = [MessageService::buildSafeguardingError([
            'status' => $decision->status,
            'code' => $decision->code,
            'required_vetting_types' => $decision->requiredAttestationCodes,
            'required_vetting_labels' => $decision->requiredAttestationLabels,
            'can_request_coordinator' => $decision->canRequestCoordinator,
        ])];
    }

    /** @return array<string, mixed> */
    private static function formatSafeguardingDecision(SafeguardingInteractionDecision $decision): array
    {
        $error = MessageService::buildSafeguardingError([
            'status' => $decision->status,
            'code' => $decision->code,
            'required_vetting_types' => $decision->requiredAttestationCodes,
            'required_vetting_labels' => $decision->requiredAttestationLabels,
            'can_request_coordinator' => $decision->canRequestCoordinator,
        ]);

        return [
            'restricted' => true,
            'code' => $error['code'],
            'title' => $error['title'] ?? null,
            'message' => $error['message'] ?? null,
            'detail' => $error['detail'] ?? null,
            'action_label' => $error['action_label'] ?? null,
            'required_vetting_types' => $error['required_vetting_types'] ?? [],
            'required_vetting_labels' => $error['required_vetting_labels'] ?? [],
            'can_request_coordinator' => $decision->canRequestCoordinator,
        ];
    }

    /**
     * Format a conversation model for API response.
     */
    private static function formatConversation(Conversation $conversation): array
    {
        $participants = ConversationParticipant::where('conversation_id', $conversation->id)
            ->whereNull('left_at')
            ->join('users', 'conversation_participants.user_id', '=', 'users.id')
            ->select([
                'conversation_participants.user_id',
                'conversation_participants.role',
                'users.first_name',
                'users.last_name', 'users.profile_type', 'users.organization_name',
                'users.avatar_url',
            ])
            ->get()
            ->map(function ($p) {
                return [
                    'id' => $p->user_id,
                    'name' => UserDisplayName::resolve($p),
                    'avatar_url' => $p->avatar_url,
                    'role' => $p->role,
                ];
            })
            ->all();

        return [
            'id' => $conversation->id,
            'is_group' => true,
            'group_name' => $conversation->group_name,
            'group_avatar_url' => $conversation->group_avatar_url,
            'created_by' => $conversation->created_by,
            'participant_count' => count($participants),
            'participants' => $participants,
            'created_at' => $conversation->created_at?->toISOString(),
            'updated_at' => $conversation->updated_at?->toISOString(),
        ];
    }
}
