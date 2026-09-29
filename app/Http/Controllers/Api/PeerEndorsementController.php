<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Services\BlockUserService;
use App\Services\MemberVerificationBadgeService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\Members\MemberProfileVisibility;

/**
 * PeerEndorsementController -- Peer endorsements for verification badges.
 *
 * When a member accumulates enough peer endorsements (default: 3),
 * they automatically receive the 'peer_endorsed' verification badge.
 *
 * Endpoints:
 *   POST /api/v2/members/{id}/peer-endorse    endorse()
 */
class PeerEndorsementController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * Minimum number of peer endorsements required to auto-grant the badge.
     */
    private const ENDORSEMENT_THRESHOLD = 3;

    public function __construct(
        private readonly MemberVerificationBadgeService $badgeService,
    ) {}

    /**
     * POST /api/v2/members/{id}/peer-endorse
     *
     * Endorse a member as a peer. When the endorsed member reaches the
     * threshold (3 endorsements), they automatically receive the
     * 'peer_endorsed' verification badge.
     */
    public function endorse(int $id): JsonResponse
    {
        $endorserId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        $this->rateLimit('peer_endorse', 20, 60);

        // Prevent self-endorsement
        if ($endorserId === $id) {
            return $this->respondWithError('SELF_ENDORSEMENT', __('api.cannot_endorse_yourself'), null, 422);
        }

        // Verify the target user exists in the current tenant
        $targetUser = DB::table('users')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->select('id', 'first_name', 'last_name', 'profile_type', 'organization_name')
            ->first();

        if (!$targetUser) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        // F-271: this is a second endorsement path (it feeds the auto-granted
        // peer_endorsed badge), so it applies the same guards as the canonical
        // skill endorsement (EndorsementService::endorse): a block in either
        // direction stops it (F-070) and the safeguarding contact policy is
        // consulted. Block first, so a blocked member cannot probe the other
        // member's safeguarding settings. A profile the endorser may not see
        // (privacy_profile) is refused exactly as the profile route refuses it
        // (F-246), so a connections-only member cannot be endorsed by strangers.
        try {
            BlockUserService::assertNoBlockBetween($endorserId, $id);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (! MemberProfileVisibility::canView($id, $endorserId)) {
            return $this->respondWithError('PROFILE_PRIVATE', __('api.user_profile_private'), null, 404);
        }

        try {
            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $endorserId,
                $id,
                (int) $tenantId,
                'peer_endorsement',
            );
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        // Insert with INSERT IGNORE for idempotency (duplicate endorsements are silently ignored)
        DB::statement(
            'INSERT IGNORE INTO peer_endorsements (tenant_id, endorser_id, endorsed_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
            [$tenantId, $endorserId, $id]
        );

        // Count total endorsements for the endorsed user
        $endorsementCount = DB::table('peer_endorsements')
            ->where('tenant_id', $tenantId)
            ->where('endorsed_id', $id)
            ->count();

        // Auto-grant peer_endorsed badge if threshold reached
        $badgeGranted = false;
        if ($endorsementCount >= self::ENDORSEMENT_THRESHOLD) {
            // autoGrantBadge, not the admin grantBadge: a revoked badge stays
            // revoked, and the endorser is not recorded as the verifier (F-068).
            $badgeId = $this->badgeService->autoGrantBadge($id, 'peer_endorsed', 'Auto-granted: reached ' . $endorsementCount . ' peer endorsements');
            $badgeGranted = $badgeId !== null;
        }

        return $this->respondWithData([
            'endorsed_id' => $id,
            'endorsement_count' => $endorsementCount,
            'threshold' => self::ENDORSEMENT_THRESHOLD,
            'badge_granted' => $badgeGranted,
            'message' => __('api_controllers_2.peer_endorsement.recorded'),
        ]);
    }
}
