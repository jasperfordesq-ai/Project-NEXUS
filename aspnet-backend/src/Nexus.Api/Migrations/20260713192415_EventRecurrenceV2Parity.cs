using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventRecurrenceV2Parity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AccessibilityAssistanceContact",
                table: "events",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "AccessibilityHearingLoop",
                table: "events",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AccessibilityNotes",
                table: "events",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "AccessibilityParking",
                table: "events",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AccessibilityParkingDetails",
                table: "events",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "AccessibilityQuietSpace",
                table: "events",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "AccessibilitySeating",
                table: "events",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "AccessibilityStepFree",
                table: "events",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "AccessibilityToilet",
                table: "events",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AccessibilityTransitDetails",
                table: "events",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsRecurrenceException",
                table: "events",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsRecurringTemplate",
                table: "events",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "OccurrenceKey",
                table: "events",
                type: "character varying(191)",
                maxLength: 191,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OnlineLink",
                table: "events",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ParentEventId",
                table: "events",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RecurrenceEngine",
                table: "events",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RecurrenceEngineVersion",
                table: "events",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RecurrenceId",
                table: "events",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RecurrenceOverrideFields",
                table: "events",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "RecurrenceOverrideUpdatedAt",
                table: "events",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RecurrenceOverrideUpdatedBy",
                table: "events",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "RecurrenceOverrideVersion",
                table: "events",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<int>(
                name: "SeriesId",
                table: "events",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VideoUrl",
                table: "events",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "event_recurrence_definition_blueprints",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    RootEventId = table.Column<int>(type: "integer", nullable: false),
                    SourceEventId = table.Column<int>(type: "integer", nullable: false),
                    SourceRecurrenceId = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SourceOccurrenceKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    BlueprintVersion = table.Column<int>(type: "integer", nullable: false),
                    SchemaVersion = table.Column<int>(type: "integer", nullable: false),
                    EffectiveFromRecurrenceId = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SelectedSections = table.Column<string>(type: "jsonb", nullable: false),
                    Manifest = table.Column<string>(type: "jsonb", nullable: false),
                    ManifestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CapturedByUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_recurrence_definition_blueprints", x => x.Id);
                    table.ForeignKey(
                        name: "FK_event_recurrence_definition_blueprints_events_RootEventId",
                        column: x => x.RootEventId,
                        principalTable: "events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_event_recurrence_definition_blueprints_events_SourceEventId",
                        column: x => x.SourceEventId,
                        principalTable: "events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_recurrence_occurrence_ledger",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    RootEventId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    RecurrenceId = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    OccurrenceKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    State = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    StateVersion = table.Column<long>(type: "bigint", nullable: false),
                    RevisionVersion = table.Column<long>(type: "bigint", nullable: true),
                    StartTimeUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EndTimeUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ActorUserId = table.Column<int>(type: "integer", nullable: true),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_recurrence_occurrence_ledger", x => x.Id);
                    table.ForeignKey(
                        name: "FK_event_recurrence_occurrence_ledger_events_EventId",
                        column: x => x.EventId,
                        principalTable: "events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_event_recurrence_occurrence_ledger_events_RootEventId",
                        column: x => x.RootEventId,
                        principalTable: "events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_recurrence_revisions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    RootEventId = table.Column<int>(type: "integer", nullable: false),
                    RevisionVersion = table.Column<long>(type: "bigint", nullable: false),
                    EffectiveFromRecurrenceId = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    EffectiveFromUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EffectiveUntilRecurrenceId = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    EffectiveUntilUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CanonicalTimezone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CanonicalRRule = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    RuleHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    BlueprintPatch = table.Column<string>(type: "jsonb", nullable: false),
                    PatchHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    RootCalendarSequence = table.Column<long>(type: "bigint", nullable: false),
                    RuleVersion = table.Column<long>(type: "bigint", nullable: false),
                    MaterializedSetVersion = table.Column<long>(type: "bigint", nullable: false),
                    MaterializedChecksumBefore = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    MaterializedChecksumAfter = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ImpactSummary = table.Column<string>(type: "jsonb", nullable: false),
                    PreviewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_recurrence_revisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_event_recurrence_revisions_events_RootEventId",
                        column: x => x.RootEventId,
                        principalTable: "events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_recurrence_rules",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    Frequency = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Interval = table.Column<int>(type: "integer", nullable: false),
                    DaysOfWeek = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    DayOfMonth = table.Column<int>(type: "integer", nullable: true),
                    EndsType = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    EndsAfterCount = table.Column<int>(type: "integer", nullable: true),
                    EndsOnDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RRule = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    ExDates = table.Column<string>(type: "jsonb", nullable: false),
                    RDates = table.Column<string>(type: "jsonb", nullable: false),
                    RecurrenceEngine = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    RecurrenceEngineVersion = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    RuleHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    EffectiveRevisionVersion = table.Column<long>(type: "bigint", nullable: false),
                    MaterializedSetVersion = table.Column<long>(type: "bigint", nullable: false),
                    MaterializedThroughAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    MaterializationResumeAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    MaterializationLastAttemptedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    MaterializationLastSucceededAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    MaterializationLastFailedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    MaterializationErrorCode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    MaterializationTruncated = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_recurrence_rules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_event_recurrence_rules_events_EventId",
                        column: x => x.EventId,
                        principalTable: "events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "event_recurrence_definition_applications",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    RootEventId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    RecurrenceId = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    BlueprintId = table.Column<long>(type: "bigint", nullable: false),
                    BlueprintVersion = table.Column<int>(type: "integer", nullable: false),
                    ManifestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ApplicationHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    AppliedCounts = table.Column<string>(type: "jsonb", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AppliedByUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_recurrence_definition_applications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_event_recurrence_definition_applications_event_recurrence_d~",
                        column: x => x.BlueprintId,
                        principalTable: "event_recurrence_definition_blueprints",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_event_recurrence_definition_applications_events_EventId",
                        column: x => x.EventId,
                        principalTable: "events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_event_recurrence_definition_applications_events_RootEventId",
                        column: x => x.RootEventId,
                        principalTable: "events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "idx_events_recurrence_exception",
                table: "events",
                columns: new[] { "TenantId", "ParentEventId", "IsRecurrenceException" });

            migrationBuilder.CreateIndex(
                name: "IX_events_ParentEventId",
                table: "events",
                column: "ParentEventId");

            migrationBuilder.CreateIndex(
                name: "uq_events_tenant_parent_recurrence_id",
                table: "events",
                columns: new[] { "TenantId", "ParentEventId", "RecurrenceId" },
                unique: true,
                filter: "\"RecurrenceId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "idx_ev_rec_def_app_root",
                table: "event_recurrence_definition_applications",
                columns: new[] { "TenantId", "RootEventId", "BlueprintVersion", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_event_recurrence_definition_applications_BlueprintId",
                table: "event_recurrence_definition_applications",
                column: "BlueprintId");

            migrationBuilder.CreateIndex(
                name: "IX_event_recurrence_definition_applications_EventId",
                table: "event_recurrence_definition_applications",
                column: "EventId");

            migrationBuilder.CreateIndex(
                name: "IX_event_recurrence_definition_applications_RootEventId",
                table: "event_recurrence_definition_applications",
                column: "RootEventId");

            migrationBuilder.CreateIndex(
                name: "uq_ev_rec_def_app_event",
                table: "event_recurrence_definition_applications",
                columns: new[] { "TenantId", "EventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_ev_rec_def_app_recurrence",
                table: "event_recurrence_definition_applications",
                columns: new[] { "TenantId", "RootEventId", "RecurrenceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_ev_rec_def_bp_effective",
                table: "event_recurrence_definition_blueprints",
                columns: new[] { "TenantId", "RootEventId", "EffectiveFromRecurrenceId", "BlueprintVersion" });

            migrationBuilder.CreateIndex(
                name: "IX_event_recurrence_definition_blueprints_RootEventId",
                table: "event_recurrence_definition_blueprints",
                column: "RootEventId");

            migrationBuilder.CreateIndex(
                name: "IX_event_recurrence_definition_blueprints_SourceEventId",
                table: "event_recurrence_definition_blueprints",
                column: "SourceEventId");

            migrationBuilder.CreateIndex(
                name: "uq_ev_rec_def_bp_idempotency",
                table: "event_recurrence_definition_blueprints",
                columns: new[] { "TenantId", "RootEventId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_ev_rec_def_bp_version",
                table: "event_recurrence_definition_blueprints",
                columns: new[] { "TenantId", "RootEventId", "BlueprintVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_recur_occ_ledger_effective",
                table: "event_recurrence_occurrence_ledger",
                columns: new[] { "TenantId", "RootEventId", "RecurrenceId", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_recur_occ_ledger_state",
                table: "event_recurrence_occurrence_ledger",
                columns: new[] { "TenantId", "RootEventId", "State", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_event_recurrence_occurrence_ledger_EventId",
                table: "event_recurrence_occurrence_ledger",
                column: "EventId");

            migrationBuilder.CreateIndex(
                name: "IX_event_recurrence_occurrence_ledger_RootEventId",
                table: "event_recurrence_occurrence_ledger",
                column: "RootEventId");

            migrationBuilder.CreateIndex(
                name: "uq_event_recur_occ_ledger_event_version",
                table: "event_recurrence_occurrence_ledger",
                columns: new[] { "TenantId", "RootEventId", "EventId", "StateVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_recur_occ_ledger_identity_version",
                table: "event_recurrence_occurrence_ledger",
                columns: new[] { "TenantId", "RootEventId", "RecurrenceId", "StateVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_recur_revision_actor",
                table: "event_recurrence_revisions",
                columns: new[] { "TenantId", "ActorUserId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_recur_revision_effective",
                table: "event_recurrence_revisions",
                columns: new[] { "TenantId", "RootEventId", "EffectiveFromRecurrenceId", "RevisionVersion" });

            migrationBuilder.CreateIndex(
                name: "IX_event_recurrence_revisions_RootEventId",
                table: "event_recurrence_revisions",
                column: "RootEventId");

            migrationBuilder.CreateIndex(
                name: "uq_event_recur_revision_idempotency",
                table: "event_recurrence_revisions",
                columns: new[] { "TenantId", "RootEventId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_recur_revision_version",
                table: "event_recurrence_revisions",
                columns: new[] { "TenantId", "RootEventId", "RevisionVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_recurrence_materialization_due",
                table: "event_recurrence_rules",
                columns: new[] { "TenantId", "RecurrenceEngine", "EndsType", "MaterializedThroughAt" });

            migrationBuilder.CreateIndex(
                name: "IX_event_recurrence_rules_EventId",
                table: "event_recurrence_rules",
                column: "EventId");

            migrationBuilder.CreateIndex(
                name: "uq_event_recurrence_rule_tenant_event",
                table: "event_recurrence_rules",
                columns: new[] { "TenantId", "EventId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_events_events_ParentEventId",
                table: "events",
                column: "ParentEventId",
                principalTable: "events",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.Sql("""
                ALTER TABLE "event_recurrence_rules"
                  ADD CONSTRAINT "ck_event_recurrence_rule_shape" CHECK (
                    "Interval" > 0 AND "Frequency" IN ('daily','weekly','monthly','yearly')
                    AND "EndsType" IN ('after_count','on_date','never')
                    AND "RecurrenceEngine" = 'sabre-vobject' AND "RecurrenceEngineVersion" = '2'
                    AND "RuleHash" ~ '^[0-9a-f]{64}$');
                ALTER TABLE "event_recurrence_revisions"
                  ADD CONSTRAINT "ck_event_recur_revision_identity" CHECK (
                    "RevisionVersion" > 0 AND "EffectiveFromRecurrenceId" ~ '^[0-9]{8}T[0-9]{6}Z$'
                    AND ("EffectiveUntilRecurrenceId" IS NULL OR "EffectiveUntilRecurrenceId" ~ '^[0-9]{8}T[0-9]{6}Z$')
                    AND ("EffectiveUntilUtc" IS NULL) = ("EffectiveUntilRecurrenceId" IS NULL)
                    AND "RuleHash" ~ '^[0-9a-f]{64}$' AND "PatchHash" ~ '^[0-9a-f]{64}$'
                    AND "MaterializedChecksumBefore" ~ '^[0-9a-f]{64}$' AND "MaterializedChecksumAfter" ~ '^[0-9a-f]{64}$'
                    AND "IdempotencyHash" ~ '^[0-9a-f]{64}$' AND "RequestHash" ~ '^[0-9a-f]{64}$');
                ALTER TABLE "event_recurrence_occurrence_ledger"
                  ADD CONSTRAINT "ck_event_recur_occ_ledger_state" CHECK (
                    "State" IN ('materialized','customized','excluded','retired') AND "StateVersion" > 0
                    AND "RecurrenceId" ~ '^[0-9]{8}T[0-9]{6}Z$');
                ALTER TABLE "event_recurrence_definition_blueprints"
                  ADD CONSTRAINT "ck_ev_rec_def_bp_evidence" CHECK (
                    "BlueprintVersion" > 0 AND "SchemaVersion" > 0
                    AND "SourceRecurrenceId" ~ '^[0-9]{8}T[0-9]{6}Z$'
                    AND "EffectiveFromRecurrenceId" ~ '^[0-9]{8}T[0-9]{6}Z$'
                    AND "ManifestHash" ~ '^[0-9a-f]{64}$' AND "IdempotencyHash" ~ '^[0-9a-f]{64}$'
                    AND "RequestHash" ~ '^[0-9a-f]{64}$');
                ALTER TABLE "event_recurrence_definition_applications"
                  ADD CONSTRAINT "ck_ev_rec_def_app_evidence" CHECK (
                    "BlueprintVersion" > 0 AND "RecurrenceId" ~ '^[0-9]{8}T[0-9]{6}Z$'
                    AND "ManifestHash" ~ '^[0-9a-f]{64}$' AND "ApplicationHash" ~ '^[0-9a-f]{64}$'
                    AND "Status" = 'applied');

                CREATE OR REPLACE FUNCTION nexus_validate_event_recurrence_identity() RETURNS trigger LANGUAGE plpgsql AS $fn$
                BEGIN
                  IF TG_OP = 'UPDATE' AND OLD."RecurrenceId" IS NOT NULL AND OLD."RecurrenceId" IS DISTINCT FROM NEW."RecurrenceId" THEN
                    RAISE EXCEPTION 'event_recurrence_id_immutable' USING ERRCODE = 'P0001';
                  END IF;
                  IF NEW."RecurrenceId" IS NOT NULL THEN
                    IF NEW."RecurrenceId" !~ '^[0-9]{8}T[0-9]{6}Z$' OR NEW."ParentEventId" IS NULL
                       OR NEW."IsRecurringTemplate" OR NEW."RecurrenceEngine" IS DISTINCT FROM 'sabre-vobject'
                       OR NEW."RecurrenceEngineVersion" IS DISTINCT FROM '2' THEN
                      RAISE EXCEPTION 'event_recurrence_id_scope_invalid' USING ERRCODE = 'P0001';
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM events root WHERE root."Id" = NEW."ParentEventId"
                      AND root."TenantId" = NEW."TenantId" AND root."IsRecurringTemplate") THEN
                      RAISE EXCEPTION 'event_recurrence_parent_invalid' USING ERRCODE = 'P0001';
                    END IF;
                  END IF;
                  RETURN NEW;
                END $fn$;
                CREATE TRIGGER trg_events_recurrence_identity BEFORE INSERT OR UPDATE ON events
                  FOR EACH ROW EXECUTE FUNCTION nexus_validate_event_recurrence_identity();

                CREATE OR REPLACE FUNCTION nexus_recurrence_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
                BEGIN
                  RAISE EXCEPTION 'event_recurrence_evidence_immutable' USING ERRCODE = 'P0001';
                END $fn$;
                CREATE TRIGGER trg_event_recur_revision_immutable BEFORE UPDATE OR DELETE ON event_recurrence_revisions
                  FOR EACH ROW EXECUTE FUNCTION nexus_recurrence_evidence_immutable();
                CREATE TRIGGER trg_event_recur_occ_ledger_immutable BEFORE UPDATE OR DELETE ON event_recurrence_occurrence_ledger
                  FOR EACH ROW EXECUTE FUNCTION nexus_recurrence_evidence_immutable();
                CREATE TRIGGER trg_ev_rec_def_bp_immutable BEFORE UPDATE OR DELETE ON event_recurrence_definition_blueprints
                  FOR EACH ROW EXECUTE FUNCTION nexus_recurrence_evidence_immutable();
                CREATE TRIGGER trg_ev_rec_def_app_immutable BEFORE UPDATE OR DELETE ON event_recurrence_definition_applications
                  FOR EACH ROW EXECUTE FUNCTION nexus_recurrence_evidence_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS trg_events_recurrence_identity ON events;
                DROP FUNCTION IF EXISTS nexus_validate_event_recurrence_identity();
                DROP TRIGGER IF EXISTS trg_event_recur_revision_immutable ON event_recurrence_revisions;
                DROP TRIGGER IF EXISTS trg_event_recur_occ_ledger_immutable ON event_recurrence_occurrence_ledger;
                DROP TRIGGER IF EXISTS trg_ev_rec_def_bp_immutable ON event_recurrence_definition_blueprints;
                DROP TRIGGER IF EXISTS trg_ev_rec_def_app_immutable ON event_recurrence_definition_applications;
                DROP FUNCTION IF EXISTS nexus_recurrence_evidence_immutable();
                """);
            migrationBuilder.DropForeignKey(
                name: "FK_events_events_ParentEventId",
                table: "events");

            migrationBuilder.DropTable(
                name: "event_recurrence_definition_applications");

            migrationBuilder.DropTable(
                name: "event_recurrence_occurrence_ledger");

            migrationBuilder.DropTable(
                name: "event_recurrence_revisions");

            migrationBuilder.DropTable(
                name: "event_recurrence_rules");

            migrationBuilder.DropTable(
                name: "event_recurrence_definition_blueprints");

            migrationBuilder.DropIndex(
                name: "idx_events_recurrence_exception",
                table: "events");

            migrationBuilder.DropIndex(
                name: "IX_events_ParentEventId",
                table: "events");

            migrationBuilder.DropIndex(
                name: "uq_events_tenant_parent_recurrence_id",
                table: "events");

            migrationBuilder.DropColumn(
                name: "AccessibilityAssistanceContact",
                table: "events");

            migrationBuilder.DropColumn(
                name: "AccessibilityHearingLoop",
                table: "events");

            migrationBuilder.DropColumn(
                name: "AccessibilityNotes",
                table: "events");

            migrationBuilder.DropColumn(
                name: "AccessibilityParking",
                table: "events");

            migrationBuilder.DropColumn(
                name: "AccessibilityParkingDetails",
                table: "events");

            migrationBuilder.DropColumn(
                name: "AccessibilityQuietSpace",
                table: "events");

            migrationBuilder.DropColumn(
                name: "AccessibilitySeating",
                table: "events");

            migrationBuilder.DropColumn(
                name: "AccessibilityStepFree",
                table: "events");

            migrationBuilder.DropColumn(
                name: "AccessibilityToilet",
                table: "events");

            migrationBuilder.DropColumn(
                name: "AccessibilityTransitDetails",
                table: "events");

            migrationBuilder.DropColumn(
                name: "IsRecurrenceException",
                table: "events");

            migrationBuilder.DropColumn(
                name: "IsRecurringTemplate",
                table: "events");

            migrationBuilder.DropColumn(
                name: "OccurrenceKey",
                table: "events");

            migrationBuilder.DropColumn(
                name: "OnlineLink",
                table: "events");

            migrationBuilder.DropColumn(
                name: "ParentEventId",
                table: "events");

            migrationBuilder.DropColumn(
                name: "RecurrenceEngine",
                table: "events");

            migrationBuilder.DropColumn(
                name: "RecurrenceEngineVersion",
                table: "events");

            migrationBuilder.DropColumn(
                name: "RecurrenceId",
                table: "events");

            migrationBuilder.DropColumn(
                name: "RecurrenceOverrideFields",
                table: "events");

            migrationBuilder.DropColumn(
                name: "RecurrenceOverrideUpdatedAt",
                table: "events");

            migrationBuilder.DropColumn(
                name: "RecurrenceOverrideUpdatedBy",
                table: "events");

            migrationBuilder.DropColumn(
                name: "RecurrenceOverrideVersion",
                table: "events");

            migrationBuilder.DropColumn(
                name: "SeriesId",
                table: "events");

            migrationBuilder.DropColumn(
                name: "VideoUrl",
                table: "events");
        }
    }
}
