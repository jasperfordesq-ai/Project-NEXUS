<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\VolunteerCertificateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/**
 * Admin view of the volunteer certificates issued in a community (gap D8, 7 Oct 2026).
 * Until now certificates were member self-service only and nothing could withdraw
 * one issued in error, although they are shown to employers.
 *
 *   GET  /v2/admin/volunteering/certificates               list (q, status, page, per_page)
 *   GET  /v2/admin/volunteering/certificates/{id}/html     printable copy, without
 *                                                          marking the holder's as downloaded
 *   POST /v2/admin/volunteering/certificates/{id}/revoke   { reason }
 */
class AdminVolunteerCertificateController extends BaseApiController
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

        return $this->respondWithData(VolunteerCertificateService::listForAdmin($this->getTenantId(), [
            'q' => (string) $this->query('q', ''),
            'status' => in_array($status, ['active', 'revoked'], true) ? $status : '',
            'page' => $this->queryInt('page', 1, 1),
            'per_page' => $this->queryInt('per_page', 25, 1, 100),
        ]));
    }

    public function html(int $id): JsonResponse|Response
    {
        $this->requireAdmin();
        if ($off = $this->featureOff()) {
            return $off;
        }
        $code = VolunteerCertificateService::codeForAdmin($this->getTenantId(), $id);
        $html = $code === null ? null : VolunteerCertificateService::generateHtml($code, true);
        if ($html === null) {
            return $this->respondWithError('NOT_FOUND', __('api.certificate_not_found'), null, 404);
        }

        return response($html, 200, [
            'Content-Type' => 'text/html; charset=utf-8',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function revoke(int $id): JsonResponse
    {
        $this->requireAdmin();
        if ($off = $this->featureOff()) {
            return $off;
        }
        $this->rateLimit('admin_vol_certificate_revoke', 30, 60);
        $reason = trim((string) $this->input('reason', ''));
        if ($reason === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'reason']), 'reason', 422);
        }

        if (!VolunteerCertificateService::revoke($this->getTenantId(), $id, (int) $this->getUserId(), $reason)) {
            return $this->respondWithError('NOT_FOUND', __('api.certificate_not_found'), null, 404);
        }

        return $this->respondWithData(['revoked' => true]);
    }
}
