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
    public partial class AddCaringHourEstates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_hour_estates",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    member_user_id = table.Column<int>(type: "integer", nullable: false),
                    beneficiary_user_id = table.Column<int>(type: "integer", nullable: true),
                    policy_action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false, defaultValue: "donate_to_solidarity"),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "nominated"),
                    reported_balance_hours = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    settled_hours = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    policy_document_reference = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    member_notes = table.Column<string>(type: "text", nullable: true),
                    coordinator_notes = table.Column<string>(type: "text", nullable: true),
                    nominated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    reported_deceased_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    settled_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    reported_by = table.Column<int>(type: "integer", nullable: true),
                    settled_by = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_hour_estates", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_hour_estates_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_hour_estates_users_beneficiary_user_id",
                        column: x => x.beneficiary_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_hour_estates_users_member_user_id",
                        column: x => x.member_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "caring_hour_estates_tenant_member_unique",
                table: "caring_hour_estates",
                columns: new[] { "tenant_id", "member_user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_caring_hour_estates_beneficiary_user_id",
                table: "caring_hour_estates",
                column: "beneficiary_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_hour_estates_member_user_id",
                table: "caring_hour_estates",
                column: "member_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_hour_estates_tenant_id_status",
                table: "caring_hour_estates",
                columns: new[] { "tenant_id", "status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_hour_estates");
        }
    }
}
