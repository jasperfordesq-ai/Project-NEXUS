<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E088;

use App\Models\User;
use App\Services\Enterprise\GdprService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Admin → GDPR request → "Generate export" built the member's ZIP and said
 * "Export available", but no route let the admin fetch it (E-088). The new
 * download route serves it only to an admin of the same community, only while
 * unexpired, only from the export directory, and records every download.
 */
final class GdprExportDownloadTest extends TestCase
{
    use DatabaseTransactions;

    /** @var list<string> */
    private array $files = [];

    protected function tearDown(): void
    {
        foreach ($this->files as $f) {
            @unlink($f);
        }
        parent::tearDown();
    }

    public function test_admin_downloads_the_generated_export_and_it_is_audited(): void
    {
        $admin = $this->admin();
        $id = $this->request($this->exportFile('zip-bytes'), '+7 days');
        Sanctum::actingAs($admin);

        $response = $this->get($this->url($id), $this->withTenantHeader([]));

        $response->assertOk();
        $this->assertSame('zip-bytes', $response->streamedContent());
        $this->assertStringStartsWith('attachment;', (string) $response->headers->get('Content-Disposition'));
        $this->assertSame('application/zip', $response->headers->get('Content-Type'));
        $this->assertTrue(DB::table('gdpr_audit_log')
            ->where('tenant_id', $this->testTenantId)->where('admin_id', $admin->id)
            ->where('action', 'download_export')->where('entity_id', $id)->exists());
    }

    public function test_a_member_cannot_download_an_export(): void
    {
        $id = $this->request($this->exportFile('zip-bytes'), '+7 days');
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());

        $this->get($this->url($id), $this->withTenantHeader([]))->assertForbidden();
    }

    public function test_an_expired_export_is_not_served(): void
    {
        $id = $this->request($this->exportFile('old'), '-1 day');
        Sanctum::actingAs($this->admin());

        $this->get($this->url($id), $this->withTenantHeader([]))->assertStatus(410);
    }

    public function test_a_path_outside_the_export_directory_is_never_served(): void
    {
        $id = $this->request(base_path('.env.example'), '+7 days');
        Sanctum::actingAs($this->admin());

        $this->get($this->url($id), $this->withTenantHeader([]))->assertNotFound();
    }

    public function test_another_communitys_request_is_not_found(): void
    {
        $id = $this->request($this->exportFile('theirs'), '+7 days', 999);
        Sanctum::actingAs($this->admin());

        $this->get($this->url($id), $this->withTenantHeader([]))->assertNotFound();
    }

    public function test_a_request_with_no_export_is_not_found(): void
    {
        $id = $this->request(null, null);
        Sanctum::actingAs($this->admin());

        $this->get($this->url($id), $this->withTenantHeader([]))->assertNotFound();
    }

    private function url(int $id): string
    {
        return "/api/v2/admin/enterprise/gdpr/requests/{$id}/export/download";
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create();
    }

    private function exportFile(string $bytes): string
    {
        $dir = GdprService::exportDirectory();
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        $path = $dir . '/nexus_data_export_e088_' . bin2hex(random_bytes(6)) . '.zip';
        file_put_contents($path, $bytes);
        $this->files[] = $path;

        return $path;
    }

    private function request(?string $path, ?string $expires, ?int $tenantId = null): int
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();

        return (int) DB::table('gdpr_requests')->insertGetId([
            'user_id' => $member->id,
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'request_type' => 'access',
            'status' => 'completed',
            'export_file_path' => $path,
            'export_expires_at' => $expires === null ? null : date('Y-m-d H:i:s', strtotime($expires)),
        ]);
    }
}
