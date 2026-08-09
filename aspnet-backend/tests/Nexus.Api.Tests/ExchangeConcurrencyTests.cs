// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Exchange completion is deliberately fail-closed until the model can bind
 * both participants' confirmation to one immutable settlement. These tests
 * keep that boundary explicit under parallel and repeated requests and prove
 * that the disabled endpoint cannot move state or write wallet ledger rows.
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
    private const string CompletionUnavailable =
        "Exchange completion requires matching confirmation from both participants and is not available on this endpoint.";

    public ExchangeConcurrencyTests(NexusWebApplicationFactory factory) : base(factory) { }

    /// <summary>
    /// Seed: a Listing owned by admin (provider) + an InProgress Exchange
    /// where member (receiver) is paying admin (provider) AgreedHours hours.
    /// Member is pre-credited so the fail-closed result cannot be mistaken for
    /// an insufficient-balance rejection.
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
                SenderId = TestData.AdminUser.Id, // we don't enforce sender balance for the seed
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
    public async Task ConcurrentCompletion_WhenConfirmationWorkflowIsUnavailable_AllCallsFailWithoutMutation()
    {
        var exchangeId = await SeedReadyExchangeAsync(agreedHours: 2.0m, startingBalance: 10m);
        var memberBalanceBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var adminBalanceBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        // Fire two parallel completions on independent scopes (mimicking two
        // simultaneous HTTP requests landing on different worker threads).
        async Task<(Exchange? Ex, string? Err)> Complete()
        {
            using var scope = Factory.Services.CreateScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var svc = scope.ServiceProvider.GetRequiredService<ExchangeService>();
            return await svc.CompleteExchangeAsync(exchangeId, TestData.MemberUser.Id, actualHours: null);
        }

        var task1 = Task.Run(Complete);
        var task2 = Task.Run(Complete);
        var results = await Task.WhenAll(task1, task2);

        results.Should().OnlyContain(result =>
            result.Ex == null && result.Err == CompletionUnavailable);

        // Neither request may advance state or create a settlement row.
        using var assertScope = Factory.Services.CreateScope();
        assertScope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await db.Exchanges.FirstAsync(e => e.Id == exchangeId);
        refreshed.Status.Should().Be(ExchangeStatus.InProgress);
        refreshed.ActualHours.Should().BeNull();
        refreshed.CompletedAt.Should().BeNull();
        refreshed.TransactionId.Should().BeNull();

        var transactionCount = await db.Transactions
            .CountAsync(t => t.Description != null
                && t.Description.StartsWith($"Exchange #{exchangeId}:"));
        transactionCount.Should().Be(0);
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBalanceBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
    }

    [Fact]
    public async Task Completion_WhenBalanceIsInsufficient_StillFailsAtConfirmationBoundaryWithoutMutation()
    {
        var exchangeId = await SeedReadyExchangeAsync(agreedHours: 100m, startingBalance: 5m);
        var memberBalanceBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var adminBalanceBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var svc = scope.ServiceProvider.GetRequiredService<ExchangeService>();
        var (ex, err) = await svc.CompleteExchangeAsync(exchangeId, TestData.MemberUser.Id, actualHours: null);

        ex.Should().BeNull();
        err.Should().Be(CompletionUnavailable);

        using var assertScope = Factory.Services.CreateScope();
        assertScope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await db.Exchanges.IgnoreQueryFilters().FirstAsync(e => e.Id == exchangeId);
        refreshed.Status.Should().Be(ExchangeStatus.InProgress, "rejection must not advance the state machine");

        var txCount = await db.Transactions.IgnoreQueryFilters()
            .CountAsync(t => t.Description != null
                && t.Description.StartsWith($"Exchange #{exchangeId}:"));
        txCount.Should().Be(0);
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBalanceBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
    }

    [Fact]
    public async Task SequentialCompletionAttempts_RemainUnavailableAndIdempotentlyMutationFree()
    {
        var exchangeId = await SeedReadyExchangeAsync(agreedHours: 1m, startingBalance: 5m);
        var memberBalanceBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var adminBalanceBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var svc = scope.ServiceProvider.GetRequiredService<ExchangeService>();
        var first = await svc.CompleteExchangeAsync(exchangeId, TestData.MemberUser.Id, null);
        var second = await svc.CompleteExchangeAsync(exchangeId, TestData.MemberUser.Id, null);

        first.Exchange.Should().BeNull();
        first.Error.Should().Be(CompletionUnavailable);
        second.Exchange.Should().BeNull();
        second.Error.Should().Be(CompletionUnavailable);

        using var assertScope = Factory.Services.CreateScope();
        assertScope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await db.Exchanges.IgnoreQueryFilters().SingleAsync(e => e.Id == exchangeId);
        refreshed.Status.Should().Be(ExchangeStatus.InProgress);
        refreshed.ActualHours.Should().BeNull();
        refreshed.CompletedAt.Should().BeNull();
        refreshed.TransactionId.Should().BeNull();
        (await db.Transactions.IgnoreQueryFilters()
            .CountAsync(t => t.Description != null &&
                             t.Description.StartsWith($"Exchange #{exchangeId}:")))
            .Should().Be(0);
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBalanceBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
    }

    private async Task<decimal> GetBalanceAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var wallet = scope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
        return await wallet.GetBalanceAsync(TestData.Tenant1.Id, userId);
    }
}
