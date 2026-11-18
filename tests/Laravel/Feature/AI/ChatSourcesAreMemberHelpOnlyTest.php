<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\AI;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AiSupportContextService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Production, 18 Nov 2026: every member AI chat answer on hour-timebank.ie
 * ended with "sources" such as "Project NEXUS — Members Directory Engine:
 * Complete Technical Report". Timebank Ireland's Knowledge Base holds only
 * platform engineering documents, and the chat showed every matching article
 * as a member-facing source although AiSupportContextService already labels
 * such articles `technical_reference`.
 *
 * Technical articles stay in the model's background (its instructions say to
 * simplify them for members), but only member help is shown as a source.
 * TenantContext is set here, never inherited: the older tests of this service
 * are quarantined as order-dependent because build() reads it.
 */
final class ChatSourcesAreMemberHelpOnlyTest extends TestCase
{
    use DatabaseTransactions;

    private const WORD = 'quokkaferry';

    public function test_only_member_help_is_shown_as_a_source(): void
    {
        TenantContext::setById($this->testTenantId);
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $this->article('Quokkaferry engine: complete technical report',
            'The quokkaferry controller reads the database through the Laravel API endpoint and caches the JSON in Redis.');
        $this->article('How to book a quokkaferry swap',
            'Open Listings, find a quokkaferry offer you like, and send the member a message to arrange a time.');

        $result = (new AiSupportContextService())->build((int) $user->id, 'How do I find a ' . self::WORD . ' swap?');

        $shown = array_column($result['sources'], 'title');
        $this->assertContains('How to book a quokkaferry swap', $shown);
        $this->assertNotContains('Quokkaferry engine: complete technical report', $shown, 'a technical report was shown to a member as a source');
        $this->assertStringContainsString('Quokkaferry engine: complete technical report', $result['content'], 'the technical article should stay in the background');
    }

    public function test_no_source_is_shown_when_only_technical_articles_match(): void
    {
        TenantContext::setById($this->testTenantId);
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $this->article('Quokkaferry migration runbook',
            'Run the artisan migration, check the SQL schema and restart the docker container before testing the API route.');

        $result = (new AiSupportContextService())->build((int) $user->id, 'Tell me about ' . self::WORD);

        $this->assertSame([], $result['sources']);
    }

    private function article(string $title, string $content): void
    {
        DB::table('knowledge_base_articles')->insert([
            'tenant_id' => $this->testTenantId,
            'title' => $title,
            'slug' => \Illuminate\Support\Str::slug($title) . '-' . bin2hex(random_bytes(3)),
            'content' => $content,
            'content_type' => 'plain',
            'is_published' => true,
            'views_count' => 0,
            'helpful_yes' => 0,
            'helpful_no' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
