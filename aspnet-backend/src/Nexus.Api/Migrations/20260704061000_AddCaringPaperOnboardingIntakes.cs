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
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704061000_AddCaringPaperOnboardingIntakes")]
    public partial class AddCaringPaperOnboardingIntakes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_paper_onboarding_intakes",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    uploaded_by = table.Column<int>(type: "integer", nullable: true),
                    reviewed_by = table.Column<int>(type: "integer", nullable: true),
                    created_user_id = table.Column<int>(type: "integer", nullable: true),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "pending_review"),
                    original_filename = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    stored_path = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    mime_type = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    file_size = table.Column<int>(type: "integer", nullable: true),
                    ocr_provider = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false, defaultValue: "manual_review_stub"),
                    extracted_fields = table.Column<string>(type: "jsonb", nullable: true),
                    corrected_fields = table.Column<string>(type: "jsonb", nullable: true),
                    coordinator_notes = table.Column<string>(type: "text", nullable: true),
                    confirmed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    rejected_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    deleted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_paper_onboarding_intakes", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_paper_onboarding_intakes_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_caring_paper_onboarding_intakes_created_user_id",
                table: "caring_paper_onboarding_intakes",
                column: "created_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_paper_onboarding_intakes_reviewed_by",
                table: "caring_paper_onboarding_intakes",
                column: "reviewed_by");

            migrationBuilder.CreateIndex(
                name: "IX_caring_paper_onboarding_intakes_tenant_id",
                table: "caring_paper_onboarding_intakes",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_paper_onboarding_intakes_uploaded_by",
                table: "caring_paper_onboarding_intakes",
                column: "uploaded_by");

            migrationBuilder.CreateIndex(
                name: "caring_paper_onboarding_tenant_created_idx",
                table: "caring_paper_onboarding_intakes",
                columns: new[] { "tenant_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "caring_paper_onboarding_tenant_status_idx",
                table: "caring_paper_onboarding_intakes",
                columns: new[] { "tenant_id", "status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_paper_onboarding_intakes");
        }
    }
}
