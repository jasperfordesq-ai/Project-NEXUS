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
 * The AI assistant's "Caring Community" grounding text described features
 * that do not exist: automated check-ins with an "I'm OK / I need help"
 * button and alerts for missed check-ins, a buddy system, an easy-mode
 * layout, a carer listing category and an emergency contact in the menu
 * (owner decision, 26 Oct 2026: the AI help must never describe them).
 * The migration must correct communities still on either earlier default,
 * and must leave a community's own edited text alone.
 */
final class CorrectCaringCommunityAiModuleDocMigrationTest extends TestCase
{
    use DatabaseTransactions;

    private const MIGRATION = 'database/migrations/2026_10_26_170000_correct_caring_community_ai_module_doc.php';

    public function test_old_defaults_are_corrected_and_admin_edits_are_kept(): void
    {
        $migration = require base_path(self::MIGRATION);
        /** @var array<int, string> $oldBodies */
        $oldBodies = (new \ReflectionClassConstant($migration, 'OLD_BODIES'))->getValue();
        $this->assertCount(2, $oldBodies);
        foreach ($oldBodies as $oldBody) {
            $this->assertStringContainsString("I'm OK / I need help", $oldBody, 'fixture must be a defective default');
        }

        $staleTenants = [990201, 990202];
        $editedTenant = 990203;
        DB::table('ai_module_docs')->whereIn('tenant_id', [...$staleTenants, $editedTenant])->delete();
        foreach ($staleTenants as $i => $tenantId) {
            DB::table('ai_module_docs')->insert([
                'tenant_id' => $tenantId, 'module_slug' => 'caring_community',
                'title' => 'Caring Community — support for vulnerable members', 'body' => $oldBodies[$i],
                'keywords' => json_encode(['caring']), 'is_active' => 1,
            ]);
        }
        DB::table('ai_module_docs')->insert([
            'tenant_id' => $editedTenant, 'module_slug' => 'caring_community',
            'title' => 'Our own wording', 'body' => 'Text an admin wrote for their community.',
            'keywords' => json_encode(['ours']), 'is_active' => 1,
        ]);

        $migration->up();

        $new = AiModuleDocsService::defaultSeed()['caring_community'];
        foreach ($staleTenants as $tenantId) {
            $row = DB::table('ai_module_docs')->where('tenant_id', $tenantId)->first();
            $this->assertSame($new['body'], $row->body);
            $this->assertSame($new['title'], $row->title);
            $this->assertSame($new['keywords'], json_decode((string) $row->keywords, true));
        }

        $edited = DB::table('ai_module_docs')->where('tenant_id', $editedTenant)->first();
        $this->assertSame('Text an admin wrote for their community.', $edited->body);
        $this->assertSame('Our own wording', $edited->title);
    }

    public function test_new_default_does_not_describe_features_that_do_not_exist(): void
    {
        $body = AiModuleDocsService::defaultSeed()['caring_community']['body'];

        foreach (["I'm OK", 'Missed check-ins alert', 'Buddy system', 'Easy-mode', 'voice-controlled', 'emergency contact in the menu', 'sensory-friendly'] as $claim) {
            $this->assertStringNotContainsString($claim, $body);
        }
        $this->assertLessThanOrEqual(1200, mb_strlen($body), 'must fit the prompt injection cap');
    }
}
