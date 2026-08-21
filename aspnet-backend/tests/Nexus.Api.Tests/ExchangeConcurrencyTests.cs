// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Concurrency around the exchange settlement boundary.
 *
 * 🔴 THIS FILE'S PREMISE CHANGED ON 2026-08-21. It used to assert that completion
 * was unavailable — that `CompleteExchangeAsync` refused on every path and could
 * therefore never move credits under parallel or repeated requests. That was the
 * honest position while the `exchanges` table had nowhere to record two separate
 * confirmations. Migration 20260821164404_AddExchangeTwoPartyConfirmation added the
 * five columns, so the fail-closed answer is gone and these tests now guard the real
 * invariants instead:
 *
 *   - `/complete` is a HAND-OVER (Laravel's markReadyForConfirmation). Parallel and
 *     repeated calls may advance the state at most once and may NEVER settle.
 *   - only the provider may call it; the receiver signing off their own delivery is
 *     the direct-call IDOR Laravel's provider-only rule closes.
 *
 * The settlement race itself — both parties confirming simultaneously, exactly one
 * payment — is in ExchangeSettlementTests, which reads both ledger legs and both
 * derived balances back. Keeping the two apart is deliberate: this file is about the
 * step that must move no money, that one is about the step that must move it once.
 */

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class ExchangeConcurrencyTests : IntegrationTestBase
{
    private const string ReceiverCannotComplete =
        "Only the provider can mark this exchange as complete";

    public ExchangeConcurrencyTests(NexusWebApplicationFactory factory) : base(factory) { }

    /// <summary>
    /// Seed: a Listing owned by admin (provider) + an InProgress Exchange
    /// where member (receiver) is paying admin (provider) AgreedHours hours.
    /// Member is pre-credited so a refusal cannot be mistaken for an
    /// insufficient-balance rejection.
    /// </summary>
    private async Task<int> SeedReadyExchangeAsync(decimal agreedHours, decimal startingBalance)
    {
        using var scope = Factory.Services.CreateScope();
        var tenantContext = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenantContext.SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var listing = new Listing
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.AdminUser.Id,
            Title = "Concurrency test listing",
            Description = "A listing seeded for the concurrency test suite.",
            Type = ListingType.Offer,
            Status = ListingStatus.Active,
            CreatedAt = DateTime.UtcNow
        };
        db.Listings.Add(listing);
        await db.SaveChangesAsync();

        // Pre-credit the receiver (member) with `startingBalance` hours via a
        // synthetic Transaction. The balance calc sums Completed transactions.
        if (startingBalance > 0)
        {
            db.Transactions.Add(new Transaction
            {
                TenantId = TestData.Tenant1.Id,
                SenderId = null, // minted; crediting from admin would move the payee too
                ReceiverId = TestData.MemberUser.Id,
                Amount = startingBalance,
                Description = "Concurrency test seed credit",
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var exchange = new Exchange
        {
            TenantId = TestData.Tenant1.Id,
            ListingId = listing.Id,
            ListingOwnerId = TestData.AdminUser.Id,
            InitiatorId = TestData.MemberUser.Id,
            ReceiverId = TestData.MemberUser.Id,
            ProviderId = TestData.AdminUser.Id,
            AgreedHours = agreedHours,
            Status = ExchangeStatus.InProgress,
            StartedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        db.Exchanges.Add(exchange);
        await db.SaveChangesAsync();
        return exchange.Id;
    }

    [Fact]
    public async Task ConcurrentHandOver_AdvancesTheStateAtMostOnceAndSettlesNothing()
    {
        var exchangeId = await SeedReadyExchangeAsync(agreedHours: 2.0m, startingBalance: 10m);
        var memberBalanceBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var adminBalanceBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        // Fire two parallel hand-overs on independent scopes (mimicking two
        // simultaneous HTTP requests landing on different worker threads). The
        // provider is the admin, so both calls are legitimate; at most one may win.
        async Task<(Exchange? Ex, string? Err)> Complete()
        {
            using var scope = Factory.Services.CreateScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var svc = scope.ServiceProvider.GetRequiredService<ExchangeService>();
            return await svc.CompleteExchangeAsync(exchangeId, TestData.AdminUser.Id, actualHours: null);
        }

        var task1 = Task.Run(Complete);
        var task2 = Task.Run(Complete);
        var results = await Task.WhenAll(task1, task2);

        // Whether the loser is refused by the transition guard or by the RowVersion
        // token is a race; what is fixed is that no call may settle and the row lands
        // in exactly one state.
        results.Count(result => result.Ex != null && result.Err == null)
            .Should().BeGreaterThan(0, "at least one hand-over must succeed");

        using var assertScope = Factory.Services.CreateScope();
        assertScope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await db.Exchanges.IgnoreQueryFilters().FirstAsync(e => e.Id == exchangeId);
        refreshed.Status.Should().Be(ExchangeStatus.PendingConfirmation);
        refreshed.TransactionId.Should().BeNull("the hand-over step must never settle");
        refreshed.FinalHours.Should().BeNull();
        refreshed.CompletedAt.Should().BeNull();
        refreshed.RequesterConfirmedAt.Should().BeNull();
        refreshed.ProviderConfirmedAt.Should().BeNull();

        (await SettlementCountAsync(db, exchangeId)).Should().Be(0);
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBalanceBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
    }

    [Fact]
    public async Task HandOver_ByTheReceiver_IsRefusedWithoutMutation()
    {
        var exchangeId = await SeedReadyExchangeAsync(agreedHours: 100m, startingBalance: 5m);
        var memberBalanceBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var adminBalanceBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var svc = scope.ServiceProvider.GetRequiredService<ExchangeService>();
        var (ex, err) = await svc.CompleteExchangeAsync(exchangeId, TestData.MemberUser.Id, actualHours: null);

        ex.Should().BeNull();
        err.Should().Be(ReceiverCannotComplete);

        using var assertScope = Factory.Services.CreateScope();
        assertScope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await db.Exchanges.IgnoreQueryFilters().FirstAsync(e => e.Id == exchangeId);
        refreshed.Status.Should().Be(ExchangeStatus.InProgress, "rejection must not advance the state machine");

        (await SettlementCountAsync(db, exchangeId)).Should().Be(0);
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBalanceBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
    }

    [Fact]
    public async Task RepeatedHandOver_IsRefusedTheSecondTimeAndStaysMutationFree()
    {
        var exchangeId = await SeedReadyExchangeAsync(agreedHours: 1m, startingBalance: 5m);
        var memberBalanceBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var adminBalanceBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var svc = scope.ServiceProvider.GetRequiredService<ExchangeService>();
        var first = await svc.CompleteExchangeAsync(exchangeId, TestData.AdminUser.Id, null);
        var second = await svc.CompleteExchangeAsync(exchangeId, TestData.AdminUser.Id, null);

        first.Error.Should().BeNull();
        first.Exchange!.Status.Should().Be(ExchangeStatus.PendingConfirmation);
        // PendingConfirmation -> PendingConfirmation is not a declared transition, so
        // the replay is refused rather than silently re-stamping the row.
        second.Exchange.Should().BeNull();
        second.Error.Should().Contain("Cannot transition");

        using var assertScope = Factory.Services.CreateScope();
        assertScope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await db.Exchanges.IgnoreQueryFilters().SingleAsync(e => e.Id == exchangeId);
        refreshed.Status.Should().Be(ExchangeStatus.PendingConfirmation);
        refreshed.CompletedAt.Should().BeNull();
        refreshed.TransactionId.Should().BeNull();
        (await SettlementCountAsync(db, exchangeId)).Should().Be(0);
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBalanceBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
    }

    private static async Task<int> SettlementCountAsync(NexusDbContext db, int exchangeId)
    {
        var prefix = $"Exchange #{exchangeId} for listing:";
        return await db.Transactions.IgnoreQueryFilters()
            .CountAsync(t => t.TransactionType == ExchangeService.ExchangeTransactionType
                && t.Description != null
                && t.Description.StartsWith(prefix));
    }

    private async Task<decimal> GetBalanceAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var wallet = scope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
        return await wallet.GetBalanceAsync(TestData.Tenant1.Id, userId);
    }
}
