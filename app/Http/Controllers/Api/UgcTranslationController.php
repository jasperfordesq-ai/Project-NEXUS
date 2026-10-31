<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\AI\AiUsageGate;
use App\Services\TranslationConfigurationService;
use App\Services\Translation\TranslationEngine;
use App\Services\UgcTranslationService;
use Illuminate\Http\JsonResponse;

/**
 * AG38 — POST /api/v2/ugc-translate
 *
 * Translates a piece of UGC text on demand and caches the result so
 * repeat requests for the same (text, source, target) tuple are free.
 */
class UgcTranslationController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly UgcTranslationService $ugcTranslationService,
    ) {}

    /**
     * POST /api/v2/ugc-translate
     *
     * Body: {
     *   content_type: string,
     *   content_id: int|string,
     *   source_text: string,
     *   source_locale?: string,
     *   target_locale: string
     * }
     */
    public function translate(): JsonResponse
    {
        $userId = $this->requireAuth();
        $data = $this->getAllInput();
        // Automatic display reads existing translations only: it must never
        // consume provider quota or require a configured provider.
        $cacheOnly = ($data['cache_only'] ?? false) === true;
        $this->rateLimit($cacheOnly ? 'ugc_translate_cache' : 'ugc_translate', $cacheOnly ? 300 : 30, 60);

        $contentType = (string) ($data['content_type'] ?? '');
        $contentId = $data['content_id'] ?? null;
        $sourceText = (string) ($data['source_text'] ?? '');
        $sourceLocale = isset($data['source_locale']) && is_string($data['source_locale'])
            ? $data['source_locale']
            : null;
        $targetLocale = (string) ($data['target_locale'] ?? '');

        if ($contentType === '' || $contentId === null || $sourceText === '' || $targetLocale === '') {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.missing_required_field', ['field' => 'content_type|content_id|source_text|target_locale']),
                null,
                422,
            );
        }

        // The community's "Enable translation" switch (Admin → Translation settings).
        if (!TranslationConfigurationService::isEnabled()) {
            return $this->respondWithError('TRANSLATION_DISABLED', __('api.translation_switched_off'), null, 403);
        }

        // Hard cap — protect against abuse / OpenAI cost runaway.
        if (strlen($sourceText) > 8000) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.text_too_long'),
                'source_text',
                422,
            );
        }

        $cached = $this->ugcTranslationService->getCached($sourceText, $sourceLocale, $targetLocale);
        if ($cacheOnly || $cached !== null) {
            return $this->respondWithData($cached);
        }

        // Google Translate by default, or the community's own AI
        // (TranslationEngine, owner 30 Oct 2026). Nothing available — no Google
        // key anywhere and no usable AI — is a set-up problem, not a failure to
        // retry. Status 422: 503 is intercepted by the frontend api client as
        // maintenance-mode and the body would be replaced with a generic string.
        if (!TranslationEngine::available()) {
            return $this->respondWithError('TRANSLATION_NOT_SET_UP', __('api.translation_not_set_up'), null, 422);
        }

        // The community's per-member hourly limit, counted only for real provider calls.
        if (!TranslationConfigurationService::admitHourly($userId)) {
            return $this->respondWithError('TRANSLATION_HOURLY_LIMIT', __('api.translation_hourly_limit'), null, 429);
        }

        // E-035 F-164: AI translation spends the member's AI budget; Google does not.
        $admission = TranslationEngine::usesAi() ? AiUsageGate::admit($userId) : ['allowed' => true];
        if (!$admission['allowed']) {
            if (($admission['reason'] ?? null) === AiUsageGate::REASON_NO_MEMBER) {
                // Not the community's switch, so not the community admin's to fix.
                return $this->respondWithError('AI_UNAVAILABLE', __('api.ai_translation_unavailable'), null, 422);
            }
            return AiUsageGate::isDisabled($admission)
                ? $this->respondWithError('AI_NOT_CONFIGURED', __('api.ai_not_configured'), null, 422)
                : $this->respondWithError('RATE_LIMIT', __('api.ai_rate_limit'), null, 429);
        }

        $result = $this->ugcTranslationService->translate(
            $contentType,
            is_int($contentId) ? $contentId : (string) $contentId,
            $sourceText,
            $sourceLocale,
            $targetLocale,
        );

        // Google refused (bad key, quota) or was unreachable. Saying so lets the
        // button stay on "Translate" and show the error, instead of claiming a
        // translation over the original words. 422, not 503: see above.
        if ($result['failed'] ?? false) {
            return $this->respondWithError('TRANSLATION_FAILED', __('api.message_translation_failed'), null, 422);
        }

        return $this->respondWithData($result);
    }
}
