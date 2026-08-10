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

public class CaringCommunityRecipientCircleControllerUnitTests
{
    private const string ControllerTypeName = "Nexus.Api.Controllers.AdminCaringCommunityRecipientCircleController, Nexus.Api";
    private const string ServiceTypeName = "Nexus.Api.Services.CaringRecipientCircleService, Nexus.Api";
    private const string RelationshipTypeName = "Nexus.Api.Entities.CaringSupportRelationship, Nexus.Api";
    private const string HelpRequestTypeName = "Nexus.Api.Entities.CaringHelpRequest, Nexus.Api";
    private const string VolunteerLogTypeName = "Nexus.Api.Entities.VolunteerLog, Nexus.Api";
    private const string SafeguardingReportTypeName = "Nexus.Api.Entities.SafeguardingReport, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelRecipientCircleRoute()
    {
        var controllerType = Resolve(ControllerTypeName);

        controllerType.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community");

        controllerType.GetMethod("RecipientCircle")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("recipient/{userId:int}/circle");
    }

    [Fact]
    public async Task RecipientCircle_ReturnsLaravelRecipientNetworkEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(10, 42, "Ada", "Patient", trustTier: 2, createdAt: new DateTime(2026, 1, 15, 8, 0, 0, DateTimeKind.Utc)),
            User(11, 42, "Grace", "Supporter", trustTier: 4),
            User(12, 42, "Linus", "Neighbour", trustTier: 1),
            User(13, 42, "Paused", "Helper", trustTier: 3),
            User(70, 7, "Other", "Tenant", trustTier: 5));

        db.AddRange(
            Entity(RelationshipTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 100,
                ["TenantId"] = 42,
                ["SupporterId"] = 11,
                ["RecipientId"] = 10,
                ["Title"] = "Weekly shopping",
                ["Frequency"] = "weekly",
                ["ExpectedHours"] = 1.5m,
                ["StartDate"] = new DateOnly(2026, 6, 1),
                ["Status"] = "active",
                ["LastLoggedAt"] = new DateTime(2026, 7, 3, 12, 30, 0, DateTimeKind.Utc),
                ["CreatedAt"] = new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc)
            }),
            Entity(RelationshipTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 101,
                ["TenantId"] = 42,
                ["SupporterId"] = 12,
                ["RecipientId"] = 10,
                ["Title"] = "Ad-hoc companionship",
                ["Frequency"] = "ad_hoc",
                ["ExpectedHours"] = 2m,
                ["StartDate"] = new DateOnly(2026, 6, 10),
                ["Status"] = "active",
                ["CreatedAt"] = new DateTime(2026, 6, 10, 9, 0, 0, DateTimeKind.Utc)
            }),
            Entity(RelationshipTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 102,
                ["TenantId"] = 42,
                ["SupporterId"] = 13,
                ["RecipientId"] = 10,
                ["Title"] = "Paused relationship",
                ["Frequency"] = "monthly",
                ["ExpectedHours"] = 1m,
                ["StartDate"] = new DateOnly(2026, 5, 1),
                ["Status"] = "paused",
                ["CreatedAt"] = new DateTime(2026, 5, 1, 9, 0, 0, DateTimeKind.Utc)
            }),
            Entity(RelationshipTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 200,
                ["TenantId"] = 7,
                ["SupporterId"] = 70,
                ["RecipientId"] = 10,
                ["Title"] = "Cross tenant relationship",
                ["Frequency"] = "weekly",
                ["ExpectedHours"] = 8m,
                ["StartDate"] = new DateOnly(2026, 6, 1),
                ["Status"] = "active",
                ["CreatedAt"] = new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc)
            }));

        db.AddRange(
            Entity(VolunteerLogTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 501,
                ["TenantId"] = 42,
                ["UserId"] = 11,
                ["CaringSupportRelationshipId"] = 100,
                ["SupportRecipientId"] = 10,
                ["Hours"] = 1.5m,
                ["Status"] = "approved",
                ["DateLogged"] = new DateOnly(2026, 7, 3),
                ["CreatedAt"] = new DateTime(2026, 7, 3, 13, 0, 0, DateTimeKind.Utc)
            }),
            Entity(VolunteerLogTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 502,
                ["TenantId"] = 42,
                ["UserId"] = 11,
                ["CaringSupportRelationshipId"] = 100,
                ["SupportRecipientId"] = 10,
                ["Hours"] = 2.5m,
                ["Status"] = "pending",
                ["DateLogged"] = new DateOnly(2026, 7, 4),
                ["CreatedAt"] = new DateTime(2026, 7, 4, 13, 0, 0, DateTimeKind.Utc)
            }),
            Entity(VolunteerLogTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 503,
                ["TenantId"] = 42,
                ["UserId"] = 12,
                ["CaringSupportRelationshipId"] = 101,
                ["SupportRecipientId"] = 10,
                ["Hours"] = 2m,
                ["Status"] = "approved",
                ["DateLogged"] = new DateOnly(2026, 7, 5),
                ["CreatedAt"] = new DateTime(2026, 7, 5, 13, 0, 0, DateTimeKind.Utc)
            }),
            Entity(VolunteerLogTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 504,
                ["TenantId"] = 7,
                ["UserId"] = 70,
                ["CaringSupportRelationshipId"] = 100,
                ["SupportRecipientId"] = 10,
                ["Hours"] = 8m,
                ["Status"] = "approved",
                ["DateLogged"] = new DateOnly(2026, 7, 5),
                ["CreatedAt"] = new DateTime(2026, 7, 5, 13, 0, 0, DateTimeKind.Utc)
            }));

        db.AddRange(
            Entity(HelpRequestTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 301,
                ["TenantId"] = 42,
                ["UserId"] = 10,
                ["What"] = "Need a ride",
                ["WhenNeeded"] = "tomorrow",
                ["ContactPreference"] = "either",
                ["Status"] = "pending",
                ["CreatedAt"] = new DateTime(2026, 7, 1, 10, 0, 0, DateTimeKind.Utc)
            }),
            Entity(HelpRequestTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 302,
                ["TenantId"] = 42,
                ["UserId"] = 10,
                ["What"] = "Already matched",
                ["WhenNeeded"] = "today",
                ["ContactPreference"] = "message",
                ["Status"] = "matched",
                ["CreatedAt"] = new DateTime(2026, 7, 1, 10, 0, 0, DateTimeKind.Utc)
            }),
            Entity(HelpRequestTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 303,
                ["TenantId"] = 7,
                ["UserId"] = 10,
                ["What"] = "Other tenant",
                ["WhenNeeded"] = "today",
                ["ContactPreference"] = "phone",
                ["Status"] = "pending",
                ["CreatedAt"] = new DateTime(2026, 7, 1, 10, 0, 0, DateTimeKind.Utc)
            }));

        db.AddRange(
            Entity(SafeguardingReportTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 801L,
                ["TenantId"] = 42,
                ["ReporterUserId"] = 11,
                ["SubjectUserId"] = 10,
                ["Category"] = "neglect",
                ["Severity"] = "medium",
                ["Description"] = "Follow up required",
                ["Status"] = "submitted",
                ["CreatedAt"] = new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc)
            }),
            Entity(SafeguardingReportTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 802L,
                ["TenantId"] = 42,
                ["ReporterUserId"] = 12,
                ["SubjectUserId"] = 10,
                ["Category"] = "other",
                ["Severity"] = "low",
                ["Description"] = "Resolved but still counted by Laravel",
                ["Status"] = "resolved",
                ["CreatedAt"] = new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc)
            }),
            Entity(SafeguardingReportTypeName, new Dictionary<string, object?>
            {
                ["Id"] = 803L,
                ["TenantId"] = 7,
                ["ReporterUserId"] = 70,
                ["SubjectUserId"] = 10,
                ["Category"] = "other",
                ["Severity"] = "critical",
                ["Description"] = "Other tenant",
                ["Status"] = "submitted",
                ["CreatedAt"] = new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc)
            }));

        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await InvokeRecipientCircle(controller, 10));

        var recipient = data.GetProperty("recipient");
        recipient.GetProperty("id").GetInt32().Should().Be(10);
        recipient.GetProperty("name").GetString().Should().Be("Ada Patient");
        recipient.GetProperty("trust_tier").GetInt32().Should().Be(2);
        recipient.GetProperty("member_since").GetString().Should().Be("2026-01-15");

        var relationships = data.GetProperty("support_relationships").EnumerateArray()
            .OrderBy(row => row.GetProperty("id").GetInt32())
            .ToArray();
        relationships.Should().HaveCount(2);
        relationships[0].GetProperty("id").GetInt32().Should().Be(100);
        relationships[0].GetProperty("supporter").GetProperty("id").GetInt32().Should().Be(11);
        relationships[0].GetProperty("supporter").GetProperty("name").GetString().Should().Be("Grace Supporter");
        relationships[0].GetProperty("supporter").GetProperty("trust_tier").GetInt32().Should().Be(4);
        relationships[0].GetProperty("type").GetString().Should().Be("weekly");
        relationships[0].GetProperty("hours_logged").GetDecimal().Should().Be(1.5m);
        relationships[0].GetProperty("last_activity_at").GetString().Should().StartWith("2026-07-03T12:30:00");
        relationships[0].GetProperty("status").GetString().Should().Be("active");
        relationships[1].GetProperty("id").GetInt32().Should().Be(101);
        relationships[1].GetProperty("hours_logged").GetDecimal().Should().Be(2m);

        data.GetProperty("total_hours_received").GetDecimal().Should().Be(3.5m);
        data.GetProperty("open_help_requests").GetInt32().Should().Be(1);
        data.GetProperty("safeguarding_flags").GetInt32().Should().Be(2);
    }

    [Fact]
    public async Task RecipientCircle_WhenFeatureDisabledOrMissingRecipient_ReturnsLaravelErrors()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.Add(User(10, 42, "Ada", "Patient"));
        db.Users.Add(User(70, 7, "Other", "Tenant"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        AssertSingleError(await InvokeRecipientCircle(controller, 999), StatusCodes.Status404NotFound, "NOT_FOUND");
        AssertSingleError(await InvokeRecipientCircle(controller, 70), StatusCodes.Status404NotFound, "NOT_FOUND");

        await using var disabledDb = CreateDbContext(tenant);
        SeedFeature(disabledDb, 42, enabled: false);
        disabledDb.Users.Add(User(10, 42, "Ada", "Patient"));
        await disabledDb.SaveChangesAsync();
        var disabledController = CreateController(disabledDb, tenant, userId: 9001);

        AssertSingleError(await InvokeRecipientCircle(disabledController, 10), StatusCodes.Status403Forbidden, "FEATURE_DISABLED");
    }

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName, throwOnError: false);
        type.Should().NotBeNull($"Laravel parity type {typeName} should exist");
        return type!;
    }

    private static object Entity(string typeName, Dictionary<string, object?> values)
    {
        var type = Resolve(typeName);
        var entity = Activator.CreateInstance(type)!;
        foreach (var (propertyName, value) in values)
        {
            var property = type.GetProperty(propertyName);
            property.Should().NotBeNull($"{type.Name}.{propertyName} should be mapped for Laravel parity");
            property!.SetValue(entity, value);
        }

        return entity;
    }

    private static object CreateController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var service = Activator.CreateInstance(Resolve(ServiceTypeName), db, tenant)!;
        var controller = (ControllerBase)Activator.CreateInstance(Resolve(ControllerTypeName), service, tenant)!;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow());
        return controller;
    }

    private static async Task<IActionResult> InvokeRecipientCircle(object controller, int userId)
    {
        var method = Resolve(ControllerTypeName).GetMethod("RecipientCircle");
        method.Should().NotBeNull();
        var task = (Task<IActionResult>)method!.Invoke(controller, new object[] { userId, CancellationToken.None })!;
        return await task;
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be(code);
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

    private static User User(
        int id,
        int tenantId,
        string firstName,
        string lastName,
        int trustTier = 0,
        DateTime? createdAt = null)
    {
        var user = new User
        {
            Id = id,
            TenantId = tenantId,
            Email = $"user{id}@example.test",
            PasswordHash = "hash",
            FirstName = firstName,
            LastName = lastName,
            Role = Role.Names.Member,
            IsActive = true,
            CreatedAt = createdAt ?? DateTime.UtcNow
        };
        typeof(User).GetProperty("TrustTier")?.SetValue(user, trustTier);
        return user;
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
}
