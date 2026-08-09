// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Federation hardening — concurrency tests for CommitAndSettleAsync.
 *
 * Modelled on ExchangeConcurrencyTests. The production
 * HourTransferReconciliationService.CommitAndSettleAsync now uses the shared
 * personal-wallet advisory lock and a nullable remote ledger leg.
 *
 * Both tests drive the public ReconcileTenantAsync entrypoint with
 * transfers pre-seeded in the Acknowledged state, using Protocol="native"
 * so CommitAndSettleAsync takes no partner HTTP path before settlement.
 */

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Services.Federation;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class FederationHourTransferConcurrencyTests : IntegrationTestBase
{
    public FederationHourTransferConcurrencyTests(NexusWebApplicationFactory factory) : base(factory) { }

    /// <summary>
    /// Seed a partner endpoint TenantConfig entry + an Acknowledged outbound
    /// federated hour transfer for the member user. Pre-credits the member
    /// with <paramref name="startingBalance"/> hours via a synthetic
    /// Transaction so the balance check inside CommitAndSettleAsync passes
    /// (or fails, when starting balance is short).
    /// </summary>
    private async Task<(int TransferId, int PartnerId)> SeedAcknowledgedTransferAsync(
        decimal amount,
        decimal startingBalance,
        FederatedTransferDirection direction = FederatedTransferDirection.Outbound)
    {
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var partner = await db.FederationPartners
            .IgnoreQueryFilters()
            .FirstAsync(p => p.TenantId == TestData.Tenant1.Id);

        // Endpoint config — CommitAndSettleAsync requires endpoint resolved,
        // even though Protocol="native" never actually calls it.
        var key = $"federation.partner.{partner.Id}.endpoint";
        if (!await db.TenantConfigs.IgnoreQueryFilters().AnyAsync(c => c.TenantId == TestData.Tenant1.Id && c.Key == key))
        {
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = key,
                Value = "https://partner.test/federation",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        if (startingBalance > 0)
        {
            db.Transactions.Add(new Transaction
            {
                TenantId = TestData.Tenant1.Id,
                SenderId = TestData.AdminUser.Id,
                ReceiverId = TestData.MemberUser.Id,
                Amount = startingBalance,
                Description = "FederationConcurrencyTests seed credit",
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var transfer = new FederatedHourTransfer
        {
            TenantId = TestData.Tenant1.Id,
            PartnerId = partner.Id,
            Direction = direction,
            LocalUserId = TestData.MemberUser.Id,
            RemoteUserExternalId = "remote-test-user",
            RemoteUserDisplayName = "Remote Partner User",
            Amount = amount,
            Protocol = "native",
            // Non-empty so CommitAndSettleAsync doesn't return early.
            ExternalReference = $"native://test/{Guid.NewGuid():N}",
            Status = FederatedTransferStatus.Acknowledged,
            Description = "concurrency-test transfer",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        db.FederatedHourTransfers.Add(transfer);
        await db.SaveChangesAsync();
        return (transfer.Id, partner.Id);
    }

    private async Task<decimal> GetBalanceAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var wallet = scope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
        return await wallet.GetBalanceAsync(TestData.Tenant1.Id, userId);
    }

    [Fact]
    public async Task ReconcileTenant_WhileDurableSagaIsUnavailable_IsAnExplicitNoOp()
    {
        var memberBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var (transferId, _) = await SeedAcknowledgedTransferAsync(amount: 2m, startingBalance: 10m);

        async Task<ReconcileBatchResult> ReconcileOnce()
        {
            using var scope = Factory.Services.CreateScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var service = scope.ServiceProvider.GetRequiredService<HourTransferReconciliationService>();
            return await service.ReconcileTenantAsync(TestData.Tenant1.Id, batchSize: 50, ct: default);
        }

        var results = await Task.WhenAll(Task.Run(ReconcileOnce), Task.Run(ReconcileOnce));
        results.Should().OnlyContain(result =>
            result.Advanced == 0 && result.Failed == 0 && result.GivenUp == 0);

        using var assertScope = Factory.Services.CreateScope();
        assertScope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var transfer = await db.FederatedHourTransfers
            .IgnoreQueryFilters()
            .SingleAsync(row => row.Id == transferId);

        transfer.Status.Should().Be(FederatedTransferStatus.Acknowledged);
        transfer.LocalTransactionId.Should().BeNull();
        transfer.RetryCount.Should().Be(0);
        transfer.LastReconcileAttemptAt.Should().BeNull();
        (await db.Transactions.IgnoreQueryFilters()
            .CountAsync(row => row.Description != null &&
                               row.Description.Contains($"transfer #{transferId}:")))
            .Should().Be(0);
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBefore + 10m);
    }

}
