<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Screenshots a member attaches to a "Help & support" report (HELP-11,
 * 3 Oct 2026). The image itself lives on the private `local` disk, never under
 * the public uploads folder: a screenshot can show anything that was on the
 * member's screen. `jira_attached_at` records that the copy on the Jira ticket
 * was made, so a retried sync never attaches it twice. A new table, so the
 * migration takes no lock on anything live.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('support_report_attachments')) {
            return;
        }

        Schema::create('support_report_attachments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->foreignId('support_report_id')->constrained('support_reports')->cascadeOnDelete();
            $table->string('path', 255);
            $table->string('mime', 32);
            $table->unsignedInteger('size_bytes');
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->string('original_name', 255)->nullable();
            $table->timestamp('jira_attached_at')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'support_report_id'], 'idx_support_report_attachments_report');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('support_report_attachments');
    }
};
