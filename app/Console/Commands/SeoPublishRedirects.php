<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Services\SeoGoneMarkers;
use App\Services\SeoRedirectPublisher;
use Illuminate\Console\Command;

/**
 * Rewrite every community's redirect markers (SeoRedirectPublisher).
 *
 * Saving or deleting a redirect republishes that community at once; this is
 * the safety net (hourly, and after a fresh volume), so the markers nginx
 * reads always match the seo_redirects table.
 *
 * It also removes "gone" markers (SeoGoneMarkers) for addresses that are live
 * again, so a page republished outside the normal save path is never
 * reported to crawlers as gone for more than an hour.
 */
class SeoPublishRedirects extends Command
{
    protected $signature = 'seo:publish-redirects';

    protected $description = 'Publish URL-redirect markers for nginx so admin redirects answer 301s.';

    public function handle(SeoRedirectPublisher $publisher, SeoGoneMarkers $gone): int
    {
        $count = $publisher->publishAll();
        $this->info("Published redirect markers for {$count} communities.");
        $pruned = $gone->pruneLive();
        $this->info("Removed {$pruned} gone markers for addresses that are live again.");

        return self::SUCCESS;
    }
}
