<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Sentry NEXUS-PHP-7A (3 Nov 2026): uploading a resource with the description
 * left blank. Laravel turns the empty form field into null, and
 * `trim(null)` raised a PHP deprecation on every such upload.
 */
class ResourceUploadBlankDescriptionTest extends TestCase
{
    use DatabaseTransactions;

    public function test_blank_description_upload_raises_no_deprecation_and_stores_empty_text(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]), ['*']);

        $uploadDir = base_path('httpdocs/uploads/' . $this->testTenantId . '/resources');
        $before = is_dir($uploadDir) ? glob($uploadDir . '/*') ?: [] : [];

        $deprecations = [];
        set_error_handler(function (int $no, string $msg) use (&$deprecations) {
            $deprecations[] = $msg;
            return true;
        }, E_DEPRECATED | E_USER_DEPRECATED);

        try {
            $response = $this->apiPost('/v2/resources', [
                'title' => 'Blank description guide',
                'description' => '',
                'file' => UploadedFile::fake()->createWithContent(
                    'guide.txt',
                    "Plain text guide.\n"
                ),
            ]);
        } finally {
            restore_error_handler();
            $after = is_dir($uploadDir) ? glob($uploadDir . '/*') ?: [] : [];
            foreach (array_diff($after, $before) as $created) {
                @unlink($created);
            }
        }

        $this->assertContains($response->status(), [200, 201], (string) $response->getContent());
        $this->assertSame([], array_values(array_filter(
            $deprecations,
            fn (string $m) => str_contains($m, 'trim()')
        )));

        $row = DB::table('resources')
            ->where('tenant_id', $this->testTenantId)
            ->where('title', 'Blank description guide')
            ->first();
        $this->assertNotNull($row);
        $this->assertSame('', (string) $row->description);
    }
}
