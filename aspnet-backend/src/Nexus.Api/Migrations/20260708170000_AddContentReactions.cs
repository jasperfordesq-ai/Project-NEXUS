// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations;

    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(Nexus.Api.Data.NexusDbContext))]
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260708170000_AddContentReactions")]
    public partial class AddContentReactions : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "reactions",
            columns: table => new
            {
                Id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                TenantId = table.Column<int>(type: "integer", nullable: false),
                TargetType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                TargetId = table.Column<int>(type: "integer", nullable: false),
                UserId = table.Column<int>(type: "integer", nullable: false),
                ReactionType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_reactions", x => x.Id);
                table.ForeignKey(
                    name: "FK_reactions_tenants_TenantId",
                    column: x => x.TenantId,
                    principalTable: "tenants",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_reactions_users_UserId",
                    column: x => x.UserId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_reactions_TenantId_TargetType_TargetId_ReactionType",
            table: "reactions",
            columns: new[] { "TenantId", "TargetType", "TargetId", "ReactionType" });

        migrationBuilder.CreateIndex(
            name: "IX_reactions_TenantId_UserId_TargetType_TargetId",
            table: "reactions",
            columns: new[] { "TenantId", "UserId", "TargetType", "TargetId" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_reactions_UserId",
            table: "reactions",
            column: "UserId");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "reactions");
    }
}
