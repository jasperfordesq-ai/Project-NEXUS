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
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704073500_AddCaringRegionalPoints")]
    public partial class AddCaringRegionalPoints : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_regional_point_accounts",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    balance = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false, defaultValue: 0m),
                    lifetime_earned = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false, defaultValue: 0m),
                    lifetime_spent = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false, defaultValue: 0m),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_regional_point_accounts", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_regional_point_accounts_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_regional_point_accounts_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_seller_regional_point_settings",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    seller_user_id = table.Column<int>(type: "integer", nullable: false),
                    accepts_regional_points = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    regional_points_per_chf = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false, defaultValue: 10m),
                    regional_points_max_discount_pct = table.Column<int>(type: "integer", nullable: false, defaultValue: 25),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_seller_regional_point_settings", x => x.id);
                    table.ForeignKey(
                        name: "FK_marketplace_seller_regional_point_settings_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_marketplace_seller_regional_point_settings_users_seller_user_id",
                        column: x => x.seller_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "caring_regional_point_transactions",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    account_id = table.Column<long>(type: "bigint", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    actor_user_id = table.Column<int>(type: "integer", nullable: true),
                    type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    direction = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    points = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    balance_after = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    reference_type = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    reference_id = table.Column<long>(type: "bigint", nullable: true),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    metadata = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_regional_point_transactions", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_regional_point_transactions_caring_regional_point_accounts_account_id",
                        column: x => x.account_id,
                        principalTable: "caring_regional_point_accounts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_regional_point_transactions_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_regional_point_transactions_users_actor_user_id",
                        column: x => x.actor_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_caring_regional_point_transactions_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "crpa_tenant_balance_idx",
                table: "caring_regional_point_accounts",
                columns: new[] { "tenant_id", "balance" });

            migrationBuilder.CreateIndex(
                name: "crpa_tenant_user_unique",
                table: "caring_regional_point_accounts",
                columns: new[] { "tenant_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_caring_regional_point_accounts_user_id",
                table: "caring_regional_point_accounts",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "crpt_tenant_ref_idx",
                table: "caring_regional_point_transactions",
                columns: new[] { "tenant_id", "reference_type", "reference_id" });

            migrationBuilder.CreateIndex(
                name: "crpt_tenant_type_created_idx",
                table: "caring_regional_point_transactions",
                columns: new[] { "tenant_id", "type", "created_at" });

            migrationBuilder.CreateIndex(
                name: "crpt_tenant_user_created_idx",
                table: "caring_regional_point_transactions",
                columns: new[] { "tenant_id", "user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_regional_point_transactions_account_id",
                table: "caring_regional_point_transactions",
                column: "account_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_regional_point_transactions_actor_user_id",
                table: "caring_regional_point_transactions",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_regional_point_transactions_user_id",
                table: "caring_regional_point_transactions",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "msrps_tenant_accepts_idx",
                table: "marketplace_seller_regional_point_settings",
                columns: new[] { "tenant_id", "accepts_regional_points" });

            migrationBuilder.CreateIndex(
                name: "msrps_tenant_seller_unique",
                table: "marketplace_seller_regional_point_settings",
                columns: new[] { "tenant_id", "seller_user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_seller_regional_point_settings_seller_user_id",
                table: "marketplace_seller_regional_point_settings",
                column: "seller_user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "caring_regional_point_transactions");
            migrationBuilder.DropTable(name: "marketplace_seller_regional_point_settings");
            migrationBuilder.DropTable(name: "caring_regional_point_accounts");
        }
    }
}
