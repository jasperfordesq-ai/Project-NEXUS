<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The hand-over guard from 2026_10_05_160000 stopped facts and already-set
 * confirm/cancel columns from changing, but still let a cancelled hand-over
 * be confirmed directly in SQL, and let "who" be set without "when". The
 * service never does either; this makes "database-enforced" true as well:
 * a hand-over is confirmed or cancelled, never both, each needs who and when,
 * and a cancellation needs its reason.
 */
return new class extends Migration
{
    private const GUARD = 'trg_vol_fundraising_handovers_guard';

    public function up(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            return;
        }
        DB::unprepared('DROP TRIGGER IF EXISTS `' . self::GUARD . '`');
        DB::unprepared($this->guard(true));
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            return;
        }
        DB::unprepared('DROP TRIGGER IF EXISTS `' . self::GUARD . '`');
        DB::unprepared($this->guard(false));
    }

    private function guard(bool $strict): string
    {
        $refuse = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vol_fundraising_handover_immutable'";
        $strictClauses = $strict
            ? ' OR (NEW.confirmed_at IS NOT NULL AND NEW.cancelled_at IS NOT NULL)'
              . ' OR ((NEW.confirmed_at IS NULL) <> (NEW.confirmed_by IS NULL))'
              . ' OR ((NEW.cancelled_at IS NULL) <> (NEW.cancelled_by IS NULL))'
              . " OR (NEW.cancelled_at IS NOT NULL AND (NEW.cancel_reason IS NULL OR TRIM(NEW.cancel_reason) = ''))"
            : '';

        return 'CREATE TRIGGER `' . self::GUARD . '` BEFORE UPDATE ON `vol_fundraising_handovers` FOR EACH ROW BEGIN '
            . 'IF NOT (NEW.tenant_id <=> OLD.tenant_id AND NEW.giving_day_id <=> OLD.giving_day_id'
            . ' AND NEW.organization_id <=> OLD.organization_id AND NEW.amount <=> OLD.amount'
            . ' AND NEW.currency <=> OLD.currency AND NEW.handed_over_on <=> OLD.handed_over_on'
            . ' AND NEW.method <=> OLD.method AND NEW.reference <=> OLD.reference AND NEW.note <=> OLD.note'
            . ' AND NEW.recorded_by <=> OLD.recorded_by AND NEW.created_at <=> OLD.created_at)'
            . ' OR (OLD.confirmed_at IS NOT NULL AND NOT (NEW.confirmed_at <=> OLD.confirmed_at AND NEW.confirmed_by <=> OLD.confirmed_by))'
            . ' OR (OLD.cancelled_at IS NOT NULL AND NOT (NEW.cancelled_at <=> OLD.cancelled_at'
            . ' AND NEW.cancelled_by <=> OLD.cancelled_by AND NEW.cancel_reason <=> OLD.cancel_reason))'
            . $strictClauses
            . ' THEN ' . $refuse . '; END IF; END';
    }
};
