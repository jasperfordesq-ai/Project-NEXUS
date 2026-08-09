// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class GroupExchangeAndVolunteerWellbeingParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_group_exchanges_groups_GroupId",
                table: "group_exchanges");

            migrationBuilder.DropIndex(
                name: "IX_group_exchanges_TenantId",
                table: "group_exchanges");

            migrationBuilder.DropIndex(
                name: "IX_group_exchange_participants_GroupExchangeId",
                table: "group_exchange_participants");

            // PostgreSQL rejects a varchar(255) alteration while an overlength
            // row exists. Preserve every row and deterministically trim only the
            // portion the canonical Laravel contract cannot represent.
            migrationBuilder.Sql("""
                UPDATE "group_exchanges"
                SET "Title" = LEFT("Title", 255)
                WHERE char_length("Title") > 255;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Title",
                table: "group_exchanges",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500);

            migrationBuilder.AlterColumn<int>(
                name: "GroupId",
                table: "group_exchanges",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AddColumn<int>(
                name: "BrokerId",
                table: "group_exchanges",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BrokerNotes",
                table: "group_exchanges",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ListingId",
                table: "group_exchanges",
                type: "integer",
                nullable: true);

            // Add nullable first so existing installations can be backfilled
            // before the canonical non-null/default constraint is installed.
            migrationBuilder.AddColumn<string>(
                name: "SplitType",
                table: "group_exchanges",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "group_exchange_participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Weight",
                table: "group_exchange_participants",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                defaultValue: 1m);

            // Laravel's group-exchange safeguarding gate reads a denormalized
            // broker-approval flag from the active monitoring row before it
            // evaluates preference-derived vetting rules.
            migrationBuilder.AddColumn<bool>(
                name: "RequiresBrokerApproval",
                table: "user_monitoring_restrictions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql("""
                UPDATE "group_exchanges"
                SET "Status" = CASE
                    WHEN "Status" = 'pending' THEN 'pending_participants'
                    WHEN "Status" = 'approved' THEN 'active'
                    ELSE "Status"
                END
                WHERE "Status" IN ('pending', 'approved');

                UPDATE "group_exchanges"
                SET "SplitType" = 'equal'
                WHERE "SplitType" IS NULL OR btrim("SplitType") = '';
                """);

            migrationBuilder.AlterColumn<string>(
                name: "SplitType",
                table: "group_exchanges",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "equal",
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20,
                oldNullable: true);

            // MySQL enums in the canonical Laravel schema are represented as
            // PostgreSQL CHECK constraints. Unknown legacy values must stop the
            // migration for operator review; silently coercing them would change
            // exchange state or settlement semantics.
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM "group_exchanges"
                        WHERE "Status" NOT IN (
                            'draft', 'pending_participants', 'pending_broker', 'active',
                            'pending_confirmation', 'completed', 'cancelled', 'disputed')) THEN
                        RAISE EXCEPTION
                            'Cannot install CK_group_exchanges_Status: non-canonical status values exist.';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM "group_exchanges"
                        WHERE "SplitType" NOT IN ('equal', 'custom', 'weighted')) THEN
                        RAISE EXCEPTION
                            'Cannot install CK_group_exchanges_SplitType: non-canonical split values exist.';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM "group_exchange_participants"
                        WHERE "Role" NOT IN ('provider', 'receiver')) THEN
                        RAISE EXCEPTION
                            'Cannot install CK_group_exchange_participants_Role: non-canonical roles exist.';
                    END IF;
                END $$;
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_group_exchanges_Status",
                table: "group_exchanges",
                sql: "\"Status\" IN ('draft', 'pending_participants', 'pending_broker', 'active', 'pending_confirmation', 'completed', 'cancelled', 'disputed')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_group_exchanges_SplitType",
                table: "group_exchanges",
                sql: "\"SplitType\" IN ('equal', 'custom', 'weighted')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_group_exchange_participants_Role",
                table: "group_exchange_participants",
                sql: "\"Role\" IN ('provider', 'receiver')");

            // The canonical key is (exchange,user,role). Keep the oldest legacy
            // row in each duplicate set before creating the unique index.
            migrationBuilder.Sql("""
                DELETE FROM "group_exchange_participants" AS duplicate
                USING "group_exchange_participants" AS keeper
                WHERE duplicate."GroupExchangeId" = keeper."GroupExchangeId"
                  AND duplicate."UserId" = keeper."UserId"
                  AND duplicate."Role" = keeper."Role"
                  AND duplicate."Id" > keeper."Id";
                """);

            migrationBuilder.CreateTable(
                name: "vol_wellbeing_alerts",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    risk_level = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "moderate"),
                    risk_score = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false, defaultValue: 0m),
                    indicators = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'{}'::jsonb"),
                    coordinator_notified = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    coordinator_notes = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "active"),
                    resolved_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vol_wellbeing_alerts", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_group_exchanges_TenantId_CreatedById",
                table: "group_exchanges",
                columns: new[] { "TenantId", "CreatedById" });

            migrationBuilder.CreateIndex(
                name: "IX_group_exchanges_TenantId_Status",
                table: "group_exchanges",
                columns: new[] { "TenantId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_group_exchange_participants_GroupExchangeId_UserId_Role",
                table: "group_exchange_participants",
                columns: new[] { "GroupExchangeId", "UserId", "Role" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_vol_wellbeing_alerts_risk_level_status",
                table: "vol_wellbeing_alerts",
                columns: new[] { "risk_level", "status" });

            migrationBuilder.CreateIndex(
                name: "idx_vol_wellbeing_alerts_tenant_status",
                table: "vol_wellbeing_alerts",
                columns: new[] { "tenant_id", "status" });

            migrationBuilder.CreateIndex(
                name: "idx_vol_wellbeing_alerts_tenant_user",
                table: "vol_wellbeing_alerts",
                columns: new[] { "tenant_id", "user_id" });

            migrationBuilder.AddForeignKey(
                name: "FK_group_exchanges_groups_GroupId",
                table: "group_exchanges",
                column: "GroupId",
                principalTable: "groups",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_group_exchange_participants_Role",
                table: "group_exchange_participants");

            migrationBuilder.DropCheckConstraint(
                name: "CK_group_exchanges_SplitType",
                table: "group_exchanges");

            migrationBuilder.DropCheckConstraint(
                name: "CK_group_exchanges_Status",
                table: "group_exchanges");

            migrationBuilder.DropForeignKey(
                name: "FK_group_exchanges_groups_GroupId",
                table: "group_exchanges");

            migrationBuilder.DropTable(
                name: "vol_wellbeing_alerts");

            migrationBuilder.DropIndex(
                name: "IX_group_exchanges_TenantId_CreatedById",
                table: "group_exchanges");

            migrationBuilder.DropIndex(
                name: "IX_group_exchanges_TenantId_Status",
                table: "group_exchanges");

            migrationBuilder.DropIndex(
                name: "IX_group_exchange_participants_GroupExchangeId_UserId_Role",
                table: "group_exchange_participants");

            migrationBuilder.DropColumn(
                name: "BrokerId",
                table: "group_exchanges");

            migrationBuilder.DropColumn(
                name: "BrokerNotes",
                table: "group_exchanges");

            migrationBuilder.DropColumn(
                name: "ListingId",
                table: "group_exchanges");

            migrationBuilder.DropColumn(
                name: "SplitType",
                table: "group_exchanges");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "group_exchange_participants");

            migrationBuilder.DropColumn(
                name: "Weight",
                table: "group_exchange_participants");

            migrationBuilder.DropColumn(
                name: "RequiresBrokerApproval",
                table: "user_monitoring_restrictions");

            migrationBuilder.AlterColumn<string>(
                name: "Title",
                table: "group_exchanges",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255);

            // GroupId intentionally remains nullable on rollback: canonical
            // tenant-wide exchanges have no safe legacy group to backfill.
            // Requiring NOT NULL or inventing GroupId=0 would either lose data
            // or violate the foreign key.
            migrationBuilder.CreateIndex(
                name: "IX_group_exchanges_TenantId",
                table: "group_exchanges",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_group_exchange_participants_GroupExchangeId",
                table: "group_exchange_participants",
                column: "GroupExchangeId");

            migrationBuilder.AddForeignKey(
                name: "FK_group_exchanges_groups_GroupId",
                table: "group_exchanges",
                column: "GroupId",
                principalTable: "groups",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            // Status backfills and duplicate removal are deliberately not
            // reversed because doing so would overwrite legitimate lifecycle
            // changes or recreate ambiguous participant rows.
        }
    }
}
