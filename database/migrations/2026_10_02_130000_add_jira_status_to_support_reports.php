<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The Jira help desk is the one place a copied support report is answered;
 * the platform mirrors the ticket's status every 15 minutes. These columns
 * hold the last status read from Jira. Nullable and appended (metadata-only).
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('support_reports')) {
            return;
        }

        Schema::table('support_reports', function (Blueprint $table) {
            if (!Schema::hasColumn('support_reports', 'jira_status')) {
                $table->string('jira_status', 100)->nullable();
            }
            if (!Schema::hasColumn('support_reports', 'jira_status_checked_at')) {
                $table->timestamp('jira_status_checked_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('support_reports')) {
            return;
        }

        Schema::table('support_reports', function (Blueprint $table) {
            foreach (['jira_status_checked_at', 'jira_status'] as $column) {
                if (Schema::hasColumn('support_reports', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
