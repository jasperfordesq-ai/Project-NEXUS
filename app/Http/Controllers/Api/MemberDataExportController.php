<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\MemberDataExportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * MemberDataExportController — GDPR / FADP personal-data download endpoints.
 *
 * POST /api/v2/me/data-export        Build & download archive (json|zip)
 * GET  /api/v2/me/data-export/history Last 10 export requests for this user
 *
 * Rate limited to 5 successful exports per 24 hours per user (DB-tracked).
 */
class MemberDataExportController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly MemberDataExportService $exporter,
    ) {}

    /**
     * POST /api/v2/me/data-export
     *
     * Body: { "format": "json" | "zip" }
     */
    public function create(Request $request): SymfonyResponse|JsonResponse
    {
        $userId = $this->requireAuth();
        // The legacy GET alias creates a tracked export too; HTTP-method-only
        // write restrictions cannot protect it during delegated support access.
        if (!empty($request->attributes->get('verified_auth_claims', [])['impersonated_by'])) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('mfa.impersonation_read_only'), null, 403);
        }

        $format = (string) $request->input('format', 'json');
        if (!in_array($format, ['json', 'zip'], true)) {
            $format = 'json';
        }

        // Rate limit: 5 per 24h per user (DB-backed so it survives container restarts)
        $recent = $this->exporter->countRecentRequests($userId);
        if ($recent >= 5) {
            return $this->respondWithError(
                'RATE_LIMIT_EXCEEDED',
                __('api.data_export_rate_limit', [], app()->getLocale())
                    ?: 'You can request 5 exports per day. Please try again tomorrow.',
                null,
                429
            );
        }

        $exportId = $this->exporter->recordExportRequest($userId, $format);

        try {
            $built = $format === 'zip'
                ? $this->exporter->buildZipArchive($userId)
                : $this->exporter->buildJsonArchive($userId);
        } catch (\Throwable $e) {
            return $this->respondWithError(
                'EXPORT_FAILED',
                __('api.data_export_build_failed') ?: 'We could not build your archive. Please try again.',
                null,
                500
            );
        }

        $content = $built['content'];
        $size    = strlen($content);
        $this->exporter->markCompleted($exportId, $size);

        // Notify tenant admins that a member downloaded a copy of their personal
        // data (GDPR right of access). Best-effort — never block the download.
        try {
            \App\Events\GdprActionOccurred::dispatch(
                $userId,
                (int) $this->getTenantId(),
                \App\Events\GdprActionOccurred::ACTION_DATA_EXPORT,
                $format,
            );
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('[MemberDataExport] admin-notification dispatch failed', [
                'user_id' => $userId,
                'error'   => $e->getMessage(),
            ]);
        }

        $contentType = $format === 'zip' ? 'application/zip' : 'application/json';

        $response = new StreamedResponse(function () use ($content) {
            echo $content;
        }, 200, [
            'Content-Type'        => $contentType,
            'Content-Disposition' => 'attachment; filename="' . $built['filename'] . '"',
            'Content-Length'      => (string) $size,
            'X-Export-Id'         => (string) $exportId,
        ]);

        return $response;
    }

    /**
     * GET /api/v2/me/data-export/history
     */
    public function history(): JsonResponse
    {
        $userId = $this->requireAuth();
        return $this->respondWithData([
            'exports' => $this->exporter->recentHistory($userId, 10),
        ]);
    }
}
