// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class MarketplaceCategoryListingsControllerUnitTests
{
    [Fact]
    public async Task Categories_ReturnsLaravelReactCategoryRowsWithApprovedActiveListingCounts()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);

        var tools = new MarketplaceCategory
        {
            TenantId = 42,
            Name = "Tools",
            Slug = "tools",
            Description = "Shared tools",
            Icon = "wrench",
            SortOrder = 2,
            IsActive = true
        };
        var garden = new MarketplaceCategory
        {
            TenantId = 42,
            Name = "Garden",
            Slug = "garden",
            Description = "Garden items",
            Icon = "leaf",
            SortOrder = 1,
            IsActive = true
        };
        var inactive = new MarketplaceCategory
        {
            TenantId = 42,
            Name = "Hidden",
            Slug = "hidden",
            IsActive = false
        };
        db.MarketplaceCategories.AddRange(tools, garden, inactive);
        await db.SaveChangesAsync();

        db.Users.Add(CreateUser(100, "seller-100@example.test"));
        await db.SaveChangesAsync();

        db.MarketplaceListings.AddRange(
            CreateApprovedListing(10, tools.Id, "Visible drill"),
            CreateApprovedListing(20, tools.Id, "Visible saw"),
            new MarketplaceListing
            {
                Id = 30,
                TenantId = 42,
                UserId = 100,
                CategoryId = tools.Id,
                Title = "Pending listing",
                Description = "Does not count",
                Status = "active",
                ModerationStatus = "pending"
            },
            new MarketplaceListing
            {
                Id = 40,
                TenantId = 42,
                UserId = 100,
                CategoryId = garden.Id,
                Title = "Draft listing",
                Description = "Does not count",
                Status = "draft",
                ModerationStatus = "approved"
            });
        await db.SaveChangesAsync();

        var result = await CreateController(db).Categories();

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var root = document.RootElement;
        root.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = root.GetProperty("data").EnumerateArray().ToArray();
        data.Select(item => item.GetProperty("slug").GetString()).Should().Equal("garden", "tools");
        data[0].GetProperty("listing_count").GetInt32().Should().Be(0);
        data[0].GetProperty("parent_id").ValueKind.Should().Be(JsonValueKind.Null);
        data[1].GetProperty("id").GetInt32().Should().Be(tools.Id);
        data[1].GetProperty("name").GetString().Should().Be("Tools");
        data[1].GetProperty("description").GetString().Should().Be("Shared tools");
        data[1].GetProperty("icon").GetString().Should().Be("wrench");
        data[1].GetProperty("listing_count").GetInt32().Should().Be(2);
        root.GetProperty("meta").GetProperty("total").GetInt32().Should().Be(2);
    }

    [Fact]
    public async Task CategoryListings_ReturnsActiveApprovedListingsForActiveTenantCategorySlug()
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
        var otherCategory = new MarketplaceCategory
        {
            TenantId = 42,
            Name = "Garden",
            Slug = "garden",
            IsActive = true
        };
        db.MarketplaceCategories.AddRange(category, otherCategory);
        await db.SaveChangesAsync();

        db.Users.AddRange(
            CreateUser(100, "seller-100@example.test"),
            CreateUser(101, "seller-101@example.test"),
            CreateUser(102, "seller-102@example.test"));
        await db.SaveChangesAsync();

        db.MarketplaceListings.AddRange(
            new MarketplaceListing
            {
                TenantId = 42,
                UserId = 100,
                CategoryId = category.Id,
                Title = "Tenant toolbox",
                Description = "A shared toolbox",
                Status = "active",
                ModerationStatus = "approved",
                CreatedAt = new DateTime(2026, 7, 5, 10, 0, 0, DateTimeKind.Utc)
            },
            new MarketplaceListing
            {
                TenantId = 42,
                UserId = 101,
                CategoryId = category.Id,
                Title = "Pending drill",
                Description = "Should stay hidden until approved",
                Status = "active",
                ModerationStatus = "pending",
                CreatedAt = new DateTime(2026, 7, 5, 11, 0, 0, DateTimeKind.Utc)
            },
            new MarketplaceListing
            {
                TenantId = 42,
                UserId = 102,
                CategoryId = otherCategory.Id,
                Title = "Garden fork",
                Description = "Different category",
                Status = "active",
                ModerationStatus = "approved",
                CreatedAt = new DateTime(2026, 7, 5, 12, 0, 0, DateTimeKind.Utc)
            });
        await db.SaveChangesAsync();

        var result = await InvokeCategoryListingsAsync(CreateController(db), "tools");

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data").EnumerateArray().ToArray();
        var meta = document.RootElement.GetProperty("meta");

        data.Should().HaveCount(1);
        data[0].GetProperty("title").GetString().Should().Be("Tenant toolbox");
        meta.GetProperty("per_page").GetInt32().Should().Be(20);
        meta.GetProperty("has_more").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task CategoryListings_ReturnsEmptyCollectionForUnknownOrInactiveCategorySlug()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);

        db.MarketplaceCategories.Add(new MarketplaceCategory
        {
            TenantId = 42,
            Name = "Inactive Tools",
            Slug = "tools",
            IsActive = false
        });
        await db.SaveChangesAsync();

        var result = await InvokeCategoryListingsAsync(CreateController(db), "tools");

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").EnumerateArray().Should().BeEmpty();
        var meta = document.RootElement.GetProperty("meta");
        meta.GetProperty("per_page").GetInt32().Should().Be(20);
        meta.GetProperty("has_more").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task CategoryListings_UsesLaravelStyleIdCursorPagination()
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
        await db.SaveChangesAsync();

        db.Users.Add(CreateUser(100, "seller-100@example.test"));
        await db.SaveChangesAsync();

        db.MarketplaceListings.AddRange(
            CreateApprovedListing(10, category.Id, "Oldest"),
            CreateApprovedListing(20, category.Id, "Middle"),
            CreateApprovedListing(30, category.Id, "Newest"));
        await db.SaveChangesAsync();

        var firstPage = await InvokeCategoryListingsAsync(CreateController(db), "tools", limit: 2);

        var firstOk = firstPage.Should().BeOfType<OkObjectResult>().Subject;
        using var firstDocument = JsonDocument.Parse(JsonSerializer.Serialize(firstOk.Value));
        var firstData = firstDocument.RootElement.GetProperty("data").EnumerateArray().ToArray();
        var firstMeta = firstDocument.RootElement.GetProperty("meta");

        firstData.Select(item => item.GetProperty("id").GetInt32()).Should().Equal(30, 20);
        firstMeta.GetProperty("has_more").GetBoolean().Should().BeTrue();
        var cursor = firstMeta.GetProperty("cursor").GetString();
        cursor.Should().Be(Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("20")));

        var secondPage = await InvokeCategoryListingsAsync(CreateController(db), "tools", limit: 2, cursor: cursor);

        var secondOk = secondPage.Should().BeOfType<OkObjectResult>().Subject;
        using var secondDocument = JsonDocument.Parse(JsonSerializer.Serialize(secondOk.Value));
        var secondData = secondDocument.RootElement.GetProperty("data").EnumerateArray().ToArray();
        var secondMeta = secondDocument.RootElement.GetProperty("meta");

        secondData.Select(item => item.GetProperty("id").GetInt32()).Should().Equal(10);
        secondMeta.GetProperty("has_more").GetBoolean().Should().BeFalse();
        secondMeta.TryGetProperty("cursor", out _).Should().BeFalse();
    }

    [Fact]
    public async Task CategoryTemplate_ReturnsLaravelReactEmptyTemplateContract()
    {
        var tenantContext = CreateTenantContext(42);
        await using var db = CreateDbContext(tenantContext);

        var category = new MarketplaceCategory
        {
            TenantId = 42,
            Name = "Furniture",
            Slug = "furniture",
            IsActive = true
        };
        db.MarketplaceCategories.Add(category);
        await db.SaveChangesAsync();

        var result = CreateController(db).CategoryTemplate(category.Id);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var root = document.RootElement;
        root.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = root.GetProperty("data");
        data.GetProperty("category_id").GetInt32().Should().Be(category.Id);
        data.GetProperty("name").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("fields").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("fields").GetArrayLength().Should().Be(0);
    }

    private static async Task<IActionResult> InvokeCategoryListingsAsync(
        MarketplaceController controller,
        string slug,
        int limit = 20,
        string? cursor = null)
    {
        var method = typeof(MarketplaceController)
            .GetMethods(BindingFlags.Instance | BindingFlags.Public)
            .SingleOrDefault(method => method
                .GetCustomAttributes<HttpGetAttribute>()
                .Any(attribute => attribute.Template == "categories/{slug}/listings"));

        method.Should().NotBeNull("Laravel exposes GET /v2/marketplace/categories/{slug}/listings");

        var args = method!.GetParameters()
            .Select(parameter => BuildArgument(parameter, slug, limit, cursor))
            .ToArray();

        var resultTask = (Task<IActionResult>)method.Invoke(controller, args)!;
        return await resultTask;
    }

    private static object? BuildArgument(ParameterInfo parameter, string slug, int limit, string? cursor)
    {
        if (parameter.Name == "slug")
            return slug;
        if (parameter.Name == "limit")
            return limit;
        if (parameter.Name == "cursor")
            return cursor;
        if (parameter.ParameterType == typeof(CancellationToken))
            return CancellationToken.None;
        if (parameter.HasDefaultValue)
            return parameter.DefaultValue;

        throw new InvalidOperationException($"No test argument configured for {parameter.Name}.");
    }

    private static MarketplaceController CreateController(NexusDbContext db)
    {
        return new MarketplaceController(
            new MarketplaceService(db, NullLogger<MarketplaceService>.Instance),
            db);
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

    private static MarketplaceListing CreateApprovedListing(int id, int categoryId, string title)
        => new()
        {
            Id = id,
            TenantId = 42,
            UserId = 100,
            CategoryId = categoryId,
            Title = title,
            Description = $"{title} description",
            Status = "active",
            ModerationStatus = "approved",
            CreatedAt = new DateTime(2026, 7, 5, 10, 0, 0, DateTimeKind.Utc).AddMinutes(id)
        };
}
