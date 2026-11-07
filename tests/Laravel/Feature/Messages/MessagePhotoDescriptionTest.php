<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Messages;

use App\Core\MessageAttachmentUploader;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A photo sent in a message can carry a short written description for
 * screen-reader users (AWID accessibility report, point 6: every image a
 * member uploads). `attachment_alts[i]` describes `attachments[i]`.
 */
final class MessagePhotoDescriptionTest extends TestCase
{
    use DatabaseTransactions;

    /** @var list<string> */
    private array $stored = [];

    protected function tearDown(): void
    {
        foreach ($this->stored as $url) {
            MessageAttachmentUploader::delete($url);
        }
        parent::tearDown();
    }

    /** @return array{0: User, 1: User} */
    private function pair(): array
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        Sanctum::actingAs($sender, ['*']);

        return [$sender, $recipient];
    }

    private function send(User $recipient, array $files, array $alts): \Illuminate\Testing\TestResponse
    {
        $response = $this->post('/api/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => 'Photo for you',
            'attachments' => $files,
            'attachment_alts' => $alts,
        ], $this->withTenantHeader());

        foreach ((array) $response->json('data.attachments') as $attachment) {
            if (is_array($attachment) && is_string($attachment['file_url'] ?? null)) {
                $stored = DB::table('message_attachments')->where('id', $attachment['id'])->value('file_path');
                if (is_string($stored)) {
                    $this->stored[] = $stored;
                }
            }
        }

        return $response;
    }

    public function test_a_photo_description_is_saved_and_returned(): void
    {
        [, $recipient] = $this->pair();

        $response = $this->send($recipient, [UploadedFile::fake()->image('IMG_2041.png', 20, 20)], ['A red bicycle leaning on a wall']);

        $response->assertStatus(201);
        $response->assertJsonPath('data.attachments.0.alt_text', 'A red bicycle leaning on a wall');
        $this->assertSame(
            'A red bicycle leaning on a wall',
            DB::table('message_attachments')->where('id', $response->json('data.attachments.0.id'))->value('alt_text')
        );
    }

    public function test_the_description_comes_back_when_the_conversation_is_read(): void
    {
        [$sender, $recipient] = $this->pair();
        $this->send($recipient, [UploadedFile::fake()->image('IMG_2041.png', 20, 20)], ['Two cups of tea'])->assertStatus(201);

        Sanctum::actingAs($recipient, ['*']);
        $read = $this->get('/api/v2/messages/' . $sender->id, $this->withTenantHeader());

        $read->assertOk();
        $attachments = collect((array) $read->json('data'))->pluck('attachments')->flatten(1)->filter()->values();
        $this->assertSame('Two cups of tea', $attachments->first()['alt_text'] ?? null);
    }

    public function test_each_description_belongs_to_its_own_photo(): void
    {
        [, $recipient] = $this->pair();

        $response = $this->send(
            $recipient,
            [UploadedFile::fake()->image('a.png', 20, 20), UploadedFile::fake()->image('b.png', 20, 20)],
            ['First photo', 'Second photo']
        );

        $response->assertStatus(201);
        $byName = collect((array) $response->json('data.attachments'))->keyBy('name');
        $this->assertSame('First photo', $byName['a.png']['alt_text']);
        $this->assertSame('Second photo', $byName['b.png']['alt_text']);
    }

    public function test_a_blank_description_is_stored_as_none(): void
    {
        [, $recipient] = $this->pair();

        $response = $this->send($recipient, [UploadedFile::fake()->image('a.png', 20, 20)], ['   ']);

        $response->assertStatus(201);
        $this->assertNull($response->json('data.attachments.0.alt_text'));
    }

    public function test_a_description_on_a_document_is_ignored(): void
    {
        [, $recipient] = $this->pair();

        $response = $this->send(
            $recipient,
            [UploadedFile::fake()->createWithContent('notes.txt', 'plain notes')],
            ['Should not be kept']
        );

        $response->assertStatus(201);
        $this->assertNull($response->json('data.attachments.0.alt_text'));
    }

    public function test_a_description_longer_than_255_characters_is_refused(): void
    {
        [, $recipient] = $this->pair();

        $response = $this->send($recipient, [UploadedFile::fake()->image('a.png', 20, 20)], [str_repeat('x', 256)]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.field', 'attachment_alts');
        $this->assertSame(0, DB::table('message_attachments')->where('tenant_id', $this->testTenantId)->where('file_name', 'a.png')->where('created_at', '>=', now()->subMinute())->count());
    }
}
