<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\Admin;

use App\Core\ApiErrorCodes;
use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\PlatformNoticeService;
use Illuminate\Http\JsonResponse;

/**
 * Platform-wide notices, as an admin reads them (Nov 2026).
 *
 *   GET  /v2/admin/platform-notices                 current
 *   POST /v2/admin/platform-notices/{id}/dismiss    dismiss
 *
 * Anyone who passes `requireAdmin()`: a community's admin, a tenant super
 * admin, a global super admin, the platform team. 🔴 Not brokers and not
 * members (owner, 16 Nov 2026).
 *
 * 🔴 Not scoped to a community, on purpose: a platform notice is the same in
 * every community. An admin is sent only what the band shows; who wrote the
 * notice stays with the platform team (Api\PlatformTeam\PlatformNoticesController).
 */
final class PlatformNoticeController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function current(): JsonResponse
    {
        $userId = $this->requireAdmin();

        return $this->respondWithData(['notices' => (new PlatformNoticeService())->currentFor($userId)]);
    }

    public function dismiss(string $id): JsonResponse
    {
        $userId = $this->requireAdmin();

        return match ((new PlatformNoticeService())->dismiss((int) $id, $userId)) {
            'not_found' => $this->respondNotFound(),
            'not_dismissible' => $this->respondWithError(
                ApiErrorCodes::VALIDATION_INVALID_VALUE,
                __('api.site_announcement_flag_invalid'),
                null,
                422,
            ),
            default => $this->respondWithData(['ok' => true]),
        };
    }
}
