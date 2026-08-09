using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventStaffWorkflowParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_staff_assignments",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Role = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AssignmentVersion = table.Column<long>(type: "bigint", nullable: false),
                    GrantedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    GrantedBy = table.Column<int>(type: "integer", nullable: false),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedBy = table.Column<int>(type: "integer", nullable: true),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_staff_assignments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_staff_assignment_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    AssignmentId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Role = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    AssignmentVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: true),
                    FromStatus = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    ToStatus = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    PreviousExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    NewExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_staff_assignment_history", x => x.Id);
                    table.ForeignKey(
                        name: "FK_event_staff_assignment_history_event_staff_assignments_Assi~",
                        column: x => x.AssignmentId,
                        principalTable: "event_staff_assignments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "idx_event_staff_history_event",
                table: "event_staff_assignment_history",
                columns: new[] { "TenantId", "EventId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_event_staff_assignment_history_AssignmentId",
                table: "event_staff_assignment_history",
                column: "AssignmentId");

            migrationBuilder.CreateIndex(
                name: "uq_event_staff_history_idempotency",
                table: "event_staff_assignment_history",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_staff_history_version",
                table: "event_staff_assignment_history",
                columns: new[] { "TenantId", "AssignmentId", "AssignmentVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_staff_assignment_event",
                table: "event_staff_assignments",
                columns: new[] { "TenantId", "EventId", "Status", "ExpiresAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_staff_assignment_user",
                table: "event_staff_assignments",
                columns: new[] { "TenantId", "UserId", "Status", "ExpiresAt" });

            migrationBuilder.CreateIndex(
                name: "uq_event_staff_assignment_subject",
                table: "event_staff_assignments",
                columns: new[] { "TenantId", "EventId", "UserId", "Role" },
                unique: true);

            migrationBuilder.Sql("""
                ALTER TABLE event_staff_assignments
                  ADD CONSTRAINT chk_event_staff_role CHECK ("Role" IN ('co_organizer','registration_manager','communications_manager','check_in_staff','finance_manager')),
                  ADD CONSTRAINT chk_event_staff_status CHECK ("Status" IN ('active','revoked')),
                  ADD CONSTRAINT chk_event_staff_version CHECK ("AssignmentVersion" >= 1),
                  ADD CONSTRAINT chk_event_staff_revoke_state CHECK (("Status" = 'active' AND "RevokedAt" IS NULL AND "RevokedBy" IS NULL) OR ("Status" = 'revoked' AND "RevokedAt" IS NOT NULL AND "RevokedBy" IS NOT NULL));
                ALTER TABLE event_staff_assignment_history
                  ADD CONSTRAINT chk_event_staff_history_action CHECK ("Action" IN ('granted','revoked')),
                  ADD CONSTRAINT chk_event_staff_history_status CHECK (("FromStatus" IS NULL OR "FromStatus" IN ('active','revoked')) AND "ToStatus" IN ('active','revoked')),
                  ADD CONSTRAINT chk_event_staff_history_version CHECK ("AssignmentVersion" >= 1);
                CREATE OR REPLACE FUNCTION nexus_event_staff_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'event_staff_assignment_history_immutable' USING ERRCODE = 'P0001'; END $$;
                CREATE TRIGGER trg_event_staff_history_no_update BEFORE UPDATE ON event_staff_assignment_history FOR EACH ROW EXECUTE FUNCTION nexus_event_staff_history_immutable();
                CREATE TRIGGER trg_event_staff_history_no_delete BEFORE DELETE ON event_staff_assignment_history FOR EACH ROW EXECUTE FUNCTION nexus_event_staff_history_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "event_staff_assignment_history");

            migrationBuilder.DropTable(
                name: "event_staff_assignments");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS nexus_event_staff_history_immutable() CASCADE;");
        }
    }
}
