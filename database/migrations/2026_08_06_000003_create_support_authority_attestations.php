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
 * Legal-basis attestation for support relationships (guardian redesign,
 * phase 6) — a clone of the member_vetting_attestations pattern, which
 * docs/SAFEGUARDING-AND-CONSENT.md holds up as the model for staff decisions.
 *
 * When a supporter holds act-alone (represent) power, staff can attest that
 * they have SIGHTED the formal authority behind it — a decision-making
 * representative order, a power of attorney, or a registered ADMCA 2015
 * arrangement. Design rules copied from the vetting surface:
 *
 * - EVIDENCE IS REFUSED. No document uploads, no order/reference numbers, no
 *   dates. The platform records that staff attest to having seen the
 *   authority; it must not become a store of capacity orders. The controller
 *   maintains the prohibited-fields list.
 * - Free-text scope summary and private notes are stored ENCRYPTED.
 * - Revocation uses a CLOSED reason vocabulary, never free text.
 * - Every transition lands in an events table with decision_before /
 *   decision_after, actor and policy version — append-only, enforced by
 *   BEFORE UPDATE / BEFORE DELETE triggers raising SQLSTATE 45000.
 *
 * One row per (tenant, relationship, authority_type); re-attesting after a
 * revocation transitions the same row back to 'active', with the history in
 * the events table — exactly how vetting decisions behave.
 *
 * FK type note: account_relationships.id and users.id are signed int(11).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('support_authority_attestations')) {
            Schema::create('support_authority_attestations', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('tenant_id')->index();
                $table->integer('relationship_id')
                    ->comment('The account_relationships row this authority claim is about');
                $table->integer('supported_user_id')
                    ->comment('Denormalised for member-history queries, like vetting user_id');
                $table->string('authority_type', 40)
                    ->comment('dmr_court_order | power_of_attorney | edm_assistant_agreement | co_decision_agreement');
                $table->boolean('acknowledged_sighted')->default(false)
                    ->comment('Staff explicitly acknowledged they sighted the authority; never inferred');
                $table->text('scope_summary_encrypted')->nullable()
                    ->comment('What the authority covers, in staff words - encrypted at rest');
                $table->text('private_notes_encrypted')->nullable();
                $table->string('decision', 20)->default('active')
                    ->comment('active | revoked');
                $table->integer('attested_by')->nullable()
                    ->comment('Staff member who attested; NULL only after account deletion');
                $table->dateTime('attested_at')->nullable();
                $table->integer('revoked_by')->nullable();
                $table->dateTime('revoked_at')->nullable();
                $table->string('revocation_reason_code', 64)->nullable()
                    ->comment('Closed vocabulary - see SupportAuthorityAttestationService::REVOCATION_REASON_CODES');
                $table->string('policy_version', 64)->default('1');
                $table->timestamps();

                $table->unique(['tenant_id', 'relationship_id', 'authority_type'], 'uq_support_authority_scope');
                $table->index(['tenant_id', 'supported_user_id', 'decision'], 'idx_support_authority_member');

                $table->foreign('relationship_id', 'fk_saa_relationship')
                    ->references('id')->on('account_relationships')->cascadeOnDelete();
                $table->foreign('supported_user_id', 'fk_saa_supported_user')
                    ->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('attested_by', 'fk_saa_attested_by')
                    ->references('id')->on('users')->nullOnDelete();
                $table->foreign('revoked_by', 'fk_saa_revoked_by')
                    ->references('id')->on('users')->nullOnDelete();
            });

            DB::statement(
                "ALTER TABLE `support_authority_attestations`
                 ADD CONSTRAINT `chk_saa_authority_type`
                 CHECK (`authority_type` IN ('dmr_court_order','power_of_attorney','edm_assistant_agreement','co_decision_agreement'))"
            );
            DB::statement(
                "ALTER TABLE `support_authority_attestations`
                 ADD CONSTRAINT `chk_saa_decision`
                 CHECK (`decision` IN ('active','revoked'))"
            );
        }

        if (! Schema::hasTable('support_authority_attestation_events')) {
            Schema::create('support_authority_attestation_events', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('tenant_id');
                $table->unsignedBigInteger('attestation_id');
                $table->integer('relationship_id');
                $table->integer('supported_user_id');
                $table->string('event_type', 32);
                $table->string('decision_before', 20)->nullable();
                $table->string('decision_after', 20);
                $table->string('reason_code', 64)->nullable();
                $table->integer('actor_user_id')->nullable();
                $table->string('policy_version', 64);
                $table->timestamp('created_at')->useCurrent();

                $table->index(['tenant_id', 'attestation_id', 'id'], 'idx_saa_events_attestation');
                $table->index(['tenant_id', 'supported_user_id', 'created_at'], 'idx_saa_events_member');

                $table->foreign('attestation_id', 'fk_saa_events_attestation')
                    ->references('id')->on('support_authority_attestations')->cascadeOnDelete();
            });

            DB::statement(
                "ALTER TABLE `support_authority_attestation_events`
                 ADD CONSTRAINT `chk_saa_events_type`
                 CHECK (`event_type` IN ('attested','re_attested','revoked'))"
            );

            // Append-only, enforced by the database rather than by convention.
            DB::unprepared(
                "CREATE TRIGGER `trg_saa_events_no_update`
                 BEFORE UPDATE ON `support_authority_attestation_events`
                 FOR EACH ROW SIGNAL SQLSTATE '45000'
                 SET MESSAGE_TEXT = 'support_authority_attestation_events_immutable'"
            );
            DB::unprepared(
                "CREATE TRIGGER `trg_saa_events_no_delete`
                 BEFORE DELETE ON `support_authority_attestation_events`
                 FOR EACH ROW SIGNAL SQLSTATE '45000'
                 SET MESSAGE_TEXT = 'support_authority_attestation_events_immutable'"
            );
        }
    }

    public function down(): void
    {
        // Triggers must go before the table, or the drop is refused.
        DB::unprepared('DROP TRIGGER IF EXISTS `trg_saa_events_no_update`');
        DB::unprepared('DROP TRIGGER IF EXISTS `trg_saa_events_no_delete`');
        Schema::dropIfExists('support_authority_attestation_events');
        Schema::dropIfExists('support_authority_attestations');
    }
};
