<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Jobs\SendPasswordResetEmail;
use App\Models\User;
use App\Services\TenantSettingsService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use InvalidArgumentException;
use RuntimeException;

class VereinMemberImportService
{
    private const REQUIRED_HEADERS = ['email'];

    public function __construct(
        private readonly TenantSettingsService $tenantSettings,
    ) {
    }

    public function preview(int $tenantId, int $organizationId, string $csv): array
    {
        $organization = $this->assertVerein($tenantId, $organizationId);
        $rows = $this->parseCsv($csv);
        $seen = [];
        $items = [];
        $summary = [
            'total_rows' => count($rows),
            'ready_to_create' => 0,
            // Kept for older clients: import never links existing accounts (F-126).
            'ready_to_link' => 0,
            'existing_accounts' => 0,
            'duplicates' => 0,
            'invalid' => 0,
        ];

        foreach ($rows as $row) {
            $email = strtolower(trim((string) ($row['email'] ?? '')));
            $errors = [];

            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $errors[] = __('api.invalid_email');
            }
            if ($email !== '' && isset($seen[$email])) {
                $errors[] = __('api.verein_import_duplicate_in_file');
            }
            if ($email !== '') {
                $seen[$email] = true;
            }

            $existingUser = $email !== ''
                ? DB::table('users')->where('tenant_id', $tenantId)->where('email', $email)->first()
                : null;
            $alreadyMember = $existingUser
                ? $this->isOrganizationMember($tenantId, $organizationId, (int) $existingUser->id)
                : false;

            // F-126: an existing community account is never enrolled by import —
            // it needs an invitation the member accepts. The preview names the
            // outcome only; the account's user id is not disclosed.
            $action = $existingUser ? 'existing_account' : 'create';
            // Being an existing active org member is a skippable info state, NOT a
            // blocking error: import() silently skips these rows (counting them as
            // "skipped") instead of aborting the whole batch. Do not push it into
            // $errors. Genuine problems (bad email / in-file duplicate) still flip
            // the row to 'invalid' in the check below and take precedence.
            if ($alreadyMember) {
                $action = 'already_member';
            }
            if ($errors !== []) {
                $action = 'invalid';
            }

            if ($action === 'create') {
                $summary['ready_to_create']++;
            } elseif ($action === 'existing_account') {
                $summary['existing_accounts']++;
            } elseif ($alreadyMember || in_array(__('api.verein_import_duplicate_in_file'), $errors, true)) {
                $summary['duplicates']++;
            } else {
                $summary['invalid']++;
            }

            $items[] = [
                'row' => (int) $row['_row'],
                'email' => $email,
                'first_name' => $this->cleanName((string) ($row['first_name'] ?? '')),
                'last_name' => $this->cleanName((string) ($row['last_name'] ?? '')),
                'phone' => trim((string) ($row['phone'] ?? '')) ?: null,
                // F-126: a CSV cannot grant club owner/admin; import always
                // adds plain members (club admins are assigned separately).
                'role' => 'member',
                'action' => $action,
                'errors' => $errors,
            ];
        }

        return [
            'organization' => [
                'id' => (int) $organization->id,
                'name' => (string) $organization->name,
                'org_type' => (string) $organization->org_type,
            ],
            'summary' => $summary,
            'items' => $items,
        ];
    }

    public function import(int $tenantId, int $organizationId, int $actorId, string $csv): array
    {
        $preview = $this->preview($tenantId, $organizationId, $csv);
        // Only genuinely invalid rows (bad email / in-file duplicate) abort the
        // import. 'already_member' rows are skipped gracefully in the loop below.
        $invalid = array_values(array_filter(
            $preview['items'],
            fn (array $item): bool => $item['action'] === 'invalid'
        ));

        if ($invalid !== []) {
            throw new InvalidArgumentException(__('api.verein_import_has_errors'));
        }

        // F-126: imported accounts follow the community's own admin-approval
        // rule, exactly as self-registration does (RegistrationService): when
        // approval is required the account waits in the approval queue.
        $requiresApproval = $this->tenantSettings->requiresAdminApproval($tenantId);

        $created = 0;
        $skipped = 0;
        $existingAccounts = 0;
        $notCreated = 0;
        $members = [];
        $passwordEmails = [];

        DB::transaction(function () use ($tenantId, $organizationId, $preview, $requiresApproval, &$created, &$skipped, &$existingAccounts, &$notCreated, &$members, &$passwordEmails): void {
            foreach ($preview['items'] as $item) {
                if ($item['action'] === 'already_member') {
                    $skipped++;
                    continue;
                }

                // F-126: never enrol an existing account (or re-activate a
                // membership they left). The club invites them instead.
                if ($item['action'] === 'existing_account'
                    || DB::table('users')->where('tenant_id', $tenantId)->where('email', $item['email'])->exists()
                ) {
                    $existingAccounts++;
                    continue;
                }

                // Created through the shared account-creation path. The random
                // password is never returned or shown to anyone: the member
                // chooses their own through the password-setup email below.
                $userId = User::createWithTenant([
                    'first_name' => $item['first_name'],
                    'last_name' => $item['last_name'],
                    'email' => $item['email'],
                    'password' => Str::password(32),
                    'phone' => $item['phone'],
                    'role' => 'member',
                    'is_approved' => $requiresApproval ? 0 : 1,
                ], $tenantId);

                if (!$userId) {
                    // createWithTenant refuses an address already registered
                    // elsewhere on the platform; do not reveal or touch it.
                    $notCreated++;
                    continue;
                }

                $update = [
                    'username' => $this->uniqueUsername($tenantId, $item['email']),
                    'status' => $requiresApproval ? 'pending' : 'active',
                    'updated_at' => now(),
                ];
                if ($item['first_name'] === '' && $item['last_name'] === '') {
                    $update['name'] = $this->displayName('', '', $item['email']);
                }
                DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->update($update);

                // Brand-new account, so there is no prior row to re-activate.
                // insertOrIgnore keeps it that way even under a race.
                DB::table('org_members')->insertOrIgnore([
                    'tenant_id' => $tenantId,
                    'organization_id' => $organizationId,
                    'org_type' => 'volunteer',
                    'user_id' => $userId,
                    'role' => 'member',
                    'status' => 'active',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                $created++;
                $passwordEmails[] = $item['email'];
                $members[] = [
                    'email' => $item['email'],
                    'created' => true,
                    'approval_required' => $requiresApproval,
                ];
            }
        });

        // Queued only after commit, through the same job as "forgot password",
        // so each new member sets their own password. A delivery failure never
        // undoes the import: the member can still use "forgot password".
        $passwordEmailsFailed = 0;
        foreach ($passwordEmails as $email) {
            try {
                SendPasswordResetEmail::dispatch($email, $tenantId);
            } catch (\Throwable $e) {
                $passwordEmailsFailed++;
                Log::warning('[VereinImport] password-setup email dispatch failed', [
                    'tenant_id' => $tenantId,
                    'organization_id' => $organizationId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return [
            'organization' => $preview['organization'],
            'created' => $created,
            // Kept for older clients: import never links existing accounts.
            'linked' => 0,
            'skipped' => $skipped,
            'existing_accounts' => $existingAccounts,
            'not_created' => $notCreated,
            'approval_required' => $requiresApproval,
            'password_setup_email' => $created === 0 ? null : ($passwordEmailsFailed === 0 ? 'queued' : 'partially_failed'),
            'members' => $members,
            'imported_by' => $actorId,
        ];
    }

    public function assignVereinAdmin(int $tenantId, int $organizationId, int $userId, int $actorId): array
    {
        $this->assertVerein($tenantId, $organizationId);
        $this->assertTenantUser($tenantId, $userId);

        $roleId = DB::table('roles')->where('name', 'verein_admin')->value('id');
        if (!$roleId) {
            throw new RuntimeException(__('api.verein_admin_role_unavailable'));
        }

        DB::table('user_roles')->updateOrInsert(
            [
                'user_id' => $userId,
                'role_id' => $roleId,
                'tenant_id' => $tenantId,
                'scope_organization_id' => $organizationId,
            ],
            [
                'assigned_by' => $actorId,
                'assigned_at' => now(),
                'expires_at' => null,
            ]
        );

        DB::table('org_members')->updateOrInsert(
            ['organization_id' => $organizationId, 'org_type' => 'volunteer', 'user_id' => $userId],
            [
                'tenant_id' => $tenantId,
                'role' => 'admin',
                'status' => 'active',
                'updated_at' => now(),
            ]
        );

        return [
            'user_id' => $userId,
            'organization_id' => $organizationId,
            'role' => 'verein_admin',
            'scope_organization_id' => $organizationId,
        ];
    }

    public function userHasPermissionInOrg(int $tenantId, int $userId, int $organizationId, string $permission): bool
    {
        if (!Schema::hasTable('user_roles') || !Schema::hasColumn('user_roles', 'scope_organization_id')) {
            return false;
        }

        return DB::table('user_roles as ur')
            ->join('role_permissions as rp', 'rp.role_id', '=', 'ur.role_id')
            ->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->where('ur.user_id', $userId)
            ->where('p.name', $permission)
            ->where(function ($query) use ($tenantId): void {
                $query->where('ur.tenant_id', $tenantId)->orWhereNull('ur.tenant_id');
            })
            ->where(function ($query) use ($tenantId): void {
                $query->where('rp.tenant_id', $tenantId)->orWhereNull('rp.tenant_id');
            })
            ->where(function ($query) use ($tenantId): void {
                $query->where('p.tenant_id', $tenantId)->orWhereNull('p.tenant_id');
            })
            ->where(function ($query) use ($organizationId): void {
                $query->where('ur.scope_organization_id', $organizationId)->orWhereNull('ur.scope_organization_id');
            })
            ->where(function ($query): void {
                $query->whereNull('ur.expires_at')->orWhere('ur.expires_at', '>', now());
            })
            ->exists();
    }

    private function parseCsv(string $csv): array
    {
        $csv = trim($csv);
        if ($csv === '') {
            throw new InvalidArgumentException(__('api.csv_empty'));
        }

        $handle = fopen('php://temp', 'r+');
        if (!$handle) {
            throw new RuntimeException(__('api.verein_import_parse_failed'));
        }

        fwrite($handle, $csv);
        rewind($handle);
        $headers = fgetcsv($handle);
        if (!is_array($headers)) {
            throw new InvalidArgumentException(__('api.csv_empty'));
        }

        $headers = array_map(fn (string $header): string => strtolower(trim($header)), $headers);
        foreach (self::REQUIRED_HEADERS as $required) {
            if (!in_array($required, $headers, true)) {
                throw new InvalidArgumentException(__('api.verein_import_missing_header', ['header' => $required]));
            }
        }

        $rows = [];
        $rowNumber = 1;
        while (($values = fgetcsv($handle)) !== false) {
            $rowNumber++;
            if ($values === [null] || implode('', array_map('strval', $values)) === '') {
                continue;
            }
            $row = array_combine($headers, array_pad($values, count($headers), ''));
            if (!is_array($row)) {
                throw new InvalidArgumentException(__('api.verein_import_parse_failed'));
            }
            $row['_row'] = $rowNumber;
            $rows[] = $row;
        }
        fclose($handle);

        if (count($rows) > 500) {
            throw new InvalidArgumentException(__('api.verein_import_too_many_rows'));
        }

        return $rows;
    }

    private function assertVerein(int $tenantId, int $organizationId): object
    {
        if (!Schema::hasTable('vol_organizations') || !Schema::hasTable('org_members')) {
            throw new RuntimeException(__('api.verein_import_unavailable'));
        }

        $organization = DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->where('id', $organizationId)
            ->where('org_type', 'club')
            ->first();

        if (!$organization) {
            throw new InvalidArgumentException(__('api.verein_not_found'));
        }

        return $organization;
    }

    private function assertTenantUser(int $tenantId, int $userId): void
    {
        $exists = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->exists();

        if (!$exists) {
            throw new InvalidArgumentException(__('api.user_not_found'));
        }
    }

    private function isOrganizationMember(int $tenantId, int $organizationId, int $userId): bool
    {
        return DB::table('org_members')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $organizationId)
            ->where('org_type', 'volunteer')
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->exists();
    }

    private function cleanName(string $value): string
    {
        return mb_substr(trim($value), 0, 100);
    }

    private function displayName(string $firstName, string $lastName, string $email): string
    {
        $name = trim($firstName . ' ' . $lastName);
        return $name !== '' ? $name : Str::before($email, '@');
    }

    private function uniqueUsername(int $tenantId, string $email): string
    {
        $base = Str::slug(Str::before($email, '@')) ?: 'member';
        $base = mb_substr($base, 0, 36);
        $candidate = $base;
        $suffix = 1;

        while (DB::table('users')->where('tenant_id', $tenantId)->where('username', $candidate)->exists()) {
            $candidate = mb_substr($base, 0, 32) . '-' . $suffix;
            $suffix++;
        }

        return $candidate;
    }
}
