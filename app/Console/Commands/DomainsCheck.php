<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\PlatformTeam\DomainCheckService;
use Illuminate\Console\Command;

/**
 * Daily (05:20): check every community address and every platform address —
 * does the name resolve, when does its certificate run out — and keep the
 * result for the Platform team's "Addresses and certificates" page.
 *
 * One host at a time, each distinct host once. Prints one line per host with
 * its status only (never an address or an error message). A failing host is
 * a finding, not a failure of the command: it exits 0 unless it could not run
 * at all.
 */
final class DomainsCheck extends Command
{
    protected $signature = 'domains:check';

    protected $description = 'Check that community and platform addresses resolve and when their certificates run out';

    public function handle(DomainCheckService $domains): int
    {
        try {
            $results = $domains->checkAll();
        } catch (\Throwable $e) {
            $this->error('The address check could not run (' . $e::class . ').');

            return self::FAILURE;
        }

        foreach ($results as $result) {
            $this->line($result['host'] . ' ' . $result['status']);
        }

        return self::SUCCESS;
    }
}
