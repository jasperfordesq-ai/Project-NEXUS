<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Exceptions\SafeguardingPolicyException;
use App\Support\CursorSigner;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;

/**
 * GroupAnnouncementService — Laravel DI-based service for group announcements.
 *
 */
class GroupAnnouncementService
{
    private array $errors = [];

    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * List announcements for a group.
     */
    public function list(int $groupId, int $userId, array $filters = []): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (!GroupAccessService::canViewMemberContent($groupId, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_announcements_member_required')];
            return null;
        }

        $limit = max(1, min((int) ($filters['limit'] ?? 20), 100));
        $cursor = $filters['cursor'] ?? null;
        $includeExpired = $filters['include_expired'] ?? false;
        $pinnedOnly = (bool) ($filters['pinned'] ?? false);

        $cursorPayload = null;
        if ($cursor !== null && $cursor !== '') {
            $cursorPayload = $this->decodeCursor($cursor, $groupId);
            if ($cursorPayload === null) {
                $this->errors[] = ['code' => 'INVALID_CURSOR', 'message' => __('api.invalid_cursor')];
                return null;
            }
        }

        $query = DB::table('group_announcements as ga')
            ->join('users as u', 'ga.created_by', '=', 'u.id')
            ->where('ga.group_id', $groupId)
            ->where('ga.tenant_id', $tenantId)
            ->select('ga.*', 'u.name as author_name', 'u.avatar_url as author_avatar');

        if (!$includeExpired) {
            $query->where(function ($q) {
                $q->whereNull('ga.expires_at')
                  ->orWhere('ga.expires_at', '>', now());
            });
        }

        if ($pinnedOnly) {
            $query->where('ga.is_pinned', 1);
        }

        if ($cursorPayload !== null) {
            $query->where(function ($after) use ($cursorPayload): void {
                $after->where('ga.is_pinned', '<', $cursorPayload['pinned'])
                    ->orWhere(function ($samePinned) use ($cursorPayload): void {
                        $samePinned->where('ga.is_pinned', $cursorPayload['pinned'])
                            ->where(function ($lowerPriority) use ($cursorPayload): void {
                                $lowerPriority->where('ga.priority', '<', $cursorPayload['priority'])
                                    ->orWhere(function ($samePriority) use ($cursorPayload): void {
                                        $samePriority->where('ga.priority', $cursorPayload['priority'])
                                            ->where(function ($older) use ($cursorPayload): void {
                                                $older->where('ga.created_at', '<', $cursorPayload['created_at'])
                                                    ->orWhere(function ($sameTime) use ($cursorPayload): void {
                                                        $sameTime->where('ga.created_at', $cursorPayload['created_at'])
                                                            ->where('ga.id', '<', $cursorPayload['id']);
                                                    });
                                            });
                                    });
                            });
                    });
            });
        }

        $announcements = $query
            ->orderByDesc('ga.is_pinned')
            ->orderByDesc('ga.priority')
            ->orderByDesc('ga.created_at')
            ->orderByDesc('ga.id')
            ->limit($limit + 1)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        $hasMore = count($announcements) > $limit;
        if ($hasMore) {
            array_pop($announcements);
        }

        $items = array_map(fn (array $announcement): array => $this->formatAnnouncement($announcement), $announcements);
        $last = $announcements === [] ? null : $announcements[array_key_last($announcements)];

        return [
            'items' => $items,
            'cursor' => $hasMore && $last !== null ? $this->encodeCursor($groupId, $last) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get a single announcement.
     */
    public function getById(int $groupId, int $announcementId, int $userId): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (!GroupAccessService::canViewMemberContent($groupId, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_announcements_member_required')];
            return null;
        }

        $row = DB::table('group_announcements as ga')
            ->join('users as u', 'ga.created_by', '=', 'u.id')
            ->where('ga.id', $announcementId)
            ->where('ga.group_id', $groupId)
            ->where('ga.tenant_id', $tenantId)
            ->select('ga.*', 'u.name as author_name', 'u.avatar_url as author_avatar')
            ->first();

        if (!$row) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_announcement_not_found')];
            return null;
        }

        return $this->formatAnnouncement((array) $row);
    }

    /**
     * Create an announcement (admin only).
     */
    public function create(int $groupId, int $userId, array $data): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (!$this->isAdmin($groupId, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_announcement_admin_create_forbidden')];
            return null;
        }

        $title = trim($data['title'] ?? '');
        $content = trim($data['content'] ?? '');

        if (empty($title)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_announcement_title_required'), 'field' => 'title'];
            return null;
        }
        if (mb_strlen($title) > 255) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_announcement_title_max'), 'field' => 'title'];
            return null;
        }
        if (empty($content)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_announcement_content_required'), 'field' => 'content'];
            return null;
        }

        $isPinned = (bool) ($data['is_pinned'] ?? false);
        $priority = max(0, (int) ($data['priority'] ?? 0));
        $expiresAt = !empty($data['expires_at']) ? date('Y-m-d H:i:s', strtotime($data['expires_at'])) : null;
        $identity = GroupContentCreationReceiptService::identity($data['idempotency_key'] ?? null, [
            'content' => $content,
            'expires_at' => $expiresAt,
            'group_id' => $groupId,
            'is_pinned' => $isPinned,
            'priority' => $priority,
            'title' => $title,
        ]);
        if ($identity === false) {
            $this->errors[] = ['code' => 'IDEMPOTENCY_INVALID', 'message' => __('event_registration.idempotency_invalid')];
            return null;
        }

        try {
            return DB::transaction(function () use (
                $groupId,
                $userId,
                $tenantId,
                $title,
                $content,
                $isPinned,
                $priority,
                $expiresAt,
                $identity,
            ): ?array {
                if ($identity !== null) {
                    GroupContentCreationReceiptService::lockActor((int) $tenantId, $userId);
                    $receipt = GroupContentCreationReceiptService::find((int) $tenantId, $userId, 'announcement', $identity['key_hash']);
                    if ($receipt !== null) {
                        if (! GroupContentCreationReceiptService::matches($receipt, $identity['request_hash'])) {
                            $this->errors[] = ['code' => 'IDEMPOTENCY_CONFLICT', 'message' => __('event_registration.idempotency_conflict')];
                            return null;
                        }
                        $payload = GroupContentCreationReceiptService::payload($receipt);
                        if ($payload === null) {
                            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.generic_error')];
                            return null;
                        }
                        $payload['_idempotent_replay'] = true;
                        return $payload;
                    }
                }

                GroupService::assertSafeguardingBroadcastAllowed(
                    $groupId,
                    $userId,
                    $tenantId,
                    'group_announcement_create',
                    $title . ' ' . $content,
                );

                $id = DB::table('group_announcements')->insertGetId([
                    'group_id'   => $groupId,
                    'tenant_id'  => $tenantId,
                    'title'      => $title,
                    'content'    => $content,
                    'is_pinned'  => $isPinned ? 1 : 0,
                    'priority'   => $priority,
                    'created_by' => $userId,
                    'created_at' => now(),
                    'expires_at' => $expiresAt,
                ]);

                $result = $this->getById($groupId, $id, $userId);
                if ($result !== null && $identity !== null) {
                    GroupContentCreationReceiptService::store(
                        (int) $tenantId,
                        $userId,
                        $groupId,
                        'announcement',
                        $identity,
                        (int) $id,
                        $result,
                    );
                }
                return $result;
            }, 3);
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.group_announcement_create_failed')];
            return null;
        }
    }

    /**
     * Update an announcement (admin only).
     */
    public function update(int $groupId, int $announcementId, int $userId, array $data): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (!$this->isAdmin($groupId, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_announcement_admin_update_forbidden')];
            return null;
        }

        $exists = DB::table('group_announcements')
            ->where('id', $announcementId)
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (!$exists) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_announcement_not_found')];
            return null;
        }

        $updates = [];

        if (array_key_exists('title', $data)) {
            $title = trim($data['title']);
            if (empty($title)) {
                $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_announcement_title_required'), 'field' => 'title'];
                return null;
            }
            if (mb_strlen($title) > 255) {
                $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_announcement_title_max'), 'field' => 'title'];
                return null;
            }
            $updates['title'] = $title;
        }
        if (array_key_exists('content', $data)) {
            $content = trim($data['content']);
            if (empty($content)) {
                $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.group_announcement_content_required'), 'field' => 'content'];
                return null;
            }
            $updates['content'] = $content;
        }
        if (array_key_exists('is_pinned', $data)) {
            $updates['is_pinned'] = (bool) $data['is_pinned'] ? 1 : 0;
        }
        if (array_key_exists('priority', $data)) {
            $updates['priority'] = max(0, (int) $data['priority']);
        }
        if (array_key_exists('expires_at', $data)) {
            $updates['expires_at'] = $data['expires_at'] ? date('Y-m-d H:i:s', strtotime($data['expires_at'])) : null;
        }

        if (!empty($updates)) {
            DB::transaction(function () use ($groupId, $announcementId, $userId, $tenantId, &$updates): void {
                if (array_key_exists('title', $updates) || array_key_exists('content', $updates)) {
                    GroupService::assertSafeguardingBroadcastAllowed(
                        $groupId,
                        $userId,
                        $tenantId,
                        'group_announcement_update',
                        trim((string) ($updates['title'] ?? '') . ' ' . (string) ($updates['content'] ?? '')),
                    );
                }

                $updates['updated_at'] = now();
                DB::table('group_announcements')
                    ->where('id', $announcementId)
                    ->where('group_id', $groupId)
                    ->where('tenant_id', $tenantId)
                    ->update($updates);
            });
        }

        return $this->getById($groupId, $announcementId, $userId);
    }

    /**
     * Delete an announcement (admin only).
     */
    public function delete(int $groupId, int $announcementId, int $userId): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (!$this->isAdmin($groupId, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_announcement_admin_delete_forbidden')];
            return false;
        }

        return DB::transaction(function () use ($groupId, $announcementId, $userId, $tenantId): bool {
            DB::table('groups')
                ->where('id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            $announcement = DB::table('group_announcements')
                ->where('id', $announcementId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if ($announcement === null) {
                $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_announcement_not_found')];
                return false;
            }

            $deleted = DB::table('group_announcements')
                ->where('id', $announcementId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->delete();
            if ($deleted !== 1) {
                $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_announcement_not_found')];
                return false;
            }

            GroupContentCreationReceiptService::deleteForResult(
                (int) $tenantId,
                $groupId,
                'announcement',
                $announcementId,
            );

            GroupAuditService::log(
                GroupAuditService::ACTION_ANNOUNCEMENT_DELETED,
                $groupId,
                $userId,
                [
                    'announcement_id' => $announcementId,
                    'title' => (string) $announcement->title,
                    'target_user_id' => (int) $announcement->created_by,
                ],
            );

            return true;
        });
    }

    /**
     * Check if user is an admin of the group (admin/owner role).
     */
    private function isAdmin(int $groupId, int $userId): bool
    {
        return GroupAccessService::canManage($groupId, $userId)
            && GroupAccessService::canWriteContent($groupId, $userId);
    }

    /** @return array{pinned: int, priority: int, created_at: string, id: int}|null */
    private function decodeCursor(mixed $cursor, int $groupId): ?array
    {
        if (!is_string($cursor) || $cursor === '') {
            return null;
        }

        $payload = CursorSigner::decode($cursor);
        if (
            !is_array($payload)
            || ($payload['kind'] ?? null) !== 'group_announcement'
            || (int) ($payload['group_id'] ?? 0) !== $groupId
            || !isset($payload['pinned'], $payload['priority'], $payload['created_at'], $payload['id'])
            || !is_numeric($payload['pinned'])
            || !is_numeric($payload['priority'])
            || !is_string($payload['created_at'])
            || !is_numeric($payload['id'])
        ) {
            return null;
        }

        return [
            'pinned' => (int) $payload['pinned'],
            'priority' => (int) $payload['priority'],
            'created_at' => $payload['created_at'],
            'id' => (int) $payload['id'],
        ];
    }

    private function encodeCursor(int $groupId, array $last): string
    {
        return CursorSigner::encode([
            'kind' => 'group_announcement',
            'group_id' => $groupId,
            'pinned' => (int) $last['is_pinned'],
            'priority' => (int) $last['priority'],
            'created_at' => (string) $last['created_at'],
            'id' => (int) $last['id'],
        ]);
    }

    /**
     * Format announcement for API response.
     */
    private function formatAnnouncement(array $a): array
    {
        $isExpired = !empty($a['expires_at']) && strtotime($a['expires_at']) < time();

        return [
            'id' => (int) $a['id'],
            'title' => $a['title'],
            'content' => $a['content'],
            'is_pinned' => (bool) $a['is_pinned'],
            'priority' => (int) $a['priority'],
            'is_expired' => $isExpired,
            'author' => [
                'id' => (int) $a['created_by'],
                'name' => $a['author_name'] ?? null,
                'avatar_url' => $a['author_avatar'] ?? null,
            ],
            'created_at' => $a['created_at'],
            'updated_at' => $a['updated_at'] ?? null,
            'expires_at' => $a['expires_at'] ?? null,
        ];
    }
}
