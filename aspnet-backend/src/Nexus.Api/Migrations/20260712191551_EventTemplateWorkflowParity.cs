using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventTemplateWorkflowParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AllDay",
                table: "events",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "AllowRemoteAttendance",
                table: "events",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<long>(
                name: "CalendarSequence",
                table: "events",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<int>(
                name: "CategoryId",
                table: "events",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FederatedVisibility",
                table: "events",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "none");

            migrationBuilder.AddColumn<bool>(
                name: "IsOnline",
                table: "events",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<double>(
                name: "Latitude",
                table: "events",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Longitude",
                table: "events",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Timezone",
                table: "events",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "UTC");

            migrationBuilder.CreateTable(
                name: "event_template_audit",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    TemplateId = table.Column<long>(type: "bigint", nullable: false),
                    TemplateVersionId = table.Column<long>(type: "bigint", nullable: true),
                    TemplateVersionNumber = table.Column<int>(type: "integer", nullable: false),
                    SourceEventId = table.Column<int>(type: "integer", nullable: false),
                    MaterializedEventId = table.Column<int>(type: "integer", nullable: true),
                    Action = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_template_audit", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_template_materializations",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    TemplateId = table.Column<long>(type: "bigint", nullable: false),
                    TemplateVersionId = table.Column<long>(type: "bigint", nullable: false),
                    TemplateVersionNumber = table.Column<int>(type: "integer", nullable: false),
                    SourceEventId = table.Column<int>(type: "integer", nullable: false),
                    CreatedEventId = table.Column<int>(type: "integer", nullable: false),
                    MaterializedByUserId = table.Column<int>(type: "integer", nullable: false),
                    SchemaVersion = table.Column<short>(type: "smallint", nullable: false),
                    TemplatePayloadHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    EffectivePayloadHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ScheduleStartUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ScheduleEndUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ScheduleTimezone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ScheduleAllDay = table.Column<bool>(type: "boolean", nullable: false),
                    OverrideFields = table.Column<string>(type: "jsonb", nullable: false),
                    FederationNormalized = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_template_materializations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_template_versions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    TemplateId = table.Column<long>(type: "bigint", nullable: false),
                    SourceEventId = table.Column<int>(type: "integer", nullable: false),
                    VersionNumber = table.Column<int>(type: "integer", nullable: false),
                    SchemaVersion = table.Column<short>(type: "smallint", nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: false),
                    PayloadHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CopiedFields = table.Column<string>(type: "jsonb", nullable: false),
                    SkippedFields = table.Column<string>(type: "jsonb", nullable: false),
                    SourceLifecycleVersion = table.Column<long>(type: "bigint", nullable: false),
                    SourceCalendarSequence = table.Column<long>(type: "bigint", nullable: false),
                    SourceUpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CapturedByUserId = table.Column<int>(type: "integer", nullable: false),
                    CaptureIdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CaptureRequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_template_versions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_templates",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    PublicId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceEventId = table.Column<int>(type: "integer", nullable: false),
                    CurrentVersion = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    ArchivedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ArchivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ArchiveReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_templates", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "idx_event_template_audit_source",
                table: "event_template_audit",
                columns: new[] { "TenantId", "SourceEventId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_template_audit_template",
                table: "event_template_audit",
                columns: new[] { "TenantId", "TemplateId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_template_audit_key",
                table: "event_template_audit",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_template_materialized_version",
                table: "event_template_materializations",
                columns: new[] { "TenantId", "TemplateId", "TemplateVersionNumber", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_template_materialize_key",
                table: "event_template_materializations",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_template_materialized_event",
                table: "event_template_materializations",
                columns: new[] { "TenantId", "CreatedEventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_template_capture_key",
                table: "event_template_versions",
                columns: new[] { "TenantId", "CaptureIdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_template_version",
                table: "event_template_versions",
                columns: new[] { "TenantId", "TemplateId", "VersionNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_template_version_provenance",
                table: "event_template_versions",
                columns: new[] { "TenantId", "TemplateId", "Id", "VersionNumber", "SourceEventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_template_source",
                table: "event_templates",
                columns: new[] { "TenantId", "SourceEventId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_template_status",
                table: "event_templates",
                columns: new[] { "TenantId", "Status", "UpdatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_template_public",
                table: "event_templates",
                column: "PublicId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_template_tenant_id",
                table: "event_templates",
                columns: new[] { "TenantId", "Id" },
                unique: true);

            migrationBuilder.Sql("""
                ALTER TABLE event_templates
                    ADD CONSTRAINT chk_event_template_version CHECK ("CurrentVersion" > 0),
                    ADD CONSTRAINT chk_event_template_status CHECK ("Status" IN ('active','archived')),
                    ADD CONSTRAINT chk_event_template_archive CHECK (
                        ("Status" = 'active' AND "ArchivedByUserId" IS NULL AND "ArchivedAt" IS NULL AND "ArchiveReason" IS NULL)
                        OR ("Status" = 'archived' AND "ArchivedByUserId" IS NOT NULL AND "ArchivedAt" IS NOT NULL AND length(btrim("ArchiveReason")) > 0)
                    );
                ALTER TABLE event_template_versions
                    ADD CONSTRAINT chk_event_template_version_number CHECK ("VersionNumber" > 0 AND "SchemaVersion" > 0),
                    ADD CONSTRAINT chk_event_template_payload_hash CHECK ("PayloadHash" ~ '^[0-9a-f]{64}$'),
                    ADD CONSTRAINT chk_event_template_capture_hashes CHECK ("CaptureIdempotencyHash" ~ '^[0-9a-f]{64}$' AND "CaptureRequestHash" ~ '^[0-9a-f]{64}$');
                ALTER TABLE event_template_materializations
                    ADD CONSTRAINT chk_event_template_material_hashes CHECK ("TemplatePayloadHash" ~ '^[0-9a-f]{64}$' AND "EffectivePayloadHash" ~ '^[0-9a-f]{64}$' AND "IdempotencyHash" ~ '^[0-9a-f]{64}$' AND "RequestHash" ~ '^[0-9a-f]{64}$'),
                    ADD CONSTRAINT chk_event_template_material_schedule CHECK ("ScheduleEndUtc" IS NULL OR "ScheduleEndUtc" > "ScheduleStartUtc"),
                    ADD CONSTRAINT chk_event_template_material_safe CHECK ("TemplateVersionNumber" > 0 AND "SchemaVersion" > 0 AND "FederationNormalized");
                ALTER TABLE event_template_audit
                    ADD CONSTRAINT chk_event_template_audit_action CHECK ("Action" IN ('captured','revised','archived','materialized')),
                    ADD CONSTRAINT chk_event_template_audit_hashes CHECK ("IdempotencyHash" ~ '^[0-9a-f]{64}$' AND "RequestHash" ~ '^[0-9a-f]{64}$'),
                    ADD CONSTRAINT chk_event_template_audit_version CHECK ("TemplateVersionNumber" > 0);

                CREATE OR REPLACE FUNCTION event_template_immutable() RETURNS trigger AS $BODY$
                BEGIN RAISE EXCEPTION 'event_template_evidence_immutable'; END; $BODY$ LANGUAGE plpgsql;
                CREATE TRIGGER trg_event_template_version_no_update BEFORE UPDATE ON event_template_versions FOR EACH ROW EXECUTE FUNCTION event_template_immutable();
                CREATE TRIGGER trg_event_template_version_no_delete BEFORE DELETE ON event_template_versions FOR EACH ROW EXECUTE FUNCTION event_template_immutable();
                CREATE TRIGGER trg_event_template_materialize_no_update BEFORE UPDATE ON event_template_materializations FOR EACH ROW EXECUTE FUNCTION event_template_immutable();
                CREATE TRIGGER trg_event_template_materialize_no_delete BEFORE DELETE ON event_template_materializations FOR EACH ROW EXECUTE FUNCTION event_template_immutable();
                CREATE TRIGGER trg_event_template_audit_no_update BEFORE UPDATE ON event_template_audit FOR EACH ROW EXECUTE FUNCTION event_template_immutable();
                CREATE TRIGGER trg_event_template_audit_no_delete BEFORE DELETE ON event_template_audit FOR EACH ROW EXECUTE FUNCTION event_template_immutable();
                CREATE TRIGGER trg_event_template_no_delete BEFORE DELETE ON event_templates FOR EACH ROW EXECUTE FUNCTION event_template_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS trg_event_template_version_no_update ON event_template_versions;
                DROP TRIGGER IF EXISTS trg_event_template_version_no_delete ON event_template_versions;
                DROP TRIGGER IF EXISTS trg_event_template_materialize_no_update ON event_template_materializations;
                DROP TRIGGER IF EXISTS trg_event_template_materialize_no_delete ON event_template_materializations;
                DROP TRIGGER IF EXISTS trg_event_template_audit_no_update ON event_template_audit;
                DROP TRIGGER IF EXISTS trg_event_template_audit_no_delete ON event_template_audit;
                DROP TRIGGER IF EXISTS trg_event_template_no_delete ON event_templates;
                DROP FUNCTION IF EXISTS event_template_immutable();
                """);
            migrationBuilder.DropTable(
                name: "event_template_audit");

            migrationBuilder.DropTable(
                name: "event_template_materializations");

            migrationBuilder.DropTable(
                name: "event_template_versions");

            migrationBuilder.DropTable(
                name: "event_templates");

            migrationBuilder.DropColumn(
                name: "AllDay",
                table: "events");

            migrationBuilder.DropColumn(
                name: "AllowRemoteAttendance",
                table: "events");

            migrationBuilder.DropColumn(
                name: "CalendarSequence",
                table: "events");

            migrationBuilder.DropColumn(
                name: "CategoryId",
                table: "events");

            migrationBuilder.DropColumn(
                name: "FederatedVisibility",
                table: "events");

            migrationBuilder.DropColumn(
                name: "IsOnline",
                table: "events");

            migrationBuilder.DropColumn(
                name: "Latitude",
                table: "events");

            migrationBuilder.DropColumn(
                name: "Longitude",
                table: "events");

            migrationBuilder.DropColumn(
                name: "Timezone",
                table: "events");
        }
    }
}
