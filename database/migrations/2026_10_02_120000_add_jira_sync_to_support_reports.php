<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Support reports can now be raised as different kinds of request (a fault, a
 * question, an account problem, a suggestion) and are copied to the Jira
 * Service Management help desk. These columns record the kind of request and
 * the outcome of that copy. Every column is nullable and appended, so the
 * change is metadata-only on MariaDB.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('support_reports')) {
            return;
        }

        Schema::table('support_reports', function (Blueprint $table) {
            if (!Schema::hasColumn('support_reports', 'request_type')) {
                $table->string('request_type', 24)->nullable();
            }
            if (!Schema::hasColumn('support_reports', 'jira_issue_key')) {
                $table->string('jira_issue_key', 32)->nullable();
            }
            if (!Schema::hasColumn('support_reports', 'jira_synced_at')) {
                $table->timestamp('jira_synced_at')->nullable();
            }
            if (!Schema::hasColumn('support_reports', 'jira_last_error')) {
                $table->string('jira_last_error', 500)->nullable();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('support_reports')) {
            return;
        }

        Schema::table('support_reports', function (Blueprint $table) {
            foreach (['jira_last_error', 'jira_synced_at', 'jira_issue_key', 'request_type'] as $column) {
                if (Schema::hasColumn('support_reports', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
