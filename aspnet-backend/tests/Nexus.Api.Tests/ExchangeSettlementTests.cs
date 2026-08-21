// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Two-party settlement — the transaction a timebank exists for.
 *
 * 🔴 WHY THESE TESTS ASSERT BALANCES AND LEDGER LEGS, NOT STATUS CODES.
 * Ledger row 1.21 sat BROKEN for months while every route on the path existed and
 * every lifecycle test passed, because the tests asserted the shape of the answer
 * instead of the effect. `POST /confirm` even answered 200 {"status":"confirmed"}
 * while reopening a settled exchange. So every test below reads the ledger back:
 * the transaction row, both legs, and both derived balances. A 200 proves nothing.
 *
 * 🔴 WHY REAL POSTGRES. Settlement takes PersonalWalletLedgerService advisory locks
 * (pg_advisory_xact_lock) and derives balances by summing the ledger. Neither works
 * on an in-memory provider, so the concurrency guarantee would be untested — and
 * money code without a concurrency test is not finished. The [Collection("Integration")]
 * fixture starts a Testcontainers PostgreSQL 16.4 for exactly this reason.
 *
 * Rules mirrored from Laravel (app/Services/ExchangeWorkflowService.php):
 *   confirmCompletion   :445-526   per-party confirmation + variance clamp
 *   processConfirmations :919-1006  0.25h agreement tolerance, else dispute
 *   createTransaction    :1164-1268 payer/payee by listing type, balance guard
 */

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class ExchangeSettlementTests : IntegrationTestBase
{
    public ExchangeSettlementTests(NexusWebApplicationFactory factory) : base(factory) { }

    // In this fixture Listing1 is an Offer owned by the admin, so:
    //   requester / receiver / PAYER = member   (InitiatorId)
    //   provider  / payee            = admin    (ListingOwnerId)
    private const decimal AgreedHours = 2.0m;
    private const decimal MintedToPayer = 10.0m;

    // ── the journey that has never worked here ──────────────────────────────────

    [Fact]
    public async Task BothPartiesConfirmTheSameHours_MovesCreditsOnceWithBothLedgerLegs()
    {
        var exchangeId = await ReachPendingConfirmationAsync();
        var payerBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var payeeBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        await AuthenticateAsMemberAsync();
        var first = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });
        first.StatusCode.Should().Be(HttpStatusCode.OK);

        await AuthenticateAsAdminAsync();
        var second = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });
        second.StatusCode.Should().Be(HttpStatusCode.OK);

        // The client reads one level inside `data` after its api helper unwraps.
        var data = (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("final_hours").GetDecimal().Should().Be(2.0m);
        data.GetProperty("transaction_id").GetInt32().Should().BeGreaterThan(0);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var exchange = await db.Exchanges.AsNoTracking().IgnoreQueryFilters()
            .SingleAsync(e => e.Id == exchangeId);
        exchange.Status.Should().Be(ExchangeStatus.Completed);
        exchange.FinalHours.Should().Be(2.0m);
        exchange.RequesterConfirmedAt.Should().NotBeNull();
        exchange.ProviderConfirmedAt.Should().NotBeNull();
        exchange.RequesterConfirmedHours.Should().Be(2.0m);
        exchange.ProviderConfirmedHours.Should().Be(2.0m);
        exchange.CompletedAt.Should().NotBeNull();
        exchange.TransactionId.Should().NotBeNull();

        // BOTH legs of the one settlement row. A single-sided write would still
        // produce a plausible balance for one party and destroy credits for the other.
        var settlements = await SettlementRowsAsync(db, exchangeId);
        settlements.Should().HaveCount(1, "an exchange settles exactly once");
        var settlement = settlements[0];
        settlement.Id.Should().Be(exchange.TransactionId);
        settlement.SenderId.Should().Be(TestData.MemberUser.Id, "the party RECEIVING the service pays");
        settlement.ReceiverId.Should().Be(TestData.AdminUser.Id, "the party PROVIDING the service earns");
        settlement.Amount.Should().Be(2.0m);
        settlement.Status.Should().Be(TransactionStatus.Completed);
        settlement.TransactionType.Should().Be("exchange");

        // Conservation: exactly −2 / +2, nothing minted, nothing destroyed.
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(payerBefore - 2.0m);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(payeeBefore + 2.0m);
    }

    [Fact]
    public async Task BothPartiesConfirmWithinTolerance_SettlesTheMean()
    {
        var exchangeId = await ReachPendingConfirmationAsync();
        var payerBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var payeeBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        // 2.0 vs 1.8 — 0.2h apart, inside Laravel's 0.25h tolerance, so the mean
        // settles rather than the exchange going to dispute.
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });
        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 1.8 });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var exchange = await db.Exchanges.AsNoTracking().IgnoreQueryFilters()
            .SingleAsync(e => e.Id == exchangeId);

        exchange.Status.Should().Be(ExchangeStatus.Completed);
        exchange.FinalHours.Should().Be(1.90m);

        var settlements = await SettlementRowsAsync(db, exchangeId);
        settlements.Should().HaveCount(1);
        // 🔴 The stored FinalHours and the ledger amount must be the SAME number.
        // FinalHours is decimal(5,2); an unrounded mean would be rounded by the
        // database and then disagree with the amount actually transferred.
        settlements[0].Amount.Should().Be(exchange.FinalHours);
        settlements[0].Amount.Should().Be(1.90m);

        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(payerBefore - 1.90m);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(payeeBefore + 1.90m);
    }

    // ── every refusal must be a refusal, not a quiet partial settlement ─────────

    [Fact]
    public async Task ConfirmationsOutsideTolerance_DisputeAndMoveNothing()
    {
        var exchangeId = await ReachPendingConfirmationAsync();
        var payerBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var payeeBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        // 2.0 vs 1.5 — 0.5h apart. Both figures are inside the ±25% variance window
        // around the agreed 2.0h, so neither is clamped; they simply disagree.
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });
        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 1.5 });

        // Laravel returns success and records a dispute; a human has to resolve it.
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var exchange = await db.Exchanges.AsNoTracking().IgnoreQueryFilters()
            .SingleAsync(e => e.Id == exchangeId);

        exchange.Status.Should().Be(ExchangeStatus.Disputed);
        exchange.FinalHours.Should().BeNull("a disputed exchange has no agreed figure");
        exchange.TransactionId.Should().BeNull();
        exchange.CompletedAt.Should().BeNull();
        (await SettlementRowsAsync(db, exchangeId)).Should().BeEmpty();

        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(payerBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(payeeBefore);
    }

    [Fact]
    public async Task OneSidedConfirmation_IsRecordedButMovesNothing()
    {
        var exchangeId = await ReachPendingConfirmationAsync();
        var payerBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var payeeBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var exchange = await db.Exchanges.AsNoTracking().IgnoreQueryFilters()
            .SingleAsync(e => e.Id == exchangeId);

        exchange.RequesterConfirmedAt.Should().NotBeNull("the confirmation is durable — the client reads it");
        exchange.RequesterConfirmedHours.Should().Be(2.0m);
        exchange.ProviderConfirmedAt.Should().BeNull();
        exchange.Status.Should().Be(ExchangeStatus.PendingConfirmation,
            "one party's word does not complete an exchange");
        exchange.TransactionId.Should().BeNull();
        (await SettlementRowsAsync(db, exchangeId)).Should().BeEmpty();

        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(payerBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(payeeBefore);
    }

    [Fact]
    public async Task ConfirmationByANonParticipant_Is404_AndMovesNothing()
    {
        var exchangeId = await ReachPendingConfirmationAsync();
        var payerBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var payeeBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });

        // 404 not 403, matching Laravel's exchange reads, so an outsider cannot use
        // the status code to discover which exchange ids exist.
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var exchange = await db.Exchanges.AsNoTracking().IgnoreQueryFilters()
            .SingleAsync(e => e.Id == exchangeId);
        exchange.RequesterConfirmedAt.Should().BeNull();
        exchange.ProviderConfirmedAt.Should().BeNull();
        exchange.Status.Should().Be(ExchangeStatus.PendingConfirmation);
        (await SettlementRowsAsync(db, exchangeId)).Should().BeEmpty();

        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(payerBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(payeeBefore);
    }

    [Fact]
    public async Task RepeatedConfirmationAfterSettlement_IsRefusedAndDoesNotPayTwice()
    {
        var exchangeId = await ReachPendingConfirmationAsync();
        var payerBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var payeeBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });
        await AuthenticateAsAdminAsync();
        (await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        // Replay both sides. 🔴 This is the exact regression the removed alias caused:
        // a confirm on a COMPLETED exchange that already carried a settled
        // TransactionId, which it happily reopened.
        var replayProvider = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });
        await AuthenticateAsMemberAsync();
        var replayRequester = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });

        replayProvider.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await replayProvider.Content.ReadAsStringAsync()).Should().Contain("EXCHANGE_ERROR");
        replayRequester.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var exchange = await db.Exchanges.AsNoTracking().IgnoreQueryFilters()
            .SingleAsync(e => e.Id == exchangeId);
        exchange.Status.Should().Be(ExchangeStatus.Completed, "a replay must not reopen a settled exchange");

        (await SettlementRowsAsync(db, exchangeId)).Should().HaveCount(1, "two payments for one exchange");
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(payerBefore - 2.0m);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(payeeBefore + 2.0m);
    }

    [Fact]
    public async Task Settlement_WhenThePayerCannotCoverTheHours_Is422_AndKeepsTheFirstConfirmation()
    {
        var exchangeId = await ReachPendingConfirmationAsync(mintToPayer: 0m);
        // 🔴 The fixture already credits the member 10h ("Initial balance",
        // TestDataSeeder.cs:108-119), so "mint nothing" is not the same as "cannot
        // pay". Burn the balance down to 1.0h — below the 2.0h being settled —
        // otherwise this test passes for the wrong reason and never sees the guard.
        await SetPayerBalanceAsync(1.0m);
        var payerBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        payerBefore.Should().Be(1.0m);
        var payeeBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        await AuthenticateAsMemberAsync();
        (await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });

        // Laravel returns a typed 422 rather than an opaque 500 here, on purpose.
        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await response.Content.ReadAsStringAsync()).Should().Contain("INSUFFICIENT_BALANCE");

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var exchange = await db.Exchanges.AsNoTracking().IgnoreQueryFilters()
            .SingleAsync(e => e.Id == exchangeId);

        exchange.Status.Should().Be(ExchangeStatus.PendingConfirmation);
        exchange.TransactionId.Should().BeNull();
        exchange.FinalHours.Should().BeNull();
        // 🔴 The rollback must undo the SETTLEMENT, not the counterparty's earlier
        // confirmation — that was committed in its own transaction and losing it would
        // silently make the requester confirm twice.
        exchange.RequesterConfirmedAt.Should().NotBeNull();
        exchange.ProviderConfirmedAt.Should().BeNull("the refused confirmation rolled back with the settlement");
        (await SettlementRowsAsync(db, exchangeId)).Should().BeEmpty();

        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(payerBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(payeeBefore);
    }

    // ── concurrency: money code without this test is not finished ───────────────

    [Fact]
    public async Task BothPartiesConfirmSimultaneously_SettlesExactlyOnce()
    {
        // 🔴 Run the race five times, and hold both callers at a barrier so they enter
        // ConfirmHoursAsync at the same instant. A single unsynchronised attempt can
        // pass by simply never overlapping, which would make this test agree with a
        // build that had no locks at all — and a guard that cannot go red is not a
        // guard.
        //
        // MEASURED, NOT REASONED (2026-08-21). The red path was observed rather than
        // argued: with the pg_advisory_xact_lock calls removed from
        // PersonalWalletLedgerService.AcquireSpendLocksAsync -- same ids, same sorted
        // order, same required transaction, nothing else changed -- this test failed
        // 5 of 5 runs, on the Settled-count assertion below, always with "found 0":
        // both callers read the exchange before either commits, each records only its
        // own confirmation, sees a null counterparty timestamp, and returns Recorded,
        // so NOTHING settles and no credits move. Run 3 got through round 1 by luck
        // before failing in round 2, which is why the loop runs five rounds rather
        // than one. Re-measure the same way before trusting any change to that
        // service's locking.
        for (var round = 1; round <= 5; round++)
        {
            var exchangeId = await ReachPendingConfirmationAsync();
            var payerBefore = await GetBalanceAsync(TestData.MemberUser.Id);
            var payeeBefore = await GetBalanceAsync(TestData.AdminUser.Id);

            var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

            // Independent scopes, so two DbContexts on two connections — the shape of
            // two simultaneous HTTP requests. Whichever acquires the personal-wallet
            // advisory locks first commits its own confirmation; the other then sees
            // both and settles. Those locks are the only thing stopping two payments.
            async Task<ExchangeConfirmationResult> Confirm(int userId)
            {
                using var scope = Factory.Services.CreateScope();
                scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
                var service = scope.ServiceProvider.GetRequiredService<ExchangeService>();
                await gate.Task;
                return await service.ConfirmHoursAsync(exchangeId, userId, 2.0m);
            }

            var racing = new[]
            {
                Task.Run(() => Confirm(TestData.MemberUser.Id)),
                Task.Run(() => Confirm(TestData.AdminUser.Id))
            };
            gate.SetResult();
            var results = await Task.WhenAll(racing);

            var because = $"round {round}";
            results.Should().OnlyContain(result => result.Ok, because);
            results.Count(result => result.Outcome == ExchangeConfirmationOutcome.Settled)
                .Should().Be(1, $"exactly one of the two racing confirmations may settle ({because})");
            results.Count(result => result.Outcome == ExchangeConfirmationOutcome.Recorded)
                .Should().Be(1, because);

            using var scope = Factory.Services.CreateScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var exchange = await db.Exchanges.AsNoTracking().IgnoreQueryFilters()
                .SingleAsync(e => e.Id == exchangeId);
            exchange.Status.Should().Be(ExchangeStatus.Completed, because);
            exchange.TransactionId.Should().NotBeNull(because);

            (await SettlementRowsAsync(db, exchangeId)).Should().HaveCount(1, because);
            (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(payerBefore - 2.0m, because);
            (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(payeeBefore + 2.0m, because);
        }
    }

    // ── the /complete step: hands over, never settles ───────────────────────────

    [Fact]
    public async Task CompleteEndpoint_ByTheProvider_MovesToPendingConfirmationAndMovesNoCredits()
    {
        var exchangeId = await ReachInProgressAsync();
        var payerBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var payeeBefore = await GetBalanceAsync(TestData.AdminUser.Id);

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/complete", new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var exchange = await db.Exchanges.AsNoTracking().IgnoreQueryFilters()
            .SingleAsync(e => e.Id == exchangeId);

        exchange.Status.Should().Be(ExchangeStatus.PendingConfirmation);
        // 🔴 "complete" is Laravel's name for handing over to confirmation. Nothing
        // here may settle: no transaction, no final hours, no balance movement.
        exchange.TransactionId.Should().BeNull();
        exchange.FinalHours.Should().BeNull();
        exchange.CompletedAt.Should().BeNull();
        (await SettlementRowsAsync(db, exchangeId)).Should().BeEmpty();
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(payerBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(payeeBefore);
    }

    [Fact]
    public async Task CompleteEndpoint_ByTheReceiver_IsRefused()
    {
        var exchangeId = await ReachInProgressAsync();

        // Laravel restricts this to the provider and says why: it closes a direct-call
        // IDOR where the party receiving the service declares their own work done.
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/complete", new { });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Exchanges.AsNoTracking().IgnoreQueryFilters().SingleAsync(e => e.Id == exchangeId))
            .Status.Should().Be(ExchangeStatus.InProgress);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Drive the journey through the CLIENT'S verbs and paths up to InProgress, then
    /// mint <paramref name="mintToPayer"/> hours to the payer so a later refusal
    /// cannot be mistaken for an empty wallet.
    /// </summary>
    private async Task<int> ReachInProgressAsync(decimal mintToPayer = MintedToPayer)
    {
        await AuthenticateAsMemberAsync();
        var create = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = AgreedHours,
            message = "settlement guard"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var exchangeId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();

        await AuthenticateAsAdminAsync();
        (await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/accept", new { }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/start", new { }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        if (mintToPayer > 0m)
        {
            using var scope = Factory.Services.CreateScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            // SenderId null = minted, which the ledger permits; crediting from the
            // admin instead would move the payee's balance and blur the assertions.
            db.Transactions.Add(new Transaction
            {
                TenantId = TestData.Tenant1.Id,
                SenderId = null,
                ReceiverId = TestData.MemberUser.Id,
                Amount = mintToPayer,
                Description = "settlement fixture: opening balance",
                TransactionType = "adjustment",
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        return exchangeId;
    }

    private async Task<int> ReachPendingConfirmationAsync(decimal mintToPayer = MintedToPayer)
    {
        var exchangeId = await ReachInProgressAsync(mintToPayer);
        await AuthenticateAsAdminAsync();
        (await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/complete", new { }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        return exchangeId;
    }

    /// <summary>
    /// Move the payer's derived balance to exactly <paramref name="target"/> hours by
    /// burning the difference to a null counterparty. The ledger permits a null leg;
    /// sending the surplus to the payee instead would inflate the payee's balance and
    /// destroy the conservation assertions.
    /// </summary>
    private async Task SetPayerBalanceAsync(decimal target)
    {
        var current = await GetBalanceAsync(TestData.MemberUser.Id);
        var surplus = current - target;
        if (surplus <= 0m) return;

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.Transactions.Add(new Transaction
        {
            TenantId = TestData.Tenant1.Id,
            SenderId = TestData.MemberUser.Id,
            ReceiverId = null,
            Amount = surplus,
            Description = "settlement fixture: reduce opening balance",
            TransactionType = "adjustment",
            Status = TransactionStatus.Completed,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// The settlement rows for one exchange, matched on Laravel's exact description
    /// (<c>"Exchange #{id} for listing: …"</c>) so the fixture's minted opening
    /// balance cannot be counted as a payment.
    /// </summary>
    private static async Task<List<Transaction>> SettlementRowsAsync(NexusDbContext db, int exchangeId)
    {
        var prefix = $"Exchange #{exchangeId} for listing:";
        return await db.Transactions.AsNoTracking().IgnoreQueryFilters()
            .Where(t => t.TransactionType == ExchangeService.ExchangeTransactionType
                && t.Description != null
                && t.Description.StartsWith(prefix))
            .ToListAsync();
    }

    private async Task<decimal> GetBalanceAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var wallet = scope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
        return await wallet.GetBalanceAsync(TestData.Tenant1.Id, userId);
    }
}
