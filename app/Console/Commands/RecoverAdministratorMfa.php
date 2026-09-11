<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Core\TenantContext;
use App\Services\TotpService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Emergency recovery requires host administration; never exposed over HTTP. */
class RecoverAdministratorMfa extends Command
{
    protected $signature = 'security:recover-admin-mfa {tenant : Numeric tenant ID} {user : Numeric user ID}
        {--execute : Perform the reset; otherwise inspect only}
        {--confirm-user= : Repeat the target ID to confirm}
        {--operator= : Responsible host operator identifier}
        {--reason= : Incident reference and verified identity-check reason}';

    protected $description = 'Inspect or perform an audited emergency platform-administrator TOTP reset without granting a session';

    public function handle(): int
    {
        $tenant = (string) $this->argument('tenant');
        $id = (string) $this->argument('user');
        if (!ctype_digit($tenant) || !ctype_digit($id) || (int) $tenant < 1 || (int) $id < 1) {
            $this->error('Positive numeric tenant and user IDs are required.');
            return self::FAILURE;
        }
        return TenantContext::runForTenant((int) $tenant, function () use ($tenant, $id): int {
            return DB::transaction(function () use ($tenant, $id): int {
                $user = DB::table('users')->where('id', (int) $id)->where('tenant_id', (int) $tenant)->lockForUpdate()->first();
                if (!$user || $user->status !== 'active' || !( !empty($user->is_super_admin) || !empty($user->is_god)
                    || in_array($user->role, ['super_admin', 'god'], true))) {
                    $this->error('Target must be an active platform administrator in the specified tenant.');
                    return self::FAILURE;
                }
                if (!$this->option('execute')) {
                    $this->info('Inspection only: eligible administrator. Execution removes TOTP and trusted devices, invalidates recovery codes and revokes sessions. Password and MFA requirement remain unchanged.');
                    return self::SUCCESS;
                }
                $operator = trim((string) $this->option('operator'));
                $reason = trim((string) $this->option('reason'));
                if ((string) $this->option('confirm-user') !== $id || mb_strlen($operator) < 3 || mb_strlen($operator) > 100
                    || mb_strlen($reason) < 20 || mb_strlen($reason) > 500 || preg_match('/[\r\n]/', $operator . $reason)) {
                    $this->error('Execution requires matching --confirm-user, --operator (3–100 characters), and --reason (20–500 characters, including identity-check evidence).');
                    return self::FAILURE;
                }
                // The database audit row is mandatory and part of the same
                // transaction as reset/revocation. No token or MFA exemption is issued.
                $result = TotpService::adminReset((int) $id, (int) $id, '[Host recovery; operator=' . $operator . '] ' . $reason);
                if (!$result['success']) {
                    $this->error('Recovery failed; no reset committed. Inspect server diagnostics.');
                    return self::FAILURE;
                }
                $this->info('Recovery committed and audited. Administrator must sign in with an approved factor or enroll again. No session or password was issued.');
                return self::SUCCESS;
            });
        });
    }
}
