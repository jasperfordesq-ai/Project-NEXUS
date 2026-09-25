<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Services\GroupExchangeService;
use App\Services\MessageService;

/**
 * GroupExchangeController -- Group time exchanges.
 *
 * Converted from legacy delegation to direct static service calls.
 */
class GroupExchangeController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly GroupExchangeService $groupExchangeService,
    ) {}

    /** GET /api/v2/group-exchanges */
    public function index(): JsonResponse
    {
        $userId = $this->requireAuth();

        $filters = [
            'status' => $this->query('status'),
            'limit' => $this->queryInt('limit', 20, 1, 100),
            'offset' => $this->queryInt('offset', 0, 0),
        ];

        $result = $this->groupExchangeService->listForUser($userId, $filters);

        // The collection MUST be the top-level `data` array (not nested under a
        // second `data` key) — the React client unwraps one level, so a nested
        // envelope makes every list read as empty. has_more travels in meta.
        return $this->respondWithData($result['items'], [
            'has_more' => $result['has_more'],
        ]);
    }

    /** POST /api/v2/group-exchanges */
    public function store(): JsonResponse
    {
        $userId = $this->requireAuth();

        $data = $this->getAllInput();

        $headerKey = request()->header('Idempotency-Key');
        $bodyKey = $data['idempotency_key'] ?? null;
        if (($headerKey !== null && ! is_string($headerKey))
            || ($bodyKey !== null && ! is_string($bodyKey))
            || ($headerKey !== null && $bodyKey !== null
                && ! hash_equals(trim($headerKey), trim($bodyKey)))) {
            return $this->respondWithError(
                'IDEMPOTENCY_INVALID',
                __('event_registration.idempotency_invalid'),
                'idempotency_key',
                422,
            );
        }
        if (is_string($headerKey) && trim($headerKey) !== '') {
            $data['idempotency_key'] = trim($headerKey);
        }

        if (empty($data['title'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.title_required'), 'title', 400);
        }

        if (empty($data['total_hours']) || (float) $data['total_hours'] <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.total_hours_gt_zero'), 'total_hours', 400);
        }

        $id = $this->groupExchangeService->create($userId, $data);

        if (!$id) {
            $creationError = $this->groupExchangeService->getLastCreationError();
            if ($creationError !== null) {
                $creationStatus = match ($creationError) {
                    'IDEMPOTENCY_CONFLICT' => 409,
                    'IDEMPOTENCY_INVALID' => 422,
                    default => 500,
                };
                return $this->respondWithError(
                    $creationError,
                    $creationError === 'IDEMPOTENCY_CONFLICT'
                        ? __('event_registration.idempotency_conflict')
                        : ($creationError === 'IDEMPOTENCY_INVALID'
                            ? __('event_registration.idempotency_invalid')
                            : __('api.generic_error')),
                    'idempotency_key',
                    $creationStatus,
                );
            }
            if ($restriction = $this->groupExchangeService->getLastContactRestriction()) {
                $error = MessageService::buildSafeguardingError([
                    'code' => $restriction->code,
                    'required_vetting_types' => $restriction->requiredAttestationCodes,
                    'required_vetting_labels' => $restriction->requiredAttestationLabels,
                ]);

                return $this->respondWithError(
                    $restriction->code,
                    (string) $error['message'],
                    null,
                    $restriction->isUnavailable() ? 503 : 403,
                );
            }

            return $this->respondWithError('INTERNAL_ERROR', __('api.server_error'), null, 500);
        }

        $exchange = $this->groupExchangeService->get($id);

        return $this->respondWithData($exchange, null, 201);
    }

    /** GET /api/v2/group-exchanges/{id} */
    public function show(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $exchange = $this->groupExchangeService->get($id);

        if (!$exchange) {
            return $this->respondWithError('NOT_FOUND', __('api.group_exchange_not_found'), null, 404);
        }

        if (!$this->canViewExchange($exchange, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.group_exchange_forbidden'), null, 403);
        }

        // Detail and split are read under the same exchange lock as the terms token.

        return $this->respondWithData($exchange);
    }

    /** PUT /api/v2/group-exchanges/{id} */
    public function update(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $exchange = $this->groupExchangeService->get($id);

        if (!$exchange) {
            return $this->respondWithError('NOT_FOUND', __('api.group_exchange_not_found'), null, 404);
        }

        if ((int) $exchange['organizer_id'] !== $userId) {
            return $this->respondWithError('FORBIDDEN', __('api.organizer_only_update'), null, 403);
        }

        if (in_array($exchange['status'], ['completed', 'cancelled'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.cannot_update_completed_exchange'), null, 400);
        }

        $data = $this->getAllInput();
        if (!$this->groupExchangeService->update($id, $data)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.cannot_update_completed_exchange'), null, 400);
        }

        $updated = $this->groupExchangeService->get($id);

        return $this->respondWithData($updated);
    }

    /** DELETE /api/v2/group-exchanges/{id} */
    public function destroy(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $exchange = $this->groupExchangeService->get($id);

        if (!$exchange) {
            return $this->respondWithError('NOT_FOUND', __('api.group_exchange_not_found'), null, 404);
        }

        if ((int) $exchange['organizer_id'] !== $userId) {
            return $this->respondWithError('FORBIDDEN', __('api.organizer_only_cancel'), null, 403);
        }

        if (!$this->groupExchangeService->cancel($id)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.cannot_update_completed_exchange'), null, 400);
        }

        return $this->respondWithData(['message' => __('api_controllers_1.group_exchange.exchange_cancelled')]);
    }

    /** POST /api/v2/group-exchanges/{id}/participants */
    public function addParticipant($id): JsonResponse
    {
        $userId = $this->requireAuth();

        $exchange = $this->groupExchangeService->get((int) $id);

        if (!$exchange) {
            return $this->respondWithError('NOT_FOUND', __('api.group_exchange_not_found'), null, 404);
        }

        if ((int) $exchange['organizer_id'] !== $userId) {
            return $this->respondWithError('FORBIDDEN', __('api.organizer_only_update'), null, 403);
        }

        $data = $this->getAllInput();

        if (empty($data['user_id']) || empty($data['role'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.user_id_and_role_required'), null, 400);
        }

        $ok = $this->groupExchangeService->addParticipant(
            (int) $id,
            (int) $data['user_id'],
            $data['role'],
            (float) ($data['hours'] ?? 0),
            (float) ($data['weight'] ?? 1.0)
        );

        if (!$ok) {
            if ($restriction = $this->groupExchangeService->getLastContactRestriction()) {
                $error = MessageService::buildSafeguardingError([
                    'code' => $restriction->code,
                    'required_vetting_types' => $restriction->requiredAttestationCodes,
                    'required_vetting_labels' => $restriction->requiredAttestationLabels,
                ]);

                return $this->respondWithError(
                    $restriction->code,
                    (string) $error['message'],
                    null,
                    $restriction->isUnavailable() ? 503 : 403,
                );
            }

            return $this->respondWithError('VALIDATION_ERROR', __('api.failed_add_participant'), null, 400);
        }

        $updated = $this->groupExchangeService->get((int) $id);

        return $this->respondWithData($updated);
    }

    /** DELETE /api/v2/group-exchanges/{id}/participants/{userId} */
    public function removeParticipant($id, $userId): JsonResponse
    {
        $actingUserId = $this->requireAuth();

        $exchange = $this->groupExchangeService->get((int) $id);

        if (!$exchange) {
            return $this->respondWithError('NOT_FOUND', __('api.group_exchange_not_found'), null, 404);
        }

        if ((int) $exchange['organizer_id'] !== $actingUserId) {
            return $this->respondWithError('FORBIDDEN', __('api.organizer_only_update'), null, 403);
        }

        if (!$this->groupExchangeService->removeParticipant((int) $id, (int) $userId)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.cannot_update_completed_exchange'), null, 400);
        }

        $updated = $this->groupExchangeService->get((int) $id);

        return $this->respondWithData($updated);
    }

    /** POST /api/v2/group-exchanges/{id}/start */
    public function start(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $exchange = $this->groupExchangeService->get($id);

        if (!$exchange) {
            return $this->respondWithError('NOT_FOUND', __('api.group_exchange_not_found'), null, 404);
        }

        if ((int) $exchange['organizer_id'] !== $userId) {
            return $this->respondWithError('FORBIDDEN', __('api.organizer_only_update'), null, 403);
        }

        $result = $this->groupExchangeService->start($id);

        if (!$result['success']) {
            $code = (string) ($result['code'] ?? 'VALIDATION_ERROR');
            $status = $code === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 503
                : (in_array($code, ['VETTING_REQUIRED', 'SAFEGUARDING_CONTACT_RESTRICTED'], true) ? 403 : 400);

            return $this->respondWithError($code, $result['error'], null, $status);
        }

        $updated = $this->groupExchangeService->get($id);

        return $this->respondWithData($updated);
    }

    /** POST /api/v2/group-exchanges/{id}/confirm */
    public function confirm(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $exchange = $this->groupExchangeService->get($id);

        if (!$exchange) {
            return $this->respondWithError('NOT_FOUND', __('api.group_exchange_not_found'), null, 404);
        }

        if (!$this->isExchangeParticipant($exchange, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.group_exchange_participant_required'), null, 403);
        }

        if (!$this->groupExchangeService->confirmParticipation($id, $userId, is_string(request()->input('terms_token')) ? request()->input('terms_token') : null)) {
            if ($this->groupExchangeService->hadTermsMismatch()) {
                return $this->respondWithError('TERMS_CHANGED', __('api.group_exchange_terms_changed'), null, 409);
            }
            if ($restriction = $this->groupExchangeService->getLastContactRestriction()) {
                $error = MessageService::buildSafeguardingError([
                    'status' => $restriction->status,
                    'code' => $restriction->code,
                    'required_vetting_types' => $restriction->requiredAttestationCodes,
                    'required_vetting_labels' => $restriction->requiredAttestationLabels,
                    'can_request_coordinator' => $restriction->canRequestCoordinator,
                ]);
                $status = $restriction->isUnavailable() ? 503 : 403;

                return $this->respondWithError($error['code'], $error['message'], null, $status);
            }

            return $this->respondWithError('VALIDATION_ERROR', __('api.group_exchange_confirm_failed'), null, 400);
        }

        $updated = $this->groupExchangeService->get($id);

        return $this->respondWithData($updated);
    }

    /** POST /api/v2/group-exchanges/{id}/complete */
    public function complete(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $exchange = $this->groupExchangeService->get($id);

        if (!$exchange) {
            return $this->respondWithError('NOT_FOUND', __('api.group_exchange_not_found'), null, 404);
        }

        if ((int) $exchange['organizer_id'] !== $userId) {
            return $this->respondWithError('FORBIDDEN', __('api.organizer_only_complete'), null, 403);
        }

        $result = $this->groupExchangeService->complete($id);

        if (!$result['success']) {
            $code = (string) ($result['code'] ?? 'VALIDATION_ERROR');
            $status = $code === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 503
                : (in_array($code, ['VETTING_REQUIRED', 'SAFEGUARDING_CONTACT_RESTRICTED'], true) ? 403 : 400);

            return $this->respondWithError($code, $result['error'], null, $status);
        }

        return $this->respondWithData([
            'message' => __('api_controllers_1.group_exchange.exchange_completed'),
            'transaction_ids' => $result['transaction_ids'],
        ]);
    }

    private function canViewExchange(array $exchange, int $userId): bool
    {
        return (int) $exchange['organizer_id'] === $userId || $this->isExchangeParticipant($exchange, $userId);
    }

    private function isExchangeParticipant(array $exchange, int $userId): bool
    {
        foreach ($exchange['participants'] ?? [] as $participant) {
            if ((int) ($participant['user_id'] ?? 0) === $userId) {
                return true;
            }
        }

        return false;
    }
}
