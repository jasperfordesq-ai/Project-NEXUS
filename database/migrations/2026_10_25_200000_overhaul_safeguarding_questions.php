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
 * Safeguarding questions overhaul (25 Oct 2026).
 *
 * Schema:
 *  - tenant_safeguarding_options.accepts_new_selections: an option can stop
 *    being offered to members who have not chosen it while it keeps
 *    protecting, and stays visible to, the members who have. Retiring a live
 *    protection any other way is refused by
 *    SafeguardingPreferenceService::mutationWeakensProtection(), correctly.
 *  - safeguarding_member_emails: what each member has been sent about their
 *    safeguarding choices, so a summary is never repeated unchanged and a
 *    one-off notice is never sent twice.
 *
 * Existing communities, brought in line with config/safeguarding_presets.php:
 *  - "only vetted members may contact me" is closed to new selections. It
 *    was worded as a preference but blocks all contact from anyone without
 *    community-recorded vetting.
 *  - the under-18 question is retired: the platform is adults only. It sets
 *    no protection, so its selections are revoked like any retired
 *    informational option (rows kept for the audit trail).
 *  - "I consider myself a vulnerable adult" stops blocking every direct
 *    message, but ONLY where no member currently relies on it; a live
 *    protection is never stripped behind the member's back.
 *  - the new "coordinator introductions" option is added alongside.
 */
return new class extends Migration
{
    private const PROTECTIVE = ['requires_vetted_interaction', 'requires_broker_approval', 'restricts_messaging', 'restricts_matching'];

    public function up(): void
    {
        if (! Schema::hasColumn('tenant_safeguarding_options', 'accepts_new_selections')) {
            Schema::table('tenant_safeguarding_options', function (Blueprint $table) {
                $table->boolean('accepts_new_selections')->default(true)->after('is_required');
            });
        }

        if (! Schema::hasTable('safeguarding_member_emails')) {
            Schema::create('safeguarding_member_emails', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedInteger('tenant_id');
                $table->unsignedInteger('user_id');
                $table->string('kind', 40);
                $table->char('fingerprint', 64)->nullable();
                $table->timestamp('sent_at')->useCurrent();

                $table->index(['tenant_id', 'user_id', 'kind', 'sent_at'], 'idx_sg_member_emails_member_kind');
            });
        }

        $now = now();

        DB::table('tenant_safeguarding_options')
            ->where('option_key', 'requires_vetted_partners')
            ->update(['accepts_new_selections' => 0, 'updated_at' => $now]);

        foreach (DB::table('tenant_safeguarding_options')->where('option_key', 'works_with_children')->where('is_active', 1)->get() as $row) {
            if ($this->isProtective($row->triggers)) {
                continue;
            }
            DB::table('tenant_safeguarding_options')->where('id', $row->id)->update(['is_active' => 0, 'updated_at' => $now]);
            DB::table('user_safeguarding_preferences')
                ->where('tenant_id', $row->tenant_id)
                ->where('option_id', $row->id)
                ->whereNull('revoked_at')
                ->update(['revoked_at' => $now, 'updated_at' => $now]);
        }

        foreach (DB::table('tenant_safeguarding_options')->where('option_key', 'is_vulnerable_adult')->get() as $row) {
            $triggers = $this->decode($row->triggers);
            if (empty($triggers['restricts_messaging'])) {
                continue;
            }
            $held = DB::table('user_safeguarding_preferences')
                ->where('tenant_id', $row->tenant_id)
                ->where('option_id', $row->id)
                ->whereNull('revoked_at')
                ->exists();
            if ($held) {
                continue;
            }
            unset($triggers['restricts_messaging']);
            DB::table('tenant_safeguarding_options')->where('id', $row->id)->update([
                'triggers' => json_encode($triggers),
                'updated_at' => $now,
            ]);
        }

        $vettedRows = DB::table('tenant_safeguarding_options')
            ->where('option_key', 'requires_vetted_partners')
            ->where('is_active', 1)
            ->get(['tenant_id', 'sort_order', 'preset_source']);
        foreach ($vettedRows as $vetted) {
            $exists = DB::table('tenant_safeguarding_options')
                ->where('tenant_id', $vetted->tenant_id)
                ->where('option_key', 'coordinator_introductions')
                ->exists();
            if ($exists) {
                continue;
            }
            DB::table('tenant_safeguarding_options')->insert([
                'tenant_id' => $vetted->tenant_id,
                'option_key' => 'coordinator_introductions',
                'option_type' => 'checkbox',
                'label' => 'safeguarding.presets.common.options.coordinator_introductions.label',
                'description' => 'safeguarding.presets.common.options.coordinator_introductions.description',
                'help_url' => null,
                'sort_order' => (int) $vetted->sort_order + 1,
                'is_active' => 1,
                'is_required' => 0,
                'accepts_new_selections' => 1,
                'select_options' => null,
                'triggers' => json_encode([
                    'requires_broker_approval' => true,
                    'restricts_matching' => true,
                    'notify_admin_on_selection' => true,
                ]),
                'preset_source' => $vetted->preset_source,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        // Data changes are deliberately not reversed: re-opening a contact
        // block nobody can satisfy, or re-adding an under-18 question to an
        // adults-only platform, is not a safe rollback. The schema additions
        // are harmless to keep.
    }

    private function isProtective(mixed $raw): bool
    {
        $triggers = $this->decode($raw);
        foreach (self::PROTECTIVE as $key) {
            if (! empty($triggers[$key])) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, mixed> */
    private function decode(mixed $raw): array
    {
        $decoded = is_string($raw) ? json_decode($raw, true) : (array) $raw;

        return is_array($decoded) ? $decoded : [];
    }
};
