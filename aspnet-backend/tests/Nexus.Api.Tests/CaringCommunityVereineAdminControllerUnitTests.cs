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
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests;

public sealed class CaringCommunityVereineAdminControllerUnitTests
{
    private const string ControllerTypeName = "Nexus.Api.Controllers.AdminCaringCommunityVereineController, Nexus.Api";
    private const string ServiceTypeName = "Nexus.Api.Services.CaringCommunityVereineAdminService, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelVereinAdminRoute()
    {
        var controller = Resolve(ControllerTypeName);

        controller.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/vereine");

        controller.GetMethod("AssignVereinAdmin")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("{organizationId}/admins");

        controller.GetMethod("PreviewVereinMemberImport")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("{organizationId}/members/import/preview");

        controller.GetMethod("ImportVereinMembers")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("{organizationId}/members/import");
    }

    [Fact]
    public async Task PreviewVereinMemberImport_ReturnsLaravelSummaryAndRows()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        var existing = User(10, 42, "Eve", "Existing");
        existing.Email = "existing@example.test";
        var member = User(11, 42, "Mary", "Member");
        member.Email = "member@example.test";
        db.Users.AddRange(
            User(9, 42, "Admin", "User", Role.Names.Admin),
            existing,
            member);
        db.Organisations.Add(Organisation(101, 42, 9, "Quartier Verein", "club"));
        db.OrganisationMembers.Add(new OrganisationMember
        {
            TenantId = 42,
            OrganisationId = 101,
            UserId = 11,
            Role = "member",
            JoinedAt = new DateTime(2026, 1, 1, 9, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        var data = ReadOkData(await Invoke(
            controller,
            "PreviewVereinMemberImport",
            101,
            new Dictionary<string, object?>
            {
                ["csv"] = string.Join('\n', new[]
                {
                    "email,first_name,last_name,phone,role",
                    "new@example.test,Ada,Create,+410000000,admin",
                    "existing@example.test,Eve,Existing,,owner",
                    "member@example.test,Mary,Member,,unexpected",
                    "bad-email,Bad,Email,,member",
                    "new@example.test,Duplicate,Row,,member"
                })
            },
            CancellationToken.None));

        data.GetProperty("organization").GetProperty("id").GetInt32().Should().Be(101);
        var summary = data.GetProperty("summary");
        summary.GetProperty("total_rows").GetInt32().Should().Be(5);
        summary.GetProperty("ready_to_create").GetInt32().Should().Be(1);
        summary.GetProperty("ready_to_link").GetInt32().Should().Be(1);
        summary.GetProperty("duplicates").GetInt32().Should().Be(2);
        summary.GetProperty("invalid").GetInt32().Should().Be(1);

        var items = data.GetProperty("items").EnumerateArray().ToList();
        items.Select(item => item.GetProperty("action").GetString()).Should().Equal(
            "create",
            "link_existing",
            "already_member",
            "invalid",
            "invalid");
        items[0].GetProperty("role").GetString().Should().Be("admin");
        items[2].GetProperty("role").GetString().Should().Be("member");
        items[1].GetProperty("existing_user_id").GetInt32().Should().Be(10);
    }

    [Fact]
    public async Task ImportVereinMembers_CreatesLinksAndSkipsAlreadyMembers()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        var existing = User(10, 42, "Eve", "Existing");
        existing.Email = "existing@example.test";
        var alreadyMember = User(11, 42, "Mary", "Member");
        alreadyMember.Email = "member@example.test";
        db.Users.AddRange(
            User(9, 42, "Admin", "User", Role.Names.Admin),
            existing,
            alreadyMember);
        db.Organisations.Add(Organisation(101, 42, 9, "Quartier Verein", "club"));
        db.OrganisationMembers.Add(new OrganisationMember
        {
            TenantId = 42,
            OrganisationId = 101,
            UserId = 11,
            Role = "member",
            JoinedAt = new DateTime(2026, 1, 1, 9, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        var data = ReadData(await Invoke(
            controller,
            "ImportVereinMembers",
            101,
            new Dictionary<string, object?>
            {
                ["csv"] = string.Join('\n', new[]
                {
                    "email,first_name,last_name,phone,role",
                    "new@example.test,Ada,Create,+410000000,admin",
                    "existing@example.test,Eve,Existing,,owner",
                    "member@example.test,Mary,Member,,member"
                })
            },
            CancellationToken.None));

        data.GetProperty("created").GetInt32().Should().Be(1);
        data.GetProperty("linked").GetInt32().Should().Be(1);
        data.GetProperty("skipped").GetInt32().Should().Be(1);
        data.GetProperty("imported_by").GetInt32().Should().Be(9);
        var members = data.GetProperty("members").EnumerateArray().ToList();
        members.Should().HaveCount(2);
        members[0].GetProperty("email").GetString().Should().Be("new@example.test");
        members[0].GetProperty("created").GetBoolean().Should().BeTrue();
        members[0].GetProperty("temporary_password").GetString().Should().NotBeNullOrWhiteSpace();
        members[1].GetProperty("email").GetString().Should().Be("existing@example.test");
        members[1].GetProperty("created").GetBoolean().Should().BeFalse();

        var createdUser = await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Email == "new@example.test");
        createdUser.TenantId.Should().Be(42);
        createdUser.FirstName.Should().Be("Ada");
        createdUser.LastName.Should().Be("Create");
        createdUser.Role.Should().Be(Role.Names.Member);
        createdUser.IsActive.Should().BeTrue();

        var orgMembers = await db.OrganisationMembers.IgnoreQueryFilters()
            .Where(row => row.OrganisationId == 101)
            .OrderBy(row => row.UserId)
            .ToListAsync();
        orgMembers.Should().HaveCount(3);
        orgMembers.Single(row => row.UserId == createdUser.Id).Role.Should().Be("admin");
        orgMembers.Single(row => row.UserId == 10).Role.Should().Be("owner");
        orgMembers.Single(row => row.UserId == 11).Role.Should().Be("member");
    }

    [Fact]
    public async Task ImportVereinMembers_WhenCsvInvalid_ReturnsLaravelValidationError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.Add(User(9, 42, "Admin", "User", Role.Names.Admin));
        db.Organisations.Add(Organisation(101, 42, 9, "Quartier Verein", "club"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        AssertSingleError(
            await Invoke(
                controller,
                "ImportVereinMembers",
                101,
                new Dictionary<string, object?> { ["csv"] = "email\nnot-an-email" },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        db.Users.IgnoreQueryFilters().Should().HaveCount(1);
        db.OrganisationMembers.IgnoreQueryFilters().Should().BeEmpty();
    }

    [Fact]
    public async Task AssignVereinAdmin_CreatesScopedAdminMembershipAndLaravelPayload()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(9, 42, "Admin", "User", Role.Names.Admin),
            User(10, 42, "Ada", "Member"),
            User(70, 7, "Other", "Tenant"));
        db.Organisations.Add(Organisation(101, 42, 9, "Quartier Verein", "club"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        var data = ReadData(await Invoke(
            controller,
            "AssignVereinAdmin",
            101,
            new Dictionary<string, object?> { ["user_id"] = 10 },
            CancellationToken.None));

        data.GetProperty("user_id").GetInt32().Should().Be(10);
        data.GetProperty("organization_id").GetInt32().Should().Be(101);
        data.GetProperty("role").GetString().Should().Be("verein_admin");
        data.GetProperty("scope_organization_id").GetInt32().Should().Be(101);

        var member = await db.OrganisationMembers.IgnoreQueryFilters().SingleAsync();
        member.TenantId.Should().Be(42);
        member.OrganisationId.Should().Be(101);
        member.UserId.Should().Be(10);
        member.Role.Should().Be("admin");
    }

    [Fact]
    public async Task AssignVereinAdmin_UpdatesExistingMembershipWithoutDuplicate()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(9, 42, "Admin", "User", Role.Names.Admin),
            User(10, 42, "Ada", "Member"));
        db.Organisations.Add(Organisation(101, 42, 9, "Quartier Verein", "club"));
        db.OrganisationMembers.Add(new OrganisationMember
        {
            TenantId = 42,
            OrganisationId = 101,
            UserId = 10,
            Role = "member",
            JoinedAt = new DateTime(2026, 1, 1, 9, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        var data = ReadData(await Invoke(
            controller,
            "AssignVereinAdmin",
            101,
            new Dictionary<string, object?> { ["user_id"] = 10 },
            CancellationToken.None));

        data.GetProperty("role").GetString().Should().Be("verein_admin");
        var members = await db.OrganisationMembers.IgnoreQueryFilters().ToListAsync();
        members.Should().HaveCount(1);
        members[0].Role.Should().Be("admin");
    }

    [Fact]
    public async Task AssignVereinAdmin_WhenInputOrTenantInvalid_ReturnsLaravelValidationErrors()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(9, 42, "Admin", "User", Role.Names.Admin),
            User(10, 42, "Ada", "Member"),
            User(70, 7, "Other", "Tenant"));
        db.Organisations.AddRange(
            Organisation(101, 42, 9, "Quartier Verein", "club"),
            Organisation(102, 42, 9, "Provider", "business"),
            Organisation(201, 7, 70, "Other Verein", "club"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        AssertSingleError(
            await Invoke(controller, "AssignVereinAdmin", 101, new Dictionary<string, object?>(), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            "user_id");

        AssertSingleError(
            await Invoke(controller, "AssignVereinAdmin", 101, new Dictionary<string, object?> { ["user_id"] = 70 }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await Invoke(controller, "AssignVereinAdmin", 102, new Dictionary<string, object?> { ["user_id"] = 10 }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await Invoke(controller, "AssignVereinAdmin", 201, new Dictionary<string, object?> { ["user_id"] = 10 }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        db.OrganisationMembers.IgnoreQueryFilters().Should().BeEmpty();
    }

    [Fact]
    public async Task AssignVereinAdmin_WhenFeatureDisabled_ReturnsLaravelFeatureError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9);

        AssertSingleError(
            await Invoke(controller, "AssignVereinAdmin", 101, new Dictionary<string, object?> { ["user_id"] = 10 }, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    private static object CreateController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var service = Activator.CreateInstance(Resolve(ServiceTypeName), db)!;
        var controller = (ControllerBase)Activator.CreateInstance(Resolve(ControllerTypeName), service, tenant)!;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow());
        return controller;
    }

    private static async Task<IActionResult> Invoke(object controller, string method, params object?[] args)
    {
        var info = controller.GetType().GetMethod(method);
        info.Should().NotBeNull();
        var result = info!.Invoke(controller, args);
        result.Should().BeAssignableTo<Task<IActionResult>>();
        return await (Task<IActionResult>)result!;
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static JsonElement ReadOkData(IActionResult result)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status200OK);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code, string? field = null)
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

    private static Organisation Organisation(int id, int tenantId, int ownerId, string name, string type)
    {
        return new Organisation
        {
            Id = id,
            TenantId = tenantId,
            OwnerId = ownerId,
            Name = name,
            Slug = $"org-{id}",
            Type = type,
            Status = "verified",
            IsPublic = true,
            CreatedAt = DateTime.UtcNow
        };
    }

    private static User User(int id, int tenantId, string firstName, string lastName, string role = Role.Names.Member)
    {
        return new User
        {
            Id = id,
            TenantId = tenantId,
            Email = $"user{id}@example.test",
            PasswordHash = "hash",
            FirstName = firstName,
            LastName = lastName,
            Role = role,
            IsActive = true
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

    private static ControllerContext ControllerContextFor(int userId, int tenantId)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    new[]
                    {
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                        new Claim("tenant_id", tenantId.ToString()),
                        new Claim(ClaimTypes.Role, Role.Names.Admin)
                    },
                    "TestAuth"))
            }
        };
    }

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName, throwOnError: false);
        type.Should().NotBeNull($"{typeName} should exist for Laravel parity");
        return type!;
    }
}
