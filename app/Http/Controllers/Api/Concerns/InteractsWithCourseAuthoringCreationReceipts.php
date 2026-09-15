<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\Concerns;

use App\Services\CourseAuthoringCreationReceiptService;
use Illuminate\Http\Exceptions\HttpResponseException;

trait InteractsWithCourseAuthoringCreationReceipts
{
    /** @return array{resource:\Illuminate\Database\Eloquent\Model,replayed:bool} */
    protected function createCourseAuthoringResource(
        int $userId,
        int $courseId,
        string $resourceType,
        array $input,
        callable $create,
    ): array {
        $headerKey = request()->header('Idempotency-Key');
        $bodyKey = $input['idempotency_key'] ?? null;
        if ($headerKey !== null && $bodyKey !== null
            && ! hash_equals(trim((string) $headerKey), trim((string) $bodyKey))) {
            throw new HttpResponseException($this->respondWithError(
                'IDEMPOTENCY_INVALID', __('event_registration.idempotency_invalid'), 'idempotency_key', 422,
            ));
        }

        $identity = CourseAuthoringCreationReceiptService::identity(
            (string) ($headerKey ?? $bodyKey ?? ''), $resourceType, $courseId, $input,
        );
        if ($identity === false) {
            throw new HttpResponseException($this->respondWithError(
                'IDEMPOTENCY_INVALID', __('event_registration.idempotency_invalid'), 'idempotency_key', 422,
            ));
        }

        try {
            return $identity === null
                ? ['resource' => $create(), 'replayed' => false]
                : CourseAuthoringCreationReceiptService::create(
                    $userId, $courseId, $resourceType, $identity, $create,
                );
        } catch (\InvalidArgumentException) {
            throw new HttpResponseException($this->respondWithError(
                'IDEMPOTENCY_CONFLICT', __('event_registration.idempotency_conflict'), 'idempotency_key', 409,
            ));
        } catch (\DomainException) {
            throw new HttpResponseException($this->respondWithError(
                'IDEMPOTENCY_RESULT_GONE', __('api.invalid_input'), 'idempotency_key', 409,
            ));
        }
    }
}
