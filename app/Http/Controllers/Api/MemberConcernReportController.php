<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\MemberConcernReportException;
use App\Services\MemberConcernReportService;
use Illuminate\Http\JsonResponse;

/**
 * A member reports another member, or a message they received, to their
 * community's coordinators.
 *
 * Endpoints:
 *   POST /api/v2/users/{id}/report     — { category, details? }
 *   POST /api/v2/messages/{id}/report  — { category, details? }
 *
 * `category` is one of MemberConcernReportService::CATEGORIES; `details` is
 * optional (required for "other"), at most 2,000 characters.
 */
class MemberConcernReportController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(private readonly MemberConcernReportService $reports) {}

    public function reportMember(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('member_concern_report', 10, 3600);

        return $this->respond(fn (): int => $this->reports->reportMember(
            (int) TenantContext::getId(),
            $userId,
            $id,
            $this->stringInput('category'),
            $this->stringInput('details'),
        ));
    }

    public function reportMessage(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('member_concern_report', 10, 3600);

        return $this->respond(fn (): int => $this->reports->reportMessage(
            (int) TenantContext::getId(),
            $userId,
            $id,
            $this->stringInput('category'),
            $this->stringInput('details'),
        ));
    }

    /** @param callable(): int $file */
    private function respond(callable $file): JsonResponse
    {
        try {
            $reportId = $file();
        } catch (MemberConcernReportException $e) {
            return $this->respondWithError(
                $e->errorCode,
                __('api_controllers_2.' . $e->messageKey, ['max' => MemberConcernReportService::DETAILS_MAX]),
                $e->field,
                $e->status,
            );
        }

        return $this->respondWithData(['reported' => true, 'report_id' => $reportId], null, 201);
    }

    private function stringInput(string $key): ?string
    {
        $value = $this->input($key);

        return is_scalar($value) ? (string) $value : null;
    }
}
