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
use App\Support\UserDisplayName;
use App\Support\Wallet\OpeningBalance;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Creates one imported member. The account, its opening-balance ledger row,
 * the balance itself, its federation settings, the vouched email and the
 * audit entry are written in ONE transaction: a member is created completely
 * or not at all — and so is the member's welcome invitation, when the import
 * sends them (one outbox row, linked to the import by its id; the scheduled
 * sender emails it later). The row is re-checked against the same rules first, and an
 * email that has been taken since the check stops the import rather than
 * being skipped (owner, 8 Oct 2026).
 */
final class MemberImportWriter
{
    public const ACTION_MEMBER_IMPORTED = 'member_imported';

    private ?string $unusablePasswordHash = null;

    public function __construct(
        private readonly MemberImportRowRules $rules,
        private readonly EmailConfirmationService $emailConfirmation,
        private readonly AuditLogService $audit,
        private readonly InvitationOutbox $invitations,
    ) {
    }

    /**
     * @param array<string, mixed> $row      a NormalisedRow plus source_row
     * @param array<string, mixed> $decision AdminCreatedAccountAdmission::decide()
     * @param bool $sendInvitation queue a welcome invitation for the new member, unless the
     *                             decision holds them for an identity check
     * @return array{user_id: int, balance_cents: int, zeroed: bool, already: bool, admission_complete: bool, invitation_queued: bool}
     *         `admission_complete` is false when the member was created but their identity step
     *         (starting the community's identity check, or recording the attestation) did not run;
     *         on the "already created by this import" path it is true only when nothing was owed or the attestation is now recorded.
     *         `invitation_queued` says whether this import's invitation for the member exists.
     * @throws MemberImportStopped row_changed | email_now_taken | write_failed
     */
    public function write(array $row, int $tenantId, int $adminId, array $decision, string $importId, bool $sendInvitation = false, ?string $fileSha256 = null): array
    {
        // A held member cannot sign in yet; they are invited from the member list once approved.
        $invite = $sendInvitation && ($decision['held'] ?? true) === false;

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

        // TRIM, as the checker does: a stored address with leading spaces is still this address.
        $existingId = DB::table('users')->where('tenant_id', $tenantId)->whereRaw('TRIM(email) = ?', [$row['email']])->value('id');
        if ($existingId !== null) {
            if ($this->createdByThisImport((int) $existingId, $tenantId, $importId)) {
                return $this->alreadyCreated((int) $existingId, $row, $tenantId, $importId, $decision, $adminId);
            }
            throw new MemberImportStopped('email_now_taken');
        }

        try {
            $userId = DB::transaction(function () use ($row, $tenantId, $adminId, $decision, $importId, $invite, $fileSha256): int {
                $userId = (int) DB::table('users')->insertGetId([
                    'tenant_id' => $tenantId,
                    'name' => UserDisplayName::forStorage(null, null, $row['first_name'], $row['last_name']),
                    'first_name' => $row['first_name'],
                    'last_name' => $row['last_name'],
                    'email' => $row['email'],
                    // Nobody knows this password; the member sets their own
                    // through the welcome invitation (delivery b) or "forgot password".
                    'password_hash' => $this->unusablePasswordHash(),
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
                    // Lets a later check of this same file skip the members already created from it.
                    'file_sha256' => $fileSha256,
                    'source_row' => $row['source_row'],
                    'opening_balance' => $amount,
                    'original_balance' => $row['original_balance_cents'] === null ? null : OpeningBalance::formatCents($row['original_balance_cents']),
                ], null, $userId);

                if ($invite) {
                    // In the member's own transaction: the invitation exists if and only if
                    // the member does, and a failure here undoes the member (write_failed).
                    $this->invitations->enqueueOneInTransaction($tenantId, $userId, $importId, $adminId);
                }

                return $userId;
            });
        } catch (QueryException $e) {
            if ((int) ($e->errorInfo[1] ?? 0) === 1062) {
                // The unique key stopped a duplicate. If the other row is this import's own
                // member (an overlapping request committed it first), that is not a stop.
                $winnerId = DB::table('users')->where('tenant_id', $tenantId)->whereRaw('TRIM(email) = ?', [$row['email']])->value('id');
                if ($winnerId !== null && $this->createdByThisImport((int) $winnerId, $tenantId, $importId)) {
                    return $this->alreadyCreated((int) $winnerId, $row, $tenantId, $importId, $decision, $adminId);
                }
                throw new MemberImportStopped('email_now_taken');
            }
            $this->logWriteFailed($e, $tenantId, $importId, $row);
            throw new MemberImportStopped('write_failed');
        } catch (\Throwable $e) {
            // DB::transaction has already rolled the member back; the runner only ever
            // sees a stop, never a raw exception.
            $this->logWriteFailed($e, $tenantId, $importId, $row);
            throw new MemberImportStopped('write_failed');
        }

        // Outside the transaction on purpose: afterCreate() swallows its own failures
        // for a held account, which inside a transaction could hide a rollback.
        try {
            $admissionComplete = AdminCreatedAccountAdmission::afterCreate($decision, $tenantId, $userId, $adminId, AdminCreatedAccountAdmission::SOURCE_CSV_IMPORT);
        } catch (\Throwable $e) {
            // The member exists and stays pending/active as decided; the identity step is
            // logged and reported to the caller, never turned into a silent success.
            Log::error('member_import.admission_after_create_failed', ['tenant_id' => $tenantId, 'user_id' => $userId, 'error' => $e->getMessage()]);
            $admissionComplete = false;
        }

        return ['user_id' => $userId, 'balance_cents' => (int) $row['balance_cents'],
            'zeroed' => $row['original_balance_cents'] !== null, 'already' => false,
            'admission_complete' => $admissionComplete, 'invitation_queued' => $invite];
    }

    /**
     * @param array<string, mixed> $row
     * @param array<string, mixed> $decision
     * @return array{user_id: int, balance_cents: int, zeroed: bool, already: bool, admission_complete: bool, invitation_queued: bool}
     */
    private function alreadyCreated(int $userId, array $row, int $tenantId, string $importId, array $decision, int $adminId): array
    {
        // This path means a first attempt committed the member but the import's progress was not
        // saved (a crash, or an overlapping request), so the identity step after the commit may
        // never have run. It is never assumed done:
        //  - attested: the attestation is recorded again unless it is already in the audit log;
        //  - held: whether the check was started cannot be told, so the row is reported as
        //    needing follow-up rather than as complete.
        $admissionComplete = true;
        if (($decision['attested'] ?? false) === true) {
            $recorded = DB::table('org_audit_log')
                ->where('tenant_id', $tenantId)->where('target_user_id', $userId)
                ->where('action', AuditLogService::ACTION_ADMIN_IDENTITY_ATTESTED)->exists();
            if (!$recorded) {
                try {
                    $admissionComplete = AdminCreatedAccountAdmission::afterCreate($decision, $tenantId, $userId, $adminId, AdminCreatedAccountAdmission::SOURCE_CSV_IMPORT);
                } catch (\Throwable $e) {
                    Log::error('member_import.admission_after_create_failed', ['tenant_id' => $tenantId, 'user_id' => $userId, 'error' => $e->getMessage()]);
                    $admissionComplete = false;
                }
            }
        } elseif (($decision['held'] ?? false) === true) {
            $admissionComplete = false;
        }
        // Nothing is queued either: the invitation was written with the member, or not at all.
        // It is only looked up, so the import's total counts this member as it counts them created.
        $queued = DB::table('member_invitation_outbox')
            ->where('tenant_id', $tenantId)->where('user_id', $userId)->where('request_key', $importId)
            ->exists();

        return ['user_id' => $userId, 'balance_cents' => (int) $row['balance_cents'],
            'zeroed' => $row['original_balance_cents'] !== null, 'already' => true,
            'admission_complete' => $admissionComplete, 'invitation_queued' => $queued];
    }

    /** @param array<string, mixed> $row */
    private function logWriteFailed(\Throwable $e, int $tenantId, string $importId, array $row): void
    {
        Log::error('member_import.write_failed', ['tenant_id' => $tenantId, 'import_id' => $importId, 'row' => $row['source_row'], 'error' => $e->getMessage()]);
    }

    /**
     * One full-cost Argon2id hash of a random secret that is never stored or
     * returned, shared by every member this writer creates. Nobody can log in
     * with it. Full cost keeps a wrong-password login against an imported
     * account exactly as slow as against any other account (see the dummy
     * hash in AuthController::login), and computing it once per writer (one
     * per batch request) keeps a 5,000-member import to about a minute.
     */
    private function unusablePasswordHash(): string
    {
        return $this->unusablePasswordHash ??= password_hash(bin2hex(random_bytes(16)), PASSWORD_ARGON2ID);
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
