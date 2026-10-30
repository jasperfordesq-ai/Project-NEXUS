<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AG38 — User-generated-content translation service.
 *
 * Thin wrapper around {@see TranscriptionService::translate()} that adds:
 *   - 30-day Redis cache keyed by sha256(text:source:target)
 *   - an unstated source language is detected by the engine ('auto')
 *   - tenant-scoped logging context
 *
 * Re-uses the LLM call in TranscriptionService — does NOT reimplement.
 */
class UgcTranslationService
{
    /** Cache TTL — 30 days. */
    public const CACHE_TTL = 60 * 60 * 24 * 30;

    /** Cache key prefix (kept distinct from TranscriptionService internal `translation:` key). */
    public const CACHE_PREFIX = 'ugc_xlat:';

    /**
     * Translate a piece of UGC content.
     *
     * @param string          $contentType   feed_post|listing|profile|event|comment|...
     * @param int|string      $contentId     domain id (used for logging/observability only)
     * @param string          $sourceText    the text to translate
     * @param string|null     $sourceLocale  ISO 639-1 code, or null to fall back to tenant default
     * @param string          $targetLocale  ISO 639-1 code (required)
     * @return array{translated_text:string,source_locale:string,target_locale:string,cached:bool}
     */
    public function translate(
        string $contentType,
        int|string $contentId,
        string $sourceText,
        ?string $sourceLocale,
        string $targetLocale,
    ): array {
        $sourceText = trim($sourceText);
        $targetLocale = strtolower(trim($targetLocale));
        $resolvedSource = $this->resolveSourceLocale($sourceLocale);

        // Empty / same-locale shortcut.
        if ($sourceText === '' || ($resolvedSource !== 'auto' && $resolvedSource === $targetLocale)) {
            return [
                'translated_text' => $sourceText,
                'source_locale'   => $resolvedSource,
                'target_locale'   => $targetLocale,
                'cached'          => false,
            ];
        }

        $key = self::cacheKey($sourceText, $resolvedSource, $targetLocale);
        $cached = Cache::get($key);
        if (is_string($cached) && $cached !== '') {
            return [
                'translated_text' => $cached,
                'source_locale'   => $resolvedSource,
                'target_locale'   => $targetLocale,
                'cached'          => true,
            ];
        }

        try {
            $translated = \App\Services\Translation\TranslationEngine::translate($sourceText, $resolvedSource, $targetLocale);
        } catch (\Throwable $e) {
            Log::warning('UgcTranslationService::translate failed', [
                'tenant_id'    => TenantContext::getId(),
                'content_type' => $contentType,
                'content_id'   => $contentId,
                'error'        => $e->getMessage(),
            ]);
            $translated = null;
        }

        if (!is_string($translated) || $translated === '') {
            // Fall back to source so callers always get a usable string.
            return [
                'translated_text' => $sourceText,
                'source_locale'   => $resolvedSource,
                'target_locale'   => $targetLocale,
                'cached'          => false,
            ];
        }

        Cache::put($key, $translated, self::CACHE_TTL);

        return [
            'translated_text' => $translated,
            'source_locale'   => $resolvedSource,
            'target_locale'   => $targetLocale,
            'cached'          => false,
        ];
    }

    /**
     * Pure cache read — returns null if no cached translation exists.
     *
     * @return array{translated_text:string,source_locale:string,target_locale:string,cached:true}|null
     */
    public function getCached(string $sourceText, ?string $sourceLocale, string $targetLocale): ?array
    {
        $sourceText = trim($sourceText);
        $targetLocale = strtolower(trim($targetLocale));
        $resolvedSource = $this->resolveSourceLocale($sourceLocale);

        if ($sourceText === '') {
            return null;
        }

        $key = self::cacheKey($sourceText, $resolvedSource, $targetLocale);
        $cached = Cache::get($key);
        if (!is_string($cached) || $cached === '') {
            return null;
        }

        return [
            'translated_text' => $cached,
            'source_locale'   => $resolvedSource,
            'target_locale'   => $targetLocale,
            'cached'          => true,
        ];
    }

    /**
     * Build the canonical cache key for a (text, source, target) tuple.
     */
    public static function cacheKey(string $sourceText, string $sourceLocale, string $targetLocale): string
    {
        return self::CACHE_PREFIX . hash('sha256', trim($sourceText) . ':' . $sourceLocale . ':' . $targetLocale);
    }

    /**
     * Resolve the source locale: the caller's value, otherwise 'auto'.
     *
     * Never the community's default language. Posts, listings and comments carry
     * no language of their own, and members write in whatever they speak: on AWID
     * (default "en") a Spanish post was taken to be English, matched an English
     * reader, and came back untranslated (owner, 30 Oct 2026). Both engines
     * detect the language themselves when told 'auto'.
     */
    private function resolveSourceLocale(?string $sourceLocale): string
    {
        $sourceLocale = $sourceLocale ? strtolower(trim($sourceLocale)) : '';

        return $sourceLocale !== '' ? $sourceLocale : 'auto';
    }
}
