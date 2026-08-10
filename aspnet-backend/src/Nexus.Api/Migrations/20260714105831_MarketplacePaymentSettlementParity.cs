using System;
using Microsoft.EntityFrameworkCore.Migrations;
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class MarketplacePaymentSettlementParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "StripeOnboardingComplete",
                table: "marketplace_seller_profiles",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "PaymentExpiresAt",
                table: "marketplace_orders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PaymentIntentId",
                table: "marketplace_orders",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StripeCheckoutMode",
                table: "marketplace_orders",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_marketplace_orders_TenantId_Id",
                table: "marketplace_orders",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateTable(
                name: "marketplace_payments",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceOrderId = table.Column<int>(type: "integer", nullable: false),
                    StripePaymentIntentId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    StripeChargeId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    FundsFlow = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    PlatformFee = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    SellerPayout = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PaymentMethod = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    RefundAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    RefundReason = table.Column<string>(type: "text", nullable: true),
                    RefundedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PayoutStatus = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PayoutId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    PaidOutAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_payments", x => x.Id);
                    table.CheckConstraint("chk_marketplace_payment_amounts", "\"Amount\" > 0 AND \"PlatformFee\" >= 0 AND \"SellerPayout\" >= 0 AND \"PlatformFee\" + \"SellerPayout\" = \"Amount\"");
                    table.CheckConstraint("chk_marketplace_payment_funds_flow", "\"FundsFlow\" IN ('destination_charge','separate_charge_transfer')");
                    table.CheckConstraint("chk_marketplace_payment_payout_status", "\"PayoutStatus\" IN ('pending','scheduled','paid','failed')");
                    table.CheckConstraint("chk_marketplace_payment_status", "\"Status\" IN ('pending','succeeded','failed','refunded','partially_refunded')");
                    table.ForeignKey(
                        name: "FK_marketplace_payments_marketplace_orders_TenantId_Marketplac~",
                        columns: x => new { x.TenantId, x.MarketplaceOrderId },
                        principalTable: "marketplace_orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_orders_TenantId_PaymentIntentId",
                table: "marketplace_orders",
                columns: new[] { "TenantId", "PaymentIntentId" },
                unique: true,
                filter: "\"PaymentIntentId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_orders_TenantId_Status_PaymentExpiresAt",
                table: "marketplace_orders",
                columns: new[] { "TenantId", "Status", "PaymentExpiresAt" });

            migrationBuilder.AddCheckConstraint(
                name: "chk_marketplace_order_checkout_mode",
                table: "marketplace_orders",
                sql: "\"StripeCheckoutMode\" IS NULL OR \"StripeCheckoutMode\" IN ('payment_intent','checkout_session')");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_payments_StripePaymentIntentId",
                table: "marketplace_payments",
                column: "StripePaymentIntentId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_payments_TenantId_MarketplaceOrderId",
                table: "marketplace_payments",
                columns: new[] { "TenantId", "MarketplaceOrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_payments_TenantId_Status",
                table: "marketplace_payments",
                columns: new[] { "TenantId", "Status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "marketplace_payments");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_marketplace_orders_TenantId_Id",
                table: "marketplace_orders");

            migrationBuilder.DropIndex(
                name: "IX_marketplace_orders_TenantId_PaymentIntentId",
                table: "marketplace_orders");

            migrationBuilder.DropIndex(
                name: "IX_marketplace_orders_TenantId_Status_PaymentExpiresAt",
                table: "marketplace_orders");

            migrationBuilder.DropCheckConstraint(
                name: "chk_marketplace_order_checkout_mode",
                table: "marketplace_orders");

            migrationBuilder.DropColumn(
                name: "StripeOnboardingComplete",
                table: "marketplace_seller_profiles");

            migrationBuilder.DropColumn(
                name: "PaymentExpiresAt",
                table: "marketplace_orders");

            migrationBuilder.DropColumn(
                name: "PaymentIntentId",
                table: "marketplace_orders");

            migrationBuilder.DropColumn(
                name: "StripeCheckoutMode",
                table: "marketplace_orders");
        }
    }
}
