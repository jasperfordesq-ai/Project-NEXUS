<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\ShiftGroupReservationService;
use Illuminate\Http\JsonResponse;

/**
 * Admin view of the group bookings in a community (8 Oct 2026). A group leader
 * reserves places on a shift and names members; until now admins could neither
 * see those bookings nor cancel one.
 *
 *   GET    /v2/admin/volunteering/group-reservations        list (q, status, page, per_page)
 *   DELETE /v2/admin/volunteering/group-reservations/{id}   cancel: releases the places
 *                                                           and every member's sign-up,
 *                                                           and tells the group
 */
class AdminVolunteerGroupReservationController extends BaseApiController
{
    private function featureOff(): ?JsonResponse
    {
        return TenantContext::hasFeature('volunteering')
            ? null
            : $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
    }

    public function index(): JsonResponse
    {
        $this->requireAdmin();
        if ($off = $this->featureOff()) {
            return $off;
        }
        $status = (string) $this->query('status', '');

        return $this->respondWithData(ShiftGroupReservationService::listForAdmin($this->getTenantId(), [
            'q' => (string) $this->query('q', ''),
            'status' => in_array($status, ['active', 'cancelled'], true) ? $status : '',
            'page' => $this->queryInt('page', 1, 1),
            'per_page' => $this->queryInt('per_page', 25, 1, 100),
        ]));
    }

    public function cancel(int $id): JsonResponse
    {
        $this->requireAdmin();
        if ($off = $this->featureOff()) {
            return $off;
        }
        $this->rateLimit('admin_vol_group_reservation_cancel', 30, 60);

        if (! ShiftGroupReservationService::cancelForAdmin($this->getTenantId(), $id, (int) $this->getUserId())) {
            $errors = ShiftGroupReservationService::getErrors();
            $code = (string) ($errors[0]['code'] ?? 'SERVER_ERROR');

            return $this->respondWithErrors($errors, $code === 'NOT_FOUND' ? 404 : 500);
        }

        return $this->respondWithData(['cancelled' => true]);
    }
}
