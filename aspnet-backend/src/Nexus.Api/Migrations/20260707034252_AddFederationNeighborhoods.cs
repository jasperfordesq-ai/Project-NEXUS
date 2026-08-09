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
    public partial class AddFederationNeighborhoods : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "federation_neighborhoods",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    region = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    created_by = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federation_neighborhoods", x => x.id);
                    table.ForeignKey(
                        name: "FK_federation_neighborhoods_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "federation_neighborhood_tenants",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    neighborhood_id = table.Column<int>(type: "integer", nullable: false),
                    tenant_id = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federation_neighborhood_tenants", x => x.id);
                    table.ForeignKey(
                        name: "FK_federation_neighborhood_tenants_federation_neighborhoods~",
                        column: x => x.neighborhood_id,
                        principalTable: "federation_neighborhoods",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_federation_neighborhood_tenants_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "federation_neighborhoods_name_idx",
                table: "federation_neighborhoods",
                column: "name");

            migrationBuilder.CreateIndex(
                name: "IX_federation_neighborhoods_created_by",
                table: "federation_neighborhoods",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "federation_neighborhood_tenants_neighborhood_idx",
                table: "federation_neighborhood_tenants",
                column: "neighborhood_id");

            migrationBuilder.CreateIndex(
                name: "federation_neighborhood_tenants_tenant_idx",
                table: "federation_neighborhood_tenants",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "federation_neighborhood_tenants_unique",
                table: "federation_neighborhood_tenants",
                columns: new[] { "neighborhood_id", "tenant_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "federation_neighborhood_tenants");

            migrationBuilder.DropTable(
                name: "federation_neighborhoods");
        }
    }
}
