<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E064;

use App\Services\MediaThumbnailService;
use Tests\Laravel\TestCase;

/**
 * F-290 (E-062 C-1): the unauthenticated thumbnail renderer
 * (GET /v2/media/thumbnail) refused only the `vetting` folder, while
 * httpdocs/.htaccess also refuses the legacy public message-attachment and
 * voice-message folders (F-262). The renderer must refuse every folder Apache
 * refuses, and this test holds the two in step: every URI in the corpus
 * that a deny rule in httpdocs/.htaccess matches must also be refused by the
 * renderer, and ordinary uploads must still resolve.
 */
final class F290ThumbnailPrivateFolderParityTest extends TestCase
{
    /** @var list<string> */
    private array $createdFiles = [];

    protected function tearDown(): void
    {
        $uploadsRoot = base_path('httpdocs/uploads');
        foreach ($this->createdFiles as $file) {
            @unlink($file);
            // Remove now-empty parents this test may have created, never the uploads root.
            $dir = dirname($file);
            while (str_starts_with($dir, $uploadsRoot . '/') && @rmdir($dir)) {
                $dir = dirname($dir);
            }
        }
        $this->createdFiles = [];
        parent::tearDown();
    }

    private function placePng(string $uri): void
    {
        $path = base_path('httpdocs') . $uri;
        if (!is_dir(dirname($path))) {
            mkdir(dirname($path), 0755, true);
        }
        file_put_contents($path, base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
        ));
        $this->createdFiles[] = $path;
    }

    /** @return list<string> PCRE patterns of every deny rule on the uploads tree in httpdocs/.htaccess. */
    private function apacheDenyPatterns(): array
    {
        $htaccess = (string) file_get_contents(base_path('httpdocs/.htaccess'));
        $patterns = [];

        preg_match_all('@<If "%\{REQUEST_URI\} =~ m#([^#\r\n]+)#(i?)">\s*Require all denied\s*</If>@', $htaccess, $ifs, PREG_SET_ORDER);
        foreach ($ifs as $m) {
            $patterns[] = '#' . $m[1] . '#' . $m[2];
        }
        preg_match_all('@^RewriteRule \^(uploads/\S+) - \[F[^\]]*\]@m', $htaccess, $rewrites, PREG_SET_ORDER);
        foreach ($rewrites as $m) {
            $patterns[] = '#^/' . $m[1] . '#i';
        }
        $this->assertNotEmpty($patterns, 'The deny rules in httpdocs/.htaccess could not be parsed.');

        return $patterns;
    }

    private function apacheDenies(string $uri): bool
    {
        foreach ($this->apacheDenyPatterns() as $pattern) {
            if (preg_match($pattern, $uri) === 1) {
                return true;
            }
        }

        return false;
    }

    public function test_every_folder_apache_refuses_is_refused_by_the_thumbnail_renderer(): void
    {
        $hex = bin2hex(random_bytes(16));
        $tenant = (string) random_int(90000000, 99999999);
        $slug = 'f290-' . bin2hex(random_bytes(4));

        $private = [
            "/uploads/{$tenant}/message_attachments/{$hex}.png",
            "/uploads/{$tenant}/Message_Attachments/{$hex}u.png",
            "/uploads/{$tenant}/voice_messages/{$hex}.png",
            "/uploads/tenants/{$slug}/voice_messages/{$hex}.png",
            "/uploads/messages/{$hex}.png",
            "/uploads/tenants/{$slug}/vetting/documents/{$hex}.png",
        ];

        foreach ($private as $uri) {
            $this->assertTrue($this->apacheDenies($uri), "corpus check: Apache must refuse {$uri}");
            $this->placePng($uri);
            $this->assertFileExists(base_path('httpdocs') . $uri);
        }

        $svc = app(MediaThumbnailService::class);
        foreach ($private as $uri) {
            $this->assertNull($svc->resolveSourcePath($uri), "renderer must refuse what Apache refuses: {$uri}");
            $this->assertNull($svc->resolveSourcePath('https://app.example' . $uri), "renderer must refuse the absolute form: {$uri}");
        }

        // Double-slash spelling reaches the same file; the resolved-path
        // re-check must still refuse it.
        $this->assertNull($svc->resolveSourcePath("/uploads//{$tenant}/message_attachments/{$hex}.png"));

        $this->get('/api/v2/media/thumbnail?src=' . rawurlencode($private[0]), $this->withTenantHeader())
            ->assertStatus(404);
    }

    /**
     * Drift alarm: if a deny rule on the uploads tree is added to (or changed
     * in) httpdocs/.htaccess, this fails until the new folder is mirrored in
     * MediaThumbnailService::APACHE_DENIED_UPLOAD_PATTERN and added to the
     * corpus above. The script-extension rule is excluded: it refuses file
     * types, not folders, and the renderer only ever reads image files.
     */
    public function test_the_known_apache_folder_rules_are_the_ones_mirrored(): void
    {
        $folderRules = array_values(array_filter(
            $this->apacheDenyPatterns(),
            static fn (string $p): bool => str_contains($p, '^/uploads/') && !str_contains($p, 'php'),
        ));
        sort($folderRules);

        $this->assertSame([
            '#^/uploads/(?:[0-9]+/(?:message_attachments|voice_messages)|tenants/[^/]+/voice_messages|messages)(?:/|$)#i',
            '#^/uploads/(?:tenants/[^/]+/)?vetting/documents(?:/|$)#i',
        ], $folderRules, 'httpdocs/.htaccess folder deny rules changed: mirror them in MediaThumbnailService (F-290).');
    }

    public function test_control_ordinary_uploads_still_resolve(): void
    {
        $tenant = (string) random_int(90000000, 99999999);
        $slug = 'f290-' . bin2hex(random_bytes(4));

        $public = [
            "/uploads/{$tenant}/avatars/me.png",
            "/uploads/{$tenant}/listings/messages-board.png",
            "/uploads/tenants/{$slug}/posts/picture.png",
        ];

        $svc = app(MediaThumbnailService::class);
        foreach ($public as $uri) {
            $this->assertFalse($this->apacheDenies($uri), "corpus check: Apache serves {$uri}");
            $this->placePng($uri);
            $this->assertNotNull($svc->resolveSourcePath($uri), "an ordinary upload must still resolve: {$uri}");
        }
    }
}
