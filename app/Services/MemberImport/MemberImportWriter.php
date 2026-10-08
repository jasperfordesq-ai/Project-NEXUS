<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\MemberImport;

use App\Services\AuditLogService;
use App\Services\Auth\EmailConfirmationService;
use App\Services\Identity\AdminCreatedAccountAdmission;
use App\Support\Wallet\OpeningBalance;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Creates one imported member. The account, its opening-balance ledger row,
 * the balance itself, its federation settings, the vouched email and the
 * audit entry are written in ONE transaction: a member is created completely
 * or not at all. The row is re-checked against the same rules first, and an
 * email that has been taken since the check stops the import rather than
 * being skipped (owner, 8 Oct 2026).
 */
final class MemberImportWriter
{
    public const ACTION_MEMBER_IMPORTED = 'member_imported';

    public function __construct(
        private readonly MemberImportRowRules $rules,
        private readonly EmailConfirmationService $emailConfirmation,
        private readonly AuditLogService $audit,
    ) {
    }

    /**
     * @param array<string, mixed> $row      a NormalisedRow plus source_row
     * @param array<string, mixed> $decision AdminCreatedAccountAdmission::decide()
     * @return array{user_id: int, balance_cents: int, zeroed: bool, already: bool}
     */
    public function write(array $row, int $tenantId, int $adminId, array $decision, string $importId): array
    {
        $recheck = $this->rules->check([
            'first_name' => (string) $row['first_name'],
            'last_name' => (string) $row['last_name'],
            'email' => (string) $row['email'],
            'phone' => (string) ($row['phone'] ?? ''),
            'location' => (string) ($row['location'] ?? ''),
            'balance' => OpeningBalance::formatCents((int) ($row['original_balance_cents'] ?? $row['balance_cents'])),
        ]);
        if ($recheck['row'] === null) {
            throw new MemberImportStopped('row_changed');
        }
        $row = $recheck['row'] + ['source_row' => (int) $row['source_row']];

        $existingId = DB::table('users')->where('tenant_id', $tenantId)->where('email', $row['email'])->value('id');
        if ($existingId !== null) {
            if ($this->createdByThisImport((int) $existingId, $tenantId, $importId)) {
                return ['user_id' => (int) $existingId, 'balance_cents' => (int) $row['balance_cents'],
                    'zeroed' => $row['original_balance_cents'] !== null, 'already' => true];
            }
            throw new MemberImportStopped('email_now_taken');
        }

        try {
            $userId = DB::transaction(function () use ($row, $tenantId, $adminId, $decision, $importId): int {
                $userId = (int) DB::table('users')->insertGetId([
                    'tenant_id' => $tenantId,
                    'name' => trim($row['first_name'] . ' ' . $row['last_name']),
                    'first_name' => $row['first_name'],
                    'last_name' => $row['last_name'],
                    'email' => $row['email'],
                    // Nobody knows this password; the member sets their own
                    // through the welcome invitation (delivery b) or "forgot password".
                    // Minimal Argon2id cost: the secret is a random 128-bit value nobody
                    // ever sees, so a slow hash adds no protection and would make a
                    // 5,000-member import take minutes. A password the member sets later
                    // is hashed at full cost by the normal path.
                    'password_hash' => password_hash(
                        bin2hex(random_bytes(16)),
                        PASSWORD_ARGON2ID,
                        ['memory_cost' => 1024, 'time_cost' => 1, 'threads' => 1]
                    ),
                    'phone' => $row['phone'],
                    'location' => $row['location'],
                    'role' => 'member',
                    'status' => $decision['columns']['status'],
                    'is_approved' => $decision['columns']['is_approved'],
                    'created_at' => now(),
                ]);

                $amount = OpeningBalance::formatCents((int) $row['balance_cents']);
                DB::table('transactions')->insert([
                    'tenant_id' => $tenantId,
                    'sender_id' => 0,
                    'receiver_id' => $userId,
                    'amount' => $amount,
                    'description' => OpeningBalance::describe(strtoupper(substr($importId, 0, 8)), $row['original_balance_cents']),
                    'status' => 'completed',
                    'transaction_type' => OpeningBalance::TYPE,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                DB::update('UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?', [$amount, $userId, $tenantId]);

                DB::statement(
                    "INSERT IGNORE INTO federation_user_settings (
                        user_id, federation_optin, profile_visible_federated,
                        messaging_enabled_federated, transactions_enabled_federated,
                        appear_in_federated_search, show_skills_federated,
                        show_location_federated, service_reach, opted_in_at, created_at
                    ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 'local_only', NULL, NOW())",
                    [$userId]
                );

                // The importing administrator vouches for each address (owner, 8 Oct 2026).
                $this->emailConfirmation->recordAdminVouched($userId, $tenantId);

                $this->audit->logAction($tenantId, self::ACTION_MEMBER_IMPORTED, $adminId, [
                    'import_id' => $importId,
                    'source_row' => $row['source_row'],
                    'opening_balance' => $amount,
                    'original_balance' => $row['original_balance_cents'] === null ? null : OpeningBalance::formatCents($row['original_balance_cents']),
                ], null, $userId);

                return $userId;
            });
        } catch (QueryException $e) {
            if ((int) ($e->errorInfo[1] ?? 0) === 1062) {
                throw new MemberImportStopped('email_now_taken');
            }
            Log::error('member_import.write_failed', ['tenant_id' => $tenantId, 'import_id' => $importId, 'row' => $row['source_row'], 'error' => $e->getMessage()]);
            throw new MemberImportStopped('write_failed');
        }

        try {
            AdminCreatedAccountAdmission::afterCreate($decision, $tenantId, $userId, $adminId, AdminCreatedAccountAdmission::SOURCE_CSV_IMPORT);
        } catch (\Throwable $e) {
            // The member exists and stays pending/active as decided; the identity
            // step is logged, never turned into a silent success.
            Log::error('member_import.admission_after_create_failed', ['tenant_id' => $tenantId, 'user_id' => $userId, 'error' => $e->getMessage()]);
        }

        return ['user_id' => $userId, 'balance_cents' => (int) $row['balance_cents'],
            'zeroed' => $row['original_balance_cents'] !== null, 'already' => false];
    }

    private function createdByThisImport(int $userId, int $tenantId, string $importId): bool
    {
        return DB::table('org_audit_log')
            ->where('tenant_id', $tenantId)
            ->where('action', self::ACTION_MEMBER_IMPORTED)
            ->where('target_user_id', $userId)
            ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(details, '$.import_id')) = ?", [$importId])
            ->exists();
    }
}
