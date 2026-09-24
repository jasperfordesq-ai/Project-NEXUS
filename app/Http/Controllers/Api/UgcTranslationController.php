<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\AI\AiUsageGate;
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
        $this->rateLimit('ugc_translate', 30, 60);

        $data = $this->getAllInput();

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

        // Hard cap — protect against abuse / OpenAI cost runaway.
        if (strlen($sourceText) > 8000) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.text_too_long'),
                'source_text',
                422,
            );
        }

        // Surface a clear error when the platform / tenant has no AI provider
        // configured, instead of silently returning the original text or a
        // generic "Translation failed" toast.
        // E-035 F-164: a community that has switched AI off is treated the same
        // way — nothing is sent to the provider.
        if (empty(config('services.openai.api_key')) || !AiUsageGate::aiEnabled()) {
            // Status 422: 503 is intercepted by the frontend api client as
            // maintenance-mode and the body would be replaced with a generic
            // string before our message reaches the user.
            return $this->respondWithError(
                'AI_NOT_CONFIGURED',
                __('api.ai_not_configured'),
                null,
                422,
            );
        }

        // A cached translation costs nothing, so it does not spend AI budget.
        $cached = $this->ugcTranslationService->getCached($sourceText, $sourceLocale, $targetLocale);
        if ($cached !== null) {
            return $this->respondWithData($cached);
        }

        // E-035 F-164: reserve one slot of the member's AI budget before the provider call.
        $admission = AiUsageGate::admit($userId);
        if (!$admission['allowed']) {
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

        return $this->respondWithData($result);
    }
}
