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

public class CaringCommunityHourEstateControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelHourEstateRoutes()
    {
        typeof(CaringCommunityHourEstateController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/hour-estate");

        typeof(CaringCommunityHourEstateController)
            .GetMethod(nameof(CaringCommunityHourEstateController.MyEstate))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();

        typeof(CaringCommunityHourEstateController)
            .GetMethod(nameof(CaringCommunityHourEstateController.Nominate))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().BeNull();

        typeof(AdminCaringCommunityHourEstatesController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/hour-estates");

        typeof(AdminCaringCommunityHourEstatesController)
            .GetMethod(nameof(AdminCaringCommunityHourEstatesController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();

        typeof(AdminCaringCommunityHourEstatesController)
            .GetMethod(nameof(AdminCaringCommunityHourEstatesController.ReportDeceased))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/report-deceased");

        typeof(AdminCaringCommunityHourEstatesController)
            .GetMethod(nameof(AdminCaringCommunityHourEstatesController.Settle))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/settle");
    }

    [Fact]
    public async Task MemberMyEstateAndNominate_MatchLaravelPolicyRules()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        var empty = ReadData(await controller.MyEstate(CancellationToken.None));
        empty.GetProperty("tenant_id").GetInt32().Should().Be(42);
        empty.GetProperty("member_user_id").GetInt32().Should().Be(10);
        empty.GetProperty("status").GetString().Should().Be("not_set");
        empty.GetProperty("policy_action").ValueKind.Should().Be(JsonValueKind.Null);

        var donated = ReadData(await controller.Nominate(new HourEstateNominateRequest
        {
            PolicyAction = "donate_to_solidarity",
            PolicyDocumentReference = new string('R', 300),
            MemberNotes = "Please send remaining hours to the community fund."
        }, CancellationToken.None));

        donated.GetProperty("status").GetString().Should().Be("nominated");
        donated.GetProperty("policy_action").GetString().Should().Be("donate_to_solidarity");
        donated.GetProperty("beneficiary_user_id").ValueKind.Should().Be(JsonValueKind.Null);
        donated.GetProperty("policy_document_reference").GetString().Should().HaveLength(255);

        var transferred = ReadData(await controller.Nominate(new HourEstateNominateRequest
        {
            PolicyAction = "transfer_to_beneficiary",
            BeneficiaryUserId = 11,
            MemberNotes = "Grace can receive the hours."
        }, CancellationToken.None));

        transferred.GetProperty("policy_action").GetString().Should().Be("transfer_to_beneficiary");
        transferred.GetProperty("beneficiary_user_id").GetInt32().Should().Be(11);
        transferred.GetProperty("beneficiary_name").GetString().Should().Be("Grace Hopper");

        AssertSingleError(
            await controller.Nominate(new HourEstateNominateRequest { PolicyAction = "bad" }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await controller.Nominate(new HourEstateNominateRequest { PolicyAction = "transfer_to_beneficiary" }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await controller.Nominate(new HourEstateNominateRequest
            {
                PolicyAction = "transfer_to_beneficiary",
                BeneficiaryUserId = 10
            }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await controller.Nominate(new HourEstateNominateRequest
            {
                PolicyAction = "transfer_to_beneficiary",
                BeneficiaryUserId = 70
            }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");
    }

    [Fact]
    public async Task AdminIndexReportAndSettle_FilterTenantRowsAndUseLedgerBalance()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedHourEstates(db);
        SeedTransactions(db);
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var index = ReadData(await controller.Index(status: "nominated", CancellationToken.None));
        var items = index.GetProperty("items").EnumerateArray().ToArray();
        items.Should().HaveCount(1);
        items[0].GetProperty("id").GetInt64().Should().Be(100);
        items[0].GetProperty("member_name").GetString().Should().Be("Ada Lovelace");
        items[0].GetProperty("beneficiary_name").GetString().Should().Be("Grace Hopper");
        items[0].GetProperty("tenant_id").GetInt32().Should().Be(42);

        var reported = ReadData(await controller.ReportDeceased(100, new HourEstateAdminNotesRequest
        {
            CoordinatorNotes = new string('N', 2100)
        }, CancellationToken.None));

        reported.GetProperty("status").GetString().Should().Be("reported");
        reported.GetProperty("reported_balance_hours").GetDecimal().Should().Be(5.5m);
        reported.GetProperty("coordinator_notes").GetString().Should().HaveLength(2000);

        var settled = ReadData(await controller.Settle(100, new HourEstateAdminNotesRequest
        {
            CoordinatorNotes = "Transferred to nominated beneficiary."
        }, CancellationToken.None));

        settled.GetProperty("status").GetString().Should().Be("settled");
        settled.GetProperty("settled_hours").GetDecimal().Should().Be(5.5m);
        settled.GetProperty("coordinator_notes").GetString().Should().Be("Transferred to nominated beneficiary.");

        var settlement = db.Transactions.Should().ContainSingle(t =>
            t.TenantId == 42
            && t.SenderId == 10
            && t.ReceiverId == 11
            && t.Amount == 5.5m
            && t.Description == "Legacy hour estate settlement"
            && t.TransactionType == PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType
            && t.Status == TransactionStatus.Completed).Which;
        var settledEstate = await db.CaringHourEstates.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == 100);
        settledEstate.SettlementTransactionId.Should().Be(settlement.Id);

        AssertSingleError(
            await controller.ReportDeceased(100, new HourEstateAdminNotesRequest(), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "ESTATE_FAILED");
        AssertSingleError(
            await controller.Settle(100, new HourEstateAdminNotesRequest(), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "ESTATE_FAILED");
        AssertSingleError(
            await CreateMemberController(db, tenant, userId: 10).Nominate(new HourEstateNominateRequest
            {
                PolicyAction = "donate_to_solidarity"
            }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "ESTATE_FAILED");
    }

    [Fact]
    public async Task Controllers_WhenFeatureDisabled_ReturnLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();

        AssertSingleError(
            await CreateMemberController(db, tenant, userId: 10).MyEstate(CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");

        AssertSingleError(
            await CreateAdminController(db, tenant, userId: 9001).Index(null, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    private static void SeedHourEstates(NexusDbContext db)
    {
        db.CaringHourEstates.AddRange(
            new CaringHourEstate
            {
                Id = 100,
                TenantId = 42,
                MemberUserId = 10,
                BeneficiaryUserId = 11,
                PolicyAction = "transfer_to_beneficiary",
                Status = "nominated",
                NominatedAt = new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc),
                CreatedAt = new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc)
            },
            new CaringHourEstate
            {
                Id = 200,
                TenantId = 7,
                MemberUserId = 70,
                PolicyAction = "donate_to_solidarity",
                Status = "nominated",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
    }

    private static void SeedTransactions(NexusDbContext db)
    {
        db.Transactions.AddRange(
            new Transaction
            {
                TenantId = 42,
                SenderId = 9001,
                ReceiverId = 10,
                Amount = 6.5m,
                Description = "Seed grant",
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            },
            new Transaction
            {
                TenantId = 42,
                SenderId = 10,
                ReceiverId = 9001,
                Amount = 1m,
                Description = "Seed debit",
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            },
            new Transaction
            {
                TenantId = 7,
                SenderId = 70,
                ReceiverId = 71,
                Amount = 999m,
                Description = "Other tenant",
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            });
    }

    private static JsonElement ReadData(IActionResult result)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(((ObjectResult) result).Value));
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

    private static void SeedUsers(NexusDbContext db)
    {
        db.Users.AddRange(
            new User
            {
                Id = 10,
                TenantId = 42,
                FirstName = "Ada",
                LastName = "Lovelace",
                Email = "ada-hour-estate@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 11,
                TenantId = 42,
                FirstName = "Grace",
                LastName = "Hopper",
                Email = "grace-hour-estate@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 70,
                TenantId = 7,
                FirstName = "Other",
                LastName = "Tenant",
                Email = "other-hour-estate@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 9001,
                TenantId = 42,
                FirstName = "Admin",
                LastName = "User",
                Email = "admin-hour-estate@example.test",
                PasswordHash = "x",
                Role = Role.Names.Admin
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

    private static AdminCaringCommunityHourEstatesController CreateAdminController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringHourEstateService(db);
        return new AdminCaringCommunityHourEstatesController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
        };
    }

    private static CaringCommunityHourEstateController CreateMemberController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringHourEstateService(db);
        return new CaringCommunityHourEstateController(service, tenant)
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
