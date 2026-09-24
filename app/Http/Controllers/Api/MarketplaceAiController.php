<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\Models\MarketplaceListing;
use App\Services\AI\AiUsageGate;
use App\Services\MarketplaceAiService;

/**
 * MarketplaceAiController — AI-powered marketplace endpoints.
 *
 * Provides AI auto-reply generation for sellers responding to buyer messages.
 */
class MarketplaceAiController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly MarketplaceAiService $aiService,
    ) {}

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('marketplace')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api_controllers_2.marketplace_ai.feature_disabled'), null, 403)
            );
        }
    }

    /**
     * POST /v2/marketplace/listings/{id}/auto-reply
     *
     * Generate an AI auto-reply for a seller based on a buyer's message.
     * Only the listing owner can use this endpoint.
     */
    public function autoReply(Request $request, int $id): JsonResponse
    {
        $this->ensureFeature();

        $userId = $request->user()?->id;
        if (!$userId) {
            return $this->respondWithError('UNAUTHORIZED', __('api_controllers_2.marketplace_ai.auth_required'), null, 401);
        }

        // Rate limit: 10 auto-replies per minute per user
        $this->rateLimit('marketplace_ai_reply', 10, 60);

        $listing = MarketplaceListing::query()->find($id);
        if (!$listing) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_2.marketplace_ai.listing_not_found'), null, 404);
        }

        // Only the listing owner can generate auto-replies
        if ($listing->user_id !== $userId) {
            return $this->respondWithError('FORBIDDEN', __('api_controllers_2.marketplace_ai.only_owner_auto_reply'), null, 403);
        }

        $data = $request->validate([
            'message' => 'required|string|min:5|max:2000',
        ]);

        // E-035 F-164: the community AI master switch and the member's AI budget.
        $admission = AiUsageGate::admit((int) $userId);
        if (!$admission['allowed']) {
            return AiUsageGate::isDisabled($admission)
                ? $this->respondWithError('FEATURE_DISABLED', __('api.ai_feature_disabled'), null, 403)
                : $this->respondWithError('RATE_LIMIT', __('api.ai_rate_limit'), null, 429);
        }

        try {
            $reply = $this->aiService->generateAutoReply($id, $data['message']);
            return $this->respondWithData(['reply' => $reply]);
        } catch (\Throwable $e) {
            Log::warning('[MarketplaceAiController] auto-reply generation failed', [
                'listing_id' => $id,
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);

            return $this->respondWithError(
                'AI_ERROR',
                __('api_controllers_2.marketplace_ai.generation_failed'),
                null,
                500
            );
        }
    }
}
