<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use App\Services\LegacyVettingEvidenceManager;
use App\Services\VolunteerCertificateService;
use App\Services\VolunteerCredentialPolicy;
use App\Core\TenantContext;

/**
 * VolunteerCertificateController -- Certificates, credentials, and verification.
 */
class VolunteerCertificateController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly VolunteerCertificateService $volunteerCertificateService,
    ) {}

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('volunteering')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.volunteering_feature_disabled'), null, 403)
            );
        }
    }

    private function getErrorStatus(array $errors): int
    {
        foreach ($errors as $error) {
            $code = $error['code'] ?? '';
            if ($code === 'NOT_FOUND') return 404;
            if ($code === 'FORBIDDEN') return 403;
            if ($code === 'ALREADY_EXISTS') return 409;
            if ($code === 'FEATURE_DISABLED') return 403;
        }
        return 400;
    }

    // ========================================
    // CERTIFICATES
    // ========================================

    public function myCertificates(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_certificates_list', 30, 60);

        // 🔴 The cursor the service returns was never read back, so this
        // endpoint could only ever serve page one. The service has always
        // paginated (limit + `id <` cursor) and always returned a cursor;
        // calling it with no filters simply threw the caller's page request
        // away, which is why the native app has no "Load more" here.
        // `per_page` is accepted as an alias because the app already sends it.
        $filters = [];
        $limit = $this->inputInt('limit') ?: $this->inputInt('per_page');
        if ($limit) {
            $filters['limit'] = $limit;
        }
        $cursor = $this->query('cursor');
        if (is_string($cursor) && $cursor !== '') {
            $filters['cursor'] = $cursor;
        }

        // Shape is unchanged — { items, cursor, has_more } — because both the
        // native app and CertificatesTab.tsx read `data.items` today.
        $certs = $this->volunteerCertificateService->getUserCertificates($userId, $filters);
        return $this->respondWithData($certs);
    }

    public function generateCertificate(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_certificate', 5, 60);

        $options = [];
        if ($this->inputInt('organization_id')) {
            $options['organization_id'] = $this->inputInt('organization_id');
        }

        $cert = $this->volunteerCertificateService->generate($userId, $options);

        if ($cert === null) {
            $errors = $this->volunteerCertificateService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        return $this->respondWithData($cert, null, 201);
    }

    public function verifyCertificate($code): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('volunteering_cert_verify', 60, 60);

        $cert = $this->volunteerCertificateService->verify($code);

        if ($cert === null) {
            return $this->respondWithError('NOT_FOUND', __('api.certificate_not_found'), null, 404);
        }

        return $this->respondWithData($cert);
    }

    /** Returns raw HTML for certificate printing/PDF -- not JSON */
    public function certificateHtml($code): Response|JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('volunteering_cert_html', 10, 60);

        $html = $this->volunteerCertificateService->generateHtml($code);

        if ($html === null) {
            return $this->respondWithError('NOT_FOUND', __('api.certificate_not_found'), null, 404);
        }

        $this->volunteerCertificateService->markDownloaded($code);

        return response($html, 200)->header('Content-Type', 'text/html; charset=utf-8');
    }

    // ========================================
    // CREDENTIALS
    // ========================================

    public function myCredentials(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_credentials', 30, 60);

        $tenantId = TenantContext::getId();
        $normalisedType = DB::raw('LOWER(TRIM(credential_type))');

        $credentials = DB::table('vol_credentials')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->whereIn($normalisedType, VolunteerCredentialPolicy::ALLOWED_TYPES)
            ->where(function (Builder $query): void {
                $query->whereNull('notes')
                    ->orWhere('notes', '!=', LegacyVettingEvidenceManager::GDPR_CLEANUP_PENDING_MARKER);
            })
            ->select(['id', 'credential_type', 'file_url', 'file_name', 'status', 'expires_at', 'created_at', 'updated_at'])
            ->get()
            ->each(static function (object $row): void {
                $row->legacy_vetting_evidence = false;
                $row->manual_review_required = false;
            });

        // Only explicit prohibited aliases and cleanup tombstones are
        // removal-only. Unknown/custom types are a distinct manual-review
        // bucket and are never silently reclassified as vetting evidence.
        $legacyCredentials = DB::table('vol_credentials')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where(function (Builder $query) use ($normalisedType): void {
                $query->whereIn($normalisedType, VolunteerCredentialPolicy::PROHIBITED_VETTING_TYPES)
                    ->orWhere('notes', LegacyVettingEvidenceManager::GDPR_CLEANUP_PENDING_MARKER);
            })
            ->select(['id', 'credential_type', 'status', 'created_at', 'updated_at'])
            ->get()
            ->map(static function (object $row): object {
                $row->file_url = null;
                $row->file_name = null;
                $row->expires_at = null;
                $row->legacy_vetting_evidence = true;
                $row->manual_review_required = false;

                return $row;
            });

        $manualReviewCredentials = DB::table('vol_credentials')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->whereNotIn($normalisedType, VolunteerCredentialPolicy::ALLOWED_TYPES)
            ->whereNotIn($normalisedType, VolunteerCredentialPolicy::PROHIBITED_VETTING_TYPES)
            ->where(function (Builder $query): void {
                $query->whereNull('notes')
                    ->orWhere('notes', '!=', LegacyVettingEvidenceManager::GDPR_CLEANUP_PENDING_MARKER);
            })
            ->select(['id', 'credential_type', 'status', 'created_at', 'updated_at'])
            ->get()
            ->map(static function (object $row): object {
                $row->file_url = null;
                $row->file_name = null;
                $row->expires_at = null;
                $row->legacy_vetting_evidence = false;
                $row->manual_review_required = true;

                return $row;
            });

        $credentials = $credentials
            ->concat($legacyCredentials)
            ->concat($manualReviewCredentials)
            ->sortByDesc('created_at')
            ->values()
            ->all();

        $mapped = array_map(static function ($row): array {
            $type = (string) ($row->credential_type ?? '');
            $isLegacyVettingEvidence = (bool) ($row->legacy_vetting_evidence ?? false);
            $manualReviewRequired = (bool) ($row->manual_review_required ?? false);
            $typeLabel = $isLegacyVettingEvidence
                ? __('api.volunteer_vetting_credential_retired')
                : ucwords(str_replace('_', ' ', $type));

            return [
                'id' => (int) ($row->id ?? 0),
                'credential_type' => $type,
                'file_url' => ! $isLegacyVettingEvidence && str_starts_with((string) ($row->file_url ?? ''), 'private:')
                    ? '/api/v2/volunteering/credentials/' . (int) ($row->id ?? 0) . '/download'
                    : (! $isLegacyVettingEvidence ? ($row->file_url ?? null) : null),
                'file_name' => ! $isLegacyVettingEvidence ? ($row->file_name ?? null) : null,
                'status' => $row->status ?? 'pending',
                'expires_at' => $row->expires_at ?? null,
                'created_at' => $row->created_at ?? null,
                'updated_at' => $row->updated_at ?? null,
                'type' => $type,
                'type_label' => $typeLabel,
                'document_name' => ! $isLegacyVettingEvidence ? ($row->file_name ?? null) : null,
                'upload_date' => $row->created_at ?? null,
                'expiry_date' => $row->expires_at ?? null,
                'rejection_reason' => null,
                'legacy_vetting_evidence' => $isLegacyVettingEvidence,
                'manual_review_required' => $manualReviewRequired,
            ];
        }, $credentials);

        return $this->respondWithData(['credentials' => $mapped]);
    }

    public function uploadCredential(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_credential_upload', 10, 60);

        $tenantId = TenantContext::getId();
        $type = VolunteerCredentialPolicy::normaliseType(
            (string) ($this->input('credential_type') ?? $this->input('type') ?? '')
        );
        $expiresAt = $this->input('expires_at') ?? $this->input('expiry_date');

        if (empty($type)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'credential_type']), 'credential_type');
        }

        // Criminal-record/vetting evidence is never accepted through generic
        // volunteering credentials. Reject before reading or storing file bytes.
        if (VolunteerCredentialPolicy::isProhibitedVetting($type)) {
            return $this->respondWithError(
                'VETTING_EVIDENCE_PROHIBITED',
                __('api.volunteer_vetting_credential_prohibited'),
                'credential_type',
                422,
            );
        }
        if (! VolunteerCredentialPolicy::isAllowed($type)) {
            return $this->respondWithError(
                'UNSUPPORTED_CREDENTIAL_TYPE',
                __('api.invalid_type'),
                'credential_type',
                422,
            );
        }

        // Validate the optional expiry date before it reaches the DATE column —
        // an unparseable string would otherwise be silently coerced to 0000-00-00
        // (or rejected at the DB layer with an opaque 500). Normalise to Y-m-d.
        if ($expiresAt !== null && trim((string) $expiresAt) !== '') {
            $expiresTs = strtotime((string) $expiresAt);
            if ($expiresTs === false) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_expiry_date_format'), 'expires_at', 422);
            }
            $expiresAt = date('Y-m-d', $expiresTs);
        } else {
            $expiresAt = null;
        }

        // Support both Laravel UploadedFile and raw $_FILES
        $file = request()->file('file') ?? request()->file('document');
        $uploadedFile = null;

        if ($file) {
            // Laravel UploadedFile path
            $allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
            if (!in_array($file->getMimeType(), $allowedMimes, true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.credential_file_types'), 'file');
            }
            if ($file->getSize() > 10 * 1024 * 1024) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.file_exceeds_limit'), 'file');
            }
            // Build $_FILES-compatible array for ImageUploader
            $uploadedFile = [
                'tmp_name' => $file->getRealPath(),
                'name' => $file->getClientOriginalName(),
                'size' => $file->getSize(),
                'type' => $file->getMimeType(),
                'error' => UPLOAD_ERR_OK,
            ];
        } else {
            // Fallback to raw $_FILES
            $uploadedFile = $_FILES['file'] ?? $_FILES['document'] ?? null;
            if (empty($uploadedFile) || !isset($uploadedFile['error']) || $uploadedFile['error'] !== UPLOAD_ERR_OK) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.credential_file_required'), 'file');
            }
            $allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
            $finfo = new \finfo(FILEINFO_MIME_TYPE);
            $mimeType = $finfo->file($uploadedFile['tmp_name']);
            if (!in_array($mimeType, $allowedMimes, true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.credential_file_types'), 'file');
            }
            if (($uploadedFile['size'] ?? 0) > 10 * 1024 * 1024) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.file_exceeds_limit'), 'file');
            }
        }

        $fileName = $uploadedFile['name'] ?? null;
        $mimeType = $uploadedFile['type'] ?? null;
        if (!$mimeType && !empty($uploadedFile['tmp_name'])) {
            $mimeType = (new \finfo(FILEINFO_MIME_TYPE))->file($uploadedFile['tmp_name']);
        }

        $extensions = [
            'application/pdf' => 'pdf',
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
        ];
        $extension = $extensions[$mimeType] ?? null;
        if ($extension === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.credential_file_types'), 'file');
        }

        $storagePath = 'volunteer-credentials/' . $tenantId . '/' . bin2hex(random_bytes(16)) . '.' . $extension;
        \Illuminate\Support\Facades\Storage::disk('local')->put(
            $storagePath,
            file_get_contents($uploadedFile['tmp_name'])
        );
        $fileUrl = 'private:' . $storagePath;

        DB::insert(
            "INSERT INTO vol_credentials (tenant_id, user_id, credential_type, file_url, file_name, status, expires_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'pending', ?, NOW(), NOW())",
            [$tenantId, $userId, $type, $fileUrl, $fileName, $expiresAt ?: null]
        );

        return $this->respondWithData([
            'success' => true,
            'id' => (int) DB::getPdo()->lastInsertId(),
        ], null, 201);
    }

    public function downloadCredential($id)
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_credential_download', 30, 60);

        $credentialType = DB::selectOne(
            "SELECT credential_type FROM vol_credentials WHERE id = ? AND user_id = ? AND tenant_id = ?",
            [(int) $id, $userId, TenantContext::getId()]
        );

        if (!$credentialType || ! VolunteerCredentialPolicy::isAllowed((string) $credentialType->credential_type)) {
            return $this->respondWithError('NOT_FOUND', __('api.credential_not_found'), null, 404);
        }

        $credential = DB::selectOne(
            "SELECT id, file_url, file_name FROM vol_credentials WHERE id = ? AND user_id = ? AND tenant_id = ?",
            [(int) $id, $userId, TenantContext::getId()]
        );
        if (!$credential || !str_starts_with((string) $credential->file_url, 'private:')) {
            return $this->respondWithError('NOT_FOUND', __('api.credential_not_found'), null, 404);
        }

        $path = substr((string) $credential->file_url, strlen('private:'));
        $expectedPrefix = 'volunteer-credentials/' . TenantContext::getId() . '/';
        if (!str_starts_with($path, $expectedPrefix) || str_contains($path, '..')) {
            return $this->respondWithError('NOT_FOUND', __('api.credential_not_found'), null, 404);
        }
        if (!\Illuminate\Support\Facades\Storage::disk('local')->exists($path)) {
            return $this->respondWithError('NOT_FOUND', __('api.credential_not_found'), null, 404);
        }

        return response()->download(
            \Illuminate\Support\Facades\Storage::disk('local')->path($path),
            basename((string) ($credential->file_name ?: basename($path)))
        );
    }

    public function deleteCredential($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_credential_delete', 10, 60);

        $tenantId = TenantContext::getId();
        $credential = DB::selectOne(
            "SELECT id, file_url FROM vol_credentials WHERE id = ? AND user_id = ? AND tenant_id = ?",
            [(int) $id, $userId, $tenantId]
        );
        if ($credential === null) {
            return $this->respondWithError('NOT_FOUND', __('api.credential_not_found'), null, 404);
        }

        // Never delete the only database pointer before the personal file has
        // been deleted (or proven absent). A malformed/refused/failed path is
        // retained as a redacted DPO-cleanup tombstone instead of being orphaned.
        $deleteStatus = app(LegacyVettingEvidenceManager::class)
            ->deletePrivateCredentialPointer((string) ($credential->file_url ?? ''), $tenantId);
        if (! in_array($deleteStatus, ['deleted', 'missing'], true)) {
            DB::table('vol_credentials')
                ->where('id', (int) $credential->id)
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'file_name' => null,
                    'status' => 'rejected',
                    'verified_by' => null,
                    'verified_at' => null,
                    'expires_at' => null,
                    'notes' => LegacyVettingEvidenceManager::GDPR_CLEANUP_PENDING_MARKER,
                    'updated_at' => now(),
                ]);

            return $this->respondWithError(
                'CREDENTIAL_DELETE_FAILED',
                __('api.credential_delete_failed'),
                null,
                503,
            );
        }

        DB::delete(
            "DELETE FROM vol_credentials WHERE id = ? AND user_id = ? AND tenant_id = ?",
            [(int) $id, $userId, $tenantId]
        );

        return $this->respondWithData(['success' => true]);
    }
}
