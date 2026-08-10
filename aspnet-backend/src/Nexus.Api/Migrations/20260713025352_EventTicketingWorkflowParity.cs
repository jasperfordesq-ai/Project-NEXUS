using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventTicketingWorkflowParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_ticket_entitlement_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    TicketTypeId = table.Column<long>(type: "bigint", nullable: false),
                    EntitlementId = table.Column<long>(type: "bigint", nullable: false),
                    RegistrationId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    EntitlementVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Units = table.Column<int>(type: "integer", nullable: false),
                    TicketKindSnapshot = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    UnitPriceCreditsSnapshot = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    TotalPriceCreditsSnapshot = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_ticket_entitlement_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_ticket_entitlements",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    TicketTypeId = table.Column<long>(type: "bigint", nullable: false),
                    RegistrationId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Units = table.Column<int>(type: "integer", nullable: false),
                    TicketKindSnapshot = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    UnitPriceCreditsSnapshot = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    TotalPriceCreditsSnapshot = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    CreatedBy = table.Column<int>(type: "integer", nullable: false),
                    AllocationIdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    AllocationRequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ConfirmedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CancelledBy = table.Column<int>(type: "integer", nullable: true),
                    CancellationReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_ticket_entitlements", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_ticket_inventory_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    TicketTypeId = table.Column<long>(type: "bigint", nullable: false),
                    EntitlementId = table.Column<long>(type: "bigint", nullable: false),
                    EntitlementVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    QuantityDelta = table.Column<int>(type: "integer", nullable: false),
                    ConfirmedUnitsAfter = table.Column<int>(type: "integer", nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_ticket_inventory_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_ticket_type_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    TicketTypeId = table.Column<long>(type: "bigint", nullable: false),
                    TicketVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ChangedFields = table.Column<string>(type: "jsonb", nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_ticket_type_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_ticket_types",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    OccurrenceKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    Name = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    UnitPriceCredits = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    AllocationLimit = table.Column<int>(type: "integer", nullable: false),
                    SalesOpensAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SalesClosesAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EventStartsAtSnapshot = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EventTimezoneSnapshot = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PerMemberLimit = table.Column<int>(type: "integer", nullable: false),
                    EligibilityPolicy = table.Column<string>(type: "jsonb", nullable: false),
                    RefundCutoffAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    OrganizerCancelRefundable = table.Column<bool>(type: "boolean", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedBy = table.Column<int>(type: "integer", nullable: false),
                    UpdatedBy = table.Column<int>(type: "integer", nullable: false),
                    ActivatedBy = table.Column<int>(type: "integer", nullable: true),
                    ActivatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PausedBy = table.Column<int>(type: "integer", nullable: true),
                    PausedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ArchivedBy = table.Column<int>(type: "integer", nullable: true),
                    ArchivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_ticket_types", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_entitlement_history_TenantId_EntitlementId_Ent~",
                table: "event_ticket_entitlement_history",
                columns: new[] { "TenantId", "EntitlementId", "EntitlementVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_entitlement_history_TenantId_EventId_TicketTyp~",
                table: "event_ticket_entitlement_history",
                columns: new[] { "TenantId", "EventId", "TicketTypeId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_entitlement_history_TenantId_IdempotencyHash",
                table: "event_ticket_entitlement_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_entitlements_TenantId_AllocationIdempotencyHash",
                table: "event_ticket_entitlements",
                columns: new[] { "TenantId", "AllocationIdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_entitlements_TenantId_EventId_Id",
                table: "event_ticket_entitlements",
                columns: new[] { "TenantId", "EventId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_entitlements_TenantId_EventId_TicketTypeId_Id",
                table: "event_ticket_entitlements",
                columns: new[] { "TenantId", "EventId", "TicketTypeId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_entitlements_TenantId_EventId_TicketTypeId_Reg~",
                table: "event_ticket_entitlements",
                columns: new[] { "TenantId", "EventId", "TicketTypeId", "RegistrationId", "UserId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_entitlements_TenantId_EventId_TicketTypeId_Sta~",
                table: "event_ticket_entitlements",
                columns: new[] { "TenantId", "EventId", "TicketTypeId", "Status", "UserId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_entitlements_TenantId_UserId_Status_EventId_Id",
                table: "event_ticket_entitlements",
                columns: new[] { "TenantId", "UserId", "Status", "EventId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_inventory_history_TenantId_EntitlementId_Entit~",
                table: "event_ticket_inventory_history",
                columns: new[] { "TenantId", "EntitlementId", "EntitlementVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_inventory_history_TenantId_EventId_TicketTypeI~",
                table: "event_ticket_inventory_history",
                columns: new[] { "TenantId", "EventId", "TicketTypeId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_inventory_history_TenantId_IdempotencyHash",
                table: "event_ticket_inventory_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_type_history_TenantId_EventId_CreatedAt_Id",
                table: "event_ticket_type_history",
                columns: new[] { "TenantId", "EventId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_type_history_TenantId_IdempotencyHash",
                table: "event_ticket_type_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_type_history_TenantId_TicketTypeId_TicketVersi~",
                table: "event_ticket_type_history",
                columns: new[] { "TenantId", "TicketTypeId", "TicketVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_types_TenantId_EventId_Id",
                table: "event_ticket_types",
                columns: new[] { "TenantId", "EventId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_types_TenantId_EventId_Kind_Status_Id",
                table: "event_ticket_types",
                columns: new[] { "TenantId", "EventId", "Kind", "Status", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_types_TenantId_EventId_Name",
                table: "event_ticket_types",
                columns: new[] { "TenantId", "EventId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_ticket_types_TenantId_EventId_Status_SalesOpensAt_Sal~",
                table: "event_ticket_types",
                columns: new[] { "TenantId", "EventId", "Status", "SalesOpensAt", "SalesClosesAt", "Id" });

            migrationBuilder.Sql("""
                ALTER TABLE event_ticket_types
                  ADD CONSTRAINT chk_event_ticket_type_version CHECK ("Version" > 0),
                  ADD CONSTRAINT chk_event_ticket_type_name CHECK (char_length(btrim("Name")) BETWEEN 1 AND 191),
                  ADD CONSTRAINT chk_event_ticket_type_kind CHECK ("Kind" IN ('free','time_credit')),
                  ADD CONSTRAINT chk_event_ticket_type_price CHECK (("Kind"='free' AND "UnitPriceCredits"=0) OR ("Kind"='time_credit' AND "UnitPriceCredits">0 AND "UnitPriceCredits"<=100000)),
                  ADD CONSTRAINT chk_event_ticket_type_allocation CHECK ("AllocationLimit" BETWEEN 1 AND 1000000 AND "PerMemberLimit" BETWEEN 1 AND 1000 AND "PerMemberLimit" <= "AllocationLimit"),
                  ADD CONSTRAINT chk_event_ticket_type_sales CHECK ("SalesOpensAt" < "SalesClosesAt" AND "SalesClosesAt" <= "EventStartsAtSnapshot"),
                  ADD CONSTRAINT chk_event_ticket_type_refund CHECK ("RefundCutoffAt" IS NULL OR "RefundCutoffAt" <= "EventStartsAtSnapshot"),
                  ADD CONSTRAINT chk_event_ticket_type_policy CHECK (jsonb_typeof("EligibilityPolicy")='object'),
                  ADD CONSTRAINT chk_event_ticket_type_status CHECK ("Status" IN ('draft','active','paused','archived')),
                  ADD CONSTRAINT chk_event_ticket_type_lifecycle CHECK (
                    ("Status"='draft' AND "ActivatedBy" IS NULL AND "ActivatedAt" IS NULL AND "PausedBy" IS NULL AND "PausedAt" IS NULL AND "ArchivedBy" IS NULL AND "ArchivedAt" IS NULL) OR
                    ("Status"='active' AND "ActivatedBy" IS NOT NULL AND "ActivatedAt" IS NOT NULL AND "ArchivedBy" IS NULL AND "ArchivedAt" IS NULL) OR
                    ("Status"='paused' AND "ActivatedBy" IS NOT NULL AND "ActivatedAt" IS NOT NULL AND "PausedBy" IS NOT NULL AND "PausedAt" IS NOT NULL AND "ArchivedBy" IS NULL AND "ArchivedAt" IS NULL) OR
                    ("Status"='archived' AND "ArchivedBy" IS NOT NULL AND "ArchivedAt" IS NOT NULL));

                ALTER TABLE event_ticket_type_history
                  ADD CONSTRAINT chk_event_ticket_type_hist_action CHECK ("Action" IN ('created','updated','activated','paused','archived')),
                  ADD CONSTRAINT chk_event_ticket_type_hist_version CHECK ("TicketVersion" > 0),
                  ADD CONSTRAINT chk_event_ticket_type_hist_reason CHECK (("Action" IN ('created','updated','activated') AND "Reason" IS NULL) OR ("Action" IN ('paused','archived') AND char_length(btrim("Reason")) > 0));

                ALTER TABLE event_ticket_entitlements
                  ADD CONSTRAINT chk_event_ticket_ent_units CHECK ("Units" BETWEEN 1 AND 1000),
                  ADD CONSTRAINT chk_event_ticket_ent_free_only CHECK ("TicketKindSnapshot"='free' AND "UnitPriceCreditsSnapshot"=0 AND "TotalPriceCreditsSnapshot"=0),
                  ADD CONSTRAINT chk_event_ticket_ent_total CHECK ("TotalPriceCreditsSnapshot"="UnitPriceCreditsSnapshot"*"Units"),
                  ADD CONSTRAINT chk_event_ticket_ent_status CHECK ("Status" IN ('confirmed','cancelled') AND "Version">0),
                  ADD CONSTRAINT chk_event_ticket_ent_lifecycle CHECK (("Status"='confirmed' AND "CancelledBy" IS NULL AND "CancellationReason" IS NULL AND "CancelledAt" IS NULL) OR ("Status"='cancelled' AND "CancelledBy" IS NOT NULL AND char_length(btrim("CancellationReason"))>0 AND "CancelledAt" IS NOT NULL));

                ALTER TABLE event_ticket_entitlement_history
                  ADD CONSTRAINT chk_event_ticket_ent_hist_action CHECK ("Action" IN ('confirmed','cancelled')),
                  ADD CONSTRAINT chk_event_ticket_ent_hist_version CHECK ("EntitlementVersion">0),
                  ADD CONSTRAINT chk_event_ticket_ent_hist_units CHECK ("Units" BETWEEN 1 AND 1000),
                  ADD CONSTRAINT chk_event_ticket_ent_hist_free CHECK ("TicketKindSnapshot"='free' AND "UnitPriceCreditsSnapshot"=0 AND "TotalPriceCreditsSnapshot"=0),
                  ADD CONSTRAINT chk_event_ticket_ent_hist_total CHECK ("TotalPriceCreditsSnapshot"="UnitPriceCreditsSnapshot"*"Units"),
                  ADD CONSTRAINT chk_event_ticket_ent_hist_reason CHECK (("Action"='confirmed' AND "Reason" IS NULL) OR ("Action"='cancelled' AND char_length(btrim("Reason"))>0));

                ALTER TABLE event_ticket_inventory_history
                  ADD CONSTRAINT chk_event_ticket_inv_hist_version CHECK ("EntitlementVersion">0),
                  ADD CONSTRAINT chk_event_ticket_inv_hist_action CHECK (("Action"='allocated' AND "QuantityDelta">0) OR ("Action"='released' AND "QuantityDelta"<0)),
                  ADD CONSTRAINT chk_event_ticket_inv_hist_after CHECK ("ConfirmedUnitsAfter">=0);

                CREATE OR REPLACE FUNCTION event_ticket_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'event_ticket_history_immutable' USING ERRCODE='P0001'; END $$;
                CREATE TRIGGER trg_event_ticket_type_hist_no_update BEFORE UPDATE ON event_ticket_type_history FOR EACH ROW EXECUTE FUNCTION event_ticket_history_immutable();
                CREATE TRIGGER trg_event_ticket_type_hist_no_delete BEFORE DELETE ON event_ticket_type_history FOR EACH ROW EXECUTE FUNCTION event_ticket_history_immutable();
                CREATE TRIGGER trg_event_ticket_ent_hist_no_update BEFORE UPDATE ON event_ticket_entitlement_history FOR EACH ROW EXECUTE FUNCTION event_ticket_history_immutable();
                CREATE TRIGGER trg_event_ticket_ent_hist_no_delete BEFORE DELETE ON event_ticket_entitlement_history FOR EACH ROW EXECUTE FUNCTION event_ticket_history_immutable();
                CREATE TRIGGER trg_event_ticket_inv_hist_no_update BEFORE UPDATE ON event_ticket_inventory_history FOR EACH ROW EXECUTE FUNCTION event_ticket_history_immutable();
                CREATE TRIGGER trg_event_ticket_inv_hist_no_delete BEFORE DELETE ON event_ticket_inventory_history FOR EACH ROW EXECUTE FUNCTION event_ticket_history_immutable();

                CREATE OR REPLACE FUNCTION event_ticket_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'event_ticket_delete_forbidden' USING ERRCODE='P0001'; END $$;
                CREATE TRIGGER trg_event_ticket_type_no_delete BEFORE DELETE ON event_ticket_types FOR EACH ROW EXECUTE FUNCTION event_ticket_no_delete();
                CREATE TRIGGER trg_event_ticket_entitlement_no_delete BEFORE DELETE ON event_ticket_entitlements FOR EACH ROW EXECUTE FUNCTION event_ticket_no_delete();

                CREATE OR REPLACE FUNCTION event_ticket_type_validate_insert() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF NOT EXISTS (SELECT 1 FROM events e WHERE e."TenantId"=NEW."TenantId" AND e."Id"=NEW."EventId" AND e."StartsAt"=NEW."EventStartsAtSnapshot" AND e."Timezone"=NEW."EventTimezoneSnapshot") THEN RAISE EXCEPTION 'event_ticket_concrete_occurrence_required' USING ERRCODE='P0001'; END IF;
                  IF NEW."OccurrenceKey"<>('event:' || NEW."EventId"::text) THEN RAISE EXCEPTION 'event_ticket_occurrence_key_invalid' USING ERRCODE='P0001'; END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER trg_event_ticket_type_validate_insert BEFORE INSERT ON event_ticket_types FOR EACH ROW EXECUTE FUNCTION event_ticket_type_validate_insert();

                CREATE OR REPLACE FUNCTION event_ticket_entitlement_validate_insert() RETURNS trigger LANGUAGE plpgsql AS $$
                DECLARE ticket event_ticket_types%ROWTYPE; confirmed_total integer; member_total integer;
                BEGIN
                  SELECT * INTO ticket FROM event_ticket_types t WHERE t."TenantId"=NEW."TenantId" AND t."EventId"=NEW."EventId" AND t."Id"=NEW."TicketTypeId" FOR UPDATE;
                  IF NOT FOUND OR ticket."Status"<>'active' OR ticket."Kind"<>'free' OR ticket."UnitPriceCredits"<>0 OR clock_timestamp()<ticket."SalesOpensAt" OR clock_timestamp()>=ticket."SalesClosesAt" THEN RAISE EXCEPTION 'event_ticket_free_type_not_allocatable' USING ERRCODE='P0001'; END IF;
                  IF NOT EXISTS (SELECT 1 FROM event_registrations r WHERE r."TenantId"=NEW."TenantId" AND r."EventId"=NEW."EventId" AND r."Id"=NEW."RegistrationId" AND r."UserId"=NEW."UserId" AND r."RegistrationState"='confirmed') THEN RAISE EXCEPTION 'event_ticket_confirmed_registration_required' USING ERRCODE='P0001'; END IF;
                  SELECT COALESCE(sum(e."Units"),0), COALESCE(sum(e."Units") FILTER (WHERE e."UserId"=NEW."UserId"),0) INTO confirmed_total,member_total FROM event_ticket_entitlements e WHERE e."TenantId"=NEW."TenantId" AND e."EventId"=NEW."EventId" AND e."TicketTypeId"=NEW."TicketTypeId" AND e."Status"='confirmed';
                  IF confirmed_total+NEW."Units">ticket."AllocationLimit" THEN RAISE EXCEPTION 'event_ticket_allocation_exhausted' USING ERRCODE='P0001'; END IF;
                  IF member_total+NEW."Units">ticket."PerMemberLimit" THEN RAISE EXCEPTION 'event_ticket_per_member_limit_exceeded' USING ERRCODE='P0001'; END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER trg_event_ticket_entitlement_validate_insert BEFORE INSERT ON event_ticket_entitlements FOR EACH ROW EXECUTE FUNCTION event_ticket_entitlement_validate_insert();

                CREATE OR REPLACE FUNCTION event_ticket_type_validate_update() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF OLD."TenantId"<>NEW."TenantId" OR OLD."EventId"<>NEW."EventId" OR OLD."OccurrenceKey"<>NEW."OccurrenceKey" OR OLD."CreatedBy"<>NEW."CreatedBy" OR OLD."CreatedAt"<>NEW."CreatedAt" THEN RAISE EXCEPTION 'event_ticket_type_identity_immutable' USING ERRCODE='P0001'; END IF;
                  IF OLD."Status"='archived' THEN RAISE EXCEPTION 'event_ticket_type_archived_immutable' USING ERRCODE='P0001'; END IF;
                  IF NEW."Version"<>OLD."Version"+1 THEN RAISE EXCEPTION 'event_ticket_type_version_invalid' USING ERRCODE='P0001'; END IF;
                  IF NOT ((OLD."Status"='draft' AND NEW."Status" IN ('draft','active','archived')) OR (OLD."Status"='active' AND NEW."Status" IN ('paused','archived')) OR (OLD."Status"='paused' AND NEW."Status" IN ('paused','active','archived'))) THEN RAISE EXCEPTION 'event_ticket_type_transition_invalid' USING ERRCODE='P0001'; END IF;
                  IF EXISTS (SELECT 1 FROM event_ticket_entitlements e WHERE e."TenantId"=OLD."TenantId" AND e."EventId"=OLD."EventId" AND e."TicketTypeId"=OLD."Id") AND (OLD."Kind"<>NEW."Kind" OR OLD."UnitPriceCredits"<>NEW."UnitPriceCredits" OR OLD."AllocationLimit"<>NEW."AllocationLimit" OR OLD."PerMemberLimit"<>NEW."PerMemberLimit") THEN RAISE EXCEPTION 'event_ticket_type_inventory_fields_immutable' USING ERRCODE='P0001'; END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER trg_event_ticket_type_validate_update BEFORE UPDATE ON event_ticket_types FOR EACH ROW EXECUTE FUNCTION event_ticket_type_validate_update();

                CREATE OR REPLACE FUNCTION event_ticket_entitlement_validate_update() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF OLD."TenantId"<>NEW."TenantId" OR OLD."EventId"<>NEW."EventId" OR OLD."TicketTypeId"<>NEW."TicketTypeId" OR OLD."RegistrationId"<>NEW."RegistrationId" OR OLD."UserId"<>NEW."UserId" OR OLD."Units"<>NEW."Units" OR OLD."TicketKindSnapshot"<>NEW."TicketKindSnapshot" OR OLD."UnitPriceCreditsSnapshot"<>NEW."UnitPriceCreditsSnapshot" OR OLD."TotalPriceCreditsSnapshot"<>NEW."TotalPriceCreditsSnapshot" OR OLD."AllocationIdempotencyHash"<>NEW."AllocationIdempotencyHash" OR OLD."AllocationRequestHash"<>NEW."AllocationRequestHash" OR OLD."CreatedBy"<>NEW."CreatedBy" OR OLD."ConfirmedAt"<>NEW."ConfirmedAt" OR OLD."CreatedAt"<>NEW."CreatedAt" THEN RAISE EXCEPTION 'event_ticket_entitlement_identity_immutable' USING ERRCODE='P0001'; END IF;
                  IF OLD."Status"<>'confirmed' OR NEW."Status"<>'cancelled' OR NEW."Version"<>OLD."Version"+1 THEN RAISE EXCEPTION 'event_ticket_entitlement_transition_invalid' USING ERRCODE='P0001'; END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER trg_event_ticket_entitlement_validate_update BEFORE UPDATE ON event_ticket_entitlements FOR EACH ROW EXECUTE FUNCTION event_ticket_entitlement_validate_update();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP FUNCTION IF EXISTS event_ticket_entitlement_validate_update() CASCADE;
                DROP FUNCTION IF EXISTS event_ticket_entitlement_validate_insert() CASCADE;
                DROP FUNCTION IF EXISTS event_ticket_type_validate_update() CASCADE;
                DROP FUNCTION IF EXISTS event_ticket_type_validate_insert() CASCADE;
                DROP FUNCTION IF EXISTS event_ticket_no_delete() CASCADE;
                DROP FUNCTION IF EXISTS event_ticket_history_immutable() CASCADE;
                """);
            migrationBuilder.DropTable(
                name: "event_ticket_entitlement_history");

            migrationBuilder.DropTable(
                name: "event_ticket_entitlements");

            migrationBuilder.DropTable(
                name: "event_ticket_inventory_history");

            migrationBuilder.DropTable(
                name: "event_ticket_type_history");

            migrationBuilder.DropTable(
                name: "event_ticket_types");
        }
    }
}
