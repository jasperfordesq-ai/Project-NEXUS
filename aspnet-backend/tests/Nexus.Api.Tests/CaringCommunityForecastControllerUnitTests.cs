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
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class CaringCommunityForecastControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelAdminForecastRoute()
    {
        typeof(AdminCaringCommunityForecastController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/forecast");

        typeof(AdminCaringCommunityForecastController)
            .GetMethod(nameof(AdminCaringCommunityForecastController.Forecast))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
    }

    [Fact]
    public async Task Forecast_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Forecast(CancellationToken.None);

        AssertSingleError(result, StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
    }

    [Fact]
    public async Task Forecast_WithNoCaringActivityTables_ReturnsLaravelFallbackDashboardShape()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedOtherTenantData(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Forecast(CancellationToken.None);

        var data = ReadData(result);
        data.GetProperty("hours").GetProperty("history").EnumerateArray().Should().HaveCount(6);
        data.GetProperty("hours").GetProperty("forecast").EnumerateArray().Should().BeEmpty();
        data.GetProperty("hours").GetProperty("trend").GetString().Should().Be("stable");
        data.GetProperty("hours").GetProperty("growth_rate_pct").GetDecimal().Should().Be(0m);
        data.GetProperty("hours").GetProperty("confidence").GetString().Should().Be("low");

        data.GetProperty("members").GetProperty("history").EnumerateArray().Should().HaveCount(6);
        data.GetProperty("recipients").GetProperty("history").EnumerateArray().Should().HaveCount(6);

        var demand = data.GetProperty("sub_region_demand");
        demand.GetProperty("window_days").GetProperty("short").GetInt32().Should().Be(30);
        demand.GetProperty("window_days").GetProperty("long").GetInt32().Should().Be(90);
        demand.GetProperty("sub_regions").EnumerateArray().Should().BeEmpty();
        demand.GetProperty("under_supplied_count").GetInt32().Should().Be(0);

        var churn = data.GetProperty("helper_churn");
        churn.GetProperty("prior_window_days").GetProperty("start").GetInt32().Should().Be(90);
        churn.GetProperty("prior_window_days").GetProperty("end").GetInt32().Should().Be(60);
        churn.GetProperty("lapsed_threshold_days").GetInt32().Should().Be(30);
        churn.GetProperty("overall").GetProperty("prior_active").GetInt32().Should().Be(0);
        churn.GetProperty("overall").GetProperty("lapsed").GetInt32().Should().Be(0);
        churn.GetProperty("overall").GetProperty("churn_rate").GetDecimal().Should().Be(0m);
        churn.GetProperty("by_category").EnumerateArray().Should().BeEmpty();
        churn.GetProperty("lapsed_helper_ids").EnumerateArray().Should().BeEmpty();

        var drift = data.GetProperty("coefficient_drift");
        drift.GetProperty("threshold").GetDecimal().Should().Be(0.15m);
        drift.GetProperty("categories").EnumerateArray().Should().BeEmpty();
        drift.GetProperty("drift_count").GetInt32().Should().Be(0);

        data.GetProperty("alerts").EnumerateArray().Should().BeEmpty();
        data.GetProperty("generated_at").GetString().Should().NotBeNullOrWhiteSpace();
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

    private static void SeedOtherTenantData(NexusDbContext db)
    {
        db.CaringSubRegions.Add(new CaringSubRegion
        {
            TenantId = 7,
            Name = "Other Region",
            Slug = "other-region",
            Status = "active"
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

    private static AdminCaringCommunityForecastController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringCommunityForecastService(db);
        return new AdminCaringCommunityForecastController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow())
        };
    }

    private static ControllerContext ControllerContextFor(int userId, int tenantId)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim("tenant_id", tenantId.ToString()),
                    new Claim(ClaimTypes.Role, "admin"),
                    new Claim("role", "admin")
                ], "Test"))
            }
        };
    }
}
