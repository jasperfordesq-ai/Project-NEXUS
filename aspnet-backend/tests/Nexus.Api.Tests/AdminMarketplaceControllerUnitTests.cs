// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class AdminMarketplaceControllerUnitTests
{
    [Fact]
    public async Task Dashboard_ReturnsLaravelReactMarketplaceAdminStats()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);

        db.MarketplaceListings.AddRange(
            CreateListing(1, userId: 1001, categoryId: null, "Approved active", status: "active", moderationStatus: "approved"),
            CreateListing(2, userId: 1001, categoryId: null, "Pending active", status: "active", moderationStatus: "pending"),
            CreateListing(3, userId: 1001, categoryId: null, "Other tenant", tenantId: 99, status: "active", moderationStatus: "approved"));
        db.MarketplaceSellerProfiles.AddRange(
            new MarketplaceSellerProfile { TenantId = 42, UserId = 1001, DisplayName = "Seller One" },
            new MarketplaceSellerProfile { TenantId = 99, UserId = 9001, DisplayName = "Other Seller" });
        db.MarketplaceOrders.AddRange(
            new MarketplaceOrder { TenantId = 42, MarketplaceListingId = 1, BuyerUserId = 2001, SellerUserId = 1001, Status = "completed", TotalAmount = 25m },
            new MarketplaceOrder { TenantId = 42, MarketplaceListingId = 2, BuyerUserId = 2002, SellerUserId = 1001, Status = "cancelled", TotalAmount = 99m },
            new MarketplaceOrder { TenantId = 99, MarketplaceListingId = 3, BuyerUserId = 2003, SellerUserId = 9001, Status = "completed", TotalAmount = 50m });
        await db.SaveChangesAsync();

        var result = await CreateController(db).Dashboard();

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var root = document.RootElement;
        root.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = root.GetProperty("data");
        data.GetProperty("total_listings").GetInt32().Should().Be(2);
        data.GetProperty("active_listings").GetInt32().Should().Be(1);
        data.GetProperty("pending_moderation").GetInt32().Should().Be(1);
        data.GetProperty("total_sellers").GetInt32().Should().Be(1);
        data.GetProperty("total_orders").GetInt32().Should().Be(1);
        data.GetProperty("revenue").GetDecimal().Should().Be(25m);
        data.GetProperty("currency").GetString().Should().Be("EUR");
    }

    [Fact]
    public async Task Listings_ReturnsLaravelReactAdminRowsAndPagination()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);

        var category = new MarketplaceCategory
        {
            TenantId = 42,
            Name = "Tools",
            Slug = "tools",
            IsActive = true
        };
        db.MarketplaceCategories.Add(category);
        db.Users.Add(CreateUser(1001, "seller@example.test"));
        await db.SaveChangesAsync();

        db.MarketplaceListings.AddRange(
            CreateListing(1, userId: 1001, category.Id, "Hidden rejected", moderationStatus: "rejected"),
            CreateListing(2, userId: 1001, category.Id, "Visible pending", moderationStatus: "pending"),
            CreateListing(3, userId: 1001, category.Id, "Other tenant pending", tenantId: 99, moderationStatus: "pending"));
        db.MarketplaceImages.Add(new MarketplaceImage
        {
            TenantId = 42,
            MarketplaceListingId = 2,
            Url = "https://cdn.example.test/drill.jpg",
            SortOrder = 0
        });
        await db.SaveChangesAsync();

        var result = await CreateController(db).Listings(page: 1, limit: 20, moderation_status: "pending", q: "Visible");

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var root = document.RootElement;
        root.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = root.GetProperty("data").EnumerateArray().ToArray();
        data.Should().ContainSingle();
        var row = data[0];
        row.GetProperty("id").GetInt32().Should().Be(2);
        row.GetProperty("title").GetString().Should().Be("Visible pending");
        row.GetProperty("price").GetDecimal().Should().Be(12.50m);
        row.GetProperty("price_currency").GetString().Should().Be("EUR");
        row.GetProperty("price_type").GetString().Should().Be("fixed");
        row.GetProperty("status").GetString().Should().Be("active");
        row.GetProperty("moderation_status").GetString().Should().Be("pending");
        row.GetProperty("seller_type").GetString().Should().Be("private");
        row.GetProperty("views_count").GetInt32().Should().Be(7);
        row.GetProperty("image").GetString().Should().Be("https://cdn.example.test/drill.jpg");
        row.GetProperty("category").GetString().Should().Be("Tools");
        row.GetProperty("user").GetProperty("id").GetInt32().Should().Be(1001);
        row.GetProperty("user").GetProperty("name").GetString().Should().Be("Seller 1001");
        row.GetProperty("created_at").GetString().Should().StartWith("2026-07-08");
        var meta = root.GetProperty("meta");
        meta.GetProperty("total").GetInt32().Should().Be(1);
        meta.GetProperty("page").GetInt32().Should().Be(1);
        meta.GetProperty("per_page").GetInt32().Should().Be(20);
    }

    [Fact]
    public async Task ListingModerationActions_ReturnLaravelReactMessageEnvelopesAndStateTransitions()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);

        db.MarketplaceListings.AddRange(
            CreateListing(31, userId: 1001, categoryId: null, "Draft approval", status: "draft", moderationStatus: "pending"),
            CreateListing(32, userId: 1001, categoryId: null, "Reject me", status: "active", moderationStatus: "pending"),
            CreateListing(33, userId: 1001, categoryId: null, "Remove me", status: "active", moderationStatus: "approved"));
        await db.SaveChangesAsync();

        var controller = CreateController(db);

        var approve = await controller.ApproveListing(31);

        var approveOk = approve.Should().BeOfType<OkObjectResult>().Subject;
        using var approveDocument = JsonDocument.Parse(JsonSerializer.Serialize(approveOk.Value));
        var approveRoot = approveDocument.RootElement;
        approveRoot.GetProperty("success").GetBoolean().Should().BeTrue();
        approveRoot.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
        var approved = await db.MarketplaceListings.FindAsync(31);
        approved!.ModerationStatus.Should().Be("approved");
        approved.Status.Should().Be("active");
        approved.ModerationNotes.Should().BeNull();

        var reject = await controller.RejectListing(32, new AdminModerationRequest("Policy issue"));

        var rejectOk = reject.Should().BeOfType<OkObjectResult>().Subject;
        using var rejectDocument = JsonDocument.Parse(JsonSerializer.Serialize(rejectOk.Value));
        var rejectRoot = rejectDocument.RootElement;
        rejectRoot.GetProperty("success").GetBoolean().Should().BeTrue();
        rejectRoot.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
        var rejected = await db.MarketplaceListings.FindAsync(32);
        rejected!.ModerationStatus.Should().Be("rejected");
        rejected.Status.Should().Be("removed");
        rejected.ModerationNotes.Should().Be("Policy issue");

        var delete = await controller.DeleteListing(33);

        var deleteOk = delete.Should().BeOfType<OkObjectResult>().Subject;
        using var deleteDocument = JsonDocument.Parse(JsonSerializer.Serialize(deleteOk.Value));
        var deleteRoot = deleteDocument.RootElement;
        deleteRoot.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteRoot.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
        var removed = await db.MarketplaceListings.FindAsync(33);
        removed.Should().NotBeNull();
        removed!.Status.Should().Be("removed");
        removed.ModerationStatus.Should().Be("rejected");
    }

    [Fact]
    public async Task BulkReject_ReturnsLaravelReactBulkResultAndAcceptsListingIdsReasonPayload()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);

        db.MarketplaceListings.AddRange(
            CreateListing(41, userId: 1001, categoryId: null, "Bulk one", status: "active", moderationStatus: "pending"),
            CreateListing(42, userId: 1001, categoryId: null, "Bulk two", status: "active", moderationStatus: "pending"),
            CreateListing(43, userId: 1001, categoryId: null, "Other tenant", tenantId: 99, status: "active", moderationStatus: "pending"));
        await db.SaveChangesAsync();

        var request = CreateBulkModerationRequest(listingIds: new[] { 41, 42, 43, 999 }, reason: "Bulk policy issue");

        var result = await InvokeBulkReject(CreateController(db), request);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var root = document.RootElement;
        root.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = root.GetProperty("data");
        data.GetProperty("success").GetInt32().Should().Be(2);
        data.GetProperty("failed").GetInt32().Should().Be(2);
        data.GetProperty("skipped_ids").EnumerateArray().Select(x => x.GetInt32()).Should().BeEquivalentTo(new[] { 43, 999 });

        var first = await db.MarketplaceListings.FindAsync(41);
        first!.Status.Should().Be("removed");
        first.ModerationStatus.Should().Be("rejected");
        first.ModerationNotes.Should().Be("Bulk policy issue");

        var second = await db.MarketplaceListings.FindAsync(42);
        second!.Status.Should().Be("removed");
        second.ModerationStatus.Should().Be("rejected");
        second.ModerationNotes.Should().Be("Bulk policy issue");

        var otherTenant = await db.MarketplaceListings.FindAsync(43);
        otherTenant!.Status.Should().Be("active");
        otherTenant.ModerationStatus.Should().Be("pending");
    }

    [Fact]
    public async Task Sellers_ReturnsLaravelReactRowsAndSupportsFrontendFilters()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);

        db.Users.AddRange(
            CreateUser(1001, "acme@example.test"),
            CreateUser(1002, "verified@example.test"),
            CreateUser(1003, "private@example.test"));
        db.MarketplaceSellerProfiles.AddRange(
            new MarketplaceSellerProfile
            {
                Id = 11,
                TenantId = 42,
                UserId = 1001,
                DisplayName = "ACME Tools",
                SellerType = "business",
                IsVerified = false,
                RatingAverage = 4.7m,
                RatingCount = 12,
                SalesCount = 5,
                CreatedAt = new DateTime(2026, 7, 8, 8, 0, 0, DateTimeKind.Utc)
            },
            new MarketplaceSellerProfile
            {
                Id = 12,
                TenantId = 42,
                UserId = 1002,
                DisplayName = "Verified Tools",
                SellerType = "business",
                IsVerified = true
            },
            new MarketplaceSellerProfile
            {
                Id = 13,
                TenantId = 42,
                UserId = 1003,
                DisplayName = "Private Seller",
                SellerType = "private",
                IsVerified = false
            });
        db.MarketplaceListings.AddRange(
            CreateListing(21, userId: 1001, categoryId: null, "Active one", status: "active", moderationStatus: "approved"),
            CreateListing(22, userId: 1001, categoryId: null, "Active two", status: "active", moderationStatus: "pending"),
            CreateListing(23, userId: 1001, categoryId: null, "Removed listing", status: "removed", moderationStatus: "rejected"),
            CreateListing(24, userId: 1002, categoryId: null, "Other seller", status: "active", moderationStatus: "approved"));
        await db.SaveChangesAsync();

        var result = await InvokeSellers(
            CreateController(db),
            page: 1,
            perPage: 20,
            sellerType: "business",
            verified: "0",
            search: "ACME");

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var root = document.RootElement;
        root.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = root.GetProperty("data").EnumerateArray().ToArray();
        data.Should().ContainSingle();
        var seller = data[0];
        seller.GetProperty("id").GetInt32().Should().Be(11);
        seller.GetProperty("user_id").GetInt32().Should().Be(1001);
        seller.GetProperty("display_name").GetString().Should().Be("ACME Tools");
        seller.GetProperty("seller_type").GetString().Should().Be("business");
        seller.GetProperty("business_name").GetString().Should().Be("ACME Tools");
        seller.GetProperty("business_verified").GetBoolean().Should().BeFalse();
        seller.GetProperty("is_community_endorsed").GetBoolean().Should().BeFalse();
        seller.GetProperty("active_listings").GetInt32().Should().Be(2);
        seller.GetProperty("total_sales").GetInt32().Should().Be(5);
        seller.GetProperty("avg_rating").GetDecimal().Should().Be(4.7m);
        seller.GetProperty("total_ratings").GetInt32().Should().Be(12);
        seller.GetProperty("joined_marketplace_at").GetString().Should().StartWith("2026-07-08");
        seller.GetProperty("user").GetProperty("id").GetInt32().Should().Be(1001);
        seller.GetProperty("user").GetProperty("name").GetString().Should().Be("Seller 1001");
        seller.GetProperty("user").GetProperty("email").GetString().Should().Be("acme@example.test");
        seller.GetProperty("user").GetProperty("avatar_url").ValueKind.Should().Be(JsonValueKind.Null);
        var meta = root.GetProperty("meta");
        meta.GetProperty("total").GetInt32().Should().Be(1);
        meta.GetProperty("page").GetInt32().Should().Be(1);
        meta.GetProperty("per_page").GetInt32().Should().Be(20);
    }

    [Fact]
    public async Task SellerVerifyAndSuspend_ReturnLaravelReactMutationEnvelopesAndListingSideEffects()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);

        db.Users.Add(CreateUser(1001, "seller@example.test"));
        db.MarketplaceSellerProfiles.Add(new MarketplaceSellerProfile
        {
            Id = 11,
            TenantId = 42,
            UserId = 1001,
            DisplayName = "ACME Tools",
            SellerType = "business",
            IsVerified = false
        });
        db.MarketplaceListings.AddRange(
            CreateListing(21, userId: 1001, categoryId: null, "Active one", status: "active", moderationStatus: "approved"),
            CreateListing(22, userId: 1001, categoryId: null, "Other tenant", tenantId: 99, status: "active", moderationStatus: "approved"));
        await db.SaveChangesAsync();

        var controller = CreateController(db);

        var verify = await controller.VerifySeller(11);

        var verifyOk = verify.Should().BeOfType<OkObjectResult>().Subject;
        using var verifyDocument = JsonDocument.Parse(JsonSerializer.Serialize(verifyOk.Value));
        var verifyRoot = verifyDocument.RootElement;
        verifyRoot.GetProperty("success").GetBoolean().Should().BeTrue();
        verifyRoot.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
        (await db.MarketplaceSellerProfiles.FindAsync(11))!.IsVerified.Should().BeTrue();

        var suspend = await InvokeSuspendSeller(controller, 11);

        var suspendOk = suspend.Should().BeOfType<OkObjectResult>().Subject;
        using var suspendDocument = JsonDocument.Parse(JsonSerializer.Serialize(suspendOk.Value));
        var suspendRoot = suspendDocument.RootElement;
        suspendRoot.GetProperty("success").GetBoolean().Should().BeTrue();
        suspendRoot.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
        var suspendedListing = await db.MarketplaceListings.FindAsync(21);
        suspendedListing!.Status.Should().Be("removed");
        suspendedListing.ModerationStatus.Should().Be("rejected");
        var otherTenantListing = await db.MarketplaceListings.FindAsync(22);
        otherTenantListing!.Status.Should().Be("active");
    }

    [Fact]
    public async Task Coupons_ReturnsLaravelReactItemsEnvelopeWithFormattedCouponRows()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);

        db.MerchantCoupons.Add(new MerchantCoupon
        {
            TenantId = 42,
            SellerUserId = 1001,
            Code = "SAVE10",
            Title = "Save ten",
            Description = "Ten percent off",
            DiscountType = "percent",
            DiscountAmount = 10m,
            Status = "active",
            IsActive = true,
            UsageCount = 3,
            ExpiresAt = new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc)
        });
        db.MerchantCoupons.Add(new MerchantCoupon
        {
            TenantId = 99,
            SellerUserId = 9001,
            Code = "OTHER",
            Title = "Other tenant",
            DiscountType = "fixed",
            DiscountAmount = 500m,
            Status = "active",
            IsActive = true
        });
        await db.SaveChangesAsync();

        var result = await CreateController(db).Coupons();

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var root = document.RootElement;
        root.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = root.GetProperty("data");
        var items = data.GetProperty("items").EnumerateArray().ToArray();
        items.Should().ContainSingle();
        var item = items[0];
        item.GetProperty("seller_id").GetInt32().Should().Be(1001);
        item.GetProperty("code").GetString().Should().Be("SAVE10");
        item.GetProperty("title").GetString().Should().Be("Save ten");
        item.GetProperty("discount_type").GetString().Should().Be("percent");
        item.GetProperty("discount_value").GetDecimal().Should().Be(10m);
        item.GetProperty("status").GetString().Should().Be("active");
        item.GetProperty("usage_count").GetInt32().Should().Be(3);
        item.GetProperty("valid_until").GetString().Should().StartWith("2026-08-01");
        root.GetProperty("meta").GetProperty("total").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task CouponSuspendAndDelete_ReturnLaravelReactMutationEnvelopes()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);

        var coupon = new MerchantCoupon
        {
            TenantId = 42,
            SellerUserId = 1001,
            Code = "PAUSEME",
            Title = "Pause me",
            DiscountType = "fixed",
            DiscountAmount = 500m,
            Status = "active",
            IsActive = true
        };
        db.MerchantCoupons.Add(coupon);
        await db.SaveChangesAsync();

        var controller = CreateController(db);

        var suspend = await controller.SuspendCoupon(coupon.Id);

        var suspendOk = suspend.Should().BeOfType<OkObjectResult>().Subject;
        using var suspendDocument = JsonDocument.Parse(JsonSerializer.Serialize(suspendOk.Value));
        var suspendRoot = suspendDocument.RootElement;
        suspendRoot.GetProperty("success").GetBoolean().Should().BeTrue();
        var suspended = suspendRoot.GetProperty("data");
        suspended.GetProperty("id").GetInt32().Should().Be(coupon.Id);
        suspended.GetProperty("status").GetString().Should().Be("paused");

        var delete = await controller.DeleteCoupon(coupon.Id);

        var deleteOk = delete.Should().BeOfType<OkObjectResult>().Subject;
        using var deleteDocument = JsonDocument.Parse(JsonSerializer.Serialize(deleteOk.Value));
        var deleteRoot = deleteDocument.RootElement;
        deleteRoot.GetProperty("success").GetBoolean().Should().BeTrue();
        deleteRoot.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        (await db.MerchantCoupons.AnyAsync(c => c.Id == coupon.Id)).Should().BeFalse();
    }

    private static AdminMarketplaceController CreateController(NexusDbContext db)
    {
        var controller = new AdminMarketplaceController(new MarketplaceService(db, NullLogger<MarketplaceService>.Instance), db);
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, "9001"),
                    new Claim(ClaimTypes.Role, "Admin")
                }, "UnitTest"))
            }
        };
        return controller;
    }

    private static async Task<IActionResult> InvokeSellers(
        AdminMarketplaceController controller,
        int page,
        int perPage,
        string? sellerType,
        string? verified,
        string? search)
    {
        var method = typeof(AdminMarketplaceController).GetMethod(nameof(AdminMarketplaceController.Sellers))!;
        var parameters = method.GetParameters();
        parameters.Select(p => p.Name).Should().Contain(new[] { "page", "per_page", "seller_type", "verified", "search" });

        var arguments = parameters.Select(parameter => parameter.Name switch
        {
            "page" => (object)page,
            "per_page" => perPage,
            "limit" => 50,
            "seller_type" => sellerType,
            "verified" => verified,
            "search" => search,
            _ => parameter.HasDefaultValue ? parameter.DefaultValue : null
        }).ToArray();

        var task = (Task<IActionResult>)method.Invoke(controller, arguments)!;
        return await task;
    }

    private static AdminBulkModerationRequest CreateBulkModerationRequest(int[] listingIds, string reason)
    {
        var type = typeof(AdminBulkModerationRequest);
        var constructor = type.GetConstructors().Single();
        var parameters = constructor.GetParameters();
        parameters.Select(p => p.Name).Should().Contain(new[] { "ListingIds", "Reason" });

        var arguments = parameters.Select(parameter => parameter.Name switch
        {
            "Ids" => null,
            "Notes" => null,
            "ListingIds" => listingIds,
            "Reason" => reason,
            _ => parameter.HasDefaultValue ? parameter.DefaultValue : null
        }).ToArray();

        return (AdminBulkModerationRequest)constructor.Invoke(arguments);
    }

    private static async Task<IActionResult> InvokeBulkReject(AdminMarketplaceController controller, AdminBulkModerationRequest request)
    {
        var method = typeof(AdminMarketplaceController).GetMethod(nameof(AdminMarketplaceController.BulkReject))!;
        var task = (Task<IActionResult>)method.Invoke(controller, new object?[] { request })!;
        return await task;
    }

    private static async Task<IActionResult> InvokeSuspendSeller(AdminMarketplaceController controller, int id)
    {
        var method = typeof(AdminMarketplaceController).GetMethod(nameof(AdminMarketplaceController.SuspendSeller))!;
        var parameters = method.GetParameters();
        parameters[0].Name.Should().Be("id");
        parameters.Skip(1).Should().OnlyContain(parameter => parameter.IsOptional);

        var arguments = parameters.Select(parameter => parameter.Name == "id" ? id : parameter.DefaultValue).ToArray();
        var task = (Task<IActionResult>)method.Invoke(controller, arguments)!;
        return await task;
    }

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(tenantId);
        return tenantContext;
    }

    private static NexusDbContext CreateDbContext(TenantContext tenantContext)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenantContext);
    }

    private static User CreateUser(int id, string email)
        => new()
        {
            Id = id,
            TenantId = 42,
            Email = email,
            PasswordHash = "hash",
            FirstName = "Seller",
            LastName = id.ToString(),
            Role = "member",
            IsActive = true
        };

    private static MarketplaceListing CreateListing(
        int id,
        int userId,
        int? categoryId,
        string title,
        int tenantId = 42,
        string status = "active",
        string moderationStatus = "pending")
        => new()
        {
            Id = id,
            TenantId = tenantId,
            UserId = userId,
            CategoryId = categoryId,
            Title = title,
            Description = $"{title} description",
            Price = 12.50m,
            PriceCurrency = "EUR",
            PriceType = "fixed",
            Status = status,
            ModerationStatus = moderationStatus,
            SellerType = "private",
            ViewsCount = 7,
            CreatedAt = new DateTime(2026, 7, 8, 9, 0, 0, DateTimeKind.Utc).AddMinutes(id)
        };
}
