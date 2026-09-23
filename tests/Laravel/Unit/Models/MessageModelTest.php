<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Models;

use Tests\Laravel\TestCase;
use App\Models\Message;
use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Message Model Tests
 *
 * Tests the Message Eloquent model structure, traits, relationships,
 * scopes, and available static methods:
 * getReactionsBatch().
 */
class MessageModelTest extends \Tests\Laravel\TestCase
{
    private Message $model;

    protected function setUp(): void
    {
        parent::setUp();
        $this->model = new Message();
    }

    // ==========================================
    // Model Structure Tests
    // ==========================================

    public function testTableName(): void
    {
        $this->assertEquals('messages', $this->model->getTable());
    }

    public function testTimestampsDisabled(): void
    {
        $this->assertFalse($this->model->usesTimestamps());
    }

    public function testCastsAreCorrect(): void
    {
        $casts = $this->model->getCasts();
        $this->assertEquals('boolean', $casts['is_read']);
        $this->assertEquals('boolean', $casts['is_edited']);
        $this->assertEquals('boolean', $casts['is_deleted_sender']);
        $this->assertEquals('boolean', $casts['is_deleted_receiver']);
        $this->assertEquals('datetime', $casts['created_at']);
        $this->assertEquals('datetime', $casts['edited_at']);
        $this->assertEquals('datetime', $casts['read_at']);
    }

    public function testUsesHasTenantScope(): void
    {
        $this->assertContains(
            HasTenantScope::class,
            class_uses_recursive(Message::class)
        );
    }

    // ==========================================
    // Relationship Tests
    // ==========================================

    public function testSenderRelationshipReturnsBelongsTo(): void
    {
        $this->assertInstanceOf(BelongsTo::class, $this->model->sender());
    }

    public function testReceiverRelationshipReturnsBelongsTo(): void
    {
        $this->assertInstanceOf(BelongsTo::class, $this->model->receiver());
    }

    public function testListingRelationshipReturnsBelongsTo(): void
    {
        $this->assertInstanceOf(BelongsTo::class, $this->model->listing());
    }

    // ==========================================
    // Scope Tests
    // ==========================================

    public function testScopeUnreadReturnsBuilder(): void
    {
        $builder = Message::query()->unread();
        $this->assertInstanceOf(Builder::class, $builder);
    }

    public function testScopeBetweenUsersReturnsBuilder(): void
    {
        $builder = Message::query()->betweenUsers(1, 2);
        $this->assertInstanceOf(Builder::class, $builder);
    }

    // ==========================================
    // Static Method Existence Tests
    // ==========================================

    public function testHardDeleteConversationHelperWasRemoved(): void
    {
        // F-087: Message::deleteConversation() hard-deleted both members'
        // messages and cascaded away broker safeguarding copies. It was
        // removed; the legacy route now archives for the caller only.
        $this->assertFalse(
            method_exists(Message::class, 'deleteConversation'),
            'Message::deleteConversation() must not be reintroduced'
        );
    }

    public function testGetReactionsBatchMethodExists(): void
    {
        $this->assertTrue(
            method_exists(Message::class, 'getReactionsBatch'),
            'Message::getReactionsBatch() should exist'
        );
    }

    public function testGetReactionsBatchWithEmptyArray(): void
    {
        $result = Message::getReactionsBatch([]);
        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }

}
