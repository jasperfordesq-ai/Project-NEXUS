<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Services\SupportPendingActionService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Expire co_decide support actions the supported member never answered.
 * Runs daily; both parties were told about the action when it was prepared,
 * and the supporter is notified when it expires, so nothing ends silently.
 *
 * Always exits 0 — a scheduled command's non-zero exit becomes Sentry noise
 * (see the scheduler-foreground note in the ops references); failures are
 * logged instead.
 */
class ExpireSupportActions extends Command
{
    protected $signature = 'support-actions:expire';

    protected $description = 'Expire unanswered co-decide support actions past their expiry date';

    public function handle(SupportPendingActionService $service): int
    {
        try {
            $expired = $service->expireStale();
            $this->info("Expired {$expired} stale support action(s).");
        } catch (\Throwable $e) {
            Log::error('support-actions:expire failed', ['error' => $e->getMessage()]);
            $this->error('Failed: ' . $e->getMessage());
        }

        return self::SUCCESS;
    }
}
