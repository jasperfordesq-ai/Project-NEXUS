// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class CaringRegionalPointLedgerConcurrencyTests : IntegrationTestBase
{
    public CaringRegionalPointLedgerConcurrencyTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ConcurrentIssues_SerializeFirstAccountCreationAndPreserveEveryCredit()
    {
        await EnableRegionalPointsAsync(transfersEnabled: false, autoIssueEnabled: false);
        var userId = await CreateMemberAsync("issue");

        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(async attempt =>
        {
            using var scope = Factory.Services.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<CaringRegionalPointService>();
            return await service.IssueAsync(
                TestData.Tenant1.Id,
                userId,
                1m,
                $"Concurrent issue {attempt}",
                TestData.AdminUser.Id,
                CancellationToken.None);
        }));

        results.Should().HaveCount(6);
        results.Select(result => result.TransactionId).Should().OnlyHaveUniqueItems();
        using var evidenceScope = Factory.Services.CreateScope();
        var db = evidenceScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var account = await db.CaringRegionalPointAccounts
            .IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == TestData.Tenant1.Id && row.UserId == userId);
        account.Balance.Should().Be(6m);
        account.LifetimeEarned.Should().Be(6m);
        (await db.CaringRegionalPointTransactions.IgnoreQueryFilters()
            .CountAsync(row => row.TenantId == TestData.Tenant1.Id
                && row.UserId == userId
                && row.Type == "admin_issue"))
            .Should().Be(6);
    }

    [Fact]
    public async Task OppositeDirectionTransfers_LockAccountsInOneOrderWithoutLosingPoints()
    {
        await EnableRegionalPointsAsync(transfersEnabled: true, autoIssueEnabled: false);
        var firstUserId = await CreateMemberAsync("transfer-a");
        var secondUserId = await CreateMemberAsync("transfer-b");
        using (var seedScope = Factory.Services.CreateScope())
        {
            var db = seedScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.CaringRegionalPointAccounts.AddRange(
                NewAccount(TestData.Tenant1.Id, firstUserId, 100m),
                NewAccount(TestData.Tenant1.Id, secondUserId, 100m));
            await db.SaveChangesAsync();
        }

        async Task<RegionalPointTransferResult> TransferAsync(int senderId, int recipientId)
        {
            using var scope = Factory.Services.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<CaringRegionalPointService>();
            return await service.TransferBetweenMembersAsync(
                TestData.Tenant1.Id,
                senderId,
                recipientId,
                10m,
                "Opposite-direction concurrency proof",
                CancellationToken.None);
        }

        var results = await Task.WhenAll(
            TransferAsync(firstUserId, secondUserId),
            TransferAsync(secondUserId, firstUserId));

        results.Should().HaveCount(2);
        using var evidenceScope = Factory.Services.CreateScope();
        var evidenceDb = evidenceScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var accounts = await evidenceDb.CaringRegionalPointAccounts
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id
                && (row.UserId == firstUserId || row.UserId == secondUserId))
            .OrderBy(row => row.UserId)
            .ToListAsync();
        accounts.Should().HaveCount(2);
        accounts.Should().OnlyContain(account => account.Balance == 100m);
        accounts.Should().OnlyContain(account => account.LifetimeEarned == 110m);
        accounts.Should().OnlyContain(account => account.LifetimeSpent == 10m);
        (await evidenceDb.CaringRegionalPointTransactions.IgnoreQueryFilters()
            .CountAsync(row => row.TenantId == TestData.Tenant1.Id
                && (row.UserId == firstUserId || row.UserId == secondUserId)
                && (row.Type == "transfer_out" || row.Type == "transfer_in")))
            .Should().Be(4);
    }

    [Fact]
    public async Task ConcurrentVolLogReversals_CreateOneDebitAndPermitNegativeBalance()
    {
        await EnableRegionalPointsAsync(transfersEnabled: false, autoIssueEnabled: true);
        var userId = await CreateMemberAsync("reversal");
        var volLogId = Random.Shared.Next(1_000_000, 2_000_000);
        using (var awardScope = Factory.Services.CreateScope())
        {
            var service = awardScope.ServiceProvider.GetRequiredService<CaringRegionalPointService>();
            await service.AwardForApprovedHoursAsync(
                TestData.Tenant1.Id,
                userId,
                volLogId,
                1m,
                TestData.AdminUser.Id,
                CancellationToken.None);
            await service.AdjustAsync(
                TestData.Tenant1.Id,
                userId,
                -8m,
                "Spend before reversal",
                TestData.AdminUser.Id,
                CancellationToken.None);
        }

        async Task<bool> ReverseAsync(string reason)
        {
            using var scope = Factory.Services.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<CaringRegionalPointService>();
            return await service.ReverseFromVolLogAsync(
                TestData.Tenant1.Id,
                volLogId,
                reason,
                CancellationToken.None);
        }

        var results = await Task.WhenAll(
            ReverseAsync("Approved to declined"),
            ReverseAsync("Duplicate event delivery"));

        results.Count(result => result).Should().Be(1);
        results.Count(result => !result).Should().Be(1);
        using var evidenceScope = Factory.Services.CreateScope();
        var db = evidenceScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var account = await db.CaringRegionalPointAccounts
            .IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == TestData.Tenant1.Id && row.UserId == userId);
        account.Balance.Should().Be(-8m);
        account.LifetimeEarned.Should().Be(0m);
        account.LifetimeSpent.Should().Be(8m);
        var reversal = await db.CaringRegionalPointTransactions
            .IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == TestData.Tenant1.Id
                && row.ReferenceType == "vol_log_reversal"
                && row.ReferenceId == volLogId);
        reversal.Type.Should().Be("reversal");
        reversal.Direction.Should().Be("debit");
        reversal.Points.Should().Be(10m);
        reversal.BalanceAfter.Should().Be(-8m);
    }

    private async Task<int> CreateMemberAsync(string prefix)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var suffix = Guid.NewGuid().ToString("N");
        var user = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"regional-{prefix}-{suffix}@example.test",
            PasswordHash = "test",
            FirstName = "Regional",
            LastName = prefix,
            Role = Role.Names.Member,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private async Task EnableRegionalPointsAsync(bool transfersEnabled, bool autoIssueEnabled)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var settings = new Dictionary<string, string>
        {
            ["features.caring_community"] = "true",
            [CaringRegionalPointService.KeyPrefix + "enabled"] = "true",
            [CaringRegionalPointService.KeyPrefix + "member_transfers_enabled"] = transfersEnabled ? "true" : "false",
            [CaringRegionalPointService.KeyPrefix + "auto_issue_enabled"] = autoIssueEnabled ? "true" : "false",
            [CaringRegionalPointService.KeyPrefix + "points_per_approved_hour"] = "10"
        };

        foreach (var (key, value) in settings)
        {
            var row = await db.TenantConfigs.IgnoreQueryFilters()
                .FirstOrDefaultAsync(item => item.TenantId == TestData.Tenant1.Id && item.Key == key);
            if (row is null)
            {
                row = new TenantConfig
                {
                    TenantId = TestData.Tenant1.Id,
                    Key = key,
                    CreatedAt = DateTime.UtcNow
                };
                db.TenantConfigs.Add(row);
            }

            row.Value = value;
            row.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
    }

    private static CaringRegionalPointAccount NewAccount(int tenantId, int userId, decimal balance)
    {
        return new CaringRegionalPointAccount
        {
            TenantId = tenantId,
            UserId = userId,
            Balance = balance,
            LifetimeEarned = balance,
            LifetimeSpent = 0m,
            CreatedAt = DateTime.UtcNow
        };
    }
}
