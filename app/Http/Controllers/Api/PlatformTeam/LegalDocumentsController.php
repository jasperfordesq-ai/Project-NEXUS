<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\LegalDocumentsService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Legal documents: per community, whether its terms,
 * privacy notice and other legal documents are published, and how many
 * members have not accepted the current version.
 *
 * 🔴 One method, and it only reads. Counts only: no person is named.
 */
final class LegalDocumentsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/legal-documents */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData(app(LegalDocumentsService::class)->overview());
    }
}
