using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class MarketplaceDisputeSettlementParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "WalletRefundTransactionId",
                table: "marketplace_orders",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WalletTransactionId",
                table: "marketplace_orders",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "marketplace_disputes",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceOrderId = table.Column<int>(type: "integer", nullable: false),
                    OpenedByUserId = table.Column<int>(type: "integer", nullable: false),
                    Reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    EvidenceUrlsJson = table.Column<string>(type: "jsonb", nullable: true),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PriorOrderStatus = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    ResolutionNotes = table.Column<string>(type: "text", nullable: true),
                    ResolvedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RefundAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_disputes", x => x.Id);
                    table.CheckConstraint("chk_marketplace_dispute_reason", "\"Reason\" IN ('not_received','not_as_described','damaged','wrong_item','other')");
                    table.CheckConstraint("chk_marketplace_dispute_refund", "\"RefundAmount\" IS NULL OR \"RefundAmount\" >= 0");
                    table.CheckConstraint("chk_marketplace_dispute_status", "\"Status\" IN ('open','under_review','resolved_buyer','resolved_seller','escalated','closed')");
                });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_orders_TenantId_WalletRefundTransactionId",
                table: "marketplace_orders",
                columns: new[] { "TenantId", "WalletRefundTransactionId" },
                unique: true,
                filter: "\"WalletRefundTransactionId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_disputes_TenantId_MarketplaceOrderId_Status",
                table: "marketplace_disputes",
                columns: new[] { "TenantId", "MarketplaceOrderId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_disputes_TenantId_OpenedByUserId_CreatedAt",
                table: "marketplace_disputes",
                columns: new[] { "TenantId", "OpenedByUserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_disputes_TenantId_Status_CreatedAt",
                table: "marketplace_disputes",
                columns: new[] { "TenantId", "Status", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "marketplace_disputes");

            migrationBuilder.DropIndex(
                name: "IX_marketplace_orders_TenantId_WalletRefundTransactionId",
                table: "marketplace_orders");

            migrationBuilder.DropColumn(
                name: "WalletRefundTransactionId",
                table: "marketplace_orders");

            migrationBuilder.DropColumn(
                name: "WalletTransactionId",
                table: "marketplace_orders");
        }
    }
}
