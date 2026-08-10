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
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(Nexus.Api.Data.NexusDbContext))]
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704053000_AddCaringSmartNudges")]
    public partial class AddCaringSmartNudges : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_smart_nudges",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    target_user_id = table.Column<int>(type: "integer", nullable: false),
                    related_user_id = table.Column<int>(type: "integer", nullable: true),
                    source_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false, defaultValue: "tandem_candidate"),
                    dispatch_key = table.Column<string>(type: "character varying(96)", maxLength: 96, nullable: true),
                    score = table.Column<decimal>(type: "numeric(5,3)", precision: 5, scale: 3, nullable: false, defaultValue: 0m),
                    signals = table.Column<string>(type: "jsonb", nullable: true),
                    notification_id = table.Column<long>(type: "bigint", nullable: true),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "sent"),
                    sent_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    converted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_smart_nudges", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_smart_nudges_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_smart_nudges_users_related_user_id",
                        column: x => x.related_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_smart_nudges_users_target_user_id",
                        column: x => x.target_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "caring_nudges_related_sent_idx",
                table: "caring_smart_nudges",
                columns: new[] { "tenant_id", "related_user_id", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "caring_nudges_status_sent_idx",
                table: "caring_smart_nudges",
                columns: new[] { "tenant_id", "status", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "caring_nudges_target_sent_idx",
                table: "caring_smart_nudges",
                columns: new[] { "tenant_id", "target_user_id", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_smart_nudges_related_user_id",
                table: "caring_smart_nudges",
                column: "related_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_smart_nudges_target_user_id",
                table: "caring_smart_nudges",
                column: "target_user_id");

            migrationBuilder.CreateIndex(
                name: "uq_caring_nudges_dispatch_key",
                table: "caring_smart_nudges",
                columns: new[] { "tenant_id", "dispatch_key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_smart_nudges");
        }
    }
}
