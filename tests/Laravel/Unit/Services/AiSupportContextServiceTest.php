<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Models\User;
use App\Services\AiSupportContextService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class AiSupportContextServiceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_build_includes_matching_knowledge_base_sources(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $title = 'Member guide for marmalade listing offers';
        DB::table('knowledge_base_articles')->insert([
            'tenant_id' => $this->testTenantId,
            'title' => $title,
            'slug' => 'member-guide-marmalade-listing-offers',
            'content' => 'Members can create a marmalade listing by opening Listings, choosing create, and describing what they can offer.',
            'content_type' => 'plain',
            'is_published' => true,
            'views_count' => 0,
            'helpful_yes' => 0,
            'helpful_no' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $result = (new AiSupportContextService())->build(
            (int) $user->id,
            'How do I create a marmalade listing offer?'
        );

        $this->assertGreaterThanOrEqual(1, $result['source_count']);
        $this->assertStringContainsString('Retrieved Knowledge Base Articles', $result['content']);
        $this->assertStringContainsString('Listings', $result['content']);
        $this->assertContains($title, array_column($result['sources'], 'title'));
    }

    public function test_build_marks_technical_articles_as_reference_material(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        DB::table('knowledge_base_articles')->insert([
            'tenant_id' => $this->testTenantId,
            'title' => 'Docker API migration troubleshooting',
            'slug' => 'docker-api-migration-troubleshooting',
            'content' => 'Run artisan migrations, inspect Laravel routes, and check SQL tenant_id constraints before debugging API controllers.',
            'content_type' => 'plain',
            'is_published' => true,
            'views_count' => 0,
            'helpful_yes' => 0,
            'helpful_no' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $result = (new AiSupportContextService())->build(
            (int) $user->id,
            'What should I do about a docker api migration problem?'
        );

        // Since 18 Nov 2026 a technical article is neither shown to the member
        // nor given to the model (ChatSourcesAreMemberHelpOnlyTest).
        $this->assertNotContains('Docker API migration troubleshooting', array_column($result['sources'], 'title'));
        $this->assertStringNotContainsString('Docker API migration troubleshooting', $result['content']);
    }
}
