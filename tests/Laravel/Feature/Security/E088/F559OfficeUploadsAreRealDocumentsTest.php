<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E088;

use App\Core\MessageAttachmentUploader;
use App\Models\JobVacancy;
use App\Models\User;
use App\Support\Uploads\OfficeDocumentInspector;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;
use ZipArchive;

/**
 * F-559 (E-088): message attachments, resources and job CVs accepted any ZIP
 * file as .docx/.xlsx — a plain archive renamed .docx was accepted at all
 * three. Group files already checked the Office structure. One shared check
 * now applies everywhere, and also refuses Office files carrying a macro
 * project (vbaProject.bin or a macro-enabled content type).
 */
final class F559OfficeUploadsAreRealDocumentsTest extends TestCase
{
    use DatabaseTransactions;

    /** @var list<string> */
    private array $temp = [];

    protected function tearDown(): void
    {
        foreach ($this->temp as $f) {
            @unlink($f);
        }
        parent::tearDown();
    }

    public function test_the_inspector_accepts_a_genuine_document_and_refuses_the_rest(): void
    {
        $this->assertTrue(OfficeDocumentInspector::isGenuineOoxml($this->docx(), 'docx'));
        $this->assertTrue(OfficeDocumentInspector::isGenuineOoxml($this->xlsx(), 'xlsx'));

        $this->assertFalse(OfficeDocumentInspector::isGenuineOoxml($this->plainZip(), 'docx'), 'plain zip');
        $this->assertFalse(OfficeDocumentInspector::isGenuineOoxml($this->docx(), 'xlsx'), 'Word parts named .xlsx');
        $this->assertFalse(OfficeDocumentInspector::isGenuineOoxml($this->docx(['word/vbaProject.bin' => 'x']), 'docx'), 'macro project');
        $this->assertFalse(OfficeDocumentInspector::isGenuineOoxml($this->docx([], true), 'docx'), 'macro-enabled content type');
        $this->assertFalse(OfficeDocumentInspector::isGenuineOoxml($this->path('not a zip at all'), 'docx'), 'not a zip');
    }

    public function test_message_attachment_refuses_a_plain_zip_named_docx(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        MessageAttachmentUploader::upload([
            'name' => 'report.docx', 'tmp_name' => $this->plainZip(), 'error' => UPLOAD_ERR_OK, 'size' => 200,
        ]);
    }

    public function test_message_attachment_still_accepts_a_genuine_docx(): void
    {
        $result = MessageAttachmentUploader::upload([
            'name' => 'report.docx', 'tmp_name' => $this->docx(), 'error' => UPLOAD_ERR_OK, 'size' => 200,
        ]);
        $this->temp[] = storage_path('app/private/' . $result['path']);
        $this->assertSame('file', $result['type']);
    }

    public function test_resource_upload_refuses_a_plain_zip_named_docx(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]));
        $uploadDir = base_path('httpdocs/uploads/' . $this->testTenantId . '/resources');
        $before = is_dir($uploadDir) ? glob($uploadDir . '/*') ?: [] : [];

        $response = $this->apiPost('/v2/resources', [
            'title' => 'Disguised archive',
            'file' => UploadedFile::fake()->createWithContent('guide.docx', (string) file_get_contents($this->plainZip())),
        ]);

        $after = is_dir($uploadDir) ? glob($uploadDir . '/*') ?: [] : [];
        foreach (array_diff($after, $before) as $created) {
            @unlink($created);
        }
        $response->assertStatus(400);
    }

    public function test_job_cv_refuses_a_plain_zip_named_docx(): void
    {
        Storage::fake('local');
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $vacancy = JobVacancy::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $owner->id, 'status' => 'open']);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]));

        $response = $this->post("/api/v2/jobs/{$vacancy->id}/apply", [
            'message' => 'Please consider me',
            'cv' => UploadedFile::fake()->createWithContent('cv.docx', (string) file_get_contents($this->plainZip())),
        ], $this->withTenantHeader(['Accept' => 'application/json']));

        $response->assertStatus(422);
        $this->assertSame([], Storage::disk('local')->allFiles('job-applications'));
    }

    public function test_group_files_accept_a_genuine_docx_and_refuse_a_macro_one(): void
    {
        Storage::fake('local');
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($owner, ['*']);
        $group = \App\Models\Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id, 'status' => 'active', 'is_active' => true,
        ]);

        $this->apiPost("/v2/groups/{$group->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('plan.docx', (string) file_get_contents($this->docx())),
        ])->assertSuccessful();

        $this->apiPost("/v2/groups/{$group->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('macro.docx', (string) file_get_contents($this->docx(['word/vbaProject.bin' => 'x']))),
        ])->assertStatus(422);
    }

    private function docx(array $extra = [], bool $macroContentType = false): string
    {
        $type = $macroContentType
            ? 'application/vnd.ms-word.document.macroEnabled.main+xml'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

        return $this->zip(array_merge([
            '[Content_Types].xml' => '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                . '<Override PartName="/word/document.xml" ContentType="' . $type . '"/></Types>',
            '_rels/.rels' => '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
            'word/document.xml' => '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
        ], $extra));
    }

    private function xlsx(): string
    {
        return $this->zip([
            '[Content_Types].xml' => '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
            'xl/workbook.xml' => '<?xml version="1.0"?><workbook/>',
        ]);
    }

    private function plainZip(): string
    {
        return $this->zip(['readme.txt' => 'just an archive']);
    }

    /** @param array<string, string> $entries */
    private function zip(array $entries): string
    {
        $path = tempnam(sys_get_temp_dir(), 'e088f559') . '.zip';
        $zip = new ZipArchive();
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        foreach ($entries as $name => $content) {
            $zip->addFromString($name, $content);
        }
        $zip->close();
        $this->temp[] = $path;

        return $path;
    }

    private function path(string $content): string
    {
        $path = tempnam(sys_get_temp_dir(), 'e088f559');
        file_put_contents($path, $content);
        $this->temp[] = $path;

        return $path;
    }
}
