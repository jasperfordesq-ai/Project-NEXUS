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
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(Nexus.Api.Data.NexusDbContext))]
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704220000_AddVereinFederationConsents")]
    public partial class AddVereinFederationConsents : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "verein_federation_consents",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    organization_id = table.Column<int>(type: "integer", nullable: false),
                    sharing_scope = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "none"),
                    municipality_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    opted_in_by_admin_id = table.Column<int>(type: "integer", nullable: true),
                    opted_in_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_verein_federation_consents", x => x.id);
                    table.ForeignKey(
                        name: "FK_verein_federation_consents_organisations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_federation_consents_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_federation_consents_users_opted_in_by_admin_id",
                        column: x => x.opted_in_by_admin_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "verein_fed_consent_org_unique",
                table: "verein_federation_consents",
                column: "organization_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "verein_fed_consent_lookup_idx",
                table: "verein_federation_consents",
                columns: new[] { "tenant_id", "municipality_code", "is_active" });

            migrationBuilder.CreateIndex(
                name: "IX_verein_federation_consents_opted_in_by_admin_id",
                table: "verein_federation_consents",
                column: "opted_in_by_admin_id");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "verein_federation_consents");
        }
    }
}
