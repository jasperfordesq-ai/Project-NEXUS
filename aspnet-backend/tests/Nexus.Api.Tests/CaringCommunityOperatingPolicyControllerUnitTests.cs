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

public class CaringCommunityOperatingPolicyControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelOperatingPolicyRoutes()
    {
        typeof(AdminCaringCommunityOperatingPolicyController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/operating-policy");

        typeof(AdminCaringCommunityOperatingPolicyController)
            .GetMethod(nameof(AdminCaringCommunityOperatingPolicyController.Show))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();

        typeof(AdminCaringCommunityOperatingPolicyController)
            .GetMethod(nameof(AdminCaringCommunityOperatingPolicyController.Update))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().BeNull();
    }

    [Fact]
    public async Task Show_ReturnsLaravelDefaultsSchemaAndLatestUpdate()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.AddRange(
            new TenantConfig
            {
                TenantId = 42,
                Key = "caring.operating_policy.approval_authority",
                Value = "coordinator",
                UpdatedAt = new DateTime(2026, 7, 4, 8, 0, 0, DateTimeKind.Utc)
            },
            new TenantConfig
            {
                TenantId = 42,
                Key = "caring.operating_policy.trusted_reviewer_threshold",
                Value = "12",
                UpdatedAt = new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc)
            },
            new TenantConfig
            {
                TenantId = 7,
                Key = "caring.operating_policy.approval_authority",
                Value = "mutual",
                UpdatedAt = new DateTime(2026, 7, 4, 10, 0, 0, DateTimeKind.Utc)
            });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await controller.Show(CancellationToken.None));

        var policy = data.GetProperty("policy");
        policy.GetProperty("approval_authority").GetString().Should().Be("coordinator");
        policy.GetProperty("trusted_reviewer_threshold").GetInt32().Should().Be(12);
        policy.GetProperty("sla_first_response_hours").GetInt32().Should().Be(24);
        policy.GetProperty("legacy_hour_settlement").GetString().Should().Be("transfer_to_beneficiary");
        policy.GetProperty("safeguarding_escalation_user_id").ValueKind.Should().Be(JsonValueKind.Null);
        policy.GetProperty("chf_hourly_rate").GetDecimal().Should().Be(35m);
        policy.GetProperty("chf_prevention_multiplier").GetDecimal().Should().Be(2m);
        policy.GetProperty("statement_cadence").GetString().Should().Be("quarterly");
        policy.GetProperty("policy_appendix_url").ValueKind.Should().Be(JsonValueKind.Null);

        var schema = data.GetProperty("schema");
        schema.GetProperty("approval_authority").GetProperty("type").GetString().Should().Be("enum");
        schema.GetProperty("approval_authority").GetProperty("choices")
            .EnumerateArray().Select(choice => choice.GetString())
            .Should().Equal("admin", "coordinator", "mutual");
        schema.GetProperty("trusted_reviewer_threshold").GetProperty("min").GetInt32().Should().Be(1);
        schema.GetProperty("trusted_reviewer_threshold").GetProperty("max").GetInt32().Should().Be(200);
        schema.GetProperty("safeguarding_escalation_user_id").GetProperty("type").GetString().Should().Be("int_nullable");
        schema.GetProperty("policy_appendix_url").GetProperty("type").GetString().Should().Be("url_nullable");
        data.GetProperty("last_updated_at").GetString().Should().Be("2026-07-04T09:00:00.0000000Z");
    }

    [Fact]
    public async Task Update_PartialPatchPersistsDiscreteTenantSettingsAndReturnsPolicyOnly()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = 42,
            Key = "caring.operating_policy.statement_cadence",
            Value = "monthly",
            UpdatedAt = new DateTime(2026, 7, 4, 7, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await controller.Update(Json("""
        {
          "approval_authority": "mutual",
          "trusted_reviewer_threshold": 18,
          "sla_first_response_hours": "6",
          "safeguarding_escalation_user_id": "",
          "chf_hourly_rate": "42.5",
          "policy_appendix_url": "https://example.test/policy.pdf"
        }
        """), CancellationToken.None));

        data.TryGetProperty("policy", out _).Should().BeFalse("Laravel PUT returns the policy object directly");
        data.GetProperty("approval_authority").GetString().Should().Be("mutual");
        data.GetProperty("trusted_reviewer_threshold").GetInt32().Should().Be(18);
        data.GetProperty("sla_first_response_hours").GetInt32().Should().Be(6);
        data.GetProperty("safeguarding_escalation_user_id").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("chf_hourly_rate").GetDecimal().Should().Be(42.5m);
        data.GetProperty("statement_cadence").GetString().Should().Be("monthly");
        data.GetProperty("policy_appendix_url").GetString().Should().Be("https://example.test/policy.pdf");

        var rows = await db.TenantConfigs.IgnoreQueryFilters()
            .Where(config => config.TenantId == 42 && config.Key.StartsWith("caring.operating_policy."))
            .ToDictionaryAsync(config => config.Key, config => config.Value);
        rows["caring.operating_policy.approval_authority"].Should().Be("mutual");
        rows["caring.operating_policy.trusted_reviewer_threshold"].Should().Be("18");
        rows["caring.operating_policy.sla_first_response_hours"].Should().Be("6");
        rows["caring.operating_policy.safeguarding_escalation_user_id"].Should().Be(string.Empty);
        rows["caring.operating_policy.chf_hourly_rate"].Should().Be("42.5");
        rows["caring.operating_policy.policy_appendix_url"].Should().Be("https://example.test/policy.pdf");
    }

    [Fact]
    public async Task Update_WhenInvalid_ReturnsLaravelValidationErrorsAndDoesNotPersist()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Update(Json("""
        {
          "approval_authority": "board",
          "trusted_reviewer_threshold": 0,
          "chf_prevention_multiplier": 11,
          "policy_appendix_url": "not-a-url"
        }
        """), CancellationToken.None);

        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        var errors = document.RootElement.GetProperty("errors").EnumerateArray().ToArray();
        errors.Select(error => error.GetProperty("code").GetString()).Should().OnlyContain(code => code == "VALIDATION_ERROR");
        errors.Select(error => error.GetProperty("field").GetString()).Should().Equal(
            "approval_authority",
            "trusted_reviewer_threshold",
            "chf_prevention_multiplier",
            "policy_appendix_url");

        (await db.TenantConfigs.IgnoreQueryFilters()
            .CountAsync(config => config.TenantId == 42 && config.Key.StartsWith("caring.operating_policy.")))
            .Should().Be(0);
    }

    [Fact]
    public async Task Controllers_WhenFeatureDisabled_ReturnLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        AssertSingleError(await controller.Show(CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
        AssertSingleError(await controller.Update(Json("{}"), CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be(code);
    }

    private static JsonElement Json(string raw)
    {
        using var document = JsonDocument.Parse(raw);
        return document.RootElement.Clone();
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

    private static AdminCaringCommunityOperatingPolicyController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new OperatingPolicyService(db);
        return new AdminCaringCommunityOperatingPolicyController(service, tenant)
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
