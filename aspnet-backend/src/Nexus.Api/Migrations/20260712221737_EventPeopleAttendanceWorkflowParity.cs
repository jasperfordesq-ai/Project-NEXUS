using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventPeopleAttendanceWorkflowParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "idx_event_attendance_audience",
                table: "event_attendance");

            migrationBuilder.AlterColumn<string>(
                name: "AttendanceStatus",
                table: "event_attendance",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(24)",
                oldMaxLength: 24);

            migrationBuilder.AddColumn<long>(
                name: "AttendanceVersion",
                table: "event_attendance",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTime>(
                name: "CheckedInAt",
                table: "event_attendance",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CheckedInBy",
                table: "event_attendance",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CheckedOutAt",
                table: "event_attendance",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "HoursCredited",
                table: "event_attendance",
                type: "numeric(10,2)",
                precision: 10,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "event_attendance",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "StatusChangedAt",
                table: "event_attendance",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<int>(
                name: "StatusChangedBy",
                table: "event_attendance",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "event_attendance_activity",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    AttendanceId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    AttendanceVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    FromStatus = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    ToStatus = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: true),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_attendance_activity", x => x.Id);
                });

            migrationBuilder.Sql("""
                UPDATE event_attendance
                SET "AttendanceVersion" = 1,
                    "StatusChangedAt" = COALESCE("UpdatedAt", "CreatedAt", NOW()),
                    "CheckedInAt" = CASE WHEN "AttendanceStatus" IN ('checked_in','checked_out','attended') THEN COALESCE("UpdatedAt", "CreatedAt", NOW()) ELSE NULL END,
                    "CheckedOutAt" = CASE WHEN "AttendanceStatus" IN ('checked_out','attended') THEN COALESCE("UpdatedAt", "CreatedAt", NOW()) ELSE NULL END;
                ALTER TABLE event_attendance ALTER COLUMN "AttendanceVersion" SET DEFAULT 1;
                ALTER TABLE event_attendance DROP CONSTRAINT IF EXISTS chk_event_attendance_status;
                ALTER TABLE event_attendance ADD CONSTRAINT chk_event_attendance_status_v2 CHECK ("AttendanceStatus" IN ('not_checked_in','checked_in','checked_out','attended','no_show'));
                ALTER TABLE event_attendance ADD CONSTRAINT chk_event_attendance_version CHECK ("AttendanceVersion" >= 1);
                """);

            migrationBuilder.CreateIndex(
                name: "idx_event_attendance_tenant_event_status",
                table: "event_attendance",
                columns: new[] { "TenantId", "EventId", "AttendanceStatus", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_attendance_activity_event",
                table: "event_attendance_activity",
                columns: new[] { "TenantId", "EventId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_attendance_activity_user",
                table: "event_attendance_activity",
                columns: new[] { "TenantId", "UserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "uq_event_attendance_activity_key",
                table: "event_attendance_activity",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_attendance_activity_version",
                table: "event_attendance_activity",
                columns: new[] { "TenantId", "AttendanceId", "AttendanceVersion" },
                unique: true);

            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION event_attendance_activity_immutable() RETURNS trigger AS $guard$
                BEGIN RAISE EXCEPTION 'event_attendance_activity_immutable'; END;
                $guard$ LANGUAGE plpgsql;
                CREATE TRIGGER trg_event_attendance_activity_no_update BEFORE UPDATE ON event_attendance_activity FOR EACH ROW EXECUTE FUNCTION event_attendance_activity_immutable();
                CREATE TRIGGER trg_event_attendance_activity_no_delete BEFORE DELETE ON event_attendance_activity FOR EACH ROW EXECUTE FUNCTION event_attendance_activity_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $guard$ BEGIN
                    IF EXISTS (SELECT 1 FROM event_attendance_activity LIMIT 1) THEN
                        RAISE EXCEPTION 'event_people_attendance_rollback_refused_evidence_exists';
                    END IF;
                END $guard$;
                DROP FUNCTION IF EXISTS event_attendance_activity_immutable() CASCADE;
                """);
            migrationBuilder.DropTable(
                name: "event_attendance_activity");

            migrationBuilder.DropIndex(
                name: "idx_event_attendance_tenant_event_status",
                table: "event_attendance");

            migrationBuilder.DropColumn(
                name: "AttendanceVersion",
                table: "event_attendance");

            migrationBuilder.DropColumn(
                name: "CheckedInAt",
                table: "event_attendance");

            migrationBuilder.DropColumn(
                name: "CheckedInBy",
                table: "event_attendance");

            migrationBuilder.DropColumn(
                name: "CheckedOutAt",
                table: "event_attendance");

            migrationBuilder.DropColumn(
                name: "HoursCredited",
                table: "event_attendance");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "event_attendance");

            migrationBuilder.DropColumn(
                name: "StatusChangedAt",
                table: "event_attendance");

            migrationBuilder.DropColumn(
                name: "StatusChangedBy",
                table: "event_attendance");

            migrationBuilder.AlterColumn<string>(
                name: "AttendanceStatus",
                table: "event_attendance",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32);

            migrationBuilder.CreateIndex(
                name: "idx_event_attendance_audience",
                table: "event_attendance",
                columns: new[] { "TenantId", "EventId", "AttendanceStatus", "UserId" });
        }
    }
}
