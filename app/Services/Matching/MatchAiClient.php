<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

use App\Core\TenantContext;
use App\Models\AiSettings;
use App\Services\AI\AIServiceFactory;
use Illuminate\Support\Facades\Log;

/**
 * The one way matching asks a community's AI a question.
 *
 * Each community chooses its own provider (OpenAI, Anthropic, Gemini, or a
 * model it runs itself) and types the name of the model. Matching cannot
 * know that list, so it adapts to whatever answers:
 *
 *  - It asks for JSON and reads it out of whatever comes back: bare, in a
 *    code fence, or with a sentence either side.
 *  - A "thinking" model counts its thinking against the answer allowance
 *    and can stop before any answer. The allowance sent is therefore always
 *    far larger than the answer needs (only what is generated is paid for),
 *    and an empty or cut-off answer is asked for once more with more room.
 *  - A model the community runs itself (Ollama) is treated as small and
 *    slow: {@see profile()} lets callers send it much less at a time.
 *  - Parameters a model refuses are the provider's business
 *    (OpenAIProvider learns them; AnthropicProvider never sends them).
 *
 * It never throws and never retries more than once: any failure is a null,
 * and every caller treats null as "the AI said nothing", after which
 * matching carries on by itself.
 *
 * Only the provider the community chose is ever used. There is no platform
 * key and no second provider to fall back to: AIServiceFactory's fallback
 * list holds the chosen provider alone unless a config file adds others.
 */
class MatchAiClient
{
    /** Providers whose models are run by the community itself. */
    private const SELF_HOSTED = ['ollama'];

    /** The setting that holds the model name, by provider. */
    private const MODEL_SETTING = [
        'openai' => 'openai_model',
        'anthropic' => 'claude_model',
        'gemini' => 'gemini_model',
        'ollama' => 'ollama_model',
    ];

    /** The least allowance sent to a hosted model: room to think, then answer. */
    private const HOSTED_FLOOR = 2000;

    /** ... and to a self-hosted one, where a long generation is slow. */
    private const SELF_HOSTED_FLOOR = 600;

    /**
     * Which provider and model this community's matching uses.
     *
     * @return array{provider: string, model: string, small: bool}
     */
    public function profile(): array
    {
        $provider = '';
        $model = '';
        try {
            $provider = (string) AIServiceFactory::getDefaultProvider();
            $tenantId = (int) (TenantContext::getId() ?? 0);
            if ($tenantId > 0 && isset(self::MODEL_SETTING[$provider])) {
                $model = (string) (AiSettings::get($tenantId, self::MODEL_SETTING[$provider]) ?? '');
            }
        } catch (\Throwable $e) {
            Log::debug('[MatchAiClient] provider settings unavailable: ' . $e->getMessage());
        }

        return ['provider' => $provider, 'model' => $model, 'small' => in_array($provider, self::SELF_HOSTED, true)];
    }

    /**
     * Ask for a JSON answer.
     *
     * @param array<int, array{role: string, content: string}> $messages
     * @param int $answerTokens roughly how long the answer itself can be
     * @param 'object'|'array' $shape whether the answer is {...} or [...]
     * @return array{data: array<mixed>, provider: string, model: string, tokens_in: int, tokens_out: int}|null
     *         null when the provider failed or gave nothing that can be read
     */
    public function askJson(array $messages, int $answerTokens, string $shape = 'object'): ?array
    {
        $small = $this->profile()['small'];
        $allowance = max($answerTokens * ($small ? 2 : 4), $small ? self::SELF_HOSTED_FLOOR : self::HOSTED_FLOOR);
        $tokensIn = 0;
        $tokensOut = 0;

        for ($attempt = 0; $attempt < 2; $attempt++) {
            try {
                $response = $this->send($messages, ['temperature' => 0.0, 'max_tokens' => $allowance]);
            } catch (\Throwable $e) {
                // A refused key, no credit, an outage: asking again changes nothing.
                Log::info('[MatchAiClient] AI request failed: ' . $e->getMessage());
                return null;
            }

            $tokensIn += (int) ($response['tokens_input'] ?? 0);
            $tokensOut += (int) ($response['tokens_output'] ?? 0);
            $data = self::readJson((string) ($response['content'] ?? ''), $shape);
            if ($data !== null) {
                return [
                    'data' => $data,
                    'provider' => (string) ($response['provider'] ?? ''),
                    'model' => (string) ($response['model'] ?? ''),
                    'tokens_in' => $tokensIn,
                    'tokens_out' => $tokensOut,
                ];
            }

            // Nothing, or an answer cut off part-way: most often a model that
            // used its allowance thinking. Once more, with three times the room.
            $allowance *= 3;
            $messages[] = [
                'role' => 'user',
                'content' => 'Reply again with the JSON only: no explanation, no code fence, and finish it.',
            ];
        }

        Log::info('[MatchAiClient] no readable answer after one retry');

        return null;
    }

    /**
     * The JSON object or list inside a reply, or null when there is none or
     * it does not parse (a cut-off answer does not).
     *
     * @return array<mixed>|null
     */
    private static function readJson(string $content, string $shape): ?array
    {
        [$open, $close] = $shape === 'array' ? ['[', ']'] : ['{', '}'];
        $start = strpos($content, $open);
        $end = strrpos($content, $close);
        if ($start === false || $end === false || $end <= $start) {
            return null;
        }
        $decoded = json_decode(substr($content, $start, $end - $start + 1), true);

        return is_array($decoded) ? $decoded : null;
    }

    /**
     * The provider request. Protected seam for tests.
     *
     * @param array<int, array{role: string, content: string}> $messages
     * @param array<string, mixed> $options
     * @return array<string, mixed>
     */
    protected function send(array $messages, array $options): array
    {
        return AIServiceFactory::chatWithFallback($messages, $options);
    }
}
