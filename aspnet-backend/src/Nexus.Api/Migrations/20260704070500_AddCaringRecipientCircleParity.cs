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
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704070500_AddCaringRecipientCircleParity")]
    public partial class AddCaringRecipientCircleParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "trust_tier",
                table: "users",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "caring_support_relationships",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    supporter_id = table.Column<int>(type: "integer", nullable: false),
                    recipient_id = table.Column<int>(type: "integer", nullable: false),
                    coordinator_id = table.Column<int>(type: "integer", nullable: true),
                    organization_id = table.Column<int>(type: "integer", nullable: true),
                    category_id = table.Column<int>(type: "integer", nullable: true),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    frequency = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "weekly"),
                    expected_hours = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false, defaultValue: 1m),
                    start_date = table.Column<DateOnly>(type: "date", nullable: false),
                    end_date = table.Column<DateOnly>(type: "date", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "active"),
                    last_logged_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    next_check_in_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_support_relationships", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_support_relationships_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_support_relationships_users_coordinator_id",
                        column: x => x.coordinator_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_caring_support_relationships_users_recipient_id",
                        column: x => x.recipient_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_support_relationships_users_supporter_id",
                        column: x => x.supporter_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "caring_help_requests",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    what = table.Column<string>(type: "text", nullable: false),
                    when_needed = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    contact_preference = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "either"),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    is_on_behalf = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    requested_by_id = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    deleted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_help_requests", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_help_requests_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_help_requests_users_requested_by_id",
                        column: x => x.requested_by_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_caring_help_requests_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vol_logs",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    organization_id = table.Column<int>(type: "integer", nullable: true),
                    opportunity_id = table.Column<int>(type: "integer", nullable: true),
                    caring_support_relationship_id = table.Column<int>(type: "integer", nullable: true),
                    support_recipient_id = table.Column<int>(type: "integer", nullable: true),
                    date_logged = table.Column<DateOnly>(type: "date", nullable: false),
                    hours = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    assigned_to = table.Column<int>(type: "integer", nullable: true),
                    assigned_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    escalated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    escalation_note = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vol_logs", x => x.id);
                    table.ForeignKey(
                        name: "FK_vol_logs_caring_support_relationships_caring_support_relationship_id",
                        column: x => x.caring_support_relationship_id,
                        principalTable: "caring_support_relationships",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_vol_logs_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vol_logs_users_support_recipient_id",
                        column: x => x.support_recipient_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_vol_logs_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "safeguarding_reports",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    reporter_user_id = table.Column<int>(type: "integer", nullable: false),
                    subject_user_id = table.Column<int>(type: "integer", nullable: true),
                    subject_organisation_id = table.Column<int>(type: "integer", nullable: true),
                    category = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    severity = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "medium"),
                    description = table.Column<string>(type: "text", nullable: false),
                    evidence_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false, defaultValue: "submitted"),
                    assigned_to_user_id = table.Column<int>(type: "integer", nullable: true),
                    review_due_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    escalated = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    escalated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    resolution_notes = table.Column<string>(type: "text", nullable: true),
                    resolved_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_safeguarding_reports", x => x.id);
                    table.ForeignKey(
                        name: "FK_safeguarding_reports_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_safeguarding_reports_users_assigned_to_user_id",
                        column: x => x.assigned_to_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_safeguarding_reports_users_reporter_user_id",
                        column: x => x.reporter_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_safeguarding_reports_users_subject_user_id",
                        column: x => x.subject_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "idx_chr_tenant_status",
                table: "caring_help_requests",
                columns: new[] { "tenant_id", "status" });

            migrationBuilder.CreateIndex(
                name: "idx_chr_tenant_user",
                table: "caring_help_requests",
                columns: new[] { "tenant_id", "user_id" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_help_requests_requested_by_id",
                table: "caring_help_requests",
                column: "requested_by_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_help_requests_user_id",
                table: "caring_help_requests",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "idx_csr_next_check_in",
                table: "caring_support_relationships",
                columns: new[] { "tenant_id", "next_check_in_at" });

            migrationBuilder.CreateIndex(
                name: "idx_csr_recipient_status",
                table: "caring_support_relationships",
                columns: new[] { "tenant_id", "recipient_id", "status" });

            migrationBuilder.CreateIndex(
                name: "idx_csr_supporter_status",
                table: "caring_support_relationships",
                columns: new[] { "tenant_id", "supporter_id", "status" });

            migrationBuilder.CreateIndex(
                name: "idx_csr_tenant_status",
                table: "caring_support_relationships",
                columns: new[] { "tenant_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_support_relationships_coordinator_id",
                table: "caring_support_relationships",
                column: "coordinator_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_support_relationships_recipient_id",
                table: "caring_support_relationships",
                column: "recipient_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_support_relationships_supporter_id",
                table: "caring_support_relationships",
                column: "supporter_id");

            migrationBuilder.CreateIndex(
                name: "idx_safeguard_tenant_assigned",
                table: "safeguarding_reports",
                columns: new[] { "tenant_id", "assigned_to_user_id" });

            migrationBuilder.CreateIndex(
                name: "idx_safeguard_tenant_reporter",
                table: "safeguarding_reports",
                columns: new[] { "tenant_id", "reporter_user_id" });

            migrationBuilder.CreateIndex(
                name: "idx_safeguard_tenant_review_due",
                table: "safeguarding_reports",
                columns: new[] { "tenant_id", "review_due_at" });

            migrationBuilder.CreateIndex(
                name: "idx_safeguard_tenant_severity",
                table: "safeguarding_reports",
                columns: new[] { "tenant_id", "severity" });

            migrationBuilder.CreateIndex(
                name: "idx_safeguard_tenant_status",
                table: "safeguarding_reports",
                columns: new[] { "tenant_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_reports_assigned_to_user_id",
                table: "safeguarding_reports",
                column: "assigned_to_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_reports_reporter_user_id",
                table: "safeguarding_reports",
                column: "reporter_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_reports_subject_user_id",
                table: "safeguarding_reports",
                column: "subject_user_id");

            migrationBuilder.CreateIndex(
                name: "idx_vol_logs_caring_relationship",
                table: "vol_logs",
                column: "caring_support_relationship_id");

            migrationBuilder.CreateIndex(
                name: "idx_vol_logs_support_recipient",
                table: "vol_logs",
                column: "support_recipient_id");

            migrationBuilder.CreateIndex(
                name: "IX_vol_logs_organization_id",
                table: "vol_logs",
                column: "organization_id");

            migrationBuilder.CreateIndex(
                name: "IX_vol_logs_opportunity_id",
                table: "vol_logs",
                column: "opportunity_id");

            migrationBuilder.CreateIndex(
                name: "IX_vol_logs_tenant_id_date_logged",
                table: "vol_logs",
                columns: new[] { "tenant_id", "date_logged" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_logs_tenant_id_status",
                table: "vol_logs",
                columns: new[] { "tenant_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_logs_user_id",
                table: "vol_logs",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_help_requests");

            migrationBuilder.DropTable(
                name: "safeguarding_reports");

            migrationBuilder.DropTable(
                name: "vol_logs");

            migrationBuilder.DropTable(
                name: "caring_support_relationships");

            migrationBuilder.DropColumn(
                name: "trust_tier",
                table: "users");
        }
    }
}
