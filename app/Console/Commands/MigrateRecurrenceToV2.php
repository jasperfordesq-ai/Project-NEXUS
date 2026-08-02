<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\EventRecurrenceRevisionService;
use App\Services\EventRecurrenceService;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Convert legacy recurring series onto the v2 ("sabre-vobject") engine.
 *
 * WHY THIS EXISTS: the v2 engine was built to replace the legacy one but the
 * switchover was never completed, leaving the platform half-migrated — and the
 * database enforcing v2's rules on legacy's rows. That mismatch is what broke
 * editing a single occurrence for every community. This command finishes the
 * job for existing data so one engine governs everything.
 *
 * WHAT IT DOES per series, in one transaction:
 *   - root: recurrence_engine/version -> sabre-vobject / 2
 *   - rule: same, plus the canonical RRULE and rule_hash produced by the
 *           engine's OWN normalizer (never reimplemented here)
 *   - each occurrence: recurrence_id derived from its stored start_time, the
 *           v2-formula occurrence_key, and the engine columns — all in ONE
 *           UPDATE, because the immutability trigger evaluates them together
 *   - one append-only ledger row per occurrence, via the revision service, so
 *           the health snapshot stays clean
 *
 * SAFETY: never inserts, deletes or reshapes occurrence rows, so registrations
 * and attendance stay attached to the rows they are already on. Idempotent —
 * already-converted rows are skipped, so a partial run is safe to repeat.
 *
 * 🔴 Read --dry-run output before running for real. Two preconditions are
 * checked and will skip a series rather than force it: a rule whose frequency
 * the v2 normalizer rejects (e.g. 'custom'), and any occurrence whose
 * occurrence_key is referenced by another table (several of those tables are
 * append-only, so the key cannot be rewritten under them).
 */
final class MigrateRecurrenceToV2 extends Command
{
    protected $signature = 'events:migrate-recurrence-to-v2
        {--dry-run : Report what would change and write nothing}
        {--tenant= : Restrict to one tenant id}
        {--root= : Restrict to one template/root event id}';

    protected $description = 'Convert legacy recurring series onto the v2 recurrence engine';

    /** Tables that copy occurrence_key and would be orphaned by a rewrite. */
    private const OCCURRENCE_KEY_TABLES = [
        'event_broadcasts', 'event_checkin_credentials', 'event_checkin_devices',
        'event_guardian_consents', 'event_invitation_campaigns', 'event_offline_sync_batches',
        'event_participation_denials', 'event_registration_settings', 'event_safety_requirements',
        'event_ticket_types', 'event_analytics_optional_facts',
    ];

    public function handle(EventRecurrenceService $recurrence, EventRecurrenceRevisionService $revisions): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $roots = DB::table('events')
            ->where('is_recurring_template', 1)
            ->where(function ($query): void {
                $query->where('recurrence_engine', '<>', EventRecurrenceService::ENGINE)
                    ->orWhereNull('recurrence_engine');
            })
            ->when($this->option('tenant') !== null, fn ($q) => $q->where('tenant_id', (int) $this->option('tenant')))
            ->when($this->option('root') !== null, fn ($q) => $q->where('id', (int) $this->option('root')))
            ->orderBy('tenant_id')
            ->orderBy('id')
            ->get(['id', 'tenant_id', 'title', 'start_time', 'timezone', 'recurrence_engine']);

        if ($roots->isEmpty()) {
            $this->info('No legacy recurring series to convert.');

            return self::SUCCESS;
        }

        $this->line($dryRun ? 'DRY RUN — nothing will be written.' : 'APPLYING changes.');
        $this->line('');

        $converted = 0;
        $skipped = 0;

        foreach ($roots as $root) {
            $result = $this->convertSeries($root, $recurrence, $revisions, $dryRun);
            $result ? $converted++ : $skipped++;
        }

        $this->line('');
        $this->info(sprintf(
            '%s %d series, skipped %d.',
            $dryRun ? 'Would convert' : 'Converted',
            $converted,
            $skipped,
        ));

        return self::SUCCESS;
    }

    private function convertSeries(
        object $root,
        EventRecurrenceService $recurrence,
        EventRecurrenceRevisionService $revisions,
        bool $dryRun,
    ): bool {
        $tenantId = (int) $root->tenant_id;
        $rootId = (int) $root->id;
        $label = "root {$rootId} (tenant {$tenantId}) \"{$root->title}\"";

        $rule = DB::table('event_recurrence_rules')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $rootId)
            ->first();

        if ($rule === null) {
            $this->warn("SKIP {$label}: no recurrence rule row — nothing to translate.");

            return false;
        }

        $occurrences = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('parent_event_id', $rootId)
            ->orderBy('start_time')
            ->get(['id', 'start_time', 'occurrence_key', 'recurrence_id', 'is_recurrence_exception']);

        // Build the canonical RRULE with the engine's own normalizer, so the
        // result is byte-identical to one v2 would have written.
        $timezone = (string) ($root->timezone ?: 'UTC');
        try {
            $startUtc = $this->strictUtc((string) $root->start_time);
            if ($startUtc === null) {
                $this->warn("SKIP {$label}: root start_time is not a clean UTC timestamp.");

                return false;
            }
            $definition = $recurrence->normalize($this->legacyInput($rule), $startUtc, $timezone);
        } catch (ValidationException $exception) {
            $this->warn(sprintf(
                'SKIP %s: the v2 normalizer rejects this rule (%s). Frequency "%s" may be unsupported.',
                $label,
                implode('; ', array_merge(...array_values($exception->errors()))),
                (string) $rule->frequency,
            ));

            return false;
        }

        // Derive each occurrence's v2 identity and check nothing pins its key.
        $plan = [];
        foreach ($occurrences as $occurrence) {
            if ($occurrence->recurrence_id !== null) {
                continue; // already converted
            }
            $start = $this->strictUtc((string) $occurrence->start_time);
            if ($start === null) {
                $this->warn("SKIP {$label}: occurrence {$occurrence->id} has an unparsable start_time.");

                return false;
            }
            $recurrenceId = $start->format('Ymd\THis\Z');
            $plan[] = [
                'id' => (int) $occurrence->id,
                'recurrence_id' => $recurrenceId,
                'occurrence_key' => $recurrence->occurrenceKey($tenantId, $rootId, $recurrenceId),
                'old_key' => (string) $occurrence->occurrence_key,
            ];
        }

        $ids = array_column($plan, 'id');
        $pinned = $this->keyReferences($ids);
        if ($pinned !== []) {
            $this->warn(sprintf(
                'SKIP %s: occurrence_key is referenced by %s — those tables are append-only, so the key cannot be rewritten.',
                $label,
                implode(', ', array_map(static fn ($t, $n): string => "{$t}({$n})", array_keys($pinned), $pinned)),
            ));

            return false;
        }

        $seen = array_column($plan, 'recurrence_id');
        if (count($seen) !== count(array_unique($seen))) {
            $this->warn("SKIP {$label}: two occurrences share a start time, so they would collide on recurrence_id.");

            return false;
        }

        $this->line("CONVERT {$label}");
        $this->line("  rrule: {$definition['rrule']}");
        $this->line('  occurrences: ' . count($plan) . ' to convert, ' . (count($occurrences) - count($plan)) . ' already v2');
        foreach ($plan as $row) {
            $this->line("    event {$row['id']} -> {$row['recurrence_id']}");
        }

        if ($dryRun) {
            return true;
        }

        DB::transaction(function () use ($tenantId, $rootId, $definition, $plan, $revisions): void {
            DB::table('events')->where('tenant_id', $tenantId)->where('id', $rootId)->update([
                'recurrence_engine' => EventRecurrenceService::ENGINE,
                'recurrence_engine_version' => EventRecurrenceService::ENGINE_VERSION,
                'updated_at' => now(),
            ]);

            DB::table('event_recurrence_rules')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $rootId)
                ->update([
                    'frequency' => $definition['frequency'],
                    'interval_value' => $definition['interval'],
                    'days_of_week' => $definition['days_of_week'],
                    'day_of_month' => ($definition['day_of_month'] ?? 0) > 0 ? $definition['day_of_month'] : null,
                    'month_of_year' => $definition['month_of_year'],
                    'rrule' => $definition['rrule'],
                    'exdates' => json_encode($definition['exdates'] ?? [], JSON_THROW_ON_ERROR),
                    'rdates' => json_encode($definition['rdates'] ?? [], JSON_THROW_ON_ERROR),
                    'recurrence_engine' => EventRecurrenceService::ENGINE,
                    'recurrence_engine_version' => EventRecurrenceService::ENGINE_VERSION,
                    'rule_hash' => $definition['rule_hash'],
                    'ends_type' => $definition['ends_type'],
                    'ends_after_count' => $definition['ends_after_count'],
                    'ends_on_date' => $definition['ends_on_date'],
                    'updated_at' => now(),
                ]);

            foreach ($plan as $row) {
                // ONE statement: the immutability trigger checks recurrence_id
                // against the engine columns in the same NEW row.
                DB::table('events')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $row['id'])
                    ->where('parent_event_id', $rootId)
                    ->update([
                        'recurrence_id' => $row['recurrence_id'],
                        'occurrence_key' => $row['occurrence_key'],
                        'recurrence_engine' => EventRecurrenceService::ENGINE,
                        'recurrence_engine_version' => EventRecurrenceService::ENGINE_VERSION,
                        'updated_at' => now(),
                    ]);

                $revisions->recordOccurrenceState(
                    $tenantId,
                    $rootId,
                    $row['id'],
                    $row['recurrence_id'],
                    $row['occurrence_key'],
                    'materialized',
                    null,
                    null,
                    ['source' => 'events:migrate-recurrence-to-v2'],
                );
            }
        });

        $this->info("  done: {$label}");

        return true;
    }

    /**
     * Legacy rule columns mapped onto the normalizer's input keys.
     *
     * @return array<string, mixed>
     */
    private function legacyInput(object $rule): array
    {
        return [
            // Prefer a stored RRULE when present: it is already the author's
            // intent and skips the legacy-field translation entirely.
            'recurrence_rrule' => $rule->rrule ?: null,
            'recurrence_frequency' => $rule->frequency,
            'recurrence_interval' => $rule->interval_value,
            'recurrence_days' => $rule->days_of_week,
            'recurrence_day_of_month' => $rule->day_of_month,
            'recurrence_month_of_year' => $rule->month_of_year,
            'recurrence_ends_type' => $rule->ends_type,
            'recurrence_ends_after_count' => $rule->ends_after_count,
            'recurrence_ends_on_date' => $rule->ends_on_date,
        ];
    }

    /**
     * Strict UTC parse, matching the engine and the earlier shipped backfill:
     * anything that does not round-trip identically is refused rather than
     * coerced.
     */
    private function strictUtc(string $value): ?DateTimeImmutable
    {
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $value, new DateTimeZone('UTC'));

        if ($parsed === false || $parsed->format('Y-m-d H:i:s') !== $value) {
            return null;
        }

        return $parsed;
    }

    /**
     * @param  list<int>  $eventIds
     * @return array<string, int>
     */
    private function keyReferences(array $eventIds): array
    {
        if ($eventIds === []) {
            return [];
        }

        $found = [];
        foreach (self::OCCURRENCE_KEY_TABLES as $table) {
            try {
                if (! \Illuminate\Support\Facades\Schema::hasTable($table)
                    || ! \Illuminate\Support\Facades\Schema::hasColumn($table, 'occurrence_key')) {
                    continue;
                }
                $count = (int) DB::table($table)->whereIn('event_id', $eventIds)->count();
                if ($count > 0) {
                    $found[$table] = $count;
                }
            } catch (\Throwable) {
                // A table we cannot inspect is treated as a blocker rather than
                // assumed empty — refusing is the safe direction here.
                $found[$table] = -1;
            }
        }

        return $found;
    }
}
