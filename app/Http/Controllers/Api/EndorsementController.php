<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use Illuminate\Http\JsonResponse;
use App\Services\EndorsementService;

/**
 * EndorsementController -- Member endorsement management.
 *
 * Native implementation using legacy EndorsementService static methods.
 * The endorse() method is kept as delegation because it sends email via Mailer.
 *
 * Endpoints:
 *   POST   /api/v2/members/{id}/endorse      endorse()
 *   DELETE /api/v2/members/{id}/endorse       removeEndorsement()
 *   GET    /api/v2/members/{id}/endorsements  getEndorsements()
 *   GET    /api/v2/members/top-endorsed       getTopEndorsed()
 */
class EndorsementController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EndorsementService $endorsementService,
    ) {}

    /**
     * POST /api/v2/members/{id}/endorse
     *
     * Endorse a member's skill.
     */
    public function endorse(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('endorse', 20, 60);

        $skillName = $this->input('skill_name', '');
        $skillId = $this->input('skill_id') ? (int) $this->input('skill_id') : null;
        $comment = $this->input('comment');

        try {
            $endorsementId = $this->endorsementService->endorse($userId, $id, $skillName, $skillId, $comment);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($endorsementId === null) {
            $errors = $this->endorsementService->getErrors();
            $status = 422;
            if (!empty($errors) && $errors[0]['code'] === 'ALREADY_ENDORSED') {
                $status = 409;
            }
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData([
            'endorsement_id' => $endorsementId,
            'message' => __('api_controllers_1.endorsement.endorsement_added'),
        ]);
    }

    /**
     * DELETE /api/v2/members/{id}/endorse
     *
     * Remove an endorsement.
     * Body or Query: { "skill_name": "Web Development" }
     */
    public function removeEndorsement(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $skillName = $this->input('skill_name') ?? $this->query('skill_name', '');

        if (empty($skillName)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.skill_name_required'), 'skill_name', 400);
        }

        // The endorsed member must belong to THIS community. A foreign or
        // missing id previously answered "removed" (CrossCommunityAccessSweepTest).
        $memberExists = \App\Models\User::query()
            ->whereKey($id)
            ->where('tenant_id', $this->getTenantId())
            ->exists();
        if (! $memberExists) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $this->endorsementService->removeEndorsement($userId, $id, $skillName);

        return $this->respondWithData(['message' => __('api_controllers_1.endorsement.endorsement_removed')]);
    }

    /**
     * GET /api/v2/members/{id}/endorsements
     *
     * Get endorsements for a member.
     * Query: ?skill_name=Web+Development (optional, for detailed view)
     */
    public function getEndorsements(int $id): JsonResponse
    {
        $this->rateLimit('endorsements_view', 30, 60);

        $skillName = $this->query('skill_name');
        $viewerId = $this->getOptionalUserId();

        if ($skillName) {
            // Detailed endorsements for one skill
            $endorsements = $this->endorsementService->getSkillEndorsements($id, $skillName);
            $data = [
                'skill_name' => $skillName,
                'endorsements' => $endorsements,
                'count' => count($endorsements),
            ];

            if ($viewerId) {
                $data['has_endorsed'] = $this->endorsementService->hasEndorsed($viewerId, $id, $skillName);
            }

            return $this->respondWithData($data);
        }

        // All endorsements grouped by skill
        $endorsements = $this->endorsementService->getEndorsementsForUser($id);
        $stats = $this->endorsementService->getStats($id);

        return $this->respondWithData([
            'endorsements' => $endorsements,
            'stats' => $stats,
        ]);
    }

    /**
     * GET /api/v2/members/top-endorsed
     *
     * Get top endorsed members in the tenant.
     * Query: ?limit=10 (default 10, max 50)
     */
    public function getTopEndorsed(): JsonResponse
    {
        $this->rateLimit('top_endorsed', 10, 60);

        $limit = $this->queryInt('limit', 10, 1, 50);
        $members = $this->endorsementService->getTopEndorsedMembers($limit);

        return $this->respondWithData($members);
    }

}
