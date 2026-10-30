<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Translation;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Google Cloud Translation, Basic edition (v2 REST API).
 *
 * The official, key-based service: the first 500,000 characters a month on a
 * Google Cloud billing account are free (Google's pricing page, checked 30 Oct
 * 2026), then it is charged per character. The keyless address Google's own
 * web page uses is NOT used: it is not an offered service and breaks Google's
 * terms.
 */
class GoogleTranslateClient
{
    private const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';

    /** Translated text, or null when Google refused or could not be reached. */
    public function translate(string $text, string $fromLanguage, string $toLanguage, string $apiKey): ?string
    {
        $payload = [
            'q' => $text,
            'target' => $this->languageCode($toLanguage),
            'format' => 'text',
        ];
        if ($fromLanguage !== '' && $fromLanguage !== 'auto') {
            $payload['source'] = $this->languageCode($fromLanguage);
        }

        try {
            $response = Http::asForm()
                ->timeout(15)
                ->post(self::ENDPOINT . '?key=' . rawurlencode($apiKey), $payload);
        } catch (\Throwable $e) {
            Log::warning('GoogleTranslateClient: request failed', ['error' => $e->getMessage()]);
            return null;
        }

        if (!$response->successful()) {
            // Google's error message names the problem (key invalid, API not
            // enabled, quota) but never echoes the key.
            Log::warning('GoogleTranslateClient: Google refused the translation', [
                'status' => $response->status(),
                'reason' => $response->json('error.message'),
            ]);
            return null;
        }

        $translated = $response->json('data.translations.0.translatedText');

        return is_string($translated) && $translated !== '' ? $translated : null;
    }

    /** "pt-BR" → "pt-BR", "en_GB" → "en-GB", "ja" → "ja". Google accepts both forms. */
    private function languageCode(string $code): string
    {
        return str_replace('_', '-', trim($code));
    }
}
