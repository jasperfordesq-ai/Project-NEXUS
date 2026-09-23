<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Events\MessageSent;
use App\Models\User;
use App\Services\MessageService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-089 — a text send must not accept attachment metadata from the client.
 * A JSON `attachments` array (url, path, name, mime) was persisted as given,
 * so a member could attach any path inside the tenant's message store — for
 * example another member's private attachment — with a forged name and type.
 * Attachments may only come from the server-side multipart upload.
 */
class MessageAttachmentMetadataInjectionTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app->instance('tenant.id', $this->testTenantId);
        Event::fake([MessageSent::class]);
    }

    public function test_client_supplied_attachment_array_is_ignored_on_a_text_send(): void
    {
        [$sender, $recipient] = [$this->member(), $this->member()];
        Sanctum::actingAs($sender, ['*']);
        $forgedPath = "message-media/{$this->testTenantId}/attachments/someone-elses-private-file.pdf";

        $messageId = (int) $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Text with forged attachment metadata',
            'attachments' => [[
                'url' => $forgedPath,
                'path' => $forgedPath,
                'name' => 'invoice.pdf',
                'mime' => 'application/pdf',
                'size' => 1234,
                'type' => 'file',
            ]],
        ])->assertStatus(201)->json('data.id');

        $this->assertGreaterThan(0, $messageId);
        $this->assertSame(0, DB::table('message_attachments')->where('message_id', $messageId)->count());
    }

    public function test_attachment_only_forged_send_is_rejected_as_empty(): void
    {
        [$sender, $recipient] = [$this->member(), $this->member()];
        Sanctum::actingAs($sender, ['*']);
        $forgedPath = "message-media/{$this->testTenantId}/attachments/forged.png";

        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'attachments' => [['url' => $forgedPath, 'name' => 'photo.png', 'mime' => 'image/png']],
        ])->assertStatus(422);

        $this->assertDatabaseMissing('message_attachments', ['file_url' => $forgedPath]);
    }

    public function test_generic_service_send_ignores_attachment_metadata(): void
    {
        [$sender, $recipient] = [$this->member(), $this->member()];
        $forgedPath = "message-media/{$this->testTenantId}/attachments/service-forged.pdf";

        $message = MessageService::send((int) $sender->id, (int) $recipient->id, [
            'body' => 'Service-level send',
            'attachments' => [['url' => $forgedPath, 'path' => $forgedPath, 'name' => 'x.pdf', 'mime' => 'application/pdf']],
        ]);

        $this->assertNotSame([], $message);
        $this->assertSame(0, DB::table('message_attachments')->where('message_id', (int) $message['id'])->count());
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
