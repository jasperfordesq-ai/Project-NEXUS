using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventOfflineCheckinWorkflowParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "CheckinManifestVersion",
                table: "events",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "event_checkin_credentials",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    RegistrationId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    CredentialVersion = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TokenHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    TokenFingerprint = table.Column<string>(type: "character(16)", fixedLength: true, maxLength: 16, nullable: false),
                    IssueIdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    IssuedByUserId = table.Column<int>(type: "integer", nullable: false),
                    IssuedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SupersededById = table.Column<long>(type: "bigint", nullable: true),
                    RotatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedByUserId = table.Column<int>(type: "integer", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevocationReason = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_checkin_credentials", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_checkin_devices",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    PublicId = table.Column<Guid>(type: "uuid", nullable: false),
                    Label = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    RegisteredByUserId = table.Column<int>(type: "integer", nullable: false),
                    DeviceVersion = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SecretHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    SecretFingerprint = table.Column<string>(type: "character(16)", fixedLength: true, maxLength: 16, nullable: false),
                    RegistrationIdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    LastRotationIdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    RegisteredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RotatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedByUserId = table.Column<int>(type: "integer", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevocationReason = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_checkin_devices", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_offline_sync_batches",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    DeviceId = table.Column<long>(type: "bigint", nullable: false),
                    SubmittedByUserId = table.Column<int>(type: "integer", nullable: false),
                    ClientBatchId = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    PayloadHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ManifestVersion = table.Column<long>(type: "bigint", nullable: false),
                    ItemCount = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AcceptedCount = table.Column<int>(type: "integer", nullable: false),
                    ConflictCount = table.Column<int>(type: "integer", nullable: false),
                    RejectedCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeadLetteredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    TerminalCode = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_offline_sync_batches", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_offline_sync_items",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    BatchId = table.Column<long>(type: "bigint", nullable: false),
                    DeviceId = table.Column<long>(type: "bigint", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    ClientNonce = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    Operation = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ObservedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpectedAttendanceVersion = table.Column<long>(type: "bigint", nullable: false),
                    CredentialFingerprint = table.Column<string>(type: "character(16)", fixedLength: true, maxLength: 16, nullable: false),
                    CredentialHashReference = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CredentialId = table.Column<long>(type: "bigint", nullable: true),
                    RegistrationId = table.Column<long>(type: "bigint", nullable: true),
                    UserId = table.Column<int>(type: "integer", nullable: true),
                    Reason = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_offline_sync_items", x => x.Id);
                    table.ForeignKey(
                        name: "FK_event_offline_sync_items_event_offline_sync_batches_BatchId",
                        column: x => x.BatchId,
                        principalTable: "event_offline_sync_batches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_offline_sync_decisions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    BatchId = table.Column<long>(type: "bigint", nullable: false),
                    ItemId = table.Column<long>(type: "bigint", nullable: false),
                    DecisionVersion = table.Column<int>(type: "integer", nullable: false),
                    Outcome = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    Reason = table.Column<string>(type: "text", nullable: true),
                    AttendanceVersionBefore = table.Column<long>(type: "bigint", nullable: false),
                    AttendanceVersionAfter = table.Column<long>(type: "bigint", nullable: true),
                    AttendanceActivityId = table.Column<long>(type: "bigint", nullable: true),
                    DecidedByUserId = table.Column<int>(type: "integer", nullable: false),
                    ResolutionIdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_offline_sync_decisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_event_offline_sync_decisions_event_offline_sync_items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "event_offline_sync_items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "idx_event_checkin_credential_fingerprint",
                table: "event_checkin_credentials",
                columns: new[] { "TenantId", "EventId", "TokenFingerprint" });

            migrationBuilder.CreateIndex(
                name: "idx_event_checkin_credential_registration",
                table: "event_checkin_credentials",
                columns: new[] { "TenantId", "RegistrationId", "Status" });

            migrationBuilder.CreateIndex(
                name: "uq_event_checkin_credential_idempotency",
                table: "event_checkin_credentials",
                columns: new[] { "TenantId", "IssueIdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_checkin_devices_TenantId_EventId_PublicId",
                table: "event_checkin_devices",
                columns: new[] { "TenantId", "EventId", "PublicId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_checkin_devices_TenantId_RegistrationIdempotencyHash",
                table: "event_checkin_devices",
                columns: new[] { "TenantId", "RegistrationIdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_offline_sync_batches_TenantId_DeviceId_ClientBatchId",
                table: "event_offline_sync_batches",
                columns: new[] { "TenantId", "DeviceId", "ClientBatchId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_offline_sync_decisions_ItemId",
                table: "event_offline_sync_decisions",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_event_offline_sync_decisions_TenantId_ItemId_DecisionVersion",
                table: "event_offline_sync_decisions",
                columns: new[] { "TenantId", "ItemId", "DecisionVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_offline_sync_decisions_TenantId_ResolutionIdempotency~",
                table: "event_offline_sync_decisions",
                columns: new[] { "TenantId", "ResolutionIdempotencyHash" },
                unique: true,
                filter: "\"ResolutionIdempotencyHash\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_event_offline_sync_items_BatchId",
                table: "event_offline_sync_items",
                column: "BatchId");

            migrationBuilder.CreateIndex(
                name: "IX_event_offline_sync_items_TenantId_DeviceId_ClientNonce",
                table: "event_offline_sync_items",
                columns: new[] { "TenantId", "DeviceId", "ClientNonce" },
                unique: true);

            migrationBuilder.Sql("""
                ALTER TABLE event_checkin_credentials
                  ADD CONSTRAINT chk_event_checkin_credential_version CHECK ("CredentialVersion" > 0),
                  ADD CONSTRAINT chk_event_checkin_credential_hash CHECK ("TokenHash" ~ '^[0-9a-f]{64}$' AND "TokenFingerprint" = left("TokenHash", 16)),
                  ADD CONSTRAINT chk_event_checkin_credential_status CHECK ("Status" IN ('active','rotated','revoked','expired')),
                  ADD CONSTRAINT chk_event_checkin_credential_expiry CHECK ("IssuedAt" < "ExpiresAt"),
                  ADD CONSTRAINT chk_event_checkin_credential_revocation CHECK (("Status" = 'revoked') = ("RevokedAt" IS NOT NULL AND "RevokedByUserId" IS NOT NULL AND length(btrim("RevocationReason")) > 0));
                ALTER TABLE event_checkin_devices
                  ADD CONSTRAINT chk_event_checkin_device_version CHECK ("DeviceVersion" > 0),
                  ADD CONSTRAINT chk_event_checkin_device_hash CHECK ("SecretHash" ~ '^[0-9a-f]{64}$' AND "SecretFingerprint" = left("SecretHash", 16)),
                  ADD CONSTRAINT chk_event_checkin_device_status CHECK ("Status" IN ('active','revoked','expired')),
                  ADD CONSTRAINT chk_event_checkin_device_expiry CHECK ("RegisteredAt" < "ExpiresAt"),
                  ADD CONSTRAINT chk_event_checkin_device_revocation CHECK (("Status" = 'revoked') = ("RevokedAt" IS NOT NULL AND "RevokedByUserId" IS NOT NULL AND length(btrim("RevocationReason")) > 0));
                ALTER TABLE event_offline_sync_batches
                  ADD CONSTRAINT chk_event_offline_batch_count CHECK ("ItemCount" BETWEEN 1 AND 500),
                  ADD CONSTRAINT chk_event_offline_batch_status CHECK ("Status" IN ('pending','processing','completed','dead_letter')),
                  ADD CONSTRAINT chk_event_offline_batch_outcomes CHECK ("AcceptedCount" >= 0 AND "ConflictCount" >= 0 AND "RejectedCount" >= 0 AND "AcceptedCount" + "ConflictCount" + "RejectedCount" <= "ItemCount" AND ("Status" <> 'completed' OR ("AcceptedCount" + "ConflictCount" + "RejectedCount" = "ItemCount" AND "CompletedAt" IS NOT NULL)));
                ALTER TABLE event_offline_sync_items
                  ADD CONSTRAINT chk_event_offline_item_position CHECK ("Position" > 0),
                  ADD CONSTRAINT chk_event_offline_item_operation CHECK ("Operation" IN ('check_in','check_out','no_show','undo')),
                  ADD CONSTRAINT chk_event_offline_item_version CHECK ("ExpectedAttendanceVersion" >= 0),
                  ADD CONSTRAINT chk_event_offline_item_hash CHECK ("CredentialHashReference" ~ '^[0-9a-f]{64}$' AND "CredentialFingerprint" = left("CredentialHashReference", 16)),
                  ADD CONSTRAINT chk_event_offline_item_subject CHECK (("CredentialId" IS NULL AND "RegistrationId" IS NULL AND "UserId" IS NULL) OR ("CredentialId" IS NOT NULL AND "RegistrationId" IS NOT NULL AND "UserId" IS NOT NULL));
                ALTER TABLE event_offline_sync_decisions
                  ADD CONSTRAINT chk_event_offline_decision_version CHECK ("DecisionVersion" > 0),
                  ADD CONSTRAINT chk_event_offline_decision_outcome CHECK ("Outcome" IN ('accepted','conflict','rejected')),
                  ADD CONSTRAINT chk_event_offline_decision_attendance CHECK (("Outcome" = 'accepted' AND "AttendanceVersionAfter" IS NOT NULL AND "AttendanceVersionAfter" > "AttendanceVersionBefore" AND "AttendanceActivityId" IS NOT NULL) OR ("Outcome" IN ('conflict','rejected') AND "AttendanceVersionAfter" IS NULL AND "AttendanceActivityId" IS NULL));

                CREATE FUNCTION event_offline_item_immutable() RETURNS trigger AS $guard$
                BEGIN RAISE EXCEPTION 'event_offline_item_immutable'; END;
                $guard$ LANGUAGE plpgsql;
                CREATE TRIGGER trg_event_offline_item_no_update BEFORE UPDATE ON event_offline_sync_items FOR EACH ROW EXECUTE FUNCTION event_offline_item_immutable();
                CREATE TRIGGER trg_event_offline_item_no_delete BEFORE DELETE ON event_offline_sync_items FOR EACH ROW EXECUTE FUNCTION event_offline_item_immutable();

                CREATE FUNCTION event_offline_decision_immutable() RETURNS trigger AS $guard$
                BEGIN RAISE EXCEPTION 'event_offline_decision_immutable'; END;
                $guard$ LANGUAGE plpgsql;
                CREATE TRIGGER trg_event_offline_decision_no_update BEFORE UPDATE ON event_offline_sync_decisions FOR EACH ROW EXECUTE FUNCTION event_offline_decision_immutable();
                CREATE TRIGGER trg_event_offline_decision_no_delete BEFORE DELETE ON event_offline_sync_decisions FOR EACH ROW EXECUTE FUNCTION event_offline_decision_immutable();

                CREATE FUNCTION event_offline_evidence_no_delete() RETURNS trigger AS $guard$
                BEGIN RAISE EXCEPTION 'event_offline_evidence_delete_forbidden'; END;
                $guard$ LANGUAGE plpgsql;
                CREATE TRIGGER trg_event_checkin_credential_no_delete BEFORE DELETE ON event_checkin_credentials FOR EACH ROW EXECUTE FUNCTION event_offline_evidence_no_delete();
                CREATE TRIGGER trg_event_checkin_device_no_delete BEFORE DELETE ON event_checkin_devices FOR EACH ROW EXECUTE FUNCTION event_offline_evidence_no_delete();
                CREATE TRIGGER trg_event_offline_batch_no_delete BEFORE DELETE ON event_offline_sync_batches FOR EACH ROW EXECUTE FUNCTION event_offline_evidence_no_delete();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP FUNCTION IF EXISTS event_offline_item_immutable() CASCADE;
                DROP FUNCTION IF EXISTS event_offline_decision_immutable() CASCADE;
                DROP FUNCTION IF EXISTS event_offline_evidence_no_delete() CASCADE;
                """);
            migrationBuilder.DropTable(
                name: "event_checkin_credentials");

            migrationBuilder.DropTable(
                name: "event_checkin_devices");

            migrationBuilder.DropTable(
                name: "event_offline_sync_decisions");

            migrationBuilder.DropTable(
                name: "event_offline_sync_items");

            migrationBuilder.DropTable(
                name: "event_offline_sync_batches");

            migrationBuilder.DropColumn(
                name: "CheckinManifestVersion",
                table: "events");
        }
    }
}
