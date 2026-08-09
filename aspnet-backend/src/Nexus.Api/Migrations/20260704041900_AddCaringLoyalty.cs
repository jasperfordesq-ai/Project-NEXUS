using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCaringLoyalty : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_loyalty_redemptions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MemberUserId = table.Column<int>(type: "integer", nullable: false),
                    MerchantUserId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceListingId = table.Column<int>(type: "integer", nullable: true),
                    MarketplaceOrderId = table.Column<int>(type: "integer", nullable: true),
                    CreditsUsed = table.Column<decimal>(type: "numeric", nullable: false),
                    ExchangeRateChf = table.Column<decimal>(type: "numeric", nullable: false),
                    DiscountChf = table.Column<decimal>(type: "numeric", nullable: false),
                    OrderTotalChf = table.Column<decimal>(type: "numeric", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    RedeemedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReversedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReversedBy = table.Column<int>(type: "integer", nullable: true),
                    ReversalReason = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_loyalty_redemptions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_seller_loyalty_settings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    SellerUserId = table.Column<int>(type: "integer", nullable: false),
                    AcceptsTimeCredits = table.Column<bool>(type: "boolean", nullable: false),
                    LoyaltyChfPerHour = table.Column<decimal>(type: "numeric", nullable: false),
                    LoyaltyMaxDiscountPct = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_seller_loyalty_settings", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_caring_loyalty_redemptions_TenantId_MarketplaceListingId",
                table: "caring_loyalty_redemptions",
                columns: new[] { "TenantId", "MarketplaceListingId" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_loyalty_redemptions_TenantId_MemberUserId",
                table: "caring_loyalty_redemptions",
                columns: new[] { "TenantId", "MemberUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_loyalty_redemptions_TenantId_MerchantUserId",
                table: "caring_loyalty_redemptions",
                columns: new[] { "TenantId", "MerchantUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_loyalty_redemptions_TenantId_RedeemedAt",
                table: "caring_loyalty_redemptions",
                columns: new[] { "TenantId", "RedeemedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_seller_loyalty_settings_TenantId_AcceptsTimeCre~",
                table: "marketplace_seller_loyalty_settings",
                columns: new[] { "TenantId", "AcceptsTimeCredits" });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_seller_loyalty_settings_TenantId_SellerUserId",
                table: "marketplace_seller_loyalty_settings",
                columns: new[] { "TenantId", "SellerUserId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_loyalty_redemptions");

            migrationBuilder.DropTable(
                name: "marketplace_seller_loyalty_settings");
        }
    }
}
