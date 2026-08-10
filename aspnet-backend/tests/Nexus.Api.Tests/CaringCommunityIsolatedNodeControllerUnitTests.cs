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

public class CaringCommunityIsolatedNodeControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelIsolatedNodeRoutes()
    {
        typeof(AdminCaringCommunityIsolatedNodeController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/isolated-node");

        typeof(AdminCaringCommunityIsolatedNodeController)
            .GetMethod(nameof(AdminCaringCommunityIsolatedNodeController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();

        typeof(AdminCaringCommunityIsolatedNodeController)
            .GetMethod(nameof(AdminCaringCommunityIsolatedNodeController.Update))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("items/{itemKey}");
    }

    [Fact]
    public async Task Index_ReturnsSchemaBackedGateAndTenantScopedStoredItems()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedIsolatedNodeConfigs(db);
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await controller.Index(CancellationToken.None));
        var items = data.GetProperty("items").EnumerateArray().ToArray();

        items.Should().HaveCount(11);
        var deployment = items.Single(row => row.GetProperty("key").GetString() == "deployment_mode");
        deployment.GetProperty("label").GetString().Should().Be("Deployment mode");
        deployment.GetProperty("type").GetString().Should().Be("enum");
        deployment.GetProperty("choices").EnumerateArray().Select(x => x.GetString())
            .Should().Equal("hosted_tenant", "hosted_custom_domain", "canton_isolated_node");
        deployment.GetProperty("value").GetString().Should().Be("hosted_custom_domain");
        deployment.GetProperty("owner").GetString().Should().Be("KISS Cham");
        deployment.GetProperty("status").GetString().Should().Be("decided");
        deployment.GetProperty("notes").GetString().Should().Be("Custom domain selected.");

        var blocked = items.Single(row => row.GetProperty("key").GetString() == "federation_key_exchange");
        blocked.GetProperty("status").GetString().Should().Be("blocked");

        var missing = items.Single(row => row.GetProperty("key").GetString() == "smtp_owner");
        missing.GetProperty("status").GetString().Should().Be("pending");
        missing.GetProperty("value").ValueKind.Should().Be(JsonValueKind.Null);

        var gate = data.GetProperty("gate");
        gate.GetProperty("closed").GetBoolean().Should().BeFalse();
        gate.GetProperty("decided_count").GetInt32().Should().Be(1);
        gate.GetProperty("total_count").GetInt32().Should().Be(11);
        gate.GetProperty("blockers").EnumerateArray().Select(x => x.GetString())
            .Should().Equal("federation_key_exchange");
        gate.GetProperty("status_counts").GetProperty("pending").GetInt32().Should().Be(9);
        gate.GetProperty("status_counts").GetProperty("decided").GetInt32().Should().Be(1);
        gate.GetProperty("status_counts").GetProperty("blocked").GetInt32().Should().Be(1);

        data.GetProperty("last_updated_at").GetString().Should().Contain("2026-07-03");
    }

    [Fact]
    public async Task Update_ValidatesAndPersistsPartialEnvelopeInTenantConfig()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Update(
            "update_cadence",
            Json("""
                {
                  "value": "monthly",
                  "owner": "  Operations Lead  ",
                  "status": "decided",
                  "notes": "  Reviewed by the launch board.  "
                }
                """),
            CancellationToken.None);

        var data = ReadData(result);
        var item = data.GetProperty("item");
        item.GetProperty("key").GetString().Should().Be("update_cadence");
        item.GetProperty("value").GetString().Should().Be("monthly");
        item.GetProperty("owner").GetString().Should().Be("Operations Lead");
        item.GetProperty("status").GetString().Should().Be("decided");
        item.GetProperty("notes").GetString().Should().Be("Reviewed by the launch board.");
        item.GetProperty("updated_at").GetString().Should().NotBeNullOrWhiteSpace();

        data.GetProperty("gate").GetProperty("decided_count").GetInt32().Should().Be(1);

        var stored = await db.TenantConfigs.IgnoreQueryFilters().SingleAsync(c =>
            c.TenantId == 42 && c.Key == "caring.isolated_node.update_cadence");
        using var document = JsonDocument.Parse(stored.Value);
        document.RootElement.GetProperty("value").GetString().Should().Be("monthly");
        document.RootElement.GetProperty("owner").GetString().Should().Be("Operations Lead");
        document.RootElement.GetProperty("status").GetString().Should().Be("decided");

        var cleared = ReadData(await controller.Update(
            "update_cadence",
            Json("""{ "owner": null, "notes": "" }"""),
            CancellationToken.None)).GetProperty("item");

        cleared.GetProperty("owner").ValueKind.Should().Be(JsonValueKind.Null);
        cleared.GetProperty("notes").ValueKind.Should().Be(JsonValueKind.Null);
        cleared.GetProperty("value").GetString().Should().Be("monthly");
        cleared.GetProperty("status").GetString().Should().Be("decided");
    }

    [Fact]
    public async Task Update_ReturnsLaravelValidationErrorsForBadPayloads()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        AssertSingleError(
            await controller.Update("unknown", Json("""{ "status": "decided" }"""), CancellationToken.None),
            StatusCodes.Status404NotFound,
            "INVALID_ITEM_KEY",
            "item_key");

        AssertSingleError(
            await controller.Update("deployment_mode", Json("""{}"""), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "EMPTY_PAYLOAD",
            null);

        AssertSingleError(
            await controller.Update("deployment_mode", Json("""{ "value": "random" }"""), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "INVALID_CHOICE",
            "value");

        AssertSingleError(
            await controller.Update("deployment_mode", Json("""{ "status": "done" }"""), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "INVALID_STATUS",
            "status");

        AssertSingleError(
            await controller.Update("incident_runbook_url", Json("""{ "value": "not-a-url" }"""), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "INVALID_URL",
            "value");
    }

    [Fact]
    public async Task Controllers_WhenFeatureDisabled_ReturnLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        AssertSingleError(
            await controller.Index(CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED",
            null);

        AssertSingleError(
            await controller.Update("deployment_mode", Json("""{ "status": "decided" }"""), CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED",
            null);
    }

    private static void SeedIsolatedNodeConfigs(NexusDbContext db)
    {
        db.TenantConfigs.AddRange(
            new TenantConfig
            {
                TenantId = 42,
                Key = "caring.isolated_node.deployment_mode",
                Value = """
                    {
                      "value": "hosted_custom_domain",
                      "owner": "KISS Cham",
                      "status": "decided",
                      "notes": "Custom domain selected.",
                      "updated_at": "2026-07-01T08:00:00Z"
                    }
                    """,
                CreatedAt = new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc)
            },
            new TenantConfig
            {
                TenantId = 42,
                Key = "caring.isolated_node.federation_key_exchange",
                Value = """
                    {
                      "value": "Manual exchange pending",
                      "owner": "KISS Verband",
                      "status": "blocked",
                      "notes": "Waiting on key registry.",
                      "updated_at": "2026-07-03T09:30:00Z"
                    }
                    """,
                CreatedAt = new DateTime(2026, 7, 3, 9, 30, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 3, 9, 30, 0, DateTimeKind.Utc)
            },
            new TenantConfig
            {
                TenantId = 7,
                Key = "caring.isolated_node.deployment_mode",
                Value = """{ "value": "canton_isolated_node", "status": "decided" }""",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
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

    private static JsonElement ReadData(IActionResult result)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(((ObjectResult) result).Value));
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

    private static JsonElement Json(string raw)
    {
        using var document = JsonDocument.Parse(raw);
        return document.RootElement.Clone();
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

    private static AdminCaringCommunityIsolatedNodeController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new IsolatedNodeReadinessService(db);
        return new AdminCaringCommunityIsolatedNodeController(service, tenant)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                        new Claim("tenant_id", tenant.GetTenantIdOrThrow().ToString()),
                        new Claim(ClaimTypes.Role, "admin"),
                        new Claim("role", "admin")
                    ], "Test"))
                }
            }
        };
    }
}
