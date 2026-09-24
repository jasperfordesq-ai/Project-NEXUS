<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\MessageService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-035 F-193 (residual of F-046) — the conversation list returned the
 * transcript and audio URL of a voice message that had been deleted for
 * everyone, whenever it was the latest message in the thread. The thread
 * view already blanked them; the list must apply the same tombstone.
 */
class ConversationListDeletedVoiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->app->instance('tenant.id', $this->testTenantId);
    }

    private const SECRET = 'E035 secret transcript words';
    private const AUDIO = '/uploads/voice/e035-secret-voice.webm';

    public function test_deleted_voice_message_is_tombstoned_in_the_conversation_list(): void
    {
        TenantContext::setById($this->testTenantId);
        $a = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $b = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => $b->id, 'receiver_id' => $a->id,
            'body' => 'earlier text', 'is_read' => 1, 'created_at' => now()->subMinutes(10),
        ]);
        $voiceId = (int) DB::table('messages')->insertGetId([
            'tenant_id'           => $this->testTenantId,
            'sender_id'           => $a->id,
            'receiver_id'         => $b->id,
            'body'                => '[Message deleted]',
            'is_read'             => 0,
            'is_voice'            => 1,
            'audio_url'           => self::AUDIO,
            'audio_duration'      => 7,
            'transcript'          => self::SECRET,
            'transcript_language' => 'en',
            'is_deleted'          => 1,
            'deleted_at'          => now(),
            'created_at'          => now()->subMinute(),
        ]);

        foreach ([[(int) $a->id, (int) $b->id], [(int) $b->id, (int) $a->id]] as [$viewer, $partner]) {
            $items = MessageService::getConversations($viewer)['items'];
            $item = collect($items)->firstWhere('partner_id', $partner);
            $this->assertNotNull($item, 'conversation missing from the list');
            $this->assertSame($voiceId, (int) $item['last_message']['id'], 'setup: the deleted voice note must be the latest');

            $this->assertNull($item['transcript'] ?? null);
            $this->assertNull($item['transcript_language'] ?? null);
            $this->assertNull($item['audio_url'] ?? null);
            $this->assertNull($item['audio_duration'] ?? null);

            $encoded = (string) json_encode($item);
            $this->assertStringNotContainsString(self::SECRET, $encoded);
            $this->assertStringNotContainsString('e035-secret-voice', $encoded);
            $this->assertStringNotContainsString("/messages/{$voiceId}/voice", $encoded);
        }
    }

    public function test_live_voice_message_still_shows_in_the_conversation_list(): void
    {
        TenantContext::setById($this->testTenantId);
        $a = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $b = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => $a->id, 'receiver_id' => $b->id,
            'body' => '', 'is_read' => 0, 'is_voice' => 1, 'audio_url' => self::AUDIO,
            'transcript' => 'hello there', 'is_deleted' => 0, 'created_at' => now()->subMinute(),
        ]);

        $item = collect(MessageService::getConversations((int) $a->id)['items'])->firstWhere('partner_id', (int) $b->id);
        $this->assertNotNull($item);
        // audio_url is exposed as the authenticated voice route, not the raw path.
        $this->assertNotNull($item['audio_url']);
        $this->assertStringContainsString('/voice', (string) $item['audio_url']);
        $this->assertSame('hello there', $item['transcript']);
    }
}
