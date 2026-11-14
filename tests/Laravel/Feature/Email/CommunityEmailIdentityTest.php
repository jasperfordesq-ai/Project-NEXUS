<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Email;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\CronJobRunner;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Emails as the community's front door (Warmth phase 6, B6): a member email
 * shows the community's own logo at the top and names the community — never
 * "Project NEXUS" — as the sender. An email for one community must never
 * carry another community's logo or name.
 */
class CommunityEmailIdentityTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT = 999;

    /** @var list<string> files this test wrote under httpdocs/uploads */
    private array $writtenFiles = [];

    protected function tearDown(): void
    {
        foreach ($this->writtenFiles as $file) {
            if (is_file($file)) {
                @unlink($file);
            }
        }
        $dir = base_path('httpdocs/uploads/tenant-logos/email-identity-test');
        if (is_dir($dir)) {
            @rmdir($dir);
        }
        parent::tearDown();
    }

    /** A real PNG under httpdocs/uploads, so its size can be measured. */
    private function makeLogo(string $name, int $width, int $height, bool $white = false): string
    {
        $dir = base_path('httpdocs/uploads/tenant-logos/email-identity-test');
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }
        $image = imagecreatetruecolor($width, $height);
        $colour = $white ? imagecolorallocate($image, 255, 255, 255) : imagecolorallocate($image, 20, 60, 120);
        imagefilledrectangle($image, 0, 0, $width - 1, $height - 1, $colour);
        $file = $dir . '/' . $name . '.png';
        imagepng($image, $file);
        imagedestroy($image);
        $this->writtenFiles[] = $file;

        return '/uploads/tenant-logos/email-identity-test/' . $name . '.png';
    }

    /** @param array<string, mixed> $config */
    private function configureTenant(int $tenantId, string $name, ?string $domain, array $config): void
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

    private function renderFor(int $tenantId): string
    {
        TenantContext::setById($tenantId);

        return EmailTemplateBuilder::make()
            ->title('You have a new message')
            ->greeting('Sam')
            ->paragraph('Body')
            ->button('Open', 'https://example.test/x')
            ->render();
    }

    public function test_the_header_shows_the_communitys_own_logo_with_its_size_and_name(): void
    {
        $logo = $this->makeLogo('alpha', 300, 100);
        $this->configureTenant($this->testTenantId, 'Alpha Timebank', 'alpha.example.org', ['logo_url' => $logo]);

        $html = $this->renderFor($this->testTenantId);

        $this->assertStringContainsString('src="https://alpha.example.org' . $logo . '"', $html);
        // 300×100 shown 56 high → 168 wide.
        $this->assertStringContainsString('width="168" height="56"', $html);
        $this->assertStringContainsString('alt="Alpha Timebank"', $html);
        // The name stays as text under the title, for mail apps that block images.
        $this->assertMatchesRegularExpression('#<p style="margin: 8px 0 0;[^"]*">Alpha Timebank</p>#', $html);
        // The logo sits above the coloured header.
        $this->assertLessThan(strpos($html, '<!-- Header -->'), strpos($html, '<!-- Community logo -->'));
    }

    public function test_an_email_for_one_community_never_carries_anothers_logo(): void
    {
        $alpha = $this->makeLogo('alpha', 300, 100);
        $beta = $this->makeLogo('beta', 200, 200);
        $this->configureTenant($this->testTenantId, 'Alpha Timebank', 'alpha.example.org', ['logo_url' => $alpha]);
        $this->configureTenant(self::OTHER_TENANT, 'Beta Exchange', 'beta.example.org', ['logo_url' => $beta]);

        $alphaHtml = $this->renderFor($this->testTenantId);
        $betaHtml = $this->renderFor(self::OTHER_TENANT);

        $this->assertStringContainsString($alpha, $alphaHtml);
        $this->assertStringNotContainsString($beta, $alphaHtml);
        $this->assertStringNotContainsString('Beta Exchange', $alphaHtml);
        $this->assertStringNotContainsString('beta.example.org', $alphaHtml);

        $this->assertStringContainsString('src="https://beta.example.org' . $beta . '"', $betaHtml);
        $this->assertStringContainsString('width="56" height="56"', $betaHtml);
        $this->assertStringNotContainsString($alpha, $betaHtml);
        $this->assertStringNotContainsString('Alpha Timebank', $betaHtml);

        // Rendering A again after B: nothing of B is left behind.
        $again = $this->renderFor($this->testTenantId);
        $this->assertStringNotContainsString($beta, $again);
    }

    public function test_a_community_without_a_logo_keeps_its_name_and_never_gets_the_platform_logo(): void
    {
        $this->configureTenant(self::OTHER_TENANT, 'Beta Exchange', 'beta.example.org', []);

        $html = $this->renderFor(self::OTHER_TENANT);

        $this->assertStringNotContainsString('<img', $html);
        $this->assertStringNotContainsString('Project NEXUS', $html);
        $this->assertStringContainsString('Beta Exchange', $html);
    }

    public function test_a_logo_that_cannot_be_shown_safely_is_left_out(): void
    {
        foreach ([
            '/uploads/tenant-logos/email-identity-test/missing.png', // no such file
            '/uploads/tenant-logos/logo.svg',                         // SVG: Gmail blocks it
            'https://elsewhere.example.com/logo.png',                 // not ours, size unknown
            '/uploads/../.env',                                       // path tricks
            'javascript:alert(1)',
        ] as $value) {
            $this->configureTenant($this->testTenantId, 'Alpha Timebank', 'alpha.example.org', ['logo_url' => $value]);

            $html = $this->renderFor($this->testTenantId);

            $this->assertStringNotContainsString('<img', $html, $value);
            $this->assertStringContainsString('Alpha Timebank', $html, $value);
        }
    }

    public function test_without_an_https_address_no_logo_is_shown(): void
    {
        // A community with no domain links through FRONTEND_URL, which is plain
        // http in local development; mail apps refuse mixed content, so the
        // logo is only used on an https address.
        putenv('FRONTEND_URL=http://localhost:5173');
        try {
            $logo = $this->makeLogo('alpha', 300, 100);
            $this->configureTenant($this->testTenantId, 'Alpha Timebank', null, ['logo_url' => $logo]);

            $this->assertStringNotContainsString('<img', $this->renderFor($this->testTenantId));
        } finally {
            putenv('FRONTEND_URL');
        }
    }

    public function test_a_mostly_white_logo_sits_on_the_community_colour(): void
    {
        $logo = $this->makeLogo('white', 240, 80, true);
        $this->configureTenant($this->testTenantId, 'Alpha Timebank', 'alpha.example.org', ['logo_url' => $logo, 'primary_color' => '#0f766e']);

        $html = $this->renderFor($this->testTenantId);

        $this->assertMatchesRegularExpression('#<td bgcolor="\#0f766e" style="padding: 24px 40px 20px;#', $html);
    }

    public function test_a_very_wide_logo_is_capped_at_240_pixels(): void
    {
        $logo = $this->makeLogo('wide', 1200, 100);
        $this->configureTenant($this->testTenantId, 'Alpha Timebank', 'alpha.example.org', ['logo_url' => $logo]);

        $this->assertStringContainsString('width="240" height="20"', $this->renderFor($this->testTenantId));
    }

    public function test_the_platform_master_keeps_its_emails_as_they_were(): void
    {
        $logo = $this->makeLogo('platform', 300, 100);
        $raw = DB::table('tenants')->where('id', 1)->value('configuration');
        if ($raw === null) {
            $this->markTestSkipped('No tenant 1 in the test database.');
        }
        $config = json_decode((string) $raw, true) ?: [];
        $config['logo_url'] = $logo;
        DB::table('tenants')->where('id', 1)->update(['configuration' => json_encode($config)]);

        $this->assertStringNotContainsString('<img', $this->renderFor(1));
    }

    public function test_a_german_member_sees_the_community_name_and_logo(): void
    {
        $logo = $this->makeLogo('alpha', 300, 100);
        $this->configureTenant($this->testTenantId, 'Alpha Timebank', 'alpha.example.org', ['logo_url' => $logo]);

        $html = LocaleContext::withLocale('de', fn () => $this->renderFor($this->testTenantId));

        $this->assertStringContainsString('alt="Alpha Timebank"', $html);
        $this->assertStringContainsString('Hallo Sam', $html);
    }

    // ---------------------------------------------------------------------
    // Subjects and greetings that named the platform
    // ---------------------------------------------------------------------

    private function invokeRunner(string $method, array $args): string
    {
        $ref = new \ReflectionMethod(CronJobRunner::class, $method);
        $ref->setAccessible(true);
        $target = $ref->isStatic() ? null : (new \ReflectionClass(CronJobRunner::class))->newInstanceWithoutConstructor();

        return (string) $ref->invoke($target, ...$args);
    }

    public function test_the_digest_subject_and_intro_name_the_community(): void
    {
        $this->configureTenant($this->testTenantId, 'Alpha Timebank', 'alpha.example.org', []);
        $this->configureTenant(self::OTHER_TENANT, 'Beta Exchange', 'beta.example.org', []);

        foreach ([[$this->testTenantId, 'Alpha Timebank', 'Beta Exchange'], [self::OTHER_TENANT, 'Beta Exchange', 'Alpha Timebank']] as [$tenantId, $own, $other]) {
            TenantContext::setById($tenantId);

            $subject = $this->invokeRunner('digestSubject', ['daily']);
            $this->assertStringContainsString($own, $subject);
            $this->assertStringNotContainsString('Project NEXUS', $subject);
            $this->assertStringNotContainsString($other, $subject);

            $body = $this->invokeRunner('generateEmailHtml', [
                ['id' => 1, 'tenant_id' => $tenantId, 'name' => 'Sam'],
                [['content_snippet' => 'Hello', 'created_at' => '2026-11-01 10:00:00', 'link' => '/feed', 'activity_type' => 'new_reply']],
                'daily',
            ]);
            $this->assertStringNotContainsString('Project NEXUS', $body);
            $this->assertStringContainsString($own, $body);
        }
    }

    public function test_a_german_member_gets_the_digest_subject_in_german_with_the_community_name(): void
    {
        $this->configureTenant($this->testTenantId, 'Alpha Timebank', 'alpha.example.org', []);
        TenantContext::setById($this->testTenantId);

        $subject = LocaleContext::withLocale('de', fn () => $this->invokeRunner('digestSubject', ['daily']));
        $intro = LocaleContext::withLocale('de', fn () => $this->invokeRunner('generateEmailHtml', [
            ['id' => 1, 'tenant_id' => $this->testTenantId, 'name' => 'Sam'],
            [['content_snippet' => 'Hallo', 'created_at' => '2026-11-01 10:00:00', 'link' => '/feed', 'activity_type' => 'new_reply']],
            'daily',
        ]));

        $this->assertSame('Ihr daily Bericht von Alpha Timebank', $subject);
        $this->assertStringContainsString('was Sie bei Alpha Timebank verpasst haben', $intro);
    }

    public function test_the_fallback_notification_subject_names_the_community(): void
    {
        $this->configureTenant(self::OTHER_TENANT, 'Beta Exchange', 'beta.example.org', []);
        TenantContext::setById(self::OTHER_TENANT);

        $en = $this->invokeRunner('resolveEmailSubject', ['an_activity_with_no_subject_of_its_own', '']);
        // German, because in the test process Laravel's own __() helper is
        // loaded first and serves only some locales' JSON namespaces.
        $de = LocaleContext::withLocale('de', fn () => $this->invokeRunner('resolveEmailSubject', ['an_activity_with_no_subject_of_its_own', '']));

        $this->assertSame('Notification from Beta Exchange', $en);
        $this->assertSame('Benachrichtigung von Beta Exchange', $de);
    }
}
