<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Http\Middleware\RequireRecentSecondFactor;
use App\Services\PlatformTeam\AccessReviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Access review: go through the senior accounts and
 * record "keep" or "should be removed" for each.
 *
 * Platform team only (`is_god` AND super admin), twice over: the route group's
 * `platform-team` middleware and the check at the top of each method. Both
 * come before anything else, so an account with no right to be here is told
 * so, and is never asked for a code.
 *
 * 🔴 Recording a review also needs a second sign-in step entered recently
 * (the `step-up` route middleware, checked again here).
 *
 * 🔴 Recording a review changes nobody's access, and nothing should be added
 * here that does.
 */
final class AccessReviewController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const RECORDS_PER_MINUTE = 10;

    public function __construct(private readonly AccessReviewService $reviews)
    {
    }

    /** GET /api/v2/platform-team/access-review */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData($this->reviews->overview());
    }

    /** POST /api/v2/platform-team/access-review  body: {decisions: [{user_id, decision}], note?} */
    public function store(): JsonResponse
    {
        $actorId = $this->requireGodPlatformAdmin();

        // The route's step-up middleware already asked. Asked again here so
        // the record cannot lose its second step to a change in the route file.
        if (!RequireRecentSecondFactor::passes(request())) {
            return $this->respondWithError(
                RequireRecentSecondFactor::ERROR_CODE,
                __('mfa.step_up_required'),
                'security_confirmation',
                403
            );
        }

        $this->rateLimit('platform_team_access_review', self::RECORDS_PER_MINUTE, 60);

        $input = $this->getAllInput();
        $decisions = AccessReviewService::cleanDecisions($input['decisions'] ?? null);
        if ($decisions === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.validation_failed'), 'decisions', 422);
        }
        $note = AccessReviewService::cleanNote($input['note'] ?? null);
        if ($note === false) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.validation_failed'), 'note', 422);
        }

        $outcome = $this->reviews->record($actorId, $decisions, $note);
        if ($outcome === AccessReviewService::LIST_CHANGED) {
            return $this->respondWithError(
                'ACCESS_REVIEW_LIST_CHANGED',
                __('api.platform_access_review_list_changed'),
                'decisions',
                422
            );
        }
        if ($outcome !== AccessReviewService::DONE) {
            return $this->respondServerError();
        }

        // Ids and counts only. The note stays in the record, not in this log.
        Log::info('[PlatformTeam] access review recorded', ['actor' => $actorId, 'accounts' => count($decisions)]);

        return $this->respondWithData($this->reviews->overview());
    }
}
