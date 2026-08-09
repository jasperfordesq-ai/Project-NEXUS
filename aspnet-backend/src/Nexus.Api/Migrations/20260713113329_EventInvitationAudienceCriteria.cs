using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventInvitationAudienceCriteria : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_approved",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "preferred_language",
                table: "users",
                type: "character varying(5)",
                maxLength: 5,
                nullable: false,
                defaultValue: "en");

            migrationBuilder.Sql("""
                UPDATE users
                SET is_approved = TRUE
                WHERE "IsActive" = TRUE
                  AND "RegistrationStatus" = 'Active';
                """);

            migrationBuilder.CreateIndex(
                name: "idx_users_created_tenant",
                table: "users",
                columns: new[] { "TenantId", "is_approved", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "idx_users_created_tenant",
                table: "users");

            migrationBuilder.DropColumn(
                name: "is_approved",
                table: "users");

            migrationBuilder.DropColumn(
                name: "preferred_language",
                table: "users");
        }
    }
}
