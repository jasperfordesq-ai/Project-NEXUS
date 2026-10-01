<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use App\Services\LegalPublicationDeliveryService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * F-471: writes the rest of a published policy version's recipient ledger in
 * chunks, outside the administrator's request and outside the publication
 * transaction. Idempotent — it only adds members who have no delivery row yet —
 * so a retry, a second dispatch, or the scheduler's repair pass running
 * alongside it is harmless: the unique recipient key absorbs any overlap. It is
 * deliberately NOT ShouldBeUnique — a later dispatch carries a later audience
 * cutoff and must not be dropped while an earlier one runs.
 */
final class RecordLegalPublicationDeliveries implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 3;
    public int $timeout = 600;

    /** @var list<int> */
    public array $backoff = [30, 120, 300];

    public function __construct(
        public readonly int $tenantId,
        public readonly int $versionId,
        public readonly string $cutoff,
    ) {}

    public function handle(): void
    {
        LegalPublicationDeliveryService::continueFanout($this->tenantId, $this->versionId, $this->cutoff);
    }
}
