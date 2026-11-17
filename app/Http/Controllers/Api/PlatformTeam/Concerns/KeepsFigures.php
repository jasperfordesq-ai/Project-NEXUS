<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam\Concerns;

use App\Services\PlatformTeam\PlatformFiguresCache;
use Illuminate\Http\JsonResponse;

/**
 * The controller side of PlatformFiguresCache, for the six platform team
 * pages that count across every community: reads `?refresh=1`, limits
 * refreshes to six a minute per person (one limit shared by the six pages),
 * and answers with the kept or freshly worked-out figures.
 *
 * Call it after requireGodPlatformAdmin() and after any input check, so a
 * refused or invalid request never reaches the cache or the limit.
 */
trait KeepsFigures
{
    /** @param callable(): array<string, mixed> $compute */
    protected function keptFigures(string $key, callable $compute): JsonResponse
    {
        $refresh = PlatformFiguresCache::wantsRefresh($this->getAllInput()['refresh'] ?? null);
        if ($refresh) {
            $this->rateLimit('platform_team_figures_refresh', PlatformFiguresCache::REFRESHES_PER_MINUTE, 60);
        }

        return $this->respondWithData(app(PlatformFiguresCache::class)->remember($key, $refresh, $compute));
    }
}
