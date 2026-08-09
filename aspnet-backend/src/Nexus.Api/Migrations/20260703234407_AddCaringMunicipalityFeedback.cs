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
    public partial class AddCaringMunicipalityFeedback : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_municipality_feedback",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    submitter_user_id = table.Column<int>(type: "integer", nullable: true),
                    sub_region_id = table.Column<int>(type: "integer", nullable: true),
                    category = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "question"),
                    subject = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    body = table.Column<string>(type: "text", nullable: false),
                    sentiment_tag = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "new"),
                    assigned_user_id = table.Column<int>(type: "integer", nullable: true),
                    assigned_role = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    triage_notes = table.Column<string>(type: "text", nullable: true),
                    resolution_notes = table.Column<string>(type: "text", nullable: true),
                    is_anonymous = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    is_public = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    deleted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_municipality_feedback", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_municipality_feedback_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_caring_municipality_feedback_submitter_user_id",
                table: "caring_municipality_feedback",
                column: "submitter_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_municipality_feedback_tenant_id_category",
                table: "caring_municipality_feedback",
                columns: new[] { "tenant_id", "category" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_municipality_feedback_tenant_id_created_at",
                table: "caring_municipality_feedback",
                columns: new[] { "tenant_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_municipality_feedback_tenant_id_status",
                table: "caring_municipality_feedback",
                columns: new[] { "tenant_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_municipality_feedback_tenant_id_sub_region_id",
                table: "caring_municipality_feedback",
                columns: new[] { "tenant_id", "sub_region_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_municipality_feedback");
        }
    }
}
