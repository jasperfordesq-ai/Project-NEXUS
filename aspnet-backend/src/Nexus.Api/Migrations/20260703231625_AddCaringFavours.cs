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
    public partial class AddCaringFavours : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_favours",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    offered_by_user_id = table.Column<int>(type: "integer", nullable: false),
                    received_by_user_id = table.Column<int>(type: "integer", nullable: true),
                    category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    description = table.Column<string>(type: "text", nullable: false),
                    favour_date = table.Column<DateOnly>(type: "date", nullable: false),
                    is_anonymous = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    deleted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_favours", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_favours_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_favours_users_offered_by_user_id",
                        column: x => x.offered_by_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_favours_users_received_by_user_id",
                        column: x => x.received_by_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "caring_favours_tenant_received_idx",
                table: "caring_favours",
                columns: new[] { "tenant_id", "received_by_user_id" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_favours_offered_by_user_id",
                table: "caring_favours",
                column: "offered_by_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_favours_received_by_user_id",
                table: "caring_favours",
                column: "received_by_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_favours_tenant_id_favour_date",
                table: "caring_favours",
                columns: new[] { "tenant_id", "favour_date" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_favours_tenant_id_offered_by_user_id",
                table: "caring_favours",
                columns: new[] { "tenant_id", "offered_by_user_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_favours");
        }
    }
}
