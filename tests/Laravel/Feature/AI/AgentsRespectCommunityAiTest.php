<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\AI;

use App\Core\TenantContext;
use App\Services\Agent\Agents\BaseAgent;
use App\Services\AI\AIServiceFactory;
use App\Services\AI\Contracts\AIProviderInterface;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-633 (security register E-131): the admin AI helpers ("agents": activity
 * summariser, nudge drafter, matchmaker) called the AI whenever the platform
 * environment had OPENAI_API_KEY set — never the community's own AI switch —
 * and always on OpenAI with a fixed model, whatever provider the community
 * chose on its AI settings page.
 *
 * Stand-in providers are planted in the factory, so nothing leaves the test.
 */
final class AgentsRespectCommunityAiTest extends TestCase
{
    use DatabaseTransactions;

    private RecordingAgentProvider $openai;
    private RecordingAgentProvider $anthropic;

    protected function setUp(): void
    {
        parent::setUp();
        AIServiceFactory::clearCache();
        TenantContext::setById($this->testTenantId);
        // Visible to env() however it is read, so the old platform-key check
        // passes and the test reaches the community's switch.
        putenv('OPENAI_API_KEY=sk-platform-fake-not-real');
        $_ENV['OPENAI_API_KEY'] = $_SERVER['OPENAI_API_KEY'] = 'sk-platform-fake-not-real';

        $this->openai = new RecordingAgentProvider('openai');
        $this->anthropic = new RecordingAgentProvider('anthropic');
        $instances = new \ReflectionProperty(AIServiceFactory::class, 'instances');
        $instances->setValue(null, ['openai' => $this->openai, 'anthropic' => $this->anthropic]);

        $this->saveAiSetting('ai_provider', 'anthropic');
    }

    protected function tearDown(): void
    {
        putenv('OPENAI_API_KEY');
        unset($_ENV['OPENAI_API_KEY'], $_SERVER['OPENAI_API_KEY']);
        AIServiceFactory::clearCache();
        parent::tearDown();
    }

    public function test_nothing_is_sent_while_the_communitys_ai_is_off(): void
    {
        $this->saveAiSetting('ai_enabled', '0');

        $result = $this->agent()->ask();

        $this->assertSame('', $result['content']);
        $this->assertSame(0, $this->openai->calls + $this->anthropic->calls);
    }

    public function test_the_communitys_chosen_provider_and_saved_model_are_used(): void
    {
        $this->saveAiSetting('ai_enabled', '1');

        $result = $this->agent()->ask();

        $this->assertSame('from anthropic', $result['content']);
        $this->assertSame(0, $this->openai->calls);
        $this->assertSame(1, $this->anthropic->calls);
        $this->assertArrayNotHasKey('model', $this->anthropic->lastOptions, 'a fixed OpenAI model was forced on the community');
    }

    private function agent(): object
    {
        return new class ($this->testTenantId, 0, 0) extends BaseAgent {
            public function run(): array
            {
                return [];
            }

            /** @return array{content:string,input_tokens:int,output_tokens:int} */
            public function ask(): array
            {
                return $this->callLlm([['role' => 'user', 'content' => 'Summarise this week']]);
            }
        };
    }

    private function saveAiSetting(string $key, string $value): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'updated_at' => now()]
        );
    }
}

final class RecordingAgentProvider implements AIProviderInterface
{
    public int $calls = 0;
    /** @var array<string, mixed> */
    public array $lastOptions = [];

    public function __construct(private string $id)
    {
    }

    public function chat(array $messages, array $options = []): array
    {
        $this->calls++;
        $this->lastOptions = $options;

        return ['content' => 'from ' . $this->id, 'tokens_input' => 1, 'tokens_output' => 1];
    }

    public function complete(string $prompt, array $options = []): string
    {
        return '';
    }

    public function streamChat(array $messages, callable $onChunk, array $options = []): void
    {
    }

    public function embed(string $text): array
    {
        return [];
    }

    public function getModels(): array
    {
        return [];
    }

    public function isConfigured(): bool
    {
        return true;
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getName(): string
    {
        return $this->id;
    }

    public function testConnection(): array
    {
        return ['success' => true, 'message' => '', 'latency_ms' => 0];
    }
}
