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
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Messaging;

namespace Nexus.Api.Tests;

public class AdminHeaderLogoControllerUnitTests
{
    [Fact]
    public async Task UploadHeaderLogo_PersistsCurrentTenantLightLogoUrl()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        await SeedTenantsAsync(db);
        var uploadRoot = CreateUploadRoot();

        var controller = CreateController(db, tenantContext, uploadRoot);
        var action = typeof(AdminController).GetMethod(
            "UploadHeaderLogo",
            BindingFlags.Instance | BindingFlags.Public);

        action.Should().NotBeNull("Laravel exposes POST /api/v2/admin/settings/header-logo");
        var uploadAction = action ?? throw new InvalidOperationException("UploadHeaderLogo action was not found.");
        uploadAction.GetCustomAttributes<HttpPostAttribute>()
            .Select(attribute => attribute.Template)
            .Should().Contain("settings/header-logo");

        var logo = CreateFormFile("logo.png", "image/png", [0x89, 0x50, 0x4e, 0x47]);
        var result = await (Task<IActionResult>)uploadAction.Invoke(controller, [logo, CancellationToken.None])!;

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var url = document.RootElement.GetProperty("data").GetProperty("url").GetString();

        url.Should().StartWith("/api/files/");
        var config = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == "logo_url");
        config.Value.Should().Be(url);
        (await db.TenantConfigs.IgnoreQueryFilters()
                .AnyAsync(c => c.TenantId == 7 && c.Key == "logo_url"))
            .Should().BeFalse();

        var currentTenant = await db.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == 42);
        currentTenant.LogoUrl.Should().Be(url);
        db.FileUploads.IgnoreQueryFilters()
            .Single(f => f.TenantId == 42 && f.EntityType == "tenant_logo")
            .ContentType.Should().Be("image/png");
    }

    [Fact]
    public async Task UploadHeaderLogoDark_PersistsCurrentTenantDarkLogoConfigOnly()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        await SeedTenantsAsync(db);
        var uploadRoot = CreateUploadRoot();

        var controller = CreateController(db, tenantContext, uploadRoot);
        var action = typeof(AdminController).GetMethod(
            "UploadHeaderLogoDark",
            BindingFlags.Instance | BindingFlags.Public);

        action.Should().NotBeNull("Laravel exposes POST /api/v2/admin/settings/header-logo-dark");
        var uploadAction = action ?? throw new InvalidOperationException("UploadHeaderLogoDark action was not found.");
        uploadAction.GetCustomAttributes<HttpPostAttribute>()
            .Select(attribute => attribute.Template)
            .Should().Contain("settings/header-logo-dark");

        var logo = CreateFormFile("logo-dark.svg", "image/svg+xml", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"u8.ToArray());
        var result = await (Task<IActionResult>)uploadAction.Invoke(controller, [logo, CancellationToken.None])!;

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var url = document.RootElement.GetProperty("data").GetProperty("url").GetString();

        url.Should().StartWith("/api/files/");
        var config = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == "logo_dark_url");
        config.Value.Should().Be(url);

        var currentTenant = await db.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == 42);
        currentTenant.LogoUrl.Should().Be("/tenant/logo.svg");
    }

    [Fact]
    public async Task UploadPartnerLogo_PersistsCurrentTenantPartnerLogoUrl()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        await SeedTenantsAsync(db);
        var uploadRoot = CreateUploadRoot();

        var controller = CreateController(db, tenantContext, uploadRoot);
        var action = typeof(AdminController).GetMethod(
            "UploadPartnerLogo",
            BindingFlags.Instance | BindingFlags.Public);

        action.Should().NotBeNull("Laravel exposes POST /api/v2/admin/settings/partner-logo");
        var uploadAction = action ?? throw new InvalidOperationException("UploadPartnerLogo action was not found.");
        uploadAction.GetCustomAttributes<HttpPostAttribute>()
            .Select(attribute => attribute.Template)
            .Should().Contain("settings/partner-logo");

        var logo = CreateFormFile("partner.webp", "image/webp", [0x52, 0x49, 0x46, 0x46]);
        var result = await (Task<IActionResult>)uploadAction.Invoke(controller, [logo, CancellationToken.None])!;

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var url = document.RootElement.GetProperty("data").GetProperty("url").GetString();

        url.Should().StartWith("/api/files/");
        var config = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == "general.partner_logo_url");
        config.Value.Should().Be(url);
        (await db.TenantConfigs.IgnoreQueryFilters()
                .AnyAsync(c => c.TenantId == 7 && c.Key == "general.partner_logo_url"))
            .Should().BeFalse();

        var currentTenant = await db.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == 42);
        currentTenant.LogoUrl.Should().Be("/tenant/logo.svg");
        db.FileUploads.IgnoreQueryFilters()
            .Single(f => f.TenantId == 42 && f.EntityType == "partner_logo")
            .ContentType.Should().Be("image/webp");
    }

    [Fact]
    public async Task UploadHeaderLogo_RejectsUnsupportedLogoMimeType()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        await SeedTenantsAsync(db);
        var uploadRoot = CreateUploadRoot();

        var controller = CreateController(db, tenantContext, uploadRoot);
        var action = typeof(AdminController).GetMethod(
            "UploadHeaderLogo",
            BindingFlags.Instance | BindingFlags.Public);

        action.Should().NotBeNull("Laravel exposes POST /api/v2/admin/settings/header-logo");
        var uploadAction = action ?? throw new InvalidOperationException("UploadHeaderLogo action was not found.");

        var logo = CreateFormFile("logo.txt", "text/plain", "not an image"u8.ToArray());
        var result = await (Task<IActionResult>)uploadAction.Invoke(controller, [logo, CancellationToken.None])!;

        var invalid = result.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(invalid.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VALIDATION_ERROR");
        db.FileUploads.Should().BeEmpty();
    }

    [Fact]
    public async Task RemoveHeaderLogo_ClearsCurrentTenantLightLogoOnly()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        await SeedTenantsAsync(db);

        db.TenantConfigs.AddRange(
            new TenantConfig { TenantId = 42, Key = "logo_url", Value = "/tenant/light.svg" },
            new TenantConfig { TenantId = 42, Key = "logo_dark_url", Value = "/tenant/dark.svg" },
            new TenantConfig { TenantId = 7, Key = "logo_url", Value = "/other/light.svg" });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenantContext);
        var action = typeof(AdminController).GetMethod(
            "RemoveHeaderLogo",
            BindingFlags.Instance | BindingFlags.Public);

        action.Should().NotBeNull("Laravel exposes DELETE /api/v2/admin/settings/header-logo");
        var removeAction = action ?? throw new InvalidOperationException("RemoveHeaderLogo action was not found.");
        removeAction.GetCustomAttributes<HttpDeleteAttribute>()
            .Select(attribute => attribute.Template)
            .Should().Contain("settings/header-logo");

        var result = await (Task<IActionResult>)removeAction.Invoke(controller, [CancellationToken.None])!;

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("url").ValueKind
            .Should().Be(JsonValueKind.Null);

        (await db.TenantConfigs.IgnoreQueryFilters()
                .AnyAsync(c => c.TenantId == 42 && c.Key == "logo_url"))
            .Should().BeFalse();
        (await db.TenantConfigs.IgnoreQueryFilters()
                .AnyAsync(c => c.TenantId == 42 && c.Key == "logo_dark_url"))
            .Should().BeTrue();
        (await db.TenantConfigs.IgnoreQueryFilters()
                .AnyAsync(c => c.TenantId == 7 && c.Key == "logo_url"))
            .Should().BeTrue();

        var currentTenant = await db.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == 42);
        currentTenant.LogoUrl.Should().BeNull();
        var otherTenant = await db.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == 7);
        otherTenant.LogoUrl.Should().Be("/other/logo.svg");
    }

    [Fact]
    public async Task RemoveHeaderLogoDark_ClearsCurrentTenantDarkLogoOnly()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        await SeedTenantsAsync(db);

        db.TenantConfigs.AddRange(
            new TenantConfig { TenantId = 42, Key = "logo_url", Value = "/tenant/light.svg" },
            new TenantConfig { TenantId = 42, Key = "logo_dark_url", Value = "/tenant/dark.svg" },
            new TenantConfig { TenantId = 7, Key = "logo_dark_url", Value = "/other/dark.svg" });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenantContext);
        var action = typeof(AdminController).GetMethod(
            "RemoveHeaderLogoDark",
            BindingFlags.Instance | BindingFlags.Public);

        action.Should().NotBeNull("Laravel exposes DELETE /api/v2/admin/settings/header-logo-dark");
        var removeAction = action ?? throw new InvalidOperationException("RemoveHeaderLogoDark action was not found.");
        removeAction.GetCustomAttributes<HttpDeleteAttribute>()
            .Select(attribute => attribute.Template)
            .Should().Contain("settings/header-logo-dark");

        var result = await (Task<IActionResult>)removeAction.Invoke(controller, [CancellationToken.None])!;

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("url").ValueKind
            .Should().Be(JsonValueKind.Null);

        (await db.TenantConfigs.IgnoreQueryFilters()
                .AnyAsync(c => c.TenantId == 42 && c.Key == "logo_dark_url"))
            .Should().BeFalse();
        (await db.TenantConfigs.IgnoreQueryFilters()
                .AnyAsync(c => c.TenantId == 42 && c.Key == "logo_url"))
            .Should().BeTrue();
        (await db.TenantConfigs.IgnoreQueryFilters()
                .AnyAsync(c => c.TenantId == 7 && c.Key == "logo_dark_url"))
            .Should().BeTrue();

        var currentTenant = await db.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == 42);
        currentTenant.LogoUrl.Should().Be("/tenant/logo.svg");
    }

    private static NexusDbContext CreateDbContext(TenantContext tenantContext)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenantContext);
    }

    private static async Task SeedTenantsAsync(NexusDbContext db)
    {
        db.Tenants.AddRange(
            new Tenant
            {
                Id = 42,
                Slug = "tenant",
                Name = "Tenant",
                LogoUrl = "/tenant/logo.svg",
                IsActive = true
            },
            new Tenant
            {
                Id = 7,
                Slug = "other",
                Name = "Other",
                LogoUrl = "/other/logo.svg",
                IsActive = true
            });
        await db.SaveChangesAsync();
    }

    private static string CreateUploadRoot()
    {
        var path = Path.Combine(Path.GetTempPath(), "nexus-logo-upload-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static IFormFile CreateFormFile(string fileName, string contentType, byte[] bytes)
    {
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "logo", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType
        };
    }

    private static AdminController CreateController(
        NexusDbContext db,
        TenantContext tenantContext,
        string? uploadRoot = null)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["FileUpload:UploadsRoot"] = uploadRoot ?? CreateUploadRoot()
            })
            .Build();

        var controller = new AdminController(
            db,
            tenantContext,
            new NoOpEventPublisher(NullLogger<NoOpEventPublisher>.Instance),
            NullLogger<AdminController>.Instance,
            new CacheService(
                new MemoryCache(new MemoryCacheOptions()),
                NullLogger<CacheService>.Instance),
            new FileUploadService(
                db,
                config,
                NullLogger<FileUploadService>.Instance));
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, "1001"),
                    new Claim("sub", "1001")
                ], "unit-test"))
            }
        };

        return controller;
    }
}
