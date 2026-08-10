using Microsoft.EntityFrameworkCore.Migrations;

// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class RecurringShiftGenerationParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RecurringShiftPatterns_TenantId",
                table: "RecurringShiftPatterns");

            // Never guess which historical duplicate to retain: generated
            // shifts can already carry check-ins, reservations, waitlist, or
            // application history. Stop with an actionable error instead.
            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_shifts
                        WHERE "RecurringPatternId" IS NOT NULL
                        GROUP BY "TenantId", "RecurringPatternId", "StartsAt"
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION
                            'RecurringShiftGenerationParity cannot add the occurrence uniqueness constraint because duplicate recurring shifts exist. Reconcile linked history before retrying.';
                    END IF;
                END $$;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_shifts_TenantId_RecurringPatternId_StartsAt",
                table: "volunteer_shifts",
                columns: new[] { "TenantId", "RecurringPatternId", "StartsAt" },
                unique: true,
                filter: "\"RecurringPatternId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringShiftPatterns_TenantId_IsActive_EndDate",
                table: "RecurringShiftPatterns",
                columns: new[] { "TenantId", "IsActive", "EndDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_volunteer_shifts_TenantId_RecurringPatternId_StartsAt",
                table: "volunteer_shifts");

            migrationBuilder.DropIndex(
                name: "IX_RecurringShiftPatterns_TenantId_IsActive_EndDate",
                table: "RecurringShiftPatterns");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringShiftPatterns_TenantId",
                table: "RecurringShiftPatterns",
                column: "TenantId");
        }
    }
}
