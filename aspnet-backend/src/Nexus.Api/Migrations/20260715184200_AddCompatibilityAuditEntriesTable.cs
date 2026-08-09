// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Nexus.Api.Data;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations;

/// <inheritdoc />
[DbContext(typeof(NexusDbContext))]
[Migration("20260715184200_AddCompatibilityAuditEntriesTable")]
public partial class AddCompatibilityAuditEntriesTable : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "compatibility_audit_entries",
            columns: table => new
            {
                Id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                TenantId = table.Column<int>(type: "integer", nullable: false),
                UserId = table.Column<int>(type: "integer", nullable: true),
                Endpoint = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                HttpMethod = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                Action = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                RequestBody = table.Column<string>(type: "jsonb", nullable: false),
                ResponseBody = table.Column<string>(type: "jsonb", nullable: false),
                StatusCode = table.Column<int>(type: "integer", nullable: false),
                OccurredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_compatibility_audit_entries", x => x.Id);
                table.ForeignKey(
                    name: "FK_compatibility_audit_entries_tenants_TenantId",
                    column: x => x.TenantId,
                    principalTable: "tenants",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_compatibility_audit_entries_users_UserId",
                    column: x => x.UserId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.SetNull);
            });

        migrationBuilder.CreateIndex(
            name: "IX_compatibility_audit_entries_OccurredAt",
            table: "compatibility_audit_entries",
            column: "OccurredAt");

        migrationBuilder.CreateIndex(
            name: "IX_compatibility_audit_entries_TenantId",
            table: "compatibility_audit_entries",
            column: "TenantId");

        migrationBuilder.CreateIndex(
            name: "IX_compatibility_audit_entries_UserId",
            table: "compatibility_audit_entries",
            column: "UserId");

        migrationBuilder.CreateIndex(
            name: "IX_compatibility_audit_entries_TenantId_Endpoint",
            table: "compatibility_audit_entries",
            columns: new[] { "TenantId", "Endpoint" });
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "compatibility_audit_entries");
    }
}
