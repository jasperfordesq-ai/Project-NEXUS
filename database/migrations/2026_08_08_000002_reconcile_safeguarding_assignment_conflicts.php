<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('account_relationships', 'safeguarding_assignment_id')) {
            Schema::table('account_relationships', function (Blueprint $table): void {
                $table->unsignedInteger('safeguarding_assignment_id')->nullable()->index('idx_ar_safeguarding_assignment');
            });
        }

        DB::table('safeguarding_assignments')
            ->orderBy('id')
            ->chunkById(200, function ($assignments): void {
                foreach ($assignments as $assignment) {
                    $relationship = DB::table('account_relationships')
                        ->where('tenant_id', $assignment->tenant_id)
                        ->where('parent_user_id', $assignment->guardian_user_id)
                        ->where('child_user_id', $assignment->ward_user_id)
                        ->first();

                    if (! $relationship) {
                        continue;
                    }

                    // Never increase authority from the archive: retain the
                    // live status and tiers, and restore provenance only.
                    DB::table('account_relationships')
                        ->where('id', $relationship->id)
                        ->update([
                            'safeguarding_assignment_id' => $assignment->id,
                            'proposed_by_user_id' => $relationship->proposed_by_user_id ?? $assignment->assigned_by,
                            'staff_notes' => $relationship->staff_notes
                                ?? ($assignment->notes !== null ? mb_substr((string) $assignment->notes, 0, 500) : null),
                            'updated_at' => now(),
                        ]);
                }
            });
    }

    public function down(): void
    {
        // Intentionally retain the provenance. Dropping it would make repaired
        // safeguarding arrangements invisible again.
    }
};
