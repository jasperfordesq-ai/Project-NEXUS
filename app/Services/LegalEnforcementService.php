<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Decides whether a member still owes an acceptance, for the purpose of BLOCKING
 * them. `App\Http\Middleware\EnsureLegalAcceptance` is its only caller.
 *
 * 🔴 Why this is a separate class rather than a method on LegalDocumentService.
 *
 * `LegalDocumentService::getUserAcceptanceStatus()` and the near-identical copy in
 * `LegalAcceptanceController` are what the React app's own gate and the
 * acceptance screens read. Their SQL deliberately ignores
 * `legal_documents.acceptance_required_for`. Teaching that query to honour the
 * column would silently change what React blocks on — a behaviour change to a
 * live production gate, made by editing a query in passing. So enforcement gets
 * its own query, and the display shape stays exactly as it is.
 *
 * 🔴 `acceptance_required_for` has been written and validated since the feature
 * was built (`AdminEnterpriseController::createLegalDoc`) and read by nothing at
 * all. A community that set a document to `none` has been telling the platform
 * "do not gate on this" and being ignored. This is the first code to listen.
 *
 * Caching. Two keys:
 *
 *   legal:rev:{tenantId}                     — a counter, bumped whenever any
 *                                              document or version changes
 *   legal:gate:{tenantId}:{rev}:{userId}     — that user's verdict
 *
 * Because the revision is part of the verdict KEY, publishing a version
 * invalidates every user's verdict at once with no fan-out and no scan. That
 * matters: a tenant can have tens of thousands of members and this runs on write
 * requests.
 */
class LegalEnforcementService
{
    /** Verdict: nothing outstanding. */
    public const VERDICT_CLEAR = 'clear';

    /** Verdict: at least one enforced document is unaccepted or out of date. */
    public const VERDICT_PENDING = 'pending';

    /**
     * Does this user owe an acceptance that should block them?
     *
     * 🔴 Returns FALSE (not blocked) on any failure. See the note on the
     * middleware: a legal gate that fires because Redis blinked takes the product
     * down, which is a worse outcome than a member getting one more request
     * through before they accept.
     */
    public static function isBlocked(int $userId, int $tenantId): bool
    {
        try {
            return self::verdictFor($userId, $tenantId) === self::VERDICT_PENDING;
        } catch (\Throwable $e) {
            Log::warning('[LegalEnforcement] verdict failed, failing open: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * The cached verdict, computing and storing it when absent.
     */
    public static function verdictFor(int $userId, int $tenantId): string
    {
        $cache = app(RedisCache::class);
        $revision = self::revision($tenantId, $cache);
        $key = "legal:gate:{$tenantId}:{$revision}:{$userId}";

        $cached = $cache->get($key);
        if ($cached === self::VERDICT_CLEAR || $cached === self::VERDICT_PENDING) {
            return $cached;
        }

        $verdict = self::pendingForEnforcement($userId, $tenantId) === []
            ? self::VERDICT_CLEAR
            : self::VERDICT_PENDING;

        $cache->set($key, $verdict, (int) config('legal.verdict_ttl', 300));

        return $verdict;
    }

    /**
     * The documents this user must accept before being allowed to act.
     *
     * Differs from the display query in exactly one way: it filters on
     * `acceptance_required_for`. Everything else is deliberately identical, so a
     * member is never told they are clear on the acceptance screen while the gate
     * still blocks them.
     *
     * @return array<int, object>
     */
    public static function pendingForEnforcement(int $userId, int $tenantId): array
    {
        $modes = (array) config('legal.enforced_acceptance_modes', ['registration', 'login', 'first_use']);
        if ($modes === []) {
            return [];
        }

        // Never interpolate — build the placeholder list instead. (An array
        // passed as one parameter is the classic failure here.)
        $placeholders = implode(',', array_fill(0, count($modes), '?'));

        $rows = DB::select("
            SELECT
                ld.id AS document_id,
                ld.document_type,
                ld.title,
                ld.current_version_id,
                ldv.version_number AS current_version,
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
            AND ld.acceptance_required_for IN ({$placeholders})
        ", array_merge([$userId, $userId, $tenantId], array_values($modes)));

        return array_values(array_filter(
            $rows,
            static fn ($row) => ($row->acceptance_status ?? '') !== 'current'
        ));
    }

    /**
     * The tenant's current legal revision, creating it when absent.
     *
     * A missing key means "we do not know what changed", so it starts a fresh
     * counter rather than assuming the previous value. The revision TTL is longer
     * than the verdict TTL (enforced by the note in `config/legal.php`), so every
     * verdict written under an earlier counter value has already expired by the
     * time the counter can repeat.
     */
    public static function revision(int $tenantId, ?RedisCache $cache = null): int
    {
        $cache ??= app(RedisCache::class);
        $value = $cache->get("legal:rev:{$tenantId}");

        if (is_numeric($value)) {
            return (int) $value;
        }

        $cache->set("legal:rev:{$tenantId}", 1, (int) config('legal.revision_ttl', 3600));
        return 1;
    }

    /**
     * Invalidate every verdict for a tenant by moving its revision forward.
     *
     * 🔴 Called from every LegalDocumentService mutation. A missed call means a
     * member who has just accepted stays blocked until the verdict TTL expires —
     * and, worse, a member facing a NEWLY published document is not blocked at
     * all, which is the case the gate exists for.
     */
    public static function bumpRevision(int $tenantId): void
    {
        try {
            $cache = app(RedisCache::class);
            $ttl = (int) config('legal.revision_ttl', 3600);
            $current = $cache->get("legal:rev:{$tenantId}");
            $cache->set("legal:rev:{$tenantId}", (is_numeric($current) ? (int) $current : 0) + 1, $ttl);
        } catch (\Throwable $e) {
            // Non-fatal by design: failing to bump must not fail the admin's
            // publish. The verdict TTL bounds the staleness to minutes.
            Log::warning('[LegalEnforcement] revision bump failed: ' . $e->getMessage());
        }
    }

    /**
     * Drop one user's cached verdict.
     *
     * 🔴 This is what makes accept-all take effect immediately. Without it, a
     * member accepts, retries the action they were blocked on, and is blocked
     * again by the stale positive verdict — an accept → blocked → accept loop
     * with no way out but waiting. There is a test for exactly that sequence.
     */
    public static function forgetVerdict(int $userId, int $tenantId): void
    {
        try {
            $cache = app(RedisCache::class);
            $cache->delete("legal:gate:{$tenantId}:" . self::revision($tenantId, $cache) . ":{$userId}");
        } catch (\Throwable $e) {
            Log::warning('[LegalEnforcement] verdict forget failed: ' . $e->getMessage());
        }
    }
}
