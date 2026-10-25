<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Vulnerable adults are protected by the community's vetting system (owner
 * decisions, 25 Oct 2026).
 *
 *  - "I consider myself a vulnerable adult" is the one question new members
 *    are asked (with "none of these apply"). It now requires vetted contact:
 *    coordinators of the community, and members whose vetting (Garda Vetting
 *    in Ireland; Enhanced DBS / PVG / AccessNI in the UK) the community has
 *    recorded, can contact the member; nobody else. The vetting code is the
 *    one for the community's jurisdiction.
 *    Where a member already holds the option it KEEPS its coordinator-only
 *    contact block as well (the stricter combination), so nobody who chose it
 *    becomes reachable by more people without having chosen that.
 *  - Every other question is no longer offered to new members — including
 *    "only vetted members", which the vulnerable-adult question now covers,
 *    and "I plan to offer help involving children or vulnerable adults",
 *    retired for now. Members who hold any of them keep them.
 *  - Irish communities: "only vetted members" is retired where nobody holds it.
 *  - Platform questions are re-ordered: vulnerable adult first, "none of these
 *    apply" last. Rows a community wrote itself keep their place.
 *
 * This migration was first written (same day, never deployed) with a
 * coordinator-approved-contacts table; that design was withdrawn because an
 * approval could have let an unvetted member contact a vulnerable adult.
 */
return new class extends Migration
{
    private const VETTING_BY_PRESET = [
        'ireland' => 'garda_vetting',
        'united_kingdom' => 'uk_safeguarding_clearance',
        'england_wales' => 'dbs_enhanced',
        'scotland' => 'pvg_scotland',
        'northern_ireland' => 'access_ni',
    ];

    private const ORDER = [
        'is_vulnerable_adult' => 10,
        'works_with_vulnerable_adults' => 20,
        'coordinator_introductions' => 30,
        'no_home_visits' => 40,
        'requires_coordinator_contact' => 50,
        'requires_vetted_partners' => 60,
        'none_apply' => 1000,
    ];

    public function up(): void
    {
        if (! Schema::hasTable('tenant_safeguarding_options')) {
            return;
        }

        $now = now();
        $jurisdictions = DB::table('tenant_safeguarding_settings')->pluck('jurisdiction', 'tenant_id')->all();

        foreach (DB::table('tenant_safeguarding_options')->where('option_key', 'is_vulnerable_adult')->get(['id', 'tenant_id', 'triggers', 'preset_source']) as $row) {
            $code = self::VETTING_BY_PRESET[$jurisdictions[$row->tenant_id] ?? ''] ?? self::VETTING_BY_PRESET[$row->preset_source ?? ''] ?? null;
            if ($code === null) {
                continue;
            }

            $held = DB::table('user_safeguarding_preferences')
                ->where('tenant_id', $row->tenant_id)
                ->where('option_id', $row->id)
                ->whereNull('revoked_at')
                ->exists();

            $triggers = $this->decode($row->triggers);
            $triggers['requires_broker_approval'] = true;
            $triggers['restricts_matching'] = true;
            $triggers['notify_admin_on_selection'] = true;
            $triggers['requires_vetted_interaction'] = true;
            $triggers['vetting_type_required'] = $code;
            if ($held) {
                $triggers['restricts_messaging'] = true;
            } else {
                unset($triggers['restricts_messaging']);
            }

            DB::table('tenant_safeguarding_options')->where('id', $row->id)->update([
                'triggers' => json_encode($triggers),
                'updated_at' => $now,
            ]);
        }

        DB::table('tenant_safeguarding_options')
            ->whereNotIn('option_key', ['is_vulnerable_adult', 'none_apply'])
            ->where('label', 'like', 'safeguarding.presets.%')
            ->update(['accepts_new_selections' => 0, 'updated_at' => $now]);

        $irishTenantIds = array_keys(array_filter($jurisdictions, static fn ($j): bool => $j === 'ireland'));
        $irishVetted = DB::table('tenant_safeguarding_options')
            ->where('option_key', 'requires_vetted_partners')
            ->where('is_active', 1)
            ->where(function ($q) use ($irishTenantIds): void {
                $q->where('preset_source', 'ireland')->orWhereIn('tenant_id', $irishTenantIds);
            })
            ->get(['id', 'tenant_id']);
        foreach ($irishVetted as $row) {
            $held = DB::table('user_safeguarding_preferences')
                ->where('tenant_id', $row->tenant_id)
                ->where('option_id', $row->id)
                ->whereNull('revoked_at')
                ->exists();
            if (! $held) {
                DB::table('tenant_safeguarding_options')->where('id', $row->id)->update(['is_active' => 0, 'updated_at' => $now]);
            }
        }

        foreach (self::ORDER as $key => $sortOrder) {
            DB::table('tenant_safeguarding_options')
                ->where('option_key', $key)
                ->where('label', 'like', 'safeguarding.presets.%')
                ->update(['sort_order' => $sortOrder]);
        }
    }

    public function down(): void
    {
        // Data changes are deliberately not reversed (see the overhaul
        // migration of the same day).
    }

    /** @return array<string, mixed> */
    private function decode(mixed $raw): array
    {
        $decoded = is_string($raw) ? json_decode($raw, true) : (array) $raw;

        return is_array($decoded) ? $decoded : [];
    }
};
