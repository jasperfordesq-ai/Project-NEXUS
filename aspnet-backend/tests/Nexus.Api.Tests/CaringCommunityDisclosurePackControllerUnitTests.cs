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

public class CaringCommunityDisclosurePackControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelDisclosurePackRoutes()
    {
        typeof(AdminCaringCommunityDisclosurePackController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/disclosure-pack");

        typeof(AdminCaringCommunityDisclosurePackController)
            .GetMethod(nameof(AdminCaringCommunityDisclosurePackController.Show))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityDisclosurePackController)
            .GetMethod(nameof(AdminCaringCommunityDisclosurePackController.Update))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityDisclosurePackController)
            .GetMethod(nameof(AdminCaringCommunityDisclosurePackController.Export))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("export");
    }

    [Fact]
    public async Task Show_ReturnsDefaultPackWithTenantCustomizationMetadata()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = 7,
            Key = PilotDisclosurePackService.SettingKey,
            Value = JsonSerializer.Serialize(new
            {
                controller = new { name = "Other tenant" }
            })
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Show(CancellationToken.None);

        var data = ReadData(result);
        data.GetProperty("is_customised").GetBoolean().Should().BeFalse();
        data.GetProperty("last_updated_at").ValueKind.Should().Be(JsonValueKind.Null);

        var pack = data.GetProperty("pack");
        pack.GetProperty("controller").GetProperty("name").GetString().Should().Be("");
        pack.GetProperty("processor").GetProperty("name").GetString().Should().Be("Project NEXUS / Jasper Ford");
        pack.GetProperty("processor").GetProperty("contact_email").GetString().Should().Be("funding@hour-timebank.ie");
        pack.GetProperty("data_categories").GetProperty("caring").EnumerateArray()
            .Select(item => item.GetString())
            .Should().Contain(["help_requests", "support_relationships", "caregiver_links"]);
    }

    [Fact]
    public async Task Update_ValidatesDeepMergesAndPersistsTenantConfig()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = 42,
            Key = PilotDisclosurePackService.SettingKey,
            Value = JsonSerializer.Serialize(new
            {
                incident_response = new
                {
                    owner_name = "Existing owner",
                    notification_window_hours = 48
                }
            }),
            UpdatedAt = new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var invalid = await controller.Update(new DisclosurePackUpdateRequest
        {
            Controller = new Dictionary<string, object?> { ["contact_email"] = "not-an-email" },
            IncidentResponse = new Dictionary<string, object?>
            {
                ["contact_email"] = "also-bad",
                ["notification_window_hours"] = 721
            }
        }, CancellationToken.None);

        AssertErrors(invalid, StatusCodes.Status422UnprocessableEntity,
        [
            "controller.contact_email",
            "incident_response.contact_email",
            "incident_response.notification_window_hours"
        ]);

        var valid = await controller.Update(new DisclosurePackUpdateRequest
        {
            Controller = new Dictionary<string, object?>
            {
                ["name"] = "Gemeinde Beispiel",
                ["contact_email"] = "privacy@example.test"
            },
            Processor = new Dictionary<string, object?>
            {
                ["sub_processors"] = new[] { "Tenant SMTP (CH)" }
            },
            IncidentResponse = new Dictionary<string, object?>
            {
                ["notification_window_hours"] = 24
            }
        }, CancellationToken.None);

        var data = ReadData(valid);
        var pack = data.GetProperty("pack");
        pack.GetProperty("controller").GetProperty("name").GetString().Should().Be("Gemeinde Beispiel");
        pack.GetProperty("controller").GetProperty("contact_email").GetString().Should().Be("privacy@example.test");
        pack.GetProperty("processor").GetProperty("name").GetString().Should().Be("Project NEXUS / Jasper Ford");
        pack.GetProperty("processor").GetProperty("sub_processors").EnumerateArray()
            .Select(item => item.GetString())
            .Should().Equal("Tenant SMTP (CH)");
        pack.GetProperty("incident_response").GetProperty("owner_name").GetString().Should().Be("Existing owner");
        pack.GetProperty("incident_response").GetProperty("notification_window_hours").GetInt32().Should().Be(24);

        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == PilotDisclosurePackService.SettingKey);
        stored.Value.Should().Contain("Gemeinde Beispiel");
        stored.Value.Should().Contain("Tenant SMTP (CH)");
        stored.UpdatedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task Export_ReturnsLaravelMarkdownEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = 42,
            Key = PilotDisclosurePackService.SettingKey,
            Value = JsonSerializer.Serialize(new
            {
                controller = new { name = "Gemeinde Beispiel" }
            })
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Export(CancellationToken.None);

        var data = ReadData(result);
        data.GetProperty("format").GetString().Should().Be("markdown");
        data.GetProperty("filename").GetString().Should().Be("fadp-ndsg-disclosure-pack.md");
        var content = data.GetProperty("content").GetString();
        content.Should().Contain("# Swiss FADP / nDSG Disclosure Pack");
        content.Should().Contain("## 1. Controller");
        content.Should().Contain("Gemeinde Beispiel");
        content.Should().Contain("Generated");
        content.Should().Contain("tenant ID 42");
    }

    [Fact]
    public async Task Show_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Show(CancellationToken.None);

        AssertSingleError(result, StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertErrors(IActionResult result, int statusCode, string[] fields)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        var errors = document.RootElement.GetProperty("errors").EnumerateArray().ToArray();
        errors.Should().HaveCount(fields.Length);
        errors.Should().OnlyContain(error => error.GetProperty("code").GetString() == "VALIDATION_ERROR");
        errors.Select(error => error.GetProperty("field").GetString()).Should().BeEquivalentTo(fields);
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

    private static AdminCaringCommunityDisclosurePackController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new PilotDisclosurePackService(db, tenant);
        return new AdminCaringCommunityDisclosurePackController(service, tenant)
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
