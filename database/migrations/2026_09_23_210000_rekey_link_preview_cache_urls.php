<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('link_previews')) {
            return;
        }

        DB::transaction(function (): void {
            $rows = DB::table('link_previews')
                ->orderBy('id')
                ->get(['id', 'url', 'url_hash']);

            $safeRows = [];
            foreach ($rows as $row) {
                if (! $this->isSafeStoredUrl((string) $row->url)) {
                    $this->deletePreview((int) $row->id);
                    continue;
                }

                $safeRows[] = $row;
            }

            // Free every legacy unique hash before assigning the corrected
            // identities. This prevents an old collision occupant from
            // blocking a different row that legitimately owns the new hash.
            foreach ($safeRows as $row) {
                DB::table('link_previews')
                    ->where('id', (int) $row->id)
                    ->update(['url_hash' => hash('sha256', 'f052-rekey:' . $row->id . ':' . $row->url_hash)]);
            }

            /** @var array<string,int> $keeperByHash */
            $keeperByHash = [];
            foreach ($safeRows as $row) {
                $id = (int) $row->id;
                $newHash = hash('sha256', $this->normalizeUrl((string) $row->url));

                if (isset($keeperByHash[$newHash])) {
                    $this->mergePreview($id, $keeperByHash[$newHash]);
                    continue;
                }

                DB::table('link_previews')->where('id', $id)->update(['url_hash' => $newHash]);
                $keeperByHash[$newHash] = $id;
            }
        });
    }

    public function down(): void
    {
        // Deliberately irreversible: deleted credential-bearing cache metadata
        // must not be restored, and restoring the collision-prone hashes would
        // reintroduce the disclosure fixed by F-052.
    }

    private function mergePreview(int $duplicateId, int $keeperId): void
    {
        if (Schema::hasTable('post_link_previews')) {
            $links = DB::table('post_link_previews')
                ->where('link_preview_id', $duplicateId)
                ->get(['post_id', 'display_order']);
            foreach ($links as $link) {
                DB::table('post_link_previews')->insertOrIgnore([
                    'post_id' => (int) $link->post_id,
                    'link_preview_id' => $keeperId,
                    'display_order' => (int) $link->display_order,
                ]);
            }
            DB::table('post_link_previews')->where('link_preview_id', $duplicateId)->delete();
        }

        if (Schema::hasTable('message_link_previews')) {
            $links = DB::table('message_link_previews')
                ->where('link_preview_id', $duplicateId)
                ->get(['message_id']);
            foreach ($links as $link) {
                DB::table('message_link_previews')->insertOrIgnore([
                    'message_id' => (int) $link->message_id,
                    'link_preview_id' => $keeperId,
                ]);
            }
            DB::table('message_link_previews')->where('link_preview_id', $duplicateId)->delete();
        }

        DB::table('link_previews')->where('id', $duplicateId)->delete();
    }

    private function deletePreview(int $previewId): void
    {
        if (Schema::hasTable('post_link_previews')) {
            DB::table('post_link_previews')->where('link_preview_id', $previewId)->delete();
        }
        if (Schema::hasTable('message_link_previews')) {
            DB::table('message_link_previews')->where('link_preview_id', $previewId)->delete();
        }
        DB::table('link_previews')->where('id', $previewId)->delete();
    }

    private function isSafeStoredUrl(string $url): bool
    {
        $parsed = parse_url(trim($url));
        if (! is_array($parsed)
            || array_key_exists('user', $parsed)
            || array_key_exists('pass', $parsed)) {
            return false;
        }

        return in_array(strtolower((string) ($parsed['scheme'] ?? '')), ['http', 'https'], true)
            && (string) ($parsed['host'] ?? '') !== '';
    }

    private function normalizeUrl(string $url): string
    {
        $parsed = parse_url($url);
        if (! is_array($parsed)) {
            return $url;
        }

        $scheme = strtolower((string) ($parsed['scheme'] ?? 'https'));
        $host = strtolower((string) ($parsed['host'] ?? ''));
        $port = isset($parsed['port']) ? (int) $parsed['port'] : null;
        $isDefaultPort = ($scheme === 'http' && $port === 80)
            || ($scheme === 'https' && $port === 443);

        return $scheme . '://' . $host
            . ($port !== null && ! $isDefaultPort ? ':' . $port : '')
            . ($parsed['path'] ?? '/')
            . (isset($parsed['query']) ? '?' . $parsed['query'] : '')
            . (isset($parsed['fragment']) ? '#' . $parsed['fragment'] : '');
    }
};
