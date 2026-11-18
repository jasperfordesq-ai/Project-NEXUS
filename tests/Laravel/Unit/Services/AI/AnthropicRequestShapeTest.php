<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\AI;

use App\Services\AI\Providers\AnthropicProvider;
use Tests\Laravel\TestCase;

/**
 * Security register E-131 (deeper audit): every member chat passes
 * temperature 0.2 and every content generator 0.7/0.8. Anthropic's current
 * models refuse sampling parameters — Claude Opus 5.5 rejects any
 * temperature, Claude Sonnet 5.5 and Claude Haiku 5.5 any non-default one —
 * with a 400, so after a community chose Anthropic every real request failed
 * while the "test" call (which sends no temperature) passed.
 *
 * Those models also think on every request, and thinking counts against
 * max_tokens, so a 250-token bio request could end before any answer text.
 *
 * Nothing is sent: request() is replaced by a recorder.
 */
final class AnthropicRequestShapeTest extends TestCase
{
    public function test_sampling_parameters_are_never_sent(): void
    {
        $provider = $this->provider();

        $provider->chat([['role' => 'user', 'content' => 'Hello']], ['temperature' => 0.2, 'top_p' => 0.9, 'top_k' => 5]);

        $this->assertArrayNotHasKey('temperature', $provider->sent);
        $this->assertArrayNotHasKey('top_p', $provider->sent);
        $this->assertArrayNotHasKey('top_k', $provider->sent);
    }

    public function test_a_small_token_allowance_leaves_room_for_thinking_and_the_answer(): void
    {
        $provider = $this->provider();

        $provider->chat([['role' => 'user', 'content' => 'Write a short bio']], ['max_tokens' => 250]);

        $this->assertGreaterThanOrEqual(8192, $provider->sent['max_tokens']);
    }

    public function test_a_larger_allowance_is_kept(): void
    {
        $provider = $this->provider();

        $provider->chat([['role' => 'user', 'content' => 'Hello']], ['max_tokens' => 20000]);

        $this->assertSame(20000, $provider->sent['max_tokens']);
    }

    public function test_the_system_prompt_stays_top_level_and_the_saved_model_is_used(): void
    {
        $provider = $this->provider();

        $provider->chat([
            ['role' => 'system', 'content' => 'You are helpful.'],
            ['role' => 'user', 'content' => 'Hello'],
        ]);

        $this->assertSame('You are helpful.', $provider->sent['system']);
        $this->assertSame('claude-opus-5-5', $provider->sent['model']);
        $this->assertSame([['role' => 'user', 'content' => 'Hello']], $provider->sent['messages']);
    }

    /**
     * Production, 18 Nov 2026 13:18 and 13:20 UTC, tenant 2's first Claude
     * chats: 400 "tools.6.custom.input_schema.properties: Input should be an
     * object". A tool with no inputs (GetMyWalletBalanceTool) declares
     * 'properties' => [], which PHP encodes as a JSON list. OpenAI accepts it;
     * Anthropic does not.
     */
    public function test_a_tool_with_no_inputs_is_sent_with_an_empty_object_not_a_list(): void
    {
        $provider = $this->provider();

        $provider->chat([['role' => 'user', 'content' => 'What is my balance?']], [
            'tools' => [
                ['type' => 'function', 'function' => [
                    'name' => 'get_my_wallet_balance',
                    'description' => 'Balance',
                    'parameters' => ['type' => 'object', 'properties' => [], 'required' => []],
                ]],
                ['type' => 'function', 'function' => [
                    'name' => 'nested',
                    'description' => 'Nested empty object',
                    'parameters' => ['type' => 'object', 'properties' => [
                        'filters' => ['type' => 'object', 'properties' => []],
                        'q' => ['type' => 'string'],
                    ]],
                ]],
                ['type' => 'function', 'function' => ['name' => 'no_schema', 'description' => 'None']],
            ],
        ]);

        $json = json_encode($provider->sent['tools']);
        $this->assertStringNotContainsString('"properties":[]', (string) $json, (string) $json);
        $this->assertStringContainsString('"input_schema":{"type":"object","properties":{},"required":[]}', (string) $json);
        $this->assertStringContainsString('"filters":{"type":"object","properties":{}}', (string) $json);
        $this->assertStringContainsString('"name":"no_schema","description":"None","input_schema":{"type":"object","properties":{}}', (string) $json);
    }

    /** The chat keeps the last 12 history rows, which can begin with the assistant's reply; Anthropic requires the user first. */
    public function test_the_conversation_sent_starts_with_the_member(): void
    {
        $provider = $this->provider();

        $provider->chat([
            ['role' => 'system', 'content' => 'Be kind.'],
            ['role' => 'assistant', 'content' => 'An earlier reply'],
            ['role' => 'user', 'content' => 'Hello'],
        ]);

        $this->assertSame('user', $provider->sent['messages'][0]['role']);
        $this->assertCount(1, $provider->sent['messages']);
    }

    public function test_an_empty_message_in_the_history_is_left_out(): void
    {
        $provider = $this->provider();

        $provider->chat([
            ['role' => 'user', 'content' => 'First'],
            ['role' => 'assistant', 'content' => ''],
            ['role' => 'user', 'content' => '   '],
            ['role' => 'user', 'content' => 'Second'],
        ]);

        foreach ($provider->sent['messages'] as $message) {
            $this->assertNotSame('', trim(is_string($message['content']) ? $message['content'] : 'blocks'));
        }
        $this->assertSame(['First', 'Second'], array_column($provider->sent['messages'], 'content'));
    }

    /** The chat's final step after its tool rounds must keep the tools listed, and say not to call one. */
    public function test_tool_choice_none_is_passed_through(): void
    {
        $provider = $this->provider();

        $provider->chat([['role' => 'user', 'content' => 'Hi']], [
            'tools' => [['type' => 'function', 'function' => ['name' => 'x', 'description' => 'x']]],
            'tool_choice' => 'none',
        ]);

        $this->assertSame(['type' => 'none'], $provider->sent['tool_choice']);
    }

    public function test_current_claude_models_are_asked_for_low_effort_and_older_ones_are_not(): void
    {
        $current = $this->provider();
        $current->chat([['role' => 'user', 'content' => 'Hi']]);
        $this->assertSame(['effort' => 'low'], $current->sent['output_config']);

        $older = new RecordingAnthropicProvider([
            'api_key' => 'sk-ant-fake-not-real',
            'api_url' => 'https://api.anthropic.com/v1',
            'default_model' => 'claude-haiku-4-5',
        ]);
        $older->chat([['role' => 'user', 'content' => 'Hi']]);
        $this->assertArrayNotHasKey('output_config', $older->sent);
    }

    private function provider(): RecordingAnthropicProvider
    {
        return new RecordingAnthropicProvider([
            'api_key' => 'sk-ant-fake-not-real',
            'api_url' => 'https://api.anthropic.com/v1',
            'default_model' => 'claude-opus-5-5',
        ]);
    }
}

final class RecordingAnthropicProvider extends AnthropicProvider
{
    /** @var array<string, mixed> */
    public array $sent = [];

    protected function request(string $endpoint, array $data, array $headers = []): array
    {
        $this->sent = $data;

        return [
            'content' => [['type' => 'text', 'text' => 'OK']],
            'stop_reason' => 'end_turn',
            'usage' => ['input_tokens' => 1, 'output_tokens' => 1],
        ];
    }
}
