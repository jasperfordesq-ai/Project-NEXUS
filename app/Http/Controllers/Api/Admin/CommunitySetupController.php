<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\Admin;

use App\Core\TenantContext;
use App\Http\Controllers\Api\BaseApiController;
use App\Services\CommunitySetupService;
use Illuminate\Http\JsonResponse;

/**
 * "Make it yours" — the guided set-up page for a community's own admin
 * (warmth phase 6).
 *
 *   GET /v2/admin/community-setup[?suggestions=0]
 *
 * Read-only. Admins of the CURRENT community only: requireAdmin(), and the
 * answer is built from TenantContext::getId() alone, so there is no id to
 * tamper with. `suggestions=0` skips reading the logo file (the admin
 * dashboard's small card does not show suggested colours).
 */
class CommunitySetupController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly CommunitySetupService $service,
    ) {
    }

    /** GET /v2/admin/community-setup */
    public function show(): JsonResponse
    {
        $this->requireAdmin();

        return $this->respondWithData(
            $this->service->status(TenantContext::getId(), $this->queryBool('suggestions', true)),
        );
    }
}
