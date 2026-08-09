using Microsoft.EntityFrameworkCore.Migrations;

// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class RecurringShiftPatternCrudParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SpotsPerShift",
                table: "RecurringShiftPatterns",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            // CreatedBy was historically an unbound scalar while a nullable
            // shadow CreatorId carried the navigation FK. Never guess which
            // owner is correct: abort atomically if the legacy columns diverge
            // or if CreatedBy cannot become a tenant-safe required FK.
            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM "RecurringShiftPatterns" p
                        WHERE p."CreatorId" IS NOT NULL
                          AND p."CreatorId" <> p."CreatedBy"
                    ) THEN
                        RAISE EXCEPTION 'RecurringShiftPatterns ownership migration aborted: CreatorId differs from CreatedBy.';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM "RecurringShiftPatterns" p
                        WHERE NOT EXISTS (
                            SELECT 1 FROM users u WHERE u."Id" = p."CreatedBy"
                        )
                    ) THEN
                        RAISE EXCEPTION 'RecurringShiftPatterns ownership migration aborted: CreatedBy user is missing.';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM "RecurringShiftPatterns" p
                        JOIN users u ON u."Id" = p."CreatedBy"
                        WHERE u."TenantId" <> p."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'RecurringShiftPatterns ownership migration aborted: CreatedBy belongs to another tenant.';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM "RecurringShiftPatterns" p
                        WHERE p."Capacity" < 0
                           OR p."MaxOccurrences" < 0
                           OR p."OccurrencesGenerated" < 0
                    ) THEN
                        RAISE EXCEPTION 'RecurringShiftPatterns unsigned-field migration aborted: negative values require manual reconciliation.';
                    END IF;
                END $$;
                """);

            migrationBuilder.Sql(
                """
                UPDATE "RecurringShiftPatterns"
                SET "Capacity" = 1
                WHERE "Capacity" IS NULL;
                """);

            migrationBuilder.AlterColumn<int>(
                name: "Capacity",
                table: "RecurringShiftPatterns",
                type: "integer",
                nullable: false,
                defaultValue: 1,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);

            migrationBuilder.DropForeignKey(
                name: "FK_RecurringShiftPatterns_users_CreatorId",
                table: "RecurringShiftPatterns");

            migrationBuilder.DropIndex(
                name: "IX_RecurringShiftPatterns_CreatorId",
                table: "RecurringShiftPatterns");

            migrationBuilder.DropColumn(
                name: "CreatorId",
                table: "RecurringShiftPatterns");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringShiftPatterns_CreatedBy",
                table: "RecurringShiftPatterns",
                column: "CreatedBy");

            migrationBuilder.AddForeignKey(
                name: "FK_RecurringShiftPatterns_users_CreatedBy",
                table: "RecurringShiftPatterns",
                column: "CreatedBy",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddCheckConstraint(
                name: "CK_RecurringShiftPatterns_SpotsPerShift_NonNegative",
                table: "RecurringShiftPatterns",
                sql: "\"SpotsPerShift\" >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_RecurringShiftPatterns_Capacity_NonNegative",
                table: "RecurringShiftPatterns",
                sql: "\"Capacity\" >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_RecurringShiftPatterns_MaxOccurrences_NonNegative",
                table: "RecurringShiftPatterns",
                sql: "\"MaxOccurrences\" IS NULL OR \"MaxOccurrences\" >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_RecurringShiftPatterns_OccurrencesGenerated_NonNegative",
                table: "RecurringShiftPatterns",
                sql: "\"OccurrencesGenerated\" >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_RecurringShiftPatterns_SpotsPerShift_NonNegative",
                table: "RecurringShiftPatterns");

            migrationBuilder.DropCheckConstraint(
                name: "CK_RecurringShiftPatterns_Capacity_NonNegative",
                table: "RecurringShiftPatterns");

            migrationBuilder.DropCheckConstraint(
                name: "CK_RecurringShiftPatterns_MaxOccurrences_NonNegative",
                table: "RecurringShiftPatterns");

            migrationBuilder.DropCheckConstraint(
                name: "CK_RecurringShiftPatterns_OccurrencesGenerated_NonNegative",
                table: "RecurringShiftPatterns");

            migrationBuilder.DropForeignKey(
                name: "FK_RecurringShiftPatterns_users_CreatedBy",
                table: "RecurringShiftPatterns");

            migrationBuilder.DropIndex(
                name: "IX_RecurringShiftPatterns_CreatedBy",
                table: "RecurringShiftPatterns");

            migrationBuilder.AddColumn<int>(
                name: "CreatorId",
                table: "RecurringShiftPatterns",
                type: "integer",
                nullable: true);

            migrationBuilder.Sql(
                """
                UPDATE "RecurringShiftPatterns"
                SET "CreatorId" = "CreatedBy";
                """);

            migrationBuilder.CreateIndex(
                name: "IX_RecurringShiftPatterns_CreatorId",
                table: "RecurringShiftPatterns",
                column: "CreatorId");

            migrationBuilder.AddForeignKey(
                name: "FK_RecurringShiftPatterns_users_CreatorId",
                table: "RecurringShiftPatterns",
                column: "CreatorId",
                principalTable: "users",
                principalColumn: "Id");

            migrationBuilder.DropColumn(
                name: "SpotsPerShift",
                table: "RecurringShiftPatterns");

            migrationBuilder.AlterColumn<int>(
                name: "Capacity",
                table: "RecurringShiftPatterns",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer",
                oldDefaultValue: 1);
        }
    }
}
