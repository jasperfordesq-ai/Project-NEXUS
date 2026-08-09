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

public class CaringCommunityInviteCodesControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelInviteCodeRoutes()
    {
        typeof(AdminCaringCommunityInviteCodesController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/invite-codes");

        typeof(AdminCaringCommunityInviteCodesController)
            .GetMethod(nameof(AdminCaringCommunityInviteCodesController.Index))
            ?.GetCustomAttributes<HttpGetAttribute>()
            .Select(a => a.Template)
            .Should().BeEquivalentTo(new string?[]
            {
                null,
                "/api/v2/admin/caring-community/invite-codes"
            });

        typeof(AdminCaringCommunityInviteCodesController)
            .GetMethod(nameof(AdminCaringCommunityInviteCodesController.Store))
            ?.GetCustomAttributes<HttpPostAttribute>()
            .Select(a => a.Template)
            .Should().BeEquivalentTo(new string?[]
            {
                null,
                "/api/v2/admin/caring-community/invite-codes"
            });

        typeof(CaringCommunityInviteController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/invite");

        typeof(CaringCommunityInviteController)
            .GetMethod(nameof(CaringCommunityInviteController.Lookup))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("{code}");
    }

    [Fact]
    public async Task AdminIndex_ReturnsLastTwentyTenantScopedCodesWithUsageStatus()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedTenants(db);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedInviteCodes(db);
        await db.SaveChangesAsync();

        var controller = CreateAdminController(db, tenant, userId: 9001);

        var rows = ReadData(await controller.Index(CancellationToken.None))
            .EnumerateArray()
            .ToArray();

        rows.Should().HaveCount(3);
        rows.Select(row => row.GetProperty("code").GetString())
            .Should().Equal("USED99", "OLD777", "ABC234");

        rows[0].GetProperty("status").GetString().Should().Be("used");
        rows[0].GetProperty("used_by").GetString().Should().Be("Grace Hopper");
        rows[0].GetProperty("invite_url").GetString().Should().EndWith("/join/USED99");

        rows[1].GetProperty("status").GetString().Should().Be("expired");
        rows[1].GetProperty("used_at").ValueKind.Should().Be(JsonValueKind.Null);

        rows[2].GetProperty("status").GetString().Should().Be("active");
        rows[2].GetProperty("label").GetString().Should().Be("Neighbour welcome");
    }

    [Fact]
    public async Task AdminStore_GeneratesSixCharacterCodeAndClampsExpirationWindow()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedTenants(db);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        await db.SaveChangesAsync();

        var controller = CreateAdminController(db, tenant, userId: 9001);
        var before = DateTime.UtcNow;

        var result = await controller.Store(new CaringInviteCodeGenerateRequest
        {
            Label = "  Warm welcome desk  ",
            ExpiresDays = 999
        }, CancellationToken.None);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        var data = ReadData(result);

        data.GetProperty("id").GetInt64().Should().BeGreaterThan(0);
        data.GetProperty("label").GetString().Should().Be("Warm welcome desk");
        data.GetProperty("code").GetString().Should().MatchRegex("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$");
        data.GetProperty("invite_url").GetString().Should().EndWith($"/join/{data.GetProperty("code").GetString()}");

        var stored = await db.CaringInviteCodes.IgnoreQueryFilters().SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.CreatedByUserId.Should().Be(9001);
        stored.Label.Should().Be("Warm welcome desk");
        stored.Code.Should().Be(data.GetProperty("code").GetString());
        stored.ExpiresAt.Should().BeAfter(before.AddDays(364));
        stored.ExpiresAt.Should().BeBefore(DateTime.UtcNow.AddDays(366));
    }

    [Fact]
    public async Task AdminStore_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();

        AssertSingleError(
            await CreateAdminController(db, tenant, userId: 9001).Store(new CaringInviteCodeGenerateRequest(), CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    [Fact]
    public async Task Lookup_ReturnsValidityEnvelopeWithoutAuthenticationAndNormalizesCode()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedTenants(db);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedInviteCodes(db);
        await db.SaveChangesAsync();

        var controller = CreateLookupController(db, tenant);

        var active = ReadData(await controller.Lookup(" abc234 ", CancellationToken.None));
        active.GetProperty("valid").GetBoolean().Should().BeTrue();
        active.GetProperty("expired").GetBoolean().Should().BeFalse();
        active.GetProperty("already_used").GetBoolean().Should().BeFalse();
        active.GetProperty("tenant_name").GetString().Should().Be("ACME Neighbourhood");
        active.GetProperty("caring_community_enabled").GetBoolean().Should().BeTrue();

        var used = ReadData(await controller.Lookup("USED99", CancellationToken.None));
        used.GetProperty("valid").GetBoolean().Should().BeFalse();
        used.GetProperty("already_used").GetBoolean().Should().BeTrue();

        var expired = ReadData(await controller.Lookup("OLD777", CancellationToken.None));
        expired.GetProperty("valid").GetBoolean().Should().BeFalse();
        expired.GetProperty("expired").GetBoolean().Should().BeTrue();

        var missing = ReadData(await controller.Lookup("NOPE42", CancellationToken.None));
        missing.GetProperty("valid").GetBoolean().Should().BeFalse();
        missing.GetProperty("expired").GetBoolean().Should().BeFalse();
        missing.GetProperty("already_used").GetBoolean().Should().BeFalse();
    }

    private static void SeedTenants(NexusDbContext db)
    {
        db.Tenants.AddRange(
            new Tenant
            {
                Id = 42,
                Slug = "acme",
                Name = "ACME Neighbourhood",
                Domain = "acme.localhost"
            },
            new Tenant
            {
                Id = 7,
                Slug = "globex",
                Name = "Globex",
                Domain = "globex.localhost"
            });
    }

    private static void SeedInviteCodes(NexusDbContext db)
    {
        db.CaringInviteCodes.AddRange(
            new CaringInviteCode
            {
                Id = 100,
                TenantId = 42,
                Code = "ABC234",
                Label = "Neighbour welcome",
                CreatedByUserId = 9001,
                ExpiresAt = DateTime.UtcNow.AddDays(14),
                CreatedAt = new DateTime(2026, 7, 1, 10, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 1, 10, 0, 0, DateTimeKind.Utc)
            },
            new CaringInviteCode
            {
                Id = 101,
                TenantId = 42,
                Code = "OLD777",
                CreatedByUserId = 9001,
                ExpiresAt = DateTime.UtcNow.AddDays(-1),
                CreatedAt = new DateTime(2026, 7, 2, 10, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 2, 10, 0, 0, DateTimeKind.Utc)
            },
            new CaringInviteCode
            {
                Id = 102,
                TenantId = 42,
                Code = "USED99",
                Label = "",
                CreatedByUserId = 9001,
                ExpiresAt = DateTime.UtcNow.AddDays(20),
                UsedAt = DateTime.UtcNow.AddDays(-1),
                UsedByUserId = 11,
                CreatedAt = new DateTime(2026, 7, 3, 10, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 3, 10, 0, 0, DateTimeKind.Utc)
            },
            new CaringInviteCode
            {
                Id = 200,
                TenantId = 7,
                Code = "OTHER7",
                CreatedByUserId = 70,
                ExpiresAt = DateTime.UtcNow.AddDays(14),
                CreatedAt = new DateTime(2026, 7, 4, 10, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 4, 10, 0, 0, DateTimeKind.Utc)
            });
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
                Id = 11,
                TenantId = 42,
                FirstName = "Grace",
                LastName = "Hopper",
                Email = "grace-invite@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 9001,
                TenantId = 42,
                FirstName = "Admin",
                LastName = "User",
                Email = "admin-invite@example.test",
                PasswordHash = "x",
                Role = Role.Names.Admin
            },
            new User
            {
                Id = 70,
                TenantId = 7,
                FirstName = "Other",
                LastName = "Tenant",
                Email = "other-invite@example.test",
                PasswordHash = "x",
                Role = Role.Names.Admin
            });
    }

    private static JsonElement ReadData(IActionResult result)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(((ObjectResult) result).Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be(code);
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

    private static AdminCaringCommunityInviteCodesController CreateAdminController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringInviteCodeService(db);
        return new AdminCaringCommunityInviteCodesController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
        };
    }

    private static CaringCommunityInviteController CreateLookupController(
        NexusDbContext db,
        TenantContext tenant)
    {
        var service = new CaringInviteCodeService(db);
        return new CaringCommunityInviteController(service, tenant)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
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
