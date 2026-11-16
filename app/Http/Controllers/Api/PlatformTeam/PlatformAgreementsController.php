<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\PlatformAgreementService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Agreements and renewals: list, add, change and end
 * the agreements the platform has with communities and others.
 *
 *   GET  /v2/platform-team/agreements            index
 *   POST /v2/platform-team/agreements            store
 *   PUT  /v2/platform-team/agreements/{id}       update
 *   POST /v2/platform-team/agreements/{id}/end   end
 *
 * There is no delete: an agreement entered by mistake is ended.
 *
 * 🔴 Platform team only, twice over: the `platform-team` route middleware and
 * `requireGodPlatformAdmin()` first in every method. The rows hold an outside
 * contact's name and email, which no one else may read.
 */
final class PlatformAgreementsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData((new PlatformAgreementService())->overview());
    }

    public function store(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();

        $result = (new PlatformAgreementService())->create($userId, $this->getAllInput());
        if (isset($result['errors'])) {
            return $this->respondWithErrors($result['errors'], 422);
        }

        return $this->respondWithData(['agreement' => $result['agreement']], null, 201);
    }

    public function update(string $id): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();

        $result = (new PlatformAgreementService())->update((int) $id, $userId, $this->getAllInput());
        if (isset($result['error'])) {
            return $this->respondNotFound();
        }
        if (isset($result['errors'])) {
            return $this->respondWithErrors($result['errors'], 422);
        }

        return $this->respondWithData(['agreement' => $result['agreement']]);
    }

    public function end(string $id): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();

        $result = (new PlatformAgreementService())->end((int) $id, $userId);
        if (isset($result['error'])) {
            return $this->respondNotFound();
        }

        return $this->respondWithData(['agreement' => $result['agreement']]);
    }
}
