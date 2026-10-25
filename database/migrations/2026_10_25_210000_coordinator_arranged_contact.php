<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Coordinator-arranged contact (owner decision, 25 Oct 2026).
 *
 * Schema: safeguarding_approved_contacts — a coordinator's approval for one
 * member to contact one protected member (see SafeguardingApprovedContactService).
 *
 * Existing communities, brought in line with config/safeguarding_presets.php:
 *  - "I consider myself a vulnerable adult" routes all direct contact through
 *    a coordinator again (`restricts_messaging`). This only ADDS a protection;
 *    the earlier migration had removed it where nobody held the option.
 *  - New members are asked only the essentials (owner, 25 Oct 2026): "I
 *    consider myself a vulnerable adult", "I plan to offer help involving
 *    children or vulnerable adults" and "none of these apply". "Coordinator
 *    arranges all contact" (the vulnerable-adult question now does the same),
 *    "coordinator introductions" and "no home visits" are no longer offered to
 *    new members. Holders keep them.
 *  - Irish communities: "only vetted members" is retired where nobody holds it
 *    (Garda Vetting is per organisation and role and cannot follow a member).
 *    Where members hold it, it stays — closed — until they change it.
 *  - Preset questions are re-ordered: vulnerable adult first, "none of these
 *    apply" last. Only rows that still carry platform wording are moved, so a
 *    community's own questions keep their place.
 */
return new class extends Migration
{
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
        if (! Schema::hasTable('safeguarding_approved_contacts')) {
            Schema::create('safeguarding_approved_contacts', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedInteger('tenant_id');
                $table->unsignedInteger('protected_user_id');
                $table->unsignedInteger('contact_user_id');
                $table->unsignedInteger('approved_by')->nullable();
                $table->timestamp('approved_at')->useCurrent();
                $table->unsignedInteger('revoked_by')->nullable();
                $table->timestamp('revoked_at')->nullable();

                $table->index(['tenant_id', 'protected_user_id', 'contact_user_id', 'revoked_at'], 'idx_sg_approved_contacts_pair');
            });
        }

        $now = now();

        foreach (DB::table('tenant_safeguarding_options')->where('option_key', 'is_vulnerable_adult')->get(['id', 'triggers']) as $row) {
            $triggers = $this->decode($row->triggers);
            if (! empty($triggers['restricts_messaging'])) {
                continue;
            }
            $triggers['restricts_messaging'] = true;
            DB::table('tenant_safeguarding_options')->where('id', $row->id)->update([
                'triggers' => json_encode($triggers),
                'updated_at' => $now,
            ]);
        }

        DB::table('tenant_safeguarding_options')
            ->whereIn('option_key', ['requires_coordinator_contact', 'coordinator_introductions', 'no_home_visits'])
            ->update(['accepts_new_selections' => 0, 'updated_at' => $now]);

        $irishTenantIds = DB::table('tenant_safeguarding_settings')->where('jurisdiction', 'ireland')->pluck('tenant_id')->all();
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
        // migration of the same day). The new table is harmless to keep.
    }

    /** @return array<string, mixed> */
    private function decode(mixed $raw): array
    {
        $decoded = is_string($raw) ? json_decode($raw, true) : (array) $raw;

        return is_array($decoded) ? $decoded : [];
    }
};
