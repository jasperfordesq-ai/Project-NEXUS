<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Core\TenantContext;
use App\Http\Middleware\EnsureLegalAcceptance;
use App\Services\LegalDocumentService;

/**
 * AdminLegalDocController -- Admin legal document version management and compliance.
 *
 * Converted from legacy delegation to direct service calls.
 * Note: The legacy controller uses v1 response format (success/error), which we preserve here
 * wrapped in the v2 envelope for consistency.
 */
class AdminLegalDocController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly LegalDocumentService $legalDocumentService,
    ) {}

    /** GET /api/v2/admin/legal-docs/{docId}/versions */
    public function getVersions(int $docId): JsonResponse
    {
        $this->requireAdmin();
        try {
            $versions = $this->legalDocumentService->getVersions($docId);
            return $this->respondWithData($versions);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminLegalDocController] getVersions error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.fetch_failed', ['resource' => 'versions']), null, 500);
        }
    }

    /** GET /api/v2/admin/legal-docs/{docId}/compare */
    public function compareVersions(int $docId): JsonResponse
    {
        $this->requireAdmin();
        $v1 = $this->query('v1');
        $v2 = $this->query('v2');

        if (!$v1 || !$v2) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.both_versions_required'), null, 400);
        }

        try {
            $comparison = $this->legalDocumentService->compareVersions((int) $v1, (int) $v2);

            if (!$comparison) {
                return $this->respondWithError('NOT_FOUND', __('api.versions_not_found'), null, 404);
            }

            if ((int) $comparison['version1']['document_id'] !== $docId || (int) $comparison['version2']['document_id'] !== $docId) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.version_does_not_belong'), null, 400);
            }

            return $this->respondWithData($comparison);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminLegalDocController] compareVersions error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.fetch_failed', ['resource' => 'version comparison']), null, 500);
        }
    }

    /** POST /api/v2/admin/legal-docs/{docId}/versions */
    public function createVersion(int $docId): JsonResponse
    {
        $this->requireAdmin();
        $input = $this->getAllInput();

        if (empty($input['version_number'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.version_number_required'), 'version_number', 400);
        }
        if (empty($input['content'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.content_required'), 'content', 400);
        }
        if (empty($input['effective_date'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.effective_date_required'), 'effective_date', 400);
        }

        try {
            $versionId = $this->legalDocumentService->createVersion($docId, [
                'version_number' => $input['version_number'],
                'version_label' => $input['version_label'] ?? null,
                'content' => $input['content'],
                'summary_of_changes' => $input['summary_of_changes'] ?? null,
                'effective_date' => $input['effective_date'],
                // Every new version starts as an editable draft. Accepting a
                // caller-supplied false here created an unpublished, non-current
                // version that the editor then refused to edit or publish.
                'is_draft' => true,
            ]);

            return $this->respondWithData(['id' => $versionId], null, 201);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminLegalDocController] createVersion error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.create_failed', ['resource' => 'version']), null, 500);
        }
    }

    /** POST /api/v2/admin/legal-docs/versions/{vid}/publish */
    public function publishVersion(int $vid): JsonResponse
    {
        $this->requireAdmin();
        try {
            // getVersion() is tenant-scoped — missing/cross-tenant versions are a 404, not a 500
            $version = $this->legalDocumentService->getVersion($vid);
            if (!$version) {
                return $this->respondWithError('NOT_FOUND', __('api.version_not_found'), null, 404);
            }
            if (!(bool) ($version['is_draft'] ?? false)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.only_draft_can_be_edited'), null, 400);
            }

            $success = $this->legalDocumentService->publishVersion($vid);

            if ($success) {
                return $this->respondWithData(['published' => true]);
            }
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'version publish']), null, 500);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminLegalDocController] publishVersion error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'version publish']), null, 500);
        }
    }

    /** GET /api/v2/admin/legal-docs/compliance-stats */
    public function getComplianceStats(): JsonResponse
    {
        $this->requireAdmin();
        try {
            $tenantId = TenantContext::getId();
            $stats = $this->legalDocumentService->getComplianceSummary($tenantId);

            // READ-ONLY. The mode is a platform-wide server setting
            // (`LEGAL_ENFORCEMENT_MODE`, see `config/legal.php`) and is reported
            // here so an admin can see what is actually happening without shell
            // access.
            //
            // 🔴 There is deliberately NO endpoint to change it. This switch can
            // stop members using the platform, so it stays a considered change to
            // a server file rather than a button one mis-click away. Do not add a
            // setter here without an explicit decision to accept that risk.
            $stats['enforcement'] = [
                'mode' => EnsureLegalAcceptance::mode(),
                // Which `acceptance_required_for` values are gated. Worth showing:
                // a community can mark a document `none`, and until 2026-08-11
                // that choice was written, validated and then ignored by
                // everything.
                'enforced_acceptance_modes' => array_values(
                    (array) config('legal.enforced_acceptance_modes', [])
                ),
                'editable_here' => false,
            ];

            return $this->respondWithData($stats);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminLegalDocController] getComplianceStats error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.fetch_failed', ['resource' => 'compliance stats']), null, 500);
        }
    }

    /** GET /api/v2/admin/legal-docs/versions/{vid}/acceptances */
    public function getAcceptances(int $vid): JsonResponse
    {
        $this->requireAdmin();
        $limit = $this->queryInt('limit', 50, 1, 200);
        $offset = $this->queryInt('offset', 0, 0);

        try {
            $acceptances = $this->legalDocumentService->getVersionAcceptances($vid, $limit, $offset);
            return $this->respondWithData($acceptances);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminLegalDocController] getAcceptances error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.fetch_failed', ['resource' => 'acceptances']), null, 500);
        }
    }

    /** GET /api/v2/admin/legal-docs/{docId}/export */
    public function exportAcceptances(int $docId)
    {
        $this->requireAdmin();
        $startDate = $this->query('start_date');
        $endDate = $this->query('end_date');

        try {
            $records = $this->legalDocumentService->exportAcceptanceRecords($docId, $startDate, $endDate);

            $filename = "acceptances_{$docId}_" . date('Y-m-d') . '.csv';

            return new \Symfony\Component\HttpFoundation\StreamedResponse(function () use ($records) {
                $output = fopen('php://output', 'w');
                // Write BOM for UTF-8 Excel compatibility
                fwrite($output, "\xEF\xBB\xBF");
                fputcsv($output, ['Acceptance ID', 'User ID', 'User Name', 'User Email', 'Version Number', 'Accepted At', 'Acceptance Method', 'IP Address']);
                foreach ($records as $record) {
                    fputcsv($output, [
                        $record['acceptance_id'],
                        $record['user_id'],
                        $this->sanitizeCsvValue($record['user_name']),
                        $this->sanitizeCsvValue($record['user_email']),
                        $this->sanitizeCsvValue($record['version_number']),
                        $record['accepted_at'],
                        $this->sanitizeCsvValue($record['acceptance_method']),
                        $record['ip_address'] ?? 'N/A',
                    ]);
                }
                fclose($output);
            }, 200, [
                'Content-Type' => 'text/csv',
                'Content-Disposition' => "attachment; filename=\"{$filename}\"",
                'Cache-Control' => 'no-cache, no-store, must-revalidate',
            ]);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.fetch_failed', ['resource' => 'acceptance export']), null, 500);
        }
    }

    /** POST /api/v2/admin/legal-docs/{docId}/versions/{vid}/notify */
    public function notifyUsers(int $docId, int $vid): JsonResponse
    {
        $this->requireAdmin();
        $input = $this->getAllInput();
        $target = $input['target'] ?? 'non_accepted';

        if (!in_array($target, [LegalDocumentService::NOTIFY_NON_ACCEPTED, LegalDocumentService::NOTIFY_ALL], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_type'), 'target', 422);
        }

        try {
            $count = $this->legalDocumentService->notifyUsersOfUpdate($docId, $vid, true, $target);
            return $this->respondWithData(['notified' => true, 'count' => $count]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminLegalDocController] notifyUsers error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'notifications']), null, 500);
        }
    }

    /** GET /api/v2/admin/legal-docs/{docId}/versions/{vid}/pending */
    public function getUsersPendingCount(int $docId, int $vid): JsonResponse
    {
        $this->requireAdmin();
        try {
            $count = $this->legalDocumentService->getUsersPendingAcceptanceCount($docId, $vid);
            return $this->respondWithData(['count' => $count]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminLegalDocController] getUsersPendingCount error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.fetch_failed', ['resource' => 'pending count']), null, 500);
        }
    }

    /** PUT /api/v2/admin/legal-docs/{docId}/versions/{vid} */
    public function updateVersion(int $docId, int $vid): JsonResponse
    {
        $this->requireAdmin();
        $input = $this->getAllInput();

        try {
            $version = $this->legalDocumentService->getVersion($vid);

            if (!$version) {
                return $this->respondWithError('NOT_FOUND', __('api.version_not_found'), null, 404);
            }
            if ((int) $version['document_id'] !== $docId) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.version_does_not_belong'), null, 400);
            }
            if (!$version['is_draft']) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.only_draft_can_be_edited'), null, 400);
            }

            $success = $this->legalDocumentService->updateVersion($vid, [
                'version_number' => $input['version_number'] ?? $version['version_number'],
                'version_label' => $input['version_label'] ?? $version['version_label'],
                'content' => $input['content'] ?? $version['content'],
                'summary_of_changes' => $input['summary_of_changes'] ?? $version['summary_of_changes'],
                'effective_date' => $input['effective_date'] ?? $version['effective_date'],
            ]);

            if ($success) {
                return $this->respondWithData(['updated' => true]);
            }
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'version']), null, 500);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminLegalDocController] updateVersion error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'version']), null, 500);
        }
    }

    /** DELETE /api/v2/admin/legal-docs/{docId}/versions/{vid} */
    public function deleteVersion(int $docId, int $vid): JsonResponse
    {
        $this->requireAdmin();

        try {
            $version = $this->legalDocumentService->getVersion($vid);

            if (!$version) {
                return $this->respondWithError('NOT_FOUND', __('api.version_not_found'), null, 404);
            }
            if ((int) $version['document_id'] !== $docId) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.version_does_not_belong'), null, 400);
            }
            if (!$version['is_draft']) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.only_draft_can_be_deleted'), null, 400);
            }

            $success = $this->legalDocumentService->deleteVersion($vid);

            if ($success) {
                return $this->respondWithData(['deleted' => true]);
            }
            return $this->respondWithError('SERVER_ERROR', __('api.delete_failed', ['resource' => 'version']), null, 500);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminLegalDocController] deleteVersion error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.delete_failed', ['resource' => 'version']), null, 500);
        }
    }

    /**
     * Sanitize a value for CSV export to prevent formula injection.
     * Prefixes cells starting with =, +, -, @, \t, \r with a single quote
     * to prevent spreadsheet applications from interpreting them as formulas.
     */
    private function sanitizeCsvValue(mixed $value): string
    {
        $str = (string) ($value ?? '');
        if ($str !== '' && in_array($str[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
            return "'" . $str;
        }
        return $str;
    }
}
