<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Support\ColourStrength;
use App\Support\CommunityLook;
use App\Support\LogoColours;
use Illuminate\Support\Facades\DB;

/**
 * "Make it yours" — how far a community has got in dressing its own site
 * (warmth phase 6).
 *
 * On 12 Nov 2026, 4 of 14 live communities had chosen a colour and none had
 * a community photo: the settings existed but were spread over seven admin
 * menus. This reports, for ONE community, which of the six things that make
 * a site look like that community are in place. Each of those is still saved
 * by the endpoint that already owned it. The one value saved here is the
 * optional founded date (warmth phase 6, D4), which lives only on this page.
 *
 * Every query is scoped to the community passed in.
 */
final class CommunitySetupService
{
    /** The steps, in the order an admin is walked through them. */
    public const STEPS = ['logo', 'colour', 'photo', 'tagline', 'themes', 'notice'];

    /** A path this application's own uploader wrote. Anything else is not read from disk. */
    private const UPLOADS_PATH = '#^/uploads/[A-Za-z0-9._/\-]+$#';

    /**
     * @return array{
     *     steps: list<array{key: string, done: bool}>,
     *     done: int,
     *     total: int,
     *     colour: ?string,
     *     look: ?string,
     *     colour_strength: string,
     *     tagline: string,
     *     themes: array{total: int, with_picture: int},
     *     suggested_colours: list<string>,
     *     founded_on: ?string
     * }
     */
    public function status(int $tenantId, bool $withSuggestions = true): array
    {
        $tenant = DB::selectOne('SELECT tagline, configuration FROM tenants WHERE id = ?', [$tenantId]);
        $config = [];
        if ($tenant && !empty($tenant->configuration)) {
            $decoded = json_decode((string) $tenant->configuration, true);
            $config = is_array($decoded) ? $decoded : [];
        }

        $logo = is_string($config['logo_url'] ?? null) ? trim($config['logo_url']) : '';
        $colour = $this->hexOrNull($config['primary_color'] ?? null);
        $photo = $config['community_photo_url'] ?? null;
        $hasPhoto = is_string($photo) && $this->isUploadsPath($photo);
        $tagline = trim((string) ($tenant->tagline ?? ''));

        $themes = DB::selectOne(
            "SELECT COUNT(*) AS total,
                    SUM(CASE WHEN icon IS NOT NULL AND icon <> '' THEN 1 ELSE 0 END) AS with_picture
               FROM categories
              WHERE tenant_id = ? AND type = 'listing' AND is_active = 1",
            [$tenantId],
        );
        $themesTotal = (int) ($themes->total ?? 0);
        $themesWithPicture = (int) ($themes->with_picture ?? 0);

        $hasNotice = DB::selectOne('SELECT 1 AS present FROM site_announcements WHERE tenant_id = ? LIMIT 1', [$tenantId]) !== null;

        $done = [
            'logo' => $logo !== '',
            'colour' => $colour !== null,
            'photo' => $hasPhoto,
            'tagline' => $tagline !== '',
            // "Started" is the honest bar: the site already guesses a picture
            // for a theme from its name, so every theme having a chosen one is
            // a nicety, not a gap.
            'themes' => $themesWithPicture > 0,
            'notice' => $hasNotice,
        ];

        $steps = [];
        foreach (self::STEPS as $key) {
            $steps[] = ['key' => $key, 'done' => $done[$key]];
        }

        return [
            'steps' => $steps,
            'done' => count(array_filter($done)),
            'total' => count(self::STEPS),
            'colour' => $colour,
            'look' => CommunityLook::normalize($config['community_look'] ?? null),
            'colour_strength' => ColourStrength::fromStored($config['colour_strength'] ?? null),
            'tagline' => $tagline,
            'themes' => ['total' => $themesTotal, 'with_picture' => $themesWithPicture],
            'suggested_colours' => $withSuggestions ? $this->coloursFromLogo($logo) : [],
            // Optional and not a step: it never moves the "x of 6" meter.
            'founded_on' => self::validFoundedOn($config['founded_on'] ?? null, now()->toDateString()),
        ];
    }

    /**
     * A founded date the community may keep: a real Y-m-d date from
     * 1 January 1900 up to and including $today. Anything else is null.
     */
    public static function validFoundedOn(mixed $value, string $today): ?string
    {
        if (!is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)) {
            return null;
        }
        if (!checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return null;
        }

        // Y-m-d strings compare correctly as text.
        return ($value >= '1900-01-01' && $value <= $today) ? $value : null;
    }

    /**
     * Save (or, with null, remove) the community's founded date as
     * configuration.founded_on — beside the other "Make it yours" values.
     * The caller has already validated it. Only the one key changes; the row
     * is locked so a colour saved at the same moment is not lost.
     */
    public function setFoundedOn(int $tenantId, ?string $foundedOn): void
    {
        DB::transaction(function () use ($tenantId, $foundedOn): void {
            $row = DB::selectOne('SELECT configuration FROM tenants WHERE id = ? FOR UPDATE', [$tenantId]);
            $config = [];
            if ($row && !empty($row->configuration)) {
                $decoded = json_decode((string) $row->configuration, true);
                if (!is_array($decoded)) {
                    // Never replace settings we could not read with a one-key object.
                    throw new \RuntimeException('Community settings could not be read; the founded date was not saved.');
                }
                $config = $decoded;
            }

            if ($foundedOn === null) {
                unset($config['founded_on']);
            } else {
                $config['founded_on'] = $foundedOn;
            }

            DB::update('UPDATE tenants SET configuration = ? WHERE id = ?', [json_encode($config), $tenantId]);
        });
    }

    /**
     * Colours taken from the community's logo, each already readable on white.
     * Only a file this application's uploader stored is opened: a logo address
     * that is a web link, or that tries to leave the uploads folder, gives no
     * suggestions.
     *
     * @return list<string>
     */
    private function coloursFromLogo(string $logoUrl): array
    {
        if ($logoUrl === '' || !$this->isUploadsPath($logoUrl)) {
            return [];
        }
        $root = realpath(base_path('httpdocs/uploads'));
        $file = realpath(base_path('httpdocs') . $logoUrl);
        if ($root === false || $file === false || !str_starts_with($file, $root . DIRECTORY_SEPARATOR)) {
            return [];
        }

        return LogoColours::fromFile($file);
    }

    private function isUploadsPath(string $path): bool
    {
        return preg_match(self::UPLOADS_PATH, $path) === 1 && !str_contains($path, '..');
    }

    private function hexOrNull(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $hex = strtolower(ltrim(trim($value), '#'));

        return preg_match('/^[0-9a-f]{6}$/', $hex) === 1 ? '#' . $hex : null;
    }
}
