<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\AI;

use App\Core\TenantContext;
use App\Services\AI\AiModuleDocsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Owner report, 18 Nov 2026: the AI assistant was giving members false
 * information. One cause: a feature's guide was handed to the assistant as
 * "canonical" even when the community had that feature switched off, so it
 * could walk a member through something their community does not offer.
 */
final class AiGuidesFollowCommunitySwitchesTest extends TestCase
{
    use DatabaseTransactions;

    private const BODY = 'Open Events, pick an event and press Going.';

    public function test_a_switched_off_feature_is_described_as_not_available(): void
    {
        $this->guide('events', self::BODY, ['event']);
        $this->setFeature('events', false);

        $prompt = (new AiModuleDocsService())->renderForPrompt($this->testTenantId, 'How do I go to an event?');

        $this->assertStringContainsString('has NOT switched this on', $prompt);
        $this->assertStringNotContainsString(self::BODY, $prompt, 'the guide for a switched-off feature reached the assistant');
    }

    public function test_a_switched_on_feature_gets_its_guide(): void
    {
        $this->guide('events', self::BODY, ['event']);
        $this->setFeature('events', true);

        $prompt = (new AiModuleDocsService())->renderForPrompt($this->testTenantId, 'How do I go to an event?');

        $this->assertStringContainsString(self::BODY, $prompt);
        $this->assertStringNotContainsString('has NOT switched this on', $prompt);
    }

    public function test_a_guide_with_no_switch_is_always_given(): void
    {
        $this->guide('our_own_guide', 'Our coffee morning is on Tuesdays.', ['coffee']);

        $prompt = (new AiModuleDocsService())->renderForPrompt($this->testTenantId, 'When is coffee?');

        $this->assertStringContainsString('Our coffee morning is on Tuesdays.', $prompt);
    }

    /** @param array<int, string> $keywords */
    private function guide(string $slug, string $body, array $keywords): void
    {
        DB::table('ai_module_docs')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('ai_module_docs')->insert([
            'tenant_id' => $this->testTenantId,
            'module_slug' => $slug,
            'title' => ucfirst($slug),
            'body' => $body,
            'keywords' => json_encode($keywords),
            'is_active' => 1,
        ]);
    }

    private function setFeature(string $feature, bool $on): void
    {
        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        $features[$feature] = $on;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }
}
