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

public class CaringCommunityCommercialBoundaryControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelCommercialBoundaryRoutes()
    {
        typeof(AdminCaringCommunityCommercialBoundaryController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/commercial-boundary");

        typeof(AdminCaringCommunityCommercialBoundaryController)
            .GetMethod(nameof(AdminCaringCommunityCommercialBoundaryController.Matrix))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityCommercialBoundaryController)
            .GetMethod(nameof(AdminCaringCommunityCommercialBoundaryController.SetOverride))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("override");
    }

    [Fact]
    public async Task Matrix_ReturnsCanonicalCapabilitiesWithTenantOverrides()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        SeedBoundary(db, 42, new Dictionary<string, string>
        {
            ["paid_regional_analytics"] = "private_deployment",
            ["unknown_capability"] = "commercial",
            ["caring_help_requests"] = "invalid"
        });
        SeedBoundary(db, 7, new Dictionary<string, string>
        {
            ["paid_regional_analytics"] = "tenant_config"
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Matrix(CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");

        data.GetProperty("categories").EnumerateArray().Should().HaveCount(7);
        data.GetProperty("classifications").EnumerateArray().Should().HaveCount(4);
        data.GetProperty("overrides_count").GetInt32().Should().Be(1);
        data.GetProperty("last_updated_at").ValueKind.Should().NotBe(JsonValueKind.Null);

        var capabilities = data.GetProperty("capabilities").EnumerateArray().ToArray();
        capabilities.Should().HaveCountGreaterThan(20);
        var core = capabilities.Single(row => row.GetProperty("key").GetString() == "caring_community_module");
        core.GetProperty("effective_classification").GetString().Should().Be("agpl_public");
        core.GetProperty("is_overridden").GetBoolean().Should().BeFalse();
        core.GetProperty("agpl_module").GetBoolean().Should().BeTrue();

        var overridden = capabilities.Single(row => row.GetProperty("key").GetString() == "paid_regional_analytics");
        overridden.GetProperty("default_classification").GetString().Should().Be("commercial");
        overridden.GetProperty("effective_classification").GetString().Should().Be("private_deployment");
        overridden.GetProperty("is_overridden").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task SetOverride_ValidatesCapabilityAndClassificationLikeLaravel()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var missingCapability = await controller.SetOverride(new CommercialBoundaryOverrideRequest
        {
            Classification = "commercial"
        }, CancellationToken.None);
        var invalidClassificationType = await controller.SetOverride(new CommercialBoundaryOverrideRequest
        {
            CapabilityKey = "paid_regional_analytics",
            Classification = 10
        }, CancellationToken.None);
        var unknownAndInvalid = await controller.SetOverride(new CommercialBoundaryOverrideRequest
        {
            CapabilityKey = "no_such_capability",
            Classification = "not_allowed"
        }, CancellationToken.None);

        AssertSingleError(missingCapability, StatusCodes.Status422UnprocessableEntity, "VALIDATION_REQUIRED_FIELD", "capability_key");
        AssertSingleError(invalidClassificationType, StatusCodes.Status422UnprocessableEntity, "VALIDATION_INVALID", "classification");

        var objectResult = unknownAndInvalid.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        var errors = document.RootElement.GetProperty("errors").EnumerateArray().ToArray();
        errors.Should().HaveCount(2);
        errors.Should().OnlyContain(error => error.GetProperty("code").GetString() == "VALIDATION_ERROR");
        errors.Select(error => error.GetProperty("field").GetString())
            .Should().BeEquivalentTo(["capability_key", "classification"]);
    }

    [Fact]
    public async Task SetOverride_PersistsAndClearsTenantOverride()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var updated = await controller.SetOverride(new CommercialBoundaryOverrideRequest
        {
            CapabilityKey = "partner_api_access",
            Classification = "private_deployment"
        }, CancellationToken.None);

        var ok = updated.Should().BeOfType<OkObjectResult>().Subject;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value)))
        {
            var data = document.RootElement.GetProperty("data");
            data.GetProperty("overrides_count").GetInt32().Should().Be(1);
            var row = data.GetProperty("capabilities").EnumerateArray()
                .Single(capability => capability.GetProperty("key").GetString() == "partner_api_access");
            row.GetProperty("effective_classification").GetString().Should().Be("private_deployment");
            row.GetProperty("is_overridden").GetBoolean().Should().BeTrue();
        }

        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == CommercialBoundaryService.SettingKey);
        stored.Value.Should().Contain("partner_api_access");
        stored.Value.Should().Contain("private_deployment");

        var cleared = await controller.SetOverride(new CommercialBoundaryOverrideRequest
        {
            CapabilityKey = "partner_api_access",
            Classification = null
        }, CancellationToken.None);

        var clearedOk = cleared.Should().BeOfType<OkObjectResult>().Subject;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(clearedOk.Value)))
        {
            var data = document.RootElement.GetProperty("data");
            data.GetProperty("overrides_count").GetInt32().Should().Be(0);
            var row = data.GetProperty("capabilities").EnumerateArray()
                .Single(capability => capability.GetProperty("key").GetString() == "partner_api_access");
            row.GetProperty("effective_classification").GetString().Should().Be("commercial");
            row.GetProperty("is_overridden").GetBoolean().Should().BeFalse();
        }
    }

    [Fact]
    public async Task Matrix_WhenFeatureDisabled_ReturnsLaravelForbiddenError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Matrix(CancellationToken.None);

        AssertSingleError(result, StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
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

    private static void SeedBoundary(NexusDbContext db, int tenantId, Dictionary<string, string> overrides)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = CommercialBoundaryService.SettingKey,
            Value = JsonSerializer.Serialize(new { overrides }, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            UpdatedAt = new DateTime(2026, 7, 3, 10, 0, 0, DateTimeKind.Utc)
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

    private static AdminCaringCommunityCommercialBoundaryController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CommercialBoundaryService(db, tenant);
        return new AdminCaringCommunityCommercialBoundaryController(service, tenant)
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
