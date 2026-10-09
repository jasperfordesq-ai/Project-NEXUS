<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\MemberImport;

use App\Services\AuditLogService;
use App\Services\Enterprise\GdprService;
use App\Support\Wallet\OpeningBalance;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Takes back a member import: the members it created are removed again, so a
 * wrong file (or an import stopped half way) can be corrected and imported again.
 *
 * Only members the import created and nobody has touched since are removed.
 * A member is KEPT, and counted under the reason, when they have signed in, are
 * not a plain member, have any ledger entry besides the import's opening
 * balance, or no longer hold exactly that opening balance. Nothing a member
 * did is ever undone.
 *
 * "Removed" is the platform's ordinary member deletion (GDPR erasure: the row
 * is anonymised in place and the address is freed), one member per transaction
 * so a failure keeps that member whole and the rest go on. The opening-balance
 * ledger entry is marked cancelled and the balance returns to zero, so the
 * hours do not stay in the community's totals. Welcome emails that have not
 * gone yet are cancelled. The audit entries of the import stay.
 *
 * Like the import, the work is paced by the browser: each call does at most
 * TIME_BUDGET_SECONDS of removals and says whether anything is left (`done`).
 * Erasing one member runs dozens of queries, so 5,000 in one request would
 * outlive the browser's wait (measured 9 Oct 2026: the page reported a failure
 * at 30 s while the server carried on). A pass walks the import's members from
 * the start, so a member removed by an earlier pass costs one SELECT and is
 * counted as already removed; the pass that finishes within the budget has
 * seen every member, and its `kept` counts are therefore complete.
 */
final class MemberImportUndo
{
    public const ACTION_UNDONE = 'member_import_undone';
    public const TIME_BUDGET_SECONDS = 8.0;

    public const KEPT_SIGNED_IN = 'signed_in';
    public const KEPT_NOT_PLAIN_MEMBER = 'not_plain_member';
    public const KEPT_HAS_ACTIVITY = 'has_activity';
    public const KEPT_BALANCE_CHANGED = 'balance_changed';
    public const KEPT_FAILED = 'failed';

    public function __construct(private readonly AuditLogService $audit)
    {
    }

    /**
     * One pass. `done` is false when the time budget ran out with members still to
     * look at; the caller repeats the call until it is true. `removed` counts this
     * pass only; `already_removed` and `kept` describe every member the pass reached.
     *
     * @return array{import_id: string, done: bool, remaining: int, removed: int, already_removed: int, kept: array<string, int>, hours_removed: string}
     */
    public function undo(string $importId, int $tenantId, int $adminId, float $budgetSeconds = self::TIME_BUDGET_SECONDS): array
    {
        $startedAt = microtime(true);
        $kept = [];
        $removed = 0;
        $already = 0;
        $cents = 0;

        $imported = DB::table('org_audit_log')
            ->where('tenant_id', $tenantId)
            ->where('action', MemberImportWriter::ACTION_MEMBER_IMPORTED)
            ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(details, '$.import_id')) = ?", [$importId])
            ->orderBy('id')
            ->get(['target_user_id', 'details']);

        $total = $imported->count();
        $reached = 0;
        foreach ($imported as $entry) {
            // At least one real decision (a removal or a keep) per pass, so a slow server
            // still makes progress: skipping members an earlier pass removed does not count.
            if (($removed > 0 || $kept !== []) && microtime(true) - $startedAt > $budgetSeconds) {
                break;
            }
            $reached++;
            $userId = (int) $entry->target_user_id;
            $details = json_decode((string) $entry->details, true);
            $opening = is_array($details) ? (string) ($details['opening_balance'] ?? '0.00') : '0.00';

            try {
                $outcome = DB::transaction(fn (): string => $this->removeOne($userId, $tenantId, $adminId, $opening), 3);
            } catch (\Throwable $e) {
                Log::error('member_import.undo_failed', ['tenant_id' => $tenantId, 'import_id' => $importId, 'user_id' => $userId, 'error' => $e->getMessage()]);
                $outcome = self::KEPT_FAILED;
            }

            if ($outcome === 'removed') {
                $removed++;
                $cents += (int) round(((float) $opening) * 100);
            } elseif ($outcome === 'already_removed') {
                $already++;
            } else {
                $kept[$outcome] = ($kept[$outcome] ?? 0) + 1;
            }
        }

        $result = [
            'import_id' => $importId,
            'done' => $reached >= $total,
            'remaining' => $total - $reached,
            'removed' => $removed,
            'already_removed' => $already,
            'kept' => $kept,
            'hours_removed' => OpeningBalance::formatCents($cents),
        ];

        // One entry per pass: together they are the full record of the undo.
        $this->audit->logAction($tenantId, self::ACTION_UNDONE, $adminId, $result);

        return $result;
    }

    /** @return 'removed'|'already_removed'|string a KEPT_* reason */
    private function removeOne(int $userId, int $tenantId, int $adminId, string $opening): string
    {
        $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->lockForUpdate()->first();
        if ($user === null || $user->deleted_at !== null || $user->anonymized_at !== null) {
            return 'already_removed';
        }
        if ($user->last_login_at !== null) {
            return self::KEPT_SIGNED_IN;
        }
        if ($user->role !== 'member' || (int) $user->is_admin === 1 || (int) $user->is_super_admin === 1
            || (int) $user->is_tenant_super_admin === 1 || (int) $user->is_god === 1) {
            return self::KEPT_NOT_PLAIN_MEMBER;
        }

        $entries = DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->where(fn ($q) => $q->where('sender_id', $userId)->orWhere('receiver_id', $userId))
            ->get(['id', 'transaction_type', 'sender_id', 'status']);
        if ($entries->count() !== 1 || $entries[0]->transaction_type !== OpeningBalance::TYPE || (int) $entries[0]->sender_id !== 0) {
            return self::KEPT_HAS_ACTIVITY;
        }
        if (OpeningBalance::formatCents((int) round(((float) $user->balance) * 100)) !== OpeningBalance::formatCents((int) round(((float) $opening) * 100))) {
            return self::KEPT_BALANCE_CHANGED;
        }

        DB::table('transactions')->where('id', $entries[0]->id)->where('tenant_id', $tenantId)
            ->update(['status' => 'cancelled', 'updated_at' => now()]);
        DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->update(['balance' => 0]);
        DB::table('member_invitation_outbox')
            ->where('tenant_id', $tenantId)->where('user_id', $userId)->where('status', 'pending')
            ->update(['status' => 'skipped', 'skip_reason' => 'import_undone', 'updated_at' => now()]);

        (new GdprService($tenantId))->executeAccountDeletion($userId, $adminId);

        return 'removed';
    }
}
