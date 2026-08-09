// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class CaringRegionalPointLedgerHardeningTests
{
    [Fact]
    public async Task AdminMutationsAndMemberTransfer_PreserveLaravelLedgerSemanticsInMemory()
    {
        await using var db = CreateDbContext();
        SeedConfiguration(db, transfersEnabled: true, autoIssueEnabled: false);
        SeedUser(db, 10);
        SeedUser(db, 11);
        SeedUser(db, 99, Role.Names.Admin);
        await db.SaveChangesAsync();
        var service = new CaringRegionalPointService(db);

        await service.IssueAsync(42, 10, 10m, "Initial issue", 99, CancellationToken.None);
        await service.AdjustAsync(42, 10, -3m, "Coordinator correction", 99, CancellationToken.None);
        await service.IssueAsync(42, 11, 5m, "Recipient seed", 99, CancellationToken.None);
        var transfer = await service.TransferBetweenMembersAsync(
            42,
            senderId: 10,
            recipientId: 11,
            points: 2m,
            message: "Neighbourly transfer",
            CancellationToken.None);

        var accounts = await db.CaringRegionalPointAccounts
            .IgnoreQueryFilters()
            .OrderBy(row => row.UserId)
            .ToListAsync();
        accounts.Should().HaveCount(2);
        accounts[0].UserId.Should().Be(10);
        accounts[0].Balance.Should().Be(5m);
        accounts[0].LifetimeEarned.Should().Be(10m);
        accounts[0].LifetimeSpent.Should().Be(5m);
        accounts[1].UserId.Should().Be(11);
        accounts[1].Balance.Should().Be(7m);
        accounts[1].LifetimeEarned.Should().Be(7m);
        accounts[1].LifetimeSpent.Should().Be(0m);

        var rows = await db.CaringRegionalPointTransactions
            .IgnoreQueryFilters()
            .OrderBy(row => row.Id)
            .ToListAsync();
        rows.Should().HaveCount(5);
        rows.Select(row => (row.Type, row.Direction, row.Points)).Should().Equal(
            ("admin_issue", "credit", 10m),
            ("admin_adjustment", "debit", 3m),
            ("admin_issue", "credit", 5m),
            ("transfer_out", "debit", 2m),
            ("transfer_in", "credit", 2m));

        var transferOut = rows.Single(row => row.Id == transfer.SenderTransactionId);
        var transferIn = rows.Single(row => row.Id == transfer.RecipientTransactionId);
        transferOut.ReferenceType.Should().Be("regional_point_transfer");
        transferOut.ReferenceId.Should().Be(transferIn.Id);
        transferIn.ReferenceType.Should().Be("regional_point_transfer");
        transferIn.ReferenceId.Should().Be(transferOut.Id);
    }

    [Fact]
    public async Task ReverseFromVolLog_IsIdempotentAndAllowsNegativeBalanceInMemory()
    {
        await using var db = CreateDbContext();
        SeedConfiguration(db, transfersEnabled: false, autoIssueEnabled: true);
        SeedUser(db, 10);
        SeedUser(db, 99, Role.Names.Admin);
        await db.SaveChangesAsync();
        var service = new CaringRegionalPointService(db);

        var award = await service.AwardForApprovedHoursAsync(
            tenantId: 42,
            userId: 10,
            volLogId: 701,
            hours: 1m,
            actorId: 99,
            CancellationToken.None);
        await service.AdjustAsync(42, 10, -8m, "Points already spent", 99, CancellationToken.None);

        var first = await service.ReverseFromVolLogAsync(
            42,
            701,
            "Status changed to rejected",
            CancellationToken.None);
        var duplicate = await service.ReverseFromVolLogAsync(
            42,
            701,
            "Duplicate listener delivery",
            CancellationToken.None);

        first.Should().BeTrue();
        duplicate.Should().BeFalse();
        var account = await db.CaringRegionalPointAccounts.IgnoreQueryFilters().SingleAsync();
        account.Balance.Should().Be(-8m);
        account.LifetimeEarned.Should().Be(0m);
        account.LifetimeSpent.Should().Be(8m);

        var reversal = await db.CaringRegionalPointTransactions
            .IgnoreQueryFilters()
            .SingleAsync(row => row.ReferenceType == "vol_log_reversal");
        reversal.Type.Should().Be("reversal");
        reversal.Direction.Should().Be("debit");
        reversal.Points.Should().Be(10m);
        reversal.BalanceAfter.Should().Be(-8m);
        reversal.ReferenceId.Should().Be(701);
        reversal.Description.Should().Be("Regional points reversed: Status changed to rejected");

        using var metadata = JsonDocument.Parse(reversal.Metadata!);
        metadata.RootElement.GetProperty("original_transaction_id").GetInt64()
            .Should().Be(award!.TransactionId);
        metadata.RootElement.GetProperty("reason").GetString()
            .Should().Be("Status changed to rejected");
        (await db.CaringRegionalPointTransactions.IgnoreQueryFilters()
            .CountAsync(row => row.ReferenceType == "vol_log_reversal"))
            .Should().Be(1);
    }

    [Theory]
    [InlineData(0, 701)]
    [InlineData(42, 0)]
    public async Task ReverseFromVolLog_InvalidScope_IsANoOp(int tenantId, int volLogId)
    {
        await using var db = CreateDbContext();

        var reversed = await new CaringRegionalPointService(db).ReverseFromVolLogAsync(
            tenantId,
            volLogId,
            "Invalid event",
            CancellationToken.None);

        reversed.Should().BeFalse();
        (await db.CaringRegionalPointTransactions.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        (await db.CaringRegionalPointAccounts.IgnoreQueryFilters().CountAsync()).Should().Be(0);
    }

    private static NexusDbContext CreateDbContext()
    {
        var tenant = new TenantContext();
        tenant.SetTenant(42);
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new NexusDbContext(options, tenant);
    }

    private static void SeedConfiguration(
        NexusDbContext db,
        bool transfersEnabled,
        bool autoIssueEnabled)
    {
        db.TenantConfigs.AddRange(
            Setting("features.caring_community", "true"),
            Setting(CaringRegionalPointService.KeyPrefix + "enabled", "true"),
            Setting(CaringRegionalPointService.KeyPrefix + "member_transfers_enabled", transfersEnabled ? "true" : "false"),
            Setting(CaringRegionalPointService.KeyPrefix + "auto_issue_enabled", autoIssueEnabled ? "true" : "false"),
            Setting(CaringRegionalPointService.KeyPrefix + "points_per_approved_hour", "10"));
    }

    private static TenantConfig Setting(string key, string value)
    {
        return new TenantConfig
        {
            TenantId = 42,
            Key = key,
            Value = value
        };
    }

    private static void SeedUser(NexusDbContext db, int userId, string role = Role.Names.Member)
    {
        db.Users.Add(new User
        {
            Id = userId,
            TenantId = 42,
            Email = $"regional-ledger-{userId}@example.test",
            PasswordHash = "test",
            FirstName = "Regional",
            LastName = $"Member {userId}",
            Role = role,
            IsActive = true
        });
    }
}
