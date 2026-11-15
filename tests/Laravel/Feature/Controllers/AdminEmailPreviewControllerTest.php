<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\I18n\LocaleContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * "What your members receive" (Warmth phase 6, B6): an admin sees one sample
 * member email rendered through the real email layout for their OWN community
 * — its name, logo and colour — in their own language. Read-only: nothing is
 * sent, no member data is used, and another community never shows through.
 */
class AdminEmailPreviewControllerTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT = 999;

    private const LOGO_DIR = 'httpdocs/uploads/tenant-logos/email-preview-test';

    /** @var list<string> files this test wrote under httpdocs/uploads */
    private array $writtenFiles = [];

    /** True when this test created httpdocs/uploads/tenant-logos itself. */
    private bool $createdParentDir = false;

    protected function tearDown(): void
    {
        foreach ($this->writtenFiles as $file) {
            if (is_file($file)) {
                @unlink($file);
            }
        }
        $dir = base_path(self::LOGO_DIR);
        if (is_dir($dir)) {
            @rmdir($dir);
        }
        // Only a parent folder this test made, and only while it is empty.
        $parent = dirname($dir);
        if ($this->createdParentDir && is_dir($parent) && (scandir($parent) ?: []) === ['.', '..']) {
            @rmdir($parent);
        }
        parent::tearDown();
    }

    private function makeLogo(string $name): string
    {
        $dir = base_path(self::LOGO_DIR);
        if (!is_dir(dirname($dir))) {
            $this->createdParentDir = true;
        }
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }
        $image = imagecreatetruecolor(300, 100);
        imagefilledrectangle($image, 0, 0, 299, 99, imagecolorallocate($image, 20, 60, 120));
        $file = $dir . '/' . $name . '.png';
        imagepng($image, $file);
        imagedestroy($image);
        $this->writtenFiles[] = $file;

        return '/uploads/tenant-logos/email-preview-test/' . $name . '.png';
    }

    /** @param array<string, mixed> $config */
    private function configureTenant(int $tenantId, string $name, string $domain, array $config): void
    {
        $raw = DB::table('tenants')->where('id', $tenantId)->value('configuration');
        $current = json_decode((string) $raw, true) ?: [];
        unset($current['logo_url'], $current['primary_color']);
        DB::table('tenants')->where('id', $tenantId)->update([
            'name' => $name,
            'domain' => $domain,
            'configuration' => json_encode(array_merge($current, $config)),
        ]);
    }

    private function signIn(bool $admin, ?string $language = null): User
    {
        $factory = User::factory()->forTenant($this->testTenantId);
        if ($admin) {
            $factory = $factory->admin();
        }
        $attributes = [
            'status' => 'active',
            'is_approved' => true,
            'first_name' => 'Ottoline',
            'last_name' => 'Quexbridge',
            'email' => 'ottoline.quexbridge@example.test',
        ];
        if ($language !== null) {
            $attributes['preferred_language'] = $language;
        }
        $user = $factory->create($attributes);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    public function test_an_admin_sees_their_own_communitys_name_logo_and_colour_and_never_anothers(): void
    {
        $alpha = $this->makeLogo('alpha');
        $beta = $this->makeLogo('beta');
        $this->configureTenant($this->testTenantId, 'Alpha Timebank', 'alpha.example.org', ['logo_url' => $alpha, 'primary_color' => '#0f766e']);
        $this->configureTenant(self::OTHER_TENANT, 'Beta Exchange', 'beta.example.org', ['logo_url' => $beta, 'primary_color' => '#be185d']);
        $this->signIn(admin: true);

        $response = $this->apiGet('/v2/admin/email-preview')->assertOk();
        $html = (string) $response->json('data.html');
        $subject = (string) $response->json('data.subject');

        $this->assertStringContainsString('<!DOCTYPE html', $html);
        $this->assertStringContainsString('src="https://alpha.example.org' . $alpha . '"', $html);
        $this->assertStringContainsString('alt="Alpha Timebank"', $html);
        $this->assertStringContainsString('#0f766e', $html);
        $this->assertStringContainsString('Alpha Timebank', $subject);

        $this->assertStringNotContainsString($beta, $html);
        $this->assertStringNotContainsString('Beta Exchange', $html . $subject);
        $this->assertStringNotContainsString('beta.example.org', $html);
        $this->assertStringNotContainsString('#be185d', $html);
    }

    public function test_the_sample_uses_no_member_data_carries_no_script_and_sends_nothing(): void
    {
        Mail::fake();
        $this->configureTenant($this->testTenantId, 'Alpha Timebank', 'alpha.example.org', []);
        $this->signIn(admin: true);

        $response = $this->apiGet('/v2/admin/email-preview')->assertOk();
        $html = (string) $response->json('data.html');

        $this->assertStringNotContainsStringIgnoringCase('<script', $html);
        $this->assertStringNotContainsString('Ottoline', $html);
        $this->assertStringNotContainsString('Quexbridge', $html);
        $this->assertStringNotContainsString('ottoline.quexbridge@example.test', $html);
        // No sign-in, unsubscribe or other one-use token link.
        $this->assertStringNotContainsString('token=', $html);
        Mail::assertNothingSent();
        Mail::assertNothingQueued();
    }

    public function test_the_sample_is_written_in_the_admins_own_language(): void
    {
        $this->configureTenant($this->testTenantId, 'Alpha Timebank', 'alpha.example.org', []);
        $this->signIn(admin: true, language: 'de');

        $html = (string) $this->apiGet('/v2/admin/email-preview')->assertOk()->json('data.html');

        $german = LocaleContext::withLocale('de', fn (): string => __('emails_misc.email_preview.title'));
        $english = LocaleContext::withLocale('en', fn (): string => __('emails_misc.email_preview.title'));

        $this->assertNotSame($english, $german);
        $this->assertStringContainsString($german, $html);
        $this->assertStringNotContainsString($english, $html);
    }

    public function test_a_member_is_refused(): void
    {
        $this->signIn(admin: false);

        $this->apiGet('/v2/admin/email-preview')->assertStatus(403);
    }

    public function test_a_signed_out_visitor_is_refused(): void
    {
        $this->apiGet('/v2/admin/email-preview')->assertStatus(401);
    }
}
