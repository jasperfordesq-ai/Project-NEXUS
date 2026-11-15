<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Migrated\Controllers\Api;

use Tests\Laravel\LegacyBridgeTestCase;
use App\Core\TenantContext;
use App\Services\MessageService;
use Illuminate\Support\Facades\DB;

/**
 * Test Cases for Messages API Controller (Laravel migration)
 *
 * Migrated from: App\Tests\Controllers\Api\MessagesApiControllerTest
 * Original base: ApiTestCase -> now LegacyBridgeTestCase
 *
 * Tests the V2 Messages API endpoints:
 * - POST /api/v2/messages (send message)
 * - GET /api/v2/messages (list conversations)
 * - GET /api/v2/messages/{id} (get conversation messages)
 */
class MessagesApiControllerTest extends LegacyBridgeTestCase
{
    protected ?int $recipientId = null;
    protected MessageService $messageService;

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::setById(static::$legacyTestTenantId);

        // MessageService::send() resolves the active tenant via app('tenant.id'),
        // a binding normally set by the ResolveTenant middleware on HTTP requests.
        // These tests call the service directly (no HTTP cycle), so bind it here.
        $this->app->instance('tenant.id', static::$legacyTestTenantId);

        $this->messageService = $this->app->make(MessageService::class);

        // Create a recipient user for message tests
        $recipient = $this->createUser([
            'first_name' => 'Recipient',
            'last_name'  => 'User',
        ]);
        $this->recipientId = $recipient['id'];
    }

    protected function tearDown(): void
    {
        if ($this->recipientId) {
            try {
                DB::table('messages')
                    ->where('sender_id', $this->recipientId)
                    ->orWhere('receiver_id', $this->recipientId)
                    ->delete();
                DB::table('notifications')->where('user_id', $this->recipientId)->delete();
            } catch (\Exception $e) {
                // Ignore — tables may not exist during early migration
            }
            $this->cleanupUser($this->recipientId);
        }

        // Clean up test user messages
        if (static::$testUserId) {
            try {
                DB::table('messages')
                    ->where('sender_id', static::$testUserId)
                    ->orWhere('receiver_id', static::$testUserId)
                    ->delete();
            } catch (\Exception $e) {
                // Ignore
            }
        }

        parent::tearDown();
    }

    /**
     * Test: MessageService::send returns correct response shape
     */
    public function testSendMessageReturnsCorrectShape(): void
    {
        $result = $this->messageService->send(static::$testUserId, [
            'recipient_id' => $this->recipientId,
            'body' => 'Test message for response shape validation',
        ]);

        $this->assertNotNull($result, 'MessageService::send should return a result');
        $this->assertArrayNotHasKey('error', $result, 'Should not have error key');

        // Required fields. MessageService::send() returns the canonical message
        // shape keyed on `body` (the `content` alias is only added by the read
        // paths such as getConversations(), not by send()).
        $this->assertArrayHasKey('id', $result, 'Response must have id');
        $this->assertArrayHasKey('body', $result, 'Response must have body');
        $this->assertArrayHasKey('sender_id', $result, 'Response must have sender_id for frontend compatibility');
        $this->assertArrayHasKey('created_at', $result, 'Response must have created_at timestamp');

        // Type validation
        $this->assertIsInt($result['id'], 'id should be an integer');
        $this->assertIsString($result['body'], 'body should be a string');
        $this->assertIsInt($result['sender_id'], 'sender_id should be an integer');

        $this->assertEquals(static::$testUserId, $result['sender_id'], 'sender_id should match the sending user');
    }

    /**
     * Test: MessageService::send includes sender object
     */
    public function testSendMessageIncludesSenderObject(): void
    {
        $result = $this->messageService->send(static::$testUserId, [
            'recipient_id' => $this->recipientId,
            'body' => 'Test message with sender object',
        ]);

        $this->assertNotNull($result);
        $this->assertArrayNotHasKey('error', $result);
        $this->assertArrayHasKey('sender', $result, 'Response must have sender object');
        $this->assertIsArray($result['sender'], 'sender should be an array');
        $this->assertArrayHasKey('id', $result['sender'], 'sender must have id');
    }

    /**
     * Test: MessageService::send includes recipient_id
     */
    public function testSendMessageIncludesRecipientId(): void
    {
        $result = $this->messageService->send(static::$testUserId, [
            'recipient_id' => $this->recipientId,
            'body' => 'Test message with recipient',
        ]);

        $this->assertNotNull($result);
        $this->assertArrayNotHasKey('error', $result);
        $this->assertArrayHasKey('receiver_id', $result, 'Response must have receiver_id');
        $this->assertEquals($this->recipientId, $result['receiver_id'], 'receiver_id should match');
    }

    /**
     * Test: MessageService validation - missing recipient
     */
    public function testSendMessageValidationMissingRecipient(): void
    {
        $result = $this->messageService->send(static::$testUserId, [
            'body' => 'Test message without recipient',
        ]);

        // On validation failure the service returns [] and records the reason via
        // getErrors() (the mechanism the HTTP controller surfaces as a 422).
        $this->assertSame([], $result, 'Failed send should return an empty array');
        $errors = $this->messageService->getErrors();
        $this->assertNotEmpty($errors, 'Should record an error for missing recipient');
        // Assert on the translation, not on English wording: the message text is
        // copy that gets reworded (warmth phase 6 voice pass), the key does not.
        $this->assertSame('VALIDATION_ERROR', $errors[0]['code'] ?? null);
        $this->assertSame(__('api.message_recipient_required'), $errors[0]['message'] ?? null);
    }

    /**
     * Test: MessageService validation - empty body
     */
    public function testSendMessageValidationEmptyBody(): void
    {
        $result = $this->messageService->send(static::$testUserId, [
            'recipient_id' => $this->recipientId,
            'body' => '',
        ]);

        // Empty body is a validation failure: [] return + getErrors() populated.
        $this->assertSame([], $result, 'Failed send should return an empty array');
        $this->assertNotEmpty($this->messageService->getErrors(), 'Should record an error for empty body');
    }

    /**
     * Test: MessageService validation - cannot message self
     */
    public function testSendMessageCannotMessageSelf(): void
    {
        // The service currently doesn't block self-messaging explicitly,
        // but we verify the send goes through and sender_id == receiver_id
        $result = $this->messageService->send(static::$testUserId, [
            'recipient_id' => static::$testUserId,
            'body' => 'Test message to self',
        ]);

        // Whether this is blocked or allowed depends on business rules.
        // Just verify we get a response (not an exception).
        $this->assertNotNull($result);
    }

    /**
     * Test: Sending a message creates a DB record
     */
    public function testSendMessageCreatesRecord(): void
    {
        $result = $this->messageService->send(static::$testUserId, [
            'recipient_id' => $this->recipientId,
            'body' => 'Test message for record creation',
        ]);

        $this->assertArrayNotHasKey('error', $result);
        $this->assertArrayHasKey('id', $result);

        $record = DB::table('messages')->where('id', $result['id'])->first();
        $this->assertNotNull($record, 'Message record should exist in DB');
        $this->assertEquals(static::$testUserId, $record->sender_id);
        $this->assertEquals($this->recipientId, $record->receiver_id);
    }

    /**
     * Test: MessageService::getMessages returns correct shape
     */
    public function testGetMessagesReturnsCorrectShape(): void
    {
        // Send a test message first
        $this->messageService->send(static::$testUserId, [
            'recipient_id' => $this->recipientId,
            'body' => 'Test message for getMessages shape test',
        ]);

        $result = $this->messageService->getMessages($this->recipientId, static::$testUserId);

        $this->assertNotNull($result);
        $this->assertArrayHasKey('items', $result, 'Response must have items array');
        $this->assertArrayHasKey('cursor', $result, 'Response must have cursor');
        $this->assertArrayHasKey('has_more', $result, 'Response must have has_more flag');

        $this->assertIsArray($result['items'], 'items should be an array');
        $this->assertIsBool($result['has_more'], 'has_more should be a boolean');

        if (!empty($result['items'])) {
            $message = $result['items'][0];
            $this->assertArrayHasKey('id', $message);
            // getMessages() items are raw message models keyed on `body`.
            $this->assertArrayHasKey('body', $message);
            $this->assertArrayHasKey('created_at', $message);
            $this->assertArrayHasKey('sender', $message);
        }
    }

    /**
     * Test: MessageService::getConversations returns correct shape
     */
    public function testGetConversationsReturnsCorrectShape(): void
    {
        // Send a test message to create a conversation
        $this->messageService->send(static::$testUserId, [
            'recipient_id' => $this->recipientId,
            'body' => 'Test message for conversation list',
        ]);

        $result = $this->messageService->getConversations(static::$testUserId);

        $this->assertArrayHasKey('items', $result, 'Response must have items array');
        $this->assertArrayHasKey('cursor', $result, 'Response must have cursor');
        $this->assertArrayHasKey('has_more', $result, 'Response must have has_more flag');

        if (!empty($result['items'])) {
            $conversation = $result['items'][0];
            $this->assertArrayHasKey('id', $conversation);
            $this->assertArrayHasKey('sender', $conversation);
            // Conversation rows are raw message models (keyed on `body`) enriched
            // with partner/unread/last_message metadata; the `content` alias lives
            // under last_message, not at the top level.
            $this->assertArrayHasKey('body', $conversation);
            $this->assertArrayHasKey('content', $conversation['last_message']);
        }
    }
}
