using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventFederationReliabilityParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "FederationVersion",
                table: "events",
                type: "bigint",
                nullable: false,
                defaultValue: 1L);

            migrationBuilder.Sql("UPDATE events SET \"FederationVersion\" = GREATEST(1, \"LifecycleVersion\", \"CalendarSequence\") WHERE \"FederationVersion\" < GREATEST(1, \"LifecycleVersion\", \"CalendarSequence\");");

            migrationBuilder.CreateTable(
                name: "event_federation_deliveries",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    ExternalPartnerId = table.Column<int>(type: "integer", nullable: false),
                    PayloadSchemaVersion = table.Column<short>(type: "smallint", nullable: false),
                    EventAggregateVersion = table.Column<long>(type: "bigint", nullable: false),
                    EventCalendarVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    PayloadHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Attempts = table.Column<short>(type: "smallint", nullable: false),
                    AvailableAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: true),
                    ClaimedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeliveredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeadLetteredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastErrorCode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    LastError = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_federation_deliveries", x => x.Id);
                    table.CheckConstraint("chk_event_fed_delivery_action", "\"Action\" IN ('upsert','tombstone')");
                    table.CheckConstraint("chk_event_fed_delivery_attempts", "\"Attempts\" BETWEEN 0 AND 5");
                    table.CheckConstraint("chk_event_fed_delivery_status", "\"Status\" IN ('pending','retry','processing','delivered','dead_letter')");
                });

            migrationBuilder.CreateIndex(
                name: "idx_event_fed_delivery_claim",
                table: "event_federation_deliveries",
                columns: new[] { "Status", "AvailableAt", "NextAttemptAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_fed_delivery_event",
                table: "event_federation_deliveries",
                columns: new[] { "TenantId", "EventId", "ExternalPartnerId", "EventAggregateVersion", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_fed_delivery_partner",
                table: "event_federation_deliveries",
                columns: new[] { "TenantId", "ExternalPartnerId", "Status", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_fed_delivery_idempotency",
                table: "event_federation_deliveries",
                columns: new[] { "TenantId", "ExternalPartnerId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_fed_delivery_version",
                table: "event_federation_deliveries",
                columns: new[] { "TenantId", "EventId", "ExternalPartnerId", "PayloadSchemaVersion", "EventAggregateVersion", "EventCalendarVersion" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "event_federation_deliveries");

            migrationBuilder.DropColumn(
                name: "FederationVersion",
                table: "events");
        }
    }
}
