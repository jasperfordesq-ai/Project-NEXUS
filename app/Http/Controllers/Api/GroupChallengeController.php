<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Models\Group;
use App\Services\GroupAccessService;
use App\Services\GroupChallengeService;
use App\Services\GroupConfigurationService;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use InvalidArgumentException;

final class GroupChallengeController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function index(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }
        if ($disabled = $this->disabledResponse()) {
            return $disabled;
        }
        if (! $this->groupExists($id)) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }
        if (! GroupAccessService::canViewMemberContent($id, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.group_challenges_forbidden'), null, 403);
        }

        $showAll = $this->query('all') === '1';
        $challenges = $showAll
            ? GroupChallengeService::getAll($id, $this->queryInt('limit', 20, 1, 100))
            : GroupChallengeService::getActive($id);

        return $this->successResponse($challenges);
    }

    public function store(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }
        if ($disabled = $this->disabledResponse()) {
            return $disabled;
        }
        if (! $this->groupExists($id)) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }
        if (
            ! GroupAccessService::canManage($id, $userId)
            || ! GroupAccessService::canWriteContent($id, $userId)
        ) {
            return $this->respondWithError('FORBIDDEN', __('api.group_admin_required'), null, 403);
        }

        $data = request()->only([
            'title',
            'description',
            'metric',
            'target_value',
            'reward_xp',
            'reward_badge',
            'starts_at',
            'ends_at',
            'end_date',
        ]);
        $data['idempotency_key'] = request()->header('Idempotency-Key') ?? request()->input('idempotency_key');

        try {
            $challenge = GroupChallengeService::create($id, $userId, $data);
        } catch (InvalidArgumentException $e) {
            return $this->validationErrorResponse($e);
        } catch (AuthorizationException) {
            return $this->respondWithError('FORBIDDEN', __('api.group_admin_required'), null, 403);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (DomainException $e) {
            if ($e->getMessage() === GroupChallengeService::ERROR_IDEMPOTENCY_CONFLICT) {
                return $this->respondWithError(
                    'IDEMPOTENCY_CONFLICT',
                    __('event_registration.idempotency_conflict'),
                    null,
                    409,
                );
            }
            if ($e->getMessage() !== GroupChallengeService::ERROR_ACTIVE_LIMIT) {
                throw $e;
            }

            return $this->respondWithError(
                GroupChallengeService::ERROR_ACTIVE_LIMIT,
                __('api.group_challenge_active_limit', ['max' => GroupChallengeService::MAX_ACTIVE_CHALLENGES]),
                null,
                422,
            );
        }

        return $this->successResponse($challenge, 201);
    }

    public function destroy(int $id, int $challengeId): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }
        if ($disabled = $this->disabledResponse()) {
            return $disabled;
        }
        if (! $this->groupExists($id)) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }
        if (
            ! GroupAccessService::canManage($id, $userId)
            || ! GroupAccessService::canWriteContent($id, $userId)
        ) {
            return $this->respondWithError('FORBIDDEN', __('api.group_admin_required'), null, 403);
        }

        try {
            $result = GroupChallengeService::delete($id, $challengeId, $userId);
        } catch (AuthorizationException) {
            return $this->respondWithError('FORBIDDEN', __('api.group_admin_required'), null, 403);
        } catch (DomainException $e) {
            if ($e->getMessage() === GroupChallengeService::ERROR_IMMUTABLE) {
                return $this->respondWithError(
                    GroupChallengeService::ERROR_IMMUTABLE,
                    __('api_controllers_1.group_challenge.challenge_immutable'),
                    null,
                    409,
                );
            }

            throw $e;
        }

        return $result !== null
            ? $this->successResponse([
                ...$result,
                'message' => __('api_controllers_1.group_challenge.challenge_cancelled'),
            ])
            : $this->respondWithError('NOT_FOUND', __('api.group_challenge_not_found'), null, 404);
    }

    private function disabledResponse(): JsonResponse|null
    {
        if ((bool) GroupConfigurationService::get(GroupConfigurationService::CONFIG_TAB_CHALLENGES, true)) {
            return null;
        }

        return $this->respondWithError('FEATURE_DISABLED', __('api.feature_disabled'), null, 403);
    }

    private function groupExists(int $groupId): bool
    {
        return Group::query()->whereKey($groupId)->exists();
    }

    private function validationErrorResponse(InvalidArgumentException $exception): JsonResponse
    {
        [$translationKey, $field, $parameters] = match ($exception->getMessage()) {
            GroupChallengeService::ERROR_REQUIRED => ['api.group_challenge_required_fields', null, []],
            GroupChallengeService::ERROR_TITLE_LENGTH => ['api.invalid_input', 'title', []],
            GroupChallengeService::ERROR_DESCRIPTION_LENGTH => ['api.invalid_input', 'description', []],
            GroupChallengeService::ERROR_METRIC => ['api.invalid_input', 'metric', []],
            GroupChallengeService::ERROR_TARGET => [
                'api.value_out_of_range',
                'target_value',
                ['min' => GroupChallengeService::TARGET_MIN, 'max' => GroupChallengeService::TARGET_MAX],
            ],
            GroupChallengeService::ERROR_REWARD => ['api.invalid_input', 'reward_xp', []],
            GroupChallengeService::ERROR_DATES => ['api.invalid_date', 'ends_at', []],
            GroupChallengeService::ERROR_IDEMPOTENCY_INVALID => ['event_registration.idempotency_invalid', null, []],
            default => ['api.validation_failed', null, []],
        };

        return $this->respondWithError(
            'VALIDATION_ERROR',
            __($translationKey, $parameters),
            $field,
            422,
        );
    }
}
