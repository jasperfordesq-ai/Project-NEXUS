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

public class CaringCommunityPilotScoreboardControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelPilotScoreboardRoutes()
    {
        typeof(AdminCaringCommunityPilotScoreboardController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community");

        typeof(AdminCaringCommunityPilotScoreboardController)
            .GetMethod(nameof(AdminCaringCommunityPilotScoreboardController.Scoreboard))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("pilot-scoreboard");

        typeof(AdminCaringCommunityPilotScoreboardController)
            .GetMethod(nameof(AdminCaringCommunityPilotScoreboardController.Baselines))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("pilot-scoreboard/baselines");

        typeof(AdminCaringCommunityPilotScoreboardController)
            .GetMethod(nameof(AdminCaringCommunityPilotScoreboardController.CapturePrePilot))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("pilot-scoreboard/pre-pilot");

        typeof(AdminCaringCommunityPilotScoreboardController)
            .GetMethod(nameof(AdminCaringCommunityPilotScoreboardController.CaptureQuarterly))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("pilot-scoreboard/quarterly");
    }

    [Fact]
    public async Task Scoreboard_ReturnsLaravelCurrentBaselineComparisonAndQuarterlyCadence()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        // Anchor the latest quarterly review one month back so the next review
        // is always two months out and this test never expires.
        var quarterlyCapturedAt = DateTime.UtcNow.AddMonths(-1);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedTransactions(db);
        SeedAlerts(db);
        SeedBaselines(db, quarterlyCapturedAt);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await controller.Scoreboard(CancellationToken.None));

        var current = data.GetProperty("current");
        current.GetProperty("active_members").GetInt32().Should().Be(3);
        current.GetProperty("approved_hours").GetDecimal().Should().Be(0m);
        current.GetProperty("first_response_hours").ValueKind.Should().Be(JsonValueKind.Null);
        current.GetProperty("recurring_relationships").GetInt32().Should().Be(0);
        current.GetProperty("coordinator_workload_hrs").ValueKind.Should().Be(JsonValueKind.Null);
        current.GetProperty("satisfaction_score").ValueKind.Should().Be(JsonValueKind.Null);
        current.GetProperty("social_isolation_pct").GetDecimal().Should().Be(25m);
        current.GetProperty("comms_reach_pct").GetDecimal().Should().Be(50m);
        current.GetProperty("business_participation").GetInt32().Should().Be(0);
        current.GetProperty("cost_offset_chf").GetDecimal().Should().Be(0m);
        current.GetProperty("methodology").GetProperty("window_days").GetInt32().Should().Be(90);
        current.GetProperty("methodology").GetProperty("hourly_rate_chf").GetInt32().Should().Be(35);
        current.GetProperty("methodology").GetProperty("prevention_multiplier").GetInt32().Should().Be(2);

        data.GetProperty("pre_pilot_baseline").GetProperty("label").GetString().Should().Be("pre_pilot");
        data.GetProperty("latest_quarterly").GetProperty("label").GetString()
            .Should().Be(QuarterlyLabel(quarterlyCapturedAt));

        var comparison = data.GetProperty("comparison").GetProperty("active_members");
        comparison.GetProperty("baseline").GetDecimal().Should().Be(1m);
        comparison.GetProperty("current").GetDecimal().Should().Be(3m);
        comparison.GetProperty("delta").GetDecimal().Should().Be(2m);
        comparison.GetProperty("pct_change").GetDecimal().Should().Be(200m);

        var quarterly = data.GetProperty("quarterly_review");
        quarterly.GetProperty("cadence_months").GetInt32().Should().Be(3);
        quarterly.GetProperty("next_due_at").GetString()
            .Should().StartWith(quarterlyCapturedAt.AddMonths(3).ToString("yyyy-MM-dd"));
        quarterly.GetProperty("is_overdue").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task Scoreboard_WhenQuarterlyReviewCadenceElapsed_ReportsOverdue()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        // A review captured more than the three-month cadence ago is overdue.
        var quarterlyCapturedAt = DateTime.UtcNow.AddMonths(-4);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedTransactions(db);
        SeedBaselines(db, quarterlyCapturedAt);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await controller.Scoreboard(CancellationToken.None));

        var quarterly = data.GetProperty("quarterly_review");
        quarterly.GetProperty("cadence_months").GetInt32().Should().Be(3);
        quarterly.GetProperty("next_due_at").GetString()
            .Should().StartWith(quarterlyCapturedAt.AddMonths(3).ToString("yyyy-MM-dd"));
        quarterly.GetProperty("is_overdue").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Baselines_ReturnsOnlyPilotScoreboardBaselinesNewestFirst()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedBaselines(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await controller.Baselines(CancellationToken.None));

        var rows = data.GetProperty("items").EnumerateArray().ToArray();
        rows.Should().HaveCount(2);
        rows[0].GetProperty("label").GetString().Should().Be("quarterly_2026_05");
        rows[0].GetProperty("is_pre_pilot").GetBoolean().Should().BeFalse();
        rows[1].GetProperty("label").GetString().Should().Be("pre_pilot");
        rows[1].GetProperty("is_pre_pilot").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task CapturePrePilot_PersistsCanonicalPilotEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedTransactions(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var data = ReadData(await controller.CapturePrePilot(
            new PilotScoreboardCaptureRequest { Notes = "  Session zero baseline  " },
            CancellationToken.None));

        data.GetProperty("label").GetString().Should().Be("pre_pilot");
        data.GetProperty("is_pre_pilot").GetBoolean().Should().BeTrue();
        data.GetProperty("notes").GetString().Should().Be("Session zero baseline");
        data.GetProperty("captured_by").GetInt32().Should().Be(9001);
        data.GetProperty("baseline_period").GetProperty("start").GetString().Should().MatchRegex("^\\d{4}-\\d{2}-\\d{2}$");
        data.GetProperty("metrics").GetProperty("active_members").GetInt32().Should().Be(3);

        var stored = await db.CaringKpiBaselines.IgnoreQueryFilters().SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.Label.Should().Be("pre_pilot");
        stored.CapturedBy.Should().Be(9001);
        using var metrics = JsonDocument.Parse(stored.Metrics);
        metrics.RootElement.GetProperty("kind").GetString().Should().Be("pilot_scoreboard");
        metrics.RootElement.GetProperty("is_pre_pilot").GetBoolean().Should().BeTrue();
        metrics.RootElement.GetProperty("metrics").GetProperty("active_members").GetInt32().Should().Be(3);
    }

    [Fact]
    public async Task CaptureQuarterly_TruncatesLabelAndRejectsPrePilotLabel()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var longLabel = new string('x', 140);
        var created = ReadData(await controller.CaptureQuarterly(
            new PilotScoreboardCaptureRequest { Label = $"  {longLabel}  ", Notes = "  " },
            CancellationToken.None));

        created.GetProperty("label").GetString().Should().HaveLength(120);
        created.GetProperty("is_pre_pilot").GetBoolean().Should().BeFalse();
        created.GetProperty("notes").ValueKind.Should().Be(JsonValueKind.Null);

        AssertSingleError(
            await controller.CaptureQuarterly(
                new PilotScoreboardCaptureRequest { Label = "pre_pilot" },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            "label");
    }

    [Fact]
    public async Task Endpoints_WhenFeatureDisabled_ReturnLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        AssertSingleError(await controller.Scoreboard(CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
        AssertSingleError(await controller.Baselines(CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
        AssertSingleError(await controller.CapturePrePilot(new PilotScoreboardCaptureRequest(), CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
        AssertSingleError(await controller.CaptureQuarterly(new PilotScoreboardCaptureRequest(), CancellationToken.None), StatusCodes.Status403Forbidden, "FEATURE_DISABLED", null);
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
            User(10, 42, "ada@example.test", Role.Names.Member, isActive: true),
            User(11, 42, "grace@example.test", Role.Names.Member, isActive: true),
            User(12, 42, "alan@example.test", Role.Names.Member, isActive: true),
            User(13, 42, "isolated@example.test", Role.Names.Member, isActive: true),
            User(9001, 42, "admin@example.test", Role.Names.Admin, isActive: false),
            User(70, 7, "other@example.test", Role.Names.Member, isActive: true));
    }

    private static User User(int id, int tenantId, string email, string role, bool isActive) =>
        new()
        {
            Id = id,
            TenantId = tenantId,
            Email = email,
            FirstName = email.Split('@')[0],
            LastName = "User",
            PasswordHash = "x",
            Role = role,
            IsActive = isActive
        };

    private static void SeedTransactions(NexusDbContext db)
    {
        db.Transactions.AddRange(
            new Transaction
            {
                Id = 1,
                TenantId = 42,
                SenderId = 10,
                ReceiverId = 11,
                Amount = 2,
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow.AddDays(-10)
            },
            new Transaction
            {
                Id = 2,
                TenantId = 42,
                SenderId = 11,
                ReceiverId = 12,
                Amount = 1,
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow.AddDays(-20)
            },
            new Transaction
            {
                Id = 3,
                TenantId = 42,
                SenderId = 13,
                ReceiverId = 10,
                Amount = 1,
                Status = TransactionStatus.Pending,
                CreatedAt = DateTime.UtcNow.AddDays(-120)
            },
            new Transaction
            {
                Id = 4,
                TenantId = 7,
                SenderId = 70,
                ReceiverId = 70,
                Amount = 99,
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            });
    }

    private static void SeedAlerts(NexusDbContext db)
    {
        db.CaringEmergencyAlerts.AddRange(
            new CaringEmergencyAlert
            {
                Id = 100,
                TenantId = 42,
                Title = "Latest",
                Body = "Digest",
                Severity = "info",
                DismissedCount = 2,
                PushSent = false,
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-5)
            },
            new CaringEmergencyAlert
            {
                Id = 200,
                TenantId = 7,
                Title = "Other",
                Body = "Other",
                Severity = "info",
                DismissedCount = 99,
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            });
    }

    // The quarterly capture date is a parameter because the scoreboard derives
    // next_due_at from it and compares that against the wall clock. A test that
    // needs a review which is not yet due must seed a date relative to now;
    // a fixed past date silently becomes overdue once the cadence elapses.
    private static readonly DateTime DefaultQuarterlyCapturedAt =
        new(2026, 5, 1, 8, 0, 0, DateTimeKind.Utc);

    private static string QuarterlyLabel(DateTime capturedAt) =>
        $"quarterly_{capturedAt:yyyy_MM}";

    private static void SeedBaselines(NexusDbContext db, DateTime? quarterlyCapturedAt = null)
    {
        var quarterlyAt = quarterlyCapturedAt ?? DefaultQuarterlyCapturedAt;

        db.CaringKpiBaselines.AddRange(
            PilotBaseline(
                10,
                42,
                "pre_pilot",
                isPrePilot: true,
                new DateTime(2026, 1, 1, 8, 0, 0, DateTimeKind.Utc),
                """{"active_members":1,"approved_hours":5,"satisfaction_score":3.5}"""),
            PilotBaseline(
                11,
                42,
                QuarterlyLabel(quarterlyAt),
                isPrePilot: false,
                quarterlyAt,
                """{"active_members":2,"approved_hours":7}"""),
            new CaringKpiBaseline
            {
                Id = 12,
                TenantId = 42,
                Label = "generic_ag66",
                BaselinePeriod = """{"start":"2026-01-01","end":"2026-03-31"}""",
                CapturedAt = new DateTime(2026, 6, 1, 8, 0, 0, DateTimeKind.Utc),
                Metrics = """{"member_count":99}""",
                CreatedAt = new DateTime(2026, 6, 1, 8, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 6, 1, 8, 0, 0, DateTimeKind.Utc)
            },
            PilotBaseline(
                70,
                7,
                "pre_pilot",
                isPrePilot: true,
                new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc),
                """{"active_members":99}"""));
    }

    private static CaringKpiBaseline PilotBaseline(
        long id,
        int tenantId,
        string label,
        bool isPrePilot,
        DateTime capturedAt,
        string metrics)
    {
        var envelope = $$"""
            {
              "kind": "pilot_scoreboard",
              "is_pre_pilot": {{isPrePilot.ToString().ToLowerInvariant()}},
              "metrics": {{metrics}}
            }
            """;

        return new CaringKpiBaseline
        {
            Id = id,
            TenantId = tenantId,
            Label = label,
            BaselinePeriod = """{"start":"2026-01-01","end":"2026-03-31"}""",
            CapturedAt = capturedAt,
            Metrics = envelope,
            Notes = label,
            CapturedBy = 9001,
            CreatedAt = capturedAt,
            UpdatedAt = capturedAt
        };
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertSingleError(
        IActionResult result,
        int statusCode,
        string code,
        string? field)
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

    private static AdminCaringCommunityPilotScoreboardController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new PilotScoreboardService(db);
        return new AdminCaringCommunityPilotScoreboardController(service, tenant)
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
