<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * CaringHelpRequestNlpService — Extract structured intent from a free-text help
 * request transcript using OpenAI gpt-4o-mini with function calling.
 *
 * Used by the audio-first help-request flow (AG36/AG37) to pre-fill the form
 * after a member dictates what they need.
 *
 * Returns:
 *   [
 *     'category'            => 'transport'|'shopping'|'companionship'|'household'|'technology'|'other'|null,
 *     'when'                => ISO-8601 datetime string|null,
 *     'contact_preference'  => 'phone'|'message'|'either'|null,
 *     'raw_text'            => the input transcript (echoed back),
 *   ]
 */
class CaringHelpRequestNlpService
{
    /** Cache TTL (24 hours). */
    private const CACHE_TTL = 86400;

    /** Categories that match the existing caring_help_requests workflow. */
    public const CATEGORIES = [
        'transport',
        'shopping',
        'companionship',
        'household',
        'technology',
        'other',
    ];

    public const CONTACT_PREFERENCES = ['phone', 'message', 'either'];

    /**
     * Extract structured intent from a transcript.
     *
     * @param string $transcript The free-text transcript (in any supported language).
     * @param string $locale     Member locale (ISO 639-1, e.g. 'en', 'de'). Used as
     *                           a hint when parsing relative date phrases.
     * @param (callable(): void)|null $beforeProviderCall Invoked immediately before
     *                           the paid provider request (never on a cache hit or
     *                           when no key is configured). The member AI budget
     *                           hook: it may throw AiBudgetExceededException, which
     *                           propagates to the caller (F-138).
     * @return array{
     *     category: ?string,
     *     when: ?string,
     *     contact_preference: ?string,
     *     raw_text: string
     * }
     */
    public static function extract(string $transcript, string $locale = 'en', ?callable $beforeProviderCall = null): array
    {
        $transcript = trim($transcript);

        if ($transcript === '') {
            return [
                'category'           => null,
                'when'               => null,
                'contact_preference' => null,
                'raw_text'           => '',
            ];
        }

        // tenant_id included to prevent cross-tenant transcript cache leak
        $tenantId = TenantContext::getId();
        $tenantPart = $tenantId !== null ? (string) $tenantId : 'no-tenant';
        $cacheKey = 'caring_nlp:' . hash('sha256', $tenantPart . '|' . $transcript . '|' . $locale);
        $cached = Cache::get($cacheKey);
        if (is_array($cached)) {
            return $cached;
        }

        $apiKey = config('services.openai.api_key');
        if (empty($apiKey)) {
            Log::warning('CaringHelpRequestNlpService::extract — OpenAI API key not configured');
            return self::fallback($transcript);
        }

        $now = now()->toIso8601String();
        $systemPrompt = "You are an assistant that extracts structured intent from a community member's spoken help request.\n"
            . "Today is {$now}. The member's locale is '{$locale}'. The transcript may be in any language.\n"
            . "Map their need to one of the categories: transport, shopping, companionship, household, technology, other.\n"
            . "Parse any time expression (\"tomorrow at 3pm\", \"next Tuesday morning\", \"as soon as possible\") into an ISO-8601 datetime "
            . "if a concrete time is implied; otherwise leave it null.\n"
            . "Detect any contact preference (phone / message / either) if mentioned; otherwise leave it null.\n"
            . "Always call the function `extract_help_request_intent`.";

        // Outside the try below on purpose: a budget refusal must reach the
        // caller, not be swallowed into the silent fallback.
        if ($beforeProviderCall !== null) {
            $beforeProviderCall();
        }

        try {
            $response = Http::withToken($apiKey)
                ->timeout(20)
                ->post('https://api.openai.com/v1/chat/completions', [
                    'model'      => 'gpt-4o-mini',
                    'messages'   => [
                        ['role' => 'system', 'content' => $systemPrompt],
                        ['role' => 'user',   'content' => $transcript],
                    ],
                    'tools'      => [[
                        'type'     => 'function',
                        'function' => [
                            'name'        => 'extract_help_request_intent',
                            'description' => 'Extract the category, time, and contact preference from a help request.',
                            'parameters'  => [
                                'type'       => 'object',
                                'properties' => [
                                    'category' => [
                                        'type'        => ['string', 'null'],
                                        'enum'        => array_merge(self::CATEGORIES, [null]),
                                        'description' => 'The best matching category for the request.',
                                    ],
                                    'when' => [
                                        'type'        => ['string', 'null'],
                                        'description' => 'ISO-8601 datetime if a concrete time is implied, otherwise null.',
                                    ],
                                    'contact_preference' => [
                                        'type' => ['string', 'null'],
                                        'enum' => array_merge(self::CONTACT_PREFERENCES, [null]),
                                        'description' => 'phone, message, either, or null if not mentioned.',
                                    ],
                                ],
                                'required'   => ['category', 'when', 'contact_preference'],
                                'additionalProperties' => false,
                            ],
                        ],
                    ]],
                    'tool_choice' => [
                        'type'     => 'function',
                        'function' => ['name' => 'extract_help_request_intent'],
                    ],
                    'temperature' => 0.1,
                    'max_tokens'  => 256,
                ]);

            if (!$response->successful()) {
                Log::error('CaringHelpRequestNlpService::extract — API error', [
                    'status' => $response->status(),
                    'body'   => $response->body(),
                ]);
                return self::fallback($transcript);
            }

            $toolCall = $response->json('choices.0.message.tool_calls.0.function.arguments');
            $args = is_string($toolCall) ? json_decode($toolCall, true) : null;
            if (!is_array($args)) {
                return self::fallback($transcript);
            }

            $result = self::sanitize($args, $transcript);
            Cache::put($cacheKey, $result, self::CACHE_TTL);
            return $result;
        } catch (\Throwable $e) {
            Log::error('CaringHelpRequestNlpService::extract failed', ['error' => $e->getMessage()]);
            return self::fallback($transcript);
        }
    }

    /** @param array<string,mixed> $args */
    private static function sanitize(array $args, string $transcript): array
    {
        $category = isset($args['category']) && is_string($args['category'])
            && in_array($args['category'], self::CATEGORIES, true)
                ? $args['category']
                : null;

        $when = null;
        if (isset($args['when']) && is_string($args['when']) && $args['when'] !== '') {
            try {
                $when = (new \DateTimeImmutable($args['when']))->format(\DateTimeInterface::ATOM);
            } catch (\Throwable) {
                $when = null;
            }
        }

        $pref = isset($args['contact_preference']) && is_string($args['contact_preference'])
            && in_array($args['contact_preference'], self::CONTACT_PREFERENCES, true)
                ? $args['contact_preference']
                : null;

        return [
            'category'           => $category,
            'when'               => $when,
            'contact_preference' => $pref,
            'raw_text'           => $transcript,
        ];
    }

    private static function fallback(string $transcript): array
    {
        return [
            'category'           => null,
            'when'               => null,
            'contact_preference' => null,
            'raw_text'           => $transcript,
        ];
    }
}
