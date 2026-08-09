// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Nexus.Api.Data;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(NexusDbContext))]
    [Migration("20260706120000_AddTenantInviteCodes")]
    public partial class AddTenantInviteCodes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "tenant_invite_codes",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    code = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    created_by = table.Column<int>(type: "integer", nullable: true),
                    max_uses = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    uses_count = table.Column<int>(type: "integer", nullable: false),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    note = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    last_used_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    last_used_by = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenant_invite_codes", x => x.id);
                    table.ForeignKey(
                        name: "FK_tenant_invite_codes_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tenant_invite_codes_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tenant_invite_codes_users_last_used_by",
                        column: x => x.last_used_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_tenant_invite_codes_created_by",
                table: "tenant_invite_codes",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_tenant_invite_codes_last_used_by",
                table: "tenant_invite_codes",
                column: "last_used_by");

            migrationBuilder.CreateIndex(
                name: "IX_tenant_invite_codes_tenant_id",
                table: "tenant_invite_codes",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "tenant_invite_codes_tenant_active_created_idx",
                table: "tenant_invite_codes",
                columns: new[] { "tenant_id", "is_active", "created_at" });

            migrationBuilder.CreateIndex(
                name: "tenant_invite_codes_tenant_code_unique",
                table: "tenant_invite_codes",
                columns: new[] { "tenant_id", "code" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "tenant_invite_codes");
        }
    }
}
