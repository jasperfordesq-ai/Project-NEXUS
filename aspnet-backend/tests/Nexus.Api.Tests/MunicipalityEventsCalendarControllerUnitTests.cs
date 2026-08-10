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

public sealed class MunicipalityEventsCalendarControllerUnitTests
{
    private const string ControllerTypeName = "Nexus.Api.Controllers.MunicipalityEventsCalendarController, Nexus.Api";
    private const string ConsentTypeName = "Nexus.Api.Entities.VereinFederationConsent, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelPublicMunicipalityCalendarRoutes()
    {
        var controller = Resolve(ControllerTypeName);

        controller.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/municipality");
        controller.GetCustomAttribute<AllowAnonymousAttribute>()
            .Should().NotBeNull("Laravel exposes municipality events calendars without auth:sanctum");

        controller.GetMethod("DefaultEventsCalendar")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("events-calendar");

        controller.GetMethod("EventsCalendar")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("{municipalityCode}/events-calendar");
    }

    [Fact]
    public async Task EventsCalendar_BucketsActiveTenantScopedEventsForConsentingClubOrganisations()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsersAndOrganisations(db);
        var today = DateTime.UtcNow.Date;
        db.AddRange(
            Consent(100, 42, 100, "events", "BS", isActive: true),
            Consent(101, 42, 101, "both", "BS", isActive: true),
            Consent(102, 42, 102, "members", "BS", isActive: true),
            Consent(103, 42, 103, "both", "BS", isActive: true),
            Consent(104, 42, 104, "events", "AG", isActive: true),
            Consent(900, 7, 900, "events", "BS", isActive: true));
        db.Events.AddRange(
            Event(501, 42, 10, "Neighbour Lunch", today.AddDays(2).AddHours(10), "Hall", "/img/lunch.png"),
            Event(502, 42, 20, "Repair Cafe", today.AddDays(2).AddHours(12), "Workshop", "/img/repair.png"),
            Event(503, 42, 10, "Outside Month", today.AddMonths(2), "Later", null),
            Event(504, 42, 10, "Cancelled", today.AddDays(3), "Hall", null, cancelled: true),
            Event(505, 42, 30, "Members Scope", today.AddDays(4), "Hidden", null),
            Event(506, 42, 40, "Business Org", today.AddDays(5), "Hidden", null),
            Event(900, 7, 70, "Other Tenant", today.AddDays(1), "Hidden", null));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await Invoke(controller, "EventsCalendar", "BS", "month", CancellationToken.None));

        data.GetProperty("municipality_code").GetString().Should().Be("BS");
        data.GetProperty("period").GetString().Should().Be("month");
        data.GetProperty("start").GetString().Should().Be(today.ToString("yyyy-MM-dd"));
        data.GetProperty("end").GetString().Should().Be(today.AddMonths(1).ToString("yyyy-MM-dd"));

        var bucket = data.GetProperty("buckets").GetProperty(today.AddDays(2).ToString("yyyy-MM-dd"));
        bucket.GetArrayLength().Should().Be(2);
        bucket[0].GetProperty("id").GetInt32().Should().Be(501);
        bucket[0].GetProperty("title").GetString().Should().Be("Neighbour Lunch");
        bucket[0].GetProperty("location").GetString().Should().Be("Hall");
        bucket[0].GetProperty("image_url").GetString().Should().Be("/img/lunch.png");
        bucket[0].GetProperty("organization_id").GetInt32().Should().Be(100);
        bucket[0].GetProperty("organization_name").GetString().Should().Be("KISS Basel");
        bucket[1].GetProperty("id").GetInt32().Should().Be(502);
        bucket[1].GetProperty("organization_name").GetString().Should().Be("Quartier Verein");

        data.GetProperty("buckets").EnumerateObject()
            .SelectMany(day => day.Value.EnumerateArray())
            .Select(item => item.GetProperty("id").GetInt32())
            .Should().Equal(501, 502);
    }

    [Fact]
    public async Task EventsCalendar_WeekAndYearPeriodsMatchLaravelWindow()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsersAndOrganisations(db);
        db.Add(Consent(100, 42, 100, "events", "BS", isActive: true));
        await db.SaveChangesAsync();
        var today = DateTime.UtcNow.Date;
        var controller = CreateController(db, tenant);

        var week = ReadData(await Invoke(controller, "EventsCalendar", "BS", "week", CancellationToken.None));
        var year = ReadData(await Invoke(controller, "EventsCalendar", "BS", "year", CancellationToken.None));

        week.GetProperty("start").GetString().Should().Be(today.ToString("yyyy-MM-dd"));
        week.GetProperty("end").GetString().Should().Be(today.AddDays(7).ToString("yyyy-MM-dd"));
        year.GetProperty("start").GetString().Should().Be(today.ToString("yyyy-MM-dd"));
        year.GetProperty("end").GetString().Should().Be(today.AddYears(1).ToString("yyyy-MM-dd"));
    }

    [Fact]
    public async Task DefaultEventsCalendar_UsesFirstActiveConsentingMunicipalityOrReturnsEmptyCalendar()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsersAndOrganisations(db);
        var today = DateTime.UtcNow.Date;
        db.AddRange(
            Consent(101, 42, 101, "both", "BS", isActive: true),
            Consent(104, 42, 104, "events", "AG", isActive: true));
        db.Events.Add(Event(601, 42, 50, "AG First", today.AddDays(2), "Town Hall", null));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await Invoke(controller, "DefaultEventsCalendar", "month", CancellationToken.None));

        data.GetProperty("municipality_code").GetString().Should().Be("AG");
        data.GetProperty("buckets").GetProperty(today.AddDays(2).ToString("yyyy-MM-dd"))[0]
            .GetProperty("id").GetInt32().Should().Be(601);

        await using var emptyDb = CreateDbContext(tenant);
        SeedFeature(emptyDb, 42, enabled: true);
        await emptyDb.SaveChangesAsync();
        var emptyController = CreateController(emptyDb, tenant);

        var empty = ReadData(await Invoke(emptyController, "DefaultEventsCalendar", "week", CancellationToken.None));

        empty.GetProperty("municipality_code").ValueKind.Should().Be(JsonValueKind.Null);
        empty.GetProperty("period").GetString().Should().Be("week");
        empty.GetProperty("buckets").EnumerateObject().Should().BeEmpty();
    }

    [Fact]
    public async Task EventsCalendar_WhenCaringCommunityDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        AssertSingleError(
            await Invoke(controller, "EventsCalendar", "BS", "month", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(
            await Invoke(controller, "DefaultEventsCalendar", "month", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    private static object CreateController(NexusDbContext db, TenantContext tenant)
    {
        var controller = (ControllerBase)Activator.CreateInstance(Resolve(ControllerTypeName), db, tenant)!;
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity())
            }
        };
        return controller;
    }

    private static async Task<IActionResult> Invoke(object controller, string method, params object?[] args)
    {
        var info = controller.GetType().GetMethod(method);
        info.Should().NotBeNull();
        var task = (Task<IActionResult>)info!.Invoke(controller, args)!;
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

    private static object Consent(long id, int tenantId, int organizationId, string scope, string municipalityCode, bool isActive)
    {
        return Entity(ConsentTypeName,
            ("Id", id), ("TenantId", tenantId), ("OrganizationId", organizationId),
            ("SharingScope", scope), ("MunicipalityCode", municipalityCode), ("IsActive", isActive),
            ("OptedInByAdminId", null), ("OptedInAt", new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc)),
            ("CreatedAt", new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc)),
            ("UpdatedAt", null));
    }

    private static object Entity(string typeName, params (string Name, object? Value)[] values)
    {
        var type = Resolve(typeName);
        var entity = Activator.CreateInstance(type)!;
        foreach (var (name, value) in values)
        {
            type.GetProperty(name).Should().NotBeNull($"property {name} should exist on {typeName}");
            type.GetProperty(name)!.SetValue(entity, value);
        }

        return entity;
    }

    private static void SeedUsersAndOrganisations(NexusDbContext db)
    {
        db.Users.AddRange(
            User(10, 42, "owner10@example.test"),
            User(20, 42, "owner20@example.test"),
            User(30, 42, "owner30@example.test"),
            User(40, 42, "owner40@example.test"),
            User(50, 42, "owner50@example.test"),
            User(70, 7, "other@example.test"));
        db.Organisations.AddRange(
            Organisation(100, 42, 10, "KISS Basel", "club"),
            Organisation(101, 42, 20, "Quartier Verein", "club"),
            Organisation(102, 42, 30, "Members Only Verein", "club"),
            Organisation(103, 42, 40, "Local Business", "business"),
            Organisation(104, 42, 50, "Aargau Verein", "club"),
            Organisation(900, 7, 70, "Other Tenant Club", "club"));
    }

    private static User User(int id, int tenantId, string email)
    {
        return new User
        {
            Id = id,
            TenantId = tenantId,
            Email = email,
            PasswordHash = "hash",
            FirstName = "Owner",
            LastName = id.ToString(),
            Role = Role.Names.Member,
            IsActive = true
        };
    }

    private static Organisation Organisation(int id, int tenantId, int ownerId, string name, string type)
    {
        return new Organisation
        {
            Id = id,
            TenantId = tenantId,
            OwnerId = ownerId,
            Name = name,
            Slug = name.ToLowerInvariant().Replace(' ', '-'),
            Type = type,
            Status = "verified",
            IsPublic = true
        };
    }

    private static Event Event(
        int id,
        int tenantId,
        int ownerId,
        string title,
        DateTime startsAt,
        string? location,
        string? imageUrl,
        bool cancelled = false)
    {
        return new Event
        {
            Id = id,
            TenantId = tenantId,
            CreatedById = ownerId,
            Title = title,
            StartsAt = startsAt,
            EndsAt = startsAt.AddHours(2),
            Location = location,
            ImageUrl = imageUrl,
            IsCancelled = cancelled
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

    private static Type Resolve(string typeName)
    {
        return Type.GetType(typeName, throwOnError: true)!;
    }
}
