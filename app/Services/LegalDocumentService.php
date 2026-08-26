<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\Helpers\HtmlSanitizer;
use App\I18n\LocaleContext;
use App\Services\LegalEnforcementService;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * LegalDocumentService — Laravel DI-based service for legal document management.
 *
 * Manages versioned legal documents (ToS, Privacy, etc.) with acceptance tracking.
 */
class LegalDocumentService
{
    public const TYPE_TERMS = 'terms';
    public const TYPE_PRIVACY = 'privacy';
    public const TYPE_COOKIES = 'cookies';
    public const TYPE_COMMUNITY = 'community_guidelines';
    public const TYPE_ACCESSIBILITY = 'accessibility';
    public const TYPE_COMMUNITY_GUIDELINES = 'community_guidelines';
    public const TYPE_ACCEPTABLE_USE = 'acceptable_use';

    // Acceptance method constants (used in acceptance tracking)
    public const ACCEPTANCE_REGISTRATION = 'registration';
    public const ACCEPTANCE_LOGIN_PROMPT = 'login_prompt';
    public const ACCEPTANCE_SETTINGS = 'settings';
    public const ACCEPTANCE_API = 'api';

    // Acceptance status constants
    public const STATUS_NOT_ACCEPTED = 'not_accepted';
    public const STATUS_CURRENT = 'current';
    public const STATUS_OUTDATED = 'outdated';

    public const NOTIFY_NON_ACCEPTED = 'non_accepted';
    public const NOTIFY_ALL = 'all';

    /**
     * Get a legal document by type for the current tenant.
     */
    public static function getDocument(string $type): ?array
    {
        $record = DB::table('legal_documents as ld')
            ->leftJoin('legal_document_versions as ldv', 'ld.current_version_id', '=', 'ldv.id')
            ->where('ld.tenant_id', TenantContext::getId())
            ->where('ld.document_type', $type)
            ->where('ld.is_active', true)
            ->select('ld.*', 'ldv.version_number', 'ldv.content', 'ldv.effective_date', 'ldv.summary_of_changes')
            ->first();

        return $record ? (array) $record : null;
    }

    /**
     * Get a legal document by type (alias for getDocument).
     */
    public static function getByType(string $type): ?array
    {
        return self::getDocument($type);
    }

    /**
     * Get a legal document by ID.
     */
    public static function legacyGetById(int $id): ?array
    {
        $record = DB::table('legal_documents as ld')
            ->leftJoin('legal_document_versions as ldv', 'ld.current_version_id', '=', 'ldv.id')
            ->where('ld.id', $id)
            ->where('ld.tenant_id', TenantContext::getId())
            ->select('ld.*', 'ld.document_type as type', 'ldv.version_number', 'ldv.content', 'ldv.effective_date', 'ldv.summary_of_changes')
            ->first();

        return $record ? (array) $record : null;
    }

    /**
     * Get all active legal documents for a tenant.
     */
    public static function getAllForTenant(int $tenantId, bool $includeInactive = false): array
    {
        $query = DB::table('legal_documents as ld')
            ->leftJoin('legal_document_versions as ldv', 'ld.current_version_id', '=', 'ldv.id')
            ->where('ld.tenant_id', $tenantId);

        // Admin management views need deactivated documents too; public callers don't.
        if (! $includeInactive) {
            $query->where('ld.is_active', true);
        }

        return $query
            ->orderBy('ld.document_type')
            ->select(
                'ld.*', 'ld.document_type as type', 'ldv.version_number', 'ldv.effective_date',
                DB::raw('(SELECT COUNT(*) FROM legal_document_versions WHERE document_id = ld.id) as version_count')
            )
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Get all versions of a legal document.
     * Verifies the document belongs to the current tenant before returning versions.
     */
    public static function getVersions(int $documentId): array
    {
        return DB::table('legal_document_versions as ldv')
            ->join('legal_documents as ld', 'ldv.document_id', '=', 'ld.id')
            ->where('ldv.document_id', $documentId)
            ->where('ld.tenant_id', TenantContext::getId())
            // version_number is a string ("10.0" sorts before "9.0") — order by recency instead
            ->orderByDesc('ldv.created_at')
            ->orderByDesc('ldv.id')
            ->select('ldv.*')
            ->get()
            ->map(fn ($v) => (array) $v)
            ->all();
    }

    /**
     * Get legacy versions by document ID (with user names).
     */
    public static function legacyGetVersions(int $documentId): array
    {
        return DB::table('legal_document_versions as ldv')
            ->join('legal_documents as ld', 'ldv.document_id', '=', 'ld.id')
            ->leftJoin('users as u', 'ldv.created_by', '=', 'u.id')
            ->leftJoin('users as u2', 'ldv.published_by', '=', 'u2.id')
            ->where('ldv.document_id', $documentId)
            ->where('ld.tenant_id', TenantContext::getId())
            ->orderByDesc('ldv.created_at')
            ->select('ldv.*', 'u.name as created_by_name', 'u2.name as published_by_name')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Get a specific version.
     */
    public static function getVersion(int $vid): ?array
    {
        $record = DB::table('legal_document_versions as ldv')
            ->join('legal_documents as ld', 'ldv.document_id', '=', 'ld.id')
            ->where('ldv.id', $vid)
            ->where('ld.tenant_id', TenantContext::getId())
            ->select('ldv.*', 'ld.document_type', 'ld.title', 'ld.tenant_id')
            ->first();

        return $record ? (array) $record : null;
    }

    /**
     * Create a new legal document.
     */
    public static function createDocument(array $data): array
    {
        $tenantId = $data['tenant_id'] ?? TenantContext::getId();

        $id = DB::table('legal_documents')->insertGetId([
            'tenant_id'               => $tenantId,
            'document_type'           => $data['document_type'],
            'title'                   => $data['title'],
            'slug'                    => $data['slug'] ?? $data['document_type'],
            'requires_acceptance'     => $data['requires_acceptance'] ?? 1,
            'acceptance_required_for' => $data['acceptance_required_for'] ?? 'registration',
            'notify_on_update'        => $data['notify_on_update'] ?? 1,
            'is_active'               => $data['is_active'] ?? 1,
            'created_by'              => auth()->id(),
        ]);

        LegalEnforcementService::bumpRevision((int) $tenantId);

        return self::legacyGetById($id) ?? ['id' => $id];
    }

    /**
     * Update a legal document.
     */
    public static function updateDocument(int $id, array $data): ?array
    {
        $allowedFields = ['title', 'slug', 'requires_acceptance', 'acceptance_required_for', 'notify_on_update', 'is_active'];

        $updates = [];
        foreach ($allowedFields as $field) {
            if (array_key_exists($field, $data)) {
                $updates[$field] = $data[$field];
            }
        }

        if (empty($updates)) {
            return null;
        }

        DB::table('legal_documents')
            ->where('id', $id)
            ->where('tenant_id', TenantContext::getId())
            ->update($updates);

        LegalEnforcementService::bumpRevision((int) TenantContext::getId());

        return self::legacyGetById($id);
    }

    /**
     * Create a new version for a document.
     * Verifies the document belongs to the current tenant before creating.
     */
    public static function createVersion(int $docId, array $data): int
    {
        // Verify document belongs to current tenant
        $doc = DB::table('legal_documents')
            ->where('id', $docId)
            ->where('tenant_id', TenantContext::getId())
            ->first();

        if (! $doc) {
            throw new \InvalidArgumentException('Document not found for this tenant');
        }

        $content = HtmlSanitizer::sanitize((string) ($data['content'] ?? ''), false);
        $plainText = $content !== '' ? strip_tags($content) : null;

        return DB::table('legal_document_versions')->insertGetId([
            'document_id'        => $docId,
            'version_number'     => $data['version_number'],
            'version_label'      => $data['version_label'] ?? null,
            'content'            => $content,
            'content_plain'      => $plainText,
            'summary_of_changes' => $data['summary_of_changes'] ?? null,
            'effective_date'     => $data['effective_date'],
            // Publishing is a separate, audited transition. A new version can
            // never start life as an immutable unpublished row.
            'is_draft'           => 1,
            'created_by'         => auth()->id(),
        ]);
    }

    /**
     * Update a version.
     */
    public static function updateVersion(int $vid, array $data): bool
    {
        $allowedFields = ['version_number', 'version_label', 'summary_of_changes', 'effective_date', 'is_draft'];

        $updates = [];
        foreach ($allowedFields as $field) {
            if (array_key_exists($field, $data)) {
                $updates[$field] = $data[$field];
            }
        }

        // Update plain text if content changed
        if (array_key_exists('content', $data)) {
            $content = HtmlSanitizer::sanitize((string) $data['content'], false);
            $updates['content'] = $content;
            $updates['content_plain'] = strip_tags($content);
        }

        if (empty($updates)) {
            return false;
        }

        // Verify the version exists under the current tenant before updating —
        // MySQL reports affected=changed rows, so the UPDATE result alone can't
        // distinguish "row not found" from "saved identical content".
        $exists = DB::table('legal_document_versions as ldv')
            ->join('legal_documents as ld', 'ldv.document_id', '=', 'ld.id')
            ->where('ldv.id', $vid)
            ->where('ld.tenant_id', TenantContext::getId())
            ->exists();

        if (! $exists) {
            return false;
        }

        DB::table('legal_document_versions')
            ->where('id', $vid)
            ->whereIn('document_id', function ($q) {
                $q->select('id')->from('legal_documents')->where('tenant_id', TenantContext::getId());
            })
            ->update($updates);

        LegalEnforcementService::bumpRevision((int) TenantContext::getId());

        return true;
    }

    /**
     * Publish a version (make it the current version).
     */
    public static function publishVersion(int $vid): bool
    {
        $version = self::getVersion($vid);
        if (! $version || ! (bool) $version['is_draft']) {
            return false;
        }

        // 🔴 Bumped AFTER the transaction commits, so the new revision can never
        // be visible before the version it describes. The gate caches a verdict
        // per (tenant, revision, user), so bumping is what makes a newly published
        // document start blocking every member who has not accepted it — without a
        // bump this publish is invisible to the gate until each verdict expires.
        $published = DB::transaction(function () use ($vid, $version) {
            // Unset current flag on all other versions
            DB::table('legal_document_versions')
                ->where('document_id', $version['document_id'])
                ->update(['is_current' => 0]);

            // Set this version as current and published
            DB::table('legal_document_versions')
                ->where('id', $vid)
                ->update([
                    'is_current'   => 1,
                    'is_draft'     => 0,
                    'published_at' => now(),
                    'published_by' => auth()->id(),
                ]);

            // Update document's current version pointer
            DB::table('legal_documents')
                ->where('id', $version['document_id'])
                ->update(['current_version_id' => $vid]);

            return true;
        });

        if ($published) {
            LegalEnforcementService::bumpRevision((int) TenantContext::getId());
        }

        return $published;
    }

    /**
     * Delete a version (only drafts can be deleted).
     */
    public static function deleteVersion(int $vid): bool
    {
        $version = self::getVersion($vid);
        if (! $version || ! $version['is_draft']) {
            return false;
        }

        DB::table('legal_document_versions')
            ->where('id', $vid)
            ->whereIn('document_id', function ($q) {
                $q->select('id')->from('legal_documents')->where('tenant_id', TenantContext::getId());
            })
            ->delete();

        LegalEnforcementService::bumpRevision((int) TenantContext::getId());

        return true;
    }

    /**
     * The single canonical in-app path for a legal document.
     *
     * 🔴 Notifications used to emit TWO different shapes, each broken on the
     * frontend the other one targets. The bell link was `/{slug}` — a
     * React-shaped path like `/terms`, which the accessible frontend answered with
     * 404 until 2026-08-11. The email link was `/legal/{slug}`, which React had no
     * route for. So every "we have updated our terms" notification sent a member
     * to a dead end on one frontend or the other, depending on which link they
     * clicked.
     *
     * Both now use this. `/legal/{slug}` is the accessible frontend's real path
     * and Laravel's own route name (`govuk-alpha.legal.terms`); React gained
     * `legal/:slug` aliases, and web-uk redirects the bare `/terms` and `/privacy`
     * paths for links already sent.
     *
     * 🔴 Underscores become hyphens. `legal_documents.slug` falls back to
     * `document_type`, which is underscored (`community_guidelines`), and no route
     * on either frontend matches that — an unslugged row emitted a link that 404'd
     * everywhere. web-uk accepts both forms defensively; this emits only the
     * canonical one.
     */
    public static function documentPath(array $document): string
    {
        $slug = trim((string) ($document['slug'] ?? $document['document_type'] ?? ''));
        $slug = str_replace('_', '-', $slug);
        // Belt and braces: a slug is a URL segment, never a path.
        $slug = trim(preg_replace('/[^A-Za-z0-9-]+/', '-', $slug) ?? '', '-');

        return $slug === '' ? '/legal' : '/legal/' . strtolower($slug);
    }

    /**
     * Record acceptance of all current legal documents for a user.
     */
    public static function acceptAll(int $userId, string $method = 'registration'): int
    {
        $documents = DB::table('legal_documents')
            ->where('tenant_id', TenantContext::getId())
            ->where('is_active', true)
            ->where('requires_acceptance', true)
            ->where('acceptance_required_for', 'registration')
            ->whereNotNull('current_version_id')
            ->get();

        $accepted = 0;
        foreach ($documents as $doc) {
            $exists = DB::table('user_legal_acceptances')
                ->where('user_id', $userId)
                ->where('version_id', $doc->current_version_id)
                ->exists();

            if (! $exists) {
                // Get version number for denormalized column
                $version = DB::table('legal_document_versions')
                    ->where('id', $doc->current_version_id)
                    ->value('version_number') ?? 'unknown';

                DB::table('user_legal_acceptances')->insert([
                    'user_id'           => $userId,
                    'document_id'       => $doc->id,
                    'version_id'        => $doc->current_version_id,
                    'version_number'    => $version,
                    'acceptance_method' => $method,
                    'ip_address'        => request()->ip(),
                    'user_agent'        => request()->userAgent(),
                    'session_id'        => session()->getId(),
                    'accepted_at'       => now(),
                ]);
                $accepted++;
            }
        }

        // 🔴 Always, not only when something was inserted. The gate caches a
        // per-user verdict, and a stale "pending" verdict after accepting is an
        // accept → still blocked → accept loop with no way out but waiting for the
        // TTL. Clearing on the no-op path too means a member who accepted in
        // another tab is not left stuck either.
        LegalEnforcementService::forgetVerdict($userId, (int) TenantContext::getId());

        return $accepted;
    }

    /**
     * Record acceptance from request context.
     */
    public static function recordAcceptanceFromRequest(int $userId, int $documentId, int $versionId, string $method): void
    {
        // Get version number
        $version       = self::getVersion($versionId);
        $versionNumber = $version['version_number'] ?? 'unknown';

        DB::table('user_legal_acceptances')->updateOrInsert(
            ['user_id' => $userId, 'version_id' => $versionId],
            [
                'document_id'       => $documentId,
                'version_number'    => $versionNumber,
                'acceptance_method' => $method,
                'ip_address'        => request()->ip(),
                'user_agent'        => request()->userAgent(),
                'session_id'        => session()->getId(),
                'accepted_at'       => now(),
            ]
        );

        // Single-document accept (`POST /api/v2/legal/accept`) clears the verdict
        // too: this may have been the last outstanding document.
        LegalEnforcementService::forgetVerdict($userId, (int) TenantContext::getId());
    }

    /**
     * Check if a user has accepted the current version of a document type.
     */
    public static function hasAccepted(int $userId, string $type): bool
    {
        $doc = DB::table('legal_documents')
            ->where('tenant_id', TenantContext::getId())
            ->where('document_type', $type)
            ->where('is_active', true)
            ->first();

        if (! $doc || ! $doc->current_version_id) {
            return true;
        }

        return DB::table('user_legal_acceptances')
            ->where('user_id', $userId)
            ->where('version_id', $doc->current_version_id)
            ->exists();
    }

    /**
     * Get user's acceptance status for all required documents.
     */
    public static function getUserAcceptanceStatus(int $userId): array
    {
        $tenantId = TenantContext::getId();

        return DB::select("
            SELECT
                ld.id AS document_id,
                ld.document_type,
                ld.title,
                ld.requires_acceptance,
                ld.current_version_id,
                ldv.version_number AS current_version,
                ldv.effective_date,
                ula.id AS acceptance_id,
                ula.version_id AS accepted_version_id,
                ula.version_number AS accepted_version,
                ula.accepted_at,
                CASE
                    WHEN ula.version_id IS NULL THEN 'not_accepted'
                    WHEN ula.version_id = ld.current_version_id THEN 'current'
                    ELSE 'outdated'
                END AS acceptance_status
             FROM legal_documents ld
             LEFT JOIN legal_document_versions ldv ON ld.current_version_id = ldv.id
             LEFT JOIN user_legal_acceptances ula ON ula.user_id = ?
                 AND ula.document_id = ld.id
                 AND ula.version_id = (
                     SELECT MAX(ula2.version_id)
                     FROM user_legal_acceptances ula2
                     WHERE ula2.user_id = ? AND ula2.document_id = ld.id
                 )
             WHERE ld.tenant_id = ?
             AND ld.is_active = 1
             AND ld.requires_acceptance = 1
             AND ld.current_version_id IS NOT NULL
        ", [$userId, $userId, $tenantId]);
    }

    /**
     * Check if user has any pending acceptances.
     */
    public static function hasPendingAcceptances(int $userId): bool
    {
        $statuses = self::getUserAcceptanceStatus($userId);

        foreach ($statuses as $doc) {
            if (($doc->acceptance_status ?? '') !== 'current') {
                return true;
            }
        }

        return false;
    }

    /**
     * Compare two versions and generate an HTML diff.
     */
    public static function compareVersions(int $v1, int $v2): ?array
    {
        $version1 = self::getVersion($v1);
        $version2 = self::getVersion($v2);

        if (! $version1 || ! $version2) {
            return null;
        }

        $oldText = self::stripToPlainSentences($version1['content_plain'] ?: strip_tags($version1['content']));
        $newText = self::stripToPlainSentences($version2['content_plain'] ?: strip_tags($version2['content']));

        $diffHtml     = self::generateSimpleDiff($oldText, $newText);
        $changesCount = substr_count($diffHtml, 'diff-removed') + substr_count($diffHtml, 'diff-added');

        return [
            'version1'      => $version1,
            'version2'      => $version2,
            'diff_html'     => $diffHtml,
            'changes_count' => $changesCount,
        ];
    }

    /**
     * Get compliance summary for a tenant.
     */
    public static function getComplianceSummary(int $tenantId): array
    {
        $totalUsers = (int) self::eligibleMemberQuery($tenantId)->count();

        $documents = DB::table('legal_documents as ld')
            ->leftJoin('legal_document_versions as ldv', 'ld.current_version_id', '=', 'ldv.id')
            ->where('ld.tenant_id', $tenantId)
            ->where('ld.is_active', true)
            ->where('ld.requires_acceptance', true)
            ->whereNotNull('ld.current_version_id')
            ->select(
                'ld.id', 'ld.document_type', 'ld.title', 'ld.current_version_id',
                'ldv.version_number', 'ldv.effective_date'
            )
            ->get()
            ->map(function ($doc) use ($tenantId, $totalUsers) {
                $doc = (array) $doc;
                $versionId = (int) $doc['current_version_id'];
                $usersAccepted = (int) self::eligibleMemberQuery($tenantId)
                    ->whereExists(function ($query) use ($versionId) {
                        $query->select(DB::raw(1))
                            ->from('user_legal_acceptances')
                            ->whereColumn('user_legal_acceptances.user_id', 'users.id')
                            ->where('user_legal_acceptances.version_id', $versionId);
                    })
                    ->count();
                $doc['users_accepted'] = $usersAccepted;
                $doc['users_not_accepted'] = $totalUsers - $usersAccepted;
                $doc['acceptance_rate']    = $totalUsers > 0 ? round(($usersAccepted / $totalUsers) * 100, 1) : 0;
                return $doc;
            })
            ->all();

        $documentCount = count($documents);
        $totalAccepted = array_sum(array_column($documents, 'users_accepted'));
        $currentVersionIds = array_values(array_filter(array_map(
            static fn (array $document): int => (int) ($document['current_version_id'] ?? 0),
            $documents
        )));
        $usersPending = 0;

        if ($currentVersionIds !== []) {
            $usersPending = (int) self::eligibleMemberQuery($tenantId)
                ->where(function ($query) use ($currentVersionIds) {
                    foreach ($currentVersionIds as $versionId) {
                        $query->orWhereNotExists(function ($acceptance) use ($versionId) {
                            $acceptance->select(DB::raw(1))
                                ->from('user_legal_acceptances')
                                ->whereColumn('user_legal_acceptances.user_id', 'users.id')
                                ->where('user_legal_acceptances.version_id', $versionId);
                        });
                    }
                })
                ->count();
        }

        return [
            'total_users'               => $totalUsers,
            'overall_compliance_rate'    => ($documentCount > 0 && $totalUsers > 0) ? round(($totalAccepted / ($totalUsers * $documentCount)) * 100, 1) : 0,
            'users_pending_acceptance'   => $usersPending,
            'documents'                 => $documents,
        ];
    }

    /**
     * Get acceptances for a document version.
     * Verifies the version belongs to the current tenant.
     */
    public static function getVersionAcceptances(int $vid, int $limit = 50, int $offset = 0): array
    {
        return DB::table('user_legal_acceptances as ula')
            ->join('users as u', 'ula.user_id', '=', 'u.id')
            ->join('legal_document_versions as ldv', 'ula.version_id', '=', 'ldv.id')
            ->join('legal_documents as ld', 'ldv.document_id', '=', 'ld.id')
            ->where('ula.version_id', $vid)
            ->where('ld.tenant_id', TenantContext::getId())
            ->orderByDesc('ula.accepted_at')
            ->limit($limit)
            ->offset($offset)
            ->select('ula.*', 'u.name as user_name', 'u.email as user_email')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Export acceptance records for compliance audit.
     * Verifies the document belongs to the current tenant.
     */
    public static function exportAcceptanceRecords(int $docId, ?string $startDate = null, ?string $endDate = null): array
    {
        $query = DB::table('user_legal_acceptances as ula')
            ->join('users as u', 'ula.user_id', '=', 'u.id')
            ->join('legal_document_versions as ldv', 'ula.version_id', '=', 'ldv.id')
            ->join('legal_documents as ld', 'ula.document_id', '=', 'ld.id')
            ->where('ula.document_id', $docId)
            ->where('ld.tenant_id', TenantContext::getId())
            ->orderByDesc('ula.accepted_at')
            ->select(
                'ula.id as acceptance_id', 'u.id as user_id', 'u.name as user_name', 'u.email as user_email',
                'ldv.version_number', 'ula.accepted_at', 'ula.acceptance_method', 'ula.ip_address'
            );

        if ($startDate) {
            $query->where('ula.accepted_at', '>=', $startDate);
        }
        if ($endDate) {
            $query->where('ula.accepted_at', '<=', $endDate);
        }

        return $query->get()->map(fn ($r) => (array) $r)->all();
    }

    /**
     * Notify users of a document update.
     */
    public static function notifyUsersOfUpdate(
        int $docId,
        int $vid,
        bool $sendEmail = true,
        string $target = self::NOTIFY_NON_ACCEPTED
    ): int
    {
        if (! in_array($target, [self::NOTIFY_NON_ACCEPTED, self::NOTIFY_ALL], true)) {
            throw new \InvalidArgumentException('Invalid legal notification target');
        }

        $document = self::legacyGetById($docId);
        $version  = self::getVersion($vid);

        if (
            ! $document
            || ! $version
            || (int) ($version['document_id'] ?? 0) !== $docId
            || (int) ($document['current_version_id'] ?? 0) !== $vid
            || (bool) ($version['is_draft'] ?? true)
            || ! ($document['requires_acceptance'] ?? false)
        ) {
            return 0;
        }

        $tenantId = $document['tenant_id'];

        // Get users who need to re-accept. Include preferred_language so
        // each bell + email renders in that user's own locale rather than
        // the admin caller's locale when a new version is published.
        $usersQuery = self::eligibleMemberQuery((int) $tenantId);

        if ($target === self::NOTIFY_NON_ACCEPTED) {
            $usersQuery->whereNotExists(function ($q) use ($vid) {
                $q->select(DB::raw(1))
                  ->from('user_legal_acceptances')
                  ->whereColumn('user_legal_acceptances.user_id', 'users.id')
                  ->where('user_legal_acceptances.version_id', $vid);
            });
        }

        $users = $usersQuery
            ->select('id', 'name', 'first_name', 'email', 'preferred_language')
            ->get();
        $acceptedUserIds = [];
        if ($target === self::NOTIFY_ALL && $users->isNotEmpty()) {
            $acceptedUserIds = DB::table('user_legal_acceptances')
                ->where('version_id', $vid)
                ->whereIn('user_id', $users->pluck('id')->all())
                ->pluck('user_id')
                ->mapWithKeys(static fn ($id) => [(int) $id => true])
                ->all();
        }

        $docType   = $document['title'] ?? $document['document_type'] ?? 'document';
        $docPath   = self::documentPath($document);
        $reviewUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $docPath;
        $community = TenantContext::getName();

        $sentCount = 0;
        foreach ($users as $user) {
            $bellSent = LocaleContext::withLocale($user, function () use ($user, $document, $version, $docPath, $tenantId) {
                try {
                    DB::table('notifications')->insert([
                        'tenant_id'  => $tenantId,
                        'user_id'    => $user->id,
                        'type'       => 'legal_update',
                        'title'      => __('svc_notifications.legal.update_title', ['title' => $document['title']]),
                        'message'    => __('svc_notifications.legal.update_message', ['version' => $version['version_number'], 'title' => $document['title']]),
                        'link'       => $docPath,
                        'created_at' => now(),
                    ]);
                    return true;
                } catch (\Throwable $e) {
                    // Continue with other users
                    return false;
                }
            });
            if ($bellSent) {
                $sentCount++;
            }

            // The "all" audience is useful for a general in-app announcement,
            // but the email copy explicitly says acceptance is required. Do not
            // send that action-required email to somebody who has already accepted
            // this exact current version.
            $requiresAction = ! isset($acceptedUserIds[(int) $user->id]);
            if ($sendEmail && $requiresAction && ! empty($user->email)) {
                LocaleContext::withLocale($user, function () use ($user, $docType, $community, $reviewUrl, $tenantId) {
                    try {
                        $firstName = $user->first_name ?? (explode(' ', $user->name ?? '')[0] ?: __('emails.common.fallback_name'));

                        $html = EmailTemplateBuilder::make()
                            ->theme('warning')
                            ->title(__('emails_content.legal_update.title'))
                            ->previewText(__('emails_content.legal_update.preview', ['community' => $community, 'doc_type' => $docType]))
                            ->greeting($firstName)
                            ->paragraph(__('emails_content.legal_update.body', ['community' => $community, 'doc_type' => $docType]))
                            ->paragraph(__('emails_content.legal_update.action_required'))
                            ->button(__('emails_content.legal_update.cta'), $reviewUrl)
                            ->render();

                        if (!\App\Services\EmailDispatchService::sendRaw(
                            $user->email,
                            __('emails_content.legal_update.subject', ['community' => $community, 'doc_type' => $docType]),
                            $html,
                            null,
                            null,
                            null,
                            'legal_document',
                            ['tenant_id' => $tenantId]
                        )) {
                            Log::warning('[LegalDocumentService] email returned false for user ' . $user->id);
                        }
                    } catch (\Throwable $e) {
                        Log::warning('[LegalDocumentService] email failed for user ' . $user->id . ': ' . $e->getMessage());
                    }
                });
            }
        }

        if ($sentCount > 0) {
            DB::table('legal_document_versions')
                ->where('id', $vid)
                ->where('document_id', $docId)
                ->update([
                    'notification_sent' => 1,
                    'notification_sent_at' => now(),
                ]);
        }

        return $sentCount;
    }

    /**
     * Get count of users pending acceptance for a document version.
     */
    public static function getUsersPendingAcceptanceCount(int $docId, int $vid): int
    {
        $document = self::legacyGetById($docId);
        $version = self::getVersion($vid);
        if (
            ! $document
            || ! $version
            || (int) ($version['document_id'] ?? 0) !== $docId
            || (int) ($document['current_version_id'] ?? 0) !== $vid
            || ! ($document['requires_acceptance'] ?? false)
        ) {
            return 0;
        }

        return (int) self::eligibleMemberQuery((int) $document['tenant_id'])
            ->whereNotExists(function ($q) use ($vid) {
                $q->select(DB::raw(1))
                  ->from('user_legal_acceptances')
                  ->whereColumn('user_legal_acceptances.user_id', 'users.id')
                  ->where('user_legal_acceptances.version_id', $vid);
            })
            ->count();
    }

    /**
     * Users who are actually subject to the member acceptance gate.
     *
     * Administrators are deliberately exempt in EnsureLegalAcceptance so they
     * can always repair a broken legal document. Compliance figures and update
     * notifications must measure the same population as the gate.
     */
    private static function eligibleMemberQuery(int $tenantId): Builder
    {
        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNotIn('role', ['admin', 'tenant_admin', 'super_admin', 'god'])
            ->where(function ($query) {
                $query->whereNull('is_admin')->orWhere('is_admin', 0);
            })
            ->where(function ($query) {
                $query->whereNull('is_super_admin')->orWhere('is_super_admin', 0);
            })
            ->where(function ($query) {
                $query->whereNull('is_tenant_super_admin')->orWhere('is_tenant_super_admin', 0);
            })
            ->where(function ($query) {
                $query->whereNull('is_god')->orWhere('is_god', 0);
            });
    }

    /**
     * Get a current document by slug and tenant ID.
     */
    public static function getCurrentDocument(string $slug, int $tenantId): ?array
    {
        $record = DB::table('legal_documents as ld')
            ->leftJoin('legal_document_versions as ldv', 'ld.current_version_id', '=', 'ldv.id')
            ->where('ld.slug', $slug)
            ->where('ld.tenant_id', $tenantId)
            ->where('ld.is_active', true)
            ->select('ld.*', 'ldv.version_number', 'ldv.content', 'ldv.effective_date', 'ldv.summary_of_changes')
            ->first();

        return $record ? (array) $record : null;
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    private static function stripToPlainSentences(string $text): array
    {
        $text = preg_replace('/\s+/', ' ', trim($text));
        $sentences = preg_split('/(?<=[.!?])\s+/', $text, -1, PREG_SPLIT_NO_EMPTY);
        return array_values(array_filter(array_map('trim', $sentences)));
    }

    private static function generateSimpleDiff(array $old, array $new): string
    {
        $html = '<div class="diff-unified">';

        // Simple line-by-line comparison for reasonable-sized documents
        $maxLines = max(count($old), count($new));
        for ($i = 0; $i < $maxLines; $i++) {
            $oldLine = $old[$i] ?? null;
            $newLine = $new[$i] ?? null;

            if ($oldLine === $newLine) {
                $escaped = htmlspecialchars($newLine ?? '', ENT_QUOTES, 'UTF-8');
                $html .= '<div class="diff-line diff-unchanged"><span class="diff-indicator">&nbsp;</span> ' . $escaped . '</div>';
            } else {
                if ($oldLine !== null) {
                    $escaped = htmlspecialchars($oldLine, ENT_QUOTES, 'UTF-8');
                    $html .= '<div class="diff-line diff-removed"><span class="diff-indicator">−</span> <del>' . $escaped . '</del></div>';
                }
                if ($newLine !== null) {
                    $escaped = htmlspecialchars($newLine, ENT_QUOTES, 'UTF-8');
                    $html .= '<div class="diff-line diff-added"><span class="diff-indicator">+</span> <ins>' . $escaped . '</ins></div>';
                }
            }
        }

        $html .= '</div>';
        return $html;
    }
}
