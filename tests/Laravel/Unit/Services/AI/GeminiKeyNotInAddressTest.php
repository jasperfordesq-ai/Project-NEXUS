<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\AI;

use App\Services\AI\Providers\GeminiProvider;
use Tests\Laravel\TestCase;

/**
 * Security register E-131 (deeper audit): GeminiProvider put the community's
 * API key in the request address (`...:generateContent?key=...`), where a
 * proxy, a server access log or an error report can record it. Google accepts
 * the key in the `x-goog-api-key` header instead.
 *
 * Nothing is sent: request() is replaced by a recorder.
 */
final class GeminiKeyNotInAddressTest extends TestCase
{
    public function test_chat_sends_the_key_in_a_header_not_the_address(): void
    {
        $provider = $this->provider();

        $provider->chat([['role' => 'user', 'content' => 'Hello']]);

        $this->assertStringNotContainsString('key=', $provider->endpoint);
        $this->assertStringNotContainsString('AIza-fake', $provider->endpoint);
        $this->assertContains('x-goog-api-key: AIza-fake-not-real', $provider->headers);
    }

    public function test_embedding_sends_the_key_in_a_header_not_the_address(): void
    {
        $provider = $this->provider();

        $provider->embed('Hello');

        $this->assertStringNotContainsString('key=', $provider->endpoint);
        $this->assertContains('x-goog-api-key: AIza-fake-not-real', $provider->headers);
    }

    private function provider(): RecordingGeminiProvider
    {
        return new RecordingGeminiProvider([
            'api_key' => 'AIza-fake-not-real',
            'api_url' => 'https://generativelanguage.googleapis.com/v1beta',
            'default_model' => 'gemini-model-x',
        ]);
    }
}

final class RecordingGeminiProvider extends GeminiProvider
{
    public string $endpoint = '';
    /** @var list<string> */
    public array $headers = [];

    protected function request(string $endpoint, array $data, array $headers = []): array
    {
        $this->endpoint = $endpoint;
        $this->headers = array_values($headers);

        return [
            'candidates' => [['content' => ['parts' => [['text' => 'OK']]], 'finishReason' => 'STOP']],
            'usageMetadata' => ['promptTokenCount' => 1, 'candidatesTokenCount' => 1],
            'embedding' => ['values' => [0.1, 0.2]],
        ];
    }
}
