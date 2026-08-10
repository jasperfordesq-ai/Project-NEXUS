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
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests;

public sealed class CaringCommunityWarmthPassControllerUnitTests
{
    private const string MemberControllerTypeName = "Nexus.Api.Controllers.CaringCommunityWarmthPassController, Nexus.Api";
    private const string AdminControllerTypeName = "Nexus.Api.Controllers.AdminCaringCommunityWarmthPassController, Nexus.Api";
    private const string ServiceTypeName = "Nexus.Api.Services.WarmthPassService, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelWarmthPassRoutes()
    {
        var member = Resolve(MemberControllerTypeName);
        var admin = Resolve(AdminControllerTypeName);

        member.GetCustomAttribute<RouteAttribute>()?.Template.Should().Be("api/caring-community");
        member.GetCustomAttribute<AuthorizeAttribute>().Should().NotBeNull();
        member.GetMethod("MyWarmthPass")?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("my-warmth-pass");

        admin.GetCustomAttribute<RouteAttribute>()?.Template.Should().Be("api/admin/caring-community");
        admin.GetCustomAttribute<AuthorizeAttribute>()?.Policy.Should().Be("AdminOnly");
        admin.GetMethod("AdminViewWarmthPass")?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("warmth-pass/{userId:int}");
    }

    [Fact]
    public async Task MyWarmthPass_ReturnsLaravelPayloadForEligibleMember()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Tenants.Add(new Tenant { Id = 42, Slug = "kind-town", Name = "Kind Town" });
        db.Users.AddRange(
            User(10, 42, "Ada", "Verified", trustTier: 3),
            User(11, 42, "Grace", "Reviewer", trustTier: 1),
            User(12, 42, "Linus", "Reviewer", trustTier: 1),
            User(90, 7, "Other", "Tenant", trustTier: 4));
        db.VolunteerLogs.AddRange(
            VolunteerLog(100, 42, 10, 7.5m, "approved"),
            VolunteerLog(101, 42, 10, 5m, "approved"),
            VolunteerLog(102, 42, 10, 24m, "pending"),
            VolunteerLog(103, 7, 90, 24m, "approved"));
        db.Reviews.AddRange(
            Review(200, 42, reviewerId: 11, targetUserId: 10),
            Review(201, 42, reviewerId: 12, targetUserId: 10),
            Review(202, 7, reviewerId: 90, targetUserId: 10));
        db.IdentityVerificationSessions.Add(IdentitySession(300, 42, 10, "approved"));
        await db.SaveChangesAsync();

        var controller = CreateMemberController(db, tenant, userId: 10);

        var pass = ReadData(await Invoke(controller, "MyWarmthPass", CancellationToken.None));

        pass.GetProperty("eligible").GetBoolean().Should().BeTrue();
        pass.GetProperty("tier").GetInt32().Should().Be(3);
        pass.GetProperty("tier_label").GetString().Should().Be("verified");
        pass.GetProperty("hours_logged").GetDecimal().Should().Be(12.5m);
        pass.GetProperty("reviews_received").GetInt32().Should().Be(2);
        pass.GetProperty("identity_verified").GetBoolean().Should().BeTrue();
        pass.GetProperty("member_since").GetString().Should().Be("2026-01-10");
        pass.GetProperty("pass_active_since").GetString().Should().Be("2026-07-02");
        pass.GetProperty("tenant_name").GetString().Should().Be("Kind Town");
        pass.GetProperty("member_name").GetString().Should().Be("Ada Verified");
        pass.GetProperty("categories").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task WarmthPass_ReturnsIneligiblePayloadAndDoesNotLeakAcrossTenants()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Tenants.Add(new Tenant { Id = 42, Slug = "kind-town", Name = "Kind Town" });
        db.Users.AddRange(
            User(10, 42, "Ada", "Member", trustTier: 1),
            User(90, 7, "Other", "Tenant", trustTier: 4));
        await db.SaveChangesAsync();

        var member = CreateMemberController(db, tenant, userId: 10);
        var ownPass = ReadData(await Invoke(member, "MyWarmthPass", CancellationToken.None));
        ownPass.GetProperty("eligible").GetBoolean().Should().BeFalse();
        ownPass.GetProperty("tier").GetInt32().Should().Be(1);
        ownPass.GetProperty("tier_label").GetString().Should().Be("member");
        ownPass.GetProperty("pass_active_since").ValueKind.Should().Be(JsonValueKind.Null);
        ownPass.GetProperty("member_name").GetString().Should().Be("Ada Member");

        var admin = CreateAdminController(db, tenant, userId: 9001);
        var crossTenantPass = ReadData(await Invoke(
            admin,
            "AdminViewWarmthPass",
            90,
            CancellationToken.None));

        crossTenantPass.GetProperty("eligible").GetBoolean().Should().BeFalse();
        crossTenantPass.GetProperty("tier").GetInt32().Should().Be(0);
        crossTenantPass.GetProperty("tier_label").GetString().Should().Be("newcomer");
        crossTenantPass.GetProperty("tenant_name").GetString().Should().Be("Kind Town");
        crossTenantPass.GetProperty("member_name").GetString().Should().BeEmpty();
    }

    [Fact]
    public async Task WarmthPass_WhenFeatureDisabled_ReturnsLaravelError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        db.Users.Add(User(10, 42, "Ada", "Disabled", trustTier: 3));
        await db.SaveChangesAsync();

        var member = CreateMemberController(db, tenant, userId: 10);
        var admin = CreateAdminController(db, tenant, userId: 9001);

        AssertSingleError(
            await Invoke(member, "MyWarmthPass", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(
            await Invoke(admin, "AdminViewWarmthPass", 10, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
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
        var result = info!.Invoke(controller, args);
        if (result is Task<IActionResult> task)
        {
            return await task;
        }

        return result.Should().BeAssignableTo<IActionResult>().Subject;
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

    private static User User(int id, int tenantId, string firstName, string lastName, int trustTier)
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
            IsActive = true,
            TrustTier = trustTier,
            EmailVerified = false,
            CreatedAt = new DateTime(2026, 1, 10, 8, 0, 0, DateTimeKind.Utc),
            UpdatedAt = new DateTime(2026, 7, 2, 9, 30, 0, DateTimeKind.Utc)
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

    private static IdentityVerificationSession IdentitySession(int id, int tenantId, int userId, string decision)
    {
        return new IdentityVerificationSession
        {
            Id = id,
            TenantId = tenantId,
            UserId = userId,
            Provider = VerificationProvider.Mock,
            Level = VerificationLevel.DocumentAndSelfie,
            Status = VerificationSessionStatus.Completed,
            ProviderDecision = decision,
            CompletedAt = new DateTime(2026, 7, 1, 12, 0, 0, DateTimeKind.Utc),
            ExpiresAt = new DateTime(2026, 8, 1, 12, 0, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 7, 1, 11, 0, 0, DateTimeKind.Utc)
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
        type.Should().NotBeNull($"Laravel AG71 warmth-pass parity type {typeName} should exist");
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
}
