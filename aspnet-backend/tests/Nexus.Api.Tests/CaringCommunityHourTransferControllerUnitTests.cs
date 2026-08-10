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

public class CaringCommunityHourTransferControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelHourTransferRoutes()
    {
        typeof(CaringCommunityHourTransferController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/hour-transfer");

        typeof(CaringCommunityHourTransferController)
            .GetMethod(nameof(CaringCommunityHourTransferController.Initiate))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("initiate");

        typeof(CaringCommunityHourTransferController)
            .GetMethod(nameof(CaringCommunityHourTransferController.MyHistory))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("my-history");

        typeof(AdminCaringCommunityHourTransferController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/hour-transfer");

        typeof(AdminCaringCommunityHourTransferController)
            .GetMethod(nameof(AdminCaringCommunityHourTransferController.Pending))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("pending");

        typeof(AdminCaringCommunityHourTransferController)
            .GetMethod(nameof(AdminCaringCommunityHourTransferController.Approve))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/approve");

        typeof(AdminCaringCommunityHourTransferController)
            .GetMethod(nameof(AdminCaringCommunityHourTransferController.Reject))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{id:int}/reject");

        typeof(AdminCaringCommunityHourTransferController)
            .GetMethod(nameof(AdminCaringCommunityHourTransferController.Inbound))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("inbound");
    }

    [Fact]
    public async Task MemberInitiateAndHistory_MatchLaravelValidationAndEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedTenants(db);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedBalance(db, tenantId: 42, receiverId: 10, amount: 8m);
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        var created = await controller.Initiate(new CaringHourTransferInitiateRequest
        {
            DestinationTenantSlug = "globex",
            Hours = 2.5m,
            Reason = "Moving cooperative"
        }, CancellationToken.None);

        var objectResult = created.Should().BeOfType<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status201Created);
        var data = ReadData(created);
        data.GetProperty("success").GetBoolean().Should().BeTrue();
        data.GetProperty("status").GetString().Should().Be("pending");
        data.GetProperty("transfer_id").GetInt64().Should().BeGreaterThan(0);

        var transfer = await db.CaringHourTransfers.IgnoreQueryFilters().SingleAsync();
        transfer.TenantId.Should().Be(42);
        transfer.Role.Should().Be("source");
        transfer.MemberUserId.Should().Be(10);
        transfer.CounterpartTenantSlug.Should().Be("globex");
        transfer.CounterpartMemberEmail.Should().Be("ada-transfer@example.test");
        transfer.HoursTransferred.Should().Be(2.5m);
        transfer.Status.Should().Be("pending");
        transfer.Reason.Should().Be("Moving cooperative");

        var history = ReadData(await controller.MyHistory(CancellationToken.None))
            .GetProperty("items")
            .EnumerateArray()
            .ToArray();
        history.Should().HaveCount(1);
        history[0].GetProperty("id").GetInt64().Should().Be(transfer.Id);
        history[0].GetProperty("destination_tenant_slug").GetString().Should().Be("globex");
        history[0].GetProperty("hours").GetDecimal().Should().Be(2.5m);

        AssertSingleError(
            await controller.Initiate(new CaringHourTransferInitiateRequest
            {
                Hours = 1m
            }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            "destination_tenant_slug");

        AssertSingleError(
            await controller.Initiate(new CaringHourTransferInitiateRequest
            {
                DestinationTenantSlug = "globex",
                Hours = 0m
            }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            "hours");

        AssertSingleError(
            await controller.Initiate(new CaringHourTransferInitiateRequest
            {
                DestinationTenantSlug = "globex",
                Hours = 9m
            }, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "INSUFFICIENT_HOURS",
            null);
    }

    [Fact]
    public async Task AdminPendingInboundRejectAndApprove_AreTenantScopedAndMutateLocalTransfers()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedTenants(db);
        SeedFeature(db, 42, enabled: true);
        SeedUsers(db);
        SeedBalance(db, tenantId: 42, receiverId: 10, amount: 5m);
        SeedTransferRows(db);
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, userId: 9001);

        var pending = ReadData(await controller.Pending(CancellationToken.None))
            .GetProperty("items")
            .EnumerateArray()
            .ToArray();
        pending.Should().HaveCount(2);
        pending[0].GetProperty("id").GetInt64().Should().Be(100);
        pending[0].GetProperty("member_name").GetString().Should().Be("Ada Lovelace");
        pending[0].GetProperty("member_email").GetString().Should().Be("ada-transfer@example.test");
        pending[0].GetProperty("destination_tenant_slug").GetString().Should().Be("globex");

        var inbound = ReadData(await controller.Inbound(CancellationToken.None))
            .GetProperty("items")
            .EnumerateArray()
            .ToArray();
        inbound.Should().HaveCount(1);
        inbound[0].GetProperty("id").GetInt64().Should().Be(300);
        inbound[0].GetProperty("source_tenant_slug").GetString().Should().Be("globex");
        inbound[0].GetProperty("hours").GetDecimal().Should().Be(1.25m);

        var rejected = ReadData(await controller.Reject(101, new CaringHourTransferRejectRequest
        {
            Reason = "Member requested cancellation"
        }, CancellationToken.None));
        rejected.GetProperty("success").GetBoolean().Should().BeTrue();
        rejected.GetProperty("status").GetString().Should().Be("rejected");
        (await db.CaringHourTransfers.IgnoreQueryFilters().SingleAsync(t => t.Id == 101))
            .Reason.Should().Contain("[rejected by admin #9001] Member requested cancellation");

        var approved = ReadData(await controller.Approve(100, CancellationToken.None));
        approved.GetProperty("success").GetBoolean().Should().BeTrue();
        approved.GetProperty("transfer_id").GetInt64().Should().Be(100);
        approved.GetProperty("status").GetString().Should().Be("completed");
        approved.GetProperty("destination_transfer_id").GetInt64().Should().BeGreaterThan(0);
        approved.GetProperty("remote").GetBoolean().Should().BeFalse();

        var sourceRow = await db.CaringHourTransfers.IgnoreQueryFilters().SingleAsync(t => t.Id == 100);
        sourceRow.Status.Should().Be("completed");
        sourceRow.Signature.Should().NotBeNullOrWhiteSpace();
        sourceRow.PayloadJson.Should().Contain("\"hours\":2.5");
        sourceRow.LinkedTransferId.Should().BeGreaterThan(0);

        var destinationRow = await db.CaringHourTransfers
            .IgnoreQueryFilters()
            .SingleAsync(t => t.Id == sourceRow.LinkedTransferId);
        destinationRow.TenantId.Should().Be(7);
        destinationRow.Role.Should().Be("destination");
        destinationRow.MemberUserId.Should().Be(70);
        destinationRow.CounterpartTenantSlug.Should().Be("acme");
        destinationRow.Status.Should().Be("completed");

        var allTransactions = await db.Transactions.IgnoreQueryFilters().ToListAsync();

        allTransactions.Should().ContainSingle(t =>
            t.TenantId == 42
            && t.SenderId == 10
            && t.ReceiverId == null
            && t.Amount == 2.5m
            && t.TransactionType == "other"
            && t.Description!.StartsWith("[hour_transfer_out]"));

        allTransactions.Should().ContainSingle(t =>
            t.TenantId == 7
            && t.SenderId == null
            && t.ReceiverId == 70
            && t.Amount == 2.5m
            && t.TransactionType == "other"
            && t.Description!.StartsWith("[hour_transfer_in]"));

        AssertSingleError(
            await controller.Approve(100, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "TRANSFER_FAILED",
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
            await CreateMemberController(db, tenant, userId: 10).MyHistory(CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED",
            null);

        AssertSingleError(
            await CreateAdminController(db, tenant, userId: 9001).Pending(CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED",
            null);
    }

    private static void SeedTenants(NexusDbContext db)
    {
        db.Tenants.AddRange(
            new Tenant
            {
                Id = 42,
                Slug = "acme",
                Name = "Acme"
            },
            new Tenant
            {
                Id = 7,
                Slug = "globex",
                Name = "Globex"
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
                Email = "ada-transfer@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 70,
                TenantId = 7,
                FirstName = "Ada",
                LastName = "Remote",
                Email = "ada-transfer@example.test",
                PasswordHash = "x",
                Role = Role.Names.Member
            },
            new User
            {
                Id = 9001,
                TenantId = 42,
                FirstName = "Admin",
                LastName = "User",
                Email = "admin-transfer@example.test",
                PasswordHash = "x",
                Role = Role.Names.Admin
            },
            new User
            {
                Id = 9002,
                TenantId = 7,
                FirstName = "Remote",
                LastName = "Admin",
                Email = "remote-admin-transfer@example.test",
                PasswordHash = "x",
                Role = Role.Names.Admin
            });
    }

    private static void SeedBalance(NexusDbContext db, int tenantId, int receiverId, decimal amount)
    {
        db.Transactions.Add(new Transaction
        {
            TenantId = tenantId,
            SenderId = 9001,
            ReceiverId = receiverId,
            Amount = amount,
            Description = "Seed grant",
            Status = TransactionStatus.Completed,
            CreatedAt = DateTime.UtcNow.AddDays(-7)
        });
    }

    private static void SeedTransferRows(NexusDbContext db)
    {
        db.CaringHourTransfers.AddRange(
            new CaringHourTransfer
            {
                Id = 100,
                TenantId = 42,
                CounterpartTenantSlug = "globex",
                Role = "source",
                MemberUserId = 10,
                CounterpartMemberEmail = "ada-transfer@example.test",
                HoursTransferred = 2.5m,
                Status = "pending",
                Reason = "Moving cooperative",
                CreatedAt = new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc)
            },
            new CaringHourTransfer
            {
                Id = 101,
                TenantId = 42,
                CounterpartTenantSlug = "globex",
                Role = "source",
                MemberUserId = 10,
                CounterpartMemberEmail = "ada-transfer@example.test",
                HoursTransferred = 1m,
                Status = "pending",
                CreatedAt = new DateTime(2026, 7, 4, 10, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2026, 7, 4, 10, 0, 0, DateTimeKind.Utc)
            },
            new CaringHourTransfer
            {
                Id = 200,
                TenantId = 7,
                CounterpartTenantSlug = "acme",
                Role = "source",
                MemberUserId = 70,
                CounterpartMemberEmail = "ada-transfer@example.test",
                HoursTransferred = 99m,
                Status = "pending",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            },
            new CaringHourTransfer
            {
                Id = 300,
                TenantId = 42,
                CounterpartTenantSlug = "globex",
                Role = "destination",
                MemberUserId = 10,
                CounterpartMemberEmail = "ada-transfer@example.test",
                HoursTransferred = 1.25m,
                Status = "completed",
                Reason = "Inbound recent",
                CreatedAt = DateTime.UtcNow.AddDays(-5),
                UpdatedAt = DateTime.UtcNow.AddDays(-5)
            },
            new CaringHourTransfer
            {
                Id = 301,
                TenantId = 42,
                CounterpartTenantSlug = "globex",
                Role = "destination",
                MemberUserId = 10,
                CounterpartMemberEmail = "ada-transfer@example.test",
                HoursTransferred = 1.25m,
                Status = "completed",
                Reason = "Inbound old",
                CreatedAt = DateTime.UtcNow.AddDays(-120),
                UpdatedAt = DateTime.UtcNow.AddDays(-120)
            });
    }

    private static JsonElement ReadData(IActionResult result)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(((ObjectResult) result).Value));
        return document.RootElement.GetProperty("data").Clone();
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

    private static CaringCommunityHourTransferController CreateMemberController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringHourTransferService(db);
        return new CaringCommunityHourTransferController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "member")
        };
    }

    private static AdminCaringCommunityHourTransferController CreateAdminController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaringHourTransferService(db);
        return new AdminCaringCommunityHourTransferController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
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
