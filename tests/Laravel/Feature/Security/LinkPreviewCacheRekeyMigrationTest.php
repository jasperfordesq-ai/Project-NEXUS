<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class LinkPreviewCacheRekeyMigrationTest extends TestCase
{
    use DatabaseTransactions;

    public function test_migration_removes_credentials_rekeys_complete_identity_and_preserves_associations(): void
    {
        $suffix = bin2hex(random_bytes(6));
        $credentialId = $this->preview(
            'https://member:secret@example.com/private-' . $suffix,
            hash('sha256', 'legacy-credential-' . $suffix),
        );
        $portUrl = 'https://example.com:8443/port-' . $suffix;
        $portId = $this->preview($portUrl, hash('sha256', 'legacy-port-' . $suffix));
        $fragmentUrl = 'https://example.com/fragment-' . $suffix . '#member-token';
        $fragmentId = $this->preview($fragmentUrl, hash('sha256', 'legacy-fragment-' . $suffix));

        $canonicalUrl = 'https://example.com/equivalent-' . $suffix;
        $keeperId = $this->preview($canonicalUrl, hash('sha256', 'legacy-default-' . $suffix));
        $duplicateId = $this->preview(
            'https://example.com:443/equivalent-' . $suffix,
            hash('sha256', 'legacy-explicit-default-' . $suffix),
        );

        DB::table('post_link_previews')->insert([
            ['post_id' => 900001, 'link_preview_id' => $credentialId, 'display_order' => 0],
            ['post_id' => 900002, 'link_preview_id' => $keeperId, 'display_order' => 0],
            ['post_id' => 900003, 'link_preview_id' => $duplicateId, 'display_order' => 0],
        ]);
        DB::table('message_link_previews')->insert([
            ['message_id' => 910001, 'link_preview_id' => $credentialId],
            ['message_id' => 910002, 'link_preview_id' => $duplicateId],
        ]);

        $migration = require base_path('database/migrations/2026_09_23_210000_rekey_link_preview_cache_urls.php');
        $migration->up();

        self::assertFalse(DB::table('link_previews')->where('id', $credentialId)->exists());
        self::assertFalse(DB::table('post_link_previews')->where('link_preview_id', $credentialId)->exists());
        self::assertFalse(DB::table('message_link_previews')->where('link_preview_id', $credentialId)->exists());

        self::assertSame(
            hash('sha256', $portUrl),
            DB::table('link_previews')->where('id', $portId)->value('url_hash'),
        );
        self::assertSame(
            hash('sha256', $fragmentUrl),
            DB::table('link_previews')->where('id', $fragmentId)->value('url_hash'),
        );

        self::assertSame(1, DB::table('link_previews')
            ->whereIn('id', [$keeperId, $duplicateId])
            ->count());
        self::assertTrue(DB::table('post_link_previews')
            ->where('post_id', 900003)
            ->where('link_preview_id', $keeperId)
            ->exists());
        self::assertTrue(DB::table('message_link_previews')
            ->where('message_id', 910002)
            ->where('link_preview_id', $keeperId)
            ->exists());
    }

    private function preview(string $url, string $hash): int
    {
        return (int) DB::table('link_previews')->insertGetId([
            'url_hash' => $hash,
            'url' => $url,
            'domain' => 'example.com',
            'content_type' => 'website',
            'fetched_at' => now(),
            'expires_at' => now()->addDay(),
        ]);
    }
}
