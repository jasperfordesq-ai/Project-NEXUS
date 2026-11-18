<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\AI;

use App\Services\EmbeddingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-629 (security register E-131): every saved listing, profile, event,
 * group, job, marketplace item, course and help article is queued for search
 * indexing, and indexing posted the text to OpenAI whenever the community had
 * an OpenAI key saved — even with the community's main AI switch off.
 * Production, 18 Nov 2026: Timebank Ireland's AI was switched off on 8 Nov and
 * 14 listings and member profiles were still sent afterwards.
 *
 * The OpenAI call is replaced by a recorder, so nothing leaves the test.
 */
final class EmbeddingIndexingRespectsAiSwitchTest extends TestCase
{
    use DatabaseTransactions;

    private RecordingEmbeddingService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new RecordingEmbeddingService();
        $this->saveAiSetting('openai_api_key', 'sk-community-key-fake-not-real');
        DB::table('content_embeddings')->where('tenant_id', $this->testTenantId)
            ->where('content_type', 'listing')->where('content_id', 990_001)->delete();
    }

    public function test_nothing_is_sent_while_the_communitys_ai_is_switched_off(): void
    {
        $this->saveAiSetting('ai_enabled', '0');

        $this->service->generateForListing($this->listing());

        $this->assertSame([], $this->service->sentTexts, 'listing text was sent to OpenAI with AI switched off');
        $this->assertFalse($this->embeddingStored());
    }

    public function test_nothing_is_sent_by_a_community_that_never_switched_ai_on(): void
    {
        DB::table('ai_settings')->where('tenant_id', $this->testTenantId)->where('setting_key', 'ai_enabled')->delete();

        $this->service->generateForListing($this->listing());

        $this->assertSame([], $this->service->sentTexts);
    }

    public function test_indexing_still_works_when_the_communitys_ai_is_on(): void
    {
        $this->saveAiSetting('ai_enabled', '1');

        $this->service->generateForListing($this->listing());

        $this->assertCount(1, $this->service->sentTexts);
        $this->assertTrue($this->embeddingStored());
    }

    /** @return array<string, mixed> */
    private function listing(): array
    {
        return [
            'tenant_id' => $this->testTenantId,
            'id' => 990_001,
            'title' => 'Gardening help',
            'description' => 'I can help with weeding on Saturdays.',
        ];
    }

    private function embeddingStored(): bool
    {
        return DB::table('content_embeddings')
            ->where('tenant_id', $this->testTenantId)
            ->where('content_type', 'listing')
            ->where('content_id', 990_001)
            ->exists();
    }

    private function saveAiSetting(string $key, string $value): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'updated_at' => now()]
        );
    }
}

final class RecordingEmbeddingService extends EmbeddingService
{
    /** @var list<string> */
    public array $sentTexts = [];

    protected function callOpenAiEmbedding(string $apiKey, string $text): ?array
    {
        $this->sentTexts[] = $text;

        return [0.1, 0.2, 0.3];
    }
}
