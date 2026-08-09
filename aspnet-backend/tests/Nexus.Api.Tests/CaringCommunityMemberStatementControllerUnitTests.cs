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

public class CaringCommunityMemberStatementControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelMemberStatementRoute()
    {
        typeof(AdminCaringCommunityMemberStatementsController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community");

        typeof(AdminCaringCommunityMemberStatementsController)
            .GetMethod(nameof(AdminCaringCommunityMemberStatementsController.Show))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("member-statements/{userId:int}");
    }

    [Fact]
    public async Task Show_ReturnsLaravelStatementEnvelopeAndTenantScopedLedger()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedWorkflowPolicy(db);
        SeedUsers(db);
        SeedWalletTransactions(db);
        SeedVolunteerActivity(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);
        controller.ControllerContext.HttpContext.Request.QueryString =
            QueryString.Create(new Dictionary<string, string?>
            {
                ["start_date"] = "2026-06-01",
                ["end_date"] = "2026-06-30"
            });

        var data = ReadData(await controller.Show(10, null, null, "json", CancellationToken.None));

        var user = data.GetProperty("user");
        user.GetProperty("id").GetInt32().Should().Be(10);
        user.GetProperty("name").GetString().Should().Be("Ada Lovelace");
        user.GetProperty("email").GetString().Should().Be("ada-statement@example.test");
        user.GetProperty("current_balance").GetDecimal().Should().Be(-3m);

        var period = data.GetProperty("period");
        period.GetProperty("start").GetString().Should().Be("2026-06-01");
        period.GetProperty("end").GetString().Should().Be("2026-06-30");
        period.GetProperty("statement_day").GetInt32().Should().Be(12);

        var policy = data.GetProperty("policy");
        policy.GetProperty("monthly_statement_day").GetInt32().Should().Be(12);
        policy.GetProperty("hour_value_chf").GetInt32().Should().Be(40);
        policy.GetProperty("include_social_value_estimate").GetBoolean().Should().BeFalse();

        var summary = data.GetProperty("summary");
        summary.GetProperty("approved_support_hours").GetDecimal().Should().Be(2.5m);
        summary.GetProperty("pending_support_hours").GetDecimal().Should().Be(1.25m);
        summary.GetProperty("declined_support_logs").GetInt32().Should().Be(0);
        summary.GetProperty("wallet_hours_earned").GetDecimal().Should().Be(9m);
        summary.GetProperty("wallet_hours_spent").GetDecimal().Should().Be(4m);
        summary.GetProperty("wallet_net_change").GetDecimal().Should().Be(5m);
        summary.GetProperty("current_balance").GetDecimal().Should().Be(-3m);
        summary.GetProperty("estimated_social_value_chf").GetDecimal().Should().Be(100m);

        var supportLogs = data.GetProperty("support_logs").EnumerateArray().ToArray();
        supportLogs.Should().HaveCount(2);
        supportLogs[0].GetProperty("id").GetInt32().Should().Be(101);
        supportLogs[0].GetProperty("date").GetString().Should().Be("2026-06-20");
        supportLogs[0].GetProperty("hours").GetDecimal().Should().Be(1.25m);
        supportLogs[0].GetProperty("status").GetString().Should().Be("pending");
        supportLogs[0].GetProperty("organisation_name").GetString().Should().Be("Care Circle");
        supportLogs[0].GetProperty("opportunity_title").GetString().Should().Be("Companion visits");
        supportLogs.Should().NotContain(row => row.GetProperty("id").GetInt32() == 201);

        var orgs = data.GetProperty("support_hours_by_organisation").EnumerateArray().ToArray();
        orgs.Should().ContainSingle();
        orgs[0].GetProperty("organisation_name").GetString().Should().Be("Care Circle");
        orgs[0].GetProperty("approved_hours").GetDecimal().Should().Be(2.5m);
        orgs[0].GetProperty("pending_hours").GetDecimal().Should().Be(1.25m);
        orgs[0].GetProperty("log_count").GetInt32().Should().Be(2);

        var transactions = data.GetProperty("wallet_transactions").EnumerateArray().ToArray();
        transactions.Should().HaveCount(2);
        transactions[0].GetProperty("direction").GetString().Should().Be("spent");
        transactions[0].GetProperty("counterparty_name").GetString().Should().Be("Grace Hopper");
        transactions[0].GetProperty("signed_amount").GetDecimal().Should().Be(-4m);
        transactions[1].GetProperty("direction").GetString().Should().Be("earned");
        transactions[1].GetProperty("counterparty_name").GetString().Should().Be("Grace Hopper");
        transactions[1].GetProperty("signed_amount").GetDecimal().Should().Be(9m);
        transactions.Should().NotContain(row => row.GetProperty("id").GetInt32() == 203);
    }

    [Fact]
    public async Task Show_WhenCsvRequested_ReturnsFilenameCsvAndStatement()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedWalletTransactions(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        var data = ReadData(await controller.Show(
            10,
            "2026-06-01",
            "2026-06-30",
            "csv",
            CancellationToken.None));

        data.GetProperty("filename").GetString()
            .Should().Be("caring-community-statement-10-2026-06-01-2026-06-30.csv");
        var csv = data.GetProperty("csv").GetString();
        csv.Should().StartWith("\"Date\",\"Type\",\"Partner\",\"Description\",\"Hours\",\"Status\"");
        csv.Should().Contain("\"2026-06-18\",\"earned\",\"Grace Hopper\",\"Care hours received\",\"9\",\"completed\"");
        csv.Should().Contain("\"2026-06-19\",\"spent\",\"Grace Hopper\",\"Care hours provided\",\"-4\",\"completed\"");
        data.GetProperty("statement").GetProperty("user").GetProperty("id").GetInt32().Should().Be(10);
    }

    [Fact]
    public async Task Show_WhenUserMissingOrFeatureDisabled_ReturnsLaravelErrors()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant);

        AssertSingleError(
            await controller.Show(999, null, null, "json", CancellationToken.None),
            StatusCodes.Status404NotFound,
            "NOT_FOUND");

        await using var disabledDb = CreateDbContext(tenant);
        SeedFeature(disabledDb, 42, enabled: false);
        disabledDb.Users.Add(new User
        {
            Id = 10,
            TenantId = 42,
            FirstName = "Ada",
            LastName = "Lovelace",
            Email = "ada-statement@example.test",
            PasswordHash = "x",
            Role = Role.Names.Member
        });
        await disabledDb.SaveChangesAsync();
        var disabledController = CreateController(disabledDb, tenant);

        AssertSingleError(
            await disabledController.Show(10, null, null, "json", CancellationToken.None),
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

    private static void SeedFeature(NexusDbContext db, int tenantId, bool enabled)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "features.caring_community",
            Value = enabled ? "true" : "false"
        });
    }

    private static void SeedWorkflowPolicy(NexusDbContext db)
    {
        db.TenantConfigs.AddRange(
            new TenantConfig
            {
                TenantId = 42,
                Key = "caring_community.workflow.monthly_statement_day",
                Value = "12"
            },
            new TenantConfig
            {
                TenantId = 42,
                Key = "caring_community.workflow.default_hour_value_chf",
                Value = "40"
            },
            new TenantConfig
            {
                TenantId = 42,
                Key = "caring_community.workflow.include_social_value_estimate",
                Value = "false"
            },
            new TenantConfig
            {
                TenantId = 7,
                Key = "caring_community.workflow.monthly_statement_day",
                Value = "28"
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
                Email = "ada-statement@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 11,
                TenantId = 42,
                FirstName = "Grace",
                LastName = "Hopper",
                Email = "grace-statement@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 70,
                TenantId = 7,
                FirstName = "Other",
                LastName = "Tenant",
                Email = "other-statement@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            });
    }

    private static void SeedWalletTransactions(NexusDbContext db)
    {
        db.Transactions.AddRange(
            new Transaction
            {
                Id = 201,
                TenantId = 42,
                SenderId = 11,
                ReceiverId = 10,
                Amount = 9m,
                Description = "Care hours received",
                Status = TransactionStatus.Completed,
                CreatedAt = new DateTime(2026, 6, 18, 11, 0, 0, DateTimeKind.Utc)
            },
            new Transaction
            {
                Id = 202,
                TenantId = 42,
                SenderId = 10,
                ReceiverId = 11,
                Amount = 4m,
                Description = "Care hours provided",
                Status = TransactionStatus.Completed,
                CreatedAt = new DateTime(2026, 6, 19, 11, 0, 0, DateTimeKind.Utc)
            },
            new Transaction
            {
                Id = 203,
                TenantId = 7,
                SenderId = 10,
                ReceiverId = 11,
                Amount = 99m,
                Description = "Other tenant leak",
                Status = TransactionStatus.Completed,
                CreatedAt = new DateTime(2026, 6, 20, 11, 0, 0, DateTimeKind.Utc)
            },
            new Transaction
            {
                Id = 204,
                TenantId = 42,
                SenderId = 10,
                ReceiverId = 11,
                Amount = 8m,
                Description = "Outside period",
                Status = TransactionStatus.Completed,
                CreatedAt = new DateTime(2026, 5, 1, 11, 0, 0, DateTimeKind.Utc)
            });
    }

    private static void SeedVolunteerActivity(NexusDbContext db)
    {
        db.VolunteerOpportunities.Add(new VolunteerOpportunity
        {
            Id = 301,
            TenantId = 42,
            Title = "Companion visits",
            Description = "Neighbourly visits",
            OrganizerId = 11,
            Status = OpportunityStatus.Published,
            RequiredVolunteers = 2
        });
        db.VolunteerShifts.Add(new VolunteerShift
        {
            Id = 401,
            TenantId = 42,
            OpportunityId = 301,
            Title = "Care Circle",
            StartsAt = new DateTime(2026, 6, 10, 9, 0, 0, DateTimeKind.Utc),
            EndsAt = new DateTime(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc),
            MaxVolunteers = 2,
            Status = ShiftStatus.Completed
        });
        db.VolunteerCheckIns.AddRange(
            new VolunteerCheckIn
            {
                Id = 100,
                TenantId = 42,
                ShiftId = 401,
                UserId = 10,
                CheckedInAt = new DateTime(2026, 6, 10, 9, 0, 0, DateTimeKind.Utc),
                CheckedOutAt = new DateTime(2026, 6, 10, 11, 30, 0, DateTimeKind.Utc),
                HoursLogged = 2.5m,
                Notes = "Reviewed medication reminders",
                CreatedAt = new DateTime(2026, 6, 10, 11, 35, 0, DateTimeKind.Utc)
            },
            new VolunteerCheckIn
            {
                Id = 101,
                TenantId = 42,
                ShiftId = 401,
                UserId = 10,
                CheckedInAt = new DateTime(2026, 6, 20, 9, 0, 0, DateTimeKind.Utc),
                CheckedOutAt = null,
                HoursLogged = 1.25m,
                Notes = "Follow-up call",
                CreatedAt = new DateTime(2026, 6, 20, 10, 30, 0, DateTimeKind.Utc)
            },
            new VolunteerCheckIn
            {
                Id = 102,
                TenantId = 42,
                ShiftId = 401,
                UserId = 10,
                CheckedInAt = new DateTime(2026, 5, 20, 9, 0, 0, DateTimeKind.Utc),
                CheckedOutAt = new DateTime(2026, 5, 20, 10, 0, 0, DateTimeKind.Utc),
                HoursLogged = 1m,
                Notes = "Outside period",
                CreatedAt = new DateTime(2026, 5, 20, 10, 5, 0, DateTimeKind.Utc)
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

    private static AdminCaringCommunityMemberStatementsController CreateController(
        NexusDbContext db,
        TenantContext tenant)
    {
        var service = new CaringCommunityMemberStatementService(db);
        return new AdminCaringCommunityMemberStatementsController(service, tenant)
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
