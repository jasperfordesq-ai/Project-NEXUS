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
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class CaringCommunityEmergencyAlertsControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelCaringCommunityEmergencyAlertRoutes()
    {
        typeof(CaringCommunityEmergencyAlertsController).GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/emergency-alerts");
        typeof(AdminCaringCommunityEmergencyAlertsController).GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/emergency-alerts");

        typeof(CaringCommunityEmergencyAlertsController).GetMethod(nameof(CaringCommunityEmergencyAlertsController.ActiveAlerts))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(CaringCommunityEmergencyAlertsController).GetMethod(nameof(CaringCommunityEmergencyAlertsController.Dismiss))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/dismiss");
        typeof(AdminCaringCommunityEmergencyAlertsController).GetMethod(nameof(AdminCaringCommunityEmergencyAlertsController.AdminList))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityEmergencyAlertsController).GetMethod(nameof(AdminCaringCommunityEmergencyAlertsController.Store))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityEmergencyAlertsController).GetMethod(nameof(AdminCaringCommunityEmergencyAlertsController.Deactivate))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("{id:int}");
    }

    [Fact]
    public async Task ActiveAlerts_ReturnsOnlyCurrentTenantActiveUnexpiredAlertsTargetingUser()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringEmergencyAlerts.AddRange(
            Alert(42, "Tenant-wide", createdAt: new DateTime(2026, 7, 3, 10, 0, 0, DateTimeKind.Utc)),
            Alert(42, "Targeted", targetUserIds: """[1001]""", createdAt: new DateTime(2026, 7, 3, 11, 0, 0, DateTimeKind.Utc)),
            Alert(42, "Other targeted", targetUserIds: """[2002]"""),
            Alert(42, "Expired", expiresAt: new DateTime(2026, 7, 2, 10, 0, 0, DateTimeKind.Utc)),
            Alert(42, "Inactive", isActive: false),
            Alert(7, "Other tenant"));
        await db.SaveChangesAsync();

        var controller = CreateMemberController(db, tenant, userId: 1001);

        var result = await controller.ActiveAlerts(CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var rows = document.RootElement.GetProperty("data").EnumerateArray().ToArray();
        rows.Select(row => row.GetProperty("title").GetString())
            .Should().Equal("Targeted", "Tenant-wide");
        rows[0].GetProperty("severity").GetString().Should().Be("warning");
        rows[0].TryGetProperty("target_user_ids", out _).Should().BeTrue();
    }

    [Fact]
    public async Task Dismiss_IncrementsDismissedCountForCurrentTenantOnly()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringEmergencyAlerts.AddRange(
            Alert(42, "Tenant alert"),
            Alert(7, "Other tenant"));
        await db.SaveChangesAsync();
        var id = await db.CaringEmergencyAlerts.IgnoreQueryFilters()
            .Where(a => a.TenantId == 42)
            .Select(a => a.Id)
            .SingleAsync();

        var controller = CreateMemberController(db, tenant, userId: 1001);

        var result = await controller.Dismiss(id, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("ok").GetBoolean().Should().BeTrue();

        var alert = await db.CaringEmergencyAlerts.IgnoreQueryFilters().SingleAsync(a => a.Id == id);
        alert.DismissedCount.Should().Be(1);
        (await db.CaringEmergencyAlerts.IgnoreQueryFilters()
                .SingleAsync(a => a.TenantId == 7))
            .DismissedCount.Should().Be(0);
    }

    [Fact]
    public async Task Store_CreatesTenantScopedAlertWithLaravelResponseShape()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "member@example.test", "member", true),
            User(1002, 42, "inactive@example.test", "member", false),
            User(2001, 7, "other@example.test", "member", true));
        await db.SaveChangesAsync();

        var controller = CreateAdminController(db, tenant, userId: 9001, role: "municipality_announcer");

        var result = await controller.Store(new CaringEmergencyAlertRequest
        {
            Title = "Storm warning",
            Body = "Hub opens at 18:00.",
            Severity = "danger",
            TargetUserIds = [1001, 1002, 2001],
            GeographicScope = new Dictionary<string, object?> { ["type"] = "radius", ["radius_km"] = 5 },
            ExpiresAt = new DateTime(2026, 7, 4, 18, 0, 0, DateTimeKind.Utc)
        }, CancellationToken.None);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var row = document.RootElement.GetProperty("data");
        row.GetProperty("title").GetString().Should().Be("Storm warning");
        row.GetProperty("body").GetString().Should().Be("Hub opens at 18:00.");
        row.GetProperty("severity").GetString().Should().Be("danger");
        row.GetProperty("target_user_ids").EnumerateArray().Select(x => x.GetInt32())
            .Should().Equal(1001);
        row.GetProperty("push_result").GetProperty("status").GetString().Should().Be("queued");

        var stored = await db.CaringEmergencyAlerts.IgnoreQueryFilters().SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.CreatedBy.Should().Be(9001);
        stored.TargetUserIds.Should().Be("""[1001]""");
        stored.PushSent.Should().BeTrue();
    }

    [Fact]
    public async Task Deactivate_SoftDeletesAlertForCurrentTenantOnly()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringEmergencyAlerts.AddRange(Alert(42, "Tenant alert"), Alert(7, "Other tenant"));
        await db.SaveChangesAsync();
        var id = await db.CaringEmergencyAlerts.IgnoreQueryFilters()
            .Where(a => a.TenantId == 42)
            .Select(a => a.Id)
            .SingleAsync();

        var controller = CreateAdminController(db, tenant, userId: 9001, role: "admin");

        var result = await controller.Deactivate(id, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("ok").GetBoolean().Should().BeTrue();

        (await db.CaringEmergencyAlerts.IgnoreQueryFilters().SingleAsync(a => a.Id == id))
            .IsActive.Should().BeFalse();
        (await db.CaringEmergencyAlerts.IgnoreQueryFilters().SingleAsync(a => a.TenantId == 7))
            .IsActive.Should().BeTrue();
    }

    [Fact]
    public async Task ActiveAlerts_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, false);
        var controller = CreateMemberController(db, tenant, userId: 1001);

        var result = await controller.ActiveAlerts(CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        var error = document.RootElement.GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("FEATURE_DISABLED");
    }

    private static CaringEmergencyAlert Alert(
        int tenantId,
        string title,
        bool isActive = true,
        string? targetUserIds = null,
        DateTime? expiresAt = null,
        DateTime? createdAt = null)
    {
        return new CaringEmergencyAlert
        {
            TenantId = tenantId,
            Title = title,
            Body = $"{title} body",
            Severity = "warning",
            TargetUserIds = targetUserIds,
            ExpiresAt = expiresAt,
            IsActive = isActive,
            CreatedBy = 9001,
            CreatedAt = createdAt ?? DateTime.UtcNow,
            UpdatedAt = createdAt ?? DateTime.UtcNow
        };
    }

    private static User User(int id, int tenantId, string email, string role, bool isActive) => new()
    {
        Id = id,
        TenantId = tenantId,
        Email = email,
        PasswordHash = "hash",
        FirstName = "Test",
        LastName = "User",
        Role = role,
        IsActive = isActive
    };

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

    private static CaringCommunityEmergencyAlertsController CreateMemberController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringEmergencyAlertService(db, tenant);
        return new CaringCommunityEmergencyAlertsController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "member")
        };
    }

    private static AdminCaringCommunityEmergencyAlertsController CreateAdminController(
        NexusDbContext db,
        TenantContext tenant,
        int userId,
        string role)
    {
        var service = new CaringEmergencyAlertService(db, tenant);
        return new AdminCaringCommunityEmergencyAlertsController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), role)
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
