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

public class CaringCommunityCategoryCoefficientsControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelCategoryCoefficientRoutes()
    {
        typeof(AdminCaringCommunityCategoryCoefficientsController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/category-coefficients");

        typeof(AdminCaringCommunityCategoryCoefficientsController)
            .GetMethod(nameof(AdminCaringCommunityCategoryCoefficientsController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityCategoryCoefficientsController)
            .GetMethod(nameof(AdminCaringCommunityCategoryCoefficientsController.Update))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("{id:int}");
    }

    [Fact]
    public async Task Index_ReturnsActiveTenantCategoriesOrderedForLaravelEditor()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Categories.AddRange(
            Category(42, "Companionship", "companionship", 20, 0.40m),
            Category(42, "Medication", "medication", 10, 1.00m),
            Category(42, "Inactive", "inactive", 5, 0.20m, isActive: false),
            Category(7, "Other tenant", "other", 1, 0.90m));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await controller.Index(CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var payload = document.RootElement.GetProperty("data");
        payload.GetProperty("migration_pending").GetBoolean().Should().BeFalse();
        var rows = payload.GetProperty("categories").EnumerateArray().ToArray();
        rows.Should().HaveCount(2);
        rows[0].GetProperty("name").GetString().Should().Be("Medication");
        rows[0].GetProperty("substitution_coefficient").GetDecimal().Should().Be(1.00m);
        rows[0].GetProperty("source_table").GetString().Should().Be("categories");
        rows[1].GetProperty("name").GetString().Should().Be("Companionship");
    }

    [Fact]
    public async Task Update_ValidatesSourceTableRequiredNumericAndRangeLikeLaravel()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Categories.Add(Category(42, "Transport", "transport", 1, 0.70m));
        await db.SaveChangesAsync();
        var id = await db.Categories.Select(category => category.Id).SingleAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var invalidSource = await controller.Update(id, new CategoryCoefficientRequest
        {
            SourceTable = "caring_support_categories",
            SubstitutionCoefficient = 0.5m
        }, CancellationToken.None);
        var missingCoefficient = await controller.Update(id, new CategoryCoefficientRequest
        {
            SourceTable = "categories"
        }, CancellationToken.None);
        var nonNumeric = await controller.Update(id, new CategoryCoefficientRequest
        {
            SourceTable = "categories",
            SubstitutionCoefficient = "full"
        }, CancellationToken.None);
        var outOfRange = await controller.Update(id, new CategoryCoefficientRequest
        {
            SourceTable = "categories",
            SubstitutionCoefficient = 10.00m
        }, CancellationToken.None);

        AssertError(invalidSource, StatusCodes.Status422UnprocessableEntity, "VALIDATION_INVALID_FIELD", "source_table");
        AssertError(missingCoefficient, StatusCodes.Status422UnprocessableEntity, "VALIDATION_REQUIRED_FIELD", "substitution_coefficient");
        AssertError(nonNumeric, StatusCodes.Status422UnprocessableEntity, "VALIDATION_INVALID_FIELD", "substitution_coefficient");
        AssertError(outOfRange, StatusCodes.Status422UnprocessableEntity, "VALIDATION_OUT_OF_RANGE", "substitution_coefficient");
    }

    [Fact]
    public async Task Update_RoundsAndPersistsCurrentTenantCategoryOnly()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Categories.AddRange(
            Category(42, "Transport", "transport", 1, 0.70m),
            Category(7, "Other", "other", 1, 0.20m));
        await db.SaveChangesAsync();
        var id = await db.Categories.IgnoreQueryFilters()
            .Where(category => category.TenantId == 42)
            .Select(category => category.Id)
            .SingleAsync();
        var otherId = await db.Categories.IgnoreQueryFilters()
            .Where(category => category.TenantId == 7)
            .Select(category => category.Id)
            .SingleAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var updated = await controller.Update(id, new CategoryCoefficientRequest
        {
            SourceTable = "categories",
            SubstitutionCoefficient = 1.236m
        }, CancellationToken.None);
        var otherTenant = await controller.Update(otherId, new CategoryCoefficientRequest
        {
            SourceTable = "categories",
            SubstitutionCoefficient = 0.99m
        }, CancellationToken.None);

        var ok = updated.Should().BeOfType<OkObjectResult>().Subject;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value)))
        {
            var row = document.RootElement.GetProperty("data");
            row.GetProperty("id").GetInt32().Should().Be(id);
            row.GetProperty("substitution_coefficient").GetDecimal().Should().Be(1.24m);
            row.GetProperty("source_table").GetString().Should().Be("categories");
        }

        var stored = await db.Categories.IgnoreQueryFilters().SingleAsync(category => category.Id == id);
        stored.SubstitutionCoefficient.Should().Be(1.24m);
        AssertError(otherTenant, StatusCodes.Status404NotFound, "NOT_FOUND", null);
    }

    [Fact]
    public async Task Index_WhenFeatureDisabled_ReturnsLaravelForbiddenError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await controller.Index(CancellationToken.None);

        AssertError(result, StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
    }

    private static void AssertError(IActionResult result, int statusCode, string code, string? field)
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

    private static Category Category(
        int tenantId,
        string name,
        string slug,
        int sortOrder,
        decimal coefficient,
        bool isActive = true)
    {
        return new Category
        {
            TenantId = tenantId,
            Name = name,
            Slug = slug,
            SortOrder = sortOrder,
            IsActive = isActive,
            SubstitutionCoefficient = coefficient,
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

    private static AdminCaringCommunityCategoryCoefficientsController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringCategoryCoefficientService(db, tenant);
        return new AdminCaringCommunityCategoryCoefficientsController(service, tenant)
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
