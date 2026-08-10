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

public class CaringCommunitySubRegionsControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelSubRegionRoutes()
    {
        typeof(CaringCommunitySubRegionsController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/sub-regions");
        typeof(AdminCaringCommunitySubRegionsController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/sub-regions");

        typeof(CaringCommunitySubRegionsController)
            .GetMethod(nameof(CaringCommunitySubRegionsController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunitySubRegionsController)
            .GetMethod(nameof(AdminCaringCommunitySubRegionsController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunitySubRegionsController)
            .GetMethod(nameof(AdminCaringCommunitySubRegionsController.Store))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunitySubRegionsController)
            .GetMethod(nameof(AdminCaringCommunitySubRegionsController.Update))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("{id:int}");
        typeof(AdminCaringCommunitySubRegionsController)
            .GetMethod(nameof(AdminCaringCommunitySubRegionsController.Destroy))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("{id:int}");
    }

    [Fact]
    public async Task Index_ReturnsOnlyActiveCurrentTenantRowsSortedAndFiltered()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringSubRegions.AddRange(
            SubRegion(42, "zug-west", "Zug West", type: "quartier", status: "active"),
            SubRegion(42, "altstadt", "Altstadt", type: "quartier", status: "active", description: "Historic core"),
            SubRegion(42, "inactive", "Inactive", type: "quartier", status: "inactive"),
            SubRegion(42, "municipality", "Municipality", type: "municipality", status: "active"),
            SubRegion(7, "altstadt", "Other Altstadt", type: "quartier", status: "active"));
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 1001);

        var result = await controller.Index(type: "quartier", search: "alt", page: 1, ct: CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var payload = document.RootElement.GetProperty("data");
        payload.GetProperty("total").GetInt32().Should().Be(1);
        payload.GetProperty("per_page").GetInt32().Should().Be(50);
        payload.GetProperty("current_page").GetInt32().Should().Be(1);

        var rows = payload.GetProperty("data").EnumerateArray().ToArray();
        rows.Should().HaveCount(1);
        rows[0].GetProperty("tenant_id").GetInt32().Should().Be(42);
        rows[0].GetProperty("slug").GetString().Should().Be("altstadt");
        rows[0].GetProperty("status").GetString().Should().Be("active");
    }

    [Fact]
    public async Task Store_CreatesTenantScopedSubRegionWithNormalizedSlugAndJsonPayloads()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var result = await controller.Store(new CaringSubRegionRequest
        {
            Name = "Zug West",
            Type = "municipality",
            Description = "Pilot area",
            PostalCodes = new[] { "6300", "6317" },
            BoundaryGeoJson = new Dictionary<string, object?> { ["type"] = "FeatureCollection" },
            CenterLatitude = 47.1662m,
            CenterLongitude = 8.5155m
        }, CancellationToken.None);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var row = document.RootElement.GetProperty("data");
        row.GetProperty("name").GetString().Should().Be("Zug West");
        row.GetProperty("slug").GetString().Should().Be("zug-west");
        row.GetProperty("type").GetString().Should().Be("municipality");
        row.GetProperty("postal_codes").EnumerateArray().Select(code => code.GetString())
            .Should().Equal("6300", "6317");
        row.GetProperty("boundary_geojson").GetProperty("type").GetString().Should().Be("FeatureCollection");
        row.GetProperty("created_by").GetInt32().Should().Be(9001);

        var stored = await db.CaringSubRegions.IgnoreQueryFilters().SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.Slug.Should().Be("zug-west");
        stored.CreatedBy.Should().Be(9001);
    }

    [Fact]
    public async Task Update_RejectsSameTenantDuplicateSlugAndUpdatesCurrentTenantRow()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringSubRegions.AddRange(
            SubRegion(42, "alpha", "Alpha", status: "active"),
            SubRegion(42, "beta", "Beta", status: "active"),
            SubRegion(7, "alpha-new", "Other Alpha", status: "active"));
        await db.SaveChangesAsync();
        var id = await db.CaringSubRegions.IgnoreQueryFilters()
            .Where(row => row.TenantId == 42 && row.Slug == "alpha")
            .Select(row => row.Id)
            .SingleAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var duplicate = await controller.Update(id, new CaringSubRegionRequest
        {
            Slug = "beta"
        }, CancellationToken.None);

        var invalid = duplicate.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        using (var invalidDocument = JsonDocument.Parse(JsonSerializer.Serialize(invalid.Value)))
        {
            invalidDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().Be("SUB_REGION_INVALID");
        }

        var result = await controller.Update(id, new CaringSubRegionRequest
        {
            Name = "Alpha Updated",
            Slug = "Alpha New",
            Status = "inactive"
        }, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var row = document.RootElement.GetProperty("data");
        row.GetProperty("name").GetString().Should().Be("Alpha Updated");
        row.GetProperty("slug").GetString().Should().Be("alpha-new");
        row.GetProperty("status").GetString().Should().Be("inactive");

        (await db.CaringSubRegions.IgnoreQueryFilters()
                .SingleAsync(r => r.TenantId == 7 && r.Slug == "alpha-new"))
            .Name.Should().Be("Other Alpha");
    }

    [Fact]
    public async Task Destroy_SoftInactivatesCurrentTenantSubRegionOnly()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringSubRegions.AddRange(
            SubRegion(42, "delete-me", "Delete Me", status: "active"),
            SubRegion(7, "delete-me", "Other Tenant", status: "active"));
        await db.SaveChangesAsync();
        var id = await db.CaringSubRegions.IgnoreQueryFilters()
            .Where(row => row.TenantId == 42)
            .Select(row => row.Id)
            .SingleAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var result = await controller.Destroy(id, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        (await db.CaringSubRegions.IgnoreQueryFilters().SingleAsync(row => row.Id == id))
            .Status.Should().Be("inactive");
        (await db.CaringSubRegions.IgnoreQueryFilters().SingleAsync(row => row.TenantId == 7))
            .Status.Should().Be("active");
    }

    [Fact]
    public async Task Index_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, false);
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 1001);

        var result = await controller.Index(ct: CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    private static CaringSubRegion SubRegion(
        int tenantId,
        string slug,
        string name,
        string type = "quartier",
        string status = "active",
        string? description = null)
    {
        return new CaringSubRegion
        {
            TenantId = tenantId,
            Slug = slug,
            Name = name,
            Type = type,
            Description = description,
            PostalCodes = """["6300"]""",
            Status = status,
            CreatedBy = 9001,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
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

    private static CaringCommunitySubRegionsController CreateMemberController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringSubRegionService(db, tenant);
        return new CaringCommunitySubRegionsController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "member")
        };
    }

    private static AdminCaringCommunitySubRegionsController CreateAdminController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringSubRegionService(db, tenant);
        return new AdminCaringCommunitySubRegionsController(service, tenant)
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
