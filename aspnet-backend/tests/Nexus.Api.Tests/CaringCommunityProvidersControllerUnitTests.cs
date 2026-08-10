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

public class CaringCommunityProvidersControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelProviderDirectoryRoutes()
    {
        typeof(CaringCommunityProvidersController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/providers");
        typeof(AdminCaringCommunityProvidersController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/providers");

        typeof(CaringCommunityProvidersController)
            .GetMethod(nameof(CaringCommunityProvidersController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(CaringCommunityProvidersController)
            .GetMethod(nameof(CaringCommunityProvidersController.Show))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("{id:int}");
        typeof(AdminCaringCommunityProvidersController)
            .GetMethod(nameof(AdminCaringCommunityProvidersController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityProvidersController)
            .GetMethod(nameof(AdminCaringCommunityProvidersController.Duplicates))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("duplicates");
        typeof(AdminCaringCommunityProvidersController)
            .GetMethod(nameof(AdminCaringCommunityProvidersController.Store))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityProvidersController)
            .GetMethod(nameof(AdminCaringCommunityProvidersController.Update))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("{id:int}");
        typeof(AdminCaringCommunityProvidersController)
            .GetMethod(nameof(AdminCaringCommunityProvidersController.Destroy))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("{id:int}");
        typeof(AdminCaringCommunityProvidersController)
            .GetMethod(nameof(AdminCaringCommunityProvidersController.Verify))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/verify");
    }

    [Fact]
    public async Task Index_ReturnsActiveCurrentTenantProvidersWithFiltersAndSubRegionSummary()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        var subRegion = SubRegion(42, "zug-west", "Zug West");
        db.CaringSubRegions.Add(subRegion);
        await db.SaveChangesAsync();
        db.CaringCareProviders.AddRange(
            Provider(42, "Spitex Zug", "spitex", isVerified: true, subRegionId: subRegion.Id, description: "Home nursing"),
            Provider(42, "Private Care", "private", isVerified: true, subRegionId: subRegion.Id),
            Provider(42, "Inactive Spitex", "spitex", status: "inactive", isVerified: true, subRegionId: subRegion.Id),
            Provider(42, "Unverified Spitex", "spitex", isVerified: false, subRegionId: subRegion.Id),
            Provider(7, "Spitex Other", "spitex", isVerified: true, subRegionId: subRegion.Id));
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 1001);

        var result = await controller.Index(
            type: "spitex",
            search: "Spitex",
            subRegionId: subRegion.Id,
            verifiedOnly: true,
            page: 1,
            ct: CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var payload = document.RootElement.GetProperty("data");
        payload.GetProperty("total").GetInt32().Should().Be(1);
        payload.GetProperty("per_page").GetInt32().Should().Be(20);
        payload.GetProperty("current_page").GetInt32().Should().Be(1);

        var row = payload.GetProperty("data").EnumerateArray().Single();
        row.GetProperty("tenant_id").GetInt32().Should().Be(42);
        row.GetProperty("name").GetString().Should().Be("Spitex Zug");
        row.GetProperty("is_verified").GetBoolean().Should().BeTrue();
        row.GetProperty("sub_region_id").GetInt32().Should().Be(subRegion.Id);
        row.GetProperty("sub_region").GetProperty("slug").GetString().Should().Be("zug-west");
    }

    [Fact]
    public async Task Show_HidesInactiveAndOtherTenantProvidersFromMembers()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringCareProviders.AddRange(
            Provider(42, "Visible", "spitex"),
            Provider(42, "Hidden", "spitex", status: "inactive"),
            Provider(7, "Other", "spitex"));
        await db.SaveChangesAsync();
        var visibleId = await db.CaringCareProviders.IgnoreQueryFilters()
            .Where(p => p.TenantId == 42 && p.Name == "Visible")
            .Select(p => p.Id)
            .SingleAsync();
        var inactiveId = await db.CaringCareProviders.IgnoreQueryFilters()
            .Where(p => p.TenantId == 42 && p.Name == "Hidden")
            .Select(p => p.Id)
            .SingleAsync();
        var controller = CreateMemberController(db, tenant, userId: 1001);

        var visible = await controller.Show(visibleId, CancellationToken.None);
        var hidden = await controller.Show(inactiveId, CancellationToken.None);

        visible.Should().BeOfType<OkObjectResult>();
        hidden.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task StoreAndUpdate_ValidateSubRegionAndPersistJsonPayloadsForTenant()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        var subRegion = SubRegion(42, "zug-west", "Zug West");
        var otherSubRegion = SubRegion(7, "other", "Other");
        db.CaringSubRegions.AddRange(subRegion, otherSubRegion);
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var invalid = await controller.Store(new CaringCareProviderRequest
        {
            Name = "Invalid",
            Type = "spitex",
            SubRegionId = otherSubRegion.Id
        }, CancellationToken.None);

        var invalidResult = invalid.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        using (var invalidDocument = JsonDocument.Parse(JsonSerializer.Serialize(invalidResult.Value)))
        {
            var error = invalidDocument.RootElement.GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
            error.GetProperty("field").GetString().Should().Be("sub_region_id");
        }

        var createdResult = await controller.Store(new CaringCareProviderRequest
        {
            Name = "Spitex Zug",
            Type = "spitex",
            Description = "Home care",
            Categories = new[] { "nursing", "transport" },
            Address = "Bahnhofstrasse 1",
            SubRegionId = subRegion.Id,
            ContactEmail = "hello@example.test",
            ContactPhone = "+41 41 000 00 00",
            WebsiteUrl = "https://spitex.example.test",
            OpeningHours = new Dictionary<string, object?> { ["mon"] = "08:00-17:00" }
        }, CancellationToken.None);

        var created = createdResult.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var row = createdDocument.RootElement.GetProperty("data");
        row.GetProperty("created_by").GetInt32().Should().Be(9001);
        row.GetProperty("categories").EnumerateArray().Select(x => x.GetString())
            .Should().Equal("nursing", "transport");
        row.GetProperty("opening_hours").GetProperty("mon").GetString().Should().Be("08:00-17:00");

        var providerId = row.GetProperty("id").GetInt32();
        var updateResult = await controller.Update(providerId, new CaringCareProviderRequest
        {
            Name = "Spitex Zug Updated",
            Status = "inactive",
            SubRegionId = null
        }, CancellationToken.None);

        var updateOk = updateResult.Should().BeOfType<OkObjectResult>().Subject;
        using var updateDocument = JsonDocument.Parse(JsonSerializer.Serialize(updateOk.Value));
        var updated = updateDocument.RootElement.GetProperty("data");
        updated.GetProperty("name").GetString().Should().Be("Spitex Zug Updated");
        updated.GetProperty("status").GetString().Should().Be("inactive");
        updated.GetProperty("sub_region_id").ValueKind.Should().Be(JsonValueKind.Null);

        var stored = await db.CaringCareProviders.IgnoreQueryFilters().SingleAsync(p => p.Id == providerId);
        stored.TenantId.Should().Be(42);
        stored.CreatedBy.Should().Be(9001);
        stored.Categories.Should().Contain("nursing");
        stored.OpeningHours.Should().Contain("08:00-17:00");
    }

    [Fact]
    public async Task VerifyDeleteAndDuplicates_AreTenantScopedAndLaravelShaped()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.CaringCareProviders.AddRange(
            Provider(42, "Spitex Zug AG", "spitex", email: "info@spitex-zug.test", phone: "+41 41 111 22 33", website: "https://www.spitex-zug.test", address: "Bahnhofstrasse 1 Pflegehaus Zug"),
            Provider(42, "Spitex Zug", "spitex", email: "info@spitex-zug.test", phone: "+41 41 111 22 33", website: "https://spitex-zug.test", address: "Bahnhofstrasse 1 Pflegehaus Zug"),
            Provider(7, "Spitex Zug", "spitex", email: "info@spitex-zug.test"));
        await db.SaveChangesAsync();
        var id = await db.CaringCareProviders.IgnoreQueryFilters()
            .Where(p => p.TenantId == 42 && p.Name == "Spitex Zug AG")
            .Select(p => p.Id)
            .SingleAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var verifyResult = await controller.Verify(id, CancellationToken.None);
        var verifyOk = verifyResult.Should().BeOfType<OkObjectResult>().Subject;
        using (var verifyDocument = JsonDocument.Parse(JsonSerializer.Serialize(verifyOk.Value)))
        {
            verifyDocument.RootElement.GetProperty("data").GetProperty("verified").GetBoolean().Should().BeTrue();
        }

        var duplicatesResult = await controller.Duplicates(threshold: 0.65m, CancellationToken.None);
        var duplicatesOk = duplicatesResult.Should().BeOfType<OkObjectResult>().Subject;
        using (var duplicatesDocument = JsonDocument.Parse(JsonSerializer.Serialize(duplicatesOk.Value)))
        {
            var duplicatePayload = duplicatesDocument.RootElement.GetProperty("data");
            duplicatePayload.GetProperty("total").GetInt32().Should().Be(1);
            duplicatePayload.GetProperty("scanned").GetInt32().Should().Be(2);
            var pair = duplicatePayload.GetProperty("pairs").EnumerateArray().Single();
            pair.GetProperty("signals").EnumerateArray().Select(x => x.GetString())
                .Should().Contain(["email_match", "phone_match", "website_match", "address_overlap"]);
        }

        var deleteResult = await controller.Destroy(id, CancellationToken.None);

        var deleteOk = deleteResult.Should().BeOfType<OkObjectResult>().Subject;
        using var deleteDocument = JsonDocument.Parse(JsonSerializer.Serialize(deleteOk.Value));
        deleteDocument.RootElement.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        (await db.CaringCareProviders.IgnoreQueryFilters().SingleAsync(p => p.Id == id))
            .Status.Should().Be("inactive");
        (await db.CaringCareProviders.IgnoreQueryFilters().SingleAsync(p => p.TenantId == 7))
            .Status.Should().Be("active");
    }

    [Fact]
    public async Task Index_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, false);
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 1001);

        var result = await controller.Index(ct: CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    private static CaringCareProvider Provider(
        int tenantId,
        string name,
        string type,
        string status = "active",
        bool isVerified = false,
        int? subRegionId = null,
        string? description = null,
        string? email = null,
        string? phone = null,
        string? website = null,
        string? address = null)
    {
        return new CaringCareProvider
        {
            TenantId = tenantId,
            Name = name,
            Type = type,
            Status = status,
            IsVerified = isVerified,
            SubRegionId = subRegionId,
            Description = description,
            ContactEmail = email,
            ContactPhone = phone,
            WebsiteUrl = website,
            Address = address,
            CreatedBy = 9001,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    private static CaringSubRegion SubRegion(int tenantId, string slug, string name)
    {
        return new CaringSubRegion
        {
            TenantId = tenantId,
            Slug = slug,
            Name = name,
            Type = "quartier",
            Status = "active",
            CreatedBy = 9001,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
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

    private static CaringCommunityProvidersController CreateMemberController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CareProviderDirectoryService(db, tenant);
        return new CaringCommunityProvidersController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "member")
        };
    }

    private static AdminCaringCommunityProvidersController CreateAdminController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CareProviderDirectoryService(db, tenant);
        return new AdminCaringCommunityProvidersController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
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
