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

public sealed class CaringCommunityTrustTierControllerUnitTests
{
    private const string MemberControllerTypeName = "Nexus.Api.Controllers.CaringCommunityTrustTierController, Nexus.Api";
    private const string AdminControllerTypeName = "Nexus.Api.Controllers.AdminCaringCommunityTrustTierController, Nexus.Api";
    private const string ServiceTypeName = "Nexus.Api.Services.TrustTierService, Nexus.Api";
    private const string ConfigTypeName = "Nexus.Api.Entities.CaringTrustTierConfig, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelTrustTierRoutes()
    {
        var member = Resolve(MemberControllerTypeName);
        var admin = Resolve(AdminControllerTypeName);

        member.GetCustomAttribute<RouteAttribute>()?.Template.Should().Be("api/caring-community");
        member.GetCustomAttribute<AuthorizeAttribute>().Should().NotBeNull();
        member.GetMethod("MyTrustTier")?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("my-trust-tier");
        member.GetMethod("MyTrustTierBreakdown")?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("me/trust-tier/breakdown");

        admin.GetCustomAttribute<RouteAttribute>()?.Template.Should().Be("api/admin/caring-community");
        admin.GetCustomAttribute<AuthorizeAttribute>()?.Policy.Should().Be("AdminOnly");
        admin.GetMethod("GetConfig")?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("trust-tier/config");
        admin.GetMethod("UpdateConfig")?.GetCustomAttribute<HttpPutAttribute>()?.Template
            .Should().Be("trust-tier/config");
        admin.GetMethod("Recompute")?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("trust-tier/recompute");
    }

    [Fact]
    public async Task MyTrustTier_RecomputesFromTenantScopedSignalsAndReturnsLaravelEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(10, 42, "Ada", "Verified", active: true),
            User(11, 42, "Grace", "Reviewer", active: true),
            User(12, 42, "Linus", "Reviewer", active: true),
            User(13, 42, "Maya", "Reviewer", active: true),
            User(90, 7, "Other", "Tenant", active: true));
        db.VolunteerLogs.AddRange(
            VolunteerLog(100, 42, 10, 7m, "approved"),
            VolunteerLog(101, 42, 10, 5m, "approved"),
            VolunteerLog(102, 42, 10, 24m, "pending"),
            VolunteerLog(103, 7, 90, 24m, "approved"));
        db.Reviews.AddRange(
            Review(200, 42, reviewerId: 11, targetUserId: 10),
            Review(201, 42, reviewerId: 12, targetUserId: 10),
            Review(202, 42, reviewerId: 13, targetUserId: 10),
            Review(203, 7, reviewerId: 90, targetUserId: 10));
        db.IdentityVerificationSessions.Add(new IdentityVerificationSession
        {
            Id = 300,
            TenantId = 42,
            UserId = 10,
            Provider = VerificationProvider.Mock,
            Level = VerificationLevel.DocumentAndSelfie,
            Status = VerificationSessionStatus.Completed,
            ProviderDecision = "approved",
            CompletedAt = new DateTime(2026, 7, 1, 12, 0, 0, DateTimeKind.Utc),
            ExpiresAt = new DateTime(2026, 8, 1, 12, 0, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 7, 1, 11, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();

        var controller = CreateMemberController(db, tenant, userId: 10);

        var tier = ReadData(await Invoke(controller, "MyTrustTier", CancellationToken.None));
        tier.GetProperty("tier").GetInt32().Should().Be(3);
        tier.GetProperty("label").GetString().Should().Be("verified");
        tier.GetProperty("next_tier").GetString().Should().Be("coordinator");
        (await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == 10)).TrustTier.Should().Be(3);

        var breakdown = ReadData(await Invoke(controller, "MyTrustTierBreakdown", CancellationToken.None));
        breakdown.GetProperty("tier").GetInt32().Should().Be(3);
        breakdown.GetProperty("tier_label").GetString().Should().Be("verified");
        breakdown.GetProperty("next_tier_label").GetString().Should().Be("coordinator");
        breakdown.GetProperty("progress_pct").GetDecimal().Should().Be(33.3m);

        var signals = breakdown.GetProperty("signals").EnumerateArray()
            .ToDictionary(signal => signal.GetProperty("key").GetString()!);
        signals["hours_logged"].GetProperty("current").GetInt32().Should().Be(12);
        signals["hours_logged"].GetProperty("required").GetInt32().Should().Be(50);
        signals["hours_logged"].GetProperty("achieved").GetBoolean().Should().BeFalse();
        signals["reviews_received"].GetProperty("current").GetInt32().Should().Be(3);
        signals["identity_verified"].GetProperty("current").GetInt32().Should().Be(1);
        signals["identity_verified"].GetProperty("achieved").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminConfig_UpdateAndRecompute_UseTenantScopedCriteria()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(10, 42, "Ada", "Active", active: true),
            User(11, 42, "Inactive", "Member", active: false),
            User(90, 7, "Other", "Tenant", active: true));
        db.VolunteerLogs.AddRange(
            VolunteerLog(100, 42, 10, 2m, "approved"),
            VolunteerLog(101, 42, 11, 24m, "approved"),
            VolunteerLog(102, 7, 90, 24m, "approved"));
        db.Reviews.Add(Review(200, 42, reviewerId: 11, targetUserId: 10));
        await db.SaveChangesAsync();

        var admin = CreateAdminController(db, tenant, userId: 9001);

        var defaults = ReadData(await Invoke(admin, "GetConfig", CancellationToken.None))
            .GetProperty("criteria");
        defaults.GetProperty("member").GetProperty("hours_logged").GetInt32().Should().Be(1);
        defaults.GetProperty("coordinator").GetProperty("identity_verified").GetBoolean().Should().BeTrue();

        var updated = ReadData(await Invoke(
            admin,
            "UpdateConfig",
            new Dictionary<string, object?>
            {
                ["Criteria"] = new Dictionary<string, object?>
                {
                    ["member"] = new Dictionary<string, object?>
                    {
                        ["hours_logged"] = 2,
                        ["reviews_received"] = 1,
                        ["identity_verified"] = false
                    },
                    ["trusted"] = new Dictionary<string, object?>
                    {
                        ["hours_logged"] = -10,
                        ["reviews_received"] = 0,
                        ["identity_verified"] = false
                    }
                }
            },
            CancellationToken.None)).GetProperty("criteria");

        updated.GetProperty("member").GetProperty("hours_logged").GetInt32().Should().Be(2);
        updated.GetProperty("trusted").GetProperty("hours_logged").GetInt32().Should().Be(0);
        Resolve(ConfigTypeName);
        db.ChangeTracker.Entries().Any(entry => entry.Entity.GetType() == Resolve(ConfigTypeName)).Should().BeTrue();

        var recompute = ReadData(await Invoke(admin, "Recompute", CancellationToken.None));
        recompute.GetProperty("updated").GetInt32().Should().Be(1);
        (await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == 10)).TrustTier.Should().Be(2);
        (await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == 11)).TrustTier.Should().Be(0);
        (await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == 90)).TrustTier.Should().Be(0);
    }

    [Fact]
    public async Task TrustTier_WhenFeatureDisabledOrInvalidConfig_ReturnsLaravelErrors()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        db.Users.Add(User(10, 42, "Ada", "Disabled", active: true));
        await db.SaveChangesAsync();

        var member = CreateMemberController(db, tenant, userId: 10);
        var admin = CreateAdminController(db, tenant, userId: 9001);

        AssertSingleError(
            await Invoke(member, "MyTrustTier", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(
            await Invoke(admin, "GetConfig", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");

        await using var enabledDb = CreateDbContext(tenant);
        SeedFeature(enabledDb, 42, enabled: true);
        enabledDb.Users.Add(User(10, 42, "Ada", "Enabled", active: true));
        await enabledDb.SaveChangesAsync();
        var enabledAdmin = CreateAdminController(enabledDb, tenant, userId: 9001);

        AssertSingleError(
            await Invoke(
                enabledAdmin,
                "UpdateConfig",
                new Dictionary<string, object?> { ["Criteria"] = null },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");
    }

    private static object CreateMemberController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var service = Activator.CreateInstance(Resolve(ServiceTypeName), db)!;
        var controller = (ControllerBase)Activator.CreateInstance(Resolve(MemberControllerTypeName), service, tenant)!;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), Role.Names.Member);
        return controller;
    }

    private static object CreateAdminController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var service = Activator.CreateInstance(Resolve(ServiceTypeName), db)!;
        var controller = (ControllerBase)Activator.CreateInstance(Resolve(AdminControllerTypeName), service, tenant)!;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), Role.Names.Admin);
        return controller;
    }

    private static async Task<IActionResult> Invoke(object controller, string method, params object?[] args)
    {
        var info = controller.GetType().GetMethod(method);
        info.Should().NotBeNull();
        var coerced = CoerceArgs(info!, args);
        var result = info!.Invoke(controller, coerced);
        if (result is Task<IActionResult> task)
        {
            return await task;
        }

        return result.Should().BeAssignableTo<IActionResult>().Subject;
    }

    private static object?[] CoerceArgs(MethodInfo method, object?[] args)
    {
        var parameters = method.GetParameters();
        parameters.Should().HaveCount(args.Length);
        return parameters
            .Select((parameter, index) => CoerceValue(args[index], parameter.ParameterType))
            .ToArray();
    }

    private static object? CoerceValue(object? raw, Type targetType)
    {
        if (raw is null)
        {
            return null;
        }

        var nullableTarget = Nullable.GetUnderlyingType(targetType) ?? targetType;
        if (raw is Dictionary<string, object?> dictionary
            && nullableTarget != typeof(Dictionary<string, object?>))
        {
            var instance = Activator.CreateInstance(nullableTarget)!;
            foreach (var (key, value) in dictionary)
            {
                var property = nullableTarget.GetProperties()
                    .FirstOrDefault(item =>
                        string.Equals(item.Name, key, StringComparison.OrdinalIgnoreCase)
                        || string.Equals(ToSnakeCase(item.Name), key, StringComparison.OrdinalIgnoreCase));
                if (property is not null)
                {
                    property.SetValue(instance, CoerceValue(value, property.PropertyType));
                }
            }

            return instance;
        }

        if (raw is System.Collections.IEnumerable enumerable
            && raw is not string
            && targetType != typeof(JsonElement))
        {
            var itemType = nullableTarget.IsArray
                ? nullableTarget.GetElementType()
                : nullableTarget.IsGenericType
                    ? nullableTarget.GetGenericArguments()[0]
                    : null;
            if (itemType is not null && nullableTarget != typeof(Dictionary<string, object?>))
            {
                var listType = typeof(List<>).MakeGenericType(itemType);
                var list = (System.Collections.IList)Activator.CreateInstance(listType)!;
                foreach (var item in enumerable)
                {
                    list.Add(CoerceValue(item, itemType));
                }

                return nullableTarget.IsArray ? ToArray(list, itemType) : list;
            }
        }

        if (nullableTarget.IsEnum)
        {
            return Enum.Parse(nullableTarget, raw.ToString()!, ignoreCase: true);
        }

        return nullableTarget.IsInstanceOfType(raw)
            ? raw
            : Convert.ChangeType(raw, nullableTarget);
    }

    private static Array ToArray(System.Collections.IList list, Type itemType)
    {
        var array = Array.CreateInstance(itemType, list.Count);
        list.CopyTo(array, 0);
        return array;
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var ok = result.Should().BeAssignableTo<ObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be(code);
    }

    private static User User(int id, int tenantId, string firstName, string lastName, bool active)
    {
        return new User
        {
            Id = id,
            TenantId = tenantId,
            Email = $"user{id}@example.test",
            PasswordHash = "hash",
            FirstName = firstName,
            LastName = lastName,
            Role = Role.Names.Member,
            IsActive = active,
            TrustTier = 0,
            CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)
        };
    }

    private static VolunteerLog VolunteerLog(int id, int tenantId, int userId, decimal hours, string status)
    {
        return new VolunteerLog
        {
            Id = id,
            TenantId = tenantId,
            UserId = userId,
            DateLogged = new DateOnly(2026, 7, 1),
            Hours = hours,
            Status = status,
            CreatedAt = new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc)
        };
    }

    private static Review Review(int id, int tenantId, int reviewerId, int targetUserId)
    {
        return new Review
        {
            Id = id,
            TenantId = tenantId,
            ReviewerId = reviewerId,
            TargetUserId = targetUserId,
            Rating = 5,
            Comment = "Thank you",
            CreatedAt = new DateTime(2026, 7, 1, 10, 0, 0, DateTimeKind.Utc)
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

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName, throwOnError: false);
        type.Should().NotBeNull($"Laravel AG67 trust-tier parity type {typeName} should exist");
        return type!;
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

    private static string ToSnakeCase(string value)
    {
        return string.Concat(value.Select((character, index) =>
            index > 0 && char.IsUpper(character)
                ? "_" + char.ToLowerInvariant(character)
                : char.ToLowerInvariant(character).ToString()));
    }
}
