<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Services\PodcastService;
use Illuminate\Console\Command;

class RescanUnavailablePodcastMedia extends Command
{
    protected $signature = 'podcasts:rescan-unavailable-media {--limit=50 : Maximum episodes to re-queue per run}';

    protected $description = 'Re-queue hosted podcast audio that could not be virus-scanned, once the scanner answers';

    public function handle(): int
    {
        $requeued = PodcastService::requeueUnavailableMediaScans((int) $this->option('limit'));
        $this->info("Re-queued {$requeued} podcast episode(s) for virus scanning.");

        return Command::SUCCESS;
    }
}
