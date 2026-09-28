<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use PHPUnit\Framework\TestCase;

/**
 * E-055 F-262 — message attachments and voice messages moved to private
 * storage in July 2026, but Apache still served the old public folders, so
 * any file the migration could not move stayed reachable by URL.
 *
 * PHPUnit cannot drive Apache (see WebRootHardeningTest). This test evaluates
 * the root .htaccess's own <If "%{REQUEST_URI} =~ m#…#i"> + "Require all
 * denied" rules against the legacy URLs, and a normal upload URL as the
 * control. The live behaviour was probed against the local Apache and must be
 * re-checked on the served host after a release.
 */
final class F262LegacyMessageMediaDeniedTest extends TestCase
{
    /** @return list<string> PCRE patterns of every <If REQUEST_URI> block that denies. */
    private function denyPatterns(): array
    {
        $path = dirname(__DIR__, 5) . '/httpdocs/.htaccess';
        $this->assertFileExists($path);
        $htaccess = (string) file_get_contents($path);

        $found = preg_match_all(
            '@<If "%\{REQUEST_URI\} =~ m#([^#\r\n]+)#(i?)">\s*Require all denied\s*</If>@',
            $htaccess,
            $matches,
            PREG_SET_ORDER
        );
        $this->assertNotFalse($found, 'The <If> deny rules in httpdocs/.htaccess could not be parsed.');

        return array_map(static fn (array $m): string => '#' . $m[1] . '#' . $m[2], $matches);
    }

    private function isDenied(string $uri): bool
    {
        foreach ($this->denyPatterns() as $pattern) {
            if (preg_match($pattern, $uri) === 1) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, array{string}> */
    public static function legacyMessageMediaUris(): array
    {
        return [
            'tenant message attachment' => ['/uploads/2/message_attachments/abc123.pdf'],
            'tenant voice message' => ['/uploads/2/voice_messages/abc123.webm'],
            'slug voice message' => ['/uploads/tenants/hour-timebank/voice_messages/abc123.m4a'],
            'unscoped legacy messages' => ['/uploads/messages/msg_abc123.pdf'],
            'upper-case variant' => ['/uploads/2/Message_Attachments/abc123.pdf'],
        ];
    }

    /** @dataProvider legacyMessageMediaUris */
    public function test_legacy_message_media_folders_are_denied(string $uri): void
    {
        $this->assertTrue($this->isDenied($uri), "{$uri} must be refused by httpdocs/.htaccess.");
    }

    public function test_control_ordinary_public_uploads_are_still_served(): void
    {
        foreach ([
            '/uploads/2/avatars/me.png',
            '/uploads/posts/photo.jpg',
            '/uploads/tenants/hour-timebank/logo.png',
            '/uploads/2/listings/messages-board.jpg',
        ] as $uri) {
            $this->assertFalse($this->isDenied($uri), "{$uri} is an ordinary public upload and must stay served.");
        }
    }
}
