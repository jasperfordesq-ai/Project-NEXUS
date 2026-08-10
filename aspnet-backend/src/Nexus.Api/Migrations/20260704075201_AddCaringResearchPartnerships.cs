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
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704075201_AddCaringResearchPartnerships")]
    public partial class AddCaringResearchPartnerships : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_research_consents",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    consent_status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "opted_out"),
                    consent_version = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false, defaultValue: "research-v1"),
                    consented_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    revoked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    notes = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    deleted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_research_consents", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_research_consents_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_research_consents_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "caring_research_partners",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    institution = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    contact_email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    agreement_reference = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    methodology_url = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "draft"),
                    data_scope = table.Column<string>(type: "jsonb", nullable: true),
                    starts_at = table.Column<DateOnly>(type: "date", nullable: true),
                    ends_at = table.Column<DateOnly>(type: "date", nullable: true),
                    created_by = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_research_partners", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_research_partners_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_research_partners_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "caring_research_dataset_exports",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    partner_id = table.Column<long>(type: "bigint", nullable: false),
                    requested_by = table.Column<int>(type: "integer", nullable: true),
                    dataset_key = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false, defaultValue: "caring_community_aggregate_v1"),
                    period_start = table.Column<DateOnly>(type: "date", nullable: false),
                    period_end = table.Column<DateOnly>(type: "date", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "generated"),
                    row_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    anonymization_version = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false, defaultValue: "aggregate-v1"),
                    data_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    generated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    metadata = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_research_dataset_exports", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_research_dataset_exports_caring_research_partners_partner_id",
                        column: x => x.partner_id,
                        principalTable: "caring_research_partners",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_research_dataset_exports_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_research_dataset_exports_users_requested_by",
                        column: x => x.requested_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "caring_research_consents_tenant_user_unique",
                table: "caring_research_consents",
                columns: new[] { "tenant_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_caring_research_consents_tenant_status",
                table: "caring_research_consents",
                columns: new[] { "tenant_id", "consent_status" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_research_consents_tenant_id",
                table: "caring_research_consents",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_research_consents_user_id",
                table: "caring_research_consents",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_research_partners_created_by",
                table: "caring_research_partners",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_caring_research_partners_tenant_id",
                table: "caring_research_partners",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_research_partners_tenant_id_status",
                table: "caring_research_partners",
                columns: new[] { "tenant_id", "status" });

            migrationBuilder.CreateIndex(
                name: "caring_research_exports_partner_generated_idx",
                table: "caring_research_dataset_exports",
                columns: new[] { "tenant_id", "partner_id", "generated_at" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_research_dataset_exports_partner_id",
                table: "caring_research_dataset_exports",
                column: "partner_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_research_dataset_exports_requested_by",
                table: "caring_research_dataset_exports",
                column: "requested_by");

            migrationBuilder.CreateIndex(
                name: "IX_caring_research_dataset_exports_tenant_id",
                table: "caring_research_dataset_exports",
                column: "tenant_id");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_research_dataset_exports");

            migrationBuilder.DropTable(
                name: "caring_research_consents");

            migrationBuilder.DropTable(
                name: "caring_research_partners");
        }
    }
}
