<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Core\TotpEncryption;
use App\Services\TwoFactorPolicy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use OTPHP\TOTP;

/** Read-only inventory: never prints identities, factor material or credentials. */
class InspectMfaReadiness extends Command
{
    protected $signature = 'security:mfa-readiness {--tenant= : Restrict inspection to a numeric tenant ID}';
    protected $description = 'Report MFA enrollment and TOTP decryption readiness as aggregate JSON without exposing secrets';

    public function handle(): int
    {
        $tenant = $this->option('tenant');
        if ($tenant !== null && (!ctype_digit((string) $tenant) || (int) $tenant < 1)) {
            $this->error('Tenant ID must be a positive integer.');
            return self::FAILURE;
        }
        if ($tenant !== null && !DB::table('tenants')->where('id', (int) $tenant)->exists()) {
            $this->error('Tenant does not exist.');
            return self::FAILURE;
        }
        foreach (['last_used_step', 'setup_revocation_version'] as $column) {
            if (!Schema::hasColumn('user_totp_settings', $column)) {
                $this->line(json_encode(['ready' => false, 'migration_required' => true], JSON_THROW_ON_ERROR));
                return self::FAILURE;
            }
        }
        $counts = ['required_accounts' => 0, 'totp_enrolled' => 0, 'passkeys_registered' => 0,
            'without_registered_local_factor' => 0, 'without_unused_recovery_codes' => 0,
            'totp_decryption_failures' => 0, 'totp_flag_inconsistencies' => 0];
        $query = DB::table('users')->where('status', 'active')->orderBy('id');
        if ($tenant !== null) $query->where('tenant_id', (int) $tenant);
        $policy = app(TwoFactorPolicy::class);
        foreach ($query->cursor() as $user) {
            if (!$policy->required($user)) continue;
            $counts['required_accounts']++;
            $factor = DB::table('user_totp_settings')->where('user_id', $user->id)->where('tenant_id', $user->tenant_id)->first();
            $enabled = $factor && (bool) $factor->is_enabled;
            if ($enabled !== (bool) $user->totp_enabled) $counts['totp_flag_inconsistencies']++;
            if ($enabled) {
                $counts['totp_enrolled']++;
                try {
                    TOTP::createFromSecret(TotpEncryption::decrypt($factor->totp_secret_encrypted))->now();
                } catch (\Throwable) {
                    $counts['totp_decryption_failures']++;
                }
                if (!DB::table('user_backup_codes')->where('user_id', $user->id)->where('tenant_id', $user->tenant_id)->where('is_used', 0)->exists()) {
                    $counts['without_unused_recovery_codes']++;
                }
            }
            $passkey = Schema::hasTable('webauthn_credentials') && DB::table('webauthn_credentials')
                ->where('user_id', $user->id)->where('tenant_id', $user->tenant_id)->exists();
            if ($passkey) $counts['passkeys_registered']++;
            if (!$enabled && !$passkey) $counts['without_registered_local_factor']++;
        }
        $ready = $counts['required_accounts'] > 0 && $counts['totp_decryption_failures'] === 0 && $counts['totp_flag_inconsistencies'] === 0
            && $counts['without_registered_local_factor'] === 0 && $counts['without_unused_recovery_codes'] === 0;
        $this->line(json_encode(['inventory_ready' => $ready, ...$counts,
            'live_authenticator_and_idp_checks_required' => true,
            'note' => 'Registered passkeys and upstream SSO still require live verification. Missing local factors may be valid SSO-only accounts; review them explicitly.',
        ], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        return $ready ? self::SUCCESS : self::FAILURE;
    }
}
