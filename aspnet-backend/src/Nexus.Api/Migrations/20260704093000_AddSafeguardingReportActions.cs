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
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704093000_AddSafeguardingReportActions")]
    public partial class AddSafeguardingReportActions : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "safeguarding_report_actions",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    report_id = table.Column<long>(type: "bigint", nullable: false),
                    actor_user_id = table.Column<int>(type: "integer", nullable: false),
                    action = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    notes = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_safeguarding_report_actions", x => x.id);
                    table.ForeignKey(
                        name: "FK_safeguarding_report_actions_safeguarding_reports_report_id",
                        column: x => x.report_id,
                        principalTable: "safeguarding_reports",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_safeguarding_report_actions_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_safeguarding_report_actions_users_actor_user_id",
                        column: x => x.actor_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "idx_safeguard_action_tenant_report",
                table: "safeguarding_report_actions",
                columns: new[] { "tenant_id", "report_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_report_actions_actor_user_id",
                table: "safeguarding_report_actions",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_report_actions_report_id",
                table: "safeguarding_report_actions",
                column: "report_id");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_report_actions_tenant_id",
                table: "safeguarding_report_actions",
                column: "tenant_id");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "safeguarding_report_actions");
        }
    }
}
