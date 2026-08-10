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

public class CaringCommunityCivicDigestControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelAdminDigestCadenceRoutes()
    {
        typeof(AdminCaringCommunityCivicDigestController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/digest");

        typeof(AdminCaringCommunityCivicDigestController)
            .GetMethod(nameof(AdminCaringCommunityCivicDigestController.Cadence))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("cadence");
        typeof(AdminCaringCommunityCivicDigestController)
            .GetMethod(nameof(AdminCaringCommunityCivicDigestController.SetCadence))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("cadence");
    }

    [Fact]
    public void Actions_ExposeLaravelMemberDigestRoutes()
    {
        var controllerType = ResolveMemberDigestControllerType();

        controllerType.Should().NotBeNull();
        var type = controllerType!;
        type.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community");
        var digest = type.GetMethod("Digest");
        var prefs = type.GetMethod("Prefs");
        var updatePrefs = type.GetMethod("UpdatePrefs");

        digest.Should().NotBeNull();
        prefs.Should().NotBeNull();
        updatePrefs.Should().NotBeNull();
        digest!.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("digest");
        prefs!.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("digest/prefs");
        updatePrefs!.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("digest/prefs");
    }

    [Fact]
    public async Task Digest_ReturnsRankedTenantScopedItemsPrefsAndTenantCadence()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.AddRange(
            new TenantConfig
            {
                TenantId = 42,
                Key = CivicDigestService.TenantDefaultCadenceKey,
                Value = "monthly"
            },
            new TenantConfig
            {
                TenantId = 42,
                Key = "caring.civic_digest.user_prefs.9001",
                Value = """
                    {"cadence":"daily","preferred_sub_region_id":5,"opt_out_sources":["project"],"updated_at":1780000000}
                    """
            });
        db.CaringEmergencyAlerts.AddRange(
            new CaringEmergencyAlert
            {
                TenantId = 42,
                Title = "Storm warning",
                Body = "Please check on vulnerable neighbours.",
                IsActive = true,
                SentAt = DateTime.UtcNow.AddDays(-1),
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            },
            new CaringEmergencyAlert
            {
                TenantId = 7,
                Title = "Other tenant alert",
                Body = "Wrong tenant",
                IsActive = true,
                SentAt = DateTime.UtcNow.AddDays(-1),
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            });
        db.CaringCareProviders.Add(new CaringCareProvider
        {
            TenantId = 42,
            Name = "Neighbourhood Meals",
            Type = "meal_delivery",
            Description = "Warm meals delivered locally.",
            Categories = """["meals"]""",
            SubRegionId = 5,
            Status = "active",
            CreatedAt = DateTime.UtcNow.AddDays(-2),
            UpdatedAt = DateTime.UtcNow.AddDays(-2)
        });
        db.CaringProjectAnnouncements.Add(new CaringProjectAnnouncement
        {
            TenantId = 42,
            Title = "Garden circle",
            Summary = "A project hidden by the member opt-out.",
            Status = "active",
            ProgressPercent = 20,
            PublishedAt = DateTime.UtcNow.AddDays(-2),
            LastUpdateAt = DateTime.UtcNow.AddDays(-2)
        });
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 9001);

        var result = await InvokeActionAsync(controller, "Digest", 2, CancellationToken.None);

        var data = ReadData(result);
        data.GetProperty("tenant_default_cadence").GetString().Should().Be("monthly");
        data.GetProperty("prefs").GetProperty("cadence").GetString().Should().Be("daily");
        data.GetProperty("prefs").GetProperty("preferred_sub_region_id").GetInt32().Should().Be(5);

        var items = data.GetProperty("items").EnumerateArray().ToList();
        items.Should().HaveCount(2);
        items[0].GetProperty("source").GetString().Should().Be("safety_alert");
        items[0].GetProperty("audience_match_score").GetInt32()
            .Should().BeGreaterThan(items[1].GetProperty("audience_match_score").GetInt32());
        items.Select(i => i.GetProperty("source").GetString())
            .Should().Equal("safety_alert", "care_provider");
    }

    [Fact]
    public async Task Prefs_DefaultsToTenantCadenceAndUpdateValidatesAndPersistsUserPrefs()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = 42,
            Key = CivicDigestService.TenantDefaultCadenceKey,
            Value = "\"weekly\""
        });
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 9001);

        var defaults = ReadData(await InvokeActionAsync(controller, "Prefs", CancellationToken.None));
        defaults.GetProperty("tenant_default_cadence").GetString().Should().Be("monthly");
        defaults.GetProperty("prefs").GetProperty("enabled").GetBoolean().Should().BeTrue();
        defaults.GetProperty("prefs").GetProperty("cadence").GetString().Should().Be("monthly");
        defaults.GetProperty("prefs").GetProperty("opt_out_sources").GetArrayLength().Should().Be(0);

        var invalid = await InvokeActionAsync(
            controller,
            "UpdatePrefs",
            CreatePrefsRequest(cadence: "fortnightly", preferredSubRegionId: null, optOutSources: null),
            CancellationToken.None);

        AssertSingleError(invalid, StatusCodes.Status422UnprocessableEntity, "VALIDATION_ERROR", "cadence");

        var valid = ReadData(await InvokeActionAsync(
            controller,
            "UpdatePrefs",
            CreatePrefsRequest(
                cadence: "off",
                preferredSubRegionId: 7,
                optOutSources: ["safety_alert", "unknown", "safety_alert", "project"]),
            CancellationToken.None));

        var prefs = valid.GetProperty("prefs");
        prefs.GetProperty("enabled").GetBoolean().Should().BeFalse();
        prefs.GetProperty("cadence").GetString().Should().Be("off");
        prefs.GetProperty("preferred_sub_region_id").GetInt32().Should().Be(7);
        prefs.GetProperty("opt_out_sources").EnumerateArray().Select(x => x.GetString())
            .Should().Equal("safety_alert", "project");

        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == "caring.civic_digest.user_prefs.9001");
        using var storedDocument = JsonDocument.Parse(stored.Value);
        storedDocument.RootElement.GetProperty("cadence").GetString().Should().Be("off");
        storedDocument.RootElement.GetProperty("enabled").GetBoolean().Should().BeFalse();
        storedDocument.RootElement.GetProperty("updated_at").GetInt64().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task Cadence_DefaultsToMonthlyAndNormalizesLegacyStoredWeekly()
    {
        var tenant = CreateTenantContext(42);
        await using var emptyDb = CreateDbContext(tenant);
        SeedFeature(emptyDb, 42, enabled: true);
        await emptyDb.SaveChangesAsync();
        var emptyController = CreateController(emptyDb, tenant, userId: 9001);

        var emptyResult = await emptyController.Cadence(CancellationToken.None);

        ReadCadence(emptyResult).Should().Be("monthly");

        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.AddRange(
            new TenantConfig
            {
                TenantId = 42,
                Key = CivicDigestService.TenantDefaultCadenceKey,
                Value = "\"weekly\""
            },
            new TenantConfig
            {
                TenantId = 7,
                Key = CivicDigestService.TenantDefaultCadenceKey,
                Value = "daily"
            });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Cadence(CancellationToken.None);

        ReadCadence(result).Should().Be("monthly");
    }

    [Fact]
    public async Task SetCadence_ValidatesNormalizesAndUpsertsTenantConfig()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = 7,
            Key = CivicDigestService.TenantDefaultCadenceKey,
            Value = "off"
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var invalid = await controller.SetCadence(new CivicDigestCadenceRequest
        {
            Cadence = "fortnightly"
        }, CancellationToken.None);
        var legacyWeekly = await controller.SetCadence(new CivicDigestCadenceRequest
        {
            Cadence = "weekly"
        }, CancellationToken.None);
        var daily = await controller.SetCadence(new CivicDigestCadenceRequest
        {
            Cadence = "daily"
        }, CancellationToken.None);

        AssertSingleError(invalid, StatusCodes.Status422UnprocessableEntity, "VALIDATION_ERROR", "cadence");
        ReadCadence(legacyWeekly).Should().Be("monthly");
        ReadCadence(daily).Should().Be("daily");

        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == CivicDigestService.TenantDefaultCadenceKey);
        stored.Value.Should().Be("daily");
        stored.UpdatedAt.Should().NotBeNull();

        var otherTenant = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 7 && c.Key == CivicDigestService.TenantDefaultCadenceKey);
        otherTenant.Value.Should().Be("off");
    }

    [Fact]
    public async Task Cadence_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Cadence(CancellationToken.None);

        AssertSingleError(result, StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
    }

    private static string ReadCadence(IActionResult result)
    {
        return ReadData(result).GetProperty("cadence").GetString()!;
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

    private static Type? ResolveMemberDigestControllerType()
    {
        return Type.GetType("Nexus.Api.Controllers.CaringCommunityCivicDigestController, Nexus.Api");
    }

    private static ControllerBase CreateMemberController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var controllerType = ResolveMemberDigestControllerType();
        controllerType.Should().NotBeNull();
        var service = new CivicDigestService(db, tenant);
        var controller = Activator.CreateInstance(controllerType!, service, tenant)
            .Should().BeAssignableTo<ControllerBase>().Subject;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), role: "member");
        return controller;
    }

    private static AdminCaringCommunityCivicDigestController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CivicDigestService(db, tenant);
        return new AdminCaringCommunityCivicDigestController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow())
        };
    }

    private static async Task<IActionResult> InvokeActionAsync(
        object controller,
        string actionName,
        params object?[] parameters)
    {
        var method = controller.GetType().GetMethod(actionName);
        method.Should().NotBeNull();
        var result = method!.Invoke(controller, parameters);
        return await result.Should().BeAssignableTo<Task<IActionResult>>().Subject;
    }

    private static object CreatePrefsRequest(
        string? cadence,
        int? preferredSubRegionId,
        IReadOnlyCollection<string>? optOutSources)
    {
        var requestType = Type.GetType("Nexus.Api.Services.CivicDigestPrefsRequest, Nexus.Api");
        requestType.Should().NotBeNull();
        var request = Activator.CreateInstance(requestType!)!;
        SetRequestProperty(requestType!, request, "Cadence", cadence);
        SetRequestProperty(requestType!, request, "PreferredSubRegionId", preferredSubRegionId);
        SetRequestProperty(requestType!, request, "OptOutSources", optOutSources?.ToList());
        return request;
    }

    private static void SetRequestProperty(Type requestType, object request, string propertyName, object? value)
    {
        var property = requestType.GetProperty(propertyName);
        property.Should().NotBeNull();
        property!.SetValue(request, value);
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
