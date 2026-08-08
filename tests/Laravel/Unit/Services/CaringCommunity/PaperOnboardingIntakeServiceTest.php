<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\PaperOnboardingIntakeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\Laravel\TestCase;

class PaperOnboardingIntakeServiceTest extends TestCase
{
    use DatabaseTransactions;

    private int $coordinatorId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();
        TenantContext::setById($this->testTenantId);

        // Create a coordinator user scoped to the test tenant.
        $this->coordinatorId = DB::table('users')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'first_name'  => 'Coord',
            'last_name'   => 'Test',
            'name'        => 'Coord Test',
            'email'       => 'coord.' . uniqid() . '@example.test',
            'role'        => 'admin',
            'is_approved' => 1,
            'created_at'  => now(),
        ]);
    }

    private function service(): PaperOnboardingIntakeService
    {
        return app(PaperOnboardingIntakeService::class);
    }

    /** Build a fake UploadedFile that Storage::fake() can accept. */
    private function fakeFile(string $name = 'form.pdf', string $mimeType = 'application/pdf'): UploadedFile
    {
        Storage::fake('local');
        return UploadedFile::fake()->create($name, 50, $mimeType);
    }

    // -------------------------------------------------------------------------
    // extractFields()
    // -------------------------------------------------------------------------

    public function test_extract_fields_maps_all_provided_seed_keys(): void
    {
        $svc = $this->service();

        $result = $svc->extractFields([
            'name'          => 'Jane Doe',
            'date_of_birth' => '1990-05-15',
            'address'       => '1 Main St',
            'phone'         => '+353 87 123 4567',
            'email'         => 'jane@example.test',
        ]);

        $this->assertSame('Jane Doe', $result['name']);
        $this->assertSame('1990-05-15', $result['date_of_birth']);
        $this->assertSame('1 Main St', $result['address']);
        $this->assertSame('+353 87 123 4567', $result['phone']);
        $this->assertSame('jane@example.test', $result['email']);
    }

    public function test_extract_fields_returns_null_for_missing_keys(): void
    {
        $result = $this->service()->extractFields([]);

        $this->assertNull($result['name']);
        $this->assertNull($result['date_of_birth']);
        $this->assertNull($result['address']);
        $this->assertNull($result['phone']);
        $this->assertNull($result['email']);
    }

    public function test_extract_fields_trims_whitespace_and_nullifies_blank_strings(): void
    {
        $result = $this->service()->extractFields([
            'name'  => '   ',
            'email' => "\t",
        ]);

        $this->assertNull($result['name']);
        $this->assertNull($result['email']);
    }

    // -------------------------------------------------------------------------
    // createFromUpload()
    // -------------------------------------------------------------------------

    public function test_create_from_upload_persists_row_and_returns_formatted_record(): void
    {
        $file = $this->fakeFile('onboarding.pdf', 'application/pdf');

        $result = $this->service()->createFromUpload(
            $this->testTenantId,
            $this->coordinatorId,
            $file,
            ['name' => 'Test Member', 'email' => 'testmember@example.test']
        );

        $this->assertIsArray($result);
        $this->assertArrayHasKey('id', $result);
        $this->assertSame($this->testTenantId, $result['tenant_id']);
        $this->assertSame($this->coordinatorId, $result['uploaded_by']);
        $this->assertSame('pending_review', $result['status']);
        $this->assertSame('onboarding.pdf', $result['original_filename']);
        $this->assertSame('manual_review_stub', $result['ocr_provider']);

        // extracted_fields should be an array with the seeded values.
        $this->assertIsArray($result['extracted_fields']);
        $this->assertSame('Test Member', $result['extracted_fields']['name']);
        $this->assertSame('testmember@example.test', $result['extracted_fields']['email']);
    }

    public function test_create_from_upload_stores_file_under_tenant_path(): void
    {
        $file = $this->fakeFile('intake.jpg', 'image/jpeg');

        $result = $this->service()->createFromUpload(
            $this->testTenantId,
            $this->coordinatorId,
            $file
        );

        // stored_path is private, but document_available is derived from it.
        // Since Storage::fake() is active, the file was stored and should be found.
        $this->assertArrayHasKey('document_available', $result);
        $this->assertTrue($result['document_available']);
    }

    public function test_create_from_upload_without_seed_fields_stores_null_extracted_fields(): void
    {
        $file = $this->fakeFile('blank.pdf');

        $result = $this->service()->createFromUpload(
            $this->testTenantId,
            $this->coordinatorId,
            $file
        );

        $extracted = $result['extracted_fields'];
        $this->assertIsArray($extracted);
        $this->assertNull($extracted['name']);
        $this->assertNull($extracted['email']);
    }

    // -------------------------------------------------------------------------
    // find()
    // -------------------------------------------------------------------------

    public function test_find_returns_null_for_unknown_id(): void
    {
        $result = $this->service()->find($this->testTenantId, 999999);
        $this->assertNull($result);
    }

    public function test_find_returns_null_for_cross_tenant_access(): void
    {
        // Create a row belonging to tenant 999.
        $rowId = DB::table('caring_paper_onboarding_intakes')->insertGetId([
            'tenant_id'         => 999,
            'uploaded_by'       => $this->coordinatorId,
            'status'            => 'pending_review',
            'original_filename' => 'other.pdf',
            'stored_path'       => 'caring-paper-onboarding/999/other.pdf',
            'ocr_provider'      => 'manual_review_stub',
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        // Looking up from our tenant must return nothing.
        $result = $this->service()->find($this->testTenantId, (int) $rowId);
        $this->assertNull($result);
    }

    // -------------------------------------------------------------------------
    // list()
    // -------------------------------------------------------------------------

    public function test_list_returns_only_pending_review_by_default(): void
    {
        // Insert one pending_review and one confirmed row.
        DB::table('caring_paper_onboarding_intakes')->insert([
            [
                'tenant_id'         => $this->testTenantId,
                'uploaded_by'       => $this->coordinatorId,
                'status'            => 'pending_review',
                'original_filename' => 'pending.pdf',
                'stored_path'       => 'caring-paper-onboarding/2/pending.pdf',
                'ocr_provider'      => 'manual_review_stub',
                'created_at'        => now(),
                'updated_at'        => now(),
            ],
            [
                'tenant_id'         => $this->testTenantId,
                'uploaded_by'       => $this->coordinatorId,
                'status'            => 'confirmed',
                'original_filename' => 'confirmed.pdf',
                'stored_path'       => 'caring-paper-onboarding/2/confirmed.pdf',
                'ocr_provider'      => 'manual_review_stub',
                'created_at'        => now(),
                'updated_at'        => now(),
            ],
        ]);

        $result = $this->service()->list($this->testTenantId);

        $this->assertArrayHasKey('count', $result);
        $this->assertArrayHasKey('items', $result);
        foreach ($result['items'] as $item) {
            $this->assertSame('pending_review', $item['status']);
        }
    }

    public function test_list_with_all_status_returns_all_rows_for_tenant(): void
    {
        DB::table('caring_paper_onboarding_intakes')->insert([
            [
                'tenant_id'         => $this->testTenantId,
                'uploaded_by'       => $this->coordinatorId,
                'status'            => 'pending_review',
                'original_filename' => 'a.pdf',
                'stored_path'       => 'caring-paper-onboarding/2/a.pdf',
                'ocr_provider'      => 'manual_review_stub',
                'created_at'        => now(),
                'updated_at'        => now(),
            ],
            [
                'tenant_id'         => $this->testTenantId,
                'uploaded_by'       => $this->coordinatorId,
                'status'            => 'rejected',
                'original_filename' => 'b.pdf',
                'stored_path'       => 'caring-paper-onboarding/2/b.pdf',
                'ocr_provider'      => 'manual_review_stub',
                'created_at'        => now(),
                'updated_at'        => now(),
            ],
        ]);

        $result = $this->service()->list($this->testTenantId, 'all');

        $statuses = array_column($result['items'], 'status');
        $this->assertContains('pending_review', $statuses);
        $this->assertContains('rejected', $statuses);
    }

    public function test_list_ignores_invalid_status_and_defaults_to_pending_review(): void
    {
        // Insert one confirmed row and one pending_review row.
        // The bad-status fallback must only return pending_review rows.
        DB::table('caring_paper_onboarding_intakes')->insert([
            [
                'tenant_id'         => $this->testTenantId,
                'uploaded_by'       => $this->coordinatorId,
                'status'            => 'confirmed',
                'original_filename' => 'c.pdf',
                'stored_path'       => 'caring-paper-onboarding/2/c.pdf',
                'ocr_provider'      => 'manual_review_stub',
                'created_at'        => now(),
                'updated_at'        => now(),
            ],
            [
                'tenant_id'         => $this->testTenantId,
                'uploaded_by'       => $this->coordinatorId,
                'status'            => 'pending_review',
                'original_filename' => 'd.pdf',
                'stored_path'       => 'caring-paper-onboarding/2/d.pdf',
                'ocr_provider'      => 'manual_review_stub',
                'created_at'        => now(),
                'updated_at'        => now(),
            ],
        ]);

        $result = $this->service()->list($this->testTenantId, 'nonsense_value');

        // Must return at least the one pending_review row we inserted.
        $this->assertGreaterThanOrEqual(1, $result['count']);
        foreach ($result['items'] as $item) {
            $this->assertSame('pending_review', $item['status']);
        }
    }

    public function test_list_excludes_rows_from_other_tenants(): void
    {
        // Insert one row for tenant 999 and one for our test tenant.
        DB::table('caring_paper_onboarding_intakes')->insert([
            [
                'tenant_id'         => 999,
                'uploaded_by'       => $this->coordinatorId,
                'status'            => 'pending_review',
                'original_filename' => 'other-tenant.pdf',
                'stored_path'       => 'caring-paper-onboarding/999/other-tenant.pdf',
                'ocr_provider'      => 'manual_review_stub',
                'created_at'        => now(),
                'updated_at'        => now(),
            ],
            [
                'tenant_id'         => $this->testTenantId,
                'uploaded_by'       => $this->coordinatorId,
                'status'            => 'pending_review',
                'original_filename' => 'ours.pdf',
                'stored_path'       => 'caring-paper-onboarding/2/ours.pdf',
                'ocr_provider'      => 'manual_review_stub',
                'created_at'        => now(),
                'updated_at'        => now(),
            ],
        ]);

        $result = $this->service()->list($this->testTenantId, 'all');

        // At least the one row we inserted for our tenant must appear.
        $this->assertGreaterThanOrEqual(1, $result['count']);
        foreach ($result['items'] as $item) {
            $this->assertSame($this->testTenantId, $item['tenant_id']);
        }
    }

    // -------------------------------------------------------------------------
    // confirm()
    // -------------------------------------------------------------------------

    public function test_confirm_returns_not_found_for_missing_intake(): void
    {
        $result = $this->service()->confirm(
            $this->testTenantId,
            999999,
            $this->coordinatorId,
            ['name' => 'Nobody', 'email' => 'nobody@example.test']
        );

        $this->assertFalse($result['success']);
        $this->assertSame('NOT_FOUND', $result['code']);
    }

    public function test_confirm_returns_validation_error_when_name_empty(): void
    {
        $rowId = DB::table('caring_paper_onboarding_intakes')->insertGetId([
            'tenant_id'         => $this->testTenantId,
            'uploaded_by'       => $this->coordinatorId,
            'status'            => 'pending_review',
            'original_filename' => 'form.pdf',
            'stored_path'       => 'caring-paper-onboarding/2/form.pdf',
            'ocr_provider'      => 'manual_review_stub',
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        $result = $this->service()->confirm(
            $this->testTenantId,
            (int) $rowId,
            $this->coordinatorId,
            ['name' => '', 'email' => 'valid@example.test']
        );

        $this->assertFalse($result['success']);
        $this->assertSame('VALIDATION_ERROR', $result['code']);
    }

    public function test_confirm_returns_validation_error_for_invalid_email(): void
    {
        $rowId = DB::table('caring_paper_onboarding_intakes')->insertGetId([
            'tenant_id'         => $this->testTenantId,
            'uploaded_by'       => $this->coordinatorId,
            'status'            => 'pending_review',
            'original_filename' => 'form2.pdf',
            'stored_path'       => 'caring-paper-onboarding/2/form2.pdf',
            'ocr_provider'      => 'manual_review_stub',
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        $result = $this->service()->confirm(
            $this->testTenantId,
            (int) $rowId,
            $this->coordinatorId,
            ['name' => 'Alice Smith', 'email' => 'not-an-email']
        );

        $this->assertFalse($result['success']);
        $this->assertSame('VALIDATION_ERROR', $result['code']);
    }

    public function test_confirm_returns_already_reviewed_when_status_is_confirmed(): void
    {
        $rowId = DB::table('caring_paper_onboarding_intakes')->insertGetId([
            'tenant_id'         => $this->testTenantId,
            'uploaded_by'       => $this->coordinatorId,
            'status'            => 'confirmed',
            'original_filename' => 'already.pdf',
            'stored_path'       => 'caring-paper-onboarding/2/already.pdf',
            'ocr_provider'      => 'manual_review_stub',
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        $result = $this->service()->confirm(
            $this->testTenantId,
            (int) $rowId,
            $this->coordinatorId,
            ['name' => 'Alice Smith', 'email' => 'alice@example.test']
        );

        $this->assertFalse($result['success']);
        $this->assertSame('ALREADY_REVIEWED', $result['code']);
    }

    public function test_confirm_creates_user_and_marks_intake_confirmed(): void
    {
        $rowId = DB::table('caring_paper_onboarding_intakes')->insertGetId([
            'tenant_id'         => $this->testTenantId,
            'uploaded_by'       => $this->coordinatorId,
            'status'            => 'pending_review',
            'original_filename' => 'newmember.pdf',
            'stored_path'       => 'caring-paper-onboarding/2/newmember.pdf',
            'ocr_provider'      => 'manual_review_stub',
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        $uniqueEmail = 'confirm.' . uniqid() . '@example.test';

        $result = $this->service()->confirm(
            $this->testTenantId,
            (int) $rowId,
            $this->coordinatorId,
            [
                'name'    => 'Mary O\'Brien',
                'email'   => $uniqueEmail,
                'phone'   => '+44 20 7946 0958',
                'address' => '22 Baker St',
                'note'    => 'Paper form dated Jan 2026',
            ]
        );

        $this->assertTrue($result['success'], 'confirm() should succeed');
        $this->assertArrayHasKey('user', $result);
        $this->assertSame($uniqueEmail, $result['user']['email']);
        $this->assertSame("Mary O'Brien", $result['user']['name']);
        $this->assertIsString($result['temp_password']);
        $this->assertGreaterThan(0, $result['user']['id']);

        // Verify DB row updated.
        $row = DB::table('caring_paper_onboarding_intakes')->where('id', $rowId)->first();
        $this->assertSame('confirmed', $row->status);
        $this->assertSame($this->coordinatorId, (int) $row->reviewed_by);
        $this->assertNotNull($row->confirmed_at);
        $this->assertSame((int) $result['user']['id'], (int) $row->created_user_id);

        // Verify corrected_fields stored correctly.
        $corrected = json_decode($row->corrected_fields, true);
        $this->assertSame($uniqueEmail, $corrected['email']);

        // Verify coordinator notes stored.
        $this->assertSame('Paper form dated Jan 2026', $row->coordinator_notes);
    }

    public function test_confirm_returns_email_exists_when_user_already_registered(): void
    {
        // Pre-create a user with the same email in the test tenant.
        $existingEmail = 'existing.' . uniqid() . '@example.test';
        DB::table('users')->insert([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'Existing User',
            'email'      => $existingEmail,
            'role'       => 'member',
            'is_approved' => 1,
            'created_at' => now(),
        ]);

        $rowId = DB::table('caring_paper_onboarding_intakes')->insertGetId([
            'tenant_id'         => $this->testTenantId,
            'uploaded_by'       => $this->coordinatorId,
            'status'            => 'pending_review',
            'original_filename' => 'dup.pdf',
            'stored_path'       => 'caring-paper-onboarding/2/dup.pdf',
            'ocr_provider'      => 'manual_review_stub',
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        $result = $this->service()->confirm(
            $this->testTenantId,
            (int) $rowId,
            $this->coordinatorId,
            ['name' => 'Some One', 'email' => $existingEmail]
        );

        $this->assertFalse($result['success']);
        $this->assertSame('EMAIL_EXISTS', $result['code']);
    }
}
