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
 * The AI assistant's "group exchanges" grounding text described a
 * 'beneficiary' and payment 'from a community pool', neither of which exist.
 * The migration must correct communities still on that default text, and
 * must leave a community's own edited text alone.
 */
final class CorrectGroupExchangeAiModuleDocMigrationTest extends TestCase
{
    use DatabaseTransactions;

    private const MIGRATION = 'database/migrations/2026_09_26_150000_correct_group_exchange_ai_module_doc.php';

    public function test_old_default_is_corrected_and_admin_edits_are_kept(): void
    {
        $migration = require base_path(self::MIGRATION);
        $oldBody = (new \ReflectionClassConstant($migration, 'OLD_BODY'))->getValue();
        $this->assertStringContainsString('beneficiary', $oldBody, 'fixture must be the defective default');

        $staleTenant = 990101;
        $editedTenant = 990102;
        DB::table('ai_module_docs')->whereIn('tenant_id', [$staleTenant, $editedTenant])->delete();
        DB::table('ai_module_docs')->insert([
            [
                'tenant_id' => $staleTenant, 'module_slug' => 'group_exchanges',
                'title' => 'Group exchanges — many-to-many time projects', 'body' => $oldBody,
                'keywords' => json_encode(['group exchange']), 'is_active' => 1,
            ],
            [
                'tenant_id' => $editedTenant, 'module_slug' => 'group_exchanges',
                'title' => 'Our own wording', 'body' => 'Text an admin wrote for their community.',
                'keywords' => json_encode(['ours']), 'is_active' => 1,
            ],
        ]);

        $migration->up();

        $new = AiModuleDocsService::defaultSeed()['group_exchanges'];
        $stale = DB::table('ai_module_docs')->where('tenant_id', $staleTenant)->first();
        $this->assertSame($new['body'], $stale->body);
        $this->assertSame($new['title'], $stale->title);
        $this->assertSame($new['keywords'], json_decode((string) $stale->keywords, true));

        $edited = DB::table('ai_module_docs')->where('tenant_id', $editedTenant)->first();
        $this->assertSame('Text an admin wrote for their community.', $edited->body);
        $this->assertSame('Our own wording', $edited->title);
    }

    public function test_new_default_describes_the_feature_that_exists(): void
    {
        $body = AiModuleDocsService::defaultSeed()['group_exchanges']['body'];

        foreach (['Equal Split', 'Custom Hours', 'Weighted Split', 'Provider', 'Receiver'] as $term) {
            $this->assertStringContainsString($term, $body);
        }
        $this->assertStringNotContainsString('beneficiary', $body);
        $this->assertLessThanOrEqual(1200, mb_strlen($body), 'must fit the prompt injection cap');
    }
}
