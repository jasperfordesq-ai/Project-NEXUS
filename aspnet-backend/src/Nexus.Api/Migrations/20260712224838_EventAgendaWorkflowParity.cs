using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventAgendaWorkflowParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "AgendaVersion",
                table: "events",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "event_session_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    SessionId = table.Column<long>(type: "bigint", nullable: true),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    AgendaVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ChangedFields = table.Column<string>(type: "jsonb", nullable: false),
                    AffectedSessionIds = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_session_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_session_registration_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    SessionId = table.Column<long>(type: "bigint", nullable: false),
                    RegistrationId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    EventRegistrationId = table.Column<long>(type: "bigint", nullable: false),
                    EventRegistrationVersion = table.Column<long>(type: "bigint", nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    RegistrationVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_session_registration_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_session_registrations",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    SessionId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    EventRegistrationId = table.Column<long>(type: "bigint", nullable: false),
                    EventRegistrationVersion = table.Column<long>(type: "bigint", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    RegisteredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    WithdrawnAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_session_registrations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_sessions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    Title = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    SessionType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Visibility = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Capacity = table.Column<int>(type: "integer", nullable: true),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    StartsAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndsAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Timezone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TrackName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    RoomName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    RoomKey = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    CancellationReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedBy = table.Column<int>(type: "integer", nullable: false),
                    UpdatedBy = table.Column<int>(type: "integer", nullable: false),
                    CancelledBy = table.Column<int>(type: "integer", nullable: true),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_sessions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_session_resources",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    SessionId = table.Column<long>(type: "bigint", nullable: false),
                    ResourceType = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Visibility = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Title = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    UrlCiphertext = table.Column<string>(type: "text", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    CreatedBy = table.Column<int>(type: "integer", nullable: false),
                    UpdatedBy = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_session_resources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_event_session_resources_event_sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "event_sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_session_speakers",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    SessionId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: true),
                    DisplayName = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: true),
                    RoleLabel = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_session_speakers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_event_session_speakers_event_sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "event_sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "uq_event_session_history_key",
                table: "event_session_history",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_session_history_version",
                table: "event_session_history",
                columns: new[] { "TenantId", "EventId", "AgendaVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_ev_session_reg_history_key",
                table: "event_session_registration_history",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_ev_session_reg_history_version",
                table: "event_session_registration_history",
                columns: new[] { "TenantId", "RegistrationId", "RegistrationVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_ev_session_reg_capacity",
                table: "event_session_registrations",
                columns: new[] { "TenantId", "EventId", "SessionId", "Status", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_ev_session_reg_member",
                table: "event_session_registrations",
                columns: new[] { "TenantId", "EventId", "SessionId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_ev_session_resources_order",
                table: "event_session_resources",
                columns: new[] { "TenantId", "EventId", "SessionId", "Position", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_event_session_resources_SessionId",
                table: "event_session_resources",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "idx_event_session_speakers_order",
                table: "event_session_speakers",
                columns: new[] { "TenantId", "EventId", "SessionId", "Position", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_event_session_speakers_SessionId",
                table: "event_session_speakers",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "uq_event_session_speaker_member",
                table: "event_session_speakers",
                columns: new[] { "TenantId", "SessionId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_sessions_event_time",
                table: "event_sessions",
                columns: new[] { "TenantId", "EventId", "Status", "StartsAtUtc", "Position", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_sessions_room_time",
                table: "event_sessions",
                columns: new[] { "TenantId", "EventId", "RoomKey", "Status", "StartsAtUtc", "EndsAtUtc" });

            migrationBuilder.CreateIndex(
                name: "uq_event_sessions_tenant_event_id",
                table: "event_sessions",
                columns: new[] { "TenantId", "EventId", "Id" },
                unique: true);

            migrationBuilder.Sql("""
                ALTER TABLE event_sessions
                  ADD CONSTRAINT chk_event_sessions_version CHECK ("Version" >= 1),
                  ADD CONSTRAINT chk_event_sessions_type CHECK ("SessionType" IN ('session','workshop','panel','keynote','break','networking','other')),
                  ADD CONSTRAINT chk_event_sessions_visibility CHECK ("Visibility" IN ('public','registered','staff')),
                  ADD CONSTRAINT chk_event_sessions_status CHECK ("Status" IN ('scheduled','cancelled')),
                  ADD CONSTRAINT chk_event_sessions_capacity CHECK ("Capacity" IS NULL OR "Capacity" >= 1),
                  ADD CONSTRAINT chk_event_sessions_time CHECK ("StartsAtUtc" < "EndsAtUtc"),
                  ADD CONSTRAINT chk_event_sessions_position CHECK ("Position" >= 0);
                ALTER TABLE event_session_speakers ADD CONSTRAINT chk_event_session_speaker_identity CHECK (("UserId" IS NOT NULL) <> (NULLIF(BTRIM("DisplayName"), '') IS NOT NULL));
                ALTER TABLE event_session_resources
                  ADD CONSTRAINT chk_event_session_resource_type CHECK ("ResourceType" IN ('link','document','slides','download','stream','recording')),
                  ADD CONSTRAINT chk_event_session_resource_visibility CHECK ("Visibility" IN ('public','registered','staff')),
                  ADD CONSTRAINT chk_event_session_resource_media CHECK ("ResourceType" NOT IN ('stream','recording') OR "Visibility" IN ('registered','staff'));
                ALTER TABLE event_session_registrations
                  ADD CONSTRAINT chk_event_session_registration_version CHECK ("Version" >= 1),
                  ADD CONSTRAINT chk_event_session_registration_status CHECK ("Status" IN ('registered','withdrawn'));
                ALTER TABLE event_session_registration_history ADD CONSTRAINT chk_event_session_registration_history_action CHECK ("Action" IN ('registered','withdrawn'));

                CREATE OR REPLACE FUNCTION nexus_event_agenda_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'event_agenda_history_immutable' USING ERRCODE = 'P0001'; END $$;
                CREATE TRIGGER trg_event_session_history_immutable BEFORE UPDATE OR DELETE ON event_session_history FOR EACH ROW EXECUTE FUNCTION nexus_event_agenda_history_immutable();
                CREATE TRIGGER trg_event_session_registration_history_immutable BEFORE UPDATE OR DELETE ON event_session_registration_history FOR EACH ROW EXECUTE FUNCTION nexus_event_agenda_history_immutable();
                CREATE TRIGGER trg_event_session_registration_no_delete BEFORE DELETE ON event_session_registrations FOR EACH ROW EXECUTE FUNCTION nexus_event_agenda_history_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "event_session_history");

            migrationBuilder.DropTable(
                name: "event_session_registration_history");

            migrationBuilder.DropTable(
                name: "event_session_registrations");

            migrationBuilder.DropTable(
                name: "event_session_resources");

            migrationBuilder.DropTable(
                name: "event_session_speakers");

            migrationBuilder.DropTable(
                name: "event_sessions");

            migrationBuilder.DropColumn(
                name: "AgendaVersion",
                table: "events");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS nexus_event_agenda_history_immutable() CASCADE;");
        }
    }
}
