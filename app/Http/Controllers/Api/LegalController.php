<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\LegalDocumentService;
use App\Services\RedisCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;

/**
 * LegalController -- Legal documents (terms, privacy policy, etc.).
 *
 * Converted from legacy delegation to DB facade / static service calls.
 */
class LegalController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly LegalDocumentService $legalService,
        private readonly RedisCache $redisCache,
    ) {}

    /**
     * GET /api/v2/legal/{slug}
     *
     * Get the current version of a legal document by slug.
     * Slugs: terms-of-service, privacy-policy, acceptable-use, cookie-policy.
     */
    public function getDocument(string $slug): JsonResponse
    {
        $tenantId = $this->getTenantId();

        $document = $this->legalService->getCurrentDocument($slug, $tenantId);

        if ($document === null) {
            return $this->respondWithError('NOT_FOUND', __('api.legal_doc_not_found'), null, 404);
        }

        return $this->respondWithData($document);
    }

    /**
     * GET /api/v2/legal/{slug}/versions
     *
     * Get all published versions of a legal document.
     */
    public function getVersions(string $slug): JsonResponse
    {
        $tenantId = $this->getTenantId();

        $versions = $this->legalService->getVersions($slug, $tenantId);

        return $this->respondWithData($versions);
    }

    /**
     * POST /api/v2/legal/accept-all
     *
     * Accept all current legal documents for the authenticated user.
     *
     * 🔴 F-378. The second argument is the acceptance METHOD, not the tenant id.
     * This passed $tenantId, and because `user_legal_acceptances.acceptance_method`
     * is an ENUM, MariaDB read that number as a POSITION in the enum rather than
     * as a label — so community 1 recorded 'registration', community 2 recorded
     * 'login_prompt', and so on. Plausible, valid, and untrue: the field is
     * consent evidence. The service already scopes by TenantContext internally,
     * so it never needed the tenant id.
     */
    public function acceptAll(): JsonResponse
    {
        $userId = $this->requireAuth();

        $this->legalService->acceptAll($userId, 'api');

        return $this->respondWithData(['message' => __('api_controllers_2.legal.all_accepted')]);
    }

    // ──────────────────────────────────────────────
    // Legacy legal document endpoints — converted from delegation
    // ──────────────────────────────────────────────

    private const VALID_TYPES = [
        LegalDocumentService::TYPE_TERMS,
        LegalDocumentService::TYPE_PRIVACY,
        LegalDocumentService::TYPE_COOKIES,
        LegalDocumentService::TYPE_ACCESSIBILITY,
        LegalDocumentService::TYPE_COMMUNITY_GUIDELINES,
        LegalDocumentService::TYPE_ACCEPTABLE_USE,
    ];

    /** GET /api/v2/legal/{type} (legacy format) */
    public function apiGetDocument($type): JsonResponse
    {
        if (!in_array($type, self::VALID_TYPES, true)) {
            return $this->respondWithError('NOT_FOUND', __('api.legal_doc_type_not_found'), null, 404);
        }

        $document = $this->legalService->getByType($type);

        if (!$document || !$document['content']) {
            return $this->respondWithData(null);
        }

        $versions = $this->legalService->legacyGetVersions((int) $document['id']);
        $publishedCount = count(array_filter($versions, fn ($v) => !$v['is_draft']));

        return $this->respondWithData([
            'id' => (int) $document['id'],
            'document_id' => (int) $document['id'],
            'type' => $document['document_type'],
            'title' => $document['title'],
            'content' => $document['content'],
            'version_number' => $document['version_number'],
            'effective_date' => $document['effective_date'],
            'summary_of_changes' => $document['summary_of_changes'] ?? null,
            'has_previous_versions' => $publishedCount > 1,
        ]);
    }

    /** GET /api/v2/legal/{type}/versions (legacy format) */
    public function apiGetVersions($type): JsonResponse
    {
        if (!in_array($type, self::VALID_TYPES, true)) {
            return $this->respondWithError('NOT_FOUND', __('api.legal_doc_type_not_found'), null, 404);
        }

        $document = $this->legalService->getByType($type);

        if (!$document) {
            return $this->respondWithData(['title' => '', 'versions' => []]);
        }

        $versions = $this->legalService->legacyGetVersions((int) $document['id']);

        $published = [];
        foreach ($versions as $v) {
            if ($v['is_draft']) {
                continue;
            }
            $published[] = [
                'id' => (int) $v['id'],
                'version_number' => $v['version_number'],
                'version_label' => $v['version_label'] ?? null,
                'effective_date' => $v['effective_date'],
                'published_at' => $v['published_at'],
                'is_current' => (bool) $v['is_current'],
                'summary_of_changes' => $v['summary_of_changes'] ?? null,
            ];
        }

        return $this->respondWithData([
            'title' => $document['title'],
            'type' => $document['document_type'],
            'versions' => $published,
        ]);
    }

    /** GET /api/v2/legal/version/{versionId} */
    public function apiGetVersion($versionId): JsonResponse
    {
        $version = $this->legalService->getVersion((int) $versionId);

        if (!$version) {
            return $this->respondWithError('NOT_FOUND', __('api.legal_version_not_found'), null, 404);
        }

        if ((int) $version['tenant_id'] !== TenantContext::getId()) {
            return $this->respondWithError('NOT_FOUND', __('api.legal_version_not_found'), null, 404);
        }

        if ($version['is_draft']) {
            return $this->respondWithError('NOT_FOUND', __('api.legal_version_not_found'), null, 404);
        }

        return $this->respondWithData([
            'id' => (int) $version['id'],
            'document_type' => $version['document_type'],
            'title' => $version['title'],
            'version_number' => $version['version_number'],
            'version_label' => $version['version_label'] ?? null,
            'content' => $version['content'],
            'effective_date' => $version['effective_date'],
            'published_at' => $version['published_at'],
            'is_current' => (bool) $version['is_current'],
            'summary_of_changes' => $version['summary_of_changes'] ?? null,
        ]);
    }

    /** GET /api/v2/legal/versions/compare?v1={id}&v2={id} */
    public function apiCompareVersions(): JsonResponse
    {
        $this->rateLimit('legal_compare', 30, 600);

        $v1 = $this->query('v1');
        $v2 = $this->query('v2');

        if (!$v1 || !$v2) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.both_versions_required'), null, 400);
        }

        $version1 = $this->legalService->getVersion((int) $v1);
        $version2 = $this->legalService->getVersion((int) $v2);

        if (!$version1 || !$version2) {
            return $this->respondWithError('NOT_FOUND', __('api.versions_not_found'), null, 404);
        }

        $tenantId = TenantContext::getId();
        if ((int) $version1['tenant_id'] !== $tenantId || (int) $version2['tenant_id'] !== $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.legal_version_not_found'), null, 404);
        }

        if ($version1['is_draft'] || $version2['is_draft']) {
            return $this->respondWithError('NOT_FOUND', __('api.legal_version_not_found'), null, 404);
        }

        if ((int) $version1['document_id'] !== (int) $version2['document_id']) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.legal_versions_same_doc_required'), null, 400);
        }

        // Check cache
        $cacheKey = "legal:compare:{$tenantId}:" . min((int) $v1, (int) $v2) . ':' . max((int) $v1, (int) $v2);
        $cached = $this->redisCache->get($cacheKey);
        if ($cached) {
            return $this->respondWithData($cached['data'] ?? $cached);
        }

        $comparison = $this->legalService->compareVersions((int) $v1, (int) $v2);

        if (!$comparison) {
            return $this->respondWithError('INTERNAL_ERROR', __('api.legal_comparison_failed'), null, 500);
        }

        $publicVersion = static function (array $v): array {
            return [
                'id' => (int) $v['id'],
                'version_number' => $v['version_number'],
                'version_label' => $v['version_label'] ?? null,
                'effective_date' => $v['effective_date'],
                'published_at' => $v['published_at'],
                'is_current' => (bool) $v['is_current'],
                'summary_of_changes' => $v['summary_of_changes'] ?? null,
            ];
        };

        $responseData = [
            'version1' => $publicVersion($comparison['version1']),
            'version2' => $publicVersion($comparison['version2']),
            'diff_html' => $comparison['diff_html'],
            'changes_count' => $comparison['changes_count'],
        ];

        // Cache for 24 hours
        $this->redisCache->set($cacheKey, ['data' => $responseData], 86400);

        return $this->respondWithData($responseData);
    }

    /** POST /api/v2/legal/accept */
    public function accept(): JsonResponse
    {
        $userId = $this->requireAuth();

        $documentId = (int) ($this->input('document_id', 0));
        $versionId = (int) ($this->input('version_id', 0));

        if (!$documentId || !$versionId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.legal_missing_doc_or_version'), null, 400);
        }

        $version = $this->legalService->getVersion($versionId);
        if (!$version || (int) $version['tenant_id'] !== TenantContext::getId()) {
            return $this->respondWithError('NOT_FOUND', __('api.legal_version_not_found'), null, 404);
        }

        $document = $this->legalService->legacyGetById($documentId);
        if (!$document || ($document['current_version_id'] ?? null) !== $versionId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.legal_not_current_version'), null, 400);
        }

        try {
            $this->legalService->recordAcceptanceFromRequest(
                $userId,
                $documentId,
                $versionId,
                LegalDocumentService::ACCEPTANCE_SETTINGS
            );

            return $this->respondWithData([
                'success' => true,
                'message' => __('api_controllers_2.legal.acceptance_recorded'),
                'accepted_at' => date('c'),
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('INTERNAL_ERROR', __('api.legal_acceptance_failed'), null, 500);
        }
    }

    /** GET /api/v2/legal/status */
    public function status(): JsonResponse
    {
        $userId = $this->requireAuth();

        $status = $this->legalService->getUserAcceptanceStatus($userId);

        return $this->respondWithData([
            'success' => true,
            'documents' => $status,
            'has_pending' => $this->legalService->hasPendingAcceptances($userId),
        ]);
    }
}
