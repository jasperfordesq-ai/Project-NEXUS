<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Seo;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Community admins edit every SEO field the super-admin tenant form has
 * (owner, 23 Oct 2026): tagline, search engine visibility and organisation
 * type joined /v2/admin/config/seo. Both screens write the same tenants
 * columns and apply the same rules (App\Support\TenantSeoFields).
 */
class SeoFieldParityTest extends TestCase
{
    use DatabaseTransactions;

    private function actAsCommunityAdmin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
    }

    private function actAsSuperAdmin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        DB::table('users')->where('id', $admin->id)->update(['is_super_admin' => 1, 'is_tenant_super_admin' => 1]);
        $path = DB::table('tenants')->where('id', $this->testTenantId)->value('path');
        if (trim((string) $path) === '') {
            DB::table('tenants')->where('id', $this->testTenantId)->update(['path' => '/' . $this->testTenantId . '/']);
        }
        Sanctum::actingAs($admin->refresh());
    }

    public function test_a_community_admin_reads_and_saves_tagline_visibility_and_organisation_type(): void
    {
        $this->actAsCommunityAdmin();

        $this->apiPut('/v2/admin/config/seo', [
            'tenant_tagline' => '  Neighbours sharing skills  ',
            'tenant_robots_directive' => 'noindex, follow',
            'tenant_seo_organization_type' => 'CommunityOrganization',
        ])->assertOk();

        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['tagline', 'robots_directive', 'seo_organization_type']);
        $this->assertSame('Neighbours sharing skills', $row->tagline);
        $this->assertSame('noindex, follow', $row->robots_directive);
        $this->assertSame('CommunityOrganization', $row->seo_organization_type);

        $seo = $this->apiGet('/v2/admin/config/seo')->assertOk()->json('data.seo');
        $this->assertSame('Neighbours sharing skills', $seo['tenant_tagline']);
        $this->assertSame('noindex, follow', $seo['tenant_robots_directive']);
        $this->assertSame('CommunityOrganization', $seo['tenant_seo_organization_type']);

        // Clearing the choices returns them to "not set".
        $this->apiPut('/v2/admin/config/seo', ['tenant_robots_directive' => '', 'tenant_seo_organization_type' => ''])->assertOk();
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['robots_directive', 'seo_organization_type']);
        $this->assertSame('index, follow', $row->robots_directive);
        $this->assertNull($row->seo_organization_type);
    }

    public function test_both_screens_refuse_the_same_bad_values(): void
    {
        $this->actAsCommunityAdmin();
        foreach ([
            ['tenant_robots_directive', 'noindex; Set-Cookie: x=1'],
            ['tenant_seo_organization_type', 'Organization'],
            ['tenant_tagline', str_repeat('a', 256)],
            ['tenant_meta_title', str_repeat('a', 71)],
        ] as [$key, $value]) {
            $this->apiPut('/v2/admin/config/seo', [$key => $value])
                ->assertStatus(422)
                ->assertJsonPath('errors.0.field', $key);
        }

        $this->actAsSuperAdmin();
        foreach ([
            ['robots_directive', 'noindex; Set-Cookie: x=1'],
            ['seo_organization_type', 'Organization'],
            ['tagline', str_repeat('a', 256)],
        ] as [$key, $value]) {
            $this->apiPut("/v2/admin/super/tenants/{$this->testTenantId}", [$key => $value])
                ->assertStatus(422)
                ->assertJsonPath('errors.0.field', $key);
        }
    }

    public function test_a_value_saved_on_either_screen_shows_on_the_other(): void
    {
        $this->actAsSuperAdmin();
        $this->apiPut("/v2/admin/super/tenants/{$this->testTenantId}", [
            'tagline' => 'Set by the platform', 'robots_directive' => 'index, nofollow', 'seo_organization_type' => 'LocalBusiness',
        ])->assertOk();

        $seo = $this->apiGet('/v2/admin/config/seo')->assertOk()->json('data.seo');
        $this->assertSame('Set by the platform', $seo['tenant_tagline']);
        $this->assertSame('index, nofollow', $seo['tenant_robots_directive']);
        $this->assertSame('LocalBusiness', $seo['tenant_seo_organization_type']);

        $this->apiPut('/v2/admin/config/seo', ['tenant_tagline' => 'Set by the community'])->assertOk();
        $this->assertSame('Set by the community', $this->apiGet("/v2/admin/super/tenants/{$this->testTenantId}")->json('data.tagline'));
    }

    public function test_the_general_settings_save_applies_the_same_rules_and_keeps_one_sharing_image(): void
    {
        $this->actAsCommunityAdmin();
        $this->apiPut('/v2/admin/settings', ['meta_title' => str_repeat('a', 71)])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'meta_title');
        $this->apiPut('/v2/admin/settings', ['og_image_url' => 'javascript:alert(1)'])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'og_image_url');

        $url = 'https://cdn.example.test/uploads/general.png';
        $this->apiPut('/v2/admin/settings', ['og_image_url' => $url])->assertOk();
        $this->assertSame($url, $this->apiGet('/v2/admin/config/seo')->json('data.seo.seo_og_image_url'));
    }

    public function test_creating_a_community_applies_the_same_rules(): void
    {
        $this->actAsSuperAdmin();
        $this->apiPost('/v2/admin/super/tenants', [
            'name' => 'Rules check ' . uniqid(), 'parent_id' => $this->testTenantId,
            'robots_directive' => 'noindex; Set-Cookie: x=1',
        ])->assertStatus(422)->assertJsonPath('errors.0.field', 'robots_directive');
    }

    public function test_legacy_bare_social_links_and_site_paths_do_not_block_a_save(): void
    {
        $this->actAsSuperAdmin();
        $this->apiPut("/v2/admin/super/tenants/{$this->testTenantId}", [
            'social_facebook' => 'facebook.com/ourtimebank', 'og_image_url' => '/uploads/share.png',
        ])->assertOk();
        $this->apiPut("/v2/admin/super/tenants/{$this->testTenantId}", ['social_twitter' => 'javascript:alert(1)'])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'social_twitter');
    }
}
