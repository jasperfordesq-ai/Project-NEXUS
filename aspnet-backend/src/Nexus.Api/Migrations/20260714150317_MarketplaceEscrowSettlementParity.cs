using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class MarketplaceEscrowSettlementParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "AutoCompleteAt",
                table: "marketplace_orders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "BuyerConfirmedAt",
                table: "marketplace_orders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CancellationReason",
                table: "marketplace_orders",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "EscrowReleasedAt",
                table: "marketplace_orders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_marketplace_payments_TenantId_Id",
                table: "marketplace_payments",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateTable(
                name: "marketplace_escrow",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceOrderId = table.Column<int>(type: "integer", nullable: false),
                    MarketplacePaymentId = table.Column<long>(type: "bigint", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    HeldAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReleaseAfter = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReleasedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReleaseTrigger = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_escrow", x => x.Id);
                    table.CheckConstraint("chk_marketplace_escrow_amount", "\"Amount\" >= 0");
                    table.CheckConstraint("chk_marketplace_escrow_release_trigger", "\"ReleaseTrigger\" IS NULL OR \"ReleaseTrigger\" IN ('buyer_confirmed','auto_timeout','admin_override','dispute_resolved')");
                    table.CheckConstraint("chk_marketplace_escrow_status", "\"Status\" IN ('held','released','refunded','disputed')");
                    table.ForeignKey(
                        name: "FK_marketplace_escrow_marketplace_orders_TenantId_MarketplaceO~",
                        columns: x => new { x.TenantId, x.MarketplaceOrderId },
                        principalTable: "marketplace_orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_marketplace_escrow_marketplace_payments_TenantId_Marketplac~",
                        columns: x => new { x.TenantId, x.MarketplacePaymentId },
                        principalTable: "marketplace_payments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_orders_TenantId_Status_AutoCompleteAt",
                table: "marketplace_orders",
                columns: new[] { "TenantId", "Status", "AutoCompleteAt" });

            migrationBuilder.CreateIndex(
                name: "idx_marketplace_escrow_release",
                table: "marketplace_escrow",
                columns: new[] { "TenantId", "Status", "ReleaseAfter" });

            migrationBuilder.CreateIndex(
                name: "uk_marketplace_escrow_order",
                table: "marketplace_escrow",
                columns: new[] { "TenantId", "MarketplaceOrderId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uk_marketplace_escrow_payment",
                table: "marketplace_escrow",
                columns: new[] { "TenantId", "MarketplacePaymentId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "marketplace_escrow");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_marketplace_payments_TenantId_Id",
                table: "marketplace_payments");

            migrationBuilder.DropIndex(
                name: "IX_marketplace_orders_TenantId_Status_AutoCompleteAt",
                table: "marketplace_orders");

            migrationBuilder.DropColumn(
                name: "AutoCompleteAt",
                table: "marketplace_orders");

            migrationBuilder.DropColumn(
                name: "BuyerConfirmedAt",
                table: "marketplace_orders");

            migrationBuilder.DropColumn(
                name: "CancellationReason",
                table: "marketplace_orders");

            migrationBuilder.DropColumn(
                name: "EscrowReleasedAt",
                table: "marketplace_orders");
        }
    }
}
