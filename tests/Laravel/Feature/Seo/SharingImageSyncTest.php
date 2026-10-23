<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Seo;

use App\Models\User;
use App\Support\TenantSharingImage;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The community's social sharing image is ONE value shown and edited on two
 * screens: its own SEO page (/v2/admin/config/seo, seo_og_image_url) and the
 * super-admin tenant form (/v2/admin/super/tenants/{id}, og_image_url).
 *
 * Owner report 2026-10-23 (Timebanking UK, tenant 11): an image uploaded on
 * the SEO page did not show on the super-admin form. Each screen wrote and
 * read only its own storage place. Pinned in both directions, for removal,
 * and for rows written before the two were kept in step.
 */
class SharingImageSyncTest extends TestCase
{
    use DatabaseTransactions;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        DB::table('users')->where('id', $this->admin->id)->update([
            'is_super_admin' => 1,
            'is_tenant_super_admin' => 1,
        ]);
        // A real tenant always has a materialised path (see AdminSuperControllerTest).
        $path = DB::table('tenants')->where('id', $this->testTenantId)->value('path');
        if (trim((string) $path) === '') {
            DB::table('tenants')->where('id', $this->testTenantId)->update(['path' => '/' . $this->testTenantId . '/']);
        }
        DB::table('tenants')->where('id', $this->testTenantId)->update(['og_image_url' => '']);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', TenantSharingImage::SETTING_KEY)
            ->delete();
        $this->admin->refresh();
        Sanctum::actingAs($this->admin);
    }

    private function seoPageImage(): string
    {
        $response = $this->apiGet('/v2/admin/config/seo');
        $response->assertOk();
        return (string) $response->json('data.seo.seo_og_image_url');
    }

    private function superFormImage(): string
    {
        $response = $this->apiGet("/v2/admin/super/tenants/{$this->testTenantId}");
        $response->assertOk();
        return (string) $response->json('data.og_image_url');
    }

    private function assertBothPlacesHold(string $url): void
    {
        $this->assertSame($url, (string) DB::table('tenants')->where('id', $this->testTenantId)->value('og_image_url'));
        $this->assertSame($url, (string) DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', TenantSharingImage::SETTING_KEY)
            ->value('setting_value'));
    }

    public function test_an_image_saved_on_the_seo_page_shows_on_the_super_admin_form(): void
    {
        $url = 'https://cdn.example.test/uploads/seo-page.png';

        $this->apiPut('/v2/admin/config/seo', ['seo_og_image_url' => $url])->assertOk();

        $this->assertSame($url, $this->superFormImage());
        $this->assertSame($url, $this->seoPageImage());
        $this->assertBothPlacesHold($url);
    }

    public function test_an_image_saved_on_the_super_admin_form_shows_on_the_seo_page(): void
    {
        $url = 'https://cdn.example.test/uploads/super-form.png';

        $this->apiPut("/v2/admin/super/tenants/{$this->testTenantId}", ['og_image_url' => $url])->assertOk();

        $this->assertSame($url, $this->seoPageImage());
        $this->assertSame($url, $this->superFormImage());
        $this->assertBothPlacesHold($url);
    }

    public function test_removing_the_image_on_either_screen_removes_it_from_both(): void
    {
        $this->apiPut('/v2/admin/config/seo', ['seo_og_image_url' => 'https://cdn.example.test/a.png'])->assertOk();
        $this->apiPut('/v2/admin/config/seo', ['seo_og_image_url' => ''])->assertOk();
        $this->assertSame('', $this->superFormImage());
        $this->assertBothPlacesHold('');

        $this->apiPut("/v2/admin/super/tenants/{$this->testTenantId}", ['og_image_url' => 'https://cdn.example.test/b.png'])->assertOk();
        $this->apiPut("/v2/admin/super/tenants/{$this->testTenantId}", ['og_image_url' => ''])->assertOk();
        $this->assertSame('', $this->seoPageImage());
        $this->assertBothPlacesHold('');
    }

    public function test_an_image_stored_in_only_one_place_before_the_fix_shows_on_both_screens(): void
    {
        // Only the column (written by the super-admin form before 2026-10-23).
        DB::table('tenants')->where('id', $this->testTenantId)->update(['og_image_url' => 'https://cdn.example.test/old-column.png']);
        $this->assertSame('https://cdn.example.test/old-column.png', $this->seoPageImage());
        $this->assertSame('https://cdn.example.test/old-column.png', $this->superFormImage());

        // Only the setting (written by the SEO page before 2026-10-23) — it wins.
        DB::table('tenants')->where('id', $this->testTenantId)->update(['og_image_url' => '']);
        TenantSharingImage::writeSetting($this->testTenantId, 'https://cdn.example.test/old-setting.png');
        $this->assertSame('https://cdn.example.test/old-setting.png', $this->seoPageImage());
        $this->assertSame('https://cdn.example.test/old-setting.png', $this->superFormImage());
    }

    public function test_a_super_admin_save_that_does_not_touch_the_image_leaves_it_alone(): void
    {
        $url = 'https://cdn.example.test/uploads/keep.png';
        $this->apiPut('/v2/admin/config/seo', ['seo_og_image_url' => $url])->assertOk();

        $this->apiPut("/v2/admin/super/tenants/{$this->testTenantId}", ['tagline' => 'A new tagline'])->assertOk();

        $this->assertSame($url, $this->superFormImage());
        $this->assertBothPlacesHold($url);
    }
}
