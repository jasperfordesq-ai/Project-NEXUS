// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text;
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

public class CaringCommunityMunicipalRoiControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelMunicipalRoiRoutes()
    {
        typeof(AdminCaringCommunityMunicipalRoiController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community");

        typeof(AdminCaringCommunityMunicipalRoiController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalRoiController.Show))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("municipal-roi");

        typeof(AdminCaringCommunityMunicipalRoiController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalRoiController.Export))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("municipal-roi/export");
    }

    [Fact]
    public async Task Show_ReturnsLaravelRoiShapeWithWeightedHoursAndTenantRate()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedTenant(db);
        SeedFeature(db, 42, enabled: true);
        SeedHourlyRate(db);
        SeedUsers(db);
        SeedVolunteerActivity(db);
        SeedCareRelationships(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await controller.Show(
            from: "2026-06-01",
            to: "2026-06-30",
            subRegionId: null,
            CancellationToken.None));

        data.GetProperty("total_hours").GetDecimal().Should().Be(6m);
        data.GetProperty("weighted_hours").GetDecimal().Should().Be(9m);
        data.GetProperty("active_members").GetInt32().Should().Be(2);
        data.GetProperty("active_relationships").GetInt32().Should().Be(2);
        data.GetProperty("recipient_count").GetInt32().Should().Be(2);
        data.GetProperty("total_exchanges").GetInt32().Should().Be(2);

        var roi = data.GetProperty("roi");
        roi.GetProperty("hourly_rate_chf").GetDecimal().Should().Be(40m);
        roi.GetProperty("formal_care_offset_chf").GetDecimal().Should().Be(360m);
        roi.GetProperty("prevention_value_chf").GetDecimal().Should().Be(720m);
        roi.GetProperty("social_isolation_prevented").GetInt32().Should().Be(2);

        data.GetProperty("trend").GetProperty("hours_yoy_pct").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("period").GetProperty("from").GetString().Should().Be("2026-06-01");
        data.GetProperty("period").GetProperty("to").GetString().Should().Be("2026-06-30");
        data.GetProperty("filters").GetProperty("sub_region_id").ValueKind.Should().Be(JsonValueKind.Null);

        var methodology = data.GetProperty("methodology");
        methodology.GetProperty("hourly_rate_chf").GetDecimal().Should().Be(40m);
        methodology.GetProperty("hourly_rate_source").GetString().Should().Be("tenant_setting");
        methodology.GetProperty("prevention_multiplier").GetDecimal().Should().Be(2.0m);
        methodology.GetProperty("substitution_applied").GetBoolean().Should().BeTrue();
        data.TryGetProperty("breakdown_by_sub_region", out _).Should().BeFalse("the .NET slice has no support-relationship-to-provider mapping yet");
    }

    [Fact]
    public async Task Show_WithSubRegionFilterEchoesFilterAndKeepsTenantIsolation()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedTenant(db);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedVolunteerActivity(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await controller.Show(
            from: "2026-06-01",
            to: "2026-06-30",
            subRegionId: 5,
            CancellationToken.None));

        data.GetProperty("filters").GetProperty("sub_region_id").GetInt32().Should().Be(5);
        data.GetProperty("total_hours").GetDecimal().Should().Be(6m);
        data.GetProperty("weighted_hours").GetDecimal().Should().Be(9m);
        data.GetProperty("roi").GetProperty("hourly_rate_chf").GetDecimal().Should().Be(35m);
        data.GetProperty("methodology").GetProperty("hourly_rate_source").GetString().Should().Be("default");
    }

    [Fact]
    public async Task Export_ReturnsLaravelCsvDownloadWithBomAndMetricRows()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedTenant(db);
        SeedFeature(db, 42, enabled: true);
        SeedHourlyRate(db);
        SeedUsers(db);
        SeedVolunteerActivity(db);
        SeedCareRelationships(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var result = await controller.Export(
            from: "2026-06-01",
            to: "2026-06-30",
            subRegionId: null,
            CancellationToken.None);

        var file = result.Should().BeOfType<FileContentResult>().Subject;
        file.ContentType.Should().Be("text/csv; charset=UTF-8");
        file.FileDownloadName.Should().Be("municipal-roi-acme-caring-2026-06-01-to-2026-06-30.csv");

        var csv = Encoding.UTF8.GetString(file.FileContents);
        csv.Should().StartWith("\uFEFFMetric,Value,Unit");
        csv.Should().Contain("Total approved hours,6.00,hours");
        csv.Should().Contain("Substitution-weighted hours,9.00,hours");
        csv.Should().Contain("Formal care hourly rate,40.00,CHF");
        csv.Should().Contain("Formal care offset,360.00,CHF");
        csv.Should().Contain("Prevention value (2x multiplier),720.00,CHF");
        csv.Should().Contain("Active members,2,");
        csv.Should().Contain("Care recipients (out of isolation),2,");
    }

    [Fact]
    public async Task ShowAndExport_WhenFeatureDisabled_ReturnLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        AssertSingleError(
            await controller.Show(null, null, null, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");

        AssertSingleError(
            await controller.Export(null, null, null, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
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

    private static void SeedTenant(NexusDbContext db)
    {
        db.Tenants.AddRange(
            new Tenant
            {
                Id = 42,
                Slug = "acme-caring",
                Name = "ACME Caring"
            },
            new Tenant
            {
                Id = 7,
                Slug = "other-tenant",
                Name = "Other Tenant"
            });
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

    private static void SeedHourlyRate(NexusDbContext db)
    {
        db.TenantConfigs.AddRange(
            new TenantConfig
            {
                TenantId = 42,
                Key = "caring_community.formal_care_hourly_rate_chf",
                Value = "40"
            },
            new TenantConfig
            {
                TenantId = 7,
                Key = "caring_community.formal_care_hourly_rate_chf",
                Value = "99"
            });
    }

    private static void SeedUsers(NexusDbContext db)
    {
        db.Users.AddRange(
            User(10, 42, "Ada", "Lovelace"),
            User(11, 42, "Grace", "Hopper"),
            User(12, 42, "Pat", "Recipient"),
            User(13, 42, "Robin", "Recipient"),
            User(70, 7, "Other", "Member"));
    }

    private static User User(int id, int tenantId, string firstName, string lastName) =>
        new()
        {
            Id = id,
            TenantId = tenantId,
            FirstName = firstName,
            LastName = lastName,
            Email = $"{firstName.ToLowerInvariant()}-{id}@example.test",
            PasswordHash = "x",
            Role = Role.Names.Member
        };

    private static void SeedVolunteerActivity(NexusDbContext db)
    {
        db.Categories.AddRange(
            new Category
            {
                Id = 301,
                TenantId = 42,
                Name = "Care",
                Slug = "care",
                SubstitutionCoefficient = 1.50m
            },
            new Category
            {
                Id = 302,
                TenantId = 7,
                Name = "Other",
                Slug = "other",
                SubstitutionCoefficient = 9.99m
            });
        db.VolunteerOpportunities.AddRange(
            new VolunteerOpportunity
            {
                Id = 401,
                TenantId = 42,
                Title = "Companion visits",
                OrganizerId = 11,
                CategoryId = 301,
                Status = OpportunityStatus.Published,
                RequiredVolunteers = 2
            },
            new VolunteerOpportunity
            {
                Id = 402,
                TenantId = 7,
                Title = "Other tenant activity",
                OrganizerId = 70,
                CategoryId = 302,
                Status = OpportunityStatus.Published,
                RequiredVolunteers = 1
            });
        db.VolunteerShifts.AddRange(
            new VolunteerShift
            {
                Id = 501,
                TenantId = 42,
                OpportunityId = 401,
                StartsAt = new DateTime(2026, 6, 10, 9, 0, 0, DateTimeKind.Utc),
                EndsAt = new DateTime(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc),
                MaxVolunteers = 2,
                Status = ShiftStatus.Completed
            },
            new VolunteerShift
            {
                Id = 502,
                TenantId = 7,
                OpportunityId = 402,
                StartsAt = new DateTime(2026, 6, 10, 9, 0, 0, DateTimeKind.Utc),
                EndsAt = new DateTime(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc),
                MaxVolunteers = 1,
                Status = ShiftStatus.Completed
            });
        db.VolunteerCheckIns.AddRange(
            new VolunteerCheckIn
            {
                Id = 601,
                TenantId = 42,
                ShiftId = 501,
                UserId = 10,
                CheckedInAt = new DateTime(2026, 6, 10, 9, 0, 0, DateTimeKind.Utc),
                CheckedOutAt = new DateTime(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc),
                HoursLogged = 3m,
                CreatedAt = new DateTime(2026, 6, 10, 12, 5, 0, DateTimeKind.Utc)
            },
            new VolunteerCheckIn
            {
                Id = 602,
                TenantId = 42,
                ShiftId = 501,
                UserId = 11,
                CheckedInAt = new DateTime(2026, 6, 20, 9, 0, 0, DateTimeKind.Utc),
                CheckedOutAt = new DateTime(2026, 6, 20, 12, 0, 0, DateTimeKind.Utc),
                HoursLogged = 3m,
                CreatedAt = new DateTime(2026, 6, 20, 12, 5, 0, DateTimeKind.Utc)
            },
            new VolunteerCheckIn
            {
                Id = 603,
                TenantId = 42,
                ShiftId = 501,
                UserId = 10,
                CheckedInAt = new DateTime(2026, 6, 25, 9, 0, 0, DateTimeKind.Utc),
                CheckedOutAt = null,
                HoursLogged = 5m,
                CreatedAt = new DateTime(2026, 6, 25, 10, 0, 0, DateTimeKind.Utc)
            },
            new VolunteerCheckIn
            {
                Id = 604,
                TenantId = 42,
                ShiftId = 501,
                UserId = 10,
                CheckedInAt = new DateTime(2026, 5, 1, 9, 0, 0, DateTimeKind.Utc),
                CheckedOutAt = new DateTime(2026, 5, 1, 10, 0, 0, DateTimeKind.Utc),
                HoursLogged = 10m,
                CreatedAt = new DateTime(2026, 5, 1, 10, 5, 0, DateTimeKind.Utc)
            },
            new VolunteerCheckIn
            {
                Id = 605,
                TenantId = 7,
                ShiftId = 502,
                UserId = 70,
                CheckedInAt = new DateTime(2026, 6, 10, 9, 0, 0, DateTimeKind.Utc),
                CheckedOutAt = new DateTime(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc),
                HoursLogged = 99m,
                CreatedAt = new DateTime(2026, 6, 10, 12, 5, 0, DateTimeKind.Utc)
            });
    }

    private static void SeedCareRelationships(NexusDbContext db)
    {
        db.CaringCaregiverLinks.AddRange(
            new CaringCaregiverLink
            {
                TenantId = 42,
                CaregiverId = 10,
                CaredForId = 12,
                RelationshipType = "neighbour",
                Status = "active",
                StartDate = new DateOnly(2026, 1, 1)
            },
            new CaringCaregiverLink
            {
                TenantId = 42,
                CaregiverId = 11,
                CaredForId = 13,
                RelationshipType = "neighbour",
                Status = "approved",
                StartDate = new DateOnly(2026, 1, 1)
            },
            new CaringCaregiverLink
            {
                TenantId = 42,
                CaregiverId = 11,
                CaredForId = 13,
                RelationshipType = "neighbour",
                Status = "pending",
                StartDate = new DateOnly(2026, 1, 1)
            },
            new CaringCaregiverLink
            {
                TenantId = 7,
                CaregiverId = 70,
                CaredForId = 12,
                RelationshipType = "neighbour",
                Status = "active",
                StartDate = new DateOnly(2026, 1, 1)
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

    private static AdminCaringCommunityMunicipalRoiController CreateController(
        NexusDbContext db,
        TenantContext tenant)
    {
        var service = new MunicipalRoiService(db);
        return new AdminCaringCommunityMunicipalRoiController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId: 9001, tenant.GetTenantIdOrThrow())
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
