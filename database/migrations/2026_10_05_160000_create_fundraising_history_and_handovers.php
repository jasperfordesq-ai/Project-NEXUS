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

/**
 * Fundraising audit trail (owner decision 5 Oct 2026).
 *
 * vol_fundraising_events is append-only: triggers refuse every UPDATE and
 * DELETE, the pattern of the event_guardian_* tables. vol_fundraising_handovers
 * records money a community passes on to an organisation; it can never be
 * deleted, its facts never change, and its confirm/cancel columns can be set
 * once each. A mistake is corrected by cancelling with a reason.
 */
return new class extends Migration
{
    private const EVENTS_NO_UPDATE = 'trg_vol_fundraising_events_no_update';
    private const EVENTS_NO_DELETE = 'trg_vol_fundraising_events_no_delete';
    private const HANDOVERS_NO_DELETE = 'trg_vol_fundraising_handovers_no_delete';
    private const HANDOVERS_GUARD = 'trg_vol_fundraising_handovers_guard';

    public function up(): void
    {
        if (Schema::hasTable('vol_giving_days')) {
            Schema::table('vol_giving_days', function (Blueprint $table): void {
                if (! Schema::hasColumn('vol_giving_days', 'updated_at')) {
                    $table->timestamp('updated_at')->nullable();
                }
                if (! Schema::hasColumn('vol_giving_days', 'updated_by')) {
                    $table->integer('updated_by')->nullable();
                }
            });
        }

        if (! Schema::hasTable('vol_fundraising_events')) {
            Schema::create('vol_fundraising_events', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->unsignedInteger('tenant_id');
                $table->unsignedInteger('giving_day_id')->nullable();
                $table->unsignedInteger('donation_id')->nullable();
                $table->unsignedBigInteger('handover_id')->nullable();
                $table->integer('organization_id')->nullable();
                $table->integer('actor_user_id')->nullable();
                $table->string('actor_kind', 20);
                $table->string('event', 50);
                $table->decimal('amount', 10, 2)->nullable();
                $table->char('currency', 3)->nullable();
                $table->json('details')->nullable();
                $table->string('stripe_object_id', 255)->nullable();
                $table->timestamp('created_at')->useCurrent();
                $table->index(['tenant_id', 'giving_day_id', 'id'], 'idx_vfe_campaign');
                $table->index(['tenant_id', 'donation_id'], 'idx_vfe_donation');
                $table->index(['tenant_id', 'organization_id', 'id'], 'idx_vfe_org');
                $table->index(['tenant_id', 'handover_id'], 'idx_vfe_handover');
            });
        }

        if (! Schema::hasTable('vol_fundraising_handovers')) {
            Schema::create('vol_fundraising_handovers', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->unsignedInteger('tenant_id');
                $table->unsignedInteger('giving_day_id');
                $table->integer('organization_id');
                $table->decimal('amount', 10, 2);
                $table->char('currency', 3);
                $table->date('handed_over_on');
                $table->string('method', 20);
                $table->string('reference', 255);
                $table->text('note')->nullable();
                $table->integer('recorded_by');
                $table->timestamp('created_at')->useCurrent();
                $table->integer('confirmed_by')->nullable();
                $table->timestamp('confirmed_at')->nullable();
                $table->integer('cancelled_by')->nullable();
                $table->timestamp('cancelled_at')->nullable();
                $table->string('cancel_reason', 500)->nullable();
                $table->index(['tenant_id', 'giving_day_id'], 'idx_vfh_campaign');
                $table->index(['tenant_id', 'organization_id'], 'idx_vfh_org');
            });
        }

        $this->installTriggers();
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'mysql') {
            foreach ([self::EVENTS_NO_UPDATE, self::EVENTS_NO_DELETE, self::HANDOVERS_NO_DELETE, self::HANDOVERS_GUARD] as $name) {
                DB::unprepared('DROP TRIGGER IF EXISTS `' . $name . '`');
            }
        }
        Schema::dropIfExists('vol_fundraising_handovers');
        Schema::dropIfExists('vol_fundraising_events');
        if (Schema::hasTable('vol_giving_days')) {
            Schema::table('vol_giving_days', function (Blueprint $table): void {
                foreach (['updated_by', 'updated_at'] as $column) {
                    if (Schema::hasColumn('vol_giving_days', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }
    }

    private function installTriggers(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            return;
        }

        $refuse = static fn (string $message): string =>
            "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '{$message}'";

        $this->createTrigger(self::EVENTS_NO_UPDATE,
            'BEFORE UPDATE ON `vol_fundraising_events` FOR EACH ROW ' . $refuse('vol_fundraising_events_append_only'));
        $this->createTrigger(self::EVENTS_NO_DELETE,
            'BEFORE DELETE ON `vol_fundraising_events` FOR EACH ROW ' . $refuse('vol_fundraising_events_append_only'));
        $this->createTrigger(self::HANDOVERS_NO_DELETE,
            'BEFORE DELETE ON `vol_fundraising_handovers` FOR EACH ROW ' . $refuse('vol_fundraising_handover_immutable'));

        // Facts never change; confirm and cancel columns may each be set once.
        $this->createTrigger(self::HANDOVERS_GUARD,
            'BEFORE UPDATE ON `vol_fundraising_handovers` FOR EACH ROW BEGIN '
            . 'IF NOT (NEW.tenant_id <=> OLD.tenant_id AND NEW.giving_day_id <=> OLD.giving_day_id'
            . ' AND NEW.organization_id <=> OLD.organization_id AND NEW.amount <=> OLD.amount'
            . ' AND NEW.currency <=> OLD.currency AND NEW.handed_over_on <=> OLD.handed_over_on'
            . ' AND NEW.method <=> OLD.method AND NEW.reference <=> OLD.reference AND NEW.note <=> OLD.note'
            . ' AND NEW.recorded_by <=> OLD.recorded_by AND NEW.created_at <=> OLD.created_at)'
            . ' OR (OLD.confirmed_at IS NOT NULL AND NOT (NEW.confirmed_at <=> OLD.confirmed_at AND NEW.confirmed_by <=> OLD.confirmed_by))'
            . ' OR (OLD.cancelled_at IS NOT NULL AND NOT (NEW.cancelled_at <=> OLD.cancelled_at'
            . ' AND NEW.cancelled_by <=> OLD.cancelled_by AND NEW.cancel_reason <=> OLD.cancel_reason))'
            . ' THEN ' . $refuse('vol_fundraising_handover_immutable') . '; END IF; END');
    }

    private function createTrigger(string $name, string $body): void
    {
        $exists = DB::table('information_schema.TRIGGERS')
            ->where('TRIGGER_SCHEMA', DB::getDatabaseName())
            ->where('TRIGGER_NAME', $name)
            ->exists();
        if (! $exists) {
            DB::unprepared("CREATE TRIGGER `{$name}` {$body}");
        }
    }
};
