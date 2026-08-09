using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventBroadcastWorkflowParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_attendance",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    AttendanceStatus = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_attendance", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_broadcast_deliveries",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    BroadcastId = table.Column<long>(type: "bigint", nullable: false),
                    FrozenBroadcastVersion = table.Column<int>(type: "integer", nullable: false),
                    RecipientUserId = table.Column<int>(type: "integer", nullable: false),
                    Channel = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    DeliveryKey = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    AvailableAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClaimToken = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    ClaimedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeliveredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SuppressedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeadLetteredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PreferenceReason = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    SuppressionReason = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Provider = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    ProviderEvidenceId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    LastErrorCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_broadcast_deliveries", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_broadcast_delivery_attempts",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    BroadcastId = table.Column<long>(type: "bigint", nullable: false),
                    DeliveryId = table.Column<long>(type: "bigint", nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    Outcome = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Provider = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    ProviderEvidenceId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    ReasonCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_broadcast_delivery_attempts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_broadcast_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    BroadcastId = table.Column<long>(type: "bigint", nullable: false),
                    BroadcastVersion = table.Column<int>(type: "integer", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    FromStatus = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    ToStatus = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: true),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ContentHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_broadcast_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_broadcasts",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    Variant = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    BroadcastVersion = table.Column<int>(type: "integer", nullable: false),
                    AudienceSegments = table.Column<string>(type: "jsonb", nullable: false),
                    Channels = table.Column<string>(type: "jsonb", nullable: false),
                    Body = table.Column<string>(type: "text", nullable: false),
                    ContentHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ScheduledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RecipientCount = table.Column<int>(type: "integer", nullable: false),
                    DeliveryCount = table.Column<int>(type: "integer", nullable: false),
                    DeliveredCount = table.Column<int>(type: "integer", nullable: false),
                    SuppressedCount = table.Column<int>(type: "integer", nullable: false),
                    DeadLetterCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    UpdatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    ScheduledByUserId = table.Column<int>(type: "integer", nullable: true),
                    CancelledByUserId = table.Column<int>(type: "integer", nullable: true),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    FailedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_broadcasts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registrations",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    RegistrationState = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registrations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_waitlist_entries",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    QueueState = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    OfferExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_waitlist_entries", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "idx_event_attendance_audience",
                table: "event_attendance",
                columns: new[] { "TenantId", "EventId", "AttendanceStatus", "UserId" });

            migrationBuilder.CreateIndex(
                name: "uq_event_attendance_user",
                table: "event_attendance",
                columns: new[] { "TenantId", "EventId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_broadcast_delivery_claim",
                table: "event_broadcast_deliveries",
                columns: new[] { "Status", "AvailableAt", "NextAttemptAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_broadcast_delivery_status",
                table: "event_broadcast_deliveries",
                columns: new[] { "TenantId", "BroadcastId", "Status", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_broadcast_delivery_key",
                table: "event_broadcast_deliveries",
                columns: new[] { "TenantId", "DeliveryKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_broadcast_delivery_scope",
                table: "event_broadcast_deliveries",
                columns: new[] { "TenantId", "EventId", "BroadcastId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_broadcast_recipient_channel",
                table: "event_broadcast_deliveries",
                columns: new[] { "BroadcastId", "RecipientUserId", "Channel" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_broadcast_attempt_parent",
                table: "event_broadcast_delivery_attempts",
                columns: new[] { "TenantId", "BroadcastId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_broadcast_attempt_outcome",
                table: "event_broadcast_delivery_attempts",
                columns: new[] { "TenantId", "DeliveryId", "AttemptNumber", "Outcome" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_broadcast_history_event",
                table: "event_broadcast_history",
                columns: new[] { "TenantId", "EventId", "BroadcastId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_broadcast_history_key",
                table: "event_broadcast_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_broadcast_history_version",
                table: "event_broadcast_history",
                columns: new[] { "TenantId", "BroadcastId", "BroadcastVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_broadcast_event_status",
                table: "event_broadcasts",
                columns: new[] { "TenantId", "EventId", "Status", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_broadcast_schedule",
                table: "event_broadcasts",
                columns: new[] { "Status", "ScheduledAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_broadcast_scope_id",
                table: "event_broadcasts",
                columns: new[] { "TenantId", "EventId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_registration_audience",
                table: "event_registrations",
                columns: new[] { "TenantId", "EventId", "RegistrationState", "UserId" });

            migrationBuilder.CreateIndex(
                name: "uq_event_registration_user",
                table: "event_registrations",
                columns: new[] { "TenantId", "EventId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_waitlist_audience",
                table: "event_waitlist_entries",
                columns: new[] { "TenantId", "EventId", "QueueState", "OfferExpiresAt", "UserId" });

            migrationBuilder.CreateIndex(
                name: "uq_event_waitlist_user",
                table: "event_waitlist_entries",
                columns: new[] { "TenantId", "EventId", "UserId" },
                unique: true);

            migrationBuilder.Sql("""
                ALTER TABLE event_registrations ADD CONSTRAINT chk_event_registration_state CHECK ("RegistrationState" IN ('pending','confirmed','cancelled','refunded'));
                ALTER TABLE event_waitlist_entries ADD CONSTRAINT chk_event_waitlist_state CHECK ("QueueState" IN ('waiting','offered','accepted','expired','removed'));
                ALTER TABLE event_attendance ADD CONSTRAINT chk_event_attendance_status CHECK ("AttendanceStatus" IN ('registered','checked_in','checked_out','attended','no_show','cancelled'));
                ALTER TABLE event_broadcasts ADD CONSTRAINT chk_event_broadcast_status CHECK ("Status" IN ('draft','scheduled','sending','sent','cancelled','failed'));
                ALTER TABLE event_broadcasts ADD CONSTRAINT chk_event_broadcast_variant CHECK ("Variant" IN ('announcement','follow_up','review_request'));
                ALTER TABLE event_broadcast_history ADD CONSTRAINT chk_event_broadcast_history_action CHECK ("Action" IN ('created','revised','scheduled','sending','sent','cancelled','failed','retried'));
                ALTER TABLE event_broadcast_deliveries ADD CONSTRAINT chk_event_broadcast_delivery_channel CHECK ("Channel" IN ('email','in_app','push'));
                ALTER TABLE event_broadcast_deliveries ADD CONSTRAINT chk_event_broadcast_delivery_status CHECK ("Status" IN ('pending','processing','retry','delivered','suppressed','dead_letter','cancelled'));
                ALTER TABLE event_broadcast_delivery_attempts ADD CONSTRAINT chk_event_broadcast_attempt_outcome CHECK ("Outcome" IN ('processing','delivered','suppressed','retry','dead_letter','cancelled'));

                CREATE OR REPLACE FUNCTION event_broadcast_evidence_guard() RETURNS trigger AS $guard$
                BEGIN
                    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'event_broadcast_evidence_immutable'; END IF;
                    IF TG_ARGV[0] IN ('history','attempt') THEN RAISE EXCEPTION 'event_broadcast_evidence_immutable'; END IF;
                    IF TG_ARGV[0] = 'broadcast' THEN
                        IF OLD."Id" <> NEW."Id" OR OLD."TenantId" <> NEW."TenantId" OR OLD."EventId" <> NEW."EventId" OR OLD."CreatedByUserId" <> NEW."CreatedByUserId" OR OLD."CreatedAt" <> NEW."CreatedAt" THEN RAISE EXCEPTION 'event_broadcast_identity_immutable'; END IF;
                        IF OLD."Status" IN ('sent','cancelled') THEN RAISE EXCEPTION 'event_broadcast_terminal_immutable'; END IF;
                        IF OLD."Status" <> 'draft' AND (OLD."Variant", OLD."AudienceSegments", OLD."Channels", OLD."Body", OLD."ContentHash") IS DISTINCT FROM (NEW."Variant", NEW."AudienceSegments", NEW."Channels", NEW."Body", NEW."ContentHash") THEN RAISE EXCEPTION 'event_broadcast_content_frozen'; END IF;
                        IF NOT (OLD."Status" = NEW."Status" OR (OLD."Status" = 'draft' AND NEW."Status" IN ('scheduled','cancelled')) OR (OLD."Status" = 'scheduled' AND NEW."Status" IN ('sending','cancelled')) OR (OLD."Status" = 'sending' AND NEW."Status" IN ('sent','failed')) OR (OLD."Status" = 'failed' AND NEW."Status" = 'scheduled')) THEN RAISE EXCEPTION 'event_broadcast_transition_invalid'; END IF;
                        IF NEW."BroadcastVersion" < OLD."BroadcastVersion" OR NEW."BroadcastVersion" > OLD."BroadcastVersion" + 1 THEN RAISE EXCEPTION 'event_broadcast_version_invalid'; END IF;
                        IF (OLD."Status", OLD."Variant", OLD."AudienceSegments", OLD."Channels", OLD."Body", OLD."ContentHash") IS DISTINCT FROM (NEW."Status", NEW."Variant", NEW."AudienceSegments", NEW."Channels", NEW."Body", NEW."ContentHash") AND NEW."BroadcastVersion" <> OLD."BroadcastVersion" + 1 THEN RAISE EXCEPTION 'event_broadcast_version_required'; END IF;
                    END IF;
                    IF TG_ARGV[0] = 'delivery' THEN
                        IF (OLD."Id", OLD."TenantId", OLD."EventId", OLD."BroadcastId", OLD."FrozenBroadcastVersion", OLD."RecipientUserId", OLD."Channel", OLD."DeliveryKey", OLD."CreatedAt") IS DISTINCT FROM (NEW."Id", NEW."TenantId", NEW."EventId", NEW."BroadcastId", NEW."FrozenBroadcastVersion", NEW."RecipientUserId", NEW."Channel", NEW."DeliveryKey", NEW."CreatedAt") THEN RAISE EXCEPTION 'event_broadcast_delivery_identity_immutable'; END IF;
                        IF OLD."Status" IN ('delivered','suppressed','cancelled') THEN RAISE EXCEPTION 'event_broadcast_delivery_terminal_immutable'; END IF;
                        IF NOT (OLD."Status" = NEW."Status" OR (OLD."Status" IN ('pending','retry') AND NEW."Status" IN ('processing','cancelled')) OR (OLD."Status" = 'processing' AND NEW."Status" IN ('delivered','suppressed','retry','dead_letter')) OR (OLD."Status" = 'dead_letter' AND NEW."Status" = 'retry')) THEN RAISE EXCEPTION 'event_broadcast_delivery_transition_invalid'; END IF;
                    END IF;
                    RETURN NEW;
                END;
                $guard$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_event_broadcast_no_delete BEFORE DELETE ON event_broadcasts FOR EACH ROW EXECUTE FUNCTION event_broadcast_evidence_guard('broadcast');
                CREATE TRIGGER trg_event_broadcast_lifecycle_guard BEFORE UPDATE ON event_broadcasts FOR EACH ROW EXECUTE FUNCTION event_broadcast_evidence_guard('broadcast');
                CREATE TRIGGER trg_event_broadcast_history_no_update BEFORE UPDATE ON event_broadcast_history FOR EACH ROW EXECUTE FUNCTION event_broadcast_evidence_guard('history');
                CREATE TRIGGER trg_event_broadcast_history_no_delete BEFORE DELETE ON event_broadcast_history FOR EACH ROW EXECUTE FUNCTION event_broadcast_evidence_guard('history');
                CREATE TRIGGER trg_event_broadcast_delivery_lifecycle_guard BEFORE UPDATE ON event_broadcast_deliveries FOR EACH ROW EXECUTE FUNCTION event_broadcast_evidence_guard('delivery');
                CREATE TRIGGER trg_event_broadcast_delivery_no_delete BEFORE DELETE ON event_broadcast_deliveries FOR EACH ROW EXECUTE FUNCTION event_broadcast_evidence_guard('delivery');
                CREATE TRIGGER trg_event_broadcast_attempt_no_update BEFORE UPDATE ON event_broadcast_delivery_attempts FOR EACH ROW EXECUTE FUNCTION event_broadcast_evidence_guard('attempt');
                CREATE TRIGGER trg_event_broadcast_attempt_no_delete BEFORE DELETE ON event_broadcast_delivery_attempts FOR EACH ROW EXECUTE FUNCTION event_broadcast_evidence_guard('attempt');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS event_broadcast_evidence_guard() CASCADE;");
            migrationBuilder.DropTable(
                name: "event_attendance");

            migrationBuilder.DropTable(
                name: "event_broadcast_deliveries");

            migrationBuilder.DropTable(
                name: "event_broadcast_delivery_attempts");

            migrationBuilder.DropTable(
                name: "event_broadcast_history");

            migrationBuilder.DropTable(
                name: "event_broadcasts");

            migrationBuilder.DropTable(
                name: "event_registrations");

            migrationBuilder.DropTable(
                name: "event_waitlist_entries");
        }
    }
}
