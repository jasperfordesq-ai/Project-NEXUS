<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Http\Middleware\RequireRecentSecondFactor;
use App\Services\PlatformTeam\PlatformTeamMembershipService;
use App\Services\PlatformTeam\SeniorAccountsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Senior accounts: who can administer more than one
 * community, when each last signed in, and whether two-step is on. Since
 * 17 Nov 2026 (owner) it also adds an account to the platform team and
 * removes one from it.
 *
 * Platform team only (`is_god` AND super admin), twice over: the route group's
 * `platform-team` middleware and the check at the top of each method. Both
 * come before anything else, so an account with no right to be here is told
 * so, and is never asked for a code.
 *
 * 🔴 Adding and removing also need a second sign-in step entered recently
 * (the `step-up` route middleware, checked again here). The rules about who
 * can be added or removed are in PlatformTeamMembershipService.
 */
final class SeniorAccountsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/senior-accounts */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData((new SeniorAccountsService())->list());
    }

    /** POST /api/v2/platform-team/senior-accounts/{id}/add-to-team */
    public function addToTeam(string $id): JsonResponse
    {
        $actorId = $this->requireGodPlatformAdmin();

        $refused = $this->refuseWithoutRecentSecondStep();
        if ($refused !== null) {
            return $refused;
        }

        $outcome = (new PlatformTeamMembershipService())->add($actorId, (int) $id);
        if ($outcome === PlatformTeamMembershipService::DONE) {
            Log::info('[PlatformTeam] account added to the platform team', ['actor' => $actorId, 'target' => (int) $id]);

            return $this->respondWithData(['added' => true, 'user_id' => (int) $id]);
        }

        return $this->refusal($outcome);
    }

    /** POST /api/v2/platform-team/senior-accounts/{id}/remove-from-team */
    public function removeFromTeam(string $id): JsonResponse
    {
        $actorId = $this->requireGodPlatformAdmin();

        $refused = $this->refuseWithoutRecentSecondStep();
        if ($refused !== null) {
            return $refused;
        }

        $outcome = (new PlatformTeamMembershipService())->remove($actorId, (int) $id);
        if ($outcome === PlatformTeamMembershipService::DONE) {
            Log::info('[PlatformTeam] account removed from the platform team', ['actor' => $actorId, 'target' => (int) $id]);

            return $this->respondWithData(['removed' => true, 'user_id' => (int) $id]);
        }

        return $this->refusal($outcome);
    }

    /**
     * The route's step-up middleware already asked. Asked again here so the
     * act cannot lose its second step to a change in the route file. Then the
     * rate limit: after both locks, so a refused caller uses none of it.
     */
    private function refuseWithoutRecentSecondStep(): ?JsonResponse
    {
        if (!RequireRecentSecondFactor::passes(request())) {
            return $this->respondWithError(
                RequireRecentSecondFactor::ERROR_CODE,
                __('mfa.step_up_required'),
                'security_confirmation',
                403
            );
        }

        $this->rateLimit('platform_team_membership', PlatformTeamMembershipService::CHANGES_PER_MINUTE, 60);

        return null;
    }

    private function refusal(string $outcome): JsonResponse
    {
        if (in_array($outcome, PlatformTeamMembershipService::REFUSALS, true)) {
            // The page puts each of these into words from the code.
            return $this->respondWithError($outcome, __('api.validation_failed'), null, 422);
        }

        return match ($outcome) {
            PlatformTeamMembershipService::NOT_FOUND => $this->respondNotFound(),
            PlatformTeamMembershipService::CALLER_NOT_ON_TEAM => $this->respondWithError(
                'AUTH_INSUFFICIENT_PERMISSIONS',
                __('api.super_admin_required'),
                null,
                403
            ),
            default => $this->respondServerError(),
        };
    }
}
