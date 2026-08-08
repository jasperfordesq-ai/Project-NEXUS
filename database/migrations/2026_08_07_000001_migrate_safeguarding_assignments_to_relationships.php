<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Phase 5c of the guardian redesign: copy staff-recorded guardian
 * arrangements from `safeguarding_assignments` into `account_relationships`,
 * where the live code now reads and writes them.
 *
 * Mapping (see GuardianArrangementService for the state model):
 *   guardian_user_id → parent_user_id      ward_user_id → child_user_id
 *   assigned_by      → proposed_by_user_id notes        → staff_notes
 *   assigned_at      → created_at          consent_given_at → approved_at (status active)
 *   consent_declined_at  → declined_at  (status pending — the member's "no"
 *   consent_withdrawn_at → withdrawn_at  is not a staff revocation)
 *   revoked_at not null  → status revoked
 *
 * Rules:
 * - COPY, never move. `safeguarding_assignments` and its trigger-protected
 *   event trail remain untouched as a read-only archive; an append-only
 *   history must never be rewritten or re-homed.
 * - One row per (guardian, member, tenant) exists in the destination (unique
 *   key). If ANY relationship already exists for the pair — member-created or
 *   otherwise — the assignment is SKIPPED and logged, and stays visible in
 *   the archive. Silently merging a staff record into a member-granted link
 *   would blur who created what.
 * - Idempotent: re-running skips everything that already has a pair row.
 * - Migrated rows are tier 0 (grants nothing), exactly what the source table
 *   guaranteed by having no capability columns at all.
 * - No events are fabricated for migrated rows — their history lives in the
 *   archive's own event table. New transitions write to
 *   account_relationship_events from now on.
 */
return new class extends Migration
{
    public function up(): void
    {
        $tierZero = json_encode([
            'can_view_activity'   => false,
            'can_manage_listings' => false,
            'can_transact'        => false,
            'can_view_messages'   => false,
            'tiers' => ['activity' => 'none', 'listings' => 'none', 'credits' => 'none'],
        ]);

        $migrated = 0;
        $skipped = 0;

        DB::table('safeguarding_assignments')
            ->orderBy('id')
            ->chunkById(200, function ($assignments) use ($tierZero, &$migrated, &$skipped): void {
                foreach ($assignments as $a) {
                    $exists = DB::table('account_relationships')
                        ->where('tenant_id', $a->tenant_id)
                        ->where('parent_user_id', $a->guardian_user_id)
                        ->where('child_user_id', $a->ward_user_id)
                        ->exists();

                    if ($exists) {
                        // Preserve the member-approved status and tiers while
                        // attaching staff provenance. Skipping the pair made a
                        // current safeguarding arrangement invisible to the
                        // live guardian workflow.
                        DB::table('account_relationships')
                            ->where('tenant_id', $a->tenant_id)
                            ->where('parent_user_id', $a->guardian_user_id)
                            ->where('child_user_id', $a->ward_user_id)
                            ->update([
                                'proposed_by_user_id' => $a->assigned_by,
                                'staff_notes' => $a->notes !== null ? mb_substr((string) $a->notes, 0, 500) : null,
                                'updated_at' => now(),
                            ]);
                        $skipped++;
                        continue;
                    }

                    $status = 'pending';
                    if ($a->revoked_at !== null) {
                        $status = 'revoked';
                    } elseif ($a->consent_given_at !== null
                        && $a->consent_withdrawn_at === null
                        && $a->consent_declined_at === null) {
                        $status = 'active';
                    }

                    DB::table('account_relationships')->insert([
                        'tenant_id'           => $a->tenant_id,
                        'parent_user_id'      => $a->guardian_user_id,
                        'child_user_id'       => $a->ward_user_id,
                        'relationship_type'   => 'guardian',
                        'permissions'         => $tierZero,
                        'status'              => $status,
                        'proposed_by_user_id' => $a->assigned_by,
                        'staff_notes'         => $a->notes !== null ? mb_substr((string) $a->notes, 0, 500) : null,
                        'approved_at'         => $status === 'active' ? $a->consent_given_at : null,
                        'declined_at'         => $a->consent_declined_at,
                        'withdrawn_at'        => $a->consent_withdrawn_at,
                        'response_reason'     => $a->ward_response_reason !== null
                            ? mb_substr((string) $a->ward_response_reason, 0, 500)
                            : null,
                        'created_at'          => $a->assigned_at ?? now(),
                        'updated_at'          => now(),
                    ]);
                    $migrated++;
                }
            });

        Log::info('Guardian arrangement migration complete', [
            'migrated' => $migrated,
            'reconciled_pair_conflicts' => $skipped,
        ]);
    }

    public function down(): void
    {
        // Intentionally non-destructive. Deleting by row shape can erase a
        // relationship subsequently approved or edited by its member.
    }
};
