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

public class CaringCommunityKpiBaselinesControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelAdminKpiBaselineRoutes()
    {
        typeof(AdminCaringCommunityKpiBaselinesController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/kpi-baselines");

        typeof(AdminCaringCommunityKpiBaselinesController)
            .GetMethod(nameof(AdminCaringCommunityKpiBaselinesController.List))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();

        typeof(AdminCaringCommunityKpiBaselinesController)
            .GetMethod(nameof(AdminCaringCommunityKpiBaselinesController.Capture))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().BeNull();

        typeof(AdminCaringCommunityKpiBaselinesController)
            .GetMethod(nameof(AdminCaringCommunityKpiBaselinesController.Compare))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("{id}/compare");
    }

    [Fact]
    public async Task List_ReturnsTenantScopedBaselinesNewestFirst()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.CaringKpiBaselines.AddRange(
            Baseline(42, "Older", new DateTime(2026, 1, 1, 8, 0, 0, DateTimeKind.Utc), """{"member_count":1}"""),
            Baseline(42, "Newer", new DateTime(2026, 2, 1, 8, 0, 0, DateTimeKind.Utc), """{"member_count":2}"""),
            Baseline(7, "Other tenant", new DateTime(2026, 3, 1, 8, 0, 0, DateTimeKind.Utc), """{"member_count":99}"""));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.List(CancellationToken.None);

        var data = ReadData(result);
        var rows = data.EnumerateArray().ToArray();
        rows.Should().HaveCount(2);
        rows[0].GetProperty("label").GetString().Should().Be("Newer");
        rows[0].GetProperty("metrics").GetProperty("member_count").GetInt32().Should().Be(2);
        rows[1].GetProperty("label").GetString().Should().Be("Older");
    }

    [Fact]
    public async Task Capture_PersistsSnapshotWithLaravelDefaultsAndMetricOverrides()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);
        var payload = JsonPayload("""
            {
              "label": "  Q1 pilot baseline  ",
              "period": { "start": "2026-01-01", "end": "2026-03-31" },
              "notes": "",
              "metrics": {
                "volunteer_hours": 12.5,
                "engagement_rate_pct": "not numeric",
                "unknown_metric": 500
              }
            }
            """);

        var result = await controller.Capture(payload, CancellationToken.None);

        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status201Created);
        var data = ReadData(objectResult);
        data.GetProperty("label").GetString().Should().Be("Q1 pilot baseline");
        data.GetProperty("tenant_id").GetInt32().Should().Be(42);
        data.GetProperty("captured_by").GetInt32().Should().Be(9001);
        data.GetProperty("notes").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("baseline_period").GetProperty("start").GetString().Should().Be("2026-01-01");
        data.GetProperty("metrics").GetProperty("member_count").GetInt32().Should().Be(2);
        data.GetProperty("metrics").GetProperty("volunteer_hours").GetDecimal().Should().Be(12.5m);
        data.GetProperty("metrics").GetProperty("engagement_rate_pct").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("metrics").TryGetProperty("unknown_metric", out _).Should().BeFalse();

        var stored = await db.CaringKpiBaselines.SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.Label.Should().Be("Q1 pilot baseline");
        stored.CapturedBy.Should().Be(9001);
    }

    [Fact]
    public async Task Compare_ReturnsLaravelComparisonTargetsAndTenantScopedNotFound()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        var baseline = Baseline(42, "Pre pilot", new DateTime(2026, 1, 1, 8, 0, 0, DateTimeKind.Utc),
            """
            {
              "information_distribution_effort_hours": 100,
              "volunteer_hours": 0,
              "member_count": 1,
              "recipient_count": null,
              "active_relationships": null,
              "total_exchanges": 0,
              "avg_response_hours": null,
              "engagement_rate_pct": 20,
              "satisfaction_score": 3.5
            }
            """);
        db.CaringKpiBaselines.AddRange(
            baseline,
            Baseline(7, "Other tenant", new DateTime(2026, 1, 1, 8, 0, 0, DateTimeKind.Utc), """{"member_count":99}"""));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Compare(baseline.Id, CancellationToken.None);

        var data = ReadData(result);
        data.GetProperty("baseline").GetProperty("id").GetInt64().Should().Be(baseline.Id);
        data.GetProperty("current").GetProperty("member_count").GetInt32().Should().Be(2);
        var memberComparison = data.GetProperty("comparison").GetProperty("member_count");
        memberComparison.GetProperty("baseline").GetDecimal().Should().Be(1m);
        memberComparison.GetProperty("current").GetDecimal().Should().Be(2m);
        memberComparison.GetProperty("delta").GetDecimal().Should().Be(1m);
        memberComparison.GetProperty("pct_change").GetDecimal().Should().Be(100m);
        data.GetProperty("pilot_claim_targets").EnumerateArray().Should().HaveCount(3);
        data.GetProperty("agoris_claim_targets").EnumerateArray().Should().HaveCount(3);

        var forbidden = await controller.Compare(baseline.Id + 1, CancellationToken.None);
        AssertSingleError(forbidden, StatusCodes.Status404NotFound, "NOT_FOUND", null);
    }

    [Fact]
    public async Task Controllers_WhenFeatureDisabled_ReturnLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        AssertSingleError(await controller.List(CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
        AssertSingleError(await controller.Capture(JsonPayload("{}"), CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
        AssertSingleError(await controller.Compare(123, CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
    }

    private static CaringKpiBaseline Baseline(int tenantId, string label, DateTime capturedAt, string metrics) =>
        new()
        {
            TenantId = tenantId,
            Label = label,
            BaselinePeriod = """{"start":"2026-01-01","end":"2026-03-31"}""",
            CapturedAt = capturedAt,
            Metrics = metrics,
            CapturedBy = 11,
            CreatedAt = capturedAt,
            UpdatedAt = capturedAt
        };

    private static JsonElement JsonPayload(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        return ReadData(ok);
    }

    private static JsonElement ReadData(ObjectResult result)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(result.Value));
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
            new User { TenantId = 42, Email = "one@example.test", FirstName = "One", LastName = "User", IsActive = true },
            new User { TenantId = 42, Email = "two@example.test", FirstName = "Two", LastName = "User", IsActive = true },
            new User { TenantId = 42, Email = "inactive@example.test", FirstName = "Inactive", LastName = "User", IsActive = false },
            new User { TenantId = 7, Email = "other@example.test", FirstName = "Other", LastName = "Tenant", IsActive = true });
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

    private static AdminCaringCommunityKpiBaselinesController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringKpiBaselineService(db);
        return new AdminCaringCommunityKpiBaselinesController(service, tenant)
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
