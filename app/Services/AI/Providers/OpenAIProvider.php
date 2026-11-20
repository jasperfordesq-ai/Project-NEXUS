<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI\Providers;

/**
 * OpenAI GPT Provider
 *
 * Supports GPT-4, GPT-4o, GPT-3.5-turbo and other OpenAI models, including
 * function/tool calling for the AI chat agent.
 *
 * https://platform.openai.com/docs/api-reference
 */
class OpenAIProvider extends BaseProvider
{
    public function getId(): string
    {
        return 'openai';
    }

    public function getName(): string
    {
        return 'OpenAI';
    }

    /**
     * Send a chat completion request to OpenAI API.
     *
     * Accepts the provider-neutral message format used by the platform:
     *   - role: system|user|assistant|tool
     *   - assistant messages may carry a 'tool_calls' array
     *   - tool messages carry 'tool_call_id' and 'content'
     *
     * Options:
     *   - model, temperature, max_tokens, top_p (passthrough)
     *   - tools  => OpenAI-style tool schemas [{ type: 'function', function: {...} }]
     *   - tool_choice => 'auto' | 'required' | 'none' | { type, function: {name} }
     */
    public function chat(array $messages, array $options = []): array
    {
        if (!$this->isConfigured()) {
            throw new \Exception('OpenAI API key not configured');
        }

        $model = $this->getModel($options);

        $data = [
            'model' => $model,
            'messages' => $this->translateMessages($messages),
            'temperature' => $options['temperature'] ?? 0.7,
            'max_tokens' => $options['max_tokens'] ?? 2048,
        ];

        if (isset($options['top_p'])) {
            $data['top_p'] = $options['top_p'];
        }

        if (!empty($options['tools']) && is_array($options['tools'])) {
            $data['tools'] = $options['tools'];
            if (!empty($options['tool_choice'])) {
                $data['tool_choice'] = $options['tool_choice'];
            }
        }

        $headers = [
            'Authorization: Bearer ' . $this->apiKey,
        ];

        if (!empty($this->config['org_id'])) {
            $headers[] = 'OpenAI-Organization: ' . $this->config['org_id'];
        }

        $response = $this->requestAdapted((string) $model, $data, $headers);

        $choice = $response['choices'][0] ?? [];
        $msg = $choice['message'] ?? [];
        $content = $msg['content'] ?? '';
        $finishReason = $choice['finish_reason'] ?? 'stop';
        $usage = $response['usage'] ?? [];

        $toolCalls = [];
        if (!empty($msg['tool_calls']) && is_array($msg['tool_calls'])) {
            foreach ($msg['tool_calls'] as $tc) {
                $fn = $tc['function'] ?? [];
                $rawArgs = $fn['arguments'] ?? '{}';
                $parsedArgs = is_string($rawArgs) ? json_decode($rawArgs, true) : $rawArgs;
                $toolCalls[] = [
                    'id' => $tc['id'] ?? '',
                    'name' => $fn['name'] ?? '',
                    'arguments' => is_array($parsedArgs) ? $parsedArgs : [],
                    'arguments_raw' => is_string($rawArgs) ? $rawArgs : json_encode($rawArgs),
                ];
            }
        }

        return [
            'content' => is_string($content) ? $content : '',
            'tool_calls' => $toolCalls,
            'tokens_used' => ($usage['total_tokens'] ?? 0),
            'tokens_input' => ($usage['prompt_tokens'] ?? 0),
            'tokens_output' => ($usage['completion_tokens'] ?? 0),
            'model' => $model,
            'finish_reason' => $finishReason,
            'provider' => 'openai',
        ];
    }

    /**
     * What each model has refused, learned from its own 400 answers and kept
     * for the life of the process: model => ['max_tokens' => true, 'temperature' => true].
     *
     * A community types the model it wants (Admin > AI settings), so the
     * list of models cannot be known here. Some OpenAI models take
     * `max_completion_tokens` in place of `max_tokens`, and some take only
     * their default temperature; both say so in a 400.
     *
     * @var array<string, array<string, true>>
     */
    private static array $refused = [];

    /** Forget what was learned about models (tests). */
    public static function forgetWhatModelsRefuse(): void
    {
        self::$refused = [];
    }

    /**
     * Send a chat request in the form this model takes. A model that refuses
     * `max_tokens` or `temperature` is asked again without it, once for each,
     * and that is remembered. Any other error is passed on unchanged.
     *
     * @param array<string, mixed> $data
     * @param string[] $headers
     * @return array<string, mixed>
     */
    private function requestAdapted(string $model, array $data, array $headers): array
    {
        for ($attempt = 0; ; $attempt++) {
            $body = $data;
            if (isset(self::$refused[$model]['max_tokens']) && isset($body['max_tokens'])) {
                $body['max_completion_tokens'] = $body['max_tokens'];
                unset($body['max_tokens']);
            }
            if (isset(self::$refused[$model]['temperature'])) {
                unset($body['temperature'], $body['top_p']);
            }

            try {
                return $this->request('chat/completions', $body, $headers);
            } catch (\Exception $e) {
                $refusal = $attempt < 2 ? self::parameterRefused($e->getMessage()) : null;
                if ($refusal === null || isset(self::$refused[$model][$refusal])) {
                    throw $e;
                }
                self::$refused[$model][$refusal] = true;
                \Illuminate\Support\Facades\Log::info("OpenAI model {$model} does not take {$refusal}; asking again without it.");
            }
        }
    }

    /** Which of the two parameters a 400 answer says this model will not take, if either. */
    private static function parameterRefused(string $message): ?string
    {
        if (!str_contains($message, '(400)')) {
            return null;
        }
        $says = fn (string $needle): bool => stripos($message, $needle) !== false;
        $refuses = $says('unsupported') || $says('not supported') || $says('does not support') || $says('only the default');
        if (!$refuses) {
            return null;
        }
        // "max_tokens ... use max_completion_tokens instead" names both; the one refused is max_tokens.
        if ($says("'max_tokens'") || ($says('max_tokens') && $says('max_completion_tokens'))) {
            return 'max_tokens';
        }
        if ($says('temperature') || $says('top_p')) {
            return 'temperature';
        }

        return null;
    }

    /**
     * Translate provider-neutral messages to OpenAI's wire format.
     *
     * Most fields pass through unchanged. Assistant messages with tool_calls
     * need the tool_calls array reconstructed in OpenAI's function-arguments
     * shape (arguments must be a JSON string).
     */
    private function translateMessages(array $messages): array
    {
        $out = [];
        foreach ($messages as $m) {
            $role = $m['role'] ?? 'user';
            if ($role === 'tool') {
                $out[] = [
                    'role' => 'tool',
                    'tool_call_id' => $m['tool_call_id'] ?? '',
                    'content' => is_string($m['content'] ?? null) ? $m['content'] : json_encode($m['content']),
                ];
                continue;
            }
            if ($role === 'assistant' && !empty($m['tool_calls'])) {
                $tc = [];
                foreach ($m['tool_calls'] as $call) {
                    $args = $call['arguments_raw'] ?? null;
                    if ($args === null) {
                        $args = isset($call['arguments']) ? json_encode($call['arguments']) : '{}';
                    }
                    $tc[] = [
                        'id' => $call['id'] ?? '',
                        'type' => 'function',
                        'function' => [
                            'name' => $call['name'] ?? '',
                            'arguments' => is_string($args) ? $args : json_encode($args),
                        ],
                    ];
                }
                $out[] = [
                    'role' => 'assistant',
                    'content' => isset($m['content']) && is_string($m['content']) ? $m['content'] : null,
                    'tool_calls' => $tc,
                ];
                continue;
            }
            $out[] = [
                'role' => $role,
                'content' => is_string($m['content'] ?? null) ? $m['content'] : json_encode($m['content']),
            ];
        }
        return $out;
    }

    /**
     * Stream chat with OpenAI.
     *
     * Note: tool calling is not yet supported in the streaming path. The
     * non-streaming `chat()` method is used for the tool-call loop.
     */
    public function streamChat(array $messages, callable $onChunk, array $options = []): void
    {
        if (!$this->isConfigured()) {
            throw new \Exception('OpenAI API key not configured');
        }

        $model = $this->getModel($options);

        $data = [
            'model' => $model,
            'messages' => $this->translateMessages($messages),
            'temperature' => $options['temperature'] ?? 0.7,
            'max_tokens' => $options['max_tokens'] ?? 2048,
            'stream' => true,
        ];

        $headers = [
            'Authorization: Bearer ' . $this->apiKey,
        ];

        if (!empty($this->config['org_id'])) {
            $headers[] = 'OpenAI-Organization: ' . $this->config['org_id'];
        }

        $this->streamRequest('chat/completions', $data, function ($chunk) use ($onChunk) {
            $content = $chunk['choices'][0]['delta']['content'] ?? '';
            $finishReason = $chunk['choices'][0]['finish_reason'] ?? null;

            if ($content) {
                $onChunk([
                    'content' => $content,
                    'done' => $finishReason === 'stop',
                ]);
            }
        }, $headers);
    }

    public function embed(string $text): array
    {
        if (!$this->isConfigured()) {
            throw new \Exception('OpenAI API key not configured');
        }

        $data = [
            'model' => 'text-embedding-3-small',
            'input' => $text,
        ];

        $headers = [
            'Authorization: Bearer ' . $this->apiKey,
        ];

        $response = $this->request('embeddings', $data, $headers);

        return $response['data'][0]['embedding'] ?? [];
    }
}
