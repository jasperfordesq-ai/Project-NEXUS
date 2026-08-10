using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventInvitationProviderEvidence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IdempotencyKey",
                table: "email_logs",
                type: "character varying(191)",
                maxLength: 191,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Provider",
                table: "email_logs",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "local");

            migrationBuilder.AddColumn<string>(
                name: "ProviderMessageId",
                table: "email_logs",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "email_logs",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_email_logs_TenantId_IdempotencyKey",
                table: "email_logs",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true,
                filter: "\"IdempotencyKey\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_email_logs_TenantId_IdempotencyKey",
                table: "email_logs");

            migrationBuilder.DropColumn(
                name: "IdempotencyKey",
                table: "email_logs");

            migrationBuilder.DropColumn(
                name: "Provider",
                table: "email_logs");

            migrationBuilder.DropColumn(
                name: "ProviderMessageId",
                table: "email_logs");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "email_logs");
        }
    }
}
