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
 * MessageService::send now persists file/image attachments (message_attachments
 * table) passed as metadata rows by the controller, allows an attachment-only
 * message (no text body), and getMessages() eager-loads them back. Before this,
 * the React composer's attachments[] were silently dropped. Real-DB coverage so
 * the write + read paths can't drift from the schema again.
 */
class MessageAttachmentsTest extends TestCase
{
    use DatabaseTransactions;

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

        try {
            $result = MessageService::send($sender, $receiver, [
                'body' => 'See the attached file',
                'attachments' => [
                    ['url' => '/uploads/' . $tenantId . '/message_attachments/abc.png', 'name' => 'photo.png', 'size' => 1234, 'mime' => 'image/png'],
                ],
            ]);

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
            $this->assertSame('/uploads/' . $tenantId . '/message_attachments/abc.png', $row->file_url);
            $this->assertSame('image/png', $row->mime_type);
            $this->assertSame(1234, (int) $row->file_size);
        } finally {
            TenantContext::reset();
        }
    }

    public function test_send_allows_attachment_only_message_with_no_body(): void
    {
        [$tenantId, $sender, $receiver] = $this->tenantAndTwoUsers();

        try {
            $result = MessageService::send($sender, $receiver, [
                'body' => '',
                'attachments' => [
                    ['url' => '/uploads/' . $tenantId . '/message_attachments/doc.pdf', 'name' => 'brief.pdf', 'size' => 999, 'mime' => 'application/pdf'],
                ],
            ]);

            $this->assertNotEmpty($result, 'Attachment-only send failed: ' . json_encode(MessageService::getErrors()));
            $this->assertSame('', (string) ($result['body'] ?? ''));
            $this->assertCount(1, $result['attachments'] ?? []);
        } finally {
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

        try {
            MessageService::send($sender, $receiver, [
                'body' => 'with file',
                'attachments' => [
                    ['url' => '/uploads/' . $tenantId . '/message_attachments/x.png', 'name' => 'x.png', 'size' => 10, 'mime' => 'image/png'],
                ],
            ]);

            $thread = MessageService::getMessages($receiver, $sender, ['limit' => 10]);
            $this->assertNotNull($thread);
            $withAttachment = collect($thread['items'] ?? [])->first(fn ($m) => !empty($m['attachments']));
            $this->assertNotNull($withAttachment, 'getMessages did not return the attachment');
            $this->assertSame('x.png', $withAttachment['attachments'][0]['file_name']);
        } finally {
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
}
