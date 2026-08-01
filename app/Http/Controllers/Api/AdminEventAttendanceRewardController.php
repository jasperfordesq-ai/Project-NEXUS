<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Models\Event;
use App\Services\EventCreditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Setting and reviewing an event's attendance reward.
 *
 * Deliberately a TENANT-ADMIN action rather than a field on the organiser's
 * event form: the reward is minted against the community, so deciding that an
 * event pays out is a funding decision the community makes, not something an
 * individual host sets for themselves. This is also the payer-consent step the
 * credit service's contract requires.
 */
class AdminEventAttendanceRewardController extends BaseApiController
{
    protected bool $isV2Api = true;

    private function ensureFeature(): void
    {
        if (! TenantContext::hasFeature('event_attendance_credits')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.event_attendance_rewards_disabled'), null, 403)
            );
        }
    }

    /**
     * PUT /api/v2/admin/events/{id}/attendance-reward
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $ceiling = round((float) config('events.attendance_credit_max', 2.0), 2);

        $validated = $request->validate([
            // null clears the reward, which is how an admin turns it off for
            // one event without touching the tenant-wide switch.
            'amount' => 'present|nullable|numeric|min:0|max:' . $ceiling,
        ]);

        $event = Event::query()->find($id);

        if ($event === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        $amount = $validated['amount'];
        $amount = ($amount === null || (float) $amount <= 0) ? null : round((float) $amount, 2);

        $event->forceFill(['attendance_credit_amount' => $amount])->save();

        return $this->respondWithData([
            'event_id' => (int) $event->getKey(),
            'attendance_credit_amount' => $amount,
            'ceiling' => $ceiling,
        ]);
    }

    /**
     * GET /api/v2/admin/events/{id}/attendance-reward
     *
     * Reports the configured amount alongside what has actually been paid, so
     * an admin can see the cost of a reward and spot failed claims that need
     * attention.
     */
    public function show(int $id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $event = Event::query()->find($id);

        if ($event === null) {
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        $tenantId = (int) TenantContext::getId();

        $claims = DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $tenantId)
            ->where('event_id', (int) $event->getKey())
            ->where('claim_type', EventCreditService::CLAIM_TYPE)
            ->groupBy('status')
            ->selectRaw('status, COUNT(*) AS claim_count, COALESCE(SUM(amount), 0) AS total_amount')
            ->get();

        return $this->respondWithData([
            'event_id' => (int) $event->getKey(),
            'attendance_credit_amount' => $event->attendance_credit_amount !== null
                ? round((float) $event->attendance_credit_amount, 2)
                : null,
            'ceiling' => round((float) config('events.attendance_credit_max', 2.0), 2),
            'mode' => (string) config('events.attendance_credit_mode', 'off'),
            'claims' => $claims->map(static fn ($row): array => [
                'status' => (string) $row->status,
                'count' => (int) $row->claim_count,
                'total_amount' => round((float) $row->total_amount, 2),
            ])->all(),
        ]);
    }

    /**
     * GET /api/v2/admin/events/attendance-claims
     *
     * Tenant-wide reward ledger — both reward and reversal claims — so an
     * admin can spot failed mints without knowing which event to look at.
     */
    public function claims(Request $request): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();
        $this->rateLimit('event_attendance_claims_list', 60, 60);

        $validated = $request->validate([
            'event_id' => 'sometimes|integer|min:1',
            'status' => 'sometimes|string|in:pending,completed,failed,reversed',
            'claim_type' => 'sometimes|string|in:' . EventCreditService::CLAIM_TYPE . ',' . EventCreditService::REVERSAL_CLAIM_TYPE,
            'from' => 'sometimes|date',
            'to' => 'sometimes|date',
            'page' => 'sometimes|integer|min:1',
            'per_page' => 'sometimes|integer|min:1|max:100',
        ]);

        $tenantId = (int) TenantContext::getId();

        $query = DB::table('event_attendance_credit_claims as c')
            ->leftJoin('events as e', static function ($join) use ($tenantId): void {
                $join->on('e.id', '=', 'c.event_id')->where('e.tenant_id', '=', $tenantId);
            })
            ->leftJoin('users as u', static function ($join) use ($tenantId): void {
                $join->on('u.id', '=', 'c.user_id')->where('u.tenant_id', '=', $tenantId);
            })
            ->where('c.tenant_id', $tenantId);

        if (isset($validated['event_id'])) {
            $query->where('c.event_id', (int) $validated['event_id']);
        }
        if (isset($validated['status'])) {
            $query->where('c.status', $validated['status']);
        }
        if (isset($validated['claim_type'])) {
            $query->where('c.claim_type', $validated['claim_type']);
        }
        if (isset($validated['from'])) {
            $query->where('c.created_at', '>=', $validated['from']);
        }
        if (isset($validated['to'])) {
            // Inclusive day: a bare date means "up to the end of that day".
            $query->where('c.created_at', '<=', $validated['to'] . ' 23:59:59');
        }

        $perPage = (int) ($validated['per_page'] ?? 25);
        $page = (int) ($validated['page'] ?? 1);
        $total = (int) (clone $query)->count();

        $rows = $query
            ->orderByDesc('c.created_at')
            ->orderByDesc('c.id')
            ->forPage($page, $perPage)
            ->get([
                'c.id',
                'c.event_id',
                'c.user_id',
                'c.claim_type',
                'c.amount',
                'c.status',
                'c.failure_code',
                'c.reversal_code',
                'c.transaction_id',
                'c.parent_claim_id',
                'c.created_at',
                'c.completed_at',
                'c.failed_at',
                'c.reversed_at',
                'e.title as event_title',
                'u.first_name',
                'u.last_name',
                'u.organization_name',
                'u.profile_type',
            ]);

        return $this->respondWithData([
            'claims' => $rows->map(static function ($row): array {
                $memberName = ((string) $row->profile_type === 'organisation' && $row->organization_name)
                    ? (string) $row->organization_name
                    : trim((string) $row->first_name . ' ' . (string) $row->last_name);

                return [
                    'id' => (int) $row->id,
                    'event_id' => (int) $row->event_id,
                    'event_title' => $row->event_title !== null ? (string) $row->event_title : null,
                    'user_id' => (int) $row->user_id,
                    'member_name' => $memberName !== '' ? $memberName : null,
                    'claim_type' => (string) $row->claim_type,
                    'amount' => round((float) $row->amount, 2),
                    'status' => (string) $row->status,
                    'failure_code' => $row->failure_code !== null ? (string) $row->failure_code : null,
                    'reversal_code' => $row->reversal_code !== null ? (string) $row->reversal_code : null,
                    'transaction_id' => $row->transaction_id !== null ? (int) $row->transaction_id : null,
                    'parent_claim_id' => $row->parent_claim_id !== null ? (int) $row->parent_claim_id : null,
                    'created_at' => (string) $row->created_at,
                    'completed_at' => $row->completed_at !== null ? (string) $row->completed_at : null,
                    'failed_at' => $row->failed_at !== null ? (string) $row->failed_at : null,
                    'reversed_at' => $row->reversed_at !== null ? (string) $row->reversed_at : null,
                ];
            })->all(),
            'pagination' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'total_pages' => (int) max(1, (int) ceil($total / $perPage)),
            ],
        ]);
    }

    /**
     * POST /api/v2/admin/events/attendance-claims/{claimId}/retry
     */
    public function retry(int $claimId): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();
        $this->rateLimit('event_attendance_claims_retry', 30, 60);

        $result = app(EventCreditService::class)->retryClaim((int) TenantContext::getId(), $claimId);

        return match ($result['status']) {
            'not_found' => $this->respondWithError('NOT_FOUND', __('api.event_attendance_claim_not_found'), null, 404),
            'not_retryable' => $this->respondWithError('CONFLICT', __('api.event_attendance_claim_not_retryable'), null, 409),
            default => $this->respondWithData($result),
        };
    }

    /**
     * POST /api/v2/admin/events/attendance-claims/{claimId}/reverse
     */
    public function reverse(Request $request, int $claimId): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();
        $this->rateLimit('event_attendance_claims_reverse', 30, 60);

        $validated = $request->validate([
            'reason' => 'required|string|min:3|max:200',
        ]);

        $result = app(EventCreditService::class)->reverseClaim(
            (int) TenantContext::getId(),
            $claimId,
            (int) $this->requireAuth(),
            $validated['reason'],
        );

        return match ($result['status']) {
            'not_found' => $this->respondWithError('NOT_FOUND', __('api.event_attendance_claim_not_found'), null, 404),
            'not_reversible' => $this->respondWithError('CONFLICT', __('api.event_attendance_claim_not_reversible'), null, 409),
            default => $this->respondWithData($result),
        };
    }
}
