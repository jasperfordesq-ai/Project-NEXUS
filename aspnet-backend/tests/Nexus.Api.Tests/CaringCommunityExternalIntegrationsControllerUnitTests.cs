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

public class CaringCommunityExternalIntegrationsControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelExternalIntegrationRoutes()
    {
        typeof(AdminCaringCommunityExternalIntegrationsController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/external-integrations");

        typeof(AdminCaringCommunityExternalIntegrationsController)
            .GetMethod(nameof(AdminCaringCommunityExternalIntegrationsController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityExternalIntegrationsController)
            .GetMethod(nameof(AdminCaringCommunityExternalIntegrationsController.SeedDefaults))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("seed-defaults");
        typeof(AdminCaringCommunityExternalIntegrationsController)
            .GetMethod(nameof(AdminCaringCommunityExternalIntegrationsController.Store))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityExternalIntegrationsController)
            .GetMethod(nameof(AdminCaringCommunityExternalIntegrationsController.Update))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("{itemId}");
        typeof(AdminCaringCommunityExternalIntegrationsController)
            .GetMethod(nameof(AdminCaringCommunityExternalIntegrationsController.Destroy))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("{itemId}");
    }

    [Fact]
    public async Task Index_ReturnsCurrentTenantEnvelopeOnly()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        SeedBacklog(db, 42, """
        {
          "items": [
            {
              "id": "intg_tenant",
              "name": "Spitex handoff",
              "category": "professional_care",
              "owner_name": "Care Partner",
              "owner_email": "care@example.test",
              "status": "sandbox",
              "interface_spec_url": "https://example.test/spec",
              "dsa_status": "signed",
              "sandbox_url": "https://sandbox.example.test",
              "notes": "Tenant item",
              "created_at": "2026-07-03T10:00:00Z",
              "updated_at": "2026-07-03T11:00:00Z"
            }
          ],
          "updated_at": "2026-07-03T11:00:00Z"
        }
        """);
        SeedBacklog(db, 7, """
        {"items":[{"id":"intg_other","name":"Other tenant","category":"postal","status":"proposed","dsa_status":"not_required"}],"updated_at":"2026-07-03T12:00:00Z"}
        """);
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant);

        var result = await controller.Index(CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("last_updated_at").GetString().Should().Be("2026-07-03T11:00:00Z");
        var items = data.GetProperty("items").EnumerateArray().ToArray();
        items.Should().HaveCount(1);
        items[0].GetProperty("id").GetString().Should().Be("intg_tenant");
        items[0].GetProperty("name").GetString().Should().Be("Spitex handoff");
    }

    [Fact]
    public async Task Store_ValidatesAndPersistsLaravelBacklogItem()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Store(new ExternalIntegrationRequest
        {
            Name = "  AHV submission gateway  ",
            Category = "ahv",
            OwnerName = "Cantonal Office",
            OwnerEmail = "owner@example.test",
            Status = "scoping",
            InterfaceSpecUrl = "https://example.test/if",
            DsaStatus = "in_review",
            SandboxUrl = "https://sandbox.example.test",
            Notes = "Awaiting signed interface pack."
        }, CancellationToken.None);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var item = document.RootElement.GetProperty("data").GetProperty("item");
        item.GetProperty("id").GetString().Should().StartWith("intg_");
        item.GetProperty("name").GetString().Should().Be("AHV submission gateway");
        item.GetProperty("category").GetString().Should().Be("ahv");
        item.GetProperty("owner_email").GetString().Should().Be("owner@example.test");
        item.GetProperty("dsa_status").GetString().Should().Be("in_review");

        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == "caring.external_integrations");
        using var storedDocument = JsonDocument.Parse(stored.Value);
        storedDocument.RootElement.GetProperty("items")[0].GetProperty("name").GetString()
            .Should().Be("AHV submission gateway");
        storedDocument.RootElement.GetProperty("updated_at").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task SeedDefaults_SeedsSixItemsAndRefusesToOverwriteExistingBacklog()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var seeded = await controller.SeedDefaults(CancellationToken.None);

        var ok = seeded.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("items").EnumerateArray().Should().HaveCount(6);
        data.GetProperty("items")[0].GetProperty("name").GetString().Should().Be("AHV submission gateway");

        var second = await controller.SeedDefaults(CancellationToken.None);

        var conflict = second.Should().BeOfType<ObjectResult>().Subject;
        conflict.StatusCode.Should().Be(StatusCodes.Status409Conflict);
        using var conflictDocument = JsonDocument.Parse(JsonSerializer.Serialize(conflict.Value));
        conflictDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("ALREADY_SEEDED");
    }

    [Fact]
    public async Task Update_InvalidEmailReturnsLaravelValidationErrorAndDoesNotMutate()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        SeedBacklog(db, 42, """
        {"items":[{"id":"intg_abc","name":"Postal","category":"postal","owner_name":"","owner_email":"","status":"proposed","interface_spec_url":"","dsa_status":"not_required","sandbox_url":"","notes":"","created_at":"2026-07-03T10:00:00Z","updated_at":"2026-07-03T10:00:00Z"}],"updated_at":"2026-07-03T10:00:00Z"}
        """);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Update("intg_abc", new ExternalIntegrationRequest
        {
            OwnerEmail = "not an email"
        }, CancellationToken.None);

        var invalid = result.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(invalid.Value));
        var error = document.RootElement.GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("VALIDATION_EMAIL");
        error.GetProperty("field").GetString().Should().Be("owner_email");

        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == "caring.external_integrations");
        stored.Value.Should().Contain("\"owner_email\":\"\"");
    }

    [Fact]
    public async Task Destroy_RemovesCurrentTenantItemAndReturnsNotFoundForMissingItem()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        SeedBacklog(db, 42, """
        {"items":[{"id":"intg_delete","name":"Postal","category":"postal","status":"proposed","dsa_status":"not_required"}],"updated_at":"2026-07-03T10:00:00Z"}
        """);
        SeedBacklog(db, 7, """
        {"items":[{"id":"intg_delete","name":"Other","category":"postal","status":"proposed","dsa_status":"not_required"}],"updated_at":"2026-07-03T10:00:00Z"}
        """);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Destroy("intg_delete", CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("ok").GetBoolean().Should().BeTrue();
        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == "caring.external_integrations");
        JsonDocument.Parse(stored.Value).RootElement.GetProperty("items").EnumerateArray()
            .Should().BeEmpty();
        (await db.TenantConfigs.IgnoreQueryFilters()
                .SingleAsync(c => c.TenantId == 7 && c.Key == "caring.external_integrations"))
            .Value.Should().Contain("Other");

        var missing = await controller.Destroy("intg_missing", CancellationToken.None);

        var notFound = missing.Should().BeOfType<NotFoundObjectResult>().Subject;
        using var notFoundDocument = JsonDocument.Parse(JsonSerializer.Serialize(notFound.Value));
        notFoundDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task Index_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Index(CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
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

    private static void SeedBacklog(NexusDbContext db, int tenantId, string value)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "caring.external_integrations",
            Value = value
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

    private static AdminCaringCommunityExternalIntegrationsController CreateController(
        NexusDbContext db,
        TenantContext tenant)
    {
        var service = new ExternalIntegrationBacklogService(db, tenant);
        return new AdminCaringCommunityExternalIntegrationsController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId: 9001, tenantId: tenant.GetTenantIdOrThrow(), role: "admin")
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
