<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use App\Services\Safeguarding\SafeguardingChoicesEmail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Sends a member the "your safety choices" summary, ten minutes after they
 * save or change them. Unique per member while queued, so several edits in a
 * row produce one email describing where they ended up. What is sent, and
 * whether anything is, is decided by SafeguardingChoicesEmail at send time.
 */
final class SendSafeguardingChoicesSummary implements ShouldQueue, ShouldBeUnique
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 3;

    /** @var array<int, int> */
    public array $backoff = [60, 600];

    /** Below the Redis queue's retry_after (90 s); see SendVolunteerLowMoodEmails. */
    public int $timeout = 55;

    /** Matches the dispatch delay, so a later edit inside the window is absorbed. */
    public int $uniqueFor = 900;

    public function __construct(
        public readonly int $tenantId,
        public readonly int $userId,
    ) {
        $this->onQueue('emails');
    }

    public function uniqueId(): string
    {
        return $this->tenantId . ':' . $this->userId;
    }

    public function handle(SafeguardingChoicesEmail $email): void
    {
        if ($email->sendSummary($this->tenantId, $this->userId) === 'failed') {
            throw new \RuntimeException('Safeguarding choices summary not sent; retrying');
        }
    }
}
