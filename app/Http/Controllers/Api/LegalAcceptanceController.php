<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\Http\Middleware\EnsureLegalAcceptance;
use App\Services\LegalEnforcementService;

/**
 * LegalAcceptanceController -- Legal document acceptance status and bulk accept.
 *
 * Native Eloquent implementation — no delegation to legacy controller.
 */
class LegalAcceptanceController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /api/v2/legal/acceptance/status
     *
     * Returns the current user's legal acceptance status for all required documents.
     *
     * Response:
     * {
     *   "data": {
     *     "has_pending": bool,
     *     "enforcement_blocking": bool,   // does the platform actually refuse
     *                                     // requests now? false under `off` and
     *                                     // `report`. Clients MUST read this
     *                                     // rather than inferring from
     *                                     // has_pending — see the field comment.
     *     "blocking_pending": bool,       // is any pending document one the server
     *                                     // will actually refuse writes over? false
     *                                     // when every pending document is set to
     *                                     // display-only via acceptance_required_for.
     *                                     // A client that interposes should require
     *                                     // enforcement_blocking AND blocking_pending.
     *     "documents": [
     *       {
     *         "document_id": int,
     *         "document_type": string,
     *         "title": string,
     *         "current_version_id": int|null,
     *         "current_version": string|null,
     *         "acceptance_status": "current"|"outdated"|"not_accepted",
     *         "accepted_at": string|null
     *       }
     *     ]
     *   }
     * }
     */
    public function getStatus(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $documents = $this->getUserAcceptanceStatus($userId, $tenantId);
        $hasPending = collect($documents)->contains(fn ($doc) => $doc->acceptance_status !== 'current');

        return $this->respondWithData([
            'has_pending' => $hasPending,
            // 🔴 Whether the platform actually REFUSES requests right now.
            //
            // `has_pending` answers "does this member owe an acceptance?".
            // It does NOT answer "will anything stop them?" — under
            // `LEGAL_ENFORCEMENT_MODE=report` the answer is no, by design, because
            // report mode exists to size the blast radius without blocking anyone.
            //
            // web-uk previously decided for itself, from `has_pending` alone, and so
            // blocked every accessible-frontend member even in `report` and `off`.
            // Clients must not infer enforcement; they read this. It is computed by
            // the middleware's own predicate, so the gate and the clients cannot
            // hold different views of who is blocked.
            'enforcement_blocking' => EnsureLegalAcceptance::modeBlocks(),
            // 🔴 Whether any pending document is one the SERVER will actually refuse
            // writes over.
            //
            // `has_pending` above comes from the DISPLAY query, which deliberately
            // ignores `acceptance_required_for` — that column says WHEN a document must
            // be accepted, and a community can set it so a document is shown but never
            // gates. The server gate honours it; the display query does not, on purpose,
            // because changing that SQL would silently change what React shows.
            //
            // The consequence before this field existed: a document set to "do not gate
            // on this" still had web-uk's interstitial standing in front of every page,
            // while the API happily accepted the member's writes. The two halves
            // disagreed about who was blocked.
            //
            // Computed with the gate's own query, so they cannot drift apart.
            'blocking_pending' => LegalEnforcementService::pendingForEnforcement($userId, (int) $tenantId) !== [],
            'documents'   => collect($documents)->map(fn ($doc) => [
                'document_id'        => (int) $doc->document_id,
                'document_type'      => $doc->document_type,
                'title'              => $doc->title,
                'current_version_id' => $doc->current_version_id ? (int) $doc->current_version_id : null,
                'current_version'    => $doc->current_version,
                'acceptance_status'  => $doc->acceptance_status,
                'accepted_at'        => $doc->accepted_at,
            ])->values()->all(),
        ]);
    }

    /**
     * POST /api/v2/legal/acceptance/accept-all
     *
     * Accepts all documents the current user has not yet accepted (or that
     * have been updated since their last acceptance).
     *
     * Response:
     * {
     *   "data": {
     *     "accepted": ["terms", "privacy"],
     *     "message": "All documents accepted"
     *   }
     * }
     */
    public function acceptAll(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $documents = $this->getUserAcceptanceStatus($userId, $tenantId);
        $pending = collect($documents)->filter(fn ($doc) => $doc->acceptance_status !== 'current');

        if ($pending->isEmpty()) {
            return $this->respondWithData([
                'accepted' => [],
                'message'  => __('api.legal.no_documents_require_acceptance'),
            ]);
        }

        $accepted = [];
        $errors   = [];

        // Wrap the bulk-accept in a transaction with SELECT ... FOR UPDATE on
        // the affected documents. This prevents races where an admin mutates
        // requires_acceptance / current_version_id between our status check
        // and our insert — we'd otherwise record acceptance of a version the
        // admin just deactivated.
        DB::transaction(function () use ($pending, $userId, $tenantId, &$accepted, &$errors) {
            $docIds = collect($pending)
                ->filter(fn ($d) => !empty($d->current_version_id))
                ->pluck('document_id')
                ->map(fn ($id) => (int) $id)
                ->all();

            if (empty($docIds)) {
                return;
            }

            // Lock the document rows for the duration of the transaction.
            $locked = DB::table('legal_documents')
                ->whereIn('id', $docIds)
                ->where('tenant_id', $tenantId)
                ->where('is_active', 1)
                ->where('requires_acceptance', 1)
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            foreach ($pending as $doc) {
                if (empty($doc->current_version_id)) {
                    continue;
                }

                // Re-verify inside the lock: the doc must still be active,
                // still require acceptance, and the version we're recording
                // must still be the current_version_id.
                $fresh = $locked->get((int) $doc->document_id);
                if (!$fresh || (int) $fresh->current_version_id !== (int) $doc->current_version_id) {
                    continue; // document changed — skip silently
                }

                try {
                    DB::table('user_legal_acceptances')->insert([
                        'user_id'           => $userId,
                        'document_id'       => (int) $doc->document_id,
                        'version_id'        => (int) $doc->current_version_id,
                        'version_number'    => $doc->current_version,
                        'acceptance_method' => 'login_prompt',
                        'ip_address'        => request()->ip(),
                        'user_agent'        => request()->userAgent(),
                        'accepted_at'       => now(),
                    ]);
                    $accepted[] = $doc->document_type;
                } catch (\Throwable $e) {
                    $errors[] = $doc->document_type;
                }
            }
        });

        if (! empty($errors)) {
            return $this->respondWithError(
                'LEGAL_ACCEPT_FAILED',
                'Failed to record acceptance for some documents: ' . implode(', ', $errors),
                null,
                500
            );
        }

        // 🔴 This method inserts into user_legal_acceptances DIRECTLY rather than
        // through LegalDocumentService, so it does not inherit that service's
        // cache invalidation. Without this line a member accepts here, retries the
        // action they were blocked on, and is blocked again by their own stale
        // verdict — an accept → blocked → accept loop. Tested explicitly.
        LegalEnforcementService::forgetVerdict($userId, $tenantId);

        return $this->respondWithData([
            'accepted' => $accepted,
            'message'  => __('api.legal.all_documents_accepted'),
        ]);
    }

    // ================================================================
    // Private helpers
    // ================================================================

    /**
     * Get user's acceptance status for all required documents.
     *
     * Replicates the exact SQL from LegalDocumentService::getUserAcceptanceStatus()
     * using Laravel's query builder.
     *
     * @return array<object>
     */
    private function getUserAcceptanceStatus(int $userId, int $tenantId): array
    {
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
}
