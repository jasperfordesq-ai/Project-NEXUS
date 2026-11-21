<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\MemberImport;

use App\Models\ActivityLog;
use App\Services\AuditLogService;
use App\Services\Identity\AdminCreatedAccountAdmission;
use App\Support\Billing\JoiningGate;
use App\Support\Wallet\OpeningBalance;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Runs one batch of a checked import. Batches must arrive in order; a batch
 * that was already run is answered from the session without writing anything
 * (a lost response, a double click). The server also times itself: it stops
 * a batch early after TIME_BUDGET_SECONDS so no request runs long.
 *
 * The admission decision (held for the community's identity check or not) is
 * taken once, on the first batch, and stored: a change to the joining rules
 * mid-import does not split one import into two kinds of member. Whether the
 * new members are sent a welcome invitation is fixed on the first batch too.
 *
 * Resolve it per request, never as a singleton: its writer computes one
 * password hash and reuses it for every member it creates.
 */
final class MemberImportRunner
{
    public const MIN_BATCH = 10;
    public const MAX_BATCH = 200;
    public const TIME_BUDGET_SECONDS = 8.0;
    public const ACTION_IMPORT_COMPLETED = 'member_import_completed';
    /** A row's code when the member limit left it out. */
    public const LEFT_OUT_MEMBER_LIMIT = 'member_limit_reached';

    public function __construct(
        private readonly MemberImportWriter $writer,
        private readonly AuditLogService $audit,
        private readonly InvitationOutbox $invitations,
    ) {
    }

    /**
     * @param bool|null $identityAttested honoured only on the first batch (status 'ready');
     *                                    null leaves the session's value unchanged
     * @param bool|null $sendInvitations queue each new (not held) member's welcome invitation;
     *                                   honoured only on the first batch, like $identityAttested
     * @param bool $stop the admin pressed Stop: write nothing, mark the import
     *                   stopped and discard the held rows now rather than leave
     *                   them to expire. Same ordering rules as a batch.
     * @return array<string, mixed>
     * @throws MemberImportBusy | MemberImportNotFound | MemberImportOutOfOrder
     */
    public function runBatch(string $importId, int $tenantId, int $adminId, int $from, int $count, ?bool $identityAttested, bool $stop = false, ?bool $sendInvitations = null): array
    {
        $lock = MemberImportSession::lock($importId);
        if (!$lock->get()) {
            throw new MemberImportBusy();
        }
        try {
            $session = MemberImportSession::load($importId, $tenantId, $adminId);
            if ($session === null) {
                throw new MemberImportNotFound();
            }
            $startedAt = microtime(true);
            $total = (int) $session['total'];
            $session['totals']['admission_incomplete'] ??= 0;
            $session['admission_incomplete_rows'] ??= [];
            // Imports saved before invitations existed send none.
            $session['send_invitations'] ??= false;
            $session['totals']['invitations_queued'] ??= 0;
            // Imports saved before the member limit's door existed left nobody out.
            $session['totals']['left_out'] ??= 0;
            $session['left_out_rows'] ??= [];
            $session['left_out_max'] ??= null;
            $session['left_out_by'] ??= null;
            $session['new_accounts'] ??= 0;

            // Every member was written but the request ended before the import was
            // marked complete: whatever position the browser names, finish it now.
            $unfinished = $session['status'] === 'running' && $session['next_index'] >= $total;
            if (!$unfinished) {
                if (in_array($session['status'], ['stopped', 'completed'], true) || $from < $session['next_index']) {
                    return $this->state($session, 0, 0, $startedAt);
                }
                if ($from > $session['next_index']) {
                    throw new MemberImportOutOfOrder();
                }
            }

            $processed = 0;
            $created = 0;
            // An admin stop. Not for an import whose every member is already
            // written: that one is finished below instead, so it is audited.
            if ($stop && !$unfinished) {
                $rows = MemberImportSession::rows($session);
                $session['status'] = 'stopped';
                $session['stop'] = [
                    'row' => isset($rows[$session['next_index']]) ? (int) $rows[$session['next_index']]['source_row'] : 0,
                    'code' => 'stopped_by_admin',
                    'params' => [],
                ];
            }
            if (!$unfinished && $session['status'] !== 'stopped') {
                // Read once per batch. Rows that expired mid-import cannot be
                // continued; the members written so far stay.
                $rows = MemberImportSession::rows($session);
                if ($rows === null) {
                    throw new MemberImportNotFound();
                }

                if ($session['status'] === 'ready') {
                    if ($identityAttested !== null) {
                        $session['identity_attested'] = $identityAttested;
                    }
                    if ($sendInvitations !== null) {
                        $session['send_invitations'] = $sendInvitations;
                    }
                    $session['admission'] = AdminCreatedAccountAdmission::decide($tenantId, (bool) $session['identity_attested'], true);
                    $session['status'] = 'running';
                }
                // A running import saved before the decision was stored decides once, now.
                $session['admission'] ??= AdminCreatedAccountAdmission::decide($tenantId, (bool) $session['identity_attested'], true);
                $decision = $session['admission'];
                $count = max(self::MIN_BATCH, min(self::MAX_BATCH, $count));

                // "Stop new members joining" (JoiningGate): the import is the one
                // door that knows its batch size, so it takes at most the room
                // left and reports the rest, rather than refusing the file. A new
                // account does not count as active until it signs in, so the
                // accounts this import has already added are taken off the room
                // as well; otherwise every batch would see the same room again.
                $room = JoiningGate::roomLeft($tenantId);
                $allowance = $room === null ? null : max(0, $room - (int) $session['new_accounts']);

                while ($processed < $count && $session['next_index'] < $total) {
                    if ($processed > 0 && microtime(true) - $startedAt > self::TIME_BUDGET_SECONDS) {
                        break;
                    }
                    $row = $rows[$session['next_index']];
                    if ($allowance !== null && $allowance <= 0 && !$this->emailInCommunity($row, $tenantId)) {
                        // Left out, never written. A row whose address is already
                        // here goes on to the writer, which either recognises this
                        // import's own member or stops the import, as before.
                        if ($session['left_out_max'] === null) {
                            $cap = JoiningGate::tightest($tenantId);
                            $session['left_out_max'] = (int) ($cap['max'] ?? 0);
                            $session['left_out_by'] = (int) ($cap['tenant_id'] ?? $tenantId);
                        }
                        // A community above's member number is not this
                        // community's to show: null when the limit is not its own.
                        $ownLimit = (int) ($session['left_out_by'] ?? $tenantId) === $tenantId;
                        $session['left_out_rows'][] = [
                            'row' => (int) $row['source_row'],
                            'column' => null,
                            'code' => self::LEFT_OUT_MEMBER_LIMIT,
                            'params' => ['max' => $ownLimit ? (int) $session['left_out_max'] : null],
                        ];
                        $session['totals']['left_out']++;
                        $session['next_index']++;
                        $processed++;
                        MemberImportSession::save($session);
                        continue;
                    }
                    try {
                        $out = $this->writer->write($row, $tenantId, $adminId, $decision, $importId, (bool) $session['send_invitations'], (string) $session['file_sha256']);
                    } catch (MemberImportStopped $e) {
                        $session['status'] = 'stopped';
                        $session['stop'] = ['row' => (int) $row['source_row'], 'code' => $e->reason, 'params' => $e->params];
                        break;
                    }
                    $session['next_index']++;
                    $session['totals']['created']++;
                    $session['totals']['balance_cents'] += $out['balance_cents'];
                    $session['totals']['zeroed'] += $out['zeroed'] ? 1 : 0;
                    $session['totals']['invitations_queued'] += $out['invitation_queued'] ? 1 : 0;
                    if (!$out['admission_complete']) {
                        // Created, but the identity step did not run: the admin follows these up.
                        $session['totals']['admission_incomplete']++;
                        $session['admission_incomplete_rows'][] = (int) $row['source_row'];
                    }
                    $processed++;
                    $created += $out['already'] ? 0 : 1;
                    if (!$out['already']) {
                        // Only a new account uses up room; a row for a member
                        // who already exists never does.
                        $session['new_accounts']++;
                        if ($allowance !== null) {
                            $allowance--;
                        }
                    }
                    // Progress is saved after every member, so a crash loses at most
                    // the bookkeeping for one row — which the writer then recognises.
                    MemberImportSession::save($session);
                }
            }

            if ($session['status'] === 'stopped') {
                // A stop is final (the admin checks a corrected file), so the rows go now.
                MemberImportSession::save($session);
                MemberImportSession::discardRows($session);
            } elseif ($session['status'] === 'running' && $session['next_index'] >= $total) {
                $this->complete($session, $importId, $tenantId, $adminId, $total);
            } else {
                MemberImportSession::save($session);
            }

            return $this->state($session, $processed, $created, $startedAt);
        } finally {
            $lock->release();
        }
    }

    /**
     * The running → completed transition, run once. The completion audit is
     * written first and the state saved as completed straight after it: if the
     * audit fails the import stays running and the next request retries the
     * completion, and once it is saved no request can complete it again.
     *
     * @param array<string, mixed> $session
     */
    private function complete(array &$session, string $importId, int $tenantId, int $adminId, int $total): void
    {
        $this->audit->logAction($tenantId, self::ACTION_IMPORT_COMPLETED, $adminId, [
            'import_id' => $importId,
            'file_name' => $session['file_name'],
            'file_sha256' => $session['file_sha256'],
            'members_created' => $session['totals']['created'],
            'opening_balance_total' => OpeningBalance::formatCents($session['totals']['balance_cents']),
            'negative_balances_zeroed' => $session['totals']['zeroed'],
            'admission_incomplete' => $session['totals']['admission_incomplete'],
            'identity_attested' => (bool) $session['identity_attested'],
            'invitations_queued' => $session['totals']['invitations_queued'],
            'members_left_out' => $session['totals']['left_out'],
        ]);
        $session['status'] = 'completed';
        $session['finished_at'] = now()->toIso8601String();
        MemberImportSession::save($session);

        // Secondary records: a failure is logged and never reopens the import.
        $created = (int) $session['totals']['created'];
        try {
            $this->audit->logBulkImport($adminId, $created, 0, $total);
        } catch (\Throwable $e) {
            Log::error('member_import.bulk_import_audit_failed', ['tenant_id' => $tenantId, 'import_id' => $importId, 'error' => $e->getMessage()]);
        }
        try {
            // The admin activity feed, worded as the old import worded it.
            ActivityLog::log($adminId, 'admin_bulk_import_users', "Bulk imported {$created} users (0 skipped)");
        } catch (\Throwable $e) {
            Log::error('member_import.activity_log_failed', ['tenant_id' => $tenantId, 'import_id' => $importId, 'error' => $e->getMessage()]);
        }

        // Personal data is not held once it is no longer needed. The progress
        // record stays, so a replayed batch still answers.
        MemberImportSession::discardRows($session);
    }

    /**
     * Whether the row's address already belongs to an account here, as the
     * writer matches it (TRIM). Such a row is never left out by the member
     * limit: it adds nobody.
     *
     * @param array<string, mixed> $row
     */
    private function emailInCommunity(array $row, int $tenantId): bool
    {
        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereRaw('TRIM(email) = ?', [trim((string) $row['email'])])
            ->exists();
    }

    /**
     * @param array<string, mixed> $session
     * @return array<string, mixed>
     */
    private function state(array $session, int $processed, int $created, float $startedAt): array
    {
        // Before the first batch nothing is fixed yet, so say what would happen now.
        $held = isset($session['admission']['held'])
            ? (bool) $session['admission']['held']
            : AdminCreatedAccountAdmission::decide((int) $session['tenant_id'], (bool) $session['identity_attested'], true)['held'];
        $queued = (int) $session['totals']['invitations_queued'];
        $leftOut = (int) ($session['totals']['left_out'] ?? 0);

        return [
            'import_id' => $session['id'],
            'status' => $session['status'],
            'next_index' => $session['next_index'],
            'total' => (int) $session['total'],
            'totals' => [
                'created' => $session['totals']['created'],
                'balance' => OpeningBalance::formatCents($session['totals']['balance_cents']),
                'zeroed' => $session['totals']['zeroed'],
                'admission_incomplete' => $session['totals']['admission_incomplete'],
                'invitations_queued' => $queued,
                'left_out' => $leftOut,
            ],
            // About how long until this import's invitations have gone. The sender's pace
            // is shared by every community, so it is read from the whole queue.
            'invitations_eta_minutes' => $queued > 0 ? $this->invitations->etaMinutes() : 0,
            'admission_incomplete_rows' => array_values($session['admission_incomplete_rows']),
            // Rows the member limit left out ("stop new members joining"),
            // shaped like the check's per-row problems, and why, for the admin.
            'left_out_rows' => array_values($session['left_out_rows'] ?? []),
            'left_out_message' => $leftOut > 0
                ? JoiningGate::adminMessage(
                    ['tenant_id' => (int) ($session['left_out_by'] ?? $session['tenant_id']), 'max' => (int) ($session['left_out_max'] ?? 0)],
                    (int) $session['tenant_id']
                )
                : null,
            'stop' => $session['stop'],
            'held' => $held,
            'batch' => ['processed' => $processed, 'created' => $created, 'duration_ms' => (int) round((microtime(true) - $startedAt) * 1000)],
        ];
    }
}
