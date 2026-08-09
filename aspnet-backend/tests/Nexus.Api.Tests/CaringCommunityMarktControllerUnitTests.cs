// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests;

public sealed class CaringCommunityMarktControllerUnitTests
{
    private const string ControllerTypeName = "Nexus.Api.Controllers.CaringCommunityMarktController, Nexus.Api";
    private const string ServiceTypeName = "Nexus.Api.Services.CaringCommunityMarktService, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelMarktRoutes()
    {
        var controllerType = Type.GetType(ControllerTypeName);
        controllerType.Should().NotBeNull();
        var type = controllerType!;

        type.GetCustomAttributes<RouteAttribute>()
            .Select(attribute => attribute.Template)
            .Should().Contain(["api/caring-community/markt", "api/v2/caring-community/markt"]);

        type.GetCustomAttribute<AuthorizeAttribute>().Should().NotBeNull();

        type.GetMethod("Index")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
    }

    [Fact]
    public async Task Index_ReturnsMergedListingAndMarketplaceFeedWithLaravelFields()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeatures(db, caringCommunity: true, marketplace: true);
        SeedUsers(db);
        SeedCategories(db);

        var description = new string('x', 230);
        db.Listings.AddRange(
            LegacyListing(
                id: 100,
                tenantId: 42,
                userId: 10,
                categoryId: 1,
                title: "Repair time help",
                description: description,
                createdAt: Utc(2026, 7, 4, 10),
                hours: 1.26m,
                latitude: 47.1662,
                longitude: 8.5155,
                imageUrl: "https://cdn.test/listing.png"),
            LegacyListing(
                id: 101,
                tenantId: 42,
                userId: 10,
                categoryId: 1,
                title: "Draft should not leak",
                description: "draft",
                status: ListingStatus.Draft,
                createdAt: Utc(2026, 7, 4, 12)),
            LegacyListing(
                id: 102,
                tenantId: 7,
                userId: 70,
                categoryId: null,
                title: "Other tenant should not leak",
                description: "other",
                createdAt: Utc(2026, 7, 4, 13)));

        db.MarketplaceListings.AddRange(
            MarketplaceListing(
                id: 200,
                tenantId: 42,
                userId: 20,
                categoryId: 2,
                title: "Market care basket",
                createdAt: Utc(2026, 7, 4, 11),
                price: 42m,
                priceType: "fixed",
                timeCreditPrice: 2.26m,
                latitude: 47.1663,
                longitude: 8.5156),
            MarketplaceListing(
                id: 201,
                tenantId: 42,
                userId: 20,
                categoryId: 2,
                title: "Rejected should not leak",
                createdAt: Utc(2026, 7, 4, 12),
                moderationStatus: "rejected"),
            MarketplaceListing(
                id: 202,
                tenantId: 7,
                userId: 70,
                categoryId: null,
                title: "Other marketplace tenant should not leak",
                createdAt: Utc(2026, 7, 4, 12)));
        db.MarketplaceImages.Add(new MarketplaceImage
        {
            Id = 300,
            TenantId = 42,
            MarketplaceListingId = 200,
            Url = "https://cdn.test/market.png",
            SortOrder = 0
        });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant, userId: 10);
        var root = ReadOk(await InvokeIndexAsync(controller, type: "all", page: 1, perPage: 20));

        var rows = root.GetProperty("data").EnumerateArray().ToArray();
        rows.Should().HaveCount(2);
        rows[0].GetProperty("source").GetString().Should().Be("marketplace");
        rows[0].GetProperty("id").GetInt32().Should().Be(200);
        rows[0].GetProperty("image_url").GetString().Should().Be("https://cdn.test/market.png");
        rows[0].GetProperty("price_cash").GetDecimal().Should().Be(42m);
        rows[0].GetProperty("price_credits").GetDecimal().Should().Be(2.3m);
        rows[0].GetProperty("price_type").GetString().Should().Be("fixed");
        rows[0].GetProperty("price_currency").GetString().Should().Be("CHF");
        rows[0].GetProperty("category").GetString().Should().Be("Care Goods");
        rows[0].GetProperty("user_name").GetString().Should().Be("Merchant Seller");
        rows[0].GetProperty("user_avatar").GetString().Should().Be("/avatars/merchant.png");
        rows[0].GetProperty("detail_path").GetString().Should().Be("/marketplace/200");

        rows[1].GetProperty("source").GetString().Should().Be("listing");
        rows[1].GetProperty("id").GetInt32().Should().Be(100);
        rows[1].GetProperty("listing_type").GetString().Should().Be("offer");
        rows[1].GetProperty("description").GetString().Should().HaveLength(200);
        rows[1].GetProperty("image_url").GetString().Should().Be("https://cdn.test/listing.png");
        rows[1].GetProperty("hours_estimate").GetDecimal().Should().Be(1.3m);
        rows[1].GetProperty("price_cash").ValueKind.Should().Be(JsonValueKind.Null);
        rows[1].GetProperty("category").GetString().Should().Be("Time Help");
        rows[1].GetProperty("user_name").GetString().Should().Be("Ada Lovelace");
        rows[1].GetProperty("detail_path").GetString().Should().Be("/listings/100");

        var meta = root.GetProperty("meta");
        meta.GetProperty("total").GetInt32().Should().Be(2);
        meta.GetProperty("page").GetInt32().Should().Be(1);
        meta.GetProperty("per_page").GetInt32().Should().Be(20);
        meta.GetProperty("has_more").GetBoolean().Should().BeFalse();
        meta.GetProperty("marketplace_available").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Index_AppliesTypeSubRegionAndFeatureFiltersLikeLaravel()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeatures(db, caringCommunity: true, marketplace: true);
        SeedUsers(db);
        SeedCategories(db);
        db.CaringSubRegions.Add(new CaringSubRegion
        {
            Id = 5,
            TenantId = 42,
            Slug = "zug-west",
            Name = "Zug West",
            Type = "quartier",
            Status = "active",
            CenterLatitude = 47.1662m,
            CenterLongitude = 8.5155m,
            CreatedBy = 9001,
            CreatedAt = Utc(2026, 7, 1),
            UpdatedAt = Utc(2026, 7, 1)
        });

        db.Listings.AddRange(
            LegacyListing(110, 42, 10, 1, "Near listing", "near", Utc(2026, 7, 4, 8), latitude: 47.1662, longitude: 8.5155),
            LegacyListing(111, 42, 10, 1, "Far listing", "far", Utc(2026, 7, 4, 9), latitude: 48.8566, longitude: 2.3522),
            LegacyListing(112, 42, 10, 1, "No coordinates", "none", Utc(2026, 7, 4, 10)));
        db.MarketplaceListings.AddRange(
            MarketplaceListing(210, 42, 20, 2, "Near marketplace", Utc(2026, 7, 4, 11), latitude: 47.1663, longitude: 8.5156),
            MarketplaceListing(211, 42, 20, 2, "Far marketplace", Utc(2026, 7, 4, 12), latitude: 48.8566, longitude: 2.3522));
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant, userId: 10);
        var root = ReadOk(await InvokeIndexAsync(
            controller,
            type: "listings",
            page: 1,
            perPage: 20,
            subRegionId: 5));

        var rows = root.GetProperty("data").EnumerateArray().ToArray();
        rows.Select(row => row.GetProperty("title").GetString())
            .Should().Equal("Near listing");
        rows[0].GetProperty("source").GetString().Should().Be("listing");
        root.GetProperty("meta").GetProperty("marketplace_available").GetBoolean().Should().BeTrue();

        var allRoot = ReadOk(await InvokeIndexAsync(
            controller,
            type: "all",
            page: 1,
            perPage: 20,
            subRegionId: 5));
        allRoot.GetProperty("data").EnumerateArray()
            .Select(row => row.GetProperty("title").GetString())
            .Should().Equal("Near marketplace", "Near listing");
    }

    [Fact]
    public async Task Index_RejectsDisabledCaringCommunityFeature()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeatures(db, caringCommunity: false, marketplace: true);
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant, userId: 10);
        var result = await InvokeIndexAsync(controller);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        var root = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value)).RootElement;
        root.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    private static async Task<IActionResult> InvokeIndexAsync(
        object controller,
        string? type = null,
        int page = 1,
        int perPage = 20,
        double? lat = null,
        double? lng = null,
        double? radiusKm = null,
        int? subRegionId = null)
    {
        var method = controller.GetType().GetMethod("Index");
        method.Should().NotBeNull();

        var result = method!.Invoke(controller, [
            type,
            page,
            perPage,
            lat,
            lng,
            radiusKm,
            subRegionId,
            CancellationToken.None
        ]);

        result.Should().BeAssignableTo<Task<IActionResult>>();
        return await (Task<IActionResult>)result!;
    }

    private static object CreateController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var serviceType = Type.GetType(ServiceTypeName);
        serviceType.Should().NotBeNull();
        var service = Activator.CreateInstance(serviceType!, db, tenant);
        service.Should().NotBeNull();

        var controllerType = Type.GetType(ControllerTypeName);
        controllerType.Should().NotBeNull();
        var controller = Activator.CreateInstance(controllerType!, service, tenant);
        controller.Should().BeAssignableTo<ControllerBase>();

        ((ControllerBase)controller!).ControllerContext = ControllerContextFor(
            userId,
            tenant.GetTenantIdOrThrow(),
            "member");

        return controller!;
    }

    private static JsonElement ReadOk(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        return document.RootElement.Clone();
    }

    private static Listing LegacyListing(
        int id,
        int tenantId,
        int userId,
        int? categoryId,
        string title,
        string description,
        DateTime createdAt,
        ListingStatus status = ListingStatus.Active,
        decimal? hours = null,
        double? latitude = null,
        double? longitude = null,
        string? imageUrl = null)
    {
        var listing = new Listing
        {
            Id = id,
            TenantId = tenantId,
            UserId = userId,
            CategoryId = categoryId,
            Title = title,
            Description = description,
            Type = ListingType.Offer,
            Status = status,
            EstimatedHours = hours,
            CreatedAt = createdAt
        };

        SetRequiredProperty(listing, "Latitude", latitude);
        SetRequiredProperty(listing, "Longitude", longitude);
        SetRequiredProperty(listing, "ImageUrl", imageUrl);
        return listing;
    }

    private static MarketplaceListing MarketplaceListing(
        int id,
        int tenantId,
        int userId,
        int? categoryId,
        string title,
        DateTime createdAt,
        decimal? price = null,
        string priceType = "fixed",
        decimal? timeCreditPrice = null,
        double? latitude = null,
        double? longitude = null,
        string moderationStatus = "approved")
    {
        return new MarketplaceListing
        {
            Id = id,
            TenantId = tenantId,
            UserId = userId,
            CategoryId = categoryId,
            Title = title,
            Description = $"Description for {title}",
            Status = "active",
            ModerationStatus = moderationStatus,
            MarketplaceStatus = "available",
            Price = price,
            PriceCurrency = "CHF",
            PriceType = priceType,
            TimeCreditPrice = timeCreditPrice,
            Latitude = latitude,
            Longitude = longitude,
            CreatedAt = createdAt
        };
    }

    private static void SetRequiredProperty(object target, string name, object? value)
    {
        var property = target.GetType().GetProperty(name);
        property.Should().NotBeNull($"{target.GetType().Name} needs {name} for Laravel markt parity");
        property!.SetValue(target, value);
    }

    private static void SeedFeatures(NexusDbContext db, bool caringCommunity, bool marketplace)
    {
        db.TenantConfigs.AddRange(
            new TenantConfig
            {
                TenantId = 42,
                Key = "features.caring_community",
                Value = caringCommunity ? "true" : "false"
            },
            new TenantConfig
            {
                TenantId = 42,
                Key = "features.marketplace",
                Value = marketplace ? "true" : "false"
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
                Email = "ada-markt@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member,
                AvatarUrl = "/avatars/ada.png"
            },
            new User
            {
                Id = 20,
                TenantId = 42,
                FirstName = "Merchant",
                LastName = "Seller",
                Email = "merchant-markt@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member,
                AvatarUrl = "/avatars/merchant.png"
            },
            new User
            {
                Id = 70,
                TenantId = 7,
                FirstName = "Other",
                LastName = "Tenant",
                Email = "other-markt@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            });
    }

    private static void SeedCategories(NexusDbContext db)
    {
        db.Categories.Add(new Category
        {
            Id = 1,
            TenantId = 42,
            Name = "Time Help",
            Slug = "time-help"
        });
        db.MarketplaceCategories.Add(new MarketplaceCategory
        {
            Id = 2,
            TenantId = 42,
            Name = "Care Goods",
            Slug = "care-goods"
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

    private static DateTime Utc(int year, int month, int day, int hour = 0)
    {
        return new DateTime(year, month, day, hour, 0, 0, DateTimeKind.Utc);
    }
}
