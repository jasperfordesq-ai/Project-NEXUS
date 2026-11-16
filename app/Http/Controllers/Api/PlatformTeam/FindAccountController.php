<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Http\Middleware\RequireRecentSecondFactor;
use App\Services\PlatformTeam\FindAccountService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Find an account, and sign it out everywhere.
 *
 * Platform team only (`is_god` AND super admin), twice over: the route group's
 * `platform-team` middleware and the check at the top of each method. Both
 * come before anything else, so an account with no right to be here is told
 * so, and is never asked for a code.
 *
 * 🔴 The email address arrives in the request body, never in the address of
 * the request, and is not written to any log or record.
 *
 * 🔴 Signing an account out also needs a second sign-in step entered recently
 * (the `step-up` route middleware, checked again here).
 *
 * 🔴 Nothing here changes a password, a role or anyone's access, and nothing
 * should be added that does.
 */
final class FindAccountController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(private readonly FindAccountService $accounts)
    {
    }

    /** POST /api/v2/platform-team/accounts/find  body: {email} */
    public function find(): JsonResponse
    {
        $actorId = $this->requireGodPlatformAdmin();
        $this->rateLimit('platform_team_account_lookup', FindAccountService::LOOKUPS_PER_MINUTE, 60);

        $email = FindAccountService::cleanEmail($this->getAllInput()['email'] ?? null);
        if ($email === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.validation_failed'), 'email', 422);
        }

        try {
            $result = $this->accounts->find($actorId, $email);
        } catch (\Throwable $e) {
            // 🔴 The address is deliberately not logged. Nor is the message:
            // a database error can quote the query's values.
            Log::error('Platform team: an account search could not be completed or recorded', [
                'actor' => $actorId,
                'exception' => $e::class,
            ]);

            return $this->respondServerError();
        }

        return $this->respondWithData($result);
    }

    /** POST /api/v2/platform-team/accounts/{id}/sign-out  body: {reason} */
    public function signOut(string $id): JsonResponse
    {
        $actorId = $this->requireGodPlatformAdmin();

        // The route's step-up middleware already asked. Asked again here so
        // the act cannot lose its second step to a change in the route file.
        if (!RequireRecentSecondFactor::passes(request())) {
            return $this->respondWithError(
                RequireRecentSecondFactor::ERROR_CODE,
                __('mfa.step_up_required'),
                'security_confirmation',
                403
            );
        }

        $this->rateLimit('platform_team_account_sign_out', FindAccountService::SIGN_OUTS_PER_MINUTE, 60);

        $reason = FindAccountService::cleanReason($this->getAllInput()['reason'] ?? null);
        if ($reason === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.validation_failed'), 'reason', 422);
        }

        $outcome = $this->accounts->signOut($actorId, (int) $id, $reason);
        if ($outcome === FindAccountService::DONE) {
            // Ids only. The reason is in the community's record, not in this log.
            Log::info('[PlatformTeam] account signed out everywhere', ['actor' => $actorId, 'target' => (int) $id]);

            return $this->respondWithData(['signed_out' => true]);
        }

        return $outcome === FindAccountService::NOT_FOUND
            ? $this->respondNotFound()
            : $this->respondServerError();
    }
}
