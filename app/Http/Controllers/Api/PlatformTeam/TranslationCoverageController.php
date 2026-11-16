<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\TranslationCoverageService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Translations: how much of the server's wording
 * (emails and messages, `lang/`) each language still lacks. Kept for an hour;
 * `?refresh=1` counts again.
 *
 * 🔴 One method, and it only reads wording files.
 */
final class TranslationCoverageController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/translation-coverage */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        $refresh = in_array($this->getAllInput()['refresh'] ?? null, ['1', 1, true], true);

        return $this->respondWithData(app(TranslationCoverageService::class)->report($refresh));
    }
}
