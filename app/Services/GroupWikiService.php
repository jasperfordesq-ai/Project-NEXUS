<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Tenant-, lifecycle-, and publication-aware group wiki operations.
 */
final class GroupWikiService
{
    /** @var list<array{code: string, message: string}> */
    private array $errors = [];

    /** @return list<array{code: string, message: string}> */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /** @return list<array<string, mixed>>|null */
    public function listPages(int $groupId, int $userId): ?array
    {
        $this->errors = [];
        if (! $this->requireMemberContent($groupId, $userId)) {
            return null;
        }

        $tenantId = (int) TenantContext::getId();
        $canManage = GroupAccessService::canManage($groupId, $userId);
        $query = $this->pageQuery($groupId, $tenantId)
            ->select([
                'wp.id',
                'wp.group_id',
                'wp.title',
                'wp.slug',
                'wp.parent_id',
                'wp.sort_order',
                'wp.is_published',
                'wp.created_by',
                'wp.last_edited_by',
                'wp.created_at',
                'wp.updated_at',
                'u.name as author_name',
            ]);

        if (! $canManage) {
            $query->where(static function (Builder $visible) use ($userId): void {
                $visible->where('wp.is_published', true)
                    ->orWhere('wp.created_by', $userId)
                    ->orWhere('wp.last_edited_by', $userId);
            });
        }

        return $query
            ->orderBy('wp.sort_order')
            ->orderBy('wp.title')
            ->orderBy('wp.id')
            ->get()
            ->map(self::formatPage(...))
            ->values()
            ->all();
    }

    /** @return array<string, mixed>|null */
    public function getPage(int $groupId, string $slug, int $userId): ?array
    {
        $this->errors = [];
        if (! $this->requireMemberContent($groupId, $userId)) {
            return null;
        }

        $tenantId = (int) TenantContext::getId();
        $page = $this->pageQuery($groupId, $tenantId)
            ->where('wp.slug', $slug)
            ->select(['wp.*', 'u.name as author_name'])
            ->first();

        if ($page === null || ! $this->canSeePage($groupId, $userId, $page)) {
            $this->addError('NOT_FOUND', __('api.group_wiki_page_not_found'));
            return null;
        }

        return self::formatPage($page);
    }

    /**
     * @param array{title?: mixed, content?: mixed, parent_id?: mixed, sort_order?: mixed, is_published?: mixed} $input
     * @return array<string, mixed>|null
     */
    public function createPage(int $groupId, int $userId, array $input): ?array
    {
        $this->errors = [];
        if (! $this->requireWriteAccess($groupId, $userId)) {
            return null;
        }

        $title = $this->validatedTitle($input['title'] ?? null);
        $content = $this->validatedContent($input['content'] ?? '');
        $parentId = $this->validatedNullableId($input['parent_id'] ?? null);
        $sortOrder = $this->validatedSortOrder($input['sort_order'] ?? 0);
        $isPublished = $this->validatedBoolean($input['is_published'] ?? true);
        if ($title === null || $content === null || $parentId === false || $sortOrder === null || $isPublished === null) {
            return null;
        }

        $tenantId = (int) TenantContext::getId();
        $identity = GroupContentCreationReceiptService::identity($input['idempotency_key'] ?? null, [
            'content' => $content,
            'group_id' => $groupId,
            'is_published' => $isPublished,
            'parent_id' => $parentId,
            'sort_order' => $sortOrder,
            'title' => $title,
        ]);
        if ($identity === false) {
            $this->addError('IDEMPOTENCY_INVALID', __('event_registration.idempotency_invalid'));
            return null;
        }

        return DB::transaction(function () use (
            $groupId,
            $userId,
            $tenantId,
            $title,
            $content,
            $parentId,
            $sortOrder,
            $isPublished,
            $identity,
        ): ?array {
            if ($identity !== null) {
                GroupContentCreationReceiptService::lockActor($tenantId, $userId);
                $receipt = GroupContentCreationReceiptService::find($tenantId, $userId, 'wiki_page', $identity['key_hash']);
                if ($receipt !== null) {
                    if (! GroupContentCreationReceiptService::matches($receipt, $identity['request_hash'])) {
                        $this->addError('IDEMPOTENCY_CONFLICT', __('event_registration.idempotency_conflict'));
                        return null;
                    }
                    $payload = GroupContentCreationReceiptService::payload($receipt);
                    if ($payload === null) {
                        $this->addError('SERVER_ERROR', __('api.generic_error'));
                        return null;
                    }
                    $payload['_idempotent_replay'] = true;
                    return $payload;
                }
            }

            if (! $this->lockWritableGroup($groupId, $tenantId)) {
                return null;
            }

            if (is_int($parentId) && ! $this->validateParent($groupId, $parentId, $userId, $tenantId)) {
                return null;
            }

            GroupService::assertSafeguardingBroadcastAllowed(
                $groupId,
                $userId,
                $tenantId,
                'group_wiki_create',
                $title . ' ' . $content,
            );

            $now = now()->toDateTimeString();
            $slug = $this->uniqueSlug($groupId, $tenantId, $title);
            $pageId = (int) DB::table('group_wiki_pages')->insertGetId([
                'tenant_id' => $tenantId,
                'group_id' => $groupId,
                'parent_id' => $parentId,
                'title' => $title,
                'slug' => $slug,
                'content' => $content,
                'created_by' => $userId,
                'last_edited_by' => $userId,
                'sort_order' => $sortOrder,
                'is_published' => $isPublished,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            DB::table('group_wiki_revisions')->insert([
                'page_id' => $pageId,
                'content' => $content,
                'edited_by' => $userId,
                'change_summary' => __('api.group_wiki_initial_revision'),
                'created_at' => $now,
            ]);

            $result = self::formatPage($this->findPageById($groupId, $pageId, $tenantId));
            if ($identity !== null) {
                GroupContentCreationReceiptService::store(
                    $tenantId,
                    $userId,
                    $groupId,
                    'wiki_page',
                    $identity,
                    $pageId,
                    $result,
                );
            }
            return $result;
        }, 3);
    }

    /**
     * @param array{title?: mixed, content?: mixed, parent_id?: mixed, sort_order?: mixed, is_published?: mixed, change_summary?: mixed, expected_updated_at?: mixed} $input
     * @return array<string, mixed>|null
     */
    public function updatePage(int $groupId, int $pageId, int $userId, array $input): ?array
    {
        $this->errors = [];
        if (! $this->requireWriteAccess($groupId, $userId)) {
            return null;
        }

        $tenantId = (int) TenantContext::getId();

        return DB::transaction(function () use ($groupId, $pageId, $userId, $input, $tenantId): ?array {
            if (! $this->lockWritableGroup($groupId, $tenantId)) {
                return null;
            }

            $page = DB::table('group_wiki_pages')
                ->where('id', $pageId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if ($page === null) {
                $this->addError('NOT_FOUND', __('api.group_wiki_page_not_found'));
                return null;
            }
            if (! $this->canEditPage($groupId, $userId, $page)) {
                $this->addError('FORBIDDEN', __('api.group_wiki_forbidden'));
                return null;
            }
            if (! $this->matchesExpectedTimestamp($page, $input['expected_updated_at'] ?? null)) {
                return null;
            }

            $title = array_key_exists('title', $input)
                ? $this->validatedTitle($input['title'])
                : (string) $page->title;
            $content = array_key_exists('content', $input)
                ? $this->validatedContent($input['content'])
                : (string) $page->content;
            $sortOrder = array_key_exists('sort_order', $input)
                ? $this->validatedSortOrder($input['sort_order'])
                : (int) $page->sort_order;
            $isPublished = array_key_exists('is_published', $input)
                ? $this->validatedBoolean($input['is_published'])
                : (bool) $page->is_published;
            $parentId = array_key_exists('parent_id', $input)
                ? $this->validatedNullableId($input['parent_id'])
                : ($page->parent_id === null ? null : (int) $page->parent_id);

            if ($title === null || $content === null || $sortOrder === null || $isPublished === null || $parentId === false) {
                return null;
            }
            if (is_int($parentId)) {
                if ($parentId === $pageId || $this->wouldCreateCycle($groupId, $pageId, $parentId, $tenantId)) {
                    $this->addError('CONFLICT', __('api.generic_error'));
                    return null;
                }
                if (! $this->validateParent($groupId, $parentId, $userId, $tenantId)) {
                    return null;
                }
            }

            $summary = $input['change_summary'] ?? '';
            if (! is_string($summary) || mb_strlen($summary) > 255) {
                $this->addError('VALIDATION', __('api.generic_error'));
                return null;
            }

            GroupService::assertSafeguardingBroadcastAllowed(
                $groupId,
                $userId,
                $tenantId,
                'group_wiki_update',
                $title . ' ' . $content,
                [(int) $page->created_by],
            );

            $updatedAt = $this->nextTimestamp((string) $page->updated_at);
            DB::table('group_wiki_pages')
                ->where('id', $pageId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'parent_id' => $parentId,
                    'title' => $title,
                    'content' => $content,
                    'last_edited_by' => $userId,
                    'sort_order' => $sortOrder,
                    'is_published' => $isPublished,
                    'updated_at' => $updatedAt,
                ]);

            DB::table('group_wiki_revisions')->insert([
                'page_id' => $pageId,
                'content' => $content,
                'edited_by' => $userId,
                'change_summary' => trim($summary),
                'created_at' => $updatedAt,
            ]);

            return self::formatPage($this->findPageById($groupId, $pageId, $tenantId));
        });
    }

    public function deletePage(int $groupId, int $pageId, int $userId): bool
    {
        $this->errors = [];
        if (! $this->requireWriteAccess($groupId, $userId)) {
            return false;
        }
        if (! GroupAccessService::canManage($groupId, $userId)) {
            $this->addError('FORBIDDEN', __('api.group_wiki_forbidden'));
            return false;
        }

        $tenantId = (int) TenantContext::getId();

        return DB::transaction(function () use ($groupId, $pageId, $userId, $tenantId): bool {
            if (! $this->lockWritableGroup($groupId, $tenantId)) {
                return false;
            }

            $page = DB::table('group_wiki_pages')
                ->where('id', $pageId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if ($page === null) {
                $this->addError('NOT_FOUND', __('api.group_wiki_page_not_found'));
                return false;
            }

            $hasChildren = DB::table('group_wiki_pages')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('parent_id', $pageId)
                ->exists();
            if ($hasChildren) {
                $this->addError('CONFLICT', __('api.generic_error'));
                return false;
            }

            DB::table('group_wiki_revisions')->where('page_id', $pageId)->delete();

            $deleted = DB::table('group_wiki_pages')
                ->where('id', $pageId)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->delete();
            if ($deleted !== 1) {
                return false;
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_WIKI_PAGE_DELETED,
                $groupId,
                $userId,
                [
                    'page_id' => $pageId,
                    'title' => (string) $page->title,
                    'target_user_id' => (int) $page->created_by,
                ],
            );

            return true;
        });
    }

    /** @return list<array<string, mixed>>|null */
    public function listRevisions(int $groupId, int $pageId, int $userId): ?array
    {
        $this->errors = [];
        if (! $this->requireMemberContent($groupId, $userId)) {
            return null;
        }

        $tenantId = (int) TenantContext::getId();
        $page = DB::table('group_wiki_pages')
            ->where('id', $pageId)
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->first();
        if ($page === null) {
            $this->addError('NOT_FOUND', __('api.group_wiki_page_not_found'));
            return null;
        }

        if (! $this->canEditPage($groupId, $userId, $page)) {
            $this->addError(
                (bool) $page->is_published ? 'FORBIDDEN' : 'NOT_FOUND',
                (bool) $page->is_published
                    ? __('api.group_wiki_forbidden')
                    : __('api.group_wiki_page_not_found'),
            );
            return null;
        }

        return DB::table('group_wiki_revisions as r')
            ->leftJoin('users as u', static function ($join) use ($tenantId): void {
                $join->on('u.id', '=', 'r.edited_by')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('r.page_id', $pageId)
            ->select([
                'r.id',
                'r.page_id',
                'r.content',
                'r.edited_by',
                'u.name as editor_name',
                'r.change_summary',
                'r.created_at',
            ])
            ->orderByDesc('r.created_at')
            ->orderByDesc('r.id')
            ->get()
            ->map(self::formatRevision(...))
            ->values()
            ->all();
    }

    private function requireMemberContent(int $groupId, int $userId): bool
    {
        if (! $this->groupExistsInTenant($groupId)) {
            $this->addError('NOT_FOUND', __('api.group_not_found'));
            return false;
        }
        if (! GroupAccessService::canViewMemberContent($groupId, $userId)) {
            $this->addError('FORBIDDEN', __('api.group_wiki_forbidden'));
            return false;
        }

        return true;
    }

    private function requireWriteAccess(int $groupId, int $userId): bool
    {
        if (! $this->groupExistsInTenant($groupId)) {
            $this->addError('NOT_FOUND', __('api.group_not_found'));
            return false;
        }
        if (! GroupAccessService::canWriteContent($groupId, $userId)) {
            $this->addError('FORBIDDEN', __('api.group_wiki_forbidden'));
            return false;
        }

        return true;
    }

    private function groupExistsInTenant(int $groupId): bool
    {
        return DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', (int) TenantContext::getId())
            ->exists();
    }

    private function lockWritableGroup(int $groupId, int $tenantId): bool
    {
        $group = DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->select(['status'])
            ->lockForUpdate()
            ->first();

        if ($group === null) {
            $this->addError('NOT_FOUND', __('api.group_not_found'));
            return false;
        }

        $status = GroupStatus::tryFrom((string) $group->status);
        if ($status === null || ! $status->isWritable()) {
            $this->addError('FORBIDDEN', __('api.group_wiki_forbidden'));
            return false;
        }

        return true;
    }

    private function pageQuery(int $groupId, int $tenantId): Builder
    {
        return DB::table('group_wiki_pages as wp')
            ->leftJoin('users as u', static function ($join) use ($tenantId): void {
                $join->on('u.id', '=', 'wp.created_by')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('wp.group_id', $groupId)
            ->where('wp.tenant_id', $tenantId);
    }

    private function findPageById(int $groupId, int $pageId, int $tenantId): object
    {
        /** @var object $page */
        $page = $this->pageQuery($groupId, $tenantId)
            ->where('wp.id', $pageId)
            ->select(['wp.*', 'u.name as author_name'])
            ->firstOrFail();

        return $page;
    }

    private function canSeePage(int $groupId, int $userId, object $page): bool
    {
        return (bool) $page->is_published || $this->canEditPage($groupId, $userId, $page);
    }

    private function canEditPage(int $groupId, int $userId, object $page): bool
    {
        return (int) $page->created_by === $userId
            || (int) ($page->last_edited_by ?? 0) === $userId
            || GroupAccessService::canManage($groupId, $userId);
    }

    private function validateParent(int $groupId, int $parentId, int $userId, int $tenantId): bool
    {
        $parent = DB::table('group_wiki_pages')
            ->where('id', $parentId)
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($parent === null || ! $this->canSeePage($groupId, $userId, $parent)) {
            $this->addError('NOT_FOUND', __('api.group_wiki_page_not_found'));
            return false;
        }

        return true;
    }

    private function wouldCreateCycle(int $groupId, int $pageId, int $parentId, int $tenantId): bool
    {
        $seen = [$pageId => true];
        $cursor = $parentId;

        while ($cursor !== 0) {
            if (isset($seen[$cursor])) {
                return true;
            }
            $seen[$cursor] = true;

            $parent = DB::table('group_wiki_pages')
                ->where('id', $cursor)
                ->where('group_id', $groupId)
                ->where('tenant_id', $tenantId)
                ->value('parent_id');
            if ($parent === null) {
                return false;
            }
            $cursor = (int) $parent;
        }

        return false;
    }

    private function uniqueSlug(int $groupId, int $tenantId, string $title): string
    {
        $base = Str::slug($title);
        $base = $base === '' ? 'page' : mb_substr($base, 0, 480);
        $slug = $base;
        $suffix = 2;

        while (DB::table('group_wiki_pages')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->where('slug', $slug)
            ->exists()) {
            $slug = mb_substr($base, 0, 490) . '-' . $suffix;
            $suffix++;
        }

        return $slug;
    }

    private function validatedTitle(mixed $value): ?string
    {
        if (! is_string($value)) {
            $this->addError('VALIDATION', __('api.group_wiki_title_required'));
            return null;
        }

        $title = trim($value);
        if ($title === '' || mb_strlen($title) > 500) {
            $this->addError('VALIDATION', __('api.group_wiki_title_required'));
            return null;
        }

        return $title;
    }

    private function validatedContent(mixed $value): ?string
    {
        if (! is_string($value) || mb_strlen($value) > 1000000) {
            $this->addError('VALIDATION', __('api.generic_error'));
            return null;
        }

        return $value;
    }

    /** @return int|null|false */
    private function validatedNullableId(mixed $value): int|null|false
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (filter_var($value, FILTER_VALIDATE_INT) === false || (int) $value <= 0) {
            $this->addError('VALIDATION', __('api.generic_error'));
            return false;
        }

        return (int) $value;
    }

    private function validatedSortOrder(mixed $value): ?int
    {
        if (filter_var($value, FILTER_VALIDATE_INT) === false) {
            $this->addError('VALIDATION', __('api.generic_error'));
            return null;
        }

        $order = (int) $value;
        if ($order < -1000000 || $order > 1000000) {
            $this->addError('VALIDATION', __('api.generic_error'));
            return null;
        }

        return $order;
    }

    private function validatedBoolean(mixed $value): ?bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (in_array($value, [1, '1', 'true'], true)) {
            return true;
        }
        if (in_array($value, [0, '0', 'false'], true)) {
            return false;
        }

        $this->addError('VALIDATION', __('api.generic_error'));
        return null;
    }

    private function matchesExpectedTimestamp(object $page, mixed $expected): bool
    {
        if ($expected === null || $expected === '') {
            return true;
        }
        if (! is_string($expected)) {
            $this->addError('VALIDATION', __('api.generic_error'));
            return false;
        }

        try {
            $matches = CarbonImmutable::parse($expected)->format('Y-m-d H:i:s')
                === CarbonImmutable::parse((string) $page->updated_at)->format('Y-m-d H:i:s');
        } catch (Throwable) {
            $this->addError('VALIDATION', __('api.generic_error'));
            return false;
        }

        if (! $matches) {
            $this->addError('CONFLICT', __('api.generic_error'));
        }

        return $matches;
    }

    private function nextTimestamp(string $current): string
    {
        $currentTimestamp = CarbonImmutable::parse($current)->startOfSecond();
        $now = CarbonImmutable::now()->startOfSecond();

        return ($now->greaterThan($currentTimestamp) ? $now : $currentTimestamp->addSecond())
            ->format('Y-m-d H:i:s');
    }

    /** @return array<string, mixed> */
    private static function formatPage(object|array $page): array
    {
        $row = (array) $page;
        $row['id'] = (int) ($row['id'] ?? 0);
        $row['group_id'] = (int) ($row['group_id'] ?? 0);
        $row['parent_id'] = isset($row['parent_id']) ? (int) $row['parent_id'] : null;
        $row['sort_order'] = (int) ($row['sort_order'] ?? 0);
        $row['is_published'] = (bool) ($row['is_published'] ?? false);
        $row['created_by'] = (int) ($row['created_by'] ?? 0);
        $row['last_edited_by'] = isset($row['last_edited_by']) ? (int) $row['last_edited_by'] : null;
        if (array_key_exists('content', $row)) {
            $row['content'] = (string) ($row['content'] ?? '');
        }
        $row['author'] = [
            'id' => $row['created_by'],
            'name' => $row['author_name'] ?? null,
        ];
        unset($row['author_name']);

        return $row;
    }

    /** @return array<string, mixed> */
    private static function formatRevision(object|array $revision): array
    {
        $row = (array) $revision;
        $row['id'] = (int) ($row['id'] ?? 0);
        $row['page_id'] = (int) ($row['page_id'] ?? 0);
        $row['editor'] = [
            'id' => (int) ($row['edited_by'] ?? 0),
            'name' => $row['editor_name'] ?? null,
        ];
        unset($row['edited_by'], $row['editor_name']);

        return $row;
    }

    private function addError(string $code, string $message): void
    {
        $this->errors[] = ['code' => $code, 'message' => $message];
    }
}
