// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class CaringCommunityLoyaltyControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelLoyaltyRoutes()
    {
        typeof(CaringCommunityLoyaltyController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/loyalty");

        typeof(CaringCommunityLoyaltyController)
            .GetMethod(nameof(CaringCommunityLoyaltyController.Quote))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("quote");

        typeof(CaringCommunityLoyaltyController)
            .GetMethod(nameof(CaringCommunityLoyaltyController.Redeem))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("redeem");

        typeof(CaringCommunityLoyaltyController)
            .GetMethod(nameof(CaringCommunityLoyaltyController.MyHistory))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("my-history");

        typeof(AdminCaringCommunityLoyaltyController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/loyalty");

        typeof(AdminCaringCommunityLoyaltyController)
            .GetMethod(nameof(AdminCaringCommunityLoyaltyController.Redemptions))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("redemptions");

        typeof(AdminCaringCommunityLoyaltyController)
            .GetMethod(nameof(AdminCaringCommunityLoyaltyController.GetSellerSettings))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("seller-settings/{userId:int}");

        typeof(AdminCaringCommunityLoyaltyController)
            .GetMethod(nameof(AdminCaringCommunityLoyaltyController.UpdateSellerSettings))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("seller-settings");

        typeof(AdminCaringCommunityLoyaltyController)
            .GetMethod(nameof(AdminCaringCommunityLoyaltyController.ReverseRedemption))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("redemptions/{id:int}/reverse");
    }

    [Fact]
    public async Task MemberQuoteRedeemAndHistory_MatchLaravelEnvelopeAndWalletLedger()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedMarketplace(db);
        SeedBalance(db, tenantId: 42, receiverId: 10, amount: 8m);
        db.MarketplaceSellerLoyaltySettings.Add(new MarketplaceSellerLoyaltySetting
        {
            TenantId = 42,
            SellerUserId = 20,
            AcceptsTimeCredits = true,
            LoyaltyChfPerHour = 25m,
            LoyaltyMaxDiscountPct = 50
        });
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        AssertSingleError(
            await controller.Quote(sellerId: 0, listingId: 100, orderTotalChf: 100m, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            "seller_id");

        var quote = ReadData(await controller.Quote(
            sellerId: 20,
            listingId: 100,
            orderTotalChf: 100m,
            CancellationToken.None));
        quote.GetProperty("accepts").GetBoolean().Should().BeTrue();
        quote.GetProperty("member_credits").GetDecimal().Should().Be(8m);
        quote.GetProperty("exchange_rate_chf").GetDecimal().Should().Be(25m);
        quote.GetProperty("max_discount_pct").GetInt32().Should().Be(50);
        quote.GetProperty("max_credits_usable").GetDecimal().Should().Be(2m);
        quote.GetProperty("max_discount_chf").GetDecimal().Should().Be(50m);

        var redeemed = ReadData(await controller.Redeem(new CaringLoyaltyRedeemRequest
        {
            SellerId = 20,
            ListingId = 100,
            CreditsToUse = 1.5m,
            OrderTotalChf = 100m
        }, CancellationToken.None));
        redeemed.GetProperty("success").GetBoolean().Should().BeTrue();
        redeemed.GetProperty("discount_chf").GetDecimal().Should().Be(37.5m);
        redeemed.GetProperty("redemption_id").GetInt32().Should().BeGreaterThan(0);
        redeemed.GetProperty("new_wallet_balance").GetDecimal().Should().Be(6.5m);

        var redemption = await db.CaringLoyaltyRedemptions.IgnoreQueryFilters().SingleAsync();
        redemption.TenantId.Should().Be(42);
        redemption.MemberUserId.Should().Be(10);
        redemption.MerchantUserId.Should().Be(20);
        redemption.MarketplaceListingId.Should().Be(100);
        redemption.CreditsUsed.Should().Be(1.5m);
        redemption.DiscountChf.Should().Be(37.5m);
        redemption.Status.Should().Be("applied");
        redemption.RedemptionTransactionId.Should().NotBeNull();

        var ledger = await db.Transactions.IgnoreQueryFilters().ToListAsync();
        var redemptionDebit = ledger.Should().ContainSingle(t =>
            t.TenantId == 42
            && t.SenderId == 10
            && t.ReceiverId == null
            && t.Amount == 1.5m
            && t.TransactionType == PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
            && t.Description!.StartsWith("[loyalty_redemption]")).Which;
        redemption.RedemptionTransactionId.Should().Be(redemptionDebit.Id);

        var history = ReadData(await controller.MyHistory(CancellationToken.None))
            .GetProperty("items")
            .EnumerateArray()
            .ToArray();
        history.Should().HaveCount(1);
        history[0].GetProperty("merchant_name").GetString().Should().Be("Merchant Seller");
        history[0].GetProperty("listing_title").GetString().Should().Be("Swiss care basket");
        history[0].GetProperty("credits_used").GetDecimal().Should().Be(1.5m);
    }

    [Fact]
    public async Task AdminRedemptionsSellerSettingsAndReverse_AreTenantScoped()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedMarketplace(db);
        SeedBalance(db, tenantId: 42, receiverId: 10, amount: 10m);
        db.MarketplaceSellerLoyaltySettings.Add(new MarketplaceSellerLoyaltySetting
        {
            TenantId = 42,
            SellerUserId = 20,
            AcceptsTimeCredits = true,
            LoyaltyChfPerHour = 30m,
            LoyaltyMaxDiscountPct = 40
        });
        var appliedDebit = new Transaction
        {
            TenantId = 42,
            SenderId = 10,
            ReceiverId = null,
            Amount = 2m,
            Description = "[loyalty_redemption] redemption:101",
            TransactionType = PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType,
            Status = TransactionStatus.Completed,
            CreatedAt = new DateTime(2026, 7, 4, 10, 0, 0, DateTimeKind.Utc)
        };
        var appliedRedemption = Redemption(
            101,
            42,
            10,
            20,
            "applied",
            2m,
            30m,
            60m,
            200m,
            new DateTime(2026, 7, 4, 10, 0, 0, DateTimeKind.Utc));
        appliedRedemption.RedemptionTransaction = appliedDebit;
        db.Transactions.Add(appliedDebit);
        db.CaringLoyaltyRedemptions.AddRange(
            appliedRedemption,
            Redemption(102, 42, 10, 20, "reversed", 1m, 30m, 30m, 100m, new DateTime(2026, 7, 3, 10, 0, 0, DateTimeKind.Utc)),
            Redemption(201, 7, 70, 80, "applied", 99m, 99m, 99m, 99m, new DateTime(2026, 7, 5, 10, 0, 0, DateTimeKind.Utc)));
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var list = ReadData(await controller.Redemptions(limit: 10, CancellationToken.None));
        list.GetProperty("stats").GetProperty("total_redemptions").GetInt32().Should().Be(1);
        list.GetProperty("stats").GetProperty("total_credits").GetDecimal().Should().Be(2m);
        list.GetProperty("stats").GetProperty("total_discount_chf").GetDecimal().Should().Be(60m);
        var redemptions = list.GetProperty("redemptions").EnumerateArray().ToArray();
        redemptions.Should().HaveCount(2);
        redemptions[0].GetProperty("id").GetInt32().Should().Be(101);
        redemptions[0].GetProperty("member_name").GetString().Should().Be("Ada Lovelace");
        redemptions[0].GetProperty("merchant_name").GetString().Should().Be("Merchant Seller");
        redemptions.Should().NotContain(row => row.GetProperty("id").GetInt32() == 201);

        var settings = ReadData(await controller.GetSellerSettings(20, CancellationToken.None));
        settings.GetProperty("seller_user_id").GetInt32().Should().Be(20);
        settings.GetProperty("accepts_time_credits").GetBoolean().Should().BeTrue();
        settings.GetProperty("loyalty_chf_per_hour").GetDecimal().Should().Be(30m);
        settings.GetProperty("loyalty_max_discount_pct").GetInt32().Should().Be(40);

        var defaults = ReadData(await controller.GetSellerSettings(21, CancellationToken.None));
        defaults.GetProperty("accepts_time_credits").GetBoolean().Should().BeFalse();
        defaults.GetProperty("loyalty_chf_per_hour").GetDecimal().Should().Be(25m);
        defaults.GetProperty("loyalty_max_discount_pct").GetInt32().Should().Be(50);

        AssertSingleError(
            await controller.UpdateSellerSettings(new CaringLoyaltySellerSettingsRequest
            {
                SellerUserId = 0
            }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            "seller_user_id");

        var updated = ReadData(await controller.UpdateSellerSettings(new CaringLoyaltySellerSettingsRequest
        {
            SellerUserId = 20,
            AcceptsTimeCredits = false,
            LoyaltyChfPerHour = 18.456m,
            LoyaltyMaxDiscountPct = 35
        }, CancellationToken.None));
        updated.GetProperty("accepts_time_credits").GetBoolean().Should().BeFalse();
        updated.GetProperty("loyalty_chf_per_hour").GetDecimal().Should().Be(18.46m);
        updated.GetProperty("loyalty_max_discount_pct").GetInt32().Should().Be(35);

        AssertSingleError(
            await controller.ReverseRedemption(999, new CaringLoyaltyReverseRequest(), CancellationToken.None),
            StatusCodes.Status404NotFound,
            "NOT_FOUND",
            null);

        AssertSingleError(
            await controller.ReverseRedemption(101, new CaringLoyaltyReverseRequest { Reason = new string('x', 501) }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            null);

        var reversed = ReadData(await controller.ReverseRedemption(101, new CaringLoyaltyReverseRequest
        {
            Reason = "Customer refund"
        }, CancellationToken.None));
        reversed.GetProperty("redemption_id").GetInt32().Should().Be(101);
        reversed.GetProperty("credits_restored").GetDecimal().Should().Be(2m);
        reversed.GetProperty("member_new_balance").GetDecimal().Should().Be(10m);

        var row = await db.CaringLoyaltyRedemptions.IgnoreQueryFilters().SingleAsync(r => r.Id == 101);
        row.Status.Should().Be("reversed");
        row.ReversedBy.Should().Be(9001);
        row.ReversalReason.Should().Be("Customer refund");
        row.ReversedAt.Should().NotBeNull();
        row.RedemptionTransactionId.Should().Be(appliedDebit.Id);
        row.ReversalTransactionId.Should().NotBeNull();

        var ledger = await db.Transactions.IgnoreQueryFilters().ToListAsync();
        var reversal = ledger.Should().ContainSingle(t =>
            t.TenantId == 42
            && t.SenderId == null
            && t.ReceiverId == 10
            && t.Amount == 2m
            && t.TransactionType == PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
            && t.Description!.StartsWith("[loyalty_reversal]")).Which;
        row.ReversalTransactionId.Should().Be(reversal.Id);

        AssertSingleError(
            await controller.ReverseRedemption(101, new CaringLoyaltyReverseRequest(), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "REVERSAL_FAILED",
            null);
    }

    [Fact]
    public async Task Controllers_WhenFeatureDisabled_ReturnLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();

        AssertSingleError(
            await CreateMemberController(db, tenant, userId: 10).MyHistory(CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED",
            null);

        AssertSingleError(
            await CreateAdminController(db, tenant, userId: 9001).Redemptions(50, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED",
            null);
    }

    private static CaringLoyaltyRedemption Redemption(
        int id,
        int tenantId,
        int memberUserId,
        int merchantUserId,
        string status,
        decimal creditsUsed,
        decimal exchangeRate,
        decimal discount,
        decimal orderTotal,
        DateTime redeemedAt)
    {
        return new CaringLoyaltyRedemption
        {
            Id = id,
            TenantId = tenantId,
            MemberUserId = memberUserId,
            MerchantUserId = merchantUserId,
            MarketplaceListingId = tenantId == 42 ? 100 : null,
            CreditsUsed = creditsUsed,
            ExchangeRateChf = exchangeRate,
            DiscountChf = discount,
            OrderTotalChf = orderTotal,
            Status = status,
            RedeemedAt = redeemedAt,
            CreatedAt = redeemedAt,
            UpdatedAt = redeemedAt
        };
    }

    private static JsonElement ReadData(IActionResult result)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(((ObjectResult) result).Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code, string? field)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        var error = document.RootElement.GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be(code);
        if (field is not null)
        {
            error.GetProperty("field").GetString().Should().Be(field);
        }
    }

    private static void SeedFeature(NexusDbContext db, int tenantId, bool enabled)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "features.caring_community",
            Value = enabled ? "true" : "false"
        });
    }

    private static void SeedUsers(NexusDbContext db)
    {
        db.Users.AddRange(
            new User
            {
                Id = 10,
                TenantId = 42,
                FirstName = "Ada",
                LastName = "Lovelace",
                Email = "ada-loyalty@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 20,
                TenantId = 42,
                FirstName = "Merchant",
                LastName = "Seller",
                Email = "merchant-loyalty@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 21,
                TenantId = 42,
                FirstName = "No",
                LastName = "Settings",
                Email = "merchant-default-loyalty@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 70,
                TenantId = 7,
                FirstName = "Other",
                LastName = "Member",
                Email = "other-loyalty@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 80,
                TenantId = 7,
                FirstName = "Other",
                LastName = "Merchant",
                Email = "other-merchant-loyalty@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 9001,
                TenantId = 42,
                FirstName = "Admin",
                LastName = "User",
                Email = "admin-loyalty@example.test",
                PasswordHash = "x",
                Role = Role.Names.Admin
            });
    }

    private static void SeedMarketplace(NexusDbContext db)
    {
        db.MarketplaceCategories.Add(new MarketplaceCategory
        {
            Id = 1,
            TenantId = 42,
            Name = "Care",
            Slug = "care"
        });
        db.MarketplaceListings.Add(new MarketplaceListing
        {
            Id = 100,
            TenantId = 42,
            UserId = 20,
            CategoryId = 1,
            Title = "Swiss care basket",
            Description = "Local merchant offer",
            Status = "active",
            ModerationStatus = "approved",
            MarketplaceStatus = "available",
            Price = 100m,
            PriceCurrency = "CHF"
        });
    }

    private static void SeedBalance(NexusDbContext db, int tenantId, int receiverId, decimal amount)
    {
        db.Transactions.Add(new Transaction
        {
            TenantId = tenantId,
            SenderId = 9001,
            ReceiverId = receiverId,
            Amount = amount,
            Description = "Seed grant",
            Status = TransactionStatus.Completed,
            CreatedAt = DateTime.UtcNow.AddDays(-7)
        });
    }

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        return tenant;
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private static CaringCommunityLoyaltyController CreateMemberController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringLoyaltyService(db);
        return new CaringCommunityLoyaltyController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "member")
        };
    }

    private static AdminCaringCommunityLoyaltyController CreateAdminController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringLoyaltyService(db);
        return new AdminCaringCommunityLoyaltyController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
        };
    }

    private static ControllerContext ControllerContextFor(int userId, int tenantId, string role)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim("tenant_id", tenantId.ToString()),
                    new Claim(ClaimTypes.Role, role),
                    new Claim("role", role)
                ], "Test"))
            }
        };
    }
}
