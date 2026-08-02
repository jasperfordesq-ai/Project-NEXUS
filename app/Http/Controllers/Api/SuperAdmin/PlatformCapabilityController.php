<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformCapabilityService;
use Illuminate\Http\JsonResponse;

/**
 * Platform rollout switches, for the platform owner.
 *
 * These are deliberately NOT tenant-admin endpoints: they set the ceiling every
 * community sits under, so they require platform super-admin. A tenant
 * administrator still controls their own community's switches on the events
 * settings screen, and can never exceed what is set here.
 */
final class PlatformCapabilityController extends BaseApiController
{
    public function __construct(private readonly PlatformCapabilityService $capabilities)
    {
    }

    public function index(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        return $this->respondWithData([
            'capabilities' => $this->capabilities->inspect(),
        ]);
    }

    public function update(): JsonResponse
    {
        $actorId = $this->requirePlatformSuperAdmin();
        $this->rateLimit('platform_capability_update', 20, 60);

        $input = $this->getJsonInput();
        $capability = is_string($input['capability'] ?? null) ? trim($input['capability']) : '';
        $reason = is_string($input['reason'] ?? null) ? $input['reason'] : null;

        if ($capability === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'capability', 422);
        }

        // Clearing an override hands the decision back to the environment —
        // always available as the way back out of any change made here.
        if (($input['clear'] ?? false) === true) {
            if (! $this->capabilities->clear($capability)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'capability', 422);
            }

            return $this->respondWithData(['capabilities' => $this->capabilities->inspect()]);
        }

        $value = $input['value'] ?? null;
        // Accept a real boolean from the UI switch as well as the stored string
        // form, so the client does not have to know the storage encoding.
        if (is_bool($value)) {
            $value = $value ? '1' : '0';
        }
        if (! is_string($value) || $value === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'value', 422);
        }

        if (! $this->capabilities->set($capability, $value, $actorId, $reason)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'value', 422);
        }

        return $this->respondWithData(['capabilities' => $this->capabilities->inspect()]);
    }
}
