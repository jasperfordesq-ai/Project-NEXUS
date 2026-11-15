<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\Admin;

use App\Core\TenantContext;
use App\Http\Controllers\Api\BaseApiController;
use App\Services\CommunityGoalService;
use App\Services\CommunitySetupService;
use App\Services\RedisCache;
use Illuminate\Http\JsonResponse;

/**
 * "Make it yours" — the guided set-up page for a community's own admin
 * (warmth phase 6).
 *
 *   GET /v2/admin/community-setup[?suggestions=0]
 *   PUT /v2/admin/community-setup/founded
 *   PUT|DELETE /v2/admin/community-setup/goal   (warmth phase 6, D1)
 *
 * The GET only reads; the PUT saves the optional founded date, the one value
 * that lives on this page alone. Admins of the CURRENT community only: requireAdmin(), and the
 * answer is built from TenantContext::getId() alone, so there is no id to
 * tamper with. `suggestions=0` skips reading the logo file (the admin
 * dashboard's small card does not show suggested colours).
 */
class CommunitySetupController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly CommunitySetupService $service,
        private readonly RedisCache $redisCache,
    ) {
    }

    /** GET /v2/admin/community-setup */
    public function show(): JsonResponse
    {
        $this->requireAdmin();

        $tenantId = TenantContext::getId();
        $status = $this->service->status($tenantId, $this->queryBool('suggestions', true));
        // The shared goal (warmth phase 6, D1): optional, never one of the steps.
        $status['community_goal'] = CommunityGoalService::adminView($tenantId);

        return $this->respondWithData($status);
    }

    /**
     * PUT /v2/admin/community-setup/founded  { founded_on: "YYYY-MM-DD" | null }
     *
     * The community's optional founded date (warmth phase 6, D4): members see
     * "{community} is three this month" in the anniversary month. A real date
     * from 1900 up to today; null (or an empty string) removes it. Same
     * authorisation as the page itself: this community's admin only.
     */
    public function updateFounded(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();
        $raw = $input['founded_on'] ?? null;

        $foundedOn = null;
        if ($raw !== null && $raw !== '') {
            $foundedOn = CommunitySetupService::validFoundedOn($raw, now()->toDateString());
            if ($foundedOn === null) {
                return $this->respondWithError(
                    'VALIDATION_ERROR',
                    __('admin.community_setup.founded_invalid'),
                    'founded_on',
                    422,
                );
            }
        }

        $this->service->setFoundedOn($tenantId, $foundedOn);
        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['founded_on' => $foundedOn]);
    }

    // ------------------------------------------------------------------
    // The shared community goal (warmth phase 6, D1)
    // ------------------------------------------------------------------

    /**
     * PUT /v2/admin/community-setup/goal
     *   { title, metric: hours|exchanges|offers|events, target, starts_on, ends_on }
     *
     * Set or change the community's one shared goal. Members see the whole
     * community's progress on their dashboard (totals only). Same
     * authorisation as the page itself: this community's admin only.
     */
    public function updateGoal(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        [$goal, $badField] = CommunityGoalService::validate($this->getAllInput(), now()->toDateString());
        if ($goal === null) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('admin.community_setup.goal_' . $badField . '_invalid'),
                $badField,
                422,
            );
        }

        return $this->respondWithData(['community_goal' => CommunityGoalService::set($tenantId, $goal)]);
    }

    /**
     * DELETE /v2/admin/community-setup/goal
     *
     * End the goal now; it is kept, with its final count, as "What we've done
     * together". Ending when there is no goal changes nothing.
     */
    public function endGoal(): JsonResponse
    {
        $this->requireAdmin();
        CommunityGoalService::end(TenantContext::getId());

        return $this->respondWithData(['community_goal' => null]);
    }
}
