<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E088;

use PHPUnit\Framework\TestCase;

/**
 * F-554 (E-088): production serves /storage through an Apache Alias to
 * storage/app/public, outside the web root, so none of httpdocs/.htaccess
 * applies there. Measured on the image built from Dockerfile.bluegreen: a .php
 * file stored there ran, and every other file was served with no nosniff and
 * no CSP. The local dev container uses a symlink inside the web root instead,
 * which is why the .htaccess guard looked sufficient.
 *
 * Pins that both production images load one shared Apache config for the
 * alias, and that the config itself refuses script-like files, switches the
 * PHP engine off, and sends the same nosniff + sandbox CSP as /uploads.
 */
final class F554PublicStorageAliasHardeningTest extends TestCase
{
    private const DOCKERFILES = ['Dockerfile.prod', 'Dockerfile.bluegreen'];

    private const CONFIG = 'docker/apache/storage-alias.conf';

    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = dirname(__DIR__, 5);
    }

    public function test_both_production_images_install_the_shared_storage_alias_config(): void
    {
        foreach (self::DOCKERFILES as $file) {
            $source = $this->read($file);

            self::assertMatchesRegularExpression(
                '#^COPY\s+' . preg_quote(self::CONFIG, '#') . '\s+/etc/apache2/conf-available/storage-alias\.conf\s*$#m',
                $source,
                "{$file} must install " . self::CONFIG . ' as the /storage alias config'
            );
            self::assertMatchesRegularExpression('#a2enconf\s+storage-alias\b#', $source, "{$file} must enable it");
            self::assertDoesNotMatchRegularExpression(
                '#^[^\#\n]*Alias\s+/storage#m',
                $source,
                "{$file} must not define its own /storage alias inline — a second copy is how the two images drift"
            );
        }
    }

    public function test_build_context_includes_the_config(): void
    {
        // .dockerignore excludes docker/ wholesale; without this exception the
        // COPY above fails the production build.
        self::assertMatchesRegularExpression(
            '#^!' . preg_quote(self::CONFIG, '#') . '\s*$#m',
            $this->read('.dockerignore')
        );
    }

    public function test_config_maps_storage_and_disables_overrides(): void
    {
        $config = $this->config();

        self::assertMatchesRegularExpression('#^\s*Alias\s+/storage\s+/var/www/html/storage/app/public\s*$#m', $config);
        self::assertMatchesRegularExpression('#AllowOverride\s+None#', $config);
        self::assertMatchesRegularExpression('#Options\s+[^\n]*-Indexes#', $config);
    }

    public function test_config_refuses_script_like_files_and_switches_php_off(): void
    {
        $config = $this->config();

        self::assertMatchesRegularExpression(
            '#<FilesMatch\s+"[^"]*php\[0-9\]\?[^"]*phtml[^"]*pht[^"]*phar[^"]*phps[^"]*">\s*Require\s+all\s+denied\s*</FilesMatch>#',
            $config,
            'script-like extensions must be refused outright'
        );
        self::assertMatchesRegularExpression('#php_admin_flag\s+engine\s+off#i', $config);
    }

    public function test_config_sends_nosniff_and_the_same_sandbox_csp_as_uploads(): void
    {
        $config = $this->config();

        self::assertMatchesRegularExpression('#Header\s+always\s+set\s+X-Content-Type-Options\s+"?nosniff"?#', $config);

        preg_match('#Header\s+set\s+Content-Security-Policy\s+"([^"]+)"#', $this->read('httpdocs/.htaccess'), $uploads);
        self::assertNotEmpty($uploads[1] ?? '', 'the /uploads CSP in httpdocs/.htaccess was not found');
        self::assertStringContainsString('sandbox', $uploads[1]);

        self::assertStringContainsString(
            'Header always set Content-Security-Policy "' . $uploads[1] . '"',
            $config,
            '/storage must carry exactly the /uploads sandbox CSP'
        );
    }

    private function config(): string
    {
        $path = $this->root . '/' . self::CONFIG;
        self::assertFileExists($path);

        return (string) file_get_contents($path);
    }

    private function read(string $relative): string
    {
        $path = $this->root . '/' . $relative;
        self::assertFileExists($path);

        return (string) file_get_contents($path);
    }
}
