<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Services\Matching\MatchAiClient;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Every part of matching that asks the AI a question goes through one
 * client, so each adapts the same way to whichever provider and model the
 * community chose (20 Nov 2026). Nothing is sent: send() is replaced.
 */
class MatchAiClientTest extends TestCase
{
    use DatabaseTransactions;

    private function chose(string $provider, string $modelKey = '', string $model = ''): void
    {
        $set = fn (string $key, string $value) => DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'updated_at' => now()]
        );
        $set('ai_provider', $provider);
        if ($modelKey !== '') {
            $set($modelKey, $model);
        }
    }

    private function client(array $replies): FakeMatchAiClient
    {
        $client = new FakeMatchAiClient();
        $client->replies = $replies;

        return $client;
    }

    private const QUESTION = [['role' => 'user', 'content' => 'Which fit?']];

    public function test_an_answer_wrapped_in_prose_or_code_fences_is_still_read(): void
    {
        $client = $this->client(["Here you go:\n```json\n{\"fits\": [{\"n\": 2, \"strength\": 3}]}\n```\nHope that helps."]);

        $answer = $client->askJson(self::QUESTION, 200);

        $this->assertSame([['n' => 2, 'strength' => 3]], $answer['data']['fits']);
        $this->assertCount(1, $client->sent);
    }

    public function test_a_model_that_spent_its_allowance_thinking_is_asked_once_more_with_more_room(): void
    {
        // A "thinking" model counts its thinking against the allowance and
        // can stop before any answer; a cut-off answer is not valid JSON.
        $client = $this->client(['', '{"not_a_fit": [1]}']);

        $answer = $client->askJson(self::QUESTION, 200);

        $this->assertSame([1], $answer['data']['not_a_fit']);
        $this->assertCount(2, $client->sent);
        $this->assertGreaterThan($client->sent[0]['options']['max_tokens'], $client->sent[1]['options']['max_tokens']);
    }

    public function test_it_gives_up_after_one_more_try_and_after_a_provider_failure(): void
    {
        $client = $this->client(['no json here', '{"cut": [1, 2', 'never asked']);
        $this->assertNull($client->askJson(self::QUESTION, 200));
        $this->assertCount(2, $client->sent, 'One retry, never a loop');

        $failing = $this->client([new \RuntimeException('AI API error (401): bad key')]);
        $this->assertNull($failing->askJson(self::QUESTION, 200));
        $this->assertCount(1, $failing->sent, 'A refused key is not retried');
    }

    public function test_a_list_answer_is_read_when_a_list_is_asked_for(): void
    {
        $client = $this->client(['Sure: [{"listing_id": 5, "rerank_delta": -3, "explanation": "Close by."}]']);

        $answer = $client->askJson(self::QUESTION, 900, 'array');

        $this->assertSame(5, $answer['data'][0]['listing_id']);
    }

    public function test_the_allowance_always_leaves_room_for_a_thinking_model(): void
    {
        $this->chose('openai', 'openai_model', 'some-thinking-model');
        $client = $this->client(['{}']);

        $client->askJson(self::QUESTION, 200);

        $this->assertGreaterThanOrEqual(2000, $client->sent[0]['options']['max_tokens'],
            'A 200-token allowance is spent on thinking before any answer');
    }

    public function test_it_knows_which_provider_and_model_the_community_chose(): void
    {
        $this->chose('anthropic', 'claude_model', 'claude-sonnet-5-5');
        $profile = $this->client([])->profile();
        $this->assertSame('anthropic', $profile['provider']);
        $this->assertSame('claude-sonnet-5-5', $profile['model']);
        $this->assertFalse($profile['small']);

        $this->chose('ollama', 'ollama_model', 'llama3.2:3b');
        $profile = $this->client([])->profile();
        $this->assertSame('ollama', $profile['provider']);
        $this->assertSame('llama3.2:3b', $profile['model']);
        $this->assertTrue($profile['small'], 'A model the community runs itself is treated as small and slow');
    }
}

class FakeMatchAiClient extends MatchAiClient
{
    /** @var array<int, string|\Throwable> what the provider returns for each request, in order */
    public array $replies = [];
    /** @var array<int, array{messages: array, options: array}> */
    public array $sent = [];

    protected function send(array $messages, array $options): array
    {
        $this->sent[] = ['messages' => $messages, 'options' => $options];
        $reply = array_shift($this->replies);
        if ($reply instanceof \Throwable) {
            throw $reply;
        }

        return ['content' => (string) $reply, 'provider' => 'fake', 'model' => 'fake-model', 'tokens_input' => 7, 'tokens_output' => 3];
    }
}
