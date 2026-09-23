<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Messages;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\MessageService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * MessageService::sendWithUploadedAttachments persists file/image attachments
 * (message_attachments table) staged server-side by the controller, allows an
 * attachment-only message (no text body), and getMessages() eager-loads them
 * back. Before this, the React composer's attachments[] were silently dropped.
 * Real-DB coverage so the write + read paths can't drift from the schema again.
 *
 * F-089: generic MessageService::send() no longer accepts attachment metadata
 * at all. These tests used to pass invented `/uploads/...` rows straight to
 * send(), which is exactly the client-injection path that was closed; they now
 * stage real files in the tenant's private attachment store, as the upload does.
 */
class MessageAttachmentsTest extends TestCase
{
    use DatabaseTransactions;

    public function test_attachment_failure_rolls_back_message_and_receipt_and_allows_retry(): void
    {
        [$tenantId, $sender, $receiver] = $this->tenantAndTwoUsers();
        \Illuminate\Support\Facades\Event::fake([\App\Events\MessageSent::class]);
        $failAttachment = true;
        \Illuminate\Support\Facades\Event::listen(
            'eloquent.creating: ' . \App\Models\MessageAttachment::class,
            function ($attachment) use (&$failAttachment): void {
                if ($failAttachment && $attachment->file_name === 'atomic-second.png') {
                    throw new \RuntimeException('synthetic attachment persistence failure');
                }
            },
        );
        $payload = [
            'recipient_id' => $receiver,
            'body' => 'atomic attachment regression',
            'idempotency_key' => 'atomic-attachment-regression',
            'idempotency_request_hash' => hash('sha256', 'atomic attachment regression'),
        ];
        $staged = array_map(
            fn ($name) => $this->stageAttachment($tenantId, $name, 'image/png'),
            ['atomic-first.png', 'atomic-second.png'],
        );
        try {
            $failure = null;
            try { MessageService::sendWithUploadedAttachments($sender, $payload, $staged); }
            catch (\RuntimeException $error) { $failure = $error; }
            $this->assertNotNull($failure, 'A partial attachment send must not report success');
            $this->assertSame('synthetic attachment persistence failure', $failure->getMessage());
            $this->assertDatabaseMissing('messages', ['tenant_id' => $tenantId, 'sender_id' => $sender, 'body' => $payload['body']]);
            $this->assertDatabaseMissing('message_attachments', ['tenant_id' => $tenantId, 'file_name' => 'atomic-first.png']);
            $this->assertDatabaseMissing('message_send_receipts', ['tenant_id' => $tenantId, 'sender_id' => $sender, 'idempotency_key_hash' => hash('sha256', $payload['idempotency_key'])]);
            \Illuminate\Support\Facades\Event::assertNotDispatched(\App\Events\MessageSent::class);
            $failAttachment = false;
            $result = MessageService::sendWithUploadedAttachments($sender, $payload, $staged);
            $this->assertCount(2, $result['attachments']);
            $replay = MessageService::sendWithUploadedAttachments($sender, $payload, $staged);
            $this->assertSame($result['id'], $replay['id']);
            $this->assertSame(1, DB::table('messages')->where('tenant_id', $tenantId)->where('sender_id', $sender)->where('body', $payload['body'])->count());
        } finally { $failAttachment = false; $this->unstage($staged); TenantContext::reset(); }
    }

    /** @return array{url:string,path:string,name:string,size:int,mime:string,type:string} */
    private function stageAttachment(int $tenantId, string $name, string $mime, int $size = 10): array
    {
        $extension = strtolower((string) pathinfo($name, PATHINFO_EXTENSION));
        $relative = "message-media/{$tenantId}/attachments/" . bin2hex(random_bytes(16)) . ".{$extension}";
        $path = storage_path('app/private/' . $relative);
        File::ensureDirectoryExists(dirname($path), 0700, true);
        File::put($path, str_repeat('x', $size));

        return [
            'url' => $relative,
            'path' => $relative,
            'name' => $name,
            'size' => $size,
            'mime' => $mime,
            'type' => str_starts_with($mime, 'image/') ? 'image' : 'file',
        ];
    }

    /** @param list<array{path:string}> $staged */
    private function unstage(array $staged): void
    {
        foreach ($staged as $attachment) {
            @unlink(storage_path('app/private/' . $attachment['path']));
        }
    }

    public function test_generic_send_ignores_client_attachment_metadata(): void
    {
        [$tenantId, $sender, $receiver] = $this->tenantAndTwoUsers();
        $staged = [$this->stageAttachment($tenantId, 'someone-elses.pdf', 'application/pdf')];

        try {
            $result = MessageService::send($sender, $receiver, [
                'body' => 'forged metadata',
                'attachments' => $staged,
            ]);

            $this->assertNotEmpty($result);
            $this->assertSame([], $result['attachments']);
        } finally {
            $this->unstage($staged);
            TenantContext::reset();
        }
    }

    public function test_uploaded_attachment_rows_must_resolve_in_this_tenants_store(): void
    {
        [$tenantId, $sender, $receiver] = $this->tenantAndTwoUsers();
        $missing = "message-media/{$tenantId}/attachments/does-not-exist.pdf";
        $legacy = '/uploads/' . $tenantId . '/message_attachments/x.png';

        try {
            foreach ([
                ['url' => $missing, 'path' => $missing, 'name' => 'x.pdf', 'size' => 1, 'mime' => 'application/pdf', 'type' => 'file'],
                ['url' => $legacy, 'path' => $legacy, 'name' => 'x.png', 'size' => 1, 'mime' => 'image/png', 'type' => 'image'],
                ['url' => 'https://example.test/x.png', 'path' => 'https://example.test/x.png', 'name' => 'x.png', 'size' => 1, 'mime' => 'image/png', 'type' => 'image'],
            ] as $row) {
                $result = MessageService::sendWithUploadedAttachments($sender, ['recipient_id' => $receiver, 'body' => 'x'], [$row]);
                $this->assertSame([], $result, 'Unresolvable attachment row was accepted: ' . $row['path']);
                $this->assertSame('VALIDATION_ERROR', MessageService::getErrors()[0]['code'] ?? null);
            }
        } finally {
            TenantContext::reset();
        }
    }

    /** @return array{0:int,1:int,2:int} [tenantId, senderId, receiverId] */
    private function tenantAndTwoUsers(): array
    {
        $tenantId = (int) DB::table('tenants')->where('is_active', 1)->orderBy('id')->value('id');
        $users = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->orderBy('id')
            ->limit(2)
            ->pluck('id')
            ->all();
        if (count($users) < 2) {
            $this->markTestSkipped('Test DB lacks two active users');
        }
        TenantContext::setById($tenantId);
        $this->app->instance('tenant.id', $tenantId);

        return [$tenantId, (int) $users[0], (int) $users[1]];
    }

    public function test_send_persists_attachment_metadata_and_returns_it(): void
    {
        [$tenantId, $sender, $receiver] = $this->tenantAndTwoUsers();

        $staged = [$this->stageAttachment($tenantId, 'photo.png', 'image/png', 1234)];

        try {
            $result = MessageService::sendWithUploadedAttachments($sender, [
                'recipient_id' => $receiver,
                'body' => 'See the attached file',
            ], $staged);

            $this->assertNotEmpty($result, 'Send failed: ' . json_encode(MessageService::getErrors()));
            $this->assertArrayHasKey('attachments', $result);
            $this->assertCount(1, $result['attachments']);
            $att = $result['attachments'][0];
            $this->assertSame('photo.png', $att['file_name']);
            // React's MessageAttachment shape { url, type, name, size } via model accessors.
            $this->assertSame(
                '/api/v2/messages/' . $result['id'] . '/attachments/' . $att['id'],
                $att['url'],
            );
            $this->assertSame('image', $att['type']);
            $this->assertSame('photo.png', $att['name']);
            $this->assertSame(1234, (int) $att['size']);

            $row = DB::table('message_attachments')
                ->where('tenant_id', $tenantId)
                ->where('message_id', (int) $result['id'])
                ->first();
            $this->assertNotNull($row, 'Attachment row not persisted');
            $this->assertSame($staged[0]['path'], $row->file_url);
            $this->assertSame('image/png', $row->mime_type);
            $this->assertSame(1234, (int) $row->file_size);
        } finally {
            $this->unstage($staged);
            TenantContext::reset();
        }
    }

    public function test_send_allows_attachment_only_message_with_no_body(): void
    {
        [$tenantId, $sender, $receiver] = $this->tenantAndTwoUsers();

        $staged = [$this->stageAttachment($tenantId, 'brief.pdf', 'application/pdf', 999)];

        try {
            $result = MessageService::sendWithUploadedAttachments($sender, [
                'recipient_id' => $receiver,
                'body' => '',
            ], $staged);

            $this->assertNotEmpty($result, 'Attachment-only send failed: ' . json_encode(MessageService::getErrors()));
            $this->assertSame('', (string) ($result['body'] ?? ''));
            $this->assertCount(1, $result['attachments'] ?? []);
        } finally {
            $this->unstage($staged);
            TenantContext::reset();
        }
    }

    public function test_send_with_no_body_no_voice_no_attachment_is_rejected(): void
    {
        [, $sender, $receiver] = $this->tenantAndTwoUsers();

        try {
            $result = MessageService::send($sender, $receiver, ['body' => '']);
            $this->assertEmpty($result, 'Empty message should be rejected');
            $errors = MessageService::getErrors();
            $this->assertSame('VALIDATION_ERROR', $errors[0]['code'] ?? null);
        } finally {
            TenantContext::reset();
        }
    }

    public function test_get_messages_eager_loads_attachments(): void
    {
        [$tenantId, $sender, $receiver] = $this->tenantAndTwoUsers();

        $staged = [$this->stageAttachment($tenantId, 'x.png', 'image/png')];

        try {
            MessageService::sendWithUploadedAttachments($sender, [
                'recipient_id' => $receiver,
                'body' => 'with file',
            ], $staged);

            $thread = MessageService::getMessages($receiver, $sender, ['limit' => 10]);
            $this->assertNotNull($thread);
            $withAttachment = collect($thread['items'] ?? [])->first(fn ($m) => !empty($m['attachments']));
            $this->assertNotNull($withAttachment, 'getMessages did not return the attachment');
            $this->assertSame('x.png', $withAttachment['attachments'][0]['file_name']);
        } finally {
            $this->unstage($staged);
            TenantContext::reset();
        }
    }

    /**
     * Unlike the four service-level tests above, this one goes over HTTP, and
     * apiGet() always sends X-Tenant-ID: $this->testTenantId. Building the
     * fixture in tenantAndTwoUsers()'s "first active tenant" instead put the
     * message in one tenant while the request ran in another, so the controller's
     * tenant-scoped Message lookup found nothing and returned 404 — and the
     * outsider's 403 was a false pass (middleware tenant_mismatch, never the
     * participation check). Build the fixture in the tenant the request actually
     * runs in, with participants this test owns, so both assertions test the
     * controller.
     */
    public function test_private_attachment_delivery_requires_message_participation(): void
    {
        $tenantId = $this->testTenantId;
        TenantContext::setById($tenantId);
        $this->app->instance('tenant.id', $tenantId);
        $sender = (int) User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true])->id;
        $receiver = (int) User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true])->id;

        $message = MessageService::send($sender, $receiver, ['body' => 'private media']);
        $this->assertNotEmpty($message, 'Send failed: ' . json_encode(MessageService::getErrors()));
        $relative = "message-media/{$tenantId}/attachments/test-private.pdf";
        $privatePath = storage_path('app/private/' . $relative);
        File::ensureDirectoryExists(dirname($privatePath), 0700, true);
        File::put($privatePath, "%PDF-1.4\nprivate\n");

        try {
            $attachmentId = DB::table('message_attachments')->insertGetId([
                'tenant_id' => $tenantId,
                'message_id' => (int) $message['id'],
                'file_url' => $relative,
                'file_path' => $relative,
                'file_name' => 'private.pdf',
                'file_type' => 'file',
                'file_size' => filesize($privatePath),
                'mime_type' => 'application/pdf',
                'created_at' => now(),
            ]);

            $outsider = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true]);
            Sanctum::actingAs($outsider, ['*']);
            $this->apiGet("/v2/messages/{$message['id']}/attachments/{$attachmentId}")->assertForbidden();

            Sanctum::actingAs(User::withoutGlobalScopes()->findOrFail($sender), ['*']);
            // Symfony's ResponseHeaderBag re-serialises Cache-Control with its
            // directives sorted alphabetically, so assert the normalised value
            // rather than the order the controller happens to write them in.
            $this->apiGet("/v2/messages/{$message['id']}/attachments/{$attachmentId}")
                ->assertOk()
                ->assertHeader('Cache-Control', 'max-age=0, no-store, private');

            $this->assertFileDoesNotExist(base_path("httpdocs/uploads/{$tenantId}/message_attachments/test-private.pdf"));
        } finally {
            @unlink($privatePath);
            TenantContext::reset();
        }
    }

    public function test_deleted_for_everyone_message_refuses_attachment_and_voice_delivery(): void
    {
        $tenantId = $this->testTenantId;
        TenantContext::setById($tenantId);
        $this->app->instance('tenant.id', $tenantId);
        $sender = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true]);
        $receiver = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true]);
        $message = MessageService::send((int) $sender->id, (int) $receiver->id, ['body' => 'private media']);

        $attachmentRelative = "message-media/{$tenantId}/attachments/deleted-private.pdf";
        $attachmentPath = storage_path('app/private/' . $attachmentRelative);
        $voiceRelative = "message-media/{$tenantId}/voice/voice_deleted_private.webm";
        $voicePath = storage_path('app/private/' . $voiceRelative);
        File::ensureDirectoryExists(dirname($attachmentPath), 0700, true);
        File::ensureDirectoryExists(dirname($voicePath), 0700, true);
        File::put($attachmentPath, "%PDF-1.4\nprivate\n");
        File::put($voicePath, 'synthetic voice bytes');

        try {
            $attachmentId = DB::table('message_attachments')->insertGetId([
                'tenant_id' => $tenantId,
                'message_id' => (int) $message['id'],
                'file_url' => $attachmentRelative,
                'file_path' => $attachmentRelative,
                'file_name' => 'deleted-private.pdf',
                'file_type' => 'file',
                'file_size' => filesize($attachmentPath),
                'mime_type' => 'application/pdf',
                'created_at' => now(),
            ]);
            DB::table('messages')->where('id', (int) $message['id'])->update([
                'is_voice' => true,
                'audio_url' => $voiceRelative,
                'audio_duration' => 1,
                'transcript' => 'private spoken words',
            ]);

            Sanctum::actingAs($sender, ['*']);
            $attachmentUrl = "/v2/messages/{$message['id']}/attachments/{$attachmentId}";
            $voiceUrl = "/v2/messages/{$message['id']}/voice";
            $this->apiGet($attachmentUrl)->assertOk();
            $this->apiGet($voiceUrl)->assertOk();

            Sanctum::actingAs($receiver, ['*']);
            $this->apiGet($attachmentUrl)->assertOk();
            $this->apiGet($voiceUrl)->assertOk();

            self::assertTrue(MessageService::deleteMessage((int) $message['id'], (int) $sender->id, 'self'));
            self::assertFalse((bool) DB::table('messages')->where('id', (int) $message['id'])->value('is_deleted'));
            Sanctum::actingAs($sender, ['*']);
            $this->apiGet($attachmentUrl)->assertNotFound();
            $this->apiGet($voiceUrl)->assertNotFound();
            // A per-user hide is not delete-for-everyone and must not revoke the
            // other participant's private media route.
            Sanctum::actingAs($receiver, ['*']);
            $this->apiGet($attachmentUrl)->assertOk();
            $this->apiGet($voiceUrl)->assertOk();

            self::assertTrue(MessageService::deleteMessage((int) $message['id'], (int) $receiver->id, 'everyone'));
            self::assertTrue((bool) DB::table('messages')->where('id', (int) $message['id'])->value('is_deleted'));

            Sanctum::actingAs($sender, ['*']);
            $this->apiGet($attachmentUrl)->assertNotFound();
            $this->apiGet($voiceUrl)->assertNotFound();
            Sanctum::actingAs($receiver, ['*']);
            $this->apiGet($attachmentUrl)->assertNotFound();
            $this->apiGet($voiceUrl)->assertNotFound();

            $thread = $this->apiGet("/v2/messages/{$sender->id}")->assertOk()->json('data');
            $deleted = collect($thread)->firstWhere('id', (int) $message['id']);
            self::assertNotNull($deleted);
            self::assertNull($deleted['transcript'] ?? null);
            self::assertNull($deleted['transcript_language'] ?? null);
            self::assertNull($deleted['audio_url'] ?? null);
            self::assertSame([], $deleted['attachments'] ?? null);
        } finally {
            @unlink($attachmentPath);
            @unlink($voicePath);
            TenantContext::reset();
        }
    }
}
