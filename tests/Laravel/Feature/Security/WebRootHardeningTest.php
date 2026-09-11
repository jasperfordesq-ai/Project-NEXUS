<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use PHPUnit\Framework\TestCase;

/**
 * Pins the Apache rules in httpdocs/.htaccess that stop a script placed in a
 * user-upload tree from ever reaching the PHP handler.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-11 a `.php` file written into httpdocs/uploads/ was requested over
 * HTTP in the dev container and RAN (200, PHP output), while the same request
 * under /storage/ answered 403. The storage tree had a guard; the uploads tree
 * did not, so upload validation was the only thing between an attacker and
 * code execution. In production httpdocs/uploads is a Docker volume, so the
 * uploads/.htaccess in this repository is not even the one that is live —
 * which is why the guard has to sit in the root .htaccess that ships in the
 * image.
 *
 * WHAT THIS CAN AND CANNOT PROVE
 * ------------------------------
 * PHPUnit cannot drive Apache. This test proves the rules are present in the
 * file the image ships; the behaviour itself was proven by the probe recorded in
 * the audit evidence (.local-docs-archive/security-audit-2026-09-11/evidence/
 * uploads-php-exec-probe.txt) and must be re-checked against the live service
 * after a release, exactly as the duplicated-security-headers fix had to be.
 */
class WebRootHardeningTest extends TestCase
{
    private function htaccess(): string
    {
        $path = dirname(__DIR__, 4) . '/httpdocs/.htaccess';
        $this->assertFileExists($path);

        return (string) file_get_contents($path);
    }

    public function test_storage_tree_refuses_script_extensions(): void
    {
        $this->assertMatchesRegularExpression(
            '#^RewriteRule \^storage/\.\*\\\\\.\(\?:php\[0-9\]\?\|phtml\|pht\|phar\)\(\?:/\|\$\) - \[F,L,NC\]#m',
            $this->htaccess(),
            'The /storage/ script guard has been removed or reworded. It stops uploaded scripts reaching the PHP handler.'
        );
    }

    public function test_uploads_tree_refuses_script_extensions_from_the_root_htaccess(): void
    {
        $htaccess = $this->htaccess();

        // The <If> form is deliberate: uploads/.htaccess turns RewriteEngine on,
        // and per-directory rewrite rules are not inherited by default, so a
        // root RewriteRule for ^uploads/ would be skipped there. <If> merges last
        // and a child .htaccess cannot re-grant.
        $this->assertMatchesRegularExpression(
            '#<If "%\{REQUEST_URI\} =~ m\#\^/uploads/\.\*\\\\\.\(php\[0-9\]\?\|phtml\|pht\|phar\|phps\)\(/\|\$\)\#i">\s*Require all denied\s*</If>#s',
            $htaccess,
            'The /uploads/ script guard is missing from httpdocs/.htaccess. A .php file in the upload tree would execute.'
        );
    }

    public function test_the_uploads_guard_is_not_only_in_the_uploads_directory_htaccess(): void
    {
        // Belt and braces: whatever uploads/.htaccess says, the root file must
        // carry the guard, because production mounts a volume over that folder.
        $root = $this->htaccess();
        $this->assertStringContainsString('^/uploads/', $root);
        $this->assertStringContainsString('Require all denied', $root);
    }
}
