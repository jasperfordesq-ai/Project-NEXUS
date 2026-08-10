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
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests;

public sealed class CaringCommunityAssistedOnboardingControllerUnitTests
{
    private const string ControllerTypeName = "Nexus.Api.Controllers.AdminCaringCommunityAssistedOnboardingController, Nexus.Api";
    private const string RequestTypeName = "Nexus.Api.Controllers.AssistedOnboardingRequest, Nexus.Api";

    [Fact]
    public void Action_ExposesLaravelAdminAssistedOnboardingRoute()
    {
        var controller = Resolve(ControllerTypeName);

        controller.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community");
        controller.GetCustomAttribute<AuthorizeAttribute>()?.Policy
            .Should().Be("AdminOnly");

        controller.GetMethod("AssistedOnboarding")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("assisted-onboarding");
    }

    [Fact]
    public async Task AssistedOnboarding_CreatesTenantMemberWithTemporaryPasswordAndAudit()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await Invoke(controller, Request(
            name: "  Ada Lovelace  ",
            email: " ADA@example.TEST ",
            phone: " +41 555 0100 ",
            note: " met at the town desk "));

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);

        var data = ReadData(result);
        data.GetProperty("success").GetBoolean().Should().BeTrue();
        data.GetProperty("temp_password").GetString().Should().HaveLength(16);
        data.GetProperty("email_sent").GetBoolean().Should().BeFalse();
        data.GetProperty("email_skipped").GetBoolean().Should().BeFalse();
        data.GetProperty("user").GetProperty("name").GetString().Should().Be("Ada Lovelace");
        data.GetProperty("user").GetProperty("email").GetString().Should().Be("ada@example.test");

        var user = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Email == "ada@example.test");
        user.TenantId.Should().Be(42);
        user.FirstName.Should().Be("Ada");
        user.LastName.Should().Be("Lovelace");
        user.Role.Should().Be(Role.Names.Member);
        user.IsActive.Should().BeTrue();
        BCrypt.Net.BCrypt.Verify(data.GetProperty("temp_password").GetString(), user.PasswordHash)
            .Should().BeTrue();

        var audit = await db.AuditLogs.IgnoreQueryFilters().SingleAsync();
        audit.TenantId.Should().Be(42);
        audit.UserId.Should().Be(9001);
        audit.Action.Should().Be("coordinator_assisted_onboarding");
        audit.EntityType.Should().Be("User");
        audit.EntityId.Should().Be(user.Id);
        audit.NewValues.Should().Contain("ada@example.test");
        audit.NewValues.Should().Contain("met at the town desk");
    }

    [Fact]
    public async Task AssistedOnboarding_DummyEmailsSkipWelcomeEmail()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await Invoke(controller, Request(
            name: "Placeholder Member",
            email: "placeholder.member@example.invalid")));

        data.GetProperty("email_sent").GetBoolean().Should().BeFalse();
        data.GetProperty("email_skipped").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AssistedOnboarding_ReturnsLaravelValidationErrorsAndTenantScopedDuplicateCheck()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(11, 42, "taken@example.test"),
            User(70, 7, "elsewhere@example.test"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        AssertErrors(
            await Invoke(controller, Request(name: "", email: "not-an-email")),
            ("name", "VALIDATION_ERROR"),
            ("email", "VALIDATION_ERROR"));

        AssertSingleError(
            await Invoke(controller, Request(name: "Taken Member", email: "TAKEN@example.test")),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            "email");

        var created = await Invoke(controller, Request(name: "Other Tenant", email: "elsewhere@example.test"));
        ReadData(created).GetProperty("user").GetProperty("email").GetString().Should().Be("elsewhere@example.test");
    }

    [Fact]
    public async Task AssistedOnboarding_WhenFeatureDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        AssertSingleError(
            await Invoke(controller, Request(name: "Ada Lovelace", email: "ada@example.test")),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    [Fact]
    public async Task AssistedOnboarding_WhenUnauthenticated_ReturnsAuthRequired()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: null);

        AssertSingleError(
            await Invoke(controller, Request(name: "Ada Lovelace", email: "ada@example.test")),
            StatusCodes.Status401Unauthorized,
            "AUTH_REQUIRED");
    }

    private static object CreateController(NexusDbContext db, TenantContext tenant, int? userId = 9001)
    {
        var controller = (ControllerBase)Activator.CreateInstance(Resolve(ControllerTypeName), db, tenant)!;
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = userId.HasValue
                    ? new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, userId.Value.ToString()),
                        new Claim("tenant_id", tenant.GetTenantIdOrThrow().ToString()),
                        new Claim(ClaimTypes.Role, "admin"),
                        new Claim("role", "admin")
                    ], "Test"))
                    : new ClaimsPrincipal(new ClaimsIdentity())
            }
        };

        return controller;
    }

    private static async Task<IActionResult> Invoke(object controller, object request)
    {
        var info = controller.GetType().GetMethod("AssistedOnboarding");
        info.Should().NotBeNull();
        var task = (Task<IActionResult>)info!.Invoke(controller, [request, CancellationToken.None])!;
        return await task;
    }

    private static object Request(string? name, string? email, string? phone = null, string? note = null)
    {
        var type = Resolve(RequestTypeName);
        var request = Activator.CreateInstance(type)!;
        Set(request, "Name", name);
        Set(request, "Email", email);
        Set(request, "Phone", phone);
        Set(request, "Note", note);
        return request;
    }

    private static void Set(object target, string property, object? value)
    {
        target.GetType().GetProperty(property).Should().NotBeNull();
        target.GetType().GetProperty(property)!.SetValue(target, value);
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
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

    private static void AssertErrors(IActionResult result, params (string Field, string Code)[] expected)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        var errors = document.RootElement.GetProperty("errors").EnumerateArray().ToArray();
        errors.Select(error => error.GetProperty("field").GetString()).Should().Equal(expected.Select(e => e.Field));
        errors.Select(error => error.GetProperty("code").GetString()).Should().Equal(expected.Select(e => e.Code));
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

    private static User User(int id, int tenantId, string email)
    {
        return new User
        {
            Id = id,
            TenantId = tenantId,
            Email = email,
            PasswordHash = "hash",
            FirstName = "Existing",
            LastName = id.ToString(),
            Role = Role.Names.Member,
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

    private static Type Resolve(string typeName)
    {
        return Type.GetType(typeName, throwOnError: true)!;
    }
}
