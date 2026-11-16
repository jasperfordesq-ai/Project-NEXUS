<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\PlatformNoticeService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Notices: write, change and end the notices every
 * community's admins see.
 *
 *   GET  /v2/platform-team/notices            index
 *   POST /v2/platform-team/notices            store
 *   PUT  /v2/platform-team/notices/{id}       update
 *   POST /v2/platform-team/notices/{id}/end   end
 *
 * 🔴 Platform team only, twice over: the `platform-team` route middleware and
 * `requireGodPlatformAdmin()` first in every method. What an admin reads is a
 * different controller (Api\Admin\PlatformNoticeController).
 */
final class PlatformNoticesController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData(['notices' => (new PlatformNoticeService())->listAll()]);
    }

    public function store(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();

        $result = (new PlatformNoticeService())->create($userId, $this->getAllInput());
        if (isset($result['errors'])) {
            return $this->respondWithErrors($result['errors'], 422);
        }

        return $this->respondWithData(['notice' => $result['notice']], null, 201);
    }

    public function update(string $id): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();

        $result = (new PlatformNoticeService())->update((int) $id, $userId, $this->getAllInput());
        if (isset($result['error'])) {
            return $this->respondNotFound();
        }
        if (isset($result['errors'])) {
            return $this->respondWithErrors($result['errors'], 422);
        }

        return $this->respondWithData(['notice' => $result['notice']]);
    }

    public function end(string $id): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();

        $result = (new PlatformNoticeService())->end((int) $id, $userId);
        if (isset($result['error'])) {
            return $this->respondNotFound();
        }

        return $this->respondWithData(['notice' => $result['notice']]);
    }
}
