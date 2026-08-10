// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class CaringLoyaltyLedgerConcurrencyTests : IntegrationTestBase
{
    public CaringLoyaltyLedgerConcurrencyTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ConcurrentReverse_MintsExactlyOneHiddenSystemRefund()
    {
        int redemptionId;
        decimal balanceBefore;
        using (var seedScope = Factory.Services.CreateScope())
        {
            var db = seedScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var ledger = seedScope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
            var now = DateTime.UtcNow;
            var debit = new Transaction
            {
                TenantId = TestData.Tenant1.Id,
                SenderId = TestData.MemberUser.Id,
                ReceiverId = null,
                Amount = 2m,
                Description = "[loyalty_redemption] concurrency evidence",
                TransactionType = PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType,
                Status = TransactionStatus.Completed,
                CreatedAt = now
            };
            var redemption = new CaringLoyaltyRedemption
            {
                TenantId = TestData.Tenant1.Id,
                MemberUserId = TestData.MemberUser.Id,
                MerchantUserId = TestData.AdminUser.Id,
                CreditsUsed = 2m,
                ExchangeRateChf = 25m,
                DiscountChf = 50m,
                OrderTotalChf = 100m,
                Status = "applied",
                RedemptionTransaction = debit,
                RedeemedAt = now,
                CreatedAt = now,
                UpdatedAt = now
            };
            db.Transactions.Add(debit);
            db.CaringLoyaltyRedemptions.Add(redemption);
            await db.SaveChangesAsync();
            balanceBefore = await ledger.GetBalanceAsync(TestData.Tenant1.Id, TestData.MemberUser.Id);
            redemptionId = redemption.Id;
        }

        var attempts = await Task.WhenAll(Enumerable.Range(0, 10).Select(async _ =>
        {
            using var scope = Factory.Services.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<CaringLoyaltyService>();
            return await service.ReverseAsync(
                TestData.Tenant1.Id,
                redemptionId,
                "Concurrent reconciliation",
                TestData.AdminUser.Id,
                CancellationToken.None);
        }));

        attempts.Count(result => result.StatusCode == StatusCodes.Status200OK).Should().Be(1);
        attempts.Count(result => result.StatusCode == StatusCodes.Status422UnprocessableEntity).Should().Be(9);

        using var evidenceScope = Factory.Services.CreateScope();
        var evidenceDb = evidenceScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var evidenceLedger = evidenceScope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
        var redemptionAfter = await evidenceDb.CaringLoyaltyRedemptions
            .IgnoreQueryFilters()
            .SingleAsync(row => row.Id == redemptionId);
        redemptionAfter.Status.Should().Be("reversed");
        redemptionAfter.ReversedBy.Should().Be(TestData.AdminUser.Id);
        redemptionAfter.RedemptionTransactionId.Should().NotBeNull();
        redemptionAfter.ReversalTransactionId.Should().NotBeNull();

        var refunds = await evidenceDb.Transactions
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id
                && row.SenderId == null
                && row.ReceiverId == TestData.MemberUser.Id
                && row.TransactionType == PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && row.Description == $"[loyalty_reversal] redemption:{redemptionId}")
            .ToListAsync();
        refunds.Should().ContainSingle();
        refunds[0].Amount.Should().Be(2m);
        (await evidenceDb.Transactions
            .IgnoreQueryFilters()
            .ExcludeInternalWalletAdapters()
            .AnyAsync(row => row.Id == refunds[0].Id))
            .Should().BeFalse();
        (await evidenceLedger.GetBalanceAsync(TestData.Tenant1.Id, TestData.MemberUser.Id))
            .Should().Be(balanceBefore + 2m);
    }

    [Fact]
    public async Task UnlinkedAppliedLegacyRedemption_RequiresManualReconciliationWithoutMinting()
    {
        int redemptionId;
        decimal balanceBefore;
        using (var seedScope = Factory.Services.CreateScope())
        {
            var db = seedScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var ledger = seedScope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
            balanceBefore = await ledger.GetBalanceAsync(TestData.Tenant1.Id, TestData.MemberUser.Id);
            var now = DateTime.UtcNow;
            var redemption = new CaringLoyaltyRedemption
            {
                TenantId = TestData.Tenant1.Id,
                MemberUserId = TestData.MemberUser.Id,
                MerchantUserId = TestData.AdminUser.Id,
                CreditsUsed = 2m,
                ExchangeRateChf = 25m,
                DiscountChf = 50m,
                OrderTotalChf = 100m,
                Status = "applied",
                RedeemedAt = now,
                CreatedAt = now,
                UpdatedAt = now
            };
            db.CaringLoyaltyRedemptions.Add(redemption);
            await db.SaveChangesAsync();
            redemptionId = redemption.Id;
        }

        using (var reverseScope = Factory.Services.CreateScope())
        {
            var service = reverseScope.ServiceProvider.GetRequiredService<CaringLoyaltyService>();
            var result = await service.ReverseAsync(
                TestData.Tenant1.Id,
                redemptionId,
                "Legacy manual review",
                TestData.AdminUser.Id,
                CancellationToken.None);
            result.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
            result.Errors.Should().ContainSingle(error =>
                error.Code == "REVERSAL_FAILED" && error.Message.Contains("manual reconciliation"));
        }

        using var evidenceScope = Factory.Services.CreateScope();
        var evidenceDb = evidenceScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var evidenceLedger = evidenceScope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
        var row = await evidenceDb.CaringLoyaltyRedemptions.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == redemptionId);
        row.Status.Should().Be("applied");
        row.ReversalTransactionId.Should().BeNull();
        (await evidenceDb.Transactions.IgnoreQueryFilters()
            .AnyAsync(transaction => transaction.Description == $"[loyalty_reversal] redemption:{redemptionId}"))
            .Should().BeFalse();
        (await evidenceLedger.GetBalanceAsync(TestData.Tenant1.Id, TestData.MemberUser.Id))
            .Should().Be(balanceBefore);
    }
}
