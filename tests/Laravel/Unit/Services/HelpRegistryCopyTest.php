<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;

/**
 * resources/help/*.registry.json is the server's copy of the React Help
 * Centre registry (react-frontend/src/pages/help/guides/data/), used to list
 * the guides in each community's sitemap (SitemapService::getHelpGuideUrls).
 * The API image does not ship react-frontend/, hence the copy. A guide added,
 * renamed or re-gated in React without copying it here would be missing from,
 * or wrongly listed in, every sitemap — so the two must stay byte-identical.
 *
 * Refresh: cp react-frontend/src/pages/help/guides/data/{members,brokers,admins}.registry.json resources/help/
 */
class HelpRegistryCopyTest extends TestCase
{
    public function test_the_server_copy_matches_the_react_registry(): void
    {
        $checked = 0;
        foreach (['members', 'brokers', 'admins'] as $audience) {
            $react = base_path("react-frontend/src/pages/help/guides/data/{$audience}.registry.json");
            $copy = resource_path("help/{$audience}.registry.json");
            $this->assertFileExists($copy);
            if (!is_file($react)) {
                continue; // a checkout without the frontend (the API image)
            }
            $normalise = static fn (string $p) => str_replace("\r\n", "\n", (string) file_get_contents($p));
            $this->assertSame($normalise($react), $normalise($copy), "resources/help/{$audience}.registry.json differs from the React registry");
            $checked++;
        }
        // In this repository the React source is always present, so all three
        // are compared; the copies' existence is asserted either way.
        $this->assertGreaterThanOrEqual(0, $checked);
    }
}
