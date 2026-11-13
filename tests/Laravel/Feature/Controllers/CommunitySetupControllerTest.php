<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Support\ColourContrast;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * "Make it yours" (warmth phase 6) — GET /v2/admin/community-setup.
 *
 * Tells a community's admin which of the six things that dress the site are
 * in place, and suggests colours taken from the community's logo. It reads
 * one community only and changes nothing.
 */
class CommunitySetupControllerTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT_ID = 990612;

    /** Files this test wrote under the uploads folder (not rolled back by the transaction). */
    private array $written = [];

    protected function setUp(): void
    {
        parent::setUp();
        // A community that has set nothing up.
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode(['modules' => ['events' => true]]),
            'tagline' => null,
        ]);
        DB::table('categories')->where('tenant_id', $this->testTenantId)->update(['icon' => null]);
        DB::table('site_announcements')->where('tenant_id', $this->testTenantId)->delete();
    }

    protected function tearDown(): void
    {
        foreach (array_reverse($this->written) as $path) {
            is_dir($path) ? @rmdir($path) : @unlink($path);
        }
        parent::tearDown();
    }

    // ================================================================
    // Who may use it
    // ================================================================

    public function test_it_refuses_a_signed_out_visitor_a_member_and_a_broker(): void
    {
        $this->apiGet('/v2/admin/community-setup')->assertStatus(401);

        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());
        $this->apiGet('/v2/admin/community-setup')->assertStatus(403);

        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']));
        $this->apiGet('/v2/admin/community-setup')->assertStatus(403);
    }

    // ================================================================
    // The six steps
    // ================================================================

    public function test_a_community_that_has_set_nothing_up_has_six_steps_to_do(): void
    {
        $this->actAsAdmin();

        $response = $this->apiGet('/v2/admin/community-setup')->assertOk();

        $response->assertJsonPath('data.total', 6)->assertJsonPath('data.done', 0);
        $this->assertSame(
            ['logo', 'colour', 'photo', 'tagline', 'themes', 'notice'],
            array_column($response->json('data.steps'), 'key'),
        );
        $this->assertSame([false, false, false, false, false, false], array_column($response->json('data.steps'), 'done'));
        $response->assertJsonPath('data.colour', null)
            ->assertJsonPath('data.look', null)
            ->assertJsonPath('data.colour_strength', 'soft')
            ->assertJsonPath('data.tagline', '')
            ->assertJsonPath('data.suggested_colours', []);
    }

    public function test_each_step_is_done_once_its_setting_is_in_place(): void
    {
        $this->actAsAdmin();

        $this->setConfig(['logo_url' => '/uploads/tenants/x/tenant-logos/logo.png']);
        $this->assertDone(['logo']);

        $this->setConfig(['primary_color' => '#A3195B', 'community_look' => 'berry', 'colour_strength' => 'vivid']);
        $this->assertDone(['logo', 'colour']);

        $this->setConfig(['community_photo_url' => '/uploads/tenants/x/community-photos/us.jpg']);
        $this->assertDone(['logo', 'colour', 'photo']);

        DB::table('tenants')->where('id', $this->testTenantId)->update(['tagline' => '  Give an hour, get an hour  ']);
        $this->assertDone(['logo', 'colour', 'photo', 'tagline']);

        $themeId = $this->theme($this->testTenantId, 'Phase Six Gardening', null);
        $this->assertDone(['logo', 'colour', 'photo', 'tagline']);
        DB::table('categories')->where('id', $themeId)->update(['icon' => 'sprout']);
        $this->assertDone(['logo', 'colour', 'photo', 'tagline', 'themes']);

        $this->notice($this->testTenantId);
        $response = $this->assertDone(['logo', 'colour', 'photo', 'tagline', 'themes', 'notice']);

        $response->assertJsonPath('data.done', 6)
            ->assertJsonPath('data.colour', '#a3195b')
            ->assertJsonPath('data.look', 'berry')
            ->assertJsonPath('data.colour_strength', 'vivid')
            ->assertJsonPath('data.tagline', 'Give an hour, get an hour')
            ->assertJsonPath('data.themes.with_picture', 1);
        $this->assertGreaterThanOrEqual(1, $response->json('data.themes.total'));
    }

    public function test_a_value_the_site_would_not_publish_does_not_count(): void
    {
        $this->actAsAdmin();
        $this->setConfig([
            'primary_color' => 'blue',                               // not a hex colour
            'community_photo_url' => 'https://elsewhere.test/us.jpg', // only an uploads path is published
            'community_look' => 'not-one-of-ours',
        ]);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['tagline' => '   ']);
        // A switched-off theme and a theme of another kind are not offer themes.
        $this->theme($this->testTenantId, 'Phase Six Retired', 'sprout', 0);
        $this->theme($this->testTenantId, 'Phase Six Event Kind', 'sprout', 1, 'event');

        $response = $this->assertDone([]);

        $response->assertJsonPath('data.colour', null)->assertJsonPath('data.look', null);
    }

    public function test_another_communitys_settings_are_never_counted(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => self::OTHER_TENANT_ID],
            [
                'name' => 'Other Setup Timebank',
                'slug' => 'other-setup-timebank-test',
                'parent_id' => null,
                'path' => '/' . self::OTHER_TENANT_ID . '/',
                'depth' => 0,
                'is_active' => true,
                'tagline' => 'A tagline that belongs to someone else',
                'configuration' => json_encode([
                    'logo_url' => '/uploads/tenants/other/tenant-logos/logo.png',
                    'primary_color' => '#15803d',
                    'community_photo_url' => '/uploads/tenants/other/community-photos/them.jpg',
                ]),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );
        $this->theme(self::OTHER_TENANT_ID, 'Phase Six Other Theme', 'sprout');
        $this->notice(self::OTHER_TENANT_ID);
        $this->actAsAdmin();

        $response = $this->assertDone([]);

        $response->assertJsonPath('data.done', 0)->assertJsonPath('data.tagline', '');
        $this->assertStringNotContainsString('someone else', (string) $response->getContent());
    }

    // ================================================================
    // Colours suggested from the logo
    // ================================================================

    public function test_colours_are_suggested_from_the_logo_and_each_can_be_saved(): void
    {
        $this->actAsAdmin();
        // A pale yellow logo: as it is, the save endpoint would refuse the colour.
        $url = $this->writeLogo([250, 204, 21]);
        $this->setConfig(['logo_url' => $url]);

        $suggested = $this->apiGet('/v2/admin/community-setup')->assertOk()->json('data.suggested_colours');

        $this->assertCount(1, $suggested);
        $this->assertGreaterThanOrEqual(ColourContrast::AA_NORMAL_TEXT, ColourContrast::ratio($suggested[0], '#ffffff'));

        // The promise: what is offered is accepted.
        $this->apiPut('/v2/admin/settings/header-colors', ['community_color' => $suggested[0]])
            ->assertOk()
            ->assertJsonPath('data.community_color', $suggested[0]);
    }

    public function test_suggestions_can_be_left_out_and_the_logo_file_is_then_not_needed(): void
    {
        $this->actAsAdmin();
        $this->setConfig(['logo_url' => $this->writeLogo([190, 18, 60])]);

        $this->apiGet('/v2/admin/community-setup?suggestions=0')->assertOk()
            ->assertJsonPath('data.suggested_colours', [])
            ->assertJsonPath('data.steps.0.done', true);
    }

    public function test_a_logo_address_outside_the_uploads_folder_is_never_opened(): void
    {
        $this->actAsAdmin();

        // A real, readable, colourful picture that sits OUTSIDE the uploads
        // folder — so the only thing keeping its colours out of the answer is
        // the folder rule itself, not a missing or unreadable file.
        $outside = storage_path('framework/phase6-outside-' . bin2hex(random_bytes(4)) . '.png');
        $image = imagecreatetruecolor(40, 40);
        imagefill($image, 0, 0, imagecolorallocate($image, 190, 18, 60));
        imagepng($image, $outside);
        $this->written[] = $outside;
        $this->assertFileExists($outside);

        foreach ([
            'https://elsewhere.test/logo.png',
            '/uploads/../../.env',
            '/../.env',
            '/uploads/tenants/does-not-exist/logo.png',
            '/uploads/../../storage/framework/' . basename($outside),
        ] as $address) {
            $this->setConfig(['logo_url' => $address]);
            $this->apiGet('/v2/admin/community-setup')->assertOk()
                ->assertJsonPath('data.suggested_colours', [])
                // The community still has a logo address, so that step is done.
                ->assertJsonPath('data.steps.0.done', true);
        }
    }

    // ================================================================
    // Helpers
    // ================================================================

    private function actAsAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    /** @param list<string> $expected the keys of the steps that should be done, in order */
    private function assertDone(array $expected): \Illuminate\Testing\TestResponse
    {
        $response = $this->apiGet('/v2/admin/community-setup')->assertOk();
        $done = array_column(array_filter($response->json('data.steps'), static fn (array $s): bool => $s['done']), 'key');
        $this->assertSame($expected, array_values($done));
        $response->assertJsonPath('data.done', count($expected));

        return $response;
    }

    /** @param array<string, string> $values merged into the test community's configuration */
    private function setConfig(array $values): void
    {
        $current = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('configuration'), true) ?: [];
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode(array_merge($current, $values)),
        ]);
    }

    private function theme(int $tenantId, string $name, ?string $icon, int $active = 1, string $type = 'listing'): int
    {
        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)),
            'type' => $type,
            'is_active' => $active,
            'icon' => $icon,
        ]);
    }

    private function notice(int $tenantId): void
    {
        DB::table('site_announcements')->insert([
            'tenant_id' => $tenantId,
            'message' => 'Welcome to our new look',
            'style' => 'info',
            'is_dismissible' => 1,
            'is_active' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Write a one-colour logo where the uploader would have put it.
     *
     * @param array{int, int, int} $rgb
     * @return string its /uploads/... address
     */
    private function writeLogo(array $rgb): string
    {
        $folder = 'phase6-setup-test-' . bin2hex(random_bytes(4));
        $dir = base_path('httpdocs/uploads/tenants/' . $folder);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            $this->markTestSkipped('The uploads folder is not writable here.');
        }
        $this->written[] = $dir;

        $image = imagecreatetruecolor(40, 40);
        imagefill($image, 0, 0, imagecolorallocate($image, ...$rgb));
        $file = $dir . '/logo.png';
        imagepng($image, $file);
        $this->written[] = $file;

        return '/uploads/tenants/' . $folder . '/logo.png';
    }
}
