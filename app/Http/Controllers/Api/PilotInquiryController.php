<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use App\Services\PilotInquiryService;
use App\Core\TenantContext;
use App\Support\CsvExportSanitizer;
use InvalidArgumentException;

/**
 * AG71 — Pilot Region Inquiry & Qualification Funnel
 *
 * Endpoints:
 *   POST   /v2/pilot-inquiry              (public — "Jetzt Pilotregion werden!")
 *   GET    /v2/admin/pilot-inquiries      (admin)
 *   GET    /v2/admin/pilot-inquiries/stats  (admin)
 *   GET    /v2/admin/pilot-inquiries/export (admin — CSV)
 *   GET    /v2/admin/pilot-inquiries/{id} (admin)
 *   POST   /v2/admin/pilot-inquiries/{id}/stage  (admin)
 *   POST   /v2/admin/pilot-inquiries/{id}/assign (admin)
 *   POST   /v2/admin/pilot-inquiries/{id}/notes  (admin)
 */
class PilotInquiryController extends BaseApiController
{
    protected bool $isV2Api = true;

    // ─── Public endpoint ──────────────────────────────────────────────────────

    /**
     * Submit a pilot region inquiry.
     *
     * Public — no authentication required.
     * Rate-limited to 5 requests per minute per IP.
     *
     * POST /v2/pilot-inquiry
     */
    public function submitInquiry(): JsonResponse
    {
        if (! PilotInquiryService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.pilot_inquiry_service_unavailable'), null, 503);
        }

        // IP-based rate limiting: max 5 submissions per minute
        $this->rateLimit('pilot_inquiry:' . request()->ip(), 5, 60);

        $data = $this->getAllInput();

        // Required field validation
        $required = ['municipality_name', 'contact_name', 'contact_email', 'country'];
        $errors = [];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                $errors[] = [
                    'code'    => 'VALIDATION_REQUIRED_FIELD',
                    'message' => __('api.pilot_inquiry_field_required', ['field' => $field]),
                    'field'   => $field,
                ];
            }
        }

        if (! empty($data['contact_email']) && ! filter_var($data['contact_email'], FILTER_VALIDATE_EMAIL)) {
            $errors[] = [
                'code'    => 'VALIDATION_INVALID_EMAIL',
                'message' => __('api.pilot_inquiry_invalid_email'),
                'field'   => 'contact_email',
            ];
        }

        if (! empty($errors)) {
            return $this->respondWithErrors($errors, 422);
        }

        try {
            $tenantId = TenantContext::getId();
            $inquiry  = PilotInquiryService::submitInquiry($tenantId, $data);

            return $this->respondWithData([
                'id'        => $inquiry['id'],
                'fit_score' => (float) $inquiry['fit_score'],
                'stage'     => $inquiry['stage'],
            ], null, 201);
        } catch (InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\Throwable $e) {
            return $this->respondServerError(__('api.pilot_inquiry_submit_failed'));
        }
    }

    // ─── Admin endpoints ──────────────────────────────────────────────────────

    /**
     * List all pilot inquiries (optional ?stage= filter).
     *
     * GET /v2/admin/pilot-inquiries
     */
    public function adminList(): JsonResponse
    {
        $this->requireAdmin();

        if (! PilotInquiryService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.pilot_inquiry_service_unavailable'), null, 503);
        }

        $tenantId = $this->getTenantId();
        $stage    = $this->query('stage');

        $inquiries = PilotInquiryService::listInquiries($tenantId, $stage ?: null);

        return $this->respondWithData($inquiries);
    }

    /**
     * Get a single inquiry by ID.
     *
     * GET /v2/admin/pilot-inquiries/{id}
     */
    public function adminGet(int $id): JsonResponse
    {
        $this->requireAdmin();

        if (! PilotInquiryService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.pilot_inquiry_service_unavailable'), null, 503);
        }

        $inquiry = PilotInquiryService::getInquiry($id, $this->getTenantId());

        if ($inquiry === null) {
            return $this->respondNotFound(__('api.pilot_inquiry_not_found'));
        }

        return $this->respondWithData($inquiry);
    }

    /**
     * Update the pipeline stage of an inquiry.
     *
     * POST /v2/admin/pilot-inquiries/{id}/stage
     * Body: { stage: string, rejection_reason?: string }
     */
    public function adminUpdateStage(int $id): JsonResponse
    {
        $this->requireAdmin();

        if (! PilotInquiryService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.pilot_inquiry_service_unavailable'), null, 503);
        }

        $stage = $this->input('stage');
        if (empty($stage)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.pilot_inquiry_field_required', ['field' => 'stage']), 'stage', 422);
        }

        try {
            $updated = PilotInquiryService::updateStage(
                $id,
                $this->getTenantId(),
                $stage,
                $this->input('rejection_reason')
            );

            return $this->respondWithData($updated);
        } catch (InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), 'stage', 422);
        }
    }

    /**
     * Assign a sales contact to an inquiry.
     *
     * POST /v2/admin/pilot-inquiries/{id}/assign
     * Body: { user_id: int }
     */
    public function adminAssign(int $id): JsonResponse
    {
        $this->requireAdmin();

        if (! PilotInquiryService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.pilot_inquiry_service_unavailable'), null, 503);
        }

        $userId = $this->inputInt('user_id');
        if ($userId === null || $userId <= 0) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.pilot_inquiry_field_required', ['field' => 'user_id']), 'user_id', 422);
        }

        PilotInquiryService::assignTo($id, $this->getTenantId(), $userId);

        return $this->respondWithData(['success' => true]);
    }

    /**
     * Update admin-only internal notes on an inquiry.
     *
     * POST /v2/admin/pilot-inquiries/{id}/notes
     * Body: { internal_notes: string }
     */
    public function adminUpdateNotes(int $id): JsonResponse
    {
        $this->requireAdmin();

        if (! PilotInquiryService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.pilot_inquiry_service_unavailable'), null, 503);
        }

        $notes = $this->input('internal_notes', '');

        // F-482: the service's result was discarded, so a note was reported
        // saved against an inquiry belonging to another community. Refuse the
        // id the same way adminGet() above does.
        if (! PilotInquiryService::updateInternalNotes($id, $this->getTenantId(), (string) $notes)) {
            return $this->respondNotFound(__('api.pilot_inquiry_not_found'));
        }

        return $this->respondWithData(['success' => true]);
    }

    /**
     * Return pipeline statistics.
     *
     * GET /v2/admin/pilot-inquiries/stats
     */
    public function adminPipelineStats(): JsonResponse
    {
        $this->requireAdmin();

        if (! PilotInquiryService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.pilot_inquiry_service_unavailable'), null, 503);
        }

        $stats = PilotInquiryService::getPipelineStats($this->getTenantId());

        return $this->respondWithData($stats);
    }

    /**
     * Export all inquiries as a CSV download.
     *
     * GET /v2/admin/pilot-inquiries/export
     */
    public function adminExportCsv(): Response
    {
        $this->requireAdmin();

        $inquiries = PilotInquiryService::isAvailable()
            ? PilotInquiryService::listInquiries($this->getTenantId())
            : [];

        $columns = [
            'id', 'municipality_name', 'region', 'country', 'population',
            'contact_name', 'contact_email', 'contact_phone', 'contact_role',
            'has_kiss_cooperative', 'has_existing_digital_tool', 'existing_tool_name',
            'timeline_months', 'budget_indication', 'interest_modules',
            'fit_score', 'stage', 'source',
            'assigned_user_name', 'assigned_user_email',
            'proposal_sent_at', 'pilot_agreed_at', 'went_live_at',
            'created_at', 'updated_at',
        ];

        $csv  = implode(',', array_map([$this, 'csvEscape'], $columns)) . "\r\n";

        foreach ($inquiries as $row) {
            $line = [];
            foreach ($columns as $col) {
                $val = $row[$col] ?? '';
                $line[] = $this->csvEscape((string) $val);
            }
            $csv .= implode(',', $line) . "\r\n";
        }

        $filename = 'pilot-inquiries-' . date('Y-m-d') . '.csv';

        return response($csv, 200, [
            'Content-Type'        => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private function csvEscape(string $value): string
    {
        $value = CsvExportSanitizer::cell($value);

        if (str_contains($value, ',') || str_contains($value, '"') || str_contains($value, "\n")) {
            return '"' . str_replace('"', '""', $value) . '"';
        }
        return $value;
    }
}
