<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\AI;

use App\Services\AI\AiModuleDocsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Owner report, 18 Nov 2026: the AI assistant told members that admins can
 * only see messages reported for abuse. Coordinators actually receive copies
 * of first contacts, new members' messages and more, and an admin can choose
 * to review every message. Each community holds its own copy of the guides,
 * so the corrected defaults have to be written into existing rows.
 *
 * Pinned here: a row still carrying a shipped version is replaced; a row an
 * admin changed in any way is left alone; the retired Caring Community guide
 * is switched off, not rewritten.
 */
final class CorrectAiModuleDocsMigrationTest extends TestCase
{
    use DatabaseTransactions;

    private const MIGRATION = 'database/migrations/2026_11_18_180000_correct_ai_module_docs_to_match_the_platform.php';

    /** The messages guide exactly as shipped from 28 May to 18 Nov 2026. */
    private const OLD_MESSAGES_TITLE = 'Messages — private conversations';
    private const OLD_MESSAGES_BODY = "Messages are private one-to-one or group conversations between members. They're how exchanges get arranged.\n\nWays to start a conversation:\n• From a listing — tap 'Send message' on any listing\n• From a profile — tap 'Message' on a member's profile\n• From an event/group — group chats appear automatically for members\n• From your inbox — /messages → 'New message', search a member by name or skill\n\nInside a conversation you can:\n• Send text, emoji, images, and (if enabled) attachments\n• See read receipts and typing indicators in real time\n• Use the language translator (auto-translate to your preferred language)\n• Mark messages as flag/important\n• Mute or archive a conversation\n• Block a member if needed (their messages stop appearing; they can't see your profile)\n\nGroup chats: created automatically inside Groups and Events that have chat enabled. Admins can pin announcements and remove disruptive members.\n\nNotifications: new messages trigger push notifications (mobile/PWA) and an unread count badge. Notification frequency is configurable in Settings → Notifications.\n\nPrivacy: messages are private between participants. Admins can only see messages reported for abuse.";
    private const OLD_MESSAGES_KEYWORDS = ['message', 'messages', 'chat', 'conversation', 'inbox', 'contact', 'send a message', 'how do i contact', 'reply', 'block someone', 'mute', 'translate'];

    private const UNTOUCHED_TENANT = 999931;
    private const EDITED_TENANT = 999932;

    public function test_untouched_guides_get_the_corrected_text_and_edited_ones_are_left_alone(): void
    {
        $this->insert(self::UNTOUCHED_TENANT, 'messages', self::OLD_MESSAGES_TITLE, self::OLD_MESSAGES_BODY, self::OLD_MESSAGES_KEYWORDS);
        // An admin changed only the title: the whole row must be left as it is.
        $this->insert(self::EDITED_TENANT, 'messages', 'Our messages', self::OLD_MESSAGES_BODY, self::OLD_MESSAGES_KEYWORDS);
        $this->insert(self::UNTOUCHED_TENANT, 'our_own_guide', 'Our own guide', 'Written by our admin.', ['ours']);

        $this->runMigration();

        $new = AiModuleDocsService::defaultSeed()['messages'];
        $fixed = $this->row(self::UNTOUCHED_TENANT, 'messages');
        $this->assertSame($new['title'], $fixed->title);
        $this->assertSame($new['body'], $fixed->body);
        $this->assertSame($new['keywords'], json_decode((string) $fixed->keywords, true));
        $this->assertStringNotContainsString('only see messages reported', $fixed->body);

        $edited = $this->row(self::EDITED_TENANT, 'messages');
        $this->assertSame('Our messages', $edited->title);
        $this->assertSame(self::OLD_MESSAGES_BODY, $edited->body, 'an admin-edited guide was overwritten');

        $this->assertSame('Written by our admin.', $this->row(self::UNTOUCHED_TENANT, 'our_own_guide')->body);
    }

    public function test_the_caring_community_guide_is_switched_off_not_rewritten(): void
    {
        $shipped = AiModuleDocsService::defaultSeed()['caring_community'];
        $this->insert(self::UNTOUCHED_TENANT, 'caring_community', $shipped['title'], $shipped['body'], $shipped['keywords']);
        $this->insert(self::EDITED_TENANT, 'caring_community', $shipped['title'], 'Our own words.', $shipped['keywords']);

        $this->runMigration();

        $this->assertSame(0, (int) $this->row(self::UNTOUCHED_TENANT, 'caring_community')->is_active);
        $this->assertSame($shipped['body'], $this->row(self::UNTOUCHED_TENANT, 'caring_community')->body);
        $this->assertSame(1, (int) $this->row(self::EDITED_TENANT, 'caring_community')->is_active, 'an admin-written guide was switched off');
    }

    public function test_a_new_community_is_never_given_the_caring_community_guide(): void
    {
        (new AiModuleDocsService())->seedDefaultsForTenant(999933);

        $slugs = DB::table('ai_module_docs')->where('tenant_id', 999933)->pluck('module_slug')->all();
        $this->assertContains('messages', $slugs);
        $this->assertNotContains('caring_community', $slugs);
    }

    private function runMigration(): void
    {
        $migration = require base_path(self::MIGRATION);
        $migration->up();
    }

    /** @param array<int, string> $keywords */
    private function insert(int $tenantId, string $slug, string $title, string $body, array $keywords): void
    {
        DB::table('ai_module_docs')->insert([
            'tenant_id' => $tenantId,
            'module_slug' => $slug,
            'title' => $title,
            'body' => $body,
            'keywords' => json_encode($keywords),
            'is_active' => 1,
            'created_by' => null,
        ]);
    }

    private function row(int $tenantId, string $slug): object
    {
        return DB::table('ai_module_docs')->where('tenant_id', $tenantId)->where('module_slug', $slug)->first();
    }
}
