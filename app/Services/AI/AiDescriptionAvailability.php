<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI;

use App\Core\TenantContext;
use App\Models\AiSettings;
use App\Services\JobConfigurationService;
use App\Services\ListingConfigurationService;
use Illuminate\Support\Facades\Log;

/**
 * Whether the current community may use the "Generate description" buttons
 * (listings, jobs, marketplace).
 *
 * Owner decision, 8 Nov 2026: a button is offered — and the server accepts the
 * request — only when ALL of these hold:
 *  1. the community's AI is switched on (Admin › AI settings, `ai_enabled`);
 *  2. "Content generation" is switched on (Admin › AI settings,
 *     `ai_content_gen_enabled`);
 *  3. for listings and jobs, that area's own "AI description generation"
 *     switch is on (Module configuration). Marketplace has no switch of its
 *     own, so Content generation governs it;
 *  4. the community has saved its own OpenAI key — the platform key is never
 *     used ({@see CommunityOpenAiKey}); and
 *  5. OpenAI has not refused that key (wrong key, or no credit) in the last
 *     {@see CommunityOpenAiKey::REFUSAL_HOLD_HOURS} hours.
 *
 * Every switch is off until an administrator turns it on. The web apps read the
 * result from the tenant bootstrap (`ai_descriptions`); the endpoints check it
 * again, so a hidden button cannot be pressed by calling the API directly.
 */
final class AiDescriptionAvailability
{
    public const LISTINGS = 'listings';
    public const JOBS = 'jobs';
    public const MARKETPLACE = 'marketplace';

    public const CONTENT_GENERATION_SETTING = 'ai_content_gen_enabled';

    /** @return array{listings: bool, jobs: bool, marketplace: bool} */
    public static function forCurrentCommunity(): array
    {
        $community = self::communityCanGenerate();

        return [
            self::LISTINGS => $community && self::areaSwitchOn(self::LISTINGS),
            self::JOBS => $community && self::areaSwitchOn(self::JOBS),
            self::MARKETPLACE => $community && self::areaSwitchOn(self::MARKETPLACE),
        ];
    }

    public static function isAvailable(string $area): bool
    {
        return self::communityCanGenerate() && self::areaSwitchOn($area);
    }

    /** Conditions 1, 2, 4 and 5: the ones shared by every area. */
    private static function communityCanGenerate(): bool
    {
        $tenantId = (int) (TenantContext::getId() ?? 0);
        if ($tenantId <= 0) {
            return false;
        }

        try {
            return AiUsageGate::aiEnabled()
                && AiSettings::parseBoolean(AiSettings::get($tenantId, self::CONTENT_GENERATION_SETTING))
                && CommunityOpenAiKey::get($tenantId) !== null
                && !CommunityOpenAiKey::recentlyRefused($tenantId);
        } catch (\Throwable $e) {
            // Hidden is the safe answer; the error is logged, not swallowed.
            Log::error('AiDescriptionAvailability: could not read AI settings; buttons hidden', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    private static function areaSwitchOn(string $area): bool
    {
        $value = match ($area) {
            self::LISTINGS => ListingConfigurationService::get(ListingConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS),
            self::JOBS => JobConfigurationService::get(JobConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS),
            self::MARKETPLACE => true,
            default => false,
        };

        return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) === true;
    }
}
