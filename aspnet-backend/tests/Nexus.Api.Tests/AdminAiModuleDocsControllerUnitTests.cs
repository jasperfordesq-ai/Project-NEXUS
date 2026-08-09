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
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class AdminAiModuleDocsControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelAiModuleDocsRoutes()
    {
        var routeTemplates = typeof(AdminAiModuleDocsController)
            .GetCustomAttributes<RouteAttribute>()
            .Select(route => route.Template)
            .ToArray();

        routeTemplates.Should().BeEquivalentTo("api/admin/ai-module-docs", "api/v2/admin/ai-module-docs");
        typeof(AdminAiModuleDocsController)
            .GetCustomAttribute<AuthorizeAttribute>()?.Policy.Should().Be("AdminOnly");

        typeof(AdminAiModuleDocsController)
            .GetMethod(nameof(AdminAiModuleDocsController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminAiModuleDocsController)
            .GetMethod(nameof(AdminAiModuleDocsController.Store))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().BeNull();
        typeof(AdminAiModuleDocsController)
            .GetMethod(nameof(AdminAiModuleDocsController.Update))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("{id:int}");
        typeof(AdminAiModuleDocsController)
            .GetMethod(nameof(AdminAiModuleDocsController.Destroy))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("{id:int}");
        typeof(AdminAiModuleDocsController)
            .GetMethod(nameof(AdminAiModuleDocsController.SeedDefaults))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("seed-defaults");
    }

    [Fact]
    public async Task StoreIndexUpdateDelete_MatchesLaravelEnvelopeAndTenantIsolation()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 9001);

        var invalid = await controller.Store(new AiModuleDocRequest
        {
            ModuleSlug = "Bad Slug",
            Title = "Bad",
            Body = "Invalid slug"
        }, CancellationToken.None);

        var invalidResult = invalid.Should().BeOfType<ObjectResult>().Subject;
        invalidResult.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        using (var invalidDocument = JsonDocument.Parse(JsonSerializer.Serialize(invalidResult.Value)))
        {
            var error = invalidDocument.RootElement.GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("VALIDATION");
            error.GetProperty("message").GetString().Should().Contain("module_slug");
        }

        var created = await controller.Store(new AiModuleDocRequest
        {
            ModuleSlug = "wallet",
            Title = "Wallet help",
            Body = "Wallet body",
            Keywords = ["wallet", "credits"],
            IsActive = true
        }, CancellationToken.None);

        var createdObject = created.Should().BeOfType<ObjectResult>().Subject;
        createdObject.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(createdObject.Value));
        var createdDoc = createdDocument.RootElement.GetProperty("data");
        var id = createdDoc.GetProperty("id").GetInt32();
        createdDoc.GetProperty("module_slug").GetString().Should().Be("wallet");
        createdDoc.GetProperty("keywords").EnumerateArray().Select(value => value.GetString()).Should()
            .Equal("wallet", "credits");
        createdDoc.GetProperty("is_active").GetBoolean().Should().BeTrue();

        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = 7,
            Key = "ai_module_docs.other",
            Value = JsonSerializer.Serialize(new StoredAiModuleDoc
            {
                ModuleSlug = "other",
                Title = "Other tenant",
                Body = "Should not leak",
                Keywords = ["other"],
                IsActive = true,
                CreatedBy = 7,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            }, new JsonSerializerOptions(JsonSerializerDefaults.Web))
        });
        await db.SaveChangesAsync();

        var list = await controller.Index(CancellationToken.None);

        var listOk = list.Should().BeOfType<OkObjectResult>().Subject;
        using (var listDocument = JsonDocument.Parse(JsonSerializer.Serialize(listOk.Value)))
        {
            var items = listDocument.RootElement.GetProperty("data").EnumerateArray().ToArray();
            items.Should().HaveCount(1);
            items[0].GetProperty("module_slug").GetString().Should().Be("wallet");
        }

        var updated = await controller.Update(id, new AiModuleDocRequest
        {
            ModuleSlug = "attempted-rename",
            Title = "Wallet edited",
            Body = "Edited body",
            Keywords = ["payments"],
            IsActive = false
        }, CancellationToken.None);

        var updatedOk = updated.Should().BeOfType<OkObjectResult>().Subject;
        using (var updatedDocument = JsonDocument.Parse(JsonSerializer.Serialize(updatedOk.Value)))
        {
            var updatedDoc = updatedDocument.RootElement.GetProperty("data");
            updatedDoc.GetProperty("id").GetInt32().Should().Be(id);
            updatedDoc.GetProperty("module_slug").GetString().Should().Be("wallet");
            updatedDoc.GetProperty("title").GetString().Should().Be("Wallet edited");
            updatedDoc.GetProperty("is_active").GetBoolean().Should().BeFalse();
        }

        var deleted = await controller.Destroy(id, CancellationToken.None);

        var deletedOk = deleted.Should().BeOfType<OkObjectResult>().Subject;
        using (var deletedDocument = JsonDocument.Parse(JsonSerializer.Serialize(deletedOk.Value)))
        {
            deletedDocument.RootElement.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        }

        (await controller.Destroy(id, CancellationToken.None)).Should().BeOfType<OkObjectResult>()
            .Which.Value.Should().NotBeNull();
    }

    [Fact]
    public async Task UpdateMissingAndSeedDefaults_ReturnLaravelShapes()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 9001);

        var missing = await controller.Update(999, new AiModuleDocRequest
        {
            Title = "Missing",
            Body = "Missing body"
        }, CancellationToken.None);

        var missingObject = missing.Should().BeOfType<ObjectResult>().Subject;
        missingObject.StatusCode.Should().Be(StatusCodes.Status404NotFound);
        using (var missingDocument = JsonDocument.Parse(JsonSerializer.Serialize(missingObject.Value)))
        {
            missingDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().Be("NOT_FOUND");
        }

        var seed = await controller.SeedDefaults(CancellationToken.None);

        var seedOk = seed.Should().BeOfType<OkObjectResult>().Subject;
        int inserted;
        using (var seedDocument = JsonDocument.Parse(JsonSerializer.Serialize(seedOk.Value)))
        {
            inserted = seedDocument.RootElement.GetProperty("data").GetProperty("inserted").GetInt32();
            inserted.Should().BeGreaterThan(0);
        }

        var seedAgain = await controller.SeedDefaults(CancellationToken.None);

        var seedAgainOk = seedAgain.Should().BeOfType<OkObjectResult>().Subject;
        using var seedAgainDocument = JsonDocument.Parse(JsonSerializer.Serialize(seedAgainOk.Value));
        seedAgainDocument.RootElement.GetProperty("data").GetProperty("inserted").GetInt32().Should().Be(0);

        var count = await db.TenantConfigs.IgnoreQueryFilters()
            .CountAsync(config => config.TenantId == 42 && config.Key.StartsWith(AiModuleDocsService.ConfigKeyPrefix));
        count.Should().Be(inserted);
    }

    private static AdminAiModuleDocsController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new AiModuleDocsService(db);
        return new AdminAiModuleDocsController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
        };
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
