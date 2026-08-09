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
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704165000_AddCaringCoverRequests")]
    public partial class AddCaringCoverRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_cover_requests",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    caregiver_link_id = table.Column<int>(type: "integer", nullable: false),
                    caregiver_id = table.Column<int>(type: "integer", nullable: false),
                    cared_for_id = table.Column<int>(type: "integer", nullable: false),
                    support_relationship_id = table.Column<int>(type: "integer", nullable: true),
                    matched_supporter_id = table.Column<int>(type: "integer", nullable: true),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    briefing = table.Column<string>(type: "text", nullable: true),
                    required_skills = table.Column<string>(type: "jsonb", nullable: true),
                    starts_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ends_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    expected_hours = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: true),
                    minimum_trust_tier = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    urgency = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "planned"),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "open"),
                    matched_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_cover_requests", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_cover_requests_caring_caregiver_links_caregiver_link_id",
                        column: x => x.caregiver_link_id,
                        principalTable: "caring_caregiver_links",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_caring_cover_requests_caring_support_relationships_support_relationship_id",
                        column: x => x.support_relationship_id,
                        principalTable: "caring_support_relationships",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_caring_cover_requests_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_cover_requests_users_cared_for_id",
                        column: x => x.cared_for_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_cover_requests_users_caregiver_id",
                        column: x => x.caregiver_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_cover_requests_users_matched_supporter_id",
                        column: x => x.matched_supporter_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_caring_cover_requests_cared_for_id",
                table: "caring_cover_requests",
                column: "cared_for_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_cover_requests_caregiver_id",
                table: "caring_cover_requests",
                column: "caregiver_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_cover_requests_caregiver_link_id",
                table: "caring_cover_requests",
                column: "caregiver_link_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_cover_requests_matched_supporter_id",
                table: "caring_cover_requests",
                column: "matched_supporter_id");

            migrationBuilder.CreateIndex(
                name: "idx_ccr_support_relationship",
                table: "caring_cover_requests",
                column: "support_relationship_id");

            migrationBuilder.CreateIndex(
                name: "idx_ccr_tenant_cared_for_starts",
                table: "caring_cover_requests",
                columns: new[] { "tenant_id", "cared_for_id", "starts_at" });

            migrationBuilder.CreateIndex(
                name: "idx_ccr_tenant_caregiver_status",
                table: "caring_cover_requests",
                columns: new[] { "tenant_id", "caregiver_id", "status" });

            migrationBuilder.CreateIndex(
                name: "idx_ccr_tenant_status_starts",
                table: "caring_cover_requests",
                columns: new[] { "tenant_id", "status", "starts_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_cover_requests");
        }
    }
}
