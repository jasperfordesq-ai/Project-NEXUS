<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\MemberImport;

use App\Services\AuditLogService;
use App\Services\Identity\AdminCreatedAccountAdmission;
use App\Support\Wallet\OpeningBalance;

/**
 * Runs one batch of a checked import. Batches must arrive in order; a batch
 * that was already run is answered from the session without writing anything
 * (a lost response, a double click). The server also times itself: it stops
 * a batch early after TIME_BUDGET_SECONDS so no request runs long.
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
    ) {
    }

    /**
     * @param bool|null $identityAttested honoured only on the first batch (status 'ready');
     *                                    null leaves the session's value unchanged
     * @return array<string, mixed>
     * @throws MemberImportBusy | MemberImportNotFound | MemberImportOutOfOrder
     */
    public function runBatch(string $importId, int $tenantId, int $adminId, int $from, int $count, ?bool $identityAttested): array
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
            $session['totals']['admission_incomplete'] ??= 0;
            $session['admission_incomplete_rows'] ??= [];

            if (in_array($session['status'], ['stopped', 'completed'], true) || $from < $session['next_index']) {
                return $this->state($session, 0, 0, $startedAt);
            }
            if ($from > $session['next_index']) {
                throw new MemberImportOutOfOrder();
            }

            $total = (int) $session['total'];
            // Read once per batch. Rows that expired mid-import cannot be
            // continued; the members written so far stay.
            $rows = MemberImportSession::rows($session);
            if ($rows === null && $session['next_index'] < $total) {
                throw new MemberImportNotFound();
            }

            if ($session['status'] === 'ready') {
                if ($identityAttested !== null) {
                    $session['identity_attested'] = $identityAttested;
                }
                $session['status'] = 'running';
            }
            $decision = AdminCreatedAccountAdmission::decide($tenantId, (bool) $session['identity_attested']);
            $count = max(self::MIN_BATCH, min(self::MAX_BATCH, $count));
            $processed = 0;
            $created = 0;

            while ($processed < $count && $session['next_index'] < $total) {
                if ($processed > 0 && microtime(true) - $startedAt > self::TIME_BUDGET_SECONDS) {
                    break;
                }
                $row = $rows[$session['next_index']];
                try {
                    $out = $this->writer->write($row, $tenantId, $adminId, $decision, $importId);
                } catch (MemberImportStopped $e) {
                    $session['status'] = 'stopped';
                    $session['stop'] = ['row' => (int) $row['source_row'], 'code' => $e->reason, 'params' => $e->params];
                    break;
                }
                $session['next_index']++;
                $session['totals']['created']++;
                $session['totals']['balance_cents'] += $out['balance_cents'];
                $session['totals']['zeroed'] += $out['zeroed'] ? 1 : 0;
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

            if ($session['status'] === 'running' && $session['next_index'] >= $total) {
                $session['status'] = 'completed';
                $session['finished_at'] = now()->toIso8601String();
                $this->audit->logAction($tenantId, self::ACTION_IMPORT_COMPLETED, $adminId, [
                    'import_id' => $importId,
                    'file_name' => $session['file_name'],
                    'file_sha256' => $session['file_sha256'],
                    'members_created' => $session['totals']['created'],
                    'opening_balance_total' => OpeningBalance::formatCents($session['totals']['balance_cents']),
                    'negative_balances_zeroed' => $session['totals']['zeroed'],
                    'admission_incomplete' => $session['totals']['admission_incomplete'],
                    'identity_attested' => (bool) $session['identity_attested'],
                ]);
                $this->audit->logBulkImport($adminId, $session['totals']['created'], 0, $total);
                // Personal data is not held once it is no longer needed. The
                // progress record stays, so a replayed batch still answers.
                MemberImportSession::discardRows($session);
            }
            MemberImportSession::save($session);

            return $this->state($session, $processed, $created, $startedAt);
        } finally {
            $lock->release();
        }
    }

    /**
     * @param array<string, mixed> $session
     * @return array<string, mixed>
     */
    private function state(array $session, int $processed, int $created, float $startedAt): array
    {
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
            ],
            'admission_incomplete_rows' => array_values($session['admission_incomplete_rows']),
            'stop' => $session['stop'],
            'held' => AdminCreatedAccountAdmission::decide((int) $session['tenant_id'], (bool) $session['identity_attested'])['held'],
            'batch' => ['processed' => $processed, 'created' => $created, 'duration_ms' => (int) round((microtime(true) - $startedAt) * 1000)],
        ];
    }
}
