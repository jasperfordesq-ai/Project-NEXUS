<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\FundraisingNotFoundException;
use App\Services\FundraisingHandoverService;
use App\Services\FundraisingHistoryService;
use App\Services\VolunteerDonationService;
use App\Services\VolunteerExpenseService;
use App\Services\VolunteerService;
use App\Support\UserDisplayName;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Fundraising on the organisation dashboard (owner decisions 5 Oct 2026):
 * an organisation's owners and admins run campaigns for their own organisation
 * with no approval step, see gifts without donor contact or Gift Aid details,
 * and confirm money the community has passed on. Everything is scoped to the
 * organisation in the URL; an organisation_id in the body is never read.
 */
class OrgFundraisingController extends BaseApiController
{
    private const EDITABLE = ['title', 'description', 'start_date', 'end_date', 'goal_amount', 'is_active'];

    private function guard(int $orgId): int
    {
        if (! TenantContext::hasFeature('volunteering')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.volunteering_feature_disabled'), null, 403));
        }
        $userId = $this->requireAuth();
        if (! VolunteerExpenseService::isOrganisationAdmin(TenantContext::getId(), $userId, $orgId)) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FORBIDDEN', __('fundraising.not_your_campaign'), null, 403));
        }
        return $userId;
    }

    private function ownCampaign(int $orgId, int $campaignId): bool
    {
        return DB::table('vol_giving_days')
            ->where('id', $campaignId)->where('tenant_id', TenantContext::getId())
            ->where('organization_id', $orgId)->exists();
    }

    private function notFound(): JsonResponse
    {
        return $this->respondWithError('NOT_FOUND', __('fundraising.campaign_not_found'), null, 404);
    }

    public function index($id): JsonResponse
    {
        $orgId = (int) $id;
        $this->guard($orgId);
        $items = array_values(array_filter(
            VolunteerDonationService::adminGetGivingDays(),
            fn (array $day) => (int) ($day['organization_id'] ?? 0) === $orgId,
        ));
        return $this->respondWithData(['items' => $items]);
    }

    public function store($id): JsonResponse
    {
        $orgId = (int) $id;
        $userId = $this->guard($orgId);
        $status = DB::table('vol_organizations')->where('id', $orgId)->where('tenant_id', TenantContext::getId())->value('status');
        if (! VolunteerService::isApprovedOrganizationStatus(is_string($status) ? $status : null)) {
            return $this->respondWithError('VALIDATION_ERROR', __('fundraising.organisation_not_eligible'), null, 422);
        }
        $data = array_intersect_key($this->getAllInput(), array_flip(self::EDITABLE));
        $data['organization_id'] = $orgId;
        $data['created_by'] = $userId;
        try {
            $created = VolunteerDonationService::createGivingDay($data, TenantContext::getId(), FundraisingHistoryService::ACTOR_ORG_ADMIN);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
        return $this->respondWithData($created, null, 201);
    }

    public function update($id, $campaignId): JsonResponse
    {
        $orgId = (int) $id;
        $userId = $this->guard($orgId);
        if (! $this->ownCampaign($orgId, (int) $campaignId)) {
            return $this->notFound();
        }
        $data = array_intersect_key($this->getAllInput(), array_flip(self::EDITABLE));
        try {
            $ok = VolunteerDonationService::updateGivingDay((int) $campaignId, $data, TenantContext::getId(), $userId, FundraisingHistoryService::ACTOR_ORG_ADMIN);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
        return $this->respondWithData(['success' => $ok]);
    }

    public function gifts($id, $campaignId): JsonResponse
    {
        $orgId = (int) $id;
        $this->guard($orgId);
        if (! $this->ownCampaign($orgId, (int) $campaignId)) {
            return $this->notFound();
        }
        // Deliberately narrow select: never donor_email, never gift_aid_* (D4).
        $tenantId = TenantContext::getId();
        $rows = DB::table('vol_donations')
            ->where('tenant_id', $tenantId)->where('giving_day_id', (int) $campaignId)
            ->orderByDesc('id')->limit(500)
            ->get(['id', 'user_id', 'amount', 'amount_refunded', 'currency', 'status', 'created_at', 'donor_name', 'is_anonymous', 'payment_method']);

        // Pledges never store donor_name, so a named (non-anonymous) gift
        // without one shows the member's display name instead of "Anonymous".
        $needNames = $rows->filter(fn ($d) => ! $d->is_anonymous && ! $d->donor_name && $d->user_id)
            ->pluck('user_id')->unique()->values()->all();
        $memberNames = $needNames === [] ? [] : DB::table('users')
            ->where('tenant_id', $tenantId)->whereIn('id', $needNames)
            ->get(['id', 'first_name', 'last_name', 'name', 'profile_type', 'organization_name'])
            ->mapWithKeys(fn ($u) => [(int) $u->id => UserDisplayName::resolve($u)])->all();

        $items = $rows->map(function ($d) use ($memberNames) {
            $name = null;
            if (! $d->is_anonymous) {
                $name = $d->donor_name ? (string) $d->donor_name : ($memberNames[(int) $d->user_id] ?? null);
            }

            return [
                'id' => (int) $d->id,
                'amount' => (float) $d->amount,
                'amount_refunded' => (float) ($d->amount_refunded ?? 0),
                'currency' => (string) $d->currency,
                'status' => (string) $d->status,
                'created_at' => (string) $d->created_at,
                'display_name' => $name !== '' ? $name : null,
                'payment_method' => $d->payment_method === 'stripe' ? 'card' : 'pledge',
            ];
        })->all();
        return $this->respondWithData(['items' => $items]);
    }

    public function history($id, $campaignId): JsonResponse
    {
        $orgId = (int) $id;
        $this->guard($orgId);
        if (! $this->ownCampaign($orgId, (int) $campaignId)) {
            return $this->notFound();
        }
        return $this->respondWithData(['items' => FundraisingHistoryService::forCampaign(TenantContext::getId(), (int) $campaignId, true)]);
    }

    public function handovers($id, $campaignId): JsonResponse
    {
        $orgId = (int) $id;
        $this->guard($orgId);
        if (! $this->ownCampaign($orgId, (int) $campaignId)) {
            return $this->notFound();
        }
        return $this->respondWithData(FundraisingHandoverService::listForCampaign(TenantContext::getId(), (int) $campaignId));
    }

    public function confirmHandover($id, $handoverId): JsonResponse
    {
        $orgId = (int) $id;
        $userId = $this->guard($orgId);
        try {
            return $this->respondWithData(FundraisingHandoverService::confirm(TenantContext::getId(), $orgId, (int) $handoverId, $userId));
        } catch (FundraisingNotFoundException $e) {
            return $this->respondWithError('NOT_FOUND', $e->getMessage(), null, 404);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }
}
