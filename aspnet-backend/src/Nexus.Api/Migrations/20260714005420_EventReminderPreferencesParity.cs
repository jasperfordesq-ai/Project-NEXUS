using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventReminderPreferencesParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_reminder_rules",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    OffsetMinutes = table.Column<int>(type: "integer", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    EmailEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    InAppEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    WebPushEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    FcmEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    RealtimeEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    RuleVersion = table.Column<long>(type: "bigint", nullable: false, defaultValue: 1L),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_reminder_rules", x => x.Id);
                    table.CheckConstraint("chk_event_reminder_rule_offset", "\"OffsetMinutes\" BETWEEN 5 AND 525600");
                    table.CheckConstraint("chk_event_reminder_rule_version", "\"RuleVersion\" >= 1");
                    table.ForeignKey(
                        name: "FK_event_reminder_rules_events_EventId",
                        column: x => x.EventId,
                        principalTable: "events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_event_reminder_rules_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_event_reminder_rules_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "idx_event_reminder_rule_user",
                table: "event_reminder_rules",
                columns: new[] { "TenantId", "UserId", "Enabled", "EventId" });

            migrationBuilder.CreateIndex(
                name: "IX_event_reminder_rules_EventId",
                table: "event_reminder_rules",
                column: "EventId");

            migrationBuilder.CreateIndex(
                name: "IX_event_reminder_rules_UserId",
                table: "event_reminder_rules",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "uq_event_reminder_rule_offset",
                table: "event_reminder_rules",
                columns: new[] { "TenantId", "EventId", "UserId", "OffsetMinutes" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "event_reminder_rules");
        }
    }
}
