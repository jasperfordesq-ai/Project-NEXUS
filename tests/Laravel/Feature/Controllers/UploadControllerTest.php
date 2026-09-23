<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for UploadController — file uploads.
 */
class UploadControllerTest extends TestCase
{
    use DatabaseTransactions;

    // The upload endpoint and image library are admin tools (F-091); member
    // refusal is covered by Security\PublicSurfaceLowFindingsTest.
    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  POST /upload
    // ------------------------------------------------------------------

    public function test_store_requires_auth(): void
    {
        $response = $this->apiPost('/upload', []);

        $response->assertStatus(401);
    }

    public function test_store_requires_file(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/upload', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    // ------------------------------------------------------------------
    //  POST /v2/upload  (canonical path — used by the newsletter builder's
    //  asset manager and every frontend caller). Regression guard: this
    //  route was previously registered only as /upload, so every uploadImage()
    //  call 404'd and image uploads silently failed. A missing route returns
    //  404, so a 401/422 here proves /v2/upload is actually registered.
    // ------------------------------------------------------------------

    public function test_v2_store_route_is_registered_and_requires_auth(): void
    {
        $response = $this->apiPost('/v2/upload', []);

        $response->assertStatus(401);
        $this->assertNotSame(404, $response->getStatusCode());
    }

    public function test_v2_store_requires_file(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/upload', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
        $this->assertNotSame(404, $response->getStatusCode());
    }

    // ------------------------------------------------------------------
    //  GET /v2/upload/list  (asset library — browse the tenant's images)
    // ------------------------------------------------------------------

    public function test_v2_list_route_is_registered_and_requires_auth(): void
    {
        $response = $this->apiGet('/v2/upload/list');

        $response->assertStatus(401);
        $this->assertNotSame(404, $response->getStatusCode());
    }

    public function test_v2_list_returns_tenant_images_newest_first(): void
    {
        $this->authenticatedUser();
        Storage::fake('public');

        $dir = "tenant_{$this->testTenantId}/uploads/general";
        Storage::disk('public')->put("{$dir}/older.png", 'x');
        Storage::disk('public')->put("{$dir}/newer.jpg", 'y');
        // A non-image must be excluded from the library.
        Storage::disk('public')->put("{$dir}/notes.txt", 'z');

        $response = $this->apiGet('/v2/upload/list');

        $response->assertStatus(200);
        $body = $response->getContent();
        $this->assertStringContainsString('older.png', $body);
        $this->assertStringContainsString('newer.jpg', $body);
        $this->assertStringNotContainsString('notes.txt', $body);
    }
}
