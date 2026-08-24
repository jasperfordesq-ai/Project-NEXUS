<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * TranscriptionService — Voice message transcription and translation via OpenAI.
 *
 * Uses Whisper API for audio-to-text transcription and GPT-4o-mini for translation.
 */
class TranscriptionService
{
    /**
     * Is the provider this service needs actually configured?
     *
     * 🔴 Both transcribe() and translate() return null when the key is missing,
     * which is indistinguishable from "the provider was called and failed".
     * Callers used to report both as a server error telling the member to try
     * again — advice that can never work on an installation with no key, and a
     * permanent 500 in error monitoring. Check this FIRST and answer
     * "unavailable" instead.
     */
    public static function isConfigured(): bool
    {
        return ! empty(config('services.openai.api_key'));
    }

    /**
     * Transcribe an audio file using OpenAI Whisper API.
     *
     * @param string $audioFilePath Absolute path to the audio file on disk.
     * @return array{text: string, language: string}|null Returns transcript data or null on failure.
     */
    public static function transcribe(string $audioFilePath): ?array
    {
        $apiKey = config('services.openai.api_key');
        if (empty($apiKey)) {
            Log::warning('TranscriptionService::transcribe — OpenAI API key not configured');
            return null;
        }

        if (!file_exists($audioFilePath)) {
            Log::warning('TranscriptionService::transcribe — Audio file not found', ['path' => $audioFilePath]);
            return null;
        }

        try {
            $response = Http::withToken($apiKey)
                ->timeout(60)
                ->attach('file', file_get_contents($audioFilePath), basename($audioFilePath))
                ->post('https://api.openai.com/v1/audio/transcriptions', [
                    'model'           => 'whisper-1',
                    'response_format' => 'verbose_json',
                ]);

            if (!$response->successful()) {
                Log::error('TranscriptionService::transcribe — API error', [
                    'status' => $response->status(),
                    'body'   => $response->body(),
                ]);
                return null;
            }

            $data = $response->json();

            return [
                'text'     => $data['text'] ?? '',
                'language' => $data['language'] ?? 'en',
            ];
        } catch (\Throwable $e) {
            Log::error('TranscriptionService::transcribe failed', ['error' => $e->getMessage()]);
            return null;
        }
    }

    /** Cache TTL for translated strings (24 hours). */
    private const TRANSLATION_CACHE_TTL = 86400;

    /**
     * Translate text from one language to another using OpenAI chat completions.
     *
     * Supports Redis caching (INT6), conversation context (INT7), and glossary injection (INT10).
     *
     * @param string      $text            The text to translate.
     * @param string      $fromLanguage    Source language (ISO 639-1 code, or 'auto').
     * @param string      $toLanguage      Target language (ISO 639-1 code).
     * @param array       $conversationContext  Optional preceding messages for context-aware translation (INT7).
     * @param array       $glossary        Optional term mappings ['source' => 'target'] for glossary injection (INT10).
     * @return string|null Translated text, or null on failure.
     */
    public static function translate(
        string $text,
        string $fromLanguage,
        string $toLanguage,
        array $conversationContext = [],
        array $glossary = [],
    ): ?string {
        $apiKey = config('services.openai.api_key');
        if (empty($apiKey)) {
            Log::warning('TranscriptionService::translate — OpenAI API key not configured');
            return null;
        }

        if (empty(trim($text))) {
            return '';
        }

        // INT6: Check Redis cache (hash of text + languages — context/glossary excluded for cache hit rate)
        $cacheKey = 'translation:' . hash('sha256', "{$text}:{$fromLanguage}:{$toLanguage}");
        if (empty($conversationContext) && empty($glossary)) {
            $cached = Cache::get($cacheKey);
            if ($cached !== null) {
                return $cached;
            }
        }

        try {
            // Build the system prompt
            $systemPrompt = $fromLanguage === 'auto'
                ? "Detect the language of the following text and translate it to {$toLanguage}."
                : "Translate the following text from {$fromLanguage} to {$toLanguage}.";

            $systemPrompt .= ' Return only the translation, nothing else.';

            // INT10: Inject glossary terms into the system prompt
            if (!empty($glossary)) {
                $terms = [];
                foreach ($glossary as $source => $target) {
                    $safeSource = str_replace('"', "'", $source);
                    $safeTarget = str_replace('"', "'", $target);
                    $terms[] = "- \"{$safeSource}\" → \"{$safeTarget}\"";
                }
                $systemPrompt .= "\n\nIMPORTANT: Use these specific term translations:\n" . implode("\n", $terms);
            }

            // Build messages array
            $messages = [['role' => 'system', 'content' => $systemPrompt]];

            // INT7: Add conversation context for disambiguation
            if (!empty($conversationContext)) {
                $contextBlock = "Here are the preceding messages for context (do NOT translate these, only the final message):\n";
                foreach ($conversationContext as $ctx) {
                    $contextBlock .= "- {$ctx}\n";
                }
                $messages[] = ['role' => 'user', 'content' => $contextBlock . "\nTranslate this message:\n" . $text];
            } else {
                $messages[] = ['role' => 'user', 'content' => $text];
            }

            $response = Http::withToken($apiKey)
                ->timeout(30)
                ->post('https://api.openai.com/v1/chat/completions', [
                    'model'      => 'gpt-4o-mini',
                    'messages'   => $messages,
                    'max_tokens' => 2048,
                ]);

            if (!$response->successful()) {
                Log::error('TranscriptionService::translate — API error', [
                    'status' => $response->status(),
                    'body'   => $response->body(),
                ]);
                return null;
            }

            $translated = $response->json('choices.0.message.content', '');

            // INT6: Store in Redis cache (only for simple translations without context/glossary)
            if (empty($conversationContext) && empty($glossary) && !empty($translated)) {
                Cache::put($cacheKey, $translated, self::TRANSLATION_CACHE_TTL);
            }

            return $translated;
        } catch (\Throwable $e) {
            Log::error('TranscriptionService::translate failed', ['error' => $e->getMessage()]);
            return null;
        }
    }
}
