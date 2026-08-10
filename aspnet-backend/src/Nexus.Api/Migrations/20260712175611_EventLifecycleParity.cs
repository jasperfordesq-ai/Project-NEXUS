using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventLifecycleParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CancellationReason",
                table: "events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CancelledAt",
                table: "events",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CancelledBy",
                table: "events",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LifecycleReason",
                table: "events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "LifecycleVersion",
                table: "events",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTime>(
                name: "ModeratedAt",
                table: "events",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ModeratedBy",
                table: "events",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ModerationReason",
                table: "events",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ModerationSubmittedAt",
                table: "events",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ModerationSubmittedBy",
                table: "events",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OperationalStatus",
                table: "events",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "scheduled");

            migrationBuilder.AddColumn<DateTime>(
                name: "OperationalStatusChangedAt",
                table: "events",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OperationalStatusChangedBy",
                table: "events",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PublicationStatus",
                table: "events",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "published");

            migrationBuilder.AddColumn<DateTime>(
                name: "PublicationStatusChangedAt",
                table: "events",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PublicationStatusChangedBy",
                table: "events",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "events",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "active");

            migrationBuilder.AddColumn<string>(
                name: "ClosedReason",
                table: "event_reminders",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "event_reminders",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "pending");

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                table: "event_reminders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE events
                SET "Status" = CASE WHEN "IsCancelled" THEN 'cancelled' ELSE 'active' END,
                    "PublicationStatus" = 'published',
                    "OperationalStatus" = CASE WHEN "IsCancelled" THEN 'cancelled' ELSE 'scheduled' END,
                    "LifecycleVersion" = 0;

                UPDATE event_reminders
                SET "Status" = CASE WHEN "IsSent" THEN 'sent' ELSE 'pending' END;
                """);

            migrationBuilder.CreateTable(
                name: "event_domain_outbox",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    AggregateStream = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    AggregateVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    ProductionMode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: false),
                    AvailableAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: true),
                    ClaimedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Attempts = table.Column<short>(type: "smallint", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ProcessedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeadLetteredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_domain_outbox", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_status_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    LifecycleVersion = table.Column<long>(type: "bigint", nullable: false),
                    FromPublicationStatus = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ToPublicationStatus = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    FromOperationalStatus = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ToOperationalStatus = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    FromLegacyStatus = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ToLegacyStatus = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: true),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_status_history", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "idx_events_tenant_lifecycle_start",
                table: "events",
                columns: new[] { "TenantId", "PublicationStatus", "OperationalStatus", "StartsAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_outbox_aggregate",
                table: "event_domain_outbox",
                columns: new[] { "TenantId", "EventId", "AggregateVersion" });

            migrationBuilder.CreateIndex(
                name: "idx_event_outbox_claim",
                table: "event_domain_outbox",
                columns: new[] { "Status", "AvailableAt", "NextAttemptAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_outbox_stream",
                table: "event_domain_outbox",
                columns: new[] { "TenantId", "EventId", "AggregateStream", "AggregateVersion", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_outbox_tenant_key",
                table: "event_domain_outbox",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_status_history_actor",
                table: "event_status_history",
                columns: new[] { "TenantId", "ActorUserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "idx_event_status_history_event",
                table: "event_status_history",
                columns: new[] { "TenantId", "EventId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_status_history_version",
                table: "event_status_history",
                columns: new[] { "TenantId", "EventId", "LifecycleVersion" },
                unique: true);

            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION event_status_history_immutable()
                RETURNS trigger AS $BODY$
                BEGIN
                    RAISE EXCEPTION 'event_status_history_immutable';
                END;
                $BODY$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_event_status_history_no_update
                BEFORE UPDATE ON event_status_history
                FOR EACH ROW EXECUTE FUNCTION event_status_history_immutable();

                CREATE TRIGGER trg_event_status_history_no_delete
                BEFORE DELETE ON event_status_history
                FOR EACH ROW EXECUTE FUNCTION event_status_history_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS trg_event_status_history_no_update ON event_status_history;
                DROP TRIGGER IF EXISTS trg_event_status_history_no_delete ON event_status_history;
                DROP FUNCTION IF EXISTS event_status_history_immutable();
                """);

            migrationBuilder.DropTable(
                name: "event_domain_outbox");

            migrationBuilder.DropTable(
                name: "event_status_history");

            migrationBuilder.DropIndex(
                name: "idx_events_tenant_lifecycle_start",
                table: "events");

            migrationBuilder.DropColumn(
                name: "CancellationReason",
                table: "events");

            migrationBuilder.DropColumn(
                name: "CancelledAt",
                table: "events");

            migrationBuilder.DropColumn(
                name: "CancelledBy",
                table: "events");

            migrationBuilder.DropColumn(
                name: "LifecycleReason",
                table: "events");

            migrationBuilder.DropColumn(
                name: "LifecycleVersion",
                table: "events");

            migrationBuilder.DropColumn(
                name: "ModeratedAt",
                table: "events");

            migrationBuilder.DropColumn(
                name: "ModeratedBy",
                table: "events");

            migrationBuilder.DropColumn(
                name: "ModerationReason",
                table: "events");

            migrationBuilder.DropColumn(
                name: "ModerationSubmittedAt",
                table: "events");

            migrationBuilder.DropColumn(
                name: "ModerationSubmittedBy",
                table: "events");

            migrationBuilder.DropColumn(
                name: "OperationalStatus",
                table: "events");

            migrationBuilder.DropColumn(
                name: "OperationalStatusChangedAt",
                table: "events");

            migrationBuilder.DropColumn(
                name: "OperationalStatusChangedBy",
                table: "events");

            migrationBuilder.DropColumn(
                name: "PublicationStatus",
                table: "events");

            migrationBuilder.DropColumn(
                name: "PublicationStatusChangedAt",
                table: "events");

            migrationBuilder.DropColumn(
                name: "PublicationStatusChangedBy",
                table: "events");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "events");

            migrationBuilder.DropColumn(
                name: "ClosedReason",
                table: "event_reminders");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "event_reminders");

            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "event_reminders");
        }
    }
}
