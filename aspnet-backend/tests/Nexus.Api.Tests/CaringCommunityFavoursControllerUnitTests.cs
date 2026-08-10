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
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class CaringCommunityFavoursControllerUnitTests
{
    private const string MemberControllerTypeName = "Nexus.Api.Controllers.CaringCommunityFavoursController, Nexus.Api";
    private const string OfferFavourRequestTypeName = "Nexus.Api.Controllers.OfferFavourRequest, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelAdminFavoursRoute()
    {
        typeof(AdminCaringCommunityFavoursController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/favours");

        typeof(AdminCaringCommunityFavoursController)
            .GetMethod(nameof(AdminCaringCommunityFavoursController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
    }

    [Fact]
    public void Actions_ExposeLaravelMemberOfferFavourRoute()
    {
        var controller = Resolve(MemberControllerTypeName);

        controller.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community");
        controller.GetCustomAttribute<AuthorizeAttribute>().Should().NotBeNull();
        var action = controller.GetMethod("OfferFavour");
        action.Should().NotBeNull();
        action!.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("offer-favour");
    }

    [Fact]
    public async Task Index_ReturnsTenantFavoursOrderedByCreatedAtWithAnonymousOfferersHidden()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);

        db.CaringFavours.AddRange(
            new CaringFavour
            {
                TenantId = 42,
                OfferedByUserId = 10,
                Category = "shopping",
                Description = "Picked up groceries",
                FavourDate = new DateOnly(2026, 7, 1),
                IsAnonymous = false,
                CreatedAt = new DateTime(2026, 7, 3, 12, 0, 0, DateTimeKind.Utc)
            },
            new CaringFavour
            {
                TenantId = 42,
                OfferedByUserId = 11,
                Category = null,
                Description = "Quiet check-in",
                FavourDate = new DateOnly(2026, 7, 2),
                IsAnonymous = true,
                CreatedAt = new DateTime(2026, 7, 3, 13, 0, 0, DateTimeKind.Utc)
            },
            new CaringFavour
            {
                TenantId = 7,
                OfferedByUserId = 70,
                Category = "meals",
                Description = "Other tenant",
                FavourDate = new DateOnly(2026, 7, 2),
                IsAnonymous = false,
                CreatedAt = new DateTime(2026, 7, 3, 14, 0, 0, DateTimeKind.Utc)
            });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Index(CancellationToken.None);

        var data = ReadData(result);
        data.GetProperty("count").GetInt32().Should().Be(2);
        var items = data.GetProperty("items").EnumerateArray().ToArray();
        items.Should().HaveCount(2);

        items[0].GetProperty("description").GetString().Should().Be("Quiet check-in");
        items[0].GetProperty("category").ValueKind.Should().Be(JsonValueKind.Null);
        items[0].GetProperty("is_anonymous").GetBoolean().Should().BeTrue();
        items[0].GetProperty("offerer_name").ValueKind.Should().Be(JsonValueKind.Null);

        items[1].GetProperty("description").GetString().Should().Be("Picked up groceries");
        items[1].GetProperty("category").GetString().Should().Be("shopping");
        items[1].GetProperty("favour_date").GetString().Should().Be("2026-07-01");
        items[1].GetProperty("offerer_name").GetString().Should().Be("Ada Lovelace");
        items[1].GetProperty("created_at").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Index_LimitsItemsToLatestFiftyButCountIncludesAllTenantRows()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.Add(new User
        {
            Id = 10,
            TenantId = 42,
            FirstName = "Ada",
            LastName = "Lovelace",
            Email = "ada@example.test",
            PasswordHash = "x",
            Role = Role.Names.Member
        });

        for (var i = 0; i < 55; i++)
        {
            db.CaringFavours.Add(new CaringFavour
            {
                TenantId = 42,
                OfferedByUserId = 10,
                Description = $"Favour {i:00}",
                FavourDate = new DateOnly(2026, 7, 1),
                CreatedAt = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc).AddMinutes(i)
            });
        }
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Index(CancellationToken.None);

        var data = ReadData(result);
        data.GetProperty("count").GetInt32().Should().Be(55);
        var items = data.GetProperty("items").EnumerateArray().ToArray();
        items.Should().HaveCount(50);
        items[0].GetProperty("description").GetString().Should().Be("Favour 54");
        items[^1].GetProperty("description").GetString().Should().Be("Favour 05");
    }

    [Fact]
    public async Task Index_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Index(CancellationToken.None);

        AssertSingleError(result, StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
    }

    [Fact]
    public async Task OfferFavour_RecordsTenantFavourAndReturnsLaravelCreatedSuccess()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        var result = await Invoke(controller, "OfferFavour", OfferRequest(
            " Picked up prescriptions ",
            "surprise-kindness",
            "Neighbour Name",
            "2026-07-05",
            true), CancellationToken.None);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("success").GetBoolean().Should().BeTrue();
        data.GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        var saved = await db.CaringFavours.IgnoreQueryFilters().SingleAsync();
        saved.TenantId.Should().Be(42);
        saved.OfferedByUserId.Should().Be(10);
        saved.ReceivedByUserId.Should().BeNull();
        saved.Category.Should().Be("other");
        saved.Description.Should().Be("Picked up prescriptions");
        saved.FavourDate.Should().Be(new DateOnly(2026, 7, 5));
        saved.IsAnonymous.Should().BeTrue();
        saved.CreatedAt.Should().NotBe(default);
        saved.UpdatedAt.Should().NotBeNull();
        db.Transactions.IgnoreQueryFilters().Should().BeEmpty();
    }

    [Fact]
    public async Task OfferFavour_DefaultsEmptyDateAndCategoryAndKeepsTenantIsolation()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        db.CaringFavours.Add(new CaringFavour
        {
            TenantId = 7,
            OfferedByUserId = 70,
            Description = "Other tenant",
            FavourDate = new DateOnly(2026, 7, 1),
            CreatedAt = new DateTime(2026, 7, 1, 10, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 11);

        var result = await Invoke(controller, "OfferFavour", OfferRequest(
            "Friendly check-in",
            "",
            "",
            "",
            false), CancellationToken.None);

        result.Should().BeOfType<ObjectResult>().Subject.StatusCode
            .Should().Be(StatusCodes.Status201Created);
        var saved = await db.CaringFavours.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == 42);
        saved.OfferedByUserId.Should().Be(11);
        saved.Category.Should().BeNull();
        saved.FavourDate.Should().Be(DateOnly.FromDateTime(DateTime.UtcNow));
        saved.IsAnonymous.Should().BeFalse();

        var otherTenant = await db.CaringFavours.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == 7);
        otherTenant.Description.Should().Be("Other tenant");
    }

    [Fact]
    public async Task OfferFavour_ValidatesDescriptionDateAndFeatureFlagWithLaravelErrors()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        AssertSingleError(
            await Invoke(controller, "OfferFavour", OfferRequest("", "shopping", null, "2026-07-05", false), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            "description");

        AssertSingleError(
            await Invoke(controller, "OfferFavour", OfferRequest("x", "shopping", null, "05/07/2026", false), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            "favour_date");

        var disabledTenant = CreateTenantContext(70);
        await using var disabledDb = CreateDbContext(disabledTenant);
        SeedFeature(disabledDb, 70, enabled: false);
        await disabledDb.SaveChangesAsync();
        var disabled = CreateMemberController(disabledDb, disabledTenant, userId: 70);

        AssertSingleError(
            await Invoke(disabled, "OfferFavour", OfferRequest("x", "shopping", null, "2026-07-05", false), CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED",
            null);
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
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
                Email = "ada@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 11,
                TenantId = 42,
                FirstName = "Grace",
                LastName = "Hopper",
                Email = "grace@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 70,
                TenantId = 7,
                FirstName = "Other",
                LastName = "User",
                Email = "other@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
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

    private static AdminCaringCommunityFavoursController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringFavourService(db);
        return new AdminCaringCommunityFavoursController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow())
        };
    }

    private static ControllerBase CreateMemberController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringFavourService(db);
        var controller = Activator.CreateInstance(Resolve(MemberControllerTypeName), service, tenant)
            .Should().BeAssignableTo<ControllerBase>().Subject;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), role: Role.Names.Member);
        return controller;
    }

    private static object OfferRequest(
        string? description,
        string? category,
        string? receivedByName,
        string? favourDate,
        bool isAnonymous)
    {
        var request = Activator.CreateInstance(Resolve(OfferFavourRequestTypeName))!;
        Set(request, "Description", description);
        Set(request, "Category", category);
        Set(request, "ReceivedByName", receivedByName);
        Set(request, "FavourDate", favourDate);
        Set(request, "IsAnonymous", isAnonymous);
        return request;
    }

    private static async Task<IActionResult> Invoke(object controller, string actionName, params object?[] args)
    {
        var method = controller.GetType().GetMethod(actionName);
        method.Should().NotBeNull();
        var result = method!.Invoke(controller, args);
        return await result.Should().BeAssignableTo<Task<IActionResult>>().Subject;
    }

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName);
        type.Should().NotBeNull();
        return type!;
    }

    private static void Set(object target, string propertyName, object? value)
    {
        var property = target.GetType().GetProperty(propertyName);
        property.Should().NotBeNull();
        property!.SetValue(target, value);
    }

    private static ControllerContext ControllerContextFor(int userId, int tenantId, string role = "admin")
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
