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
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704113000_AddMunicipalitySurveys")]
    public partial class AddMunicipalitySurveys : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "municipality_surveys",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    created_by = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "draft"),
                    is_anonymous = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    target_audience = table.Column<string>(type: "jsonb", nullable: true),
                    starts_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ends_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    response_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_municipality_surveys", x => x.id);
                    table.ForeignKey(
                        name: "FK_municipality_surveys_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_municipality_surveys_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "municipality_survey_questions",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    survey_id = table.Column<long>(type: "bigint", nullable: false),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    question_text = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    question_type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    options = table.Column<string>(type: "jsonb", nullable: true),
                    is_required = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_municipality_survey_questions", x => x.id);
                    table.ForeignKey(
                        name: "FK_municipality_survey_questions_municipality_surveys_survey_id",
                        column: x => x.survey_id,
                        principalTable: "municipality_surveys",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_municipality_survey_questions_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "municipality_survey_responses",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    survey_id = table.Column<long>(type: "bigint", nullable: false),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: true),
                    session_token = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    answers = table.Column<string>(type: "jsonb", nullable: false),
                    submitted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ip_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_municipality_survey_responses", x => x.id);
                    table.ForeignKey(
                        name: "FK_municipality_survey_responses_municipality_surveys_survey_id",
                        column: x => x.survey_id,
                        principalTable: "municipality_surveys",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_municipality_survey_responses_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_municipality_survey_responses_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_municipality_survey_questions_tenant_id",
                table: "municipality_survey_questions",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "municipality_survey_questions_survey_sort_idx",
                table: "municipality_survey_questions",
                columns: new[] { "survey_id", "sort_order" });

            migrationBuilder.CreateIndex(
                name: "IX_municipality_survey_responses_survey_id",
                table: "municipality_survey_responses",
                column: "survey_id");

            migrationBuilder.CreateIndex(
                name: "IX_municipality_survey_responses_tenant_id",
                table: "municipality_survey_responses",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_municipality_survey_responses_user_id",
                table: "municipality_survey_responses",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "msr_tenant_survey_session_unique",
                table: "municipality_survey_responses",
                columns: new[] { "tenant_id", "survey_id", "session_token" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "msr_tenant_survey_user_unique",
                table: "municipality_survey_responses",
                columns: new[] { "tenant_id", "survey_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "municipality_survey_responses_tenant_submitted_idx",
                table: "municipality_survey_responses",
                columns: new[] { "tenant_id", "submitted_at" });

            migrationBuilder.CreateIndex(
                name: "IX_municipality_surveys_created_by",
                table: "municipality_surveys",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_municipality_surveys_tenant_id",
                table: "municipality_surveys",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "municipality_surveys_tenant_status_idx",
                table: "municipality_surveys",
                columns: new[] { "tenant_id", "status" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "municipality_survey_responses");

            migrationBuilder.DropTable(
                name: "municipality_survey_questions");

            migrationBuilder.DropTable(
                name: "municipality_surveys");
        }
    }
}
