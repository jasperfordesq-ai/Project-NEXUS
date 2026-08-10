// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Collections;
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

public sealed class CaringCommunityTandemSuggestionsControllerUnitTests
{
    private const string ControllerTypeName = "Nexus.Api.Controllers.AdminCaringCommunityTandemSuggestionsController, Nexus.Api";
    private const string ServiceTypeName = "Nexus.Api.Services.CaringTandemMatchingService, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelTandemSuggestionsRoute()
    {
        var controller = Resolve(ControllerTypeName);

        controller.GetCustomAttribute<RouteAttribute>()?.Template.Should().Be("api/admin/caring-community");
        controller.GetCustomAttribute<AuthorizeAttribute>()?.Policy.Should().Be("AdminOnly");
        controller.GetMethod("TandemSuggestions")?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("tandem-suggestions");
        controller.GetMethod("DismissTandemSuggestion")?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("tandem-suggestions/dismiss");
    }

    [Fact]
    public async Task TandemSuggestions_ReturnsNeutralFallbackPairsAndFiltersBusyUsers()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(10, 42, "Ada", "Helper", "/avatars/ada.png"),
            User(11, 42, "Ben", "Recipient", "/avatars/ben.png"),
            User(12, 42, "Cara", "Available", "/avatars/cara.png"),
            User(13, 42, "Busy", "Member", "/avatars/busy.png"),
            User(90, 7, "Other", "Tenant", "/avatars/other.png"));
        db.CaringSupportRelationships.Add(new CaringSupportRelationship
        {
            TenantId = 42,
            SupporterId = 13,
            RecipientId = 11,
            Title = "Existing active tandem",
            Frequency = "weekly",
            ExpectedHours = 1m,
            StartDate = new DateOnly(2026, 7, 1),
            Status = "active",
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant, userId: 9001);

        var result = await Invoke(controller, "TandemSuggestions", 5, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("generated_at").GetString().Should().NotBeNullOrWhiteSpace();
        var suggestions = data.GetProperty("suggestions").EnumerateArray().ToArray();
        suggestions.Should().HaveCount(1);

        var suggestion = suggestions[0];
        suggestion.GetProperty("supporter").GetProperty("id").GetInt32().Should().Be(10);
        suggestion.GetProperty("supporter").GetProperty("name").GetString().Should().Be("Ada Helper");
        suggestion.GetProperty("supporter").GetProperty("avatar_url").GetString().Should().Be("/avatars/ada.png");
        suggestion.GetProperty("recipient").GetProperty("id").GetInt32().Should().Be(12);
        suggestion.GetProperty("recipient").GetProperty("name").GetString().Should().Be("Cara Available");
        suggestion.GetProperty("score").GetDecimal().Should().Be(0.465m);
        suggestion.GetProperty("reason").GetString().Should().Be("Reasonable overall fit");

        var signals = suggestion.GetProperty("signals");
        signals.GetProperty("language_overlap").GetDecimal().Should().Be(0.5m);
        signals.GetProperty("skill_complement").GetDecimal().Should().Be(0.5m);
        signals.GetProperty("availability_overlap").GetDecimal().Should().Be(0.4m);
        signals.GetProperty("interest_overlap").GetDecimal().Should().Be(0.3m);
        signals.GetProperty("intergenerational").GetBoolean().Should().BeFalse();
        signals.GetProperty("intergenerational_signal").GetDecimal().Should().Be(0.5m);
    }

    [Fact]
    public async Task TandemSuggestions_WhenFeatureDisabled_ReturnsLaravelForbidden()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await Invoke(controller, "TandemSuggestions", null, CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    [Fact]
    public async Task DismissTandemSuggestion_UpsertsNormalizedSuppressionAndHidesPair()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(10, 42, "Ada", "Helper", "/avatars/ada.png"),
            User(12, 42, "Cara", "Available", "/avatars/cara.png"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await Invoke(
            controller,
            "DismissTandemSuggestion",
            DismissRequest(controller, supporterId: 12, recipientId: 10),
            CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value)))
        {
            document.RootElement.GetProperty("data").GetProperty("success").GetBoolean()
                .Should().BeTrue();
        }

        var log = SingleTandemLog(db);
        Prop<int>(log, "TenantId").Should().Be(42);
        Prop<int>(log, "SupporterUserId").Should().Be(10);
        Prop<int>(log, "RecipientUserId").Should().Be(12);
        Prop<string>(log, "Action").Should().Be("dismissed");
        Prop<int?>(log, "CreatedByUserId").Should().Be(9001);

        result = await Invoke(controller, "TandemSuggestions", 5, CancellationToken.None);

        ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var suggestionsDocument = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        suggestionsDocument.RootElement.GetProperty("data").GetProperty("suggestions")
            .EnumerateArray()
            .Should()
            .BeEmpty();
    }

    [Fact]
    public async Task DismissTandemSuggestion_WhenInvalidPair_ReturnsLaravelValidationError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await Invoke(
            controller,
            "DismissTandemSuggestion",
            DismissRequest(controller, supporterId: 10, recipientId: 10),
            CancellationToken.None);

        var invalid = result.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(invalid.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VALIDATION_ERROR");
    }

    [Fact]
    public async Task DismissTandemSuggestion_WhenFeatureDisabled_ReturnsLaravelForbidden()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await Invoke(
            controller,
            "DismissTandemSuggestion",
            DismissRequest(controller, supporterId: 10, recipientId: 12),
            CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
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
        var action = controller.GetType().GetMethod(method);
        action.Should().NotBeNull();
        var result = action!.Invoke(controller, args);
        if (result is Task<IActionResult> task)
        {
            return await task;
        }

        return result.Should().BeAssignableTo<IActionResult>().Subject;
    }

    private static object DismissRequest(object controller, int supporterId, int recipientId)
    {
        var action = controller.GetType().GetMethod("DismissTandemSuggestion");
        action.Should().NotBeNull("Laravel exposes a tandem suggestion dismiss action");
        var requestType = action!.GetParameters()[0].ParameterType;
        var request = Activator.CreateInstance(requestType)!;
        requestType.GetProperty("SupporterId")?.SetValue(request, supporterId);
        requestType.GetProperty("RecipientId")?.SetValue(request, recipientId);
        return request;
    }

    private static object SingleTandemLog(NexusDbContext db)
    {
        var logType = Resolve("Nexus.Api.Entities.CaringTandemSuggestionLog, Nexus.Api");
        var set = typeof(DbContext)
            .GetMethod(nameof(DbContext.Set), Type.EmptyTypes)!
            .MakeGenericMethod(logType)
            .Invoke(db, null);
        var rows = ((IEnumerable)set!).Cast<object>().ToArray();
        rows.Should().ContainSingle();
        return rows[0];
    }

    private static T? Prop<T>(object instance, string propertyName)
    {
        var value = instance.GetType().GetProperty(propertyName)?.GetValue(instance);
        return (T?)value;
    }

    private static User User(int id, int tenantId, string firstName, string lastName, string? avatarUrl = null)
    {
        return new User
        {
            Id = id,
            TenantId = tenantId,
            Email = $"user{id}@example.test",
            PasswordHash = "hash",
            FirstName = firstName,
            LastName = lastName,
            Role = Role.Names.Member,
            AvatarUrl = avatarUrl,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
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

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName, throwOnError: false);
        type.Should().NotBeNull($"Laravel tandem suggestions parity type {typeName} should exist");
        return type!;
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
                    new Claim(ClaimTypes.Role, Role.Names.Admin),
                    new Claim("role", Role.Names.Admin)
                ], "Test"))
            }
        };
    }
}
