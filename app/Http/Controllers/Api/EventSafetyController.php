<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Enums\EventParticipationDecision;
use App\Enums\EventParticipationDenialReason;
use App\Exceptions\EventSafetyException;
use App\Models\User;
use App\Services\EventGuardianConsentService;
use App\Services\EventParticipationDenialService;
use App\Services\EventSafetyAcknowledgementService;
use App\Services\EventSafetyProjectionService;
use App\Services\EventSafetyRequirementService;
use App\Support\Authorization\MinimumAge;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Throwable;

/** Versioned, private API for Event Safety policy, evidence, and reviews. */
final class EventSafetyController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventSafetyProjectionService $projection,
        private readonly EventSafetyRequirementService $requirements,
        private readonly EventSafetyAcknowledgementService $acknowledgements,
        private readonly EventGuardianConsentService $guardianConsents,
        private readonly EventParticipationDenialService $denials,
    ) {}

    public function show(int $id): JsonResponse
    {
        try {
            return $this->safetyResponse($this->projection->read($id, $this->actor()));
        } catch (EventSafetyException $exception) {
            return $this->safetyError($exception);
        }
    }

    public function saveRequirements(int $id): JsonResponse
    {
        $idempotencyKey = $this->requiredIdempotencyKey();
        $expectedRevision = $this->nullableNonNegativeInteger(
            request()->input('expected_revision'),
        );
        if ($idempotencyKey === false || $expectedRevision === false) {
            return $this->validationError(
                $idempotencyKey === false ? 'idempotency_key' : 'expected_revision',
            );
        }

        try {
            $this->requirements->saveDraft(
                $id,
                $this->actor(),
                request()->only([
                    'minimum_age',
                    'guardian_consent_required',
                    'minor_age_threshold',
                    'code_of_conduct_required',
                    'code_of_conduct_text',
                    'code_of_conduct_text_version',
                ]),
                $expectedRevision,
                $idempotencyKey,
            );

            return $this->safetyResponse($this->projection->read($id, $this->actor()));
        } catch (EventSafetyException $exception) {
            return $this->safetyError($exception);
        }
    }

    public function publishRequirements(int $id): JsonResponse
    {
        return $this->transitionRequirements($id, false);
    }

    public function archiveRequirements(int $id): JsonResponse
    {
        return $this->transitionRequirements($id, true);
    }

    public function acknowledgeCode(int $id): JsonResponse
    {
        $idempotencyKey = $this->requiredIdempotencyKey();
        $textVersion = request()->input('text_version');
        $textHash = request()->input('text_hash');
        if ($idempotencyKey === false
            || ! is_string($textVersion)
            || ! is_string($textHash)) {
            return $this->validationError($idempotencyKey === false ? 'idempotency_key' : 'text_version');
        }
        try {
            $actor = $this->actor();
            $this->acknowledgements->acknowledge(
                $id,
                $actor,
                $textVersion,
                $textHash,
                $idempotencyKey,
            );

            return $this->safetyResponse($this->projection->read($id, $actor));
        } catch (EventSafetyException $exception) {
            return $this->safetyError($exception);
        }
    }

    public function withdrawCode(int $id, int $acknowledgementId): JsonResponse
    {
        $idempotencyKey = $this->requiredIdempotencyKey();
        if ($idempotencyKey === false) {
            return $this->validationError('idempotency_key');
        }
        try {
            $actor = $this->actor();
            $this->acknowledgements->withdraw(
                $id,
                $actor,
                $acknowledgementId,
                $idempotencyKey,
            );

            return $this->safetyResponse($this->projection->read($id, $actor));
        } catch (EventSafetyException $exception) {
            return $this->safetyError($exception);
        }
    }

    /*
     * Adults-only platform (owner decision 2026-09-25, E-035 F-160): under-18
     * participation is removed, not supervised, so event guardian consent is
     * switched off. The request, withdraw and grant endpoints refuse with 410
     * GUARDIAN_CONSENT_RETIRED. `event_guardian_consents`, its history table and
     * their triggers are untouched, and EventGuardianConsentService still works
     * underneath, so the switch-off is reversible and the evidence is kept.
     */
    public function requestGuardianConsent(int $id): JsonResponse
    {
        return $this->guardianConsentRetired();
    }

    public function withdrawGuardianConsent(int $id, int $consentId): JsonResponse
    {
        return $this->guardianConsentRetired();
    }

    /** Public capability-token endpoint — retired with the rest of guardian consent. */
    public function grantGuardianConsent(): JsonResponse
    {
        return $this->guardianConsentRetired();
    }

    private function guardianConsentRetired(): JsonResponse
    {
        return $this->privateResponse($this->respondWithError(
            'GUARDIAN_CONSENT_RETIRED',
            __('api.guardian_consent_retired', ['age' => MinimumAge::YEARS]),
            null,
            410,
        ));
    }

    public function reviews(int $id): JsonResponse
    {
        $page = $this->positiveInteger(request()->query('page', 1));
        $perPage = $this->positiveInteger(request()->query('per_page', 25));
        if ($page === null || $perPage === null) {
            return $this->validationError($page === null ? 'page' : 'per_page');
        }
        try {
            return $this->privateResponse($this->respondWithData(
                $this->projection->reviews($id, $this->actor(), $page, $perPage),
            ));
        } catch (EventSafetyException $exception) {
            return $this->safetyError($exception);
        }
    }

    public function recordReview(int $id): JsonResponse
    {
        $idempotencyKey = $this->requiredIdempotencyKey();
        $userId = $this->positiveInteger(request()->input('user_id'));
        $decision = is_string(request()->input('decision'))
            ? EventParticipationDecision::tryFrom((string) request()->input('decision'))
            : null;
        $reason = is_string(request()->input('reason_code'))
            ? EventParticipationDenialReason::tryFrom((string) request()->input('reason_code'))
            : null;
        $from = $this->date(request()->input('effective_from'));
        $until = request()->input('effective_until') === null
            ? null
            : $this->date(request()->input('effective_until'));
        $expectedVersion = $this->nullableNonNegativeInteger(request()->input('expected_version'));
        if ($idempotencyKey === false || $userId === null || $decision === null || $reason === null
            || $from === null || (request()->input('effective_until') !== null && $until === null)
            || $expectedVersion === false) {
            return $this->validationError('review');
        }
        try {
            $actor = $this->actor();
            $this->denials->record(
                $id,
                $userId,
                $actor,
                $decision,
                $reason,
                $from,
                $until,
                $expectedVersion,
                $idempotencyKey,
            );

            return $this->privateResponse($this->respondWithData(
                $this->projection->reviews($id, $actor),
            ));
        } catch (EventSafetyException $exception) {
            return $this->safetyError($exception);
        }
    }

    public function withdrawReview(int $id, int $denialId): JsonResponse
    {
        $idempotencyKey = $this->requiredIdempotencyKey();
        $expectedVersion = $this->positiveInteger(request()->input('expected_version'));
        if ($idempotencyKey === false || $expectedVersion === null) {
            return $this->validationError($idempotencyKey === false ? 'idempotency_key' : 'expected_version');
        }
        try {
            $actor = $this->actor();
            $this->denials->withdraw(
                $id,
                $denialId,
                $actor,
                $expectedVersion,
                $idempotencyKey,
            );

            return $this->privateResponse($this->respondWithData(
                $this->projection->reviews($id, $actor),
            ));
        } catch (EventSafetyException $exception) {
            return $this->safetyError($exception);
        }
    }

    private function transitionRequirements(int $id, bool $archive): JsonResponse
    {
        $idempotencyKey = $this->requiredIdempotencyKey();
        $revision = $this->positiveInteger(request()->input('expected_revision'));
        $version = $this->positiveInteger(request()->input('expected_version'));
        if ($idempotencyKey === false || $revision === null || $version === null) {
            return $this->validationError('requirements_version');
        }
        try {
            $actor = $this->actor();
            if ($archive) {
                $this->requirements->archive($id, $actor, $revision, $version, $idempotencyKey);
            } else {
                $this->requirements->publish($id, $actor, $revision, $version, $idempotencyKey);
            }

            return $this->safetyResponse($this->projection->read($id, $actor));
        } catch (EventSafetyException $exception) {
            return $this->safetyError($exception);
        }
    }

    private function actor(): User
    {
        $tenantId = TenantContext::currentId();
        $actor = $tenantId === null
            ? null
            : User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->find($this->requireUserId());
        if (! $actor instanceof User) {
            throw new EventSafetyException('event_safety_actor_not_active');
        }

        return $actor;
    }

    private function requiredIdempotencyKey(): string|false
    {
        $key = request()->header('Idempotency-Key');
        return is_string($key) && trim($key) !== '' && mb_strlen(trim($key)) <= 191
            ? trim($key)
            : false;
    }

    private function positiveInteger(mixed $value): ?int
    {
        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $parsed === false ? null : (int) $parsed;
    }

    private function nullableNonNegativeInteger(mixed $value): int|false|null
    {
        if ($value === null || $value === '') {
            return null;
        }
        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);

        return $parsed === false ? false : (int) $parsed;
    }

    private function date(mixed $value): ?CarbonImmutable
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }
        try {
            return CarbonImmutable::parse($value)->utc();
        } catch (Throwable) {
            return null;
        }
    }

    /** @param array<string,mixed> $data */
    private function safetyResponse(array $data, int $status = 200): JsonResponse
    {
        return $this->privateResponse($this->respondWithData($data, null, $status));
    }

    private function privateResponse(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Pragma', 'no-cache');
        $response->headers->set('X-Event-Safety-Contract', '1');
        $response->setVary(['Authorization', 'Cookie', 'X-Tenant-ID'], false);

        return $response;
    }

    private function validationError(string $field): JsonResponse
    {
        return $this->respondWithError(
            'EVENT_SAFETY_VALIDATION_FAILED',
            __('api.validation_failed'),
            $field,
            422,
        );
    }

    private function safetyError(EventSafetyException $exception): JsonResponse
    {
        [$code, $message, $status] = match (true) {
            str_contains($exception->reasonCode, 'not_found') => [
                'EVENT_SAFETY_NOT_FOUND', __('api.event_not_found'), 404,
            ],
            str_contains($exception->reasonCode, 'authorization')
                || str_contains($exception->reasonCode, 'actor_not_active') => [
                    'EVENT_SAFETY_FORBIDDEN', __('api.forbidden'), 403,
                ],
            str_contains($exception->reasonCode, 'conflict')
                || str_contains($exception->reasonCode, 'current_exists')
                || str_contains($exception->reasonCode, 'already_') => [
                    'EVENT_SAFETY_CONFLICT', __('api.invalid_input'), 409,
                ],
            str_contains($exception->reasonCode, 'schema_unavailable')
                || str_contains($exception->reasonCode, 'configuration_invalid')
                || str_contains($exception->reasonCode, 'cipher_unavailable')
                || str_contains($exception->reasonCode, 'feature_disabled') => [
                    'EVENT_SAFETY_UNAVAILABLE', __('api.service_unavailable'), 503,
                ],
            default => ['EVENT_SAFETY_VALIDATION_FAILED', __('api.validation_failed'), 422],
        };

        return $this->privateResponse($this->respondWithError($code, $message, null, $status));
    }
}
