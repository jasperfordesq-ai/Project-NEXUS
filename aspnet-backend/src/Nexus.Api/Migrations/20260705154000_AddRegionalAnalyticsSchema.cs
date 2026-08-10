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
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260705154000_AddRegionalAnalyticsSchema")]
    public partial class AddRegionalAnalyticsSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "regional_analytics_cache",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    report_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    period = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    payload = table.Column<string>(type: "text", nullable: false),
                    computed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_regional_analytics_cache", x => x.id);
                    table.ForeignKey(
                        name: "FK_regional_analytics_cache_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "regional_analytics_subscriptions",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    partner_name = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    partner_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "municipality"),
                    contact_email = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    contact_language = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    billing_email = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: true),
                    plan_tier = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "basic"),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "trialing"),
                    stripe_subscription_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    subscription_token = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    subscription_token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    trial_ends_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    current_period_start = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    current_period_end = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    monthly_price_cents = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false, defaultValue: "CHF"),
                    enabled_modules = table.Column<string>(type: "jsonb", nullable: true),
                    created_by_admin_id = table.Column<long>(type: "bigint", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_regional_analytics_subscriptions", x => x.id);
                    table.ForeignKey(
                        name: "FK_regional_analytics_subscriptions_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "regional_analytics_access_log",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    subscription_id = table.Column<long>(type: "bigint", nullable: false),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    accessed_endpoint = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    accessed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    ip_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    user_agent = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_regional_analytics_access_log", x => x.id);
                    table.ForeignKey(
                        name: "FK_regional_analytics_access_log_regional_analytics_subscript~",
                        column: x => x.subscription_id,
                        principalTable: "regional_analytics_subscriptions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_regional_analytics_access_log_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "regional_analytics_reports",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    subscription_id = table.Column<long>(type: "bigint", nullable: false),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    report_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "monthly_summary"),
                    period_start = table.Column<DateOnly>(type: "date", nullable: false),
                    period_end = table.Column<DateOnly>(type: "date", nullable: false),
                    generated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    file_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    payload_json = table.Column<string>(type: "jsonb", nullable: true),
                    recipient_emails = table.Column<string>(type: "jsonb", nullable: true),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "queued"),
                    error_message = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_regional_analytics_reports", x => x.id);
                    table.ForeignKey(
                        name: "FK_regional_analytics_reports_regional_analytics_subscriptio~",
                        column: x => x.subscription_id,
                        principalTable: "regional_analytics_subscriptions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_regional_analytics_reports_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "rac_tenant_type_period",
                table: "regional_analytics_cache",
                columns: new[] { "tenant_id", "report_type", "period" });

            migrationBuilder.CreateIndex(
                name: "rac_unique",
                table: "regional_analytics_cache",
                columns: new[] { "tenant_id", "report_type", "period" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_regional_analytics_subscriptions_tenant_id",
                table: "regional_analytics_subscriptions",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_regional_analytics_subscriptions_tenant_id_status",
                table: "regional_analytics_subscriptions",
                columns: new[] { "tenant_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_regional_analytics_subscriptions_subscription_token",
                table: "regional_analytics_subscriptions",
                column: "subscription_token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "regional_analytics_token_hash_unique",
                table: "regional_analytics_subscriptions",
                column: "subscription_token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_regional_analytics_access_log_subscription_id",
                table: "regional_analytics_access_log",
                column: "subscription_id");

            migrationBuilder.CreateIndex(
                name: "IX_regional_analytics_access_log_tenant_id",
                table: "regional_analytics_access_log",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_regional_analytics_access_log_subscription_id_accessed_at",
                table: "regional_analytics_access_log",
                columns: new[] { "subscription_id", "accessed_at" });

            migrationBuilder.CreateIndex(
                name: "IX_regional_analytics_reports_subscription_id",
                table: "regional_analytics_reports",
                column: "subscription_id");

            migrationBuilder.CreateIndex(
                name: "IX_regional_analytics_reports_tenant_id",
                table: "regional_analytics_reports",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_regional_analytics_reports_subscription_id_period_start",
                table: "regional_analytics_reports",
                columns: new[] { "subscription_id", "period_start" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "regional_analytics_access_log");

            migrationBuilder.DropTable(
                name: "regional_analytics_reports");

            migrationBuilder.DropTable(
                name: "regional_analytics_cache");

            migrationBuilder.DropTable(
                name: "regional_analytics_subscriptions");
        }
    }
}
