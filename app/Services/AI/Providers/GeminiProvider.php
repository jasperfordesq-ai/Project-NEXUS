<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI\Providers;

/**
 * Google Gemini AI Provider
 *
 * Free tier provider with generous limits.
 * https://ai.google.dev/tutorials/rest_quickstart
 */
class GeminiProvider extends BaseProvider
{
    public function getId(): string
    {
        return 'gemini';
    }

    public function getName(): string
    {
        return 'Google Gemini';
    }

    /**
     * Send a chat completion request to Gemini API
     */
    public function chat(array $messages, array $options = []): array
    {
        if (!$this->isConfigured()) {
            throw new \Exception('Gemini API key not configured');
        }

        $model = $this->getModel($options);
        // The key goes in a header, never the address, where logs can record it.
        $endpoint = "models/{$model}:generateContent";

        // Convert messages to Gemini format
        $contents = $this->convertMessagesToGeminiFormat($messages);

        $data = [
            'contents' => $contents,
            'generationConfig' => [
                'temperature' => $options['temperature'] ?? 0.7,
                'maxOutputTokens' => $options['max_tokens'] ?? 2048,
                'topP' => $options['top_p'] ?? 0.95,
            ],
        ];

        // Add safety settings
        $data['safetySettings'] = [
            ['category' => 'HARM_CATEGORY_HARASSMENT', 'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
            ['category' => 'HARM_CATEGORY_HATE_SPEECH', 'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
            ['category' => 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
            ['category' => 'HARM_CATEGORY_DANGEROUS_CONTENT', 'threshold' => 'BLOCK_MEDIUM_AND_ABOVE'],
        ];

        $response = $this->request($endpoint, $data, ['x-goog-api-key: ' . $this->apiKey]);

        // Parse response
        $content = '';
        $tokensUsed = 0;
        $finishReason = 'stop';

        if (isset($response['candidates'][0]['content']['parts'][0]['text'])) {
            $content = $response['candidates'][0]['content']['parts'][0]['text'];
        }

        if (isset($response['candidates'][0]['finishReason'])) {
            $finishReason = strtolower($response['candidates'][0]['finishReason']);
        }

        if (isset($response['usageMetadata'])) {
            $tokensUsed = ($response['usageMetadata']['promptTokenCount'] ?? 0)
                        + ($response['usageMetadata']['candidatesTokenCount'] ?? 0);
        }

        return [
            'content' => $content,
            'tokens_used' => $tokensUsed,
            'tokens_input' => $response['usageMetadata']['promptTokenCount'] ?? 0,
            'tokens_output' => $response['usageMetadata']['candidatesTokenCount'] ?? 0,
            'model' => $model,
            'finish_reason' => $finishReason,
            'provider' => 'gemini',
        ];
    }

    /**
     * Stream chat with Gemini
     */
    public function streamChat(array $messages, callable $onChunk, array $options = []): void
    {
        if (!$this->isConfigured()) {
            throw new \Exception('Gemini API key not configured');
        }

        $model = $this->getModel($options);
        $endpoint = "models/{$model}:streamGenerateContent?alt=sse";

        $contents = $this->convertMessagesToGeminiFormat($messages);

        $data = [
            'contents' => $contents,
            'generationConfig' => [
                'temperature' => $options['temperature'] ?? 0.7,
                'maxOutputTokens' => $options['max_tokens'] ?? 2048,
            ],
        ];

        $url = rtrim($this->apiUrl, '/') . '/' . ltrim($endpoint, '/');

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($data),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $this->apiKey],
            CURLOPT_TIMEOUT => 300,
            CURLOPT_WRITEFUNCTION => function ($ch, $data) use ($onChunk) {
                $lines = explode("\n", $data);
                foreach ($lines as $line) {
                    $line = trim($line);
                    if (empty($line)) continue;

                    if (str_starts_with($line, 'data: ')) {
                        $json = json_decode(substr($line, 6), true);
                        if ($json && isset($json['candidates'][0]['content']['parts'][0]['text'])) {
                            $onChunk([
                                'content' => $json['candidates'][0]['content']['parts'][0]['text'],
                                'done' => ($json['candidates'][0]['finishReason'] ?? null) === 'STOP',
                            ]);
                        }
                    }
                }
                return strlen($data);
            },
        ]);

        curl_exec($ch);
        curl_close($ch);
    }

    /**
     * Generate embeddings using Gemini
     */
    public function embed(string $text): array
    {
        if (!$this->isConfigured()) {
            throw new \Exception('Gemini API key not configured');
        }

        $endpoint = "models/text-embedding-004:embedContent";

        $data = [
            'model' => 'models/text-embedding-004',
            'content' => [
                'parts' => [['text' => $text]]
            ],
        ];

        $response = $this->request($endpoint, $data, ['x-goog-api-key: ' . $this->apiKey]);

        return $response['embedding']['values'] ?? [];
    }

    /**
     * Convert OpenAI-style messages to Gemini format
     */
    private function convertMessagesToGeminiFormat(array $messages): array
    {
        $contents = [];
        $systemInstruction = '';

        foreach ($messages as $message) {
            $role = $message['role'];
            $content = $message['content'];

            // Handle system messages
            if ($role === 'system') {
                $systemInstruction .= $content . "\n";
                continue;
            }

            // Map roles: user -> user, assistant -> model
            $geminiRole = $role === 'assistant' ? 'model' : 'user';

            $contents[] = [
                'role' => $geminiRole,
                'parts' => [['text' => $content]]
            ];
        }

        // Prepend system instruction to first user message if exists
        if ($systemInstruction && !empty($contents)) {
            foreach ($contents as &$content) {
                if ($content['role'] === 'user') {
                    $content['parts'][0]['text'] = trim($systemInstruction) . "\n\n" . $content['parts'][0]['text'];
                    break;
                }
            }
        }

        return $contents;
    }
}
