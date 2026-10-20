<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who was told that a volunteer said they are Low or Struggling, by which
 * channel, and whether it worked. One row per person (or address) per channel.
 *
 * Until 20 Oct 2026 nothing recorded this: a check-in that reached nobody
 * looked identical to one that reached the whole team, and the volunteer was
 * told "someone will be in touch" either way. The owner, the only staff
 * account on their community, concluded the feature was cosmetic.
 *
 * Deliberately never carries the mood or the note: staff read those on the
 * alert after signing in. Tier, channel and status are plain strings so a new
 * value never needs an ALTER on a live table.
 *
 * New table only: no ALTER, so the blue/green migration safety gate passes.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('vol_wellbeing_alert_notifications')) {
            return;
        }

        Schema::create('vol_wellbeing_alert_notifications', function (Blueprint $t): void {
            $t->bigIncrements('id');
            $t->unsignedInteger('tenant_id')->comment('The volunteer\'s community');
            $t->unsignedInteger('alert_id')->nullable()->comment('vol_wellbeing_alerts.id active at the time');
            $t->unsignedInteger('checkin_id')->comment('vol_mood_checkins.id that triggered it');
            $t->unsignedInteger('volunteer_user_id');
            $t->unsignedInteger('recipient_user_id')->nullable();
            $t->unsignedInteger('recipient_tenant_id')->nullable()->comment('Set when the recipient belongs to another community (the parent)');
            $t->string('recipient_email', 255)->nullable()->comment('Only for address-only recipients');
            $t->unsignedInteger('organization_id')->nullable();
            $t->string('organization_name', 255)->nullable();
            $t->string('tier', 32)->comment('contact|contact_email|staff|self|organisation|parent_staff|community_contact_email');
            $t->string('channel', 8)->comment('bell|email');
            $t->string('status', 16)->default('queued')->comment('queued|sent|failed');
            $t->string('error_code', 64)->nullable();
            $t->dateTime('created_at');
            $t->dateTime('updated_at')->nullable();

            $t->index(['tenant_id', 'alert_id'], 'idx_vwan_alert');
            $t->index(['tenant_id', 'volunteer_user_id', 'created_at'], 'idx_vwan_volunteer');
            $t->index(['tenant_id', 'checkin_id'], 'idx_vwan_checkin');
            $t->index(['recipient_user_id'], 'idx_vwan_recipient');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vol_wellbeing_alert_notifications');
    }
};
