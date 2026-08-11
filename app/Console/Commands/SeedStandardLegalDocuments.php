<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\TenantDefaultsSeeder;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Give every existing community the standard shipped Terms of Service as a
 * document members must accept.
 *
 * 🔴 Why a command rather than a migration. A migration would fire automatically
 * during an unrelated deploy and, the moment it did, every existing member of
 * every community would be required to accept before their next write. That is
 * the intended end state — but it is a large, visible change in what members
 * experience, and bundling it invisibly into a deploy gives nobody the chance to
 * pick the moment or check the numbers first. New communities are seeded
 * automatically at creation (both creation paths call the same seeder); this
 * command is the deliberate one-off for communities that already exist.
 *
 *   php artisan legal:seed-standard-terms --dry-run   # what WOULD happen
 *   php artisan legal:seed-standard-terms             # do it
 *   php artisan legal:seed-standard-terms --tenant=2  # one community only
 *
 * Idempotent and non-destructive: a community that already has a terms document
 * — its own wording, or this one from an earlier run — is skipped untouched. A
 * published document is a legal record and members have accepted a specific
 * version; overwriting it would invalidate every acceptance on file while leaving
 * the acceptance rows looking valid.
 */
class SeedStandardLegalDocuments extends Command
{
    protected $signature = 'legal:seed-standard-terms
        {--dry-run : Report what would change without writing anything}
        {--tenant= : Limit to a single tenant id}';

    protected $description = 'Seed the standard shipped Terms of Service for communities that have none';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $onlyTenant = $this->option('tenant');

        $query = DB::table('tenants')->select('id', 'name', 'slug')->orderBy('id');
        if ($onlyTenant !== null && $onlyTenant !== '') {
            if (!ctype_digit((string) $onlyTenant)) {
                $this->error('--tenant must be a numeric tenant id.');
                return self::FAILURE;
            }
            $query->where('id', (int) $onlyTenant);
        }

        $tenants = $query->get();

        if ($tenants->isEmpty()) {
            $this->warn('No tenants matched.');
            return self::SUCCESS;
        }

        $this->line($dryRun ? 'DRY RUN — nothing will be written.' : 'Seeding standard terms.');
        $this->newLine();

        $seeded = 0;
        $skipped = 0;
        $failed = 0;

        foreach ($tenants as $tenant) {
            $tenantId = (int) $tenant->id;
            $label = sprintf('#%d %s', $tenantId, $tenant->name ?: $tenant->slug ?: '(unnamed)');

            $existing = DB::table('legal_documents')
                ->where('tenant_id', $tenantId)
                ->where('document_type', 'terms')
                ->first(['id', 'requires_acceptance', 'current_version_id']);

            if ($existing) {
                // Worth reporting precisely rather than just "skipped": a community
                // whose own terms do not require acceptance, or have no published
                // version, is still not covered — and this command deliberately will
                // not change their document to make it so.
                $reason = 'already has a terms document';
                if (!$existing->requires_acceptance) {
                    $reason .= ' (🔴 which does NOT require acceptance — nobody is gated by it)';
                } elseif ($existing->current_version_id === null) {
                    $reason .= ' (🔴 with no published version — nobody is gated by it)';
                }
                $this->line("  SKIP  {$label} — {$reason}");
                $skipped++;
                continue;
            }

            if ($dryRun) {
                $members = (int) DB::table('users')->where('tenant_id', $tenantId)->count();
                $this->line("  WOULD SEED  {$label} — {$members} member(s) would be asked to accept");
                $seeded++;
                continue;
            }

            try {
                TenantDefaultsSeeder::seedStandardLegalDocuments($tenantId);
                $this->info("  SEEDED  {$label}");
                $seeded++;
            } catch (\Throwable $e) {
                $this->error("  FAILED  {$label} — {$e->getMessage()}");
                $failed++;
            }
        }

        $this->newLine();
        $this->line(sprintf(
            '%s: %d, skipped: %d, failed: %d',
            $dryRun ? 'Would seed' : 'Seeded',
            $seeded,
            $skipped,
            $failed
        ));

        if (!$dryRun && $seeded > 0) {
            $this->newLine();
            $this->warn('Members of the seeded communities must now accept before they can create or change anything.');
            $this->line('They are not locked out: reading, signing out, and the acceptance page itself all still work.');
        }

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
