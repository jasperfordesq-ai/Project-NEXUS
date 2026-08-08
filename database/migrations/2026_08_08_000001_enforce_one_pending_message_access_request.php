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
        if (! Schema::hasColumn('support_pending_actions', 'pending_message_relationship_id')) {
            Schema::table('support_pending_actions', function (Blueprint $table): void {
                $table->integer('pending_message_relationship_id')->nullable()->unique('uq_spa_pending_message_relationship');
            });
        }

        $duplicateRelationships = DB::table('support_pending_actions')
            ->select('relationship_id', DB::raw('MIN(id) AS keep_id'))
            ->where('action_type', 'message_access_grant')
            ->where('status', 'pending')
            ->groupBy('relationship_id')
            ->get();

        foreach ($duplicateRelationships as $row) {
            DB::table('support_pending_actions')
                ->where('relationship_id', $row->relationship_id)
                ->where('action_type', 'message_access_grant')
                ->where('status', 'pending')
                ->where('id', '<>', $row->keep_id)
                ->update(['status' => 'cancelled', 'cancelled_at' => now(), 'updated_at' => now()]);

            DB::table('support_pending_actions')
                ->where('id', $row->keep_id)
                ->update(['pending_message_relationship_id' => $row->relationship_id]);
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('support_pending_actions', 'pending_message_relationship_id')) {
            Schema::table('support_pending_actions', function (Blueprint $table): void {
                $table->dropUnique('uq_spa_pending_message_relationship');
                $table->dropColumn('pending_message_relationship_id');
            });
        }
    }
};
