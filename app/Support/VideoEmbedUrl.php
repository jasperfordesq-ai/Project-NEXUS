<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support;

/**
 * The video providers a member may embed in a page other members see (a job's
 * employer video, a course "embed" lesson), and how to recognise them.
 *
 * F-195: these URLs used to be framed as typed. Any site could therefore be
 * shown inside a platform page — including a Google-hosted form made to look
 * like our own sign-in. Only a URL this class can turn into a known provider's
 * player is accepted; the frontend rebuilds the player address from the parsed
 * video id rather than framing the stored text.
 *
 * Kept in step with react-frontend/src/lib/videoEmbed.ts.
 */
final class VideoEmbedUrl
{
    /** @var list<string> */
    private const YOUTUBE_HOSTS = [
        'youtube.com', 'www.youtube.com', 'm.youtube.com',
        'youtu.be', 'www.youtu.be',
        'youtube-nocookie.com', 'www.youtube-nocookie.com',
    ];

    /** @var list<string> */
    private const VIMEO_HOSTS = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];

    private const YOUTUBE_ID = '/^[A-Za-z0-9_-]{11}$/';
    private const VIMEO_ID = '/^\d{1,15}$/';

    /**
     * @return array{provider: 'youtube'|'vimeo', id: string}|null
     */
    public static function parse(?string $url): ?array
    {
        $raw = trim((string) $url);
        if ($raw === '' || strlen($raw) > 2048) {
            return null;
        }

        $parts = parse_url($raw);
        if (!is_array($parts) || !isset($parts['host'])) {
            return null;
        }
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if ($scheme !== 'https' && $scheme !== 'http') {
            return null;
        }
        if (isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])) {
            return null;
        }

        $host = strtolower((string) $parts['host']);
        $segments = array_values(array_filter(
            explode('/', (string) ($parts['path'] ?? '')),
            static fn (string $s): bool => $s !== ''
        ));

        if (in_array($host, self::YOUTUBE_HOSTS, true)) {
            $id = null;
            if ($host === 'youtu.be' || $host === 'www.youtu.be') {
                $id = $segments[0] ?? null;
            } elseif (($segments[0] ?? null) === 'watch') {
                parse_str((string) ($parts['query'] ?? ''), $query);
                $id = is_string($query['v'] ?? null) ? $query['v'] : null;
            } elseif (in_array($segments[0] ?? null, ['embed', 'shorts', 'v', 'live'], true)) {
                $id = $segments[1] ?? null;
            }

            return is_string($id) && preg_match(self::YOUTUBE_ID, $id) === 1
                ? ['provider' => 'youtube', 'id' => $id]
                : null;
        }

        if (in_array($host, self::VIMEO_HOSTS, true)) {
            $id = $host === 'player.vimeo.com'
                ? (($segments[0] ?? null) === 'video' ? ($segments[1] ?? null) : null)
                : ($segments[0] ?? null);

            return is_string($id) && preg_match(self::VIMEO_ID, $id) === 1
                ? ['provider' => 'vimeo', 'id' => $id]
                : null;
        }

        return null;
    }

    public static function isAllowed(?string $url): bool
    {
        return self::parse($url) !== null;
    }
}
