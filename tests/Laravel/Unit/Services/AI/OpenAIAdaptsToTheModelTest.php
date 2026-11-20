<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\AI;

use App\Services\AI\Providers\OpenAIProvider;
use Tests\Laravel\TestCase;

/**
 * A community types the name of the model it wants. Every request here
 * sends `max_tokens` and a `temperature`; some OpenAI models refuse one or
 * both (they want `max_completion_tokens`, and only their default
 * temperature) and answer 400. Until 20 Nov 2026 that was the end of it: a
 * community that chose such a model had every AI feature fail.
 *
 * The provider now adapts to what the model says it will not take, once,
 * and remembers it for that model. Nothing is sent: request() is replaced.
 */
final class OpenAIAdaptsToTheModelTest extends TestCase
{
    private const NO_MAX_TOKENS = "AI API error (400): Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
    private const NO_TEMPERATURE = "AI API error (400): Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.";

    private function provider(array $refusals, string $model = 'model-under-test'): RecordingOpenAIProvider
    {
        OpenAIProvider::forgetWhatModelsRefuse();
        $provider = new RecordingOpenAIProvider(['api_key' => 'test-key', 'default_model' => $model, 'api_url' => 'https://example.invalid/v1']);
        $provider->refusals = $refusals;

        return $provider;
    }

    public function test_a_model_that_refuses_max_tokens_is_asked_again_in_the_form_it_takes(): void
    {
        $provider = $this->provider([self::NO_MAX_TOKENS]);

        $reply = $provider->chat([['role' => 'user', 'content' => 'Hello']], ['max_tokens' => 400]);

        $this->assertSame('ok', $reply['content']);
        $this->assertCount(2, $provider->sent);
        $this->assertArrayHasKey('max_tokens', $provider->sent[0]);
        $this->assertArrayNotHasKey('max_tokens', $provider->sent[1]);
        $this->assertSame(400, $provider->sent[1]['max_completion_tokens']);
    }

    public function test_a_model_that_refuses_the_temperature_is_asked_again_without_one(): void
    {
        $provider = $this->provider([self::NO_TEMPERATURE]);

        $provider->chat([['role' => 'user', 'content' => 'Hello']], ['temperature' => 0.2]);

        $this->assertArrayHasKey('temperature', $provider->sent[0]);
        $this->assertArrayNotHasKey('temperature', $provider->sent[1]);
    }

    public function test_a_model_that_refuses_both_gets_there_in_three_requests_and_is_remembered(): void
    {
        $provider = $this->provider([self::NO_MAX_TOKENS, self::NO_TEMPERATURE]);

        $provider->chat([['role' => 'user', 'content' => 'Hello']], ['temperature' => 0.2, 'max_tokens' => 400]);
        $this->assertCount(3, $provider->sent);

        // The next request to the same model is right first time.
        $provider->chat([['role' => 'user', 'content' => 'Again']], ['temperature' => 0.2, 'max_tokens' => 400]);
        $this->assertCount(4, $provider->sent);
        $this->assertArrayNotHasKey('max_tokens', $provider->sent[3]);
        $this->assertArrayNotHasKey('temperature', $provider->sent[3]);
        $this->assertSame(400, $provider->sent[3]['max_completion_tokens']);
    }

    public function test_a_model_that_takes_both_is_sent_them_as_before(): void
    {
        $provider = $this->provider([]);

        $provider->chat([['role' => 'user', 'content' => 'Hello']], ['temperature' => 0.2, 'max_tokens' => 400]);

        $this->assertCount(1, $provider->sent);
        $this->assertSame(0.2, $provider->sent[0]['temperature']);
        $this->assertSame(400, $provider->sent[0]['max_tokens']);
    }

    public function test_any_other_refusal_is_passed_on_not_retried(): void
    {
        $provider = $this->provider(['AI API error (401): Incorrect API key provided.']);

        try {
            $provider->chat([['role' => 'user', 'content' => 'Hello']]);
            $this->fail('A bad key must still be reported');
        } catch (\Exception $e) {
            $this->assertStringContainsString('401', $e->getMessage());
        }
        $this->assertCount(1, $provider->sent);
    }
}

final class RecordingOpenAIProvider extends OpenAIProvider
{
    /** @var string[] error messages to answer with, in order, before succeeding */
    public array $refusals = [];
    /** @var array<int, array<string, mixed>> every request body sent */
    public array $sent = [];

    protected function request(string $endpoint, array $data, array $headers = []): array
    {
        $this->sent[] = $data;
        if ($this->refusals !== []) {
            throw new \Exception((string) array_shift($this->refusals));
        }

        return ['choices' => [['message' => ['content' => 'ok'], 'finish_reason' => 'stop']], 'usage' => []];
    }
}
