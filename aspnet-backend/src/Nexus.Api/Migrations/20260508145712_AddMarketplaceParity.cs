using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMarketplaceParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "marketplace_categories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Slug = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Icon = table.Column<string>(type: "text", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_categories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_collection_items",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceCollectionId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceListingId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_collection_items", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_collections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    IsPublic = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_collections", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_delivery_offers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceOrderId = table.Column<int>(type: "integer", nullable: false),
                    DelivererUserId = table.Column<int>(type: "integer", nullable: false),
                    TimeCreditAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_delivery_offers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_pickup_reservations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceOrderId = table.Column<int>(type: "integer", nullable: false),
                    MarketplacePickupSlotId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_pickup_reservations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_pickup_slots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Location = table.Column<string>(type: "text", nullable: false),
                    StartsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Capacity = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_pickup_slots", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_promotions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceListingId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    ProductCode = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    StartsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_promotions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_reports",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceListingId = table.Column<int>(type: "integer", nullable: false),
                    ReporterUserId = table.Column<int>(type: "integer", nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: false),
                    Details = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    ResolvedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ResolutionNotes = table.Column<string>(type: "text", nullable: true),
                    AcknowledgedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_reports", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_saved_listings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceListingId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_saved_listings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_saved_searches",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Query = table.Column<string>(type: "text", nullable: false),
                    FiltersJson = table.Column<string>(type: "text", nullable: true),
                    AlertsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_saved_searches", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_seller_profiles",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: false),
                    Bio = table.Column<string>(type: "text", nullable: true),
                    SellerType = table.Column<string>(type: "text", nullable: false),
                    IsVerified = table.Column<bool>(type: "boolean", nullable: false),
                    IsSuspended = table.Column<bool>(type: "boolean", nullable: false),
                    SuspensionReason = table.Column<string>(type: "text", nullable: true),
                    RatingAverage = table.Column<decimal>(type: "numeric", nullable: false),
                    RatingCount = table.Column<int>(type: "integer", nullable: false),
                    ListingsCount = table.Column<int>(type: "integer", nullable: false),
                    SalesCount = table.Column<int>(type: "integer", nullable: false),
                    StripeAccountId = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_seller_profiles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_marketplace_seller_profiles_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_seller_ratings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceOrderId = table.Column<int>(type: "integer", nullable: false),
                    SellerUserId = table.Column<int>(type: "integer", nullable: false),
                    BuyerUserId = table.Column<int>(type: "integer", nullable: false),
                    Rating = table.Column<int>(type: "integer", nullable: false),
                    Comment = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_seller_ratings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_shipping_options",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Price = table.Column<decimal>(type: "numeric", nullable: false),
                    Currency = table.Column<string>(type: "text", nullable: false),
                    Region = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_shipping_options", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "merchant_coupon_redemptions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MerchantCouponId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceOrderId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_merchant_coupon_redemptions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "merchant_coupons",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    SellerUserId = table.Column<int>(type: "integer", nullable: false),
                    Code = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    DiscountAmount = table.Column<decimal>(type: "numeric", nullable: false),
                    DiscountType = table.Column<string>(type: "text", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_merchant_coupons", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_listings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    CategoryId = table.Column<int>(type: "integer", nullable: true),
                    GroupId = table.Column<int>(type: "integer", nullable: true),
                    Title = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    Tagline = table.Column<string>(type: "text", nullable: true),
                    Price = table.Column<decimal>(type: "numeric", nullable: true),
                    PriceCurrency = table.Column<string>(type: "text", nullable: false),
                    PriceType = table.Column<string>(type: "text", nullable: false),
                    TimeCreditPrice = table.Column<decimal>(type: "numeric", nullable: true),
                    Condition = table.Column<string>(type: "text", nullable: false),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    TemplateDataJson = table.Column<string>(type: "text", nullable: true),
                    Location = table.Column<string>(type: "text", nullable: true),
                    Latitude = table.Column<double>(type: "double precision", nullable: true),
                    Longitude = table.Column<double>(type: "double precision", nullable: true),
                    ShippingAvailable = table.Column<bool>(type: "boolean", nullable: false),
                    LocalPickup = table.Column<bool>(type: "boolean", nullable: false),
                    DeliveryMethod = table.Column<string>(type: "text", nullable: false),
                    SellerType = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    MarketplaceStatus = table.Column<string>(type: "text", nullable: false),
                    ModerationStatus = table.Column<string>(type: "text", nullable: false),
                    ModerationNotes = table.Column<string>(type: "text", nullable: true),
                    ModeratedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ModeratedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PromotionType = table.Column<string>(type: "text", nullable: true),
                    PromotedUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RenewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RenewalCount = table.Column<int>(type: "integer", nullable: false),
                    VideoUrl = table.Column<string>(type: "text", nullable: true),
                    ViewsCount = table.Column<int>(type: "integer", nullable: false),
                    SavesCount = table.Column<int>(type: "integer", nullable: false),
                    ContactsCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_listings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_marketplace_listings_groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "groups",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_marketplace_listings_marketplace_categories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "marketplace_categories",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_marketplace_listings_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_marketplace_listings_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_images",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceListingId = table.Column<int>(type: "integer", nullable: false),
                    Url = table.Column<string>(type: "text", nullable: false),
                    AltText = table.Column<string>(type: "text", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_images", x => x.Id);
                    table.ForeignKey(
                        name: "FK_marketplace_images_marketplace_listings_MarketplaceListingId",
                        column: x => x.MarketplaceListingId,
                        principalTable: "marketplace_listings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_offers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceListingId = table.Column<int>(type: "integer", nullable: false),
                    BuyerUserId = table.Column<int>(type: "integer", nullable: false),
                    SellerUserId = table.Column<int>(type: "integer", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric", nullable: true),
                    TimeCreditAmount = table.Column<decimal>(type: "numeric", nullable: true),
                    Currency = table.Column<string>(type: "text", nullable: false),
                    Message = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CounterAmount = table.Column<decimal>(type: "numeric", nullable: true),
                    CounterMessage = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_offers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_marketplace_offers_marketplace_listings_MarketplaceListingId",
                        column: x => x.MarketplaceListingId,
                        principalTable: "marketplace_listings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_orders",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MarketplaceListingId = table.Column<int>(type: "integer", nullable: false),
                    BuyerUserId = table.Column<int>(type: "integer", nullable: false),
                    SellerUserId = table.Column<int>(type: "integer", nullable: false),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    TotalAmount = table.Column<decimal>(type: "numeric", nullable: true),
                    TimeCreditTotal = table.Column<decimal>(type: "numeric", nullable: true),
                    Currency = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    DeliveryMethod = table.Column<string>(type: "text", nullable: false),
                    ShippingAddress = table.Column<string>(type: "text", nullable: true),
                    TrackingNumber = table.Column<string>(type: "text", nullable: true),
                    ShippedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeliveredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_orders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_marketplace_orders_marketplace_listings_MarketplaceListingId",
                        column: x => x.MarketplaceListingId,
                        principalTable: "marketplace_listings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_categories_TenantId_Slug",
                table: "marketplace_categories",
                columns: new[] { "TenantId", "Slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_collection_items_TenantId_MarketplaceCollection~",
                table: "marketplace_collection_items",
                columns: new[] { "TenantId", "MarketplaceCollectionId", "MarketplaceListingId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_images_MarketplaceListingId",
                table: "marketplace_images",
                column: "MarketplaceListingId");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_listings_CategoryId",
                table: "marketplace_listings",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_listings_GroupId",
                table: "marketplace_listings",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_listings_TenantId_Status_ModerationStatus",
                table: "marketplace_listings",
                columns: new[] { "TenantId", "Status", "ModerationStatus" });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_listings_TenantId_UserId",
                table: "marketplace_listings",
                columns: new[] { "TenantId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_listings_UserId",
                table: "marketplace_listings",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_offers_MarketplaceListingId",
                table: "marketplace_offers",
                column: "MarketplaceListingId");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_orders_MarketplaceListingId",
                table: "marketplace_orders",
                column: "MarketplaceListingId");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_saved_listings_TenantId_UserId_MarketplaceListi~",
                table: "marketplace_saved_listings",
                columns: new[] { "TenantId", "UserId", "MarketplaceListingId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_seller_profiles_TenantId_UserId",
                table: "marketplace_seller_profiles",
                columns: new[] { "TenantId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_seller_profiles_UserId",
                table: "marketplace_seller_profiles",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_merchant_coupons_TenantId_Code",
                table: "merchant_coupons",
                columns: new[] { "TenantId", "Code" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "marketplace_collection_items");

            migrationBuilder.DropTable(
                name: "marketplace_collections");

            migrationBuilder.DropTable(
                name: "marketplace_delivery_offers");

            migrationBuilder.DropTable(
                name: "marketplace_images");

            migrationBuilder.DropTable(
                name: "marketplace_offers");

            migrationBuilder.DropTable(
                name: "marketplace_orders");

            migrationBuilder.DropTable(
                name: "marketplace_pickup_reservations");

            migrationBuilder.DropTable(
                name: "marketplace_pickup_slots");

            migrationBuilder.DropTable(
                name: "marketplace_promotions");

            migrationBuilder.DropTable(
                name: "marketplace_reports");

            migrationBuilder.DropTable(
                name: "marketplace_saved_listings");

            migrationBuilder.DropTable(
                name: "marketplace_saved_searches");

            migrationBuilder.DropTable(
                name: "marketplace_seller_profiles");

            migrationBuilder.DropTable(
                name: "marketplace_seller_ratings");

            migrationBuilder.DropTable(
                name: "marketplace_shipping_options");

            migrationBuilder.DropTable(
                name: "merchant_coupon_redemptions");

            migrationBuilder.DropTable(
                name: "merchant_coupons");

            migrationBuilder.DropTable(
                name: "marketplace_listings");

            migrationBuilder.DropTable(
                name: "marketplace_categories");
        }
    }
}
