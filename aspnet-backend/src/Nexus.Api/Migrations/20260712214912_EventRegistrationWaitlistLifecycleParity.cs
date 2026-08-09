using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventRegistrationWaitlistLifecycleParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "idx_event_waitlist_audience",
                table: "event_waitlist_entries");

            migrationBuilder.DropIndex(
                name: "uq_event_waitlist_user",
                table: "event_waitlist_entries");

            migrationBuilder.DropIndex(
                name: "idx_event_registration_audience",
                table: "event_registrations");

            migrationBuilder.DropIndex(
                name: "uq_event_registration_user",
                table: "event_registrations");

            migrationBuilder.AlterColumn<string>(
                name: "QueueState",
                table: "event_waitlist_entries",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(24)",
                oldMaxLength: 24);

            migrationBuilder.AddColumn<DateTime>(
                name: "AcceptedAt",
                table: "event_waitlist_entries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "AcceptedRegistrationId",
                table: "event_waitlist_entries",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AllocationKey",
                table: "event_waitlist_entries",
                type: "character varying(191)",
                maxLength: 191,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CancelledAt",
                table: "event_waitlist_entries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CapacityPoolKey",
                table: "event_waitlist_entries",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "ExpiredAt",
                table: "event_waitlist_entries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OfferTokenHash",
                table: "event_waitlist_entries",
                type: "character(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "OfferTokenUsedAt",
                table: "event_waitlist_entries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "OfferedAt",
                table: "event_waitlist_entries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "QueueSequence",
                table: "event_waitlist_entries",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "QueueVersion",
                table: "event_waitlist_entries",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTime>(
                name: "StateChangedAt",
                table: "event_waitlist_entries",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<int>(
                name: "StateChangedBy",
                table: "event_waitlist_entries",
                type: "integer",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "RegistrationState",
                table: "event_registrations",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(24)",
                oldMaxLength: 24);

            migrationBuilder.AddColumn<string>(
                name: "AllocationKey",
                table: "event_registrations",
                type: "character varying(191)",
                maxLength: 191,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CancelledAt",
                table: "event_registrations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CapacityPoolKey",
                table: "event_registrations",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "ConfirmedAt",
                table: "event_registrations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeclinedAt",
                table: "event_registrations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "InvitedAt",
                table: "event_registrations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PendingAt",
                table: "event_registrations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "RegistrationVersion",
                table: "event_registrations",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTime>(
                name: "StateChangedAt",
                table: "event_registrations",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<int>(
                name: "StateChangedBy",
                table: "event_registrations",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "event_registration_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    RegistrationId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: true),
                    CapacityPoolKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    AllocationKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: true),
                    RegistrationVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    FromState = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    ToState = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: true),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_waitlist_entry_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    WaitlistEntryId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: true),
                    CapacityPoolKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    AllocationKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: true),
                    QueueVersion = table.Column<long>(type: "bigint", nullable: false),
                    QueueSequence = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    FromState = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    ToState = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: true),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_waitlist_entry_history", x => x.Id);
                });

            migrationBuilder.Sql("""
                UPDATE event_registrations
                SET "CapacityPoolKey" = 'event',
                    "RegistrationVersion" = 1,
                    "StateChangedAt" = COALESCE("UpdatedAt", "CreatedAt", NOW()),
                    "ConfirmedAt" = CASE WHEN "RegistrationState" = 'confirmed' THEN COALESCE("UpdatedAt", "CreatedAt", NOW()) ELSE NULL END,
                    "CancelledAt" = CASE WHEN "RegistrationState" = 'cancelled' THEN COALESCE("UpdatedAt", "CreatedAt", NOW()) ELSE NULL END;
                ALTER TABLE event_registrations ALTER COLUMN "CapacityPoolKey" SET DEFAULT 'event';
                ALTER TABLE event_registrations ALTER COLUMN "RegistrationVersion" SET DEFAULT 1;

                WITH ranked AS (
                    SELECT "Id", ROW_NUMBER() OVER (PARTITION BY "TenantId", "EventId" ORDER BY "CreatedAt", "Id") AS sequence
                    FROM event_waitlist_entries
                )
                UPDATE event_waitlist_entries target
                SET "CapacityPoolKey" = 'event',
                    "QueueVersion" = 1,
                    "QueueSequence" = ranked.sequence,
                    "StateChangedAt" = COALESCE(target."UpdatedAt", target."CreatedAt", NOW())
                FROM ranked WHERE target."Id" = ranked."Id";
                ALTER TABLE event_waitlist_entries ALTER COLUMN "CapacityPoolKey" SET DEFAULT 'event';
                ALTER TABLE event_waitlist_entries ALTER COLUMN "QueueVersion" SET DEFAULT 1;
                """);

            migrationBuilder.CreateIndex(
                name: "idx_event_waitlist_expiry",
                table: "event_waitlist_entries",
                columns: new[] { "QueueState", "OfferExpiresAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_waitlist_queue",
                table: "event_waitlist_entries",
                columns: new[] { "TenantId", "EventId", "CapacityPoolKey", "QueueState", "QueueSequence", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_waitlist_user",
                table: "event_waitlist_entries",
                columns: new[] { "TenantId", "UserId", "QueueState", "EventId" });

            migrationBuilder.CreateIndex(
                name: "uq_event_waitlist_entry_sequence",
                table: "event_waitlist_entries",
                columns: new[] { "TenantId", "EventId", "CapacityPoolKey", "QueueSequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_waitlist_entry_subject",
                table: "event_waitlist_entries",
                columns: new[] { "TenantId", "EventId", "UserId", "CapacityPoolKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_waitlist_offer_token",
                table: "event_waitlist_entries",
                column: "OfferTokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_registration_capacity",
                table: "event_registrations",
                columns: new[] { "TenantId", "EventId", "CapacityPoolKey", "RegistrationState", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_registration_user",
                table: "event_registrations",
                columns: new[] { "TenantId", "UserId", "RegistrationState", "EventId" });

            migrationBuilder.CreateIndex(
                name: "uq_event_registration_subject",
                table: "event_registrations",
                columns: new[] { "TenantId", "EventId", "UserId", "CapacityPoolKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_registration_history_event",
                table: "event_registration_history",
                columns: new[] { "TenantId", "EventId", "CapacityPoolKey", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_registration_history_user",
                table: "event_registration_history",
                columns: new[] { "TenantId", "UserId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_registration_history_key",
                table: "event_registration_history",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_registration_history_version",
                table: "event_registration_history",
                columns: new[] { "TenantId", "RegistrationId", "RegistrationVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_waitlist_history_event",
                table: "event_waitlist_entry_history",
                columns: new[] { "TenantId", "EventId", "CapacityPoolKey", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_waitlist_history_user",
                table: "event_waitlist_entry_history",
                columns: new[] { "TenantId", "UserId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_waitlist_history_key",
                table: "event_waitlist_entry_history",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_waitlist_history_version",
                table: "event_waitlist_entry_history",
                columns: new[] { "TenantId", "WaitlistEntryId", "QueueVersion" },
                unique: true);

            migrationBuilder.Sql("""
                ALTER TABLE event_registrations DROP CONSTRAINT IF EXISTS chk_event_registration_state;
                ALTER TABLE event_waitlist_entries DROP CONSTRAINT IF EXISTS chk_event_waitlist_state;
                ALTER TABLE event_registrations ADD CONSTRAINT chk_event_registration_state_v2 CHECK ("RegistrationState" IN ('invited','pending','confirmed','declined','cancelled'));
                ALTER TABLE event_waitlist_entries ADD CONSTRAINT chk_event_waitlist_state_v2 CHECK ("QueueState" IN ('waiting','offered','accepted','expired','cancelled'));
                ALTER TABLE event_registrations ADD CONSTRAINT chk_event_registration_version CHECK ("RegistrationVersion" >= 1);
                ALTER TABLE event_waitlist_entries ADD CONSTRAINT chk_event_waitlist_version CHECK ("QueueVersion" >= 1 AND "QueueSequence" >= 1);

                CREATE OR REPLACE FUNCTION event_participation_history_immutable() RETURNS trigger AS $guard$
                BEGIN RAISE EXCEPTION 'event_participation_history_immutable'; END;
                $guard$ LANGUAGE plpgsql;
                CREATE TRIGGER trg_event_registration_history_no_update BEFORE UPDATE ON event_registration_history FOR EACH ROW EXECUTE FUNCTION event_participation_history_immutable();
                CREATE TRIGGER trg_event_registration_history_no_delete BEFORE DELETE ON event_registration_history FOR EACH ROW EXECUTE FUNCTION event_participation_history_immutable();
                CREATE TRIGGER trg_event_waitlist_history_no_update BEFORE UPDATE ON event_waitlist_entry_history FOR EACH ROW EXECUTE FUNCTION event_participation_history_immutable();
                CREATE TRIGGER trg_event_waitlist_history_no_delete BEFORE DELETE ON event_waitlist_entry_history FOR EACH ROW EXECUTE FUNCTION event_participation_history_immutable();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $guard$ BEGIN
                    IF EXISTS (SELECT 1 FROM event_registration_history LIMIT 1)
                       OR EXISTS (SELECT 1 FROM event_waitlist_entry_history LIMIT 1) THEN
                        RAISE EXCEPTION 'event_registration_waitlist_rollback_refused_evidence_exists';
                    END IF;
                END $guard$;
                DROP FUNCTION IF EXISTS event_participation_history_immutable() CASCADE;
                """);
            migrationBuilder.DropTable(
                name: "event_registration_history");

            migrationBuilder.DropTable(
                name: "event_waitlist_entry_history");

            migrationBuilder.DropIndex(
                name: "idx_event_waitlist_expiry",
                table: "event_waitlist_entries");

            migrationBuilder.DropIndex(
                name: "idx_event_waitlist_queue",
                table: "event_waitlist_entries");

            migrationBuilder.DropIndex(
                name: "idx_event_waitlist_user",
                table: "event_waitlist_entries");

            migrationBuilder.DropIndex(
                name: "uq_event_waitlist_entry_sequence",
                table: "event_waitlist_entries");

            migrationBuilder.DropIndex(
                name: "uq_event_waitlist_entry_subject",
                table: "event_waitlist_entries");

            migrationBuilder.DropIndex(
                name: "uq_event_waitlist_offer_token",
                table: "event_waitlist_entries");

            migrationBuilder.DropIndex(
                name: "idx_event_registration_capacity",
                table: "event_registrations");

            migrationBuilder.DropIndex(
                name: "idx_event_registration_user",
                table: "event_registrations");

            migrationBuilder.DropIndex(
                name: "uq_event_registration_subject",
                table: "event_registrations");

            migrationBuilder.DropColumn(
                name: "AcceptedAt",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "AcceptedRegistrationId",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "AllocationKey",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "CancelledAt",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "CapacityPoolKey",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "ExpiredAt",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "OfferTokenHash",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "OfferTokenUsedAt",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "OfferedAt",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "QueueSequence",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "QueueVersion",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "StateChangedAt",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "StateChangedBy",
                table: "event_waitlist_entries");

            migrationBuilder.DropColumn(
                name: "AllocationKey",
                table: "event_registrations");

            migrationBuilder.DropColumn(
                name: "CancelledAt",
                table: "event_registrations");

            migrationBuilder.DropColumn(
                name: "CapacityPoolKey",
                table: "event_registrations");

            migrationBuilder.DropColumn(
                name: "ConfirmedAt",
                table: "event_registrations");

            migrationBuilder.DropColumn(
                name: "DeclinedAt",
                table: "event_registrations");

            migrationBuilder.DropColumn(
                name: "InvitedAt",
                table: "event_registrations");

            migrationBuilder.DropColumn(
                name: "PendingAt",
                table: "event_registrations");

            migrationBuilder.DropColumn(
                name: "RegistrationVersion",
                table: "event_registrations");

            migrationBuilder.DropColumn(
                name: "StateChangedAt",
                table: "event_registrations");

            migrationBuilder.DropColumn(
                name: "StateChangedBy",
                table: "event_registrations");

            migrationBuilder.AlterColumn<string>(
                name: "QueueState",
                table: "event_waitlist_entries",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32);

            migrationBuilder.AlterColumn<string>(
                name: "RegistrationState",
                table: "event_registrations",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32);

            migrationBuilder.CreateIndex(
                name: "idx_event_waitlist_audience",
                table: "event_waitlist_entries",
                columns: new[] { "TenantId", "EventId", "QueueState", "OfferExpiresAt", "UserId" });

            migrationBuilder.CreateIndex(
                name: "uq_event_waitlist_user",
                table: "event_waitlist_entries",
                columns: new[] { "TenantId", "EventId", "UserId" },
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
        }
    }
}
