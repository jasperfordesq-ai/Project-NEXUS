<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use App\Core\TenantContext;
use App\Services\Translation\TaxonomyNameLocalizer;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;

/**
 * Translate one category's (or skill category's) name into every platform
 * language, right after an admin creates or renames it (AWID feedback,
 * 30 Oct 2026). Queued so the admin's save is not held up by ten provider
 * calls. Anything it cannot fill is picked up by the nightly
 * `taxonomy:translate-names` sweep.
 */
final class FillCategoryNameTranslations implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;

    public int $tries = 1;
    public int $timeout = 120;

    public function __construct(
        public readonly int $tenantId,
        public readonly string $table,
        public readonly int $categoryId,
    ) {}

    public function handle(): void
    {
        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById($this->tenantId);
            TaxonomyNameLocalizer::fillMissing($this->table, $this->categoryId);
        } catch (\Throwable $e) {
            Log::error('FillCategoryNameTranslations: failed', [
                'tenant_id' => $this->tenantId,
                'table' => $this->table,
                'id' => $this->categoryId,
                'error' => $e->getMessage(),
            ]);
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }
}
