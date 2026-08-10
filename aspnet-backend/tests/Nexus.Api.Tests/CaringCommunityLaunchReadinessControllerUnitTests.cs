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

public class CaringCommunityLaunchReadinessControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelLaunchReadinessRoutes()
    {
        typeof(AdminCaringCommunityLaunchReadinessController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/launch-readiness");

        typeof(AdminCaringCommunityLaunchReadinessController)
            .GetMethod(nameof(AdminCaringCommunityLaunchReadinessController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();

        typeof(AdminCaringCommunityLaunchReadinessController)
            .GetMethod(nameof(AdminCaringCommunityLaunchReadinessController.AcknowledgeBoundary))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("acknowledge-boundary");

        typeof(AdminCaringCommunityLaunchReadinessController)
            .GetMethod(nameof(AdminCaringCommunityLaunchReadinessController.Launch))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("launch");
    }

    [Fact]
    public async Task Index_ReturnsLaravelReadinessShapeAndBlockersForIncompleteTenant()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Index(CancellationToken.None);

        var data = ReadData(result);
        data.GetProperty("isolated_node_required").GetBoolean().Should().BeFalse();
        data.GetProperty("can_launch").GetBoolean().Should().BeFalse();
        data.GetProperty("launched").ValueKind.Should().Be(JsonValueKind.Null);

        var overall = data.GetProperty("overall");
        overall.GetProperty("status").GetString().Should().Be("needs_review");
        overall.GetProperty("ready_section_count").GetInt32().Should().Be(1);
        overall.GetProperty("total_section_count").GetInt32().Should().Be(7);

        var sections = data.GetProperty("sections").EnumerateArray().ToArray();
        sections.Select(section => section.GetProperty("key").GetString()).Should().Equal(
            "disclosure_pack",
            "operating_policy",
            "commercial_boundary",
            "pilot_scoreboard",
            "data_quality",
            "isolated_node",
            "external_integrations");

        sections.Single(section => section.GetProperty("key").GetString() == "commercial_boundary")
            .GetProperty("missing").EnumerateArray()
            .Select(item => item.GetString())
            .Should().Equal("acknowledgement");

        sections.Single(section => section.GetProperty("key").GetString() == "isolated_node")
            .GetProperty("status").GetString().Should().Be("not_started");

        data.GetProperty("blockers").EnumerateArray()
            .Select(blocker => blocker.GetProperty("key").GetString())
            .Should().Equal(
                "disclosure_pack",
                "operating_policy",
                "commercial_boundary",
                "pilot_scoreboard",
                "external_integrations");
    }

    [Fact]
    public async Task AcknowledgeBoundary_PersistsFlagAndReturnsUpdatedReport()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.AcknowledgeBoundary(CancellationToken.None);

        var data = ReadData(result);
        data.GetProperty("acknowledged").GetBoolean().Should().BeTrue();
        data.GetProperty("report").GetProperty("sections").EnumerateArray()
            .Single(section => section.GetProperty("key").GetString() == "commercial_boundary")
            .GetProperty("status").GetString().Should().Be("ready");

        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(config => config.TenantId == 42
                && config.Key == PilotLaunchReadinessService.BoundaryAcknowledgementKey);
        stored.Value.Should().Be("1");
        stored.UpdatedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task Launch_WhenGateOpen_ReturnsLaravelCannotLaunchShapeWithBlockers()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Launch(CancellationToken.None);

        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("CANNOT_LAUNCH");
        document.RootElement.GetProperty("error").GetProperty("code").GetString().Should().Be("CANNOT_LAUNCH");
        document.RootElement.GetProperty("error").GetProperty("blockers").EnumerateArray()
            .Select(blocker => blocker.GetProperty("key").GetString())
            .Should().Contain(["disclosure_pack", "operating_policy", "pilot_scoreboard"]);
    }

    [Fact]
    public async Task Launch_WhenRequiredSectionsReady_PersistsOneWayLaunchState()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedReadySettings(db, 42);
        SeedBaseline(db, 42);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Launch(CancellationToken.None);

        var data = ReadData(result);
        data.GetProperty("launched_by_id").GetInt32().Should().Be(9001);
        data.GetProperty("launched_at").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("report").GetProperty("launched")
            .GetProperty("launched_by_id").GetInt32().Should().Be(9001);

        var launchRows = await db.TenantConfigs.IgnoreQueryFilters()
            .Where(config => config.TenantId == 42 && config.Key.StartsWith("caring_community.pilot_launched_"))
            .OrderBy(config => config.Key)
            .ToListAsync();
        launchRows.Select(row => row.Key).Should().Equal(
            PilotLaunchReadinessService.PilotLaunchedAtKey,
            PilotLaunchReadinessService.PilotLaunchedByKey);

        var repeat = await controller.Launch(CancellationToken.None);
        AssertSingleError(repeat, StatusCodes.Status422UnprocessableEntity, "ALREADY_LAUNCHED");
    }

    [Fact]
    public async Task Controllers_WhenFeatureDisabled_ReturnLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        AssertSingleError(await controller.Index(CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
        AssertSingleError(await controller.AcknowledgeBoundary(CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
        AssertSingleError(await controller.Launch(CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
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

    private static void SeedFeature(NexusDbContext db, int tenantId, bool enabled)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "features.caring_community",
            Value = enabled ? "true" : "false"
        });
    }

    private static void SeedReadySettings(NexusDbContext db, int tenantId)
    {
        db.TenantConfigs.AddRange(
            new TenantConfig
            {
                TenantId = tenantId,
                Key = PilotDisclosurePackService.SettingKey,
                Value = JsonSerializer.Serialize(new
                {
                    controller = new
                    {
                        name = "Gemeinde Beispiel",
                        contact_email = "privacy@example.test",
                        data_protection_officer = "DPO Example"
                    },
                    incident_response = new
                    {
                        contact_email = "incident@example.test"
                    }
                }),
                UpdatedAt = new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc)
            },
            new TenantConfig
            {
                TenantId = tenantId,
                Key = PilotLaunchReadinessService.OperatingPolicyKey,
                Value = JsonSerializer.Serialize(new
                {
                    policy_appendix_url = "https://example.test/policy.pdf",
                    safeguarding_escalation_user_id = 9001
                }),
                UpdatedAt = new DateTime(2026, 7, 3, 10, 0, 0, DateTimeKind.Utc)
            },
            new TenantConfig
            {
                TenantId = tenantId,
                Key = PilotLaunchReadinessService.BoundaryAcknowledgementKey,
                Value = "1",
                UpdatedAt = new DateTime(2026, 7, 3, 11, 0, 0, DateTimeKind.Utc)
            },
            new TenantConfig
            {
                TenantId = tenantId,
                Key = ExternalIntegrationBacklogService.SettingKey,
                Value = JsonSerializer.Serialize(new
                {
                    items = new[]
                    {
                        new
                        {
                            id = "ahv_gateway",
                            name = "AHV submission gateway",
                            category = "ahv",
                            owner_name = "Municipality",
                            owner_email = "owner@example.test",
                            status = "proposed",
                            interface_spec_url = "",
                            dsa_status = "drafting",
                            sandbox_url = "",
                            notes = "Tracked before launch.",
                            created_at = "2026-07-03T12:00:00Z",
                            updated_at = "2026-07-03T12:00:00Z"
                        }
                    },
                    updated_at = "2026-07-03T12:00:00Z"
                })
            });
    }

    private static void SeedBaseline(NexusDbContext db, int tenantId)
    {
        db.CaringKpiBaselines.Add(new CaringKpiBaseline
        {
            TenantId = tenantId,
            Label = "Pre pilot baseline",
            BaselinePeriod = """{"start":"2026-07-01","end":"2026-09-30"}""",
            CapturedAt = new DateTime(2026, 7, 3, 12, 0, 0, DateTimeKind.Utc),
            Metrics = """{"member_count":10,"volunteer_hours":0}""",
            CapturedBy = 9001,
            CreatedAt = new DateTime(2026, 7, 3, 12, 0, 0, DateTimeKind.Utc),
            UpdatedAt = new DateTime(2026, 7, 3, 12, 0, 0, DateTimeKind.Utc)
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

    private static AdminCaringCommunityLaunchReadinessController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new PilotLaunchReadinessService(
            db,
            new PilotDisclosurePackService(db, tenant),
            new CommercialBoundaryService(db, tenant),
            new CaringKpiBaselineService(db),
            new TenantDataQualityService(db, tenant),
            new IsolatedNodeReadinessService(db),
            new ExternalIntegrationBacklogService(db, tenant));

        return new AdminCaringCommunityLaunchReadinessController(service, tenant)
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
