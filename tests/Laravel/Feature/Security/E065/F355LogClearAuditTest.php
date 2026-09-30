<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-355 (E-065) — a platform super admin could blank any application log file
 * and nothing anywhere recorded it, including the log being blanked.
 *
 * `AdminEnterpriseController::clearLogFile()` truncated with
 * `file_put_contents($filePath, '')` and wrote no audit row of any kind. That
 * destroys the only compensating trace for F-353 (`PurgeTenantJob: tenant
 * purged`). The contrast in the same controller is `deleteLegalDoc()` — the
 * F-276 fix — which refuses to delete unless the audit row was written.
 *
 * E-065 deliberately did not reproduce this: a test that truncates a real file
 * under `storage/logs` would destroy another session's evidence in this
 * bind-mounted tree. This test therefore creates its OWN uniquely named log
 * file and removes it again; it never touches a pre-existing one.
 */
final class F355LogClearAuditTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;
    private const CONTENT = 'F355 fixture line — this file was created by the test suite.';

    private string $filename = '';
    private string $filePath = '';
    private int $superAdminId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT);

        $this->filename = 'f355-fixture-' . bin2hex(random_bytes(6)) . '.log';
        $this->filePath = storage_path('logs') . DIRECTORY_SEPARATOR . $this->filename;

        // Deliberately no skip guard. storage/logs is part of every Laravel
        // install and the container creates it; a missing or unwritable
        // directory is a broken environment, not a reason to quietly pass. The
        // pre-commit schema-skip budget counts skips in a staged test file, and
        // a skip that can never legitimately fire is exactly the debt it exists
        // to stop.
        $this->assertDirectoryExists(storage_path('logs'));
        $this->assertNotFalse(
            file_put_contents($this->filePath, self::CONTENT . PHP_EOL),
            'could not create the fixture log file this test owns'
        );

        $this->superAdminId = $this->makeUser('f355.super', 'super_admin', superAdmin: true);
    }

    protected function tearDown(): void
    {
        // Only ever removes the file this test created.
        if ($this->filePath !== '' && is_file($this->filePath)) {
            @unlink($this->filePath);
        }
        parent::tearDown();
    }

    /**
     * Clearing a log file must leave an audit row naming the file and the
     * administrator who did it.
     */
    public function test_clearing_a_log_file_is_audited(): void
    {
        Sanctum::actingAs(User::find($this->superAdminId));

        $before = (int) DB::table('org_audit_log')->max('id');

        $response = $this->deleteJson(
            '/api/v2/admin/enterprise/monitoring/log-files/' . $this->filename,
            [],
            $this->withTenantHeader()
        );

        $this->assertSame(200, $response->getStatusCode(), $response->getContent());
        $this->assertSame('', (string) file_get_contents($this->filePath), 'the file should be empty');

        $row = DB::table('org_audit_log')
            ->where('id', '>', $before)
            ->where('action', 'admin_log_file_cleared')
            ->where('user_id', $this->superAdminId)
            ->first(['details', 'tenant_id']);

        $this->assertNotNull(
            $row,
            'BAD OUTCOME: a log file was blanked and nothing recorded it.'
        );
        $this->assertStringContainsString(
            $this->filename,
            (string) $row->details,
            'BAD OUTCOME: the audit row does not say which file was blanked.'
        );
    }

    /**
     * CONTROL — a community administrator who is not a platform super admin is
     * refused, and the file is untouched. The existing gate is unchanged.
     */
    public function test_control_community_admin_cannot_clear_a_log_file(): void
    {
        $adminId = $this->makeUser('f355.admin', 'admin');
        Sanctum::actingAs(User::find($adminId));

        $response = $this->deleteJson(
            '/api/v2/admin/enterprise/monitoring/log-files/' . $this->filename,
            [],
            $this->withTenantHeader()
        );

        $this->assertSame(403, $response->getStatusCode());
        $this->assertStringContainsString(self::CONTENT, (string) file_get_contents($this->filePath));
    }

    // ── fixtures ───────────────────────────────────────────────────────────

    private function makeUser(string $prefix, string $role, bool $superAdmin = false): int
    {
        $email = $prefix . '.' . bin2hex(random_bytes(5)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT,
            'name' => 'F355 User',
            'first_name' => 'F355',
            'last_name' => 'User',
            'email' => $email,
            'username' => 'f355_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'role' => $role,
            'is_admin' => 1,
            'is_super_admin' => $superAdmin ? 1 : 0,
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
