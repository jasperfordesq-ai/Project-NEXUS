<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E088;

use App\Models\User;
use App\Services\MemberImport\MemberImportFile;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * F-558 (E-088): the admin member CSV import trusted the file type the browser
 * declared ($_FILES[...]['type']) and had no size or row limit — PNG bytes
 * declared text/csv were accepted, and a 50,000-row file was processed in one
 * request. The type is now detected from the bytes, and size and row count are
 * capped before any account is created.
 *
 * Moved to /v2/admin/members/import on 8 Oct 2026 when the old endpoint was replaced.
 * The new import receives the file's bytes (base64 in JSON) with no declared
 * type at all, refuses a whole file with a file error, and creates nobody
 * until a check of the entire file found no problem.
 */
final class F558AdminUserImportLimitsTest extends TestCase
{
    use DatabaseTransactions;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        Queue::fake();
        $this->admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
    }

    /** Moved to /v2/admin/members/import on 8 Oct 2026 when the old endpoint was replaced. */
    public function test_binary_content_declared_as_csv_is_refused(): void
    {
        // A PNG signature and header, named members.csv.
        $res = $this->check("\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89")->assertOk();

        $res->assertJsonPath('data.status', 'file_error')->assertJsonPath('data.file_error.code', 'not_text');
        $this->assertNull($res->json('data.import_id'));
    }

    /** Moved to /v2/admin/members/import on 8 Oct 2026 when the old endpoint was replaced. */
    public function test_an_oversized_file_is_refused_before_any_row_is_read(): void
    {
        $email = 'f558-big-' . bin2hex(random_bytes(4)) . '@example.test';
        $csv = $this->header() . "Big,File,{$email},,,\n"
            . str_repeat('Pad,' . str_repeat('x', 1000) . ",pad@example.test,,,\n", (int) ceil(MemberImportFile::MAX_BYTES / 1024) + 1);

        $res = $this->check($csv)->assertOk();

        $res->assertJsonPath('data.status', 'file_error')
            ->assertJsonPath('data.file_error.code', 'too_large')
            ->assertJsonPath('data.file_error.params.max_mb', intdiv(MemberImportFile::MAX_BYTES, 1024 * 1024));
        $this->assertNull($res->json('data.import_id'));
        $this->assertFalse(DB::table('users')->where('email', $email)->exists());
    }

    /** Moved to /v2/admin/members/import on 8 Oct 2026 when the old endpoint was replaced. */
    public function test_too_many_rows_are_refused_and_nothing_is_imported(): void
    {
        $prefix = 'f558-rows-' . bin2hex(random_bytes(4));
        $lines = [rtrim($this->header(), "\n")];
        for ($i = 0; $i <= MemberImportFile::MAX_ROWS; $i++) {
            $lines[] = "Row,{$i},{$prefix}-{$i}@example.test,,,";
        }

        $res = $this->check(implode("\n", $lines) . "\n")->assertOk();

        $res->assertJsonPath('data.status', 'file_error')
            ->assertJsonPath('data.file_error.code', 'too_many_rows')
            ->assertJsonPath('data.file_error.params.max', MemberImportFile::MAX_ROWS);
        $this->assertNull($res->json('data.import_id'));
        $this->assertFalse(DB::table('users')->where('email', 'like', $prefix . '-%')->exists());
    }

    /** Moved to /v2/admin/members/import on 8 Oct 2026 when the old endpoint was replaced. */
    public function test_a_normal_csv_still_imports_whatever_type_the_browser_declares(): void
    {
        // The browser no longer declares a type at all: only the bytes count.
        $email = 'f558-ok-' . bin2hex(random_bytes(4)) . '@example.test';

        $this->import($this->header() . "Ada,Lovelace,{$email},,,\n")->assertJsonPath('data.totals.created', 1);
        $this->assertTrue(DB::table('users')->where('email', $email)->where('tenant_id', $this->testTenantId)->exists());
    }

    /** Moved to /v2/admin/members/import on 8 Oct 2026 when the old endpoint was replaced. */
    public function test_the_downloaded_template_imports_back_unchanged_apart_from_its_rows(): void
    {
        // The template starts with a UTF-8 byte-order mark (for Excel), and so
        // does a CSV saved by Excel as "CSV UTF-8". The importer read the mark
        // as part of the first column name and reported first_name missing.
        $template = (string) $this->get('/api/v2/admin/members/import/template', $this->withTenantHeader($this->auth()))->assertOk()->getContent();
        $this->assertStringStartsWith("\xEF\xBB\xBF", $template);

        $email = 'f558-tpl-' . bin2hex(random_bytes(4)) . '@example.test';
        $this->import($template . "Ada,Lovelace,{$email},,,\n")->assertJsonPath('data.totals.created', 1);
        $this->assertTrue(DB::table('users')->where('email', $email)->exists());
    }

    private function header(): string
    {
        return implode(',', MemberImportFile::COLUMNS) . "\n";
    }

    /** @return array<string, string> */
    private function auth(): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $this->admin->id, $this->admin->tenant_id, TwoFactorPolicy::claims('totp')
        )];
    }

    private function check(string $bytes): TestResponse
    {
        return $this->apiPost('/v2/admin/members/import/check', [
            'file_name' => 'members.csv', 'content_base64' => base64_encode($bytes),
        ], $this->auth());
    }

    /** Checks the file (it must be ready) and runs every batch; returns the last batch. */
    private function import(string $bytes): TestResponse
    {
        $check = $this->check($bytes)->assertOk()->assertJsonPath('data.status', 'ready');
        $id = (string) $check->json('data.import_id');
        $next = 0;
        do {
            $res = $this->apiPost("/v2/admin/members/import/{$id}/batch", ['from' => $next, 'count' => 50], $this->auth())->assertOk();
            $next = (int) $res->json('data.next_index');
        } while ($res->json('data.status') === 'running');

        return $res->assertJsonPath('data.status', 'completed');
    }
}
