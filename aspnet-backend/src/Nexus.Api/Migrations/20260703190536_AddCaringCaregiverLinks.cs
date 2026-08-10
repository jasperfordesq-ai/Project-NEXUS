using System;
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCaringCaregiverLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_caregiver_links",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    CaregiverId = table.Column<int>(type: "integer", nullable: false),
                    CaredForId = table.Column<int>(type: "integer", nullable: false),
                    RelationshipType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false, defaultValue: "family"),
                    IsPrimary = table.Column<bool>(type: "boolean", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    ApprovedBy = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_caregiver_links", x => x.Id);
                    table.ForeignKey(
                        name: "FK_caring_caregiver_links_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_caregiver_links_users_CaredForId",
                        column: x => x.CaredForId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_caregiver_links_users_CaregiverId",
                        column: x => x.CaregiverId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ccl_tenant_caregiver_recipient_status_unique",
                table: "caring_caregiver_links",
                columns: new[] { "TenantId", "CaregiverId", "CaredForId", "Status" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_caring_caregiver_links_CaredForId",
                table: "caring_caregiver_links",
                column: "CaredForId");

            migrationBuilder.CreateIndex(
                name: "IX_caring_caregiver_links_CaregiverId",
                table: "caring_caregiver_links",
                column: "CaregiverId");

            migrationBuilder.CreateIndex(
                name: "IX_caring_caregiver_links_TenantId_CaredForId",
                table: "caring_caregiver_links",
                columns: new[] { "TenantId", "CaredForId" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_caregiver_links_TenantId_CaregiverId",
                table: "caring_caregiver_links",
                columns: new[] { "TenantId", "CaregiverId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_caregiver_links");
        }
    }
}
