<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\MemberImport\InvitationOutbox;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Schema;

/**
 * Sends queued welcome invitations (member import and the admin "send
 * invitation" action) from the durable outbox, about one a second. Scheduled
 * every minute on one server without overlap; the outbox's own claim tokens
 * keep it safe even if two runs do overlap.
 */
final class SendMemberInvitations extends Command
{
    protected $signature = 'members:send-invitations
        {--limit=60 : Maximum invitations claimed in this run (1-500)}
        {--budget=50 : Stop sending after this many seconds (1-300)}
        {--gap-ms=1000 : Pause between two emails, in milliseconds (0-10000)}';

    protected $description = 'Send queued welcome invitations from the member invitation outbox at a steady pace.';

    public function handle(InvitationOutbox $outbox): int
    {
        if (!Schema::hasTable('member_invitation_outbox')) {
            $this->warn('Member invitation outbox schema is unavailable.');
            return self::SUCCESS;
        }

        $limit = $this->intOption('limit', 1, 500);
        $budget = $this->intOption('budget', 1, 300);
        $gapMs = $this->intOption('gap-ms', 0, 10000);
        if ($limit === null || $budget === null || $gapMs === null) {
            return self::INVALID;
        }

        $summary = $outbox->drain($limit, (float) $budget, $gapMs);

        $this->line(implode(' ', array_map(
            static fn (string $key, int $value): string => "{$key}={$value}",
            array_keys($summary),
            array_values($summary)
        )));

        // Failed sends are recorded on their rows (and retried or given up);
        // they are not a failure of this run.
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
