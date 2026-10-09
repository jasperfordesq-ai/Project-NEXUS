<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\GeocodingService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Schema;

/**
 * Looks up the map position of members' towns, a few at a time, across every
 * tenant. Never-tried members go first, then the longest-ago attempts, and each
 * member is marked as attempted before the network is called — so a town that
 * cannot be found never blocks the members queued behind it. See
 * GeocodingService::geocodePendingUsers().
 */
final class GeocodePendingMembers extends Command
{
    protected $signature = 'members:geocode-pending
        {--limit=40 : Most members to look at in this run (1-500)}
        {--budget=50 : Stop starting new lookups after this many seconds (1-300)}';

    protected $description = 'Look up map positions for members whose town has not been looked up yet, without ever getting stuck on an unfindable town.';

    public function handle(): int
    {
        if (!Schema::hasColumn('users', 'geocode_attempted_at')) {
            $this->warn('users.geocode_attempted_at is missing; run the migrations first.');
            return self::SUCCESS;
        }

        $limit = $this->intOption('limit', 1, 500);
        $budget = $this->intOption('budget', 1, 300);
        if ($limit === null || $budget === null) {
            return self::INVALID;
        }

        $summary = GeocodingService::geocodePendingUsers($limit, (float) $budget);

        $this->line(implode(' ', array_map(
            static fn (string $key, int $value): string => "{$key}={$value}",
            array_keys($summary),
            array_values($summary)
        )));

        // A town that cannot be found is recorded on the member and retried
        // later; it is not a failure of this run.
        return self::SUCCESS;
    }

    private function intOption(string $name, int $min, int $max): ?int
    {
        $value = filter_var($this->option($name), FILTER_VALIDATE_INT, ['options' => ['min_range' => $min, 'max_range' => $max]]);
        if ($value === false) {
            $this->error("The --{$name} option must be an integer between {$min} and {$max}.");
            return null;
        }

        return (int) $value;
    }
}
