<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\AiChatService;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class AiChatServiceTest extends TestCase
{
    private AiChatService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new AiChatService();
    }

    /**
     * Build a chainable query-builder mock for the saveMessage() flow.
     * first() returns an existing conversation (avoids the insert/lastInsertId
     * path); insert()/update() are no-ops.
     */
    private function mockSaveMessageBuilder()
    {
        $mock = \Mockery::mock('Illuminate\Database\Query\Builder');
        $mock->shouldReceive('where')->andReturnSelf();
        $mock->shouldReceive('orderByDesc')->andReturnSelf();
        $mock->shouldReceive('first')->andReturn((object) ['id' => 1]);
        $mock->shouldReceive('insert')->andReturn(true);
        $mock->shouldReceive('update')->andReturn(1);
        return $mock;
    }

    /**
     * The community's own OpenAI key, as AiSettings::get() reads it from
     * ai_settings. Since 8 Nov 2026 chat() uses only this key.
     */
    private function mockCommunityKey(?string $key): void
    {
        $aiSettings = \Mockery::mock('Illuminate\Database\Query\Builder');
        $aiSettings->shouldReceive('where')->andReturnSelf();
        $aiSettings->shouldReceive('value')->with('setting_value')->andReturn($key);
        DB::shouldReceive('table')->with('ai_settings')->andReturn($aiSettings);
    }

    public function test_chat_returns_error_when_the_community_has_no_key_even_if_the_platform_has_one(): void
    {
        config(['services.openai.api_key' => 'sk-platform-key-fake']);
        Http::preventStrayRequests();
        $this->mockCommunityKey(null);

        $result = $this->service->chat(1, 'Hello');

        $this->assertTrue($result['error']);
        $this->assertSame('AI chat is not configured.', $result['reply']);
        Http::assertNothingSent();
    }

    public function test_chat_calls_openai_with_the_community_key_and_saves_message(): void
    {
        config(['services.openai.api_key' => 'sk-platform-key-fake']);

        Http::fake([
            'api.openai.com/*' => Http::response([
                'choices' => [['message' => ['content' => 'Hello there!']]],
            ]),
        ]);

        $this->mockCommunityKey('sk-community-key-fake');

        // saveMessage() touches ai_conversations (lookup + update) and ai_messages (insert).
        DB::shouldReceive('table')->with('ai_conversations')->andReturn($this->mockSaveMessageBuilder());
        DB::shouldReceive('table')->with('ai_messages')->andReturn($this->mockSaveMessageBuilder());

        $result = $this->service->chat(1, 'Hi');

        $this->assertFalse($result['error']);
        $this->assertSame('Hello there!', $result['reply']);
        Http::assertSent(fn ($request) => $request->hasHeader('Authorization', 'Bearer sk-community-key-fake'));
    }

    public function test_chat_returns_error_on_http_failure(): void
    {
        $this->mockCommunityKey('sk-community-key-fake');

        // A 5xx response makes ->json() succeed but saveMessage still runs; force a
        // throw inside the try block so the catch logs and returns error=true.
        Http::fake([
            'api.openai.com/*' => fn () => throw new \RuntimeException('boom'),
        ]);

        Log::shouldReceive('error')->once();

        $result = $this->service->chat(1, 'Hi');

        $this->assertTrue($result['error']);
    }

    public function test_streamChat_returns_config_array(): void
    {
        $result = $this->service->streamChat(1, 'Hello', ['model' => 'gpt-4']);

        $this->assertSame('gpt-4', $result['model']);
        $this->assertTrue($result['stream']);
        $this->assertSame(1024, $result['max_tokens']);
    }

    public function test_streamChat_clamps_max_tokens_to_4096(): void
    {
        $result = $this->service->streamChat(1, 'Hello', ['max_tokens' => 10000]);

        $this->assertSame(4096, $result['max_tokens']);
    }

    public function test_getHistory_returns_array(): void
    {
        // getHistory() queries `ai_messages as m` joined to `ai_conversations as c`.
        DB::shouldReceive('table')->with('ai_messages as m')->andReturnSelf();
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('orderByDesc')->andReturnSelf();
        DB::shouldReceive('limit')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = $this->service->getHistory(1);
        $this->assertIsArray($result);
    }

    public function test_getHistory_clamps_limit_to_200(): void
    {
        DB::shouldReceive('table')->with('ai_messages as m')->andReturnSelf();
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('orderByDesc')->andReturnSelf();
        DB::shouldReceive('limit')->with(200)->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $this->service->getHistory(1, 500);
        $this->assertTrue(true);
    }
}
