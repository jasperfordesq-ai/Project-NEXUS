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
}
