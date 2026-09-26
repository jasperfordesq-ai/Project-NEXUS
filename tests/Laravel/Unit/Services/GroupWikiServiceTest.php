<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Models\User;
use App\Services\GroupAuditService;
use App\Services\GroupWikiService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class GroupWikiServiceTest extends TestCase
{
    use DatabaseTransactions;

    private GroupWikiService $service;
    private User $owner;
    private User $author;
    private User $member;
    private User $admin;
    private int $groupId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->service = new GroupWikiService();
        $this->owner = $this->user();
        $this->author = $this->user();
        $this->member = $this->user();
        $this->admin = $this->user();
        $this->groupId = $this->group(GroupStatus::Active, $this->owner);
        $this->membership($this->groupId, $this->author);
        $this->membership($this->groupId, $this->member);
        $this->membership($this->groupId, $this->admin, 'admin');
        TenantContext::setById($this->testTenantId);
    }

    public function test_draft_and_revision_policy_returns_concealing_error_codes(): void
    {
        $published = $this->service->createPage($this->groupId, (int) $this->author->id, [
            'title' => 'Published page',
            'content' => 'Published content',
            'is_published' => true,
        ]);
        $draft = $this->service->createPage($this->groupId, (int) $this->author->id, [
            'title' => 'Draft page',
            'content' => 'Draft content',
            'is_published' => false,
        ]);
        self::assertNotNull($published);
        self::assertNotNull($draft);

        $memberPages = $this->service->listPages($this->groupId, (int) $this->member->id);
        self::assertNotNull($memberPages);
        self::assertSame([(int) $published['id']], array_column($memberPages, 'id'));

        self::assertNull($this->service->getPage(
            $this->groupId,
            (string) $draft['slug'],
            (int) $this->member->id,
        ));
        self::assertSame('NOT_FOUND', $this->service->getErrors()[0]['code']);

        self::assertNull($this->service->listRevisions(
            $this->groupId,
            (int) $published['id'],
            (int) $this->member->id,
        ));
        self::assertSame('FORBIDDEN', $this->service->getErrors()[0]['code']);

        DB::table('group_wiki_pages')
            ->where('id', $draft['id'])
            ->update(['last_edited_by' => $this->member->id]);
        self::assertCount(2, $this->service->listPages(
            $this->groupId,
            (int) $this->member->id,
        ) ?? []);
        self::assertCount(1, $this->service->listRevisions(
            $this->groupId,
            (int) $draft['id'],
            (int) $this->member->id,
        ) ?? []);

        self::assertCount(1, $this->service->listRevisions(
            $this->groupId,
            (int) $draft['id'],
            (int) $this->author->id,
        ) ?? []);
        self::assertCount(2, $this->service->listPages(
            $this->groupId,
            (int) $this->admin->id,
        ) ?? []);
    }

    public function test_parent_cycle_and_stale_update_do_not_create_partial_revisions(): void
    {
        $parent = $this->service->createPage($this->groupId, (int) $this->author->id, [
            'title' => 'Parent',
            'content' => 'Parent content',
        ]);
        self::assertNotNull($parent);
        $child = $this->service->createPage($this->groupId, (int) $this->author->id, [
            'title' => 'Child',
            'content' => 'Child content',
            'parent_id' => $parent['id'],
        ]);
        self::assertNotNull($child);

        self::assertNull($this->service->updatePage(
            $this->groupId,
            (int) $parent['id'],
            (int) $this->author->id,
            ['parent_id' => $child['id']],
        ));
        self::assertSame('CONFLICT', $this->service->getErrors()[0]['code']);
        self::assertSame(1, DB::table('group_wiki_revisions')->where('page_id', $parent['id'])->count());

        $updated = $this->service->updatePage(
            $this->groupId,
            (int) $child['id'],
            (int) $this->author->id,
            [
                'content' => 'Updated child content',
                'expected_updated_at' => $child['updated_at'],
            ],
        );
        self::assertNotNull($updated);
        self::assertSame(2, DB::table('group_wiki_revisions')->where('page_id', $child['id'])->count());

        self::assertNull($this->service->updatePage(
            $this->groupId,
            (int) $child['id'],
            (int) $this->author->id,
            [
                'content' => 'Stale child content',
                'expected_updated_at' => $child['updated_at'],
            ],
        ));
        self::assertSame('CONFLICT', $this->service->getErrors()[0]['code']);
        self::assertSame('Updated child content', DB::table('group_wiki_pages')->where('id', $child['id'])->value('content'));
        self::assertSame(2, DB::table('group_wiki_revisions')->where('page_id', $child['id'])->count());
    }

    public function test_lifecycle_and_cross_group_parent_fail_before_mutation(): void
    {
        $dormantId = $this->group(GroupStatus::Dormant, $this->owner);
        $this->membership($dormantId, $this->author);
        self::assertNull($this->service->listPages($dormantId, (int) $this->author->id));
        self::assertSame('FORBIDDEN', $this->service->getErrors()[0]['code']);

        $otherGroupId = $this->group(GroupStatus::Active, $this->owner);
        $this->membership($otherGroupId, $this->author);
        $otherParent = $this->service->createPage($otherGroupId, (int) $this->author->id, [
            'title' => 'Other parent',
            'content' => 'Other content',
        ]);
        self::assertNotNull($otherParent);

        self::assertNull($this->service->createPage($this->groupId, (int) $this->author->id, [
            'title' => 'Invalid child',
            'content' => 'Must not persist',
            'parent_id' => $otherParent['id'],
        ]));
        self::assertSame('NOT_FOUND', $this->service->getErrors()[0]['code']);
        self::assertFalse(DB::table('group_wiki_pages')
            ->where('group_id', $this->groupId)
            ->where('title', 'Invalid child')
            ->exists());
    }

    public function test_page_delete_writes_actor_and_page_metadata_atomically(): void
    {
        $page = $this->service->createPage($this->groupId, (int) $this->author->id, [
            'title' => 'Audited wiki page',
            'content' => 'This page will be deleted.',
            'idempotency_key' => 'wiki-delete-receipt-1',
        ]);
        self::assertNotNull($page);
        self::assertSame(1, DB::table('group_content_creation_receipts')
            ->where('operation_type', 'wiki_page')
            ->where('result_id', $page['id'])
            ->count());

        self::assertTrue($this->service->deletePage(
            $this->groupId,
            (int) $page['id'],
            (int) $this->admin->id,
        ));

        $audit = DB::table('group_audit_log')
            ->where('group_id', $this->groupId)
            ->where('action', GroupAuditService::ACTION_WIKI_PAGE_DELETED)
            ->sole();
        self::assertSame((int) $this->admin->id, (int) $audit->user_id);
        $details = json_decode((string) $audit->details, true, 512, JSON_THROW_ON_ERROR);
        self::assertSame((int) $page['id'], (int) $details['page_id']);
        self::assertSame((int) $this->author->id, (int) $details['target_user_id']);
        self::assertSame('Audited wiki page', $details['title']);
        self::assertSame(0, DB::table('group_content_creation_receipts')
            ->where('operation_type', 'wiki_page')
            ->where('result_id', $page['id'])
            ->count());

        $recreated = $this->service->createPage($this->groupId, (int) $this->author->id, [
            'title' => 'Audited wiki page',
            'content' => 'This page will be deleted.',
            'idempotency_key' => 'wiki-delete-receipt-1',
        ]);
        self::assertNotNull($recreated);
        self::assertNotSame((int) $page['id'], (int) $recreated['id']);
    }

    private function user(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create();
    }

    private function group(GroupStatus $status, User $owner): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Wiki service ' . uniqid('', true),
            'description' => 'Wiki service fixture.',
            'visibility' => 'private',
            'status' => $status->value,
            'is_active' => $status->legacyIsActive(),
            'cached_member_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function membership(int $groupId, User $user, string $role = 'member'): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
