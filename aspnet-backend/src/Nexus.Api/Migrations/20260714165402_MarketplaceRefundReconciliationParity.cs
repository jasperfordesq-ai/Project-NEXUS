using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class MarketplaceRefundReconciliationParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM marketplace_payments
                        WHERE COALESCE("RefundAmount", 0) <> 0
                           OR "Status" IN ('refunded', 'partially_refunded')
                    ) THEN
                        RAISE EXCEPTION 'Marketplace refund ledger migration requires operator reconciliation of legacy refunded payment rows';
                    END IF;
                END $$;
                """);

            migrationBuilder.DropCheckConstraint(
                name: "chk_marketplace_payment_amounts",
                table: "marketplace_payments");

            migrationBuilder.AddColumn<string>(
                name: "DisputePreviousOrderStatus",
                table: "marketplace_payments",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StripeDisputeId",
                table: "marketplace_payments",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StripeDisputeStatus",
                table: "marketplace_payments",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "marketplace_payment_refunds",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplacePaymentId = table.Column<long>(type: "bigint", nullable: false),
                    StripeRefundId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PlatformFeeReversal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    SellerPayoutReversal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_payment_refunds", x => x.Id);
                    table.CheckConstraint("chk_marketplace_payment_refund_amounts", "\"Amount\" > 0 AND \"PlatformFeeReversal\" >= 0 AND \"SellerPayoutReversal\" >= 0 AND \"PlatformFeeReversal\" + \"SellerPayoutReversal\" <= \"Amount\"");
                    table.ForeignKey(
                        name: "FK_marketplace_payment_refunds_marketplace_payments_TenantId_M~",
                        columns: x => new { x.TenantId, x.MarketplacePaymentId },
                        principalTable: "marketplace_payments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "chk_marketplace_payment_amounts",
                table: "marketplace_payments",
                sql: "\"Amount\" > 0 AND \"PlatformFee\" >= 0 AND \"SellerPayout\" >= 0 AND COALESCE(\"RefundAmount\", 0) >= 0 AND \"PlatformFee\" + \"SellerPayout\" + COALESCE(\"RefundAmount\", 0) = \"Amount\"");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_payment_refunds_StripeRefundId",
                table: "marketplace_payment_refunds",
                column: "StripeRefundId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_payment_refunds_TenantId_MarketplacePaymentId",
                table: "marketplace_payment_refunds",
                columns: new[] { "TenantId", "MarketplacePaymentId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "marketplace_payment_refunds");

            migrationBuilder.DropCheckConstraint(
                name: "chk_marketplace_payment_amounts",
                table: "marketplace_payments");

            migrationBuilder.DropColumn(
                name: "DisputePreviousOrderStatus",
                table: "marketplace_payments");

            migrationBuilder.DropColumn(
                name: "StripeDisputeId",
                table: "marketplace_payments");

            migrationBuilder.DropColumn(
                name: "StripeDisputeStatus",
                table: "marketplace_payments");

            migrationBuilder.AddCheckConstraint(
                name: "chk_marketplace_payment_amounts",
                table: "marketplace_payments",
                sql: "\"Amount\" > 0 AND \"PlatformFee\" >= 0 AND \"SellerPayout\" >= 0 AND \"PlatformFee\" + \"SellerPayout\" = \"Amount\"");
        }
    }
}
