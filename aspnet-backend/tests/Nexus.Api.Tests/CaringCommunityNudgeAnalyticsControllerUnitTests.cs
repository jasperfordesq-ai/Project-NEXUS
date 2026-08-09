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

public class CaringCommunityNudgeAnalyticsControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelNudgeAnalyticsRoute()
    {
        typeof(AdminCaringCommunityNudgesController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community");

        typeof(AdminCaringCommunityNudgesController)
            .GetMethod(nameof(AdminCaringCommunityNudgesController.Analytics))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("nudges/analytics");
        typeof(AdminCaringCommunityNudgesController)
            .GetMethod("UpdateConfig")
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template
            .Should().Be("nudges/config");
        typeof(AdminCaringCommunityNudgesController)
            .GetMethod("Dispatch")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("nudges/dispatch");
    }

    [Fact]
    public async Task Analytics_WithRows_ReturnsLaravelStatsRecentAndConfig()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedTenants(db);
        SeedFeature(db, 42, enabled: true);
        SeedConfig(db);
        SeedUsers(db);
        SeedOptOuts(db);
        SeedNudges(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await controller.Analytics(CancellationToken.None));

        var config = data.GetProperty("config");
        config.GetProperty("enabled").GetBoolean().Should().BeTrue();
        config.GetProperty("min_score").GetDecimal().Should().Be(0.8m);
        config.GetProperty("cooldown_days").GetInt32().Should().Be(21);
        config.GetProperty("daily_limit").GetInt32().Should().Be(10);

        var stats = data.GetProperty("stats");
        stats.GetProperty("sent_total").GetInt32().Should().Be(3);
        stats.GetProperty("sent_30d").GetInt32().Should().Be(2);
        stats.GetProperty("converted_total").GetInt32().Should().Be(2);
        stats.GetProperty("converted_30d").GetInt32().Should().Be(1);
        stats.GetProperty("conversion_rate_30d").GetDecimal().Should().Be(0.5m);
        stats.GetProperty("opted_out_members").GetInt32().Should().Be(1);

        var recent = data.GetProperty("recent").EnumerateArray().ToArray();
        recent.Should().HaveCount(3);
        recent[0].GetProperty("id").GetInt64().Should().Be(100);
        recent[0].GetProperty("target_user").GetProperty("id").GetInt32().Should().Be(10);
        recent[0].GetProperty("target_user").GetProperty("name").GetString().Should().Be("Ada Lovelace");
        recent[0].GetProperty("related_user").GetProperty("id").GetInt32().Should().Be(11);
        recent[0].GetProperty("related_user").GetProperty("name").GetString().Should().Be("Grace Hopper");
        recent[0].GetProperty("score").GetDecimal().Should().Be(0.876m);
        recent[0].GetProperty("status").GetString().Should().Be("sent");
        recent[0].GetProperty("converted_at").ValueKind.Should().Be(JsonValueKind.Null);

        data.GetProperty("eligible_candidates").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task Analytics_WithoutRows_ReturnsLaravelDefaultConfigAndEmptyStats()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await controller.Analytics(CancellationToken.None));

        var config = data.GetProperty("config");
        config.GetProperty("enabled").GetBoolean().Should().BeFalse();
        config.GetProperty("min_score").GetDecimal().Should().Be(0.55m);
        config.GetProperty("cooldown_days").GetInt32().Should().Be(14);
        config.GetProperty("daily_limit").GetInt32().Should().Be(25);

        var stats = data.GetProperty("stats");
        stats.GetProperty("sent_total").GetInt32().Should().Be(0);
        stats.GetProperty("sent_30d").GetInt32().Should().Be(0);
        stats.GetProperty("converted_total").GetInt32().Should().Be(0);
        stats.GetProperty("converted_30d").GetInt32().Should().Be(0);
        stats.GetProperty("conversion_rate_30d").GetDecimal().Should().Be(0m);
        stats.GetProperty("opted_out_members").GetInt32().Should().Be(0);

        data.GetProperty("recent").EnumerateArray().Should().BeEmpty();
        data.GetProperty("eligible_candidates").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task Analytics_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        AssertSingleError(
            await controller.Analytics(CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    [Fact]
    public async Task Dispatch_DryRunReturnsPreviewWithoutWritingNudges()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedTenants(db);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.AddRange(
            new TenantConfig { TenantId = 42, Key = "caring_community.nudges.enabled", Value = "true" },
            new TenantConfig { TenantId = 42, Key = "caring_community.nudges.min_score", Value = "0.4" },
            new TenantConfig { TenantId = 42, Key = "caring_community.nudges.daily_limit", Value = "10" });
        db.Users.AddRange(
            User(10, 42, "Ada", "Helper"),
            User(11, 42, "Grace", "Recipient"),
            User(70, 7, "Other", "Tenant"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await InvokeDispatch(controller, dryRun: true, limit: 5));

        data.GetProperty("enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("dry_run").GetBoolean().Should().BeTrue();
        data.GetProperty("candidates").GetInt32().Should().Be(1);
        data.GetProperty("sent").GetInt32().Should().Be(0);
        data.GetProperty("skipped").GetInt32().Should().Be(1);
        var item = data.GetProperty("items").EnumerateArray().Should().ContainSingle().Subject;
        item.GetProperty("status").GetString().Should().Be("preview");
        item.GetProperty("source_type").GetString().Should().Be("tandem_candidate");
        item.GetProperty("target_user").GetProperty("id").GetInt32().Should().Be(10);
        item.GetProperty("related_user").GetProperty("id").GetInt32().Should().Be(11);

        db.CaringSmartNudges.IgnoreQueryFilters().Should().BeEmpty();
        db.Notifications.IgnoreQueryFilters().Should().BeEmpty();
    }

    [Fact]
    public async Task UpdateConfig_ClampsPersistsAndReturnsLaravelConfig()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedConfig(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await InvokeUpdateConfig(controller, Json("""
        {
          "enabled": false,
          "min_score": 1.2,
          "cooldown_days": 0,
          "daily_limit": 500
        }
        """)));

        var config = data.GetProperty("config");
        config.GetProperty("enabled").GetBoolean().Should().BeFalse();
        config.GetProperty("min_score").GetDecimal().Should().Be(0.95m);
        config.GetProperty("cooldown_days").GetInt32().Should().Be(1);
        config.GetProperty("daily_limit").GetInt32().Should().Be(250);

        var rows = await db.TenantConfigs.IgnoreQueryFilters()
            .Where(row => row.TenantId == 42 && row.Key.StartsWith("caring_community.nudges."))
            .ToDictionaryAsync(row => row.Key, row => row.Value);
        rows["caring_community.nudges.enabled"].Should().Be("0");
        rows["caring_community.nudges.min_score"].Should().Be("0.95");
        rows["caring_community.nudges.cooldown_days"].Should().Be("1");
        rows["caring_community.nudges.daily_limit"].Should().Be("250");

        var otherTenantRows = await db.TenantConfigs.IgnoreQueryFilters()
            .Where(row => row.TenantId == 7 && row.Key.StartsWith("caring_community.nudges."))
            .ToDictionaryAsync(row => row.Key, row => row.Value);
        otherTenantRows["caring_community.nudges.enabled"].Should().Be("false");
        otherTenantRows["caring_community.nudges.min_score"].Should().Be("0.95");
    }

    [Fact]
    public async Task UpdateConfig_PartialInputPreservesCurrentValues()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedConfig(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await InvokeUpdateConfig(controller, Json("""{ "daily_limit": 7 }""")));

        var config = data.GetProperty("config");
        config.GetProperty("enabled").GetBoolean().Should().BeTrue();
        config.GetProperty("min_score").GetDecimal().Should().Be(0.8m);
        config.GetProperty("cooldown_days").GetInt32().Should().Be(21);
        config.GetProperty("daily_limit").GetInt32().Should().Be(7);
    }

    [Fact]
    public async Task UpdateConfig_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        AssertSingleError(
            await InvokeUpdateConfig(controller, Json("""{ "enabled": true }""")),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    [Fact]
    public async Task Dispatch_LiveCreatesSentNudgeNotificationAndSkipsDuplicate()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedTenants(db);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.AddRange(
            new TenantConfig { TenantId = 42, Key = "caring_community.nudges.enabled", Value = "true" },
            new TenantConfig { TenantId = 42, Key = "caring_community.nudges.min_score", Value = "0.4" },
            new TenantConfig { TenantId = 42, Key = "caring_community.nudges.cooldown_days", Value = "14" },
            new TenantConfig { TenantId = 42, Key = "caring_community.nudges.daily_limit", Value = "10" });
        db.Users.AddRange(
            User(10, 42, "Ada", "Helper"),
            User(11, 42, "Grace", "Recipient"),
            User(70, 7, "Other", "Tenant"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var created = await InvokeDispatch(controller, dryRun: false, limit: 5);

        var objectResult = created.Should().BeOfType<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("dry_run").GetBoolean().Should().BeFalse();
        data.GetProperty("candidates").GetInt32().Should().Be(1);
        data.GetProperty("sent").GetInt32().Should().Be(1);
        data.GetProperty("skipped").GetInt32().Should().Be(0);
        var item = data.GetProperty("items").EnumerateArray().Should().ContainSingle().Subject;
        item.GetProperty("status").GetString().Should().Be("sent");
        item.GetProperty("nudge_id").GetInt64().Should().BeGreaterThan(0);
        item.GetProperty("notification_id").GetInt32().Should().BeGreaterThan(0);

        var nudge = await db.CaringSmartNudges.IgnoreQueryFilters().SingleAsync();
        nudge.TenantId.Should().Be(42);
        nudge.TargetUserId.Should().Be(10);
        nudge.RelatedUserId.Should().Be(11);
        nudge.SourceType.Should().Be("tandem_candidate");
        nudge.Status.Should().Be("sent");
        nudge.DispatchKey.Should().NotBeNullOrWhiteSpace();
        nudge.NotificationId.Should().BeGreaterThan(0);

        var notification = await db.Notifications.IgnoreQueryFilters().SingleAsync();
        notification.TenantId.Should().Be(42);
        notification.UserId.Should().Be(10);
        notification.Type.Should().Be("caring_smart_nudge");
        notification.Body.Should().Contain("Grace Recipient");

        var duplicate = ReadData(await InvokeDispatch(controller, dryRun: false, limit: 5));
        duplicate.GetProperty("candidates").GetInt32().Should().Be(0);
        duplicate.GetProperty("sent").GetInt32().Should().Be(0);
        duplicate.GetProperty("skipped").GetInt32().Should().Be(0);
        duplicate.GetProperty("items").EnumerateArray().Should().BeEmpty();
        db.CaringSmartNudges.IgnoreQueryFilters().Should().ContainSingle();
        db.Notifications.IgnoreQueryFilters().Should().ContainSingle();
    }

    [Fact]
    public async Task Dispatch_WhenDisabledOrFeatureOff_ReturnsLaravelCompatibleResult()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await InvokeDispatch(controller, dryRun: false, limit: 5));

        data.GetProperty("enabled").GetBoolean().Should().BeFalse();
        data.GetProperty("candidates").GetInt32().Should().Be(0);
        data.GetProperty("sent").GetInt32().Should().Be(0);

        var disabledTenant = CreateTenantContext(70);
        await using var disabledDb = CreateDbContext(disabledTenant);
        SeedFeature(disabledDb, 70, enabled: false);
        await disabledDb.SaveChangesAsync();
        var disabled = CreateController(disabledDb, disabledTenant);

        AssertSingleError(
            await InvokeDispatch(disabled, dryRun: false, limit: 5),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        (objectResult.StatusCode is null
            or StatusCodes.Status200OK
            or StatusCodes.Status201Created).Should().BeTrue();
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static async Task<IActionResult> InvokeDispatch(
        AdminCaringCommunityNudgesController controller,
        bool dryRun,
        int? limit)
    {
        var method = typeof(AdminCaringCommunityNudgesController).GetMethod("Dispatch");
        method.Should().NotBeNull();
        var requestType = method!.GetParameters()[0].ParameterType;
        var request = Activator.CreateInstance(requestType)!;
        requestType.GetProperty("DryRun")!.SetValue(request, dryRun);
        requestType.GetProperty("Limit")!.SetValue(request, limit);
        var result = method.Invoke(controller, [request, CancellationToken.None]);
        return await result.Should().BeAssignableTo<Task<IActionResult>>().Subject;
    }

    private static async Task<IActionResult> InvokeUpdateConfig(
        AdminCaringCommunityNudgesController controller,
        JsonElement payload)
    {
        var method = typeof(AdminCaringCommunityNudgesController).GetMethod("UpdateConfig");
        method.Should().NotBeNull();
        var result = method!.Invoke(controller, [payload, CancellationToken.None]);
        return await result.Should().BeAssignableTo<Task<IActionResult>>().Subject;
    }

    private static JsonElement Json(string raw)
    {
        using var document = JsonDocument.Parse(raw);
        return document.RootElement.Clone();
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be(code);
    }

    private static void SeedTenants(NexusDbContext db)
    {
        db.Tenants.AddRange(
            new Tenant { Id = 42, Slug = "acme", Name = "Acme" },
            new Tenant { Id = 7, Slug = "globex", Name = "Globex" });
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

    private static void SeedConfig(NexusDbContext db)
    {
        db.TenantConfigs.AddRange(
            new TenantConfig { TenantId = 42, Key = "caring_community.nudges.enabled", Value = "true" },
            new TenantConfig { TenantId = 42, Key = "caring_community.nudges.min_score", Value = "0.8" },
            new TenantConfig { TenantId = 42, Key = "caring_community.nudges.cooldown_days", Value = "21" },
            new TenantConfig { TenantId = 42, Key = "caring_community.nudges.daily_limit", Value = "10" },
            new TenantConfig { TenantId = 7, Key = "caring_community.nudges.enabled", Value = "false" },
            new TenantConfig { TenantId = 7, Key = "caring_community.nudges.min_score", Value = "0.95" });
    }

    private static void SeedUsers(NexusDbContext db)
    {
        db.Users.AddRange(
            User(10, 42, "Ada", "Lovelace"),
            User(11, 42, "Grace", "Hopper"),
            User(12, 42, "Pat", "Recipient"),
            User(70, 7, "Other", "Tenant"));
    }

    private static User User(int id, int tenantId, string firstName, string lastName) =>
        new()
        {
            Id = id,
            TenantId = tenantId,
            FirstName = firstName,
            LastName = lastName,
            Email = $"{firstName.ToLowerInvariant()}-{id}@example.test",
            PasswordHash = "x",
            Role = Role.Names.Member
        };

    private static void SeedOptOuts(NexusDbContext db)
    {
        db.NotificationPreferences.AddRange(
            new NotificationPreference
            {
                TenantId = 42,
                UserId = 12,
                NotificationType = "caring_smart_nudges",
                EnableInApp = false,
                EnablePush = false,
                EnableEmail = false
            },
            new NotificationPreference
            {
                TenantId = 7,
                UserId = 70,
                NotificationType = "caring_smart_nudges",
                EnableInApp = false,
                EnablePush = false,
                EnableEmail = false
            });
    }

    private static void SeedNudges(NexusDbContext db)
    {
        var now = DateTime.UtcNow;
        db.CaringSmartNudges.AddRange(
            new CaringSmartNudge
            {
                Id = 100,
                TenantId = 42,
                TargetUserId = 10,
                RelatedUserId = 11,
                SourceType = "tandem_candidate",
                Score = 0.8764m,
                Status = "sent",
                SentAt = now.AddDays(-2),
                CreatedAt = now.AddDays(-2)
            },
            new CaringSmartNudge
            {
                Id = 101,
                TenantId = 42,
                TargetUserId = 12,
                RelatedUserId = null,
                SourceType = "helper_at_risk",
                Score = 0.7m,
                Status = "converted",
                SentAt = now.AddDays(-10),
                ConvertedAt = now.AddDays(-1),
                CreatedAt = now.AddDays(-10)
            },
            new CaringSmartNudge
            {
                Id = 102,
                TenantId = 42,
                TargetUserId = 10,
                RelatedUserId = null,
                SourceType = "low_coverage_subregion",
                Score = 0.65m,
                Status = "converted",
                SentAt = now.AddDays(-45),
                ConvertedAt = now.AddDays(-40),
                CreatedAt = now.AddDays(-45)
            },
            new CaringSmartNudge
            {
                Id = 700,
                TenantId = 7,
                TargetUserId = 70,
                RelatedUserId = null,
                SourceType = "helper_at_risk",
                Score = 0.99m,
                Status = "converted",
                SentAt = now.AddDays(-1),
                ConvertedAt = now.AddDays(-1),
                CreatedAt = now.AddDays(-1)
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

    private static AdminCaringCommunityNudgesController CreateController(
        NexusDbContext db,
        TenantContext tenant)
    {
        var tandems = new CaringTandemMatchingService(db);
        var service = new CaringNudgeAnalyticsService(db, tandems);
        var controller = new AdminCaringCommunityNudgesController(service, tenant);
        controller.ControllerContext = ControllerContextFor(userId: 9001, tenant.GetTenantIdOrThrow());
        return controller;
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
