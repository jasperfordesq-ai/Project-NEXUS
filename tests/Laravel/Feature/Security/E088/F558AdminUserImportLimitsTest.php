<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E088;

use App\Http\Controllers\Api\AdminUsersController;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-558 (E-088): the admin member CSV import trusted the file type the browser
 * declared ($_FILES[...]['type']) and had no size or row limit — PNG bytes
 * declared text/csv were accepted, and a 50,000-row file was processed in one
 * request. The type is now detected from the bytes, and size and row count are
 * capped before any account is created.
 */
final class F558AdminUserImportLimitsTest extends TestCase
{
    use DatabaseTransactions;

    /** @var list<string> */
    private array $tempFiles = [];

    protected function setUp(): void
    {
        parent::setUp();
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
    }

    protected function tearDown(): void
    {
        unset($_FILES['csv_file']);
        foreach ($this->tempFiles as $path) {
            @unlink($path);
        }
        parent::tearDown();
    }

    public function test_binary_content_declared_as_csv_is_refused(): void
    {
        // A PNG signature and header, declared by the browser as text/csv.
        $this->present("\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89", 'text/csv');

        $this->postImport()->assertStatus(400)->assertJsonPath('errors.0.message', __('api.csv_invalid_type'));
    }

    public function test_an_oversized_file_is_refused_before_any_row_is_read(): void
    {
        $email = 'f558-big-' . bin2hex(random_bytes(4)) . '@example.test';
        $csv = "first_name,last_name,email\nBig,File,{$email}\n" . str_repeat('#' . str_repeat('x', 1023) . "\n", (int) ceil(AdminUsersController::IMPORT_MAX_BYTES / 1024) + 1);
        $this->present($csv, 'text/csv');

        $this->postImport()->assertStatus(422)
            ->assertJsonPath('errors.0.message', __('api.csv_too_large', ['max' => AdminUsersController::IMPORT_MAX_BYTES / 1024 / 1024]));
        $this->assertFalse(DB::table('users')->where('email', $email)->exists());
    }

    public function test_too_many_rows_are_refused_and_nothing_is_imported(): void
    {
        $prefix = 'f558-rows-' . bin2hex(random_bytes(4));
        $lines = ['first_name,last_name,email'];
        for ($i = 0; $i <= AdminUsersController::IMPORT_MAX_ROWS; $i++) {
            $lines[] = "Row,{$i},{$prefix}-{$i}@example.test";
        }
        $this->present(implode("\n", $lines) . "\n", 'text/csv');

        $this->postImport()->assertStatus(422)
            ->assertJsonPath('errors.0.message', __('api.csv_too_many_rows', ['max' => AdminUsersController::IMPORT_MAX_ROWS]));
        $this->assertFalse(DB::table('users')->where('email', 'like', $prefix . '-%')->exists());
    }

    public function test_a_normal_csv_still_imports_whatever_type_the_browser_declares(): void
    {
        $email = 'f558-ok-' . bin2hex(random_bytes(4)) . '@example.test';
        // Some browsers send application/vnd.ms-excel or an empty type for .csv.
        $this->present("first_name,last_name,email\nAda,Lovelace,{$email}\n", 'application/octet-stream');

        $this->postImport()->assertOk()->assertJsonPath('data.imported', 1);
        $this->assertTrue(DB::table('users')->where('email', $email)->where('tenant_id', $this->testTenantId)->exists());
    }

    public function test_the_downloaded_template_imports_back_unchanged_apart_from_its_rows(): void
    {
        // The template starts with a UTF-8 byte-order mark (for Excel), and so
        // does a CSV saved by Excel as "CSV UTF-8". The importer read the mark
        // as part of the first column name and reported first_name missing.
        $template = (string) $this->get('/api/v2/admin/users/import/template', $this->withTenantHeader([]))->getContent();
        $this->assertStringStartsWith("\xEF\xBB\xBF", $template);

        $email = 'f558-tpl-' . bin2hex(random_bytes(4)) . '@example.test';
        $lines = preg_split('/\r?\n/', trim($template)) ?: [];
        $this->present($lines[0] . "\nAda,Lovelace,{$email},,member\n", 'text/csv');

        $this->postImport()->assertOk()->assertJsonPath('data.imported', 1);
        $this->assertTrue(DB::table('users')->where('email', $email)->exists());
    }

    private function present(string $contents, string $declaredType): void
    {
        $path = '/tmp/e088-f558-' . bin2hex(random_bytes(8)) . '.csv';
        file_put_contents($path, $contents);
        $this->tempFiles[] = $path;
        $_FILES['csv_file'] = [
            'name' => 'members.csv', 'type' => $declaredType, 'tmp_name' => $path,
            'error' => UPLOAD_ERR_OK, 'size' => filesize($path),
        ];
    }

    private function postImport(): \Illuminate\Testing\TestResponse
    {
        return $this->json('POST', '/api/v2/admin/users/import', [], [
            'Accept' => 'application/json',
            'X-Tenant-ID' => (string) $this->testTenantId,
        ]);
    }
}
