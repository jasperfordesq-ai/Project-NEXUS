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

public class CaringCommunityIntegrationShowcaseControllerUnitTests
{
    [Fact]
    public void Index_ExposesLaravelIntegrationShowcaseRoute()
    {
        typeof(AdminCaringCommunityIntegrationShowcaseController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/integration-showcase");

        typeof(AdminCaringCommunityIntegrationShowcaseController)
            .GetMethod(nameof(AdminCaringCommunityIntegrationShowcaseController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
    }

    [Fact]
    public async Task Index_ReturnsLaravelManifestSections()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Index(CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("updated_at").GetString().Should().NotBeNullOrWhiteSpace();

        var sections = data.GetProperty("sections").EnumerateArray().ToArray();
        sections.Select(section => section.GetProperty("id").GetString()).Should().Equal(
            "openapi",
            "partner_api",
            "oauth",
            "webhooks",
            "federation",
            "sample_payloads",
            "partner_checklist");

        sections[0].GetProperty("items").EnumerateArray().Select(item => item.GetProperty("path").GetString())
            .Should().Contain(["/api/v2/docs/openapi.json", "/api/v2/docs/openapi.yaml"]);
        sections[1].GetProperty("items").EnumerateArray().Should().HaveCount(8);
        sections[2].GetProperty("sample_request").GetProperty("curl").GetString()
            .Should().Contain("grant_type=client_credentials");
        sections[3].GetProperty("verification_note").GetString()
            .Should().Contain("HMAC-SHA256(body, secret)");
        sections[4].GetProperty("items")[0].GetProperty("path").GetString()
            .Should().Be("/api/v2/federation/aggregates");

        var samples = sections[5].GetProperty("samples").EnumerateArray().ToArray();
        samples.Should().HaveCount(3);
        samples[0].GetProperty("body").GetString().Should().Contain("\"schema_version\": 1");
        samples[1].GetProperty("headers").EnumerateArray().Select(header => header.GetString())
            .Should().Contain("X-NEXUS-Event-Id: evt_2YxK1bn7q3aQ");
        samples[2].GetProperty("body").GetString().Should().Contain("\"active_members\": 248");

        sections[6].GetProperty("checklist").EnumerateArray().Select(item => item.GetString())
            .Should().Contain("Sandbox tenant slug for integration testing");
    }

    [Fact]
    public async Task Index_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Index(CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        var error = document.RootElement.GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("FEATURE_DISABLED");
        error.GetProperty("message").GetString().Should().Be("Service unavailable");
    }

    private static AdminCaringCommunityIntegrationShowcaseController CreateController(
        NexusDbContext db,
        TenantContext tenant)
    {
        var service = new IntegrationShowcaseService(db);
        return new AdminCaringCommunityIntegrationShowcaseController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId: 9001, tenantId: tenant.GetTenantIdOrThrow())
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
