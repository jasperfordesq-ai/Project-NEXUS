using Microsoft.EntityFrameworkCore.Migrations;

using System;

// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class GuardianConsentLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $$
                DECLARE guardian_fk text;
                BEGIN
                    FOR guardian_fk IN
                        SELECT constraint_row.conname
                        FROM pg_constraint constraint_row
                        WHERE constraint_row.conrelid = 'volunteer_guardian_consents'::regclass
                          AND constraint_row.confrelid = 'users'::regclass
                          AND constraint_row.contype = 'f'
                          AND pg_get_constraintdef(constraint_row.oid)
                              LIKE 'FOREIGN KEY ("MinorUserId")%'
                    LOOP
                        EXECUTE format(
                            'ALTER TABLE volunteer_guardian_consents DROP CONSTRAINT %I',
                            guardian_fk);
                    END LOOP;
                END $$;
                """);

            // Converge legacy ASP.NET vocabulary and incomplete historical
            // rows before the canonical required relationship is enforced.
            migrationBuilder.Sql(
                """
                UPDATE volunteer_guardian_consents
                SET "GuardianRelationship" = 'guardian'
                WHERE "GuardianRelationship" IS NULL
                   OR btrim("GuardianRelationship") = '';

                UPDATE volunteer_guardian_consents
                SET "Status" = CASE lower("Status")
                    WHEN 'pending' THEN 'Pending'
                    WHEN 'granted' THEN 'Active'
                    WHEN 'active' THEN 'Active'
                    WHEN 'revoked' THEN 'Withdrawn'
                    WHEN 'rejected' THEN 'Withdrawn'
                    WHEN 'withdrawn' THEN 'Withdrawn'
                    WHEN 'expired' THEN 'Expired'
                    ELSE 'Expired'
                END;

                DELETE FROM volunteer_guardian_consents consent
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM users minor
                    WHERE minor."Id" = consent."MinorUserId"
                );
                """);

            migrationBuilder.AlterColumn<string>(
                name: "GuardianRelationship",
                table: "volunteer_guardian_consents",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "GuardianName",
                table: "volunteer_guardian_consents",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200);

            migrationBuilder.AddColumn<string>(
                name: "ConsentIp",
                table: "volunteer_guardian_consents",
                type: "character varying(45)",
                maxLength: 45,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ConsentTokenHash",
                table: "volunteer_guardian_consents",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GuardianPhone",
                table: "volunteer_guardian_consents",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            // Pending and admin-granted rows created by the retired workflow
            // have no guardian-held credential and cannot prove consent. Expire
            // them so safeguarding never grandfathers an unverifiable bypass.
            migrationBuilder.Sql(
                """
                UPDATE volunteer_guardian_consents
                SET "Status" = 'Expired',
                    "UpdatedAt" = COALESCE("UpdatedAt", CURRENT_TIMESTAMP)
                WHERE "Status" IN ('Pending', 'Active')
                  AND "ConsentTokenHash" IS NULL;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_guardian_consents_ConsentTokenHash",
                table: "volunteer_guardian_consents",
                column: "ConsentTokenHash",
                unique: true,
                filter: "\"ConsentTokenHash\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_guardian_consents_TenantId_MinorUserId_Id",
                table: "volunteer_guardian_consents",
                columns: new[] { "TenantId", "MinorUserId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_guardian_consents_TenantId_Status_Id",
                table: "volunteer_guardian_consents",
                columns: new[] { "TenantId", "Status", "Id" });

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_guardian_consents_users_MinorUserId",
                table: "volunteer_guardian_consents",
                column: "MinorUserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException(
                "GuardianConsentLifecycle is intentionally irreversible because dropping hashed verification credentials and restoring legacy status semantics would invalidate consent history.");
        }
    }
}
