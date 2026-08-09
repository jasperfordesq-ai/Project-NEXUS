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

public class CaringCommunityDataQualityControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelDataQualityRoutes()
    {
        typeof(AdminCaringCommunityDataQualityController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/data-quality");

        typeof(AdminCaringCommunityDataQualityController)
            .GetMethod(nameof(AdminCaringCommunityDataQualityController.Dashboard))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("dashboard");
        typeof(AdminCaringCommunityDataQualityController)
            .GetMethod(nameof(AdminCaringCommunityDataQualityController.AffectedRows))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("checks/{checkKey}/rows");
    }

    [Fact]
    public async Task Dashboard_ReturnsTenantScopedReadinessChecksAndTotals()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(42, "ALICE@resident.test", "Alice", "One"),
            User(42, "alice@resident.test", "Alice", "Two"),
            User(42, "demo@example.org", "Demo", "Resident"),
            User(42, "blank-role@resident.test", "Blank", "Role", role: ""),
            User(7, "alice@resident.test", "Other", "Tenant"));
        db.Organisations.Add(Organisation(42, "Pending Aid Hub", "pending", verifiedAt: null));
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = 42,
            Key = "caring.disclosure_pack",
            Value = "{}"
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Dashboard(CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("tenant_id").GetInt32().Should().Be(42);
        data.GetProperty("checks").EnumerateArray().Should().HaveCount(10);

        var duplicateEmails = Check(data, "duplicate_emails");
        duplicateEmails.GetProperty("severity").GetString().Should().Be("danger");
        duplicateEmails.GetProperty("count").GetInt32().Should().Be(2);
        duplicateEmails.GetProperty("has_drilldown").GetBoolean().Should().BeTrue();

        Check(data, "seed_marker_users").GetProperty("count").GetInt32().Should().Be(1);
        Check(data, "unverified_organisations").GetProperty("count").GetInt32().Should().Be(1);
        Check(data, "members_without_role").GetProperty("count").GetInt32().Should().Be(1);
        Check(data, "tenant_setting_completeness").GetProperty("count").GetInt32().Should().Be(1);

        var totals = data.GetProperty("totals");
        totals.GetProperty("danger").GetInt32().Should().Be(2);
        totals.GetProperty("warning").GetInt32().Should().Be(1);
        totals.GetProperty("info").GetInt32().Should().Be(2);
        totals.GetProperty("ok").GetInt32().Should().Be(5);
    }

    [Fact]
    public async Task AffectedRows_ValidatesCheckKeyAndReturnsClampedDuplicateEmailRows()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(42, "shared@example.com", "Alpha", "One", createdAt: new DateTime(2026, 7, 1, 10, 0, 0, DateTimeKind.Utc)),
            User(42, "SHARED@example.com", "Beta", "Two", createdAt: new DateTime(2026, 7, 2, 10, 0, 0, DateTimeKind.Utc)),
            User(42, "unique@example.com", "Unique", "Person"),
            User(7, "shared@example.com", "Other", "Tenant"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var invalid = await controller.AffectedRows("unknown_check", limit: 500, ct: CancellationToken.None);
        var valid = await controller.AffectedRows("duplicate_emails", limit: 500, ct: CancellationToken.None);

        AssertSingleError(invalid, StatusCodes.Status422UnprocessableEntity, "VALIDATION_ERROR", "check_key");

        var ok = valid.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("check_key").GetString().Should().Be("duplicate_emails");
        data.GetProperty("limit").GetInt32().Should().Be(200);
        var rows = data.GetProperty("rows").EnumerateArray().ToArray();
        rows.Should().HaveCount(2);
        rows.Select(row => row.GetProperty("identifier").GetString())
            .Should().Equal("shared@example.com", "SHARED@example.com");
        rows[0].GetProperty("name").GetString().Should().Be("Alpha One");
    }

    [Fact]
    public async Task Dashboard_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Dashboard(CancellationToken.None);

        AssertSingleError(result, StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
    }

    private static JsonElement Check(JsonElement data, string key)
    {
        return data.GetProperty("checks")
            .EnumerateArray()
            .Single(row => row.GetProperty("key").GetString() == key);
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

    private static User User(
        int tenantId,
        string email,
        string firstName,
        string lastName,
        string role = "member",
        DateTime? createdAt = null)
    {
        return new User
        {
            TenantId = tenantId,
            Email = email,
            FirstName = firstName,
            LastName = lastName,
            Role = role,
            PasswordHash = "test",
            CreatedAt = createdAt ?? DateTime.UtcNow
        };
    }

    private static Organisation Organisation(int tenantId, string name, string status, DateTime? verifiedAt)
    {
        return new Organisation
        {
            TenantId = tenantId,
            Name = name,
            Slug = name.ToLowerInvariant().Replace(' ', '-'),
            Status = status,
            OwnerId = 1,
            VerifiedAt = verifiedAt,
            CreatedAt = DateTime.UtcNow
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

    private static AdminCaringCommunityDataQualityController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new TenantDataQualityService(db, tenant);
        return new AdminCaringCommunityDataQualityController(service, tenant)
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
