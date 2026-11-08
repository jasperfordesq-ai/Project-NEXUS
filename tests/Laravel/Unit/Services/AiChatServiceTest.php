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

    public function test_chat_returns_error_when_api_key_missing(): void
    {
        config(['services.openai.api_key' => null]);

        $result = $this->service->chat(1, 'Hello');

        $this->assertTrue($result['error']);
        $this->assertSame('AI chat is not configured.', $result['reply']);
    }

    public function test_chat_calls_openai_and_saves_message(): void
    {
        config(['services.openai.api_key' => 'test-key']);

        Http::fake([
            'api.openai.com/*' => Http::response([
                'choices' => [['message' => ['content' => 'Hello there!']]],
            ]),
        ]);

        // The community has saved no OpenAI key of its own, so the platform key is used.
        $aiSettings = \Mockery::mock('Illuminate\Database\Query\Builder');
        $aiSettings->shouldReceive('where')->andReturnSelf();
        $aiSettings->shouldReceive('value')->with('setting_value')->andReturn(null);
        DB::shouldReceive('table')->with('ai_settings')->andReturn($aiSettings);

        // saveMessage() touches ai_conversations (lookup + update) and ai_messages (insert).
        DB::shouldReceive('table')->with('ai_conversations')->andReturn($this->mockSaveMessageBuilder());
        DB::shouldReceive('table')->with('ai_messages')->andReturn($this->mockSaveMessageBuilder());

        $result = $this->service->chat(1, 'Hi');

        $this->assertFalse($result['error']);
        $this->assertSame('Hello there!', $result['reply']);
    }

    public function test_chat_returns_error_on_http_failure(): void
    {
        config(['services.openai.api_key' => 'test-key']);

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
