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

public class CaringCommunityMunicipalityFeedbackControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelMunicipalityFeedbackRoutes()
    {
        typeof(CaringCommunityMunicipalityFeedbackController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/feedback");

        typeof(CaringCommunityMunicipalityFeedbackController)
            .GetMethod(nameof(CaringCommunityMunicipalityFeedbackController.Submit))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().BeNull();

        typeof(CaringCommunityMunicipalityFeedbackController)
            .GetMethod(nameof(CaringCommunityMunicipalityFeedbackController.Mine))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("mine");

        typeof(AdminCaringCommunityMunicipalityFeedbackController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/feedback");

        typeof(AdminCaringCommunityMunicipalityFeedbackController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalityFeedbackController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();

        typeof(AdminCaringCommunityMunicipalityFeedbackController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalityFeedbackController.Show))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("{id:int}");

        typeof(AdminCaringCommunityMunicipalityFeedbackController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalityFeedbackController.Dashboard))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("dashboard");

        typeof(AdminCaringCommunityMunicipalityFeedbackController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalityFeedbackController.ExportCsv))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("export.csv");

        typeof(AdminCaringCommunityMunicipalityFeedbackController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalityFeedbackController.Triage))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("{id:int}/triage");

        typeof(AdminCaringCommunityMunicipalityFeedbackController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalityFeedbackController.Resolve))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/resolve");

        typeof(AdminCaringCommunityMunicipalityFeedbackController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalityFeedbackController.Close))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/close");
    }

    [Fact]
    public async Task AdminIndex_FiltersTenantRowsAndReturnsLaravelPaginationEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedFeedback(db);
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var result = await controller.Index(
            status: "new",
            category: "issue_report",
            subRegionId: "5",
            page: 1,
            perPage: 1,
            CancellationToken.None);

        var root = ReadRoot(result);
        var data = root.GetProperty("data").EnumerateArray().ToArray();
        data.Should().HaveCount(1);
        data[0].GetProperty("subject").GetString().Should().Be("Anonymous lighting concern");
        data[0].GetProperty("submitter_user_id").GetInt32().Should().Be(11);
        data[0].GetProperty("tenant_id").GetInt32().Should().Be(42);

        var meta = root.GetProperty("meta");
        meta.GetProperty("current_page").GetInt32().Should().Be(1);
        meta.GetProperty("per_page").GetInt32().Should().Be(1);
        meta.GetProperty("total").GetInt32().Should().Be(2);
        meta.GetProperty("total_pages").GetInt32().Should().Be(2);
        meta.GetProperty("has_more").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AdminShowDashboardAndExport_MatchLaravelShapes()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedFeedback(db);
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var show = ReadData(await controller.Show(100, CancellationToken.None));
        show.GetProperty("id").GetInt32().Should().Be(100);
        show.GetProperty("submitter_user_id").GetInt32().Should().Be(10);

        var dashboard = ReadData(await controller.Dashboard(CancellationToken.None));
        dashboard.GetProperty("total_open").GetInt32().Should().Be(3);
        dashboard.GetProperty("by_status").GetProperty("new").GetInt32().Should().Be(2);
        dashboard.GetProperty("by_category").GetProperty("issue_report").GetInt32().Should().Be(2);
        dashboard.GetProperty("by_sub_region").GetProperty("5").GetInt32().Should().Be(2);
        dashboard.GetProperty("sentiment_distribution").GetProperty("concerned").GetInt32().Should().Be(1);

        var export = (ContentResult) await controller.ExportCsv(status: "new", category: "issue_report", CancellationToken.None);
        export.ContentType.Should().Be("application/csv; charset=utf-8");
        export.Content.Should().StartWith("\uFEFFid,created_at,category,status,subject");
        export.Content.Should().Contain("Pavement hazard");
        export.Content.Should().Contain("(anonymous)");
        export.Content.Should().NotContain("Other tenant");
    }

    [Fact]
    public async Task MemberSubmitAndMine_ValidateAndRedactAnonymousSubmitterInAdminListOnlyForNonAdminContexts()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        await db.SaveChangesAsync();
        var member = CreateMemberController(db, tenant, userId: 10);

        var created = await member.Submit(new MunicipalityFeedbackRequest
        {
            Category = "idea",
            Subject = "More benches",
            Body = "A bench near the library would help older residents.",
            SentimentTag = "positive",
            SubRegionId = 5,
            IsAnonymous = true,
            IsPublic = true
        }, CancellationToken.None);

        var createdResult = created.Should().BeOfType<ObjectResult>().Subject;
        createdResult.StatusCode.Should().Be(StatusCodes.Status201Created);
        var createdData = ReadData(created);
        createdData.GetProperty("status").GetString().Should().Be("new");
        createdData.GetProperty("submitter_user_id").ValueKind.Should().Be(JsonValueKind.Null);

        var mine = ReadData(await member.Mine(limit: 10, CancellationToken.None)).EnumerateArray().ToArray();
        mine.Should().HaveCount(1);
        mine[0].GetProperty("submitter_user_id").GetInt32().Should().Be(10);

        var invalid = await member.Submit(new MunicipalityFeedbackRequest
        {
            Category = "bad",
            Subject = "",
            Body = ""
        }, CancellationToken.None);

        AssertErrors(invalid, StatusCodes.Status422UnprocessableEntity,
            "INVALID_CATEGORY",
            "SUBJECT_REQUIRED",
            "BODY_REQUIRED");
    }

    [Fact]
    public async Task AdminTriageResolveAndClose_MutateTenantScopedRowsWithLaravelErrors()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedFeedback(db);
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var triaged = ReadData(await controller.Triage(100, new MunicipalityFeedbackTriageRequest
        {
            Status = "in_progress",
            AssignedUserId = 11,
            AssignedRole = "municipal.case-manager",
            TriageNotes = "Needs follow-up"
        }, CancellationToken.None));
        triaged.GetProperty("status").GetString().Should().Be("in_progress");
        triaged.GetProperty("assigned_user_id").GetInt32().Should().Be(11);
        triaged.GetProperty("assigned_role").GetString().Should().Be("municipal.case-manager");

        AssertSingleError(
            await controller.Triage(100, new MunicipalityFeedbackTriageRequest { Status = "bad" }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "INVALID_STATUS",
            "status");

        AssertSingleError(
            await controller.Resolve(100, new MunicipalityFeedbackResolveRequest { ResolutionNotes = "" }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "NOTES_REQUIRED",
            "resolution_notes");

        var resolved = ReadData(await controller.Resolve(100, new MunicipalityFeedbackResolveRequest
        {
            ResolutionNotes = "Council crew scheduled repair."
        }, CancellationToken.None));
        resolved.GetProperty("status").GetString().Should().Be("resolved");
        resolved.GetProperty("resolution_notes").GetString().Should().Be("Council crew scheduled repair.");

        var closed = ReadData(await controller.Close(101, CancellationToken.None));
        closed.GetProperty("status").GetString().Should().Be("closed");

        AssertSingleError(
            await controller.Close(999, CancellationToken.None),
            StatusCodes.Status404NotFound,
            "NOT_FOUND",
            null);
    }

    [Fact]
    public async Task Controllers_WhenFeatureDisabled_ReturnLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();

        AssertSingleError(
            await CreateAdminController(db, tenant, userId: 9001).Index(null, null, null, 1, 25, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED",
            null);

        AssertSingleError(
            await CreateMemberController(db, tenant, userId: 10).Mine(50, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED",
            null);
    }

    private static void SeedFeedback(NexusDbContext db)
    {
        SeedUsers(db);
        db.CaringMunicipalityFeedback.AddRange(
            new CaringMunicipalityFeedback
            {
                Id = 100,
                TenantId = 42,
                SubmitterUserId = 10,
                SubRegionId = 5,
                Category = "issue_report",
                Subject = "Pavement hazard",
                Body = "Loose paving stone outside the library.",
                SentimentTag = "concerned",
                Status = "new",
                IsAnonymous = false,
                IsPublic = true,
                CreatedAt = new DateTime(2026, 7, 4, 10, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 4, 10, 0, 0, DateTimeKind.Utc)
            },
            new CaringMunicipalityFeedback
            {
                Id = 101,
                TenantId = 42,
                SubmitterUserId = 11,
                SubRegionId = 5,
                Category = "issue_report",
                Subject = "Anonymous lighting concern",
                Body = "Street light is out.",
                SentimentTag = "negative",
                Status = "new",
                IsAnonymous = true,
                IsPublic = false,
                CreatedAt = new DateTime(2026, 7, 4, 11, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 4, 11, 0, 0, DateTimeKind.Utc)
            },
            new CaringMunicipalityFeedback
            {
                Id = 102,
                TenantId = 42,
                SubmitterUserId = 10,
                Category = "idea",
                Subject = "Community garden",
                Body = "Could we use the empty plot?",
                SentimentTag = "positive",
                Status = "triaging",
                IsAnonymous = false,
                IsPublic = true,
                CreatedAt = DateTime.UtcNow.AddDays(-1),
                UpdatedAt = DateTime.UtcNow.AddDays(-1)
            },
            new CaringMunicipalityFeedback
            {
                Id = 200,
                TenantId = 7,
                SubmitterUserId = 70,
                Category = "issue_report",
                Subject = "Other tenant",
                Body = "Must not leak",
                Status = "new",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
    }

    private static JsonElement ReadRoot(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        return document.RootElement.Clone();
    }

    private static JsonElement ReadData(IActionResult result)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(((ObjectResult) result).Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertErrors(IActionResult result, int statusCode, params string[] codes)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        var actual = document.RootElement.GetProperty("errors")
            .EnumerateArray()
            .Select(error => error.GetProperty("code").GetString())
            .ToArray();
        actual.Should().Contain(codes);
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

    private static void SeedUsers(NexusDbContext db)
    {
        db.Users.AddRange(
            new User
            {
                Id = 10,
                TenantId = 42,
                FirstName = "Ada",
                LastName = "Lovelace",
                Email = "ada-feedback@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 11,
                TenantId = 42,
                FirstName = "Grace",
                LastName = "Hopper",
                Email = "grace-feedback@example.test",
                PasswordHash = "x",
                Role = Role.Names.Admin
            },
            new User
            {
                Id = 70,
                TenantId = 7,
                FirstName = "Other",
                LastName = "Tenant",
                Email = "other-feedback@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
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

    private static AdminCaringCommunityMunicipalityFeedbackController CreateAdminController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new MunicipalityFeedbackService(db);
        return new AdminCaringCommunityMunicipalityFeedbackController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
        };
    }

    private static CaringCommunityMunicipalityFeedbackController CreateMemberController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new MunicipalityFeedbackService(db);
        return new CaringCommunityMunicipalityFeedbackController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "member")
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
