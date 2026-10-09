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
use App\Support\Wallet\OpeningBalance;
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
                    $session['admission'] = AdminCreatedAccountAdmission::decide($tenantId, (bool) $session['identity_attested']);
                    $session['status'] = 'running';
                }
                // A running import saved before the decision was stored decides once, now.
                $session['admission'] ??= AdminCreatedAccountAdmission::decide($tenantId, (bool) $session['identity_attested']);
                $decision = $session['admission'];
                $count = max(self::MIN_BATCH, min(self::MAX_BATCH, $count));

                while ($processed < $count && $session['next_index'] < $total) {
                    if ($processed > 0 && microtime(true) - $startedAt > self::TIME_BUDGET_SECONDS) {
                        break;
                    }
                    $row = $rows[$session['next_index']];
                    try {
                        $out = $this->writer->write($row, $tenantId, $adminId, $decision, $importId, (bool) $session['send_invitations']);
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
     * @param array<string, mixed> $session
     * @return array<string, mixed>
     */
    private function state(array $session, int $processed, int $created, float $startedAt): array
    {
        // Before the first batch nothing is fixed yet, so say what would happen now.
        $held = isset($session['admission']['held'])
            ? (bool) $session['admission']['held']
            : AdminCreatedAccountAdmission::decide((int) $session['tenant_id'], (bool) $session['identity_attested'])['held'];
        $queued = (int) $session['totals']['invitations_queued'];

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
            ],
            // About how long until this import's invitations have gone. The sender's pace
            // is shared by every community, so it is read from the whole queue.
            'invitations_eta_minutes' => $queued > 0 ? $this->invitations->etaMinutes() : 0,
            'admission_incomplete_rows' => array_values($session['admission_incomplete_rows']),
            'stop' => $session['stop'],
            'held' => $held,
            'batch' => ['processed' => $processed, 'created' => $created, 'duration_ms' => (int) round((microtime(true) - $startedAt) * 1000)],
        ];
    }
}
