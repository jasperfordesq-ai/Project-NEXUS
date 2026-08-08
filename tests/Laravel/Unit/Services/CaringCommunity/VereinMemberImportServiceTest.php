<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\VereinMemberImportService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use Tests\Laravel\TestCase;

class VereinMemberImportServiceTest extends TestCase
{
    use DatabaseTransactions;

    private int $orgId = 0;
    private int $actorId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();
        TenantContext::setById($this->testTenantId);

        // Create an actor user (the importer).
        $this->actorId = (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'Import Actor',
            'email'      => 'actor.' . uniqid() . '@example.test',
            'role'       => 'admin',
            'status'     => 'active',
            'is_approved' => 1,
            'created_at' => now(),
        ]);

        // Create a club-type organisation in our tenant.
        $this->orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'user_id'    => $this->actorId,
            'name'       => 'Test Verein ' . uniqid(),
            'org_type'   => 'club',
            'status'     => 'active',
            'created_at' => now(),
        ]);
    }

    private function service(): VereinMemberImportService
    {
        return app(VereinMemberImportService::class);
    }

    /** Build a minimal valid CSV with one row. */
    private function csv(array $rows, array $headers = ['email', 'first_name', 'last_name', 'role']): string
    {
        $lines = [implode(',', $headers)];
        foreach ($rows as $row) {
            $lines[] = implode(',', $row);
        }
        return implode("\n", $lines);
    }

    // -------------------------------------------------------------------------
    // parseCsv / validation
    // -------------------------------------------------------------------------

    public function test_preview_throws_on_empty_csv(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->service()->preview($this->testTenantId, $this->orgId, '');
    }

    public function test_preview_throws_when_email_header_missing(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $csv = "first_name,last_name\nJane,Doe\n";
        $this->service()->preview($this->testTenantId, $this->orgId, $csv);
    }

    public function test_preview_throws_for_non_club_organisation(): void
    {
        // Create a non-club org (default org_type is 'organisation').
        $nonClubOrgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'user_id'    => $this->actorId,
            'name'       => 'Non Club Org ' . uniqid(),
            'org_type'   => 'organisation',
            'status'     => 'active',
            'created_at' => now(),
        ]);

        $this->expectException(InvalidArgumentException::class);
        $csv = $this->csv([['jane@example.test', 'Jane', 'Doe', 'member']]);
        $this->service()->preview($this->testTenantId, $nonClubOrgId, $csv);
    }

    public function test_preview_throws_for_cross_tenant_organisation(): void
    {
        $this->expectException(InvalidArgumentException::class);
        // Pass a tenant that doesn't own the org.
        $csv = $this->csv([['jane@example.test', 'Jane', 'Doe', 'member']]);
        $this->service()->preview(999, $this->orgId, $csv);
    }

    // -------------------------------------------------------------------------
    // preview() — action classification
    // -------------------------------------------------------------------------

    public function test_preview_marks_new_email_as_create(): void
    {
        $email = 'new.' . uniqid() . '@example.test';
        $csv   = $this->csv([[$email, 'Jane', 'Doe', 'member']]);

        $result = $this->service()->preview($this->testTenantId, $this->orgId, $csv);

        $this->assertCount(1, $result['items']);
        $this->assertSame('create', $result['items'][0]['action']);
        $this->assertSame(1, $result['summary']['ready_to_create']);
        $this->assertSame(0, $result['summary']['ready_to_link']);
        $this->assertSame(0, $result['summary']['invalid']);
    }

    public function test_preview_marks_existing_non_member_email_as_link_existing(): void
    {
        $email = 'existing.' . uniqid() . '@example.test';
        DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'Existing User',
            'email'      => $email,
            'role'       => 'member',
            'status'     => 'active',
            'is_approved' => 1,
            'created_at' => now(),
        ]);

        $csv    = $this->csv([[$email, 'Existing', 'User', 'member']]);
        $result = $this->service()->preview($this->testTenantId, $this->orgId, $csv);

        $this->assertSame('link_existing', $result['items'][0]['action']);
        $this->assertSame(1, $result['summary']['ready_to_link']);
        $this->assertSame(0, $result['summary']['ready_to_create']);
    }

    public function test_preview_marks_invalid_email_format_as_invalid(): void
    {
        $csv    = $this->csv([['not-an-email', 'Bad', 'Email', 'member']]);
        $result = $this->service()->preview($this->testTenantId, $this->orgId, $csv);

        $this->assertSame('invalid', $result['items'][0]['action']);
        $this->assertNotEmpty($result['items'][0]['errors']);
        $this->assertSame(1, $result['summary']['invalid']);
    }

    public function test_preview_marks_in_file_duplicate_as_invalid(): void
    {
        $email = 'dup.' . uniqid() . '@example.test';
        $csv   = $this->csv([
            [$email, 'First', 'Entry', 'member'],
            [$email, 'Second', 'Entry', 'member'],
        ]);

        $result = $this->service()->preview($this->testTenantId, $this->orgId, $csv);

        // First occurrence is 'create', second is 'invalid' (duplicate).
        $this->assertSame('create', $result['items'][0]['action']);
        $this->assertSame('invalid', $result['items'][1]['action']);
        $this->assertSame(2, $result['summary']['total_rows']);
    }

    public function test_preview_normalises_unknown_role_to_member(): void
    {
        $email  = 'roletest.' . uniqid() . '@example.test';
        $csv    = $this->csv([[$email, 'Role', 'Test', 'captain']]);
        $result = $this->service()->preview($this->testTenantId, $this->orgId, $csv);

        $this->assertSame('member', $result['items'][0]['role']);
    }

    public function test_preview_returns_organisation_details(): void
    {
        $email  = 'org.' . uniqid() . '@example.test';
        $csv    = $this->csv([[$email, 'O', 'R', 'member']]);
        $result = $this->service()->preview($this->testTenantId, $this->orgId, $csv);

        $this->assertSame($this->orgId, $result['organization']['id']);
        $this->assertSame('club', $result['organization']['org_type']);
        $this->assertArrayHasKey('name', $result['organization']);
    }

    // -------------------------------------------------------------------------
    // import()
    // -------------------------------------------------------------------------

    public function test_import_throws_when_csv_has_invalid_rows(): void
    {
        $csv = $this->csv([['not-an-email', 'Bad', 'Email', 'member']]);

        $this->expectException(InvalidArgumentException::class);
        $this->service()->import($this->testTenantId, $this->orgId, $this->actorId, $csv);
    }

    public function test_import_creates_new_user_and_org_member_row(): void
    {
        $email  = 'newimport.' . uniqid() . '@example.test';
        $csv    = $this->csv([[$email, 'First', 'Last', 'member']]);
        $result = $this->service()->import($this->testTenantId, $this->orgId, $this->actorId, $csv);

        $this->assertSame(1, $result['created']);
        $this->assertSame(0, $result['linked']);
        $this->assertSame(0, $result['skipped']);

        // User row must exist in DB.
        $user = DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('email', $email)
            ->first();
        $this->assertNotNull($user, 'User row should have been created.');
        $this->assertSame('active', $user->status);
        $this->assertSame(1, (int) $user->is_approved);

        // org_members row must exist.
        $member = DB::table('org_members')
            ->where('organization_id', $this->orgId)
            ->where('user_id', $user->id)
            ->first();
        $this->assertNotNull($member, 'org_members row should have been created.');
        $this->assertSame('active', $member->status);

        // Returned members array should carry temporary_password.
        $this->assertCount(1, $result['members']);
        $this->assertNotNull($result['members'][0]['temporary_password']);
        $this->assertTrue($result['members'][0]['created']);
    }

    public function test_import_links_existing_user_without_creating_new_row(): void
    {
        $email  = 'link.' . uniqid() . '@example.test';
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'Pre Existing',
            'email'      => $email,
            'role'       => 'member',
            'status'     => 'active',
            'is_approved' => 1,
            'created_at' => now(),
        ]);

        $csv    = $this->csv([[$email, 'Pre', 'Existing', 'member']]);
        $result = $this->service()->import($this->testTenantId, $this->orgId, $this->actorId, $csv);

        $this->assertSame(0, $result['created']);
        $this->assertSame(1, $result['linked']);

        // org_members row should reference the pre-existing user.
        $member = DB::table('org_members')
            ->where('organization_id', $this->orgId)
            ->where('user_id', $userId)
            ->first();
        $this->assertNotNull($member);
        $this->assertFalse($result['members'][0]['created']);
        $this->assertNull($result['members'][0]['temporary_password']);
    }

    public function test_preview_marks_existing_org_member_as_already_member_without_blocking_error(): void
    {
        // An already-active org member is a skippable info state, not a hard error:
        // preview() must classify the row as 'already_member' and must NOT push it
        // into the blocking $errors array (otherwise import() aborts the batch).
        $email  = 'alreadymember.' . uniqid() . '@example.test';
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'Already Member',
            'email'      => $email,
            'role'       => 'member',
            'status'     => 'active',
            'is_approved' => 1,
            'created_at' => now(),
        ]);

        DB::table('org_members')->insertOrIgnore([
            'tenant_id'       => $this->testTenantId,
            'organization_id' => $this->orgId,
            'org_type'        => 'volunteer',
            'user_id'         => $userId,
            'role'            => 'member',
            'status'          => 'active',
            'created_at'      => now(),
        ]);

        $csv    = $this->csv([[$email, 'Already', 'Member', 'member']]);
        $result = $this->service()->preview($this->testTenantId, $this->orgId, $csv);

        $this->assertSame('already_member', $result['items'][0]['action']);
        $this->assertSame([], $result['items'][0]['errors']);
        // It is an info/skip state, not a hard validation failure.
        $this->assertSame(0, $result['summary']['invalid']);
    }

    public function test_import_skips_already_member_and_imports_valid_rows(): void
    {
        // Regression: a CSV that mixes an already-member row with valid rows must
        // skip the already-member (skipped +1) and still import the rest, instead
        // of throwing InvalidArgumentException and aborting the whole import.
        $memberEmail = 'present.' . uniqid() . '@example.test';
        $memberId    = (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'Present Member',
            'email'      => $memberEmail,
            'role'       => 'member',
            'status'     => 'active',
            'is_approved' => 1,
            'created_at' => now(),
        ]);
        DB::table('org_members')->insertOrIgnore([
            'tenant_id'       => $this->testTenantId,
            'organization_id' => $this->orgId,
            'org_type'        => 'volunteer',
            'user_id'         => $memberId,
            'role'            => 'member',
            'status'          => 'active',
            'created_at'      => now(),
        ]);

        $newEmail = 'fresh.' . uniqid() . '@example.test';
        $csv = $this->csv([
            [$memberEmail, 'Present', 'Member', 'member'],
            [$newEmail,    'Fresh',   'Recruit', 'member'],
        ]);

        $result = $this->service()->import($this->testTenantId, $this->orgId, $this->actorId, $csv);

        // The already-member row is skipped, the new row is created.
        $this->assertSame(1, $result['skipped']);
        $this->assertSame(1, $result['created']);
        $this->assertSame(0, $result['linked']);

        // The valid row really landed in the database.
        $createdUser = DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('email', $newEmail)
            ->first();
        $this->assertNotNull($createdUser, 'Valid row should have been imported despite the already-member row.');
        $this->assertDatabaseHas('org_members', [
            'tenant_id'       => $this->testTenantId,
            'organization_id' => $this->orgId,
            'user_id'         => $createdUser->id,
            'status'          => 'active',
        ]);

        // Only the freshly created user is returned in members; the skipped row is not.
        $this->assertCount(1, $result['members']);
        $this->assertSame($newEmail, $result['members'][0]['email']);
    }

    public function test_import_mixed_batch_returns_correct_counts(): void
    {
        $newEmail  = 'mixednew.' . uniqid() . '@example.test';
        $linkEmail = 'mixedlink.' . uniqid() . '@example.test';

        // Pre-create the existing user.
        DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'Link Me',
            'email'      => $linkEmail,
            'role'       => 'member',
            'status'     => 'active',
            'is_approved' => 1,
            'created_at' => now(),
        ]);

        $csv = $this->csv([
            [$newEmail,  'New',  'User', 'member'],
            [$linkEmail, 'Link', 'Me',   'admin'],
        ]);

        $result = $this->service()->import($this->testTenantId, $this->orgId, $this->actorId, $csv);

        $this->assertSame(1, $result['created']);
        $this->assertSame(1, $result['linked']);
        $this->assertSame(0, $result['skipped']);
        $this->assertSame($this->actorId, $result['imported_by']);
    }
}
