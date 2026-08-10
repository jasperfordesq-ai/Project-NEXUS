using System;
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventRegistrationProductEvidenceHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_event_registration_answer_access_audits_TenantId_Correlatio~",
                table: "event_registration_answer_access_audits");

            migrationBuilder.DropIndex(
                name: "IX_event_invitation_delivery_evidence_TenantId_InvitationId_Ch~",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.AddColumn<int>(
                name: "PartySize",
                table: "event_registrations",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AlterColumn<string>(
                name: "DisplayNameCiphertext",
                table: "event_registration_guests",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<DateTime>(
                name: "ConsentedAt",
                table: "event_registration_guests",
                type: "timestamp with time zone",
                nullable: false);

            migrationBuilder.AddColumn<string>(
                name: "IdentityFingerprint",
                table: "event_registration_guests",
                type: "character(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "NotificationConsentedAt",
                table: "event_registration_guests",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FromStatus",
                table: "event_registration_guest_attendance_history",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false);

            migrationBuilder.AddColumn<string>(
                name: "Metadata",
                table: "event_registration_guest_attendance_history",
                type: "jsonb",
                nullable: false);

            migrationBuilder.AddColumn<long>(
                name: "RegistrationId",
                table: "event_registration_guest_attendance_history",
                type: "bigint",
                nullable: false);

            migrationBuilder.AddColumn<string>(
                name: "ToStatus",
                table: "event_registration_guest_attendance_history",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "AttendedAt",
                table: "event_registration_guest_attendance",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "NoShowAt",
                table: "event_registration_guest_attendance",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "RegistrationId",
                table: "event_registration_guest_attendance",
                type: "bigint",
                nullable: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "StatusChangedAt",
                table: "event_registration_guest_attendance",
                type: "timestamp with time zone",
                nullable: false);

            migrationBuilder.AddColumn<int>(
                name: "StatusChangedBy",
                table: "event_registration_guest_attendance",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DefinitionHash",
                table: "event_registration_form_versions",
                type: "character(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AlterColumn<long>(
                name: "SubmissionId",
                table: "event_registration_answer_access_audits",
                type: "bigint",
                nullable: false,
                oldClrType: typeof(long),
                oldType: "bigint",
                oldNullable: true);

            migrationBuilder.AddColumn<long>(
                name: "AnswerId",
                table: "event_registration_answer_access_audits",
                type: "bigint",
                nullable: false);

            migrationBuilder.AddColumn<long>(
                name: "QuestionId",
                table: "event_registration_answer_access_audits",
                type: "bigint",
                nullable: false);

            migrationBuilder.AddColumn<long>(
                name: "EvidenceVersion",
                table: "event_invitation_delivery_evidence",
                type: "bigint",
                nullable: false);

            migrationBuilder.AddColumn<string>(
                name: "FailureCode",
                table: "event_invitation_delivery_evidence",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "NotificationDeliveryId",
                table: "event_invitation_delivery_evidence",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "OutboxId",
                table: "event_invitation_delivery_evidence",
                type: "bigint",
                nullable: false);

            migrationBuilder.AddColumn<string>(
                name: "PreferenceDecision",
                table: "event_invitation_delivery_evidence",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false);

            migrationBuilder.AddColumn<string>(
                name: "PreferenceReason",
                table: "event_invitation_delivery_evidence",
                type: "character varying(191)",
                maxLength: 191,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProviderEvidenceId",
                table: "event_invitation_delivery_evidence",
                type: "character varying(191)",
                maxLength: 191,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RecipientLocale",
                table: "event_invitation_delivery_evidence",
                type: "character varying(15)",
                maxLength: 15,
                nullable: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "CompletedAt",
                table: "event_invitation_campaigns",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceHash",
                table: "event_invitation_campaigns",
                type: "character(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: false);

            migrationBuilder.AddColumn<int>(
                name: "SourceSchemaVersion",
                table: "event_invitation_campaigns",
                type: "integer",
                nullable: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "StartedAt",
                table: "event_invitation_campaigns",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_guests_TenantId_RegistrationId_IdentityF~",
                table: "event_registration_guests",
                columns: new[] { "TenantId", "RegistrationId", "IdentityFingerprint" },
                unique: true,
                filter: "\"Status\" = 'captured'");

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_answer_access_audits_TenantId_Correlatio~",
                table: "event_registration_answer_access_audits",
                columns: new[] { "TenantId", "CorrelationId", "Action" });

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_answer_access_audits_TenantId_Submission~",
                table: "event_registration_answer_access_audits",
                columns: new[] { "TenantId", "SubmissionId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_event_invitation_delivery_evidence_TenantId_InvitationId_Ch~",
                table: "event_invitation_delivery_evidence",
                columns: new[] { "TenantId", "InvitationId", "Channel", "EvidenceVersion" },
                unique: true);

            migrationBuilder.Sql("""
                CREATE UNIQUE INDEX uq_ev_reg_answer_evidence
                  ON event_registration_form_answers ("TenantId","EventId","SubmissionId","QuestionId","Id");
                CREATE UNIQUE INDEX uq_ev_reg_guest_registration_evidence
                  ON event_registration_guests ("TenantId","EventId","RegistrationId","Id");
                CREATE UNIQUE INDEX uq_ev_reg_guest_attendance_evidence
                  ON event_registration_guest_attendance ("TenantId","EventId","RegistrationId","GuestId","Id");
                CREATE UNIQUE INDEX uq_event_domain_outbox_tenant_event_id
                  ON event_domain_outbox ("TenantId","EventId","Id");

                CREATE INDEX idx_ev_reg_submission_event_page
                  ON event_registration_form_submissions ("TenantId","EventId","CreatedAt","Id");
                CREATE INDEX idx_ev_inv_campaign_event_page
                  ON event_invitation_campaigns ("TenantId","EventId","CreatedAt","Id");
                CREATE INDEX idx_ev_inv_campaign_schedule
                  ON event_invitation_campaigns ("Status","ScheduledForUtc","Id");
                CREATE INDEX idx_ev_reg_guest_event_page
                  ON event_registration_guests ("TenantId","EventId","CreatedAt","Id");
                CREATE INDEX idx_ev_reg_answer_retention
                  ON event_registration_form_answers ("TenantId","EventId","RetentionDueAt","IsPurged","Id");
                CREATE INDEX idx_ev_reg_guest_retention
                  ON event_registration_guests ("TenantId","EventId","RetentionDueAt","Status","Id");

                ALTER TABLE event_registration_form_versions
                  ADD CONSTRAINT fk_ev_reg_form_fork_source
                    FOREIGN KEY ("TenantId","EventId","ForkedFromFormId")
                    REFERENCES event_registration_form_versions ("TenantId","EventId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_answer_access_audits
                  ADD CONSTRAINT fk_ev_reg_access_answer
                    FOREIGN KEY ("TenantId","EventId","SubmissionId","QuestionId","AnswerId")
                    REFERENCES event_registration_form_answers ("TenantId","EventId","SubmissionId","QuestionId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_guest_attendance
                  ADD CONSTRAINT fk_ev_reg_guest_att_registration_guest
                    FOREIGN KEY ("TenantId","EventId","RegistrationId","GuestId")
                    REFERENCES event_registration_guests ("TenantId","EventId","RegistrationId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_guest_att_status_actor
                    FOREIGN KEY ("TenantId","StatusChangedBy") REFERENCES users ("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_guest_attendance_history
                  ADD CONSTRAINT fk_ev_reg_guest_att_hist_identity
                    FOREIGN KEY ("TenantId","EventId","RegistrationId","GuestId","AttendanceId")
                    REFERENCES event_registration_guest_attendance ("TenantId","EventId","RegistrationId","GuestId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_invitation_delivery_evidence
                  ADD CONSTRAINT fk_ev_inv_delivery_outbox
                    FOREIGN KEY ("TenantId","EventId","OutboxId")
                    REFERENCES event_domain_outbox ("TenantId","EventId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registrations
                  ADD CONSTRAINT chk_event_registration_party_size CHECK ("PartySize" BETWEEN 1 AND 21);

                ALTER TABLE event_registration_form_versions
                  ADD CONSTRAINT chk_event_registration_form_definition_hash
                    CHECK (("Status"='draft' AND "DefinitionHash" IS NULL) OR
                           ("Status"='published' AND "DefinitionHash" ~ '^[0-9a-f]{64}$'));

                ALTER TABLE event_registration_answer_access_audits
                  ADD CONSTRAINT chk_event_registration_access_answer
                    CHECK ("SubmissionId">0 AND "QuestionId">0 AND "AnswerId">0 AND "AnswerCount"=1 AND jsonb_typeof("Metadata")='object');

                ALTER TABLE event_invitation_campaigns
                  ADD CONSTRAINT chk_event_invitation_campaign_source
                    CHECK ("SourceHash" ~ '^[0-9a-f]{64}$' AND "SourceSchemaVersion">=1 AND char_length(btrim("DefaultLocale"))>0),
                  ADD CONSTRAINT chk_event_invitation_campaign_delivery_lifecycle
                    CHECK (("Status" IN ('previewed','scheduled','cancelled') AND "StartedAt" IS NULL AND "CompletedAt" IS NULL) OR
                           ("Status"='issued' AND "StartedAt" IS NOT NULL AND "CompletedAt" IS NOT NULL AND "IssuedAt" IS NOT NULL AND "StartedAt"<="CompletedAt"));

                ALTER TABLE event_invitation_delivery_evidence
                  ADD CONSTRAINT chk_event_invitation_delivery_fields
                    CHECK ("OutboxId">0 AND "EvidenceVersion">0 AND
                           "Channel" IN ('email','in_app','web_push','fcm','realtime') AND
                           "PreferenceDecision" IN ('deliver','suppressed') AND
                           "Status" IN ('queued','suppressed','dispatched','delivered','failed','dead_letter') AND
                           char_length(btrim("RecipientLocale"))>0 AND
                           "RecipientHash" ~ '^[0-9a-f]{64}$' AND "IdempotencyHash" ~ '^[0-9a-f]{64}$' AND
                           (("Status"='delivered' AND "DeliveredAt" IS NOT NULL) OR "Status"<>'delivered'));

                ALTER TABLE event_registration_guests
                  ADD CONSTRAINT chk_event_registration_guest_identity_consent
                    CHECK ("IdentityFingerprint" ~ '^[0-9a-f]{64}$' AND "ConsentedAt" IS NOT NULL AND
                           ((NOT "NotificationConsent" AND "NotificationConsentHash" IS NULL AND "NotificationConsentVersion" IS NULL AND "NotificationConsentedAt" IS NULL) OR
                            ("NotificationConsent" AND "EmailCiphertext" IS NOT NULL AND "PreferredLocale" IS NOT NULL AND
                             "NotificationConsentHash" ~ '^[0-9a-f]{64}$' AND char_length(btrim("NotificationConsentVersion"))>0 AND "NotificationConsentedAt" IS NOT NULL))),
                  ADD CONSTRAINT chk_event_registration_guest_anonymised_identity
                    CHECK ("Status"<>'anonymised' OR ("DisplayNameCiphertext" IS NULL AND "EmailCiphertext" IS NULL AND "PhoneCiphertext" IS NULL AND "EmailBlindHash" IS NULL));

                ALTER TABLE event_registration_guest_attendance
                  ADD CONSTRAINT chk_event_registration_guest_att_timestamps
                    CHECK (("Status"='not_checked_in' AND "CheckedInAt" IS NULL AND "CheckedOutAt" IS NULL AND "NoShowAt" IS NULL) OR
                           ("Status"='checked_in' AND "CheckedInAt" IS NOT NULL AND "CheckedOutAt" IS NULL AND "NoShowAt" IS NULL) OR
                           ("Status"='checked_out' AND "CheckedInAt" IS NOT NULL AND "CheckedOutAt" IS NOT NULL AND "NoShowAt" IS NULL) OR
                           ("Status"='no_show' AND "CheckedInAt" IS NULL AND "CheckedOutAt" IS NULL AND "NoShowAt" IS NOT NULL));

                ALTER TABLE event_registration_guest_attendance_history
                  ADD CONSTRAINT chk_event_registration_guest_att_hist_transition
                    CHECK ("FromStatus" IN ('not_checked_in','checked_in','checked_out','no_show') AND
                           "ToStatus" IN ('not_checked_in','checked_in','checked_out','no_show') AND
                           jsonb_typeof("Metadata")='object' AND ("Action"<>'undo' OR char_length(btrim("Reason"))>0));

                CREATE TRIGGER trg_ev_inv_delivery_no_update
                  BEFORE UPDATE ON event_invitation_delivery_evidence FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_inv_delivery_no_delete
                  BEFORE DELETE ON event_invitation_delivery_evidence FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_reg_retention_run_no_update
                  BEFORE UPDATE ON event_registration_retention_runs FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_reg_retention_run_no_delete
                  BEFORE DELETE ON event_registration_retention_runs FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_reg_retention_item_no_update
                  BEFORE UPDATE ON event_registration_retention_items FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_reg_retention_item_no_delete
                  BEFORE DELETE ON event_registration_retention_items FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS trg_ev_reg_retention_item_no_delete ON event_registration_retention_items;
                DROP TRIGGER IF EXISTS trg_ev_reg_retention_item_no_update ON event_registration_retention_items;
                DROP TRIGGER IF EXISTS trg_ev_reg_retention_run_no_delete ON event_registration_retention_runs;
                DROP TRIGGER IF EXISTS trg_ev_reg_retention_run_no_update ON event_registration_retention_runs;
                DROP TRIGGER IF EXISTS trg_ev_inv_delivery_no_delete ON event_invitation_delivery_evidence;
                DROP TRIGGER IF EXISTS trg_ev_inv_delivery_no_update ON event_invitation_delivery_evidence;

                ALTER TABLE event_registration_guest_attendance_history
                  DROP CONSTRAINT IF EXISTS chk_event_registration_guest_att_hist_transition,
                  DROP CONSTRAINT IF EXISTS fk_ev_reg_guest_att_hist_identity;
                ALTER TABLE event_registration_guest_attendance
                  DROP CONSTRAINT IF EXISTS chk_event_registration_guest_att_timestamps,
                  DROP CONSTRAINT IF EXISTS fk_ev_reg_guest_att_status_actor,
                  DROP CONSTRAINT IF EXISTS fk_ev_reg_guest_att_registration_guest;
                ALTER TABLE event_registration_guests
                  DROP CONSTRAINT IF EXISTS chk_event_registration_guest_anonymised_identity,
                  DROP CONSTRAINT IF EXISTS chk_event_registration_guest_identity_consent;
                ALTER TABLE event_invitation_delivery_evidence
                  DROP CONSTRAINT IF EXISTS chk_event_invitation_delivery_fields,
                  DROP CONSTRAINT IF EXISTS fk_ev_inv_delivery_outbox;
                ALTER TABLE event_invitation_campaigns
                  DROP CONSTRAINT IF EXISTS chk_event_invitation_campaign_delivery_lifecycle,
                  DROP CONSTRAINT IF EXISTS chk_event_invitation_campaign_source;
                ALTER TABLE event_registration_answer_access_audits
                  DROP CONSTRAINT IF EXISTS chk_event_registration_access_answer,
                  DROP CONSTRAINT IF EXISTS fk_ev_reg_access_answer;
                ALTER TABLE event_registration_form_versions
                  DROP CONSTRAINT IF EXISTS chk_event_registration_form_definition_hash,
                  DROP CONSTRAINT IF EXISTS fk_ev_reg_form_fork_source;
                ALTER TABLE event_registrations DROP CONSTRAINT IF EXISTS chk_event_registration_party_size;

                DROP INDEX IF EXISTS idx_ev_reg_guest_retention;
                DROP INDEX IF EXISTS idx_ev_reg_answer_retention;
                DROP INDEX IF EXISTS idx_ev_reg_guest_event_page;
                DROP INDEX IF EXISTS idx_ev_inv_campaign_schedule;
                DROP INDEX IF EXISTS idx_ev_inv_campaign_event_page;
                DROP INDEX IF EXISTS idx_ev_reg_submission_event_page;
                DROP INDEX IF EXISTS uq_event_domain_outbox_tenant_event_id;
                DROP INDEX IF EXISTS uq_ev_reg_guest_attendance_evidence;
                DROP INDEX IF EXISTS uq_ev_reg_guest_registration_evidence;
                DROP INDEX IF EXISTS uq_ev_reg_answer_evidence;
                """);

            migrationBuilder.DropIndex(
                name: "IX_event_registration_guests_TenantId_RegistrationId_IdentityF~",
                table: "event_registration_guests");

            migrationBuilder.DropIndex(
                name: "IX_event_registration_answer_access_audits_TenantId_Correlatio~",
                table: "event_registration_answer_access_audits");

            migrationBuilder.DropIndex(
                name: "IX_event_registration_answer_access_audits_TenantId_Submission~",
                table: "event_registration_answer_access_audits");

            migrationBuilder.DropIndex(
                name: "IX_event_invitation_delivery_evidence_TenantId_InvitationId_Ch~",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.DropColumn(
                name: "PartySize",
                table: "event_registrations");

            migrationBuilder.DropColumn(
                name: "ConsentedAt",
                table: "event_registration_guests");

            migrationBuilder.DropColumn(
                name: "IdentityFingerprint",
                table: "event_registration_guests");

            migrationBuilder.DropColumn(
                name: "NotificationConsentedAt",
                table: "event_registration_guests");

            migrationBuilder.DropColumn(
                name: "FromStatus",
                table: "event_registration_guest_attendance_history");

            migrationBuilder.DropColumn(
                name: "Metadata",
                table: "event_registration_guest_attendance_history");

            migrationBuilder.DropColumn(
                name: "RegistrationId",
                table: "event_registration_guest_attendance_history");

            migrationBuilder.DropColumn(
                name: "ToStatus",
                table: "event_registration_guest_attendance_history");

            migrationBuilder.DropColumn(
                name: "AttendedAt",
                table: "event_registration_guest_attendance");

            migrationBuilder.DropColumn(
                name: "NoShowAt",
                table: "event_registration_guest_attendance");

            migrationBuilder.DropColumn(
                name: "RegistrationId",
                table: "event_registration_guest_attendance");

            migrationBuilder.DropColumn(
                name: "StatusChangedAt",
                table: "event_registration_guest_attendance");

            migrationBuilder.DropColumn(
                name: "StatusChangedBy",
                table: "event_registration_guest_attendance");

            migrationBuilder.DropColumn(
                name: "DefinitionHash",
                table: "event_registration_form_versions");

            migrationBuilder.DropColumn(
                name: "AnswerId",
                table: "event_registration_answer_access_audits");

            migrationBuilder.DropColumn(
                name: "QuestionId",
                table: "event_registration_answer_access_audits");

            migrationBuilder.DropColumn(
                name: "EvidenceVersion",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.DropColumn(
                name: "FailureCode",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.DropColumn(
                name: "NotificationDeliveryId",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.DropColumn(
                name: "OutboxId",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.DropColumn(
                name: "PreferenceDecision",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.DropColumn(
                name: "PreferenceReason",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.DropColumn(
                name: "ProviderEvidenceId",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.DropColumn(
                name: "RecipientLocale",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.DropColumn(
                name: "CompletedAt",
                table: "event_invitation_campaigns");

            migrationBuilder.DropColumn(
                name: "SourceHash",
                table: "event_invitation_campaigns");

            migrationBuilder.DropColumn(
                name: "SourceSchemaVersion",
                table: "event_invitation_campaigns");

            migrationBuilder.DropColumn(
                name: "StartedAt",
                table: "event_invitation_campaigns");

            migrationBuilder.AlterColumn<string>(
                name: "DisplayNameCiphertext",
                table: "event_registration_guests",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<long>(
                name: "SubmissionId",
                table: "event_registration_answer_access_audits",
                type: "bigint",
                nullable: true,
                oldClrType: typeof(long),
                oldType: "bigint");

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_answer_access_audits_TenantId_Correlatio~",
                table: "event_registration_answer_access_audits",
                columns: new[] { "TenantId", "CorrelationId", "Action" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_invitation_delivery_evidence_TenantId_InvitationId_Ch~",
                table: "event_invitation_delivery_evidence",
                columns: new[] { "TenantId", "InvitationId", "Channel" },
                unique: true);
        }
    }
}
