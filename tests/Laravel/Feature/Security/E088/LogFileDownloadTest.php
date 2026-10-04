<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E088;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The Log files page's download button opened a non-API URL in a new tab and
 * downloaded nothing (E-088). The download route keeps the viewer's gate
 * (platform super admins only — logs span every community) and filename rules.
 */
final class LogFileDownloadTest extends TestCase
{
    use DatabaseTransactions;

    private string $filename = '';

    private string $path = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->filename = 'e088-fixture-' . bin2hex(random_bytes(6)) . '.log';
        $this->path = storage_path('logs') . DIRECTORY_SEPARATOR . $this->filename;
        file_put_contents($this->path, "E088 fixture line\n");
    }

    protected function tearDown(): void
    {
        @unlink($this->path);
        parent::tearDown();
    }

    public function test_platform_super_admin_downloads_a_log_as_plain_text_attachment(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'super_admin', 'is_super_admin' => true,
        ]));

        $response = $this->get($this->url($this->filename), $this->withTenantHeader([]));

        $response->assertOk();
        $this->assertSame("E088 fixture line\n", $response->streamedContent());
        $this->assertStringStartsWith('text/plain', (string) $response->headers->get('Content-Type'));
        $this->assertStringStartsWith('attachment;', (string) $response->headers->get('Content-Disposition'));
    }

    public function test_a_community_admin_cannot_download_platform_logs(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());

        $this->get($this->url($this->filename), $this->withTenantHeader([]))->assertForbidden();
    }

    public function test_only_log_files_inside_the_log_directory(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'super_admin', 'is_super_admin' => true,
        ]));

        // An encoded slash either fails route matching (404) or the name check (400).
        $traversal = $this->get($this->url('..%2F.env'), $this->withTenantHeader([]));
        $this->assertContains($traversal->getStatusCode(), [400, 404]);
        $this->get($this->url('..log'), $this->withTenantHeader([]))->assertStatus(400);
        $this->get($this->url('laravel.txt'), $this->withTenantHeader([]))->assertStatus(400);
        $this->get($this->url('missing-' . bin2hex(random_bytes(4)) . '.log'), $this->withTenantHeader([]))->assertNotFound();
    }

    private function url(string $name): string
    {
        return '/api/v2/admin/enterprise/monitoring/log-files/' . $name . '/download';
    }
}
