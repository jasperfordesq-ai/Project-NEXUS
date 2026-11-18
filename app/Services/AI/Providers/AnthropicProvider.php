<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI\Providers;

/**
 * Anthropic Claude Provider
 *
 * Supports Claude 3 (Opus, Sonnet, Haiku) and Claude 3.5 models.
 * https://docs.anthropic.com/claude/reference
 *
 * CRITICAL FIX: All API keys are strictly sanitized (trimmed) before every request
 * to prevent 401 errors caused by hidden whitespace or newlines.
 */
class AnthropicProvider extends BaseProvider
{
    /** Room for a current model's thinking plus the answer; see chat(). */
    private const MIN_MAX_TOKENS = 8192;

    private string $apiVersion = '2023-06-01';

    public function __construct(array $config = [])
    {
        parent::__construct($config);
        $this->apiVersion = $config['api_version'] ?? '2023-06-01';
    }

    public function getId(): string
    {
        return 'anthropic';
    }

    public function getName(): string
    {
        return 'Anthropic Claude';
    }

    /**
     * Send a chat completion request to Anthropic API.
     *
     * Supports OpenAI-style provider-neutral tool calling: the caller passes
     * options.tools as a list of {type:function, function:{name, description,
     * parameters}} schemas and may pass role:tool messages with tool_call_id
     * + content. We translate to/from Anthropic's tool_use / tool_result
     * content-block shape transparently so the caller doesn't care which
     * provider answered.
     */
    public function chat(array $messages, array $options = []): array
    {
        if (!$this->isConfigured()) {
            throw new \Exception('Anthropic API key not configured');
        }

        $apiKey = trim($this->apiKey);
        if (empty($apiKey)) {
            \Illuminate\Support\Facades\Log::warning("Anthropic Request: API key is empty or not configured");
        }

        $model = $this->getModel($options);

        [$systemPrompt, $chatMessages] = $this->translateMessagesForAnthropic($messages);

        // Current Claude models think on every request and that thinking counts
        // against max_tokens, so a caller's small answer budget (250 for a bio)
        // could end before any answer text. It is a ceiling, not a target: only
        // what is written is billed. Answer length is set by each prompt.
        $data = [
            'model' => $model,
            'messages' => $chatMessages,
            'max_tokens' => max((int) ($options['max_tokens'] ?? 0), self::MIN_MAX_TOKENS),
        ];
        if ($systemPrompt !== '') {
            $data['system'] = $systemPrompt;
        }
        // No temperature / top_p / top_k: Claude Opus 5.5 refuses them and
        // Sonnet 5.5 / Haiku 5.5 refuse any non-default value (400), and every
        // caller here passes one. Security register E-131.

        // The 5-family models think on every request; low effort is the
        // vendor's recommendation for chat and short drafting, and keeps a
        // tool round quick. Older models reject the field, so only these.
        if (preg_match('/^claude-(opus|sonnet|haiku|fable|mythos)-5/', (string) $model) === 1) {
            $data['output_config'] = ['effort' => (string) ($options['effort'] ?? 'low')];
        }
        if (!empty($options['tools']) && is_array($options['tools'])) {
            $data['tools'] = array_map(function ($t) {
                $fn = $t['function'] ?? $t;
                return [
                    'name' => $fn['name'] ?? '',
                    'description' => $fn['description'] ?? '',
                    'input_schema' => self::objectProperties(
                        $fn['parameters'] ?? ['type' => 'object', 'properties' => (object) []]
                    ),
                ];
            }, $options['tools']);
            if (!empty($options['tool_choice'])) {
                $tc = $options['tool_choice'];
                $data['tool_choice'] = match ($tc) {
                    'required' => ['type' => 'any'],
                    'none' => ['type' => 'none'],
                    default => ['type' => 'auto'],
                };
            }
        }

        $headers = [
            'x-api-key: ' . $apiKey,
            'anthropic-version: ' . $this->apiVersion,
            'content-type: application/json',
        ];

        $response = $this->request('messages', $data, $headers);

        $content = '';
        $toolCalls = [];
        if (isset($response['content']) && is_array($response['content'])) {
            foreach ($response['content'] as $block) {
                $type = $block['type'] ?? '';
                if ($type === 'text') {
                    $content .= (string) ($block['text'] ?? '');
                } elseif ($type === 'tool_use') {
                    $toolCalls[] = [
                        'id' => (string) ($block['id'] ?? ''),
                        'name' => (string) ($block['name'] ?? ''),
                        'arguments' => is_array($block['input'] ?? null) ? $block['input'] : [],
                        'arguments_raw' => json_encode($block['input'] ?? new \stdClass()),
                    ];
                }
            }
        }

        $usage = $response['usage'] ?? [];

        return [
            'content' => $content,
            'tool_calls' => $toolCalls,
            'tokens_used' => ($usage['input_tokens'] ?? 0) + ($usage['output_tokens'] ?? 0),
            'tokens_input' => ($usage['input_tokens'] ?? 0),
            'tokens_output' => ($usage['output_tokens'] ?? 0),
            'model' => $model,
            'finish_reason' => $response['stop_reason'] ?? 'stop',
            'provider' => 'anthropic',
        ];
    }

    /**
     * Anthropic requires every `properties` in a tool schema to be a JSON
     * object. A tool with no inputs declared in PHP as `'properties' => []`
     * encodes as a list `[]` and the whole request is refused (400 "input_schema
     * .properties: Input should be an object" — tenant 2, 18 Nov 2026). OpenAI
     * accepts either, so the tools are fixed here, for Anthropic only.
     *
     * @param array<string, mixed> $schema
     * @return array<string, mixed>
     */
    private static function objectProperties(array $schema): array
    {
        if (array_key_exists('properties', $schema)) {
            $properties = $schema['properties'];
            if (is_array($properties)) {
                $properties = array_map(
                    static fn ($child) => is_array($child) ? self::objectProperties($child) : $child,
                    $properties
                );
                $schema['properties'] = $properties === [] ? new \stdClass() : $properties;
            }
        }
        if (isset($schema['items']) && is_array($schema['items'])) {
            $schema['items'] = self::objectProperties($schema['items']);
        }

        return $schema;
    }

    /**
     * Convert our provider-neutral messages into Anthropic's wire format.
     *
     * - All `role: system` messages collapse into a single `system` string.
     * - `role: tool` (tool result) messages become user messages with a
     *   `tool_result` content block (batched into the previous user message
     *   when adjacent).
     * - `role: assistant` messages carrying `tool_calls` become assistant
     *   messages with `text` + `tool_use` content blocks.
     *
     * @return array{0: string, 1: array<int, array<string, mixed>>}
     */
    private function translateMessagesForAnthropic(array $messages): array
    {
        $systemPrompt = '';
        $out = [];

        foreach ($messages as $m) {
            $role = $m['role'] ?? 'user';

            if ($role === 'system') {
                $systemPrompt .= ($m['content'] ?? '') . "\n";
                continue;
            }

            if ($role === 'tool') {
                $block = [
                    'type' => 'tool_result',
                    'tool_use_id' => (string) ($m['tool_call_id'] ?? ''),
                    'content' => is_string($m['content'] ?? null)
                        ? $m['content']
                        : json_encode($m['content']),
                ];
                $last = end($out);
                if ($last !== false && $last['role'] === 'user' && is_array($last['content'] ?? null)) {
                    $out[count($out) - 1]['content'][] = $block;
                } else {
                    $out[] = ['role' => 'user', 'content' => [$block]];
                }
                continue;
            }

            if ($role === 'assistant' && !empty($m['tool_calls'])) {
                $blocks = [];
                if (!empty($m['content']) && is_string($m['content'])) {
                    $blocks[] = ['type' => 'text', 'text' => $m['content']];
                }
                foreach ($m['tool_calls'] as $call) {
                    $args = $call['arguments'] ?? [];
                    if (is_string($args)) {
                        $args = json_decode($args, true) ?: [];
                    }
                    $blocks[] = [
                        'type' => 'tool_use',
                        'id' => (string) ($call['id'] ?? ''),
                        'name' => (string) ($call['name'] ?? ''),
                        'input' => $args ?: new \stdClass(),
                    ];
                }
                $out[] = ['role' => 'assistant', 'content' => $blocks];
                continue;
            }

            $content = is_string($m['content'] ?? null) ? $m['content'] : json_encode($m['content']);
            // Anthropic refuses an empty message anywhere in the history.
            if (trim((string) $content) === '') {
                continue;
            }
            $out[] = ['role' => $role, 'content' => $content];
        }

        // Anthropic requires the first message to be the user's. The chat
        // keeps only the last 12 history rows, which can begin with a reply.
        while ($out !== [] && ($out[0]['role'] ?? '') === 'assistant') {
            array_shift($out);
        }

        return [trim($systemPrompt), $out];
    }

    /**
     * Stream chat with Anthropic
     * CRITICAL FIX: API key is strictly sanitized before every request
     */
    public function streamChat(array $messages, callable $onChunk, array $options = []): void
    {
        if (!$this->isConfigured()) {
            throw new \Exception('Anthropic API key not configured');
        }

        // CRITICAL: Strictly sanitize the API key to remove any whitespace/newlines
        // This prevents 401 errors from hidden characters
        $apiKey = trim($this->apiKey);

        // SECURITY: Only log key presence, never expose key content
        if (empty($apiKey)) {
            \Illuminate\Support\Facades\Log::warning("Anthropic Stream Request: API key is empty or not configured");
        }

        $model = $this->getModel($options);

        // Extract system message
        $systemPrompt = '';
        $chatMessages = [];

        foreach ($messages as $message) {
            if ($message['role'] === 'system') {
                $systemPrompt .= $message['content'] . "\n";
            } else {
                $chatMessages[] = [
                    'role' => $message['role'],
                    'content' => $message['content'],
                ];
            }
        }

        $data = [
            'model' => $model,
            'messages' => $chatMessages,
            'max_tokens' => $options['max_tokens'] ?? 2048,
            'stream' => true,
        ];

        if ($systemPrompt) {
            $data['system'] = trim($systemPrompt);
        }

        // CRITICAL: Use sanitized $apiKey, NOT $this->apiKey
        $headers = [
            'x-api-key: ' . $apiKey,
            'anthropic-version: ' . $this->apiVersion,
            'content-type: application/json',
        ];

        $url = rtrim($this->apiUrl, '/') . '/messages';

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($data),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 300,
            CURLOPT_WRITEFUNCTION => function ($ch, $data) use ($onChunk) {
                $lines = explode("\n", $data);
                foreach ($lines as $line) {
                    $line = trim($line);
                    if (empty($line)) continue;

                    if (str_starts_with($line, 'data: ')) {
                        $json = json_decode(substr($line, 6), true);
                        if ($json) {
                            $type = $json['type'] ?? '';

                            if ($type === 'content_block_delta') {
                                $text = $json['delta']['text'] ?? '';
                                if ($text) {
                                    $onChunk([
                                        'content' => $text,
                                        'done' => false,
                                    ]);
                                }
                            } elseif ($type === 'message_stop') {
                                $onChunk([
                                    'content' => '',
                                    'done' => true,
                                ]);
                            }
                        }
                    }
                }
                return strlen($data);
            },
        ]);

        curl_exec($ch);

        // Check for curl errors
        if (curl_errno($ch)) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new \Exception("Anthropic stream error: $error");
        }

        curl_close($ch);
    }

    /**
     * Embeddings not directly supported by Anthropic API
     */
    public function embed(string $text): array
    {
        throw new \Exception("Anthropic Claude doesn't support embeddings. Use Voyager or another embedding service.");
    }
}
