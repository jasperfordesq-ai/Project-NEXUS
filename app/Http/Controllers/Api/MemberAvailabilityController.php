<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Services\MemberAvailabilityService;

/**
 * MemberAvailabilityController -- Member availability slots.
 *
 * Converted from legacy delegation to direct static service calls.
 */
class MemberAvailabilityController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly MemberAvailabilityService $memberAvailabilityService,
    ) {}

    /** GET /api/v2/users/me/availability */
    public function getMyAvailability(): JsonResponse
    {
        $userId = $this->requireAuth();

        $availability = $this->memberAvailabilityService->getUserAvailability($userId);

        return $this->respondWithData(['weekly' => $availability]);
    }

    /** PUT /api/v2/users/me/availability */
    public function setBulkAvailability(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('availability_update', 10, 60);

        $data = $this->getAllInput();
        $schedule = $data['schedule'] ?? $data['slots'] ?? null;

        if ($schedule === null || !is_array($schedule)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.schedule_required_array'), 'schedule', 422);
        }

        $success = $this->memberAvailabilityService->setBulkAvailability($userId, $schedule);

        if (!$success) {
            return $this->respondWithErrors($this->memberAvailabilityService->getErrors(), 422);
        }

        $availability = $this->memberAvailabilityService->getUserAvailability($userId);

        return $this->respondWithData(['weekly' => $availability]);
    }

    /** PUT /api/v2/users/me/availability/{day} */
    public function setDayAvailability(int $day): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('availability_update', 10, 60);

        $data = $this->getAllInput();
        $slots = $data['slots'] ?? [];

        $success = $this->memberAvailabilityService->setDayAvailability($userId, $day, $slots);

        if (!$success) {
            return $this->respondWithErrors($this->memberAvailabilityService->getErrors(), 422);
        }

        $availability = $this->memberAvailabilityService->getUserAvailability($userId);

        return $this->respondWithData(['weekly' => $availability]);
    }

    /** POST /api/v2/users/me/availability/date */
    public function addSpecificDate(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('availability_add_date', 10, 60);

        $data = $this->getAllInput();
        $slotId = $this->memberAvailabilityService->addSpecificDate($userId, $data);

        if ($slotId === null) {
            return $this->respondWithErrors($this->memberAvailabilityService->getErrors(), 422);
        }

        $availability = $this->memberAvailabilityService->getUserAvailability($userId);

        return $this->respondWithData(['weekly' => $availability], null, 201);
    }

    /** DELETE /api/v2/users/me/availability/{id} */
    public function deleteSlot(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        // deleteSlot() is scoped to the caller's own rows, so a foreign or
        // missing id deletes nothing. It previously still answered "deleted"
        // (CrossCommunityAccessSweepTest).
        if (! $this->memberAvailabilityService->deleteSlot($userId, $id)) {
            return $this->respondWithError('NOT_FOUND', __('api.resource_not_found'), null, 404);
        }

        return $this->respondWithData(['message' => __('api_controllers_2.member_availability.slot_deleted')]);
    }

    /** GET /api/v2/users/{id}/availability */
    public function getUserAvailability(int $id): JsonResponse
    {
        $this->rateLimit('availability_view', 30, 60);

        $availability = $this->memberAvailabilityService->getUserAvailability($id);

        return $this->respondWithData(['weekly' => $availability]);
    }

    /** GET /api/v2/members/availability/compatible */
    public function findCompatibleTimes(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('availability_compatible', 20, 60);

        $otherUserId = $this->queryInt('user_id');
        if (!$otherUserId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'user_id']), 'user_id', 400);
        }

        $compatible = $this->memberAvailabilityService->findCompatibleTimes($userId, $otherUserId);

        return $this->respondWithData($compatible);
    }

    /** GET /api/v2/members/availability/available */
    public function getAvailableMembers(): JsonResponse
    {
        $this->rateLimit('availability_search', 20, 60);

        $day = $this->queryInt('day');
        if ($day === null) {
            // Default to current day of week (0=Sunday, 6=Saturday)
            $day = (int) date('w');
        }
        if ($day < 0 || $day > 6) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.day_range_0_6'), 'day', 422);
        }

        $time = $this->query('time');
        $limit = $this->queryInt('limit', 50, 1, 100);

        $members = $this->memberAvailabilityService->getAvailableMembers($day, $time, $limit);

        return $this->respondWithData($members);
    }
}
